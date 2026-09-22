import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { GridEventName, type GridApi, type ThemeTokens } from '@eregister/wit-grid-core';
import {
	clearFlightRecorder,
	explainFlightRecorderCell,
	getFlightRecorderSnapshot,
	startFlightRecorder,
	stopFlightRecorder,
	type GridCausalTraceEnvelope,
	type GridCausalTraceSnapshot,
	type GridCellExplanation,
} from '@eregister/wit-grid-core/experimental';
import {
	buildFrameDistribution,
	explanationRows,
	filterTraceEvents,
	groupTimeline,
	SLOW_FRAME_THRESHOLD_MS,
	tracePrivacyLabel,
	type TraceFilter,
	type TraceWorkspace,
} from './traceViewModel.js';
import { GridTraceReplayControls } from './replay/GridTraceReplayControls.js';
import './flightRecorderDevTools.css';

const TABS: readonly { id: TraceWorkspace; label: string; short: string }[] = [
	{ id: 'why', label: 'Why this cell?', short: 'Why' },
	{ id: 'timeline', label: 'Causal timeline', short: 'Timeline' },
	{ id: 'performance', label: 'Performance', short: 'Perf' },
	{ id: 'faults', label: 'Faults & trace', short: 'Faults' },
];
const EVENT_TYPES: readonly TraceFilter[] = [
	'all',
	'interaction',
	'commit-request',
	'commit-outcome',
	'invalidation',
	'cell-change',
	'frame',
	'fallback',
	'fault',
];
const ROW_HEIGHT = 58;
const EMPTY_SNAPSHOT: GridCausalTraceSnapshot = Object.freeze({ v: 1, sessionId: null, active: false, dropped: 0, events: Object.freeze([]) });
const MAX_UI_CAPACITY = 10_000;

function normalizeUiCapacity(value: number): number {
	return Number.isFinite(value) ? Math.min(MAX_UI_CAPACITY, Math.max(0, Math.floor(value))) : 512;
}

function normalizeCapacityDraft(value: string): number {
	return value === '' ? 512 : normalizeUiCapacity(Number(value));
}

type DevToolsStyle = CSSProperties & Record<`--${string}`, string>;

function themeVariables(theme: ThemeTokens): DevToolsStyle {
	return {
		'--fr-bg': theme.bgColor,
		'--fr-panel': theme.popoverBg,
		'--fr-line': theme.borderColor,
		'--fr-line-accent': theme.borderColorAccent,
		'--fr-text': theme.textColor,
		'--fr-muted': theme.headerText,
		'--fr-accent': theme.focusRing,
		'--fr-selection': theme.selectionBg,
		'--fr-hover': theme.popoverItemHoverBg,
		'--fr-input': theme.popoverInputBg,
		'--fr-danger': theme.error,
		'--fr-font': theme.fontFamily,
	};
}

export interface GridFlightRecorderDevToolsProps<TRowData> {
	api: GridApi<TRowData>;
	defaultOpen?: boolean;
	defaultDock?: 'right' | 'bottom' | 'floating';
	capacity?: number;
	redactValue?: (value: unknown, cell: { rowId: string; colField: string }) => unknown;
	onClose?: () => void;
}

function eventTitle(entry: GridCausalTraceEnvelope): string {
	const event = entry.event;
	if (event.type === 'cell-change') return `${event.cell.rowId} · ${event.cell.colField}`;
	if (event.type === 'fault') return `${event.source} · ${event.operation}`;
	if (event.type === 'commit-request' || event.type === 'invalidation') return event.reason;
	if (event.type === 'commit-outcome') return `${event.outcome} · attempt ${event.attemptId}`;
	if (event.type === 'frame') return `${event.kind} · ${event.changeIds.length ? `changes ${event.changeIds.join(', ')}` : 'uncorrelated'}`;
	if (event.type === 'fallback') return `${event.component} · ${event.reason}`;
	return event.action;
}

function useRecorderSnapshot<TRowData>(api: GridApi<TRowData>) {
	const [snapshot, setSnapshot] = useState<GridCausalTraceSnapshot>(() => getFlightRecorderSnapshot(api));
	const [paused, setPaused] = useState(false);
	const pausedRef = useRef(false);
	const frameRef = useRef<number | null>(null);
	const refresh = useCallback(() => {
		if (!pausedRef.current) setSnapshot(getFlightRecorderSnapshot(api));
	}, [api]);
	const scheduleRefresh = useCallback(() => {
		if (pausedRef.current || frameRef.current !== null) return;
		if (typeof requestAnimationFrame === 'function')
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null;
				refresh();
			});
		else queueMicrotask(refresh);
	}, [refresh]);
	useLayoutEffect(() => {
		setSnapshot(getFlightRecorderSnapshot(api));
	}, [api]);
	useEffect(() => {
		const unsubs = [
			api.addEventListener(GridEventName.cellValueChanged, scheduleRefresh),
			api.addEventListener(GridEventName.renderInvalidated, scheduleRefresh),
			api.addEventListener(GridEventName.runtimeFault, scheduleRefresh),
			api.addEventListener(GridEventName.writeBlocked, scheduleRefresh),
			api.addEventListener(GridEventName.selectionChanged, scheduleRefresh),
		];
		return () => {
			unsubs.forEach((unsubscribe) => unsubscribe());
			if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		};
	}, [api, scheduleRefresh]);
	const togglePaused = () => {
		pausedRef.current = !pausedRef.current;
		setPaused(pausedRef.current);
		if (!pausedRef.current) refresh();
	};
	return { snapshot, setSnapshot, paused, togglePaused, refresh };
}

export function GridFlightRecorderDevTools<TRowData>({
	api,
	defaultOpen = true,
	defaultDock = 'right',
	capacity = 512,
	redactValue,
	onClose,
}: GridFlightRecorderDevToolsProps<TRowData>) {
	const [open, setOpen] = useState(defaultOpen);
	const [workspace, setWorkspace] = useState<TraceWorkspace>('why');
	const [dock, setDock] = useState(defaultDock);
	const [filter, setFilter] = useState<TraceFilter>('all');
	const [query, setQuery] = useState('');
	const [selectedSequence, setSelectedSequence] = useState<number | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [width, setWidth] = useState(480);
	const [height, setHeight] = useState(560);
	const instanceId = useId().replaceAll(':', '');
	const [theme, setTheme] = useState<ThemeTokens>(() => api.getTheme());
	const [position, setPosition] = useState({ x: 24, y: 24 });
	const [capacityDraft, setCapacityDraft] = useState(() => String(normalizeUiCapacity(capacity)));
	const [captureValues, setCaptureValues] = useState<'none' | 'metadata' | 'full'>('none');
	const [focusedCell, setFocusedCell] = useState<{ rowId: string; colField: string } | null>(null);
	const [explanation, setExplanation] = useState<GridCellExplanation | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const pointerCleanupRef = useRef<(() => void) | null>(null);
	const { snapshot, setSnapshot, paused, togglePaused, refresh } = useRecorderSnapshot(api);

	useEffect(() => {
		const readFocus = () => {
			const focus = (api.getStateSnapshot().selection as { focus?: { rowId: string; colField: string } | null }).focus ?? null;
			setFocusedCell(focus);
		};
		readFocus();
		return api.addEventListener(GridEventName.selectionChanged, readFocus);
	}, [api]);
	useLayoutEffect(() => {
		setTheme(api.getTheme());
		return api.onThemeChange(setTheme);
	}, [api]);
	useEffect(
		() => setExplanation(focusedCell ? explainFlightRecorderCell(api, focusedCell.rowId, focusedCell.colField) : null),
		[api, focusedCell, snapshot]
	);
	useEffect(() => () => pointerCleanupRef.current?.(), []);

	const filtered = useMemo(() => filterTraceEvents(snapshot, filter, query), [snapshot, filter, query]);
	const groups = useMemo(() => groupTimeline(filtered), [filtered]);
	const flattened = useMemo(() => groups.flatMap((group) => group.events), [groups]);
	const distribution = useMemo(() => buildFrameDistribution(snapshot), [snapshot]);
	const selected = snapshot.events.find((entry) => entry.sequence === selectedSequence) ?? null;
	const viewportRows = dock === 'bottom' ? 7 : 10;
	const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
	const end = Math.min(flattened.length, start + viewportRows + 8);
	const visibleEvents = flattened.slice(start, end);

	const close = () => {
		setOpen(false);
		onClose?.();
		queueMicrotask(() => triggerRef.current?.focus());
	};
	useEffect(() => {
		if (!open) return;
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
				event.preventDefault();
				close();
			}
		};
		document.addEventListener('keydown', keydown);
		return () => document.removeEventListener('keydown', keydown);
	}, [open]);

	const startRecording = () => {
		const normalizedCapacity = normalizeCapacityDraft(capacityDraft);
		setCapacityDraft(String(normalizedCapacity));
		startFlightRecorder(api, {
			capacity: normalizedCapacity,
			captureValues,
			redactValue: captureValues === 'full' ? redactValue : undefined,
		});
		refresh();
	};
	const stopRecording = () => setSnapshot(stopFlightRecorder(api));
	const clear = () => {
		clearFlightRecorder(api);
		refresh();
	};
	const copyTrace = async () => navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2));
	const downloadTrace = () => {
		const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `wit-grid-trace-${snapshot.sessionId ?? 'empty'}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	};
	const handleTabKey = (event: ReactKeyboardEvent, index: number) => {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
		event.preventDefault();
		const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
		setWorkspace(TABS[next].id);
		panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
	};

	if (!open)
		return (
			<button ref={triggerRef} className='og-fr-launcher' onClick={() => setOpen(true)}>
				Open Flight Recorder
			</button>
		);
	const shellStyle: DevToolsStyle = {
		...themeVariables(theme),
		'--og-fr-width': `${width}px`,
		'--og-fr-height': `${height}px`,
		'--og-fr-x': `${position.x}px`,
		'--og-fr-y': `${position.y}px`,
	};
	const beginPointer = (move: (event: PointerEvent) => void) => {
		pointerCleanupRef.current?.();
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			pointerCleanupRef.current = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		pointerCleanupRef.current = up;
	};
	return (
		<section ref={panelRef} className={`og-fr og-fr--${dock}`} style={shellStyle} aria-label='Wit Grid Flight Recorder'>
			<div
				className='og-fr__resize'
				role='separator'
				tabIndex={0}
				aria-label='Resize Flight Recorder'
				aria-orientation={dock === 'bottom' ? 'horizontal' : 'vertical'}
				onKeyDown={(event) => {
					if (event.key === 'ArrowLeft') setWidth((value) => Math.min(760, value + 20));
					if (event.key === 'ArrowRight') setWidth((value) => Math.max(360, value - 20));
					if (event.key === 'ArrowUp') setHeight((value) => Math.min(820, value + 20));
					if (event.key === 'ArrowDown') setHeight((value) => Math.max(360, value - 20));
				}}
				onPointerDown={(event) => {
					const origin = event.clientX;
					const initial = width;
					const originY = event.clientY;
					const initialHeight = height;
					beginPointer((next) => {
						if (dock === 'bottom') setHeight(Math.max(360, Math.min(820, initialHeight + originY - next.clientY)));
						else {
							setWidth(Math.max(360, Math.min(760, initial + (dock === 'right' ? origin - next.clientX : next.clientX - origin))));
							if (dock === 'floating') setHeight(Math.max(360, Math.min(820, initialHeight + next.clientY - originY)));
						}
					});
				}}
			/>
			<header className='og-fr__header'>
				<div
					className={dock === 'floating' ? 'og-fr__drag' : undefined}
					onPointerDown={
						dock === 'floating'
							? (event) => {
									const origin = { x: event.clientX, y: event.clientY };
									const initial = position;
									beginPointer((next) =>
										setPosition({
											x: Math.max(0, initial.x + next.clientX - origin.x),
											y: Math.max(0, initial.y + next.clientY - origin.y),
										})
									);
								}
							: undefined
					}
				>
					<span className='og-fr__eyebrow'>Causal observability</span>
					<h2>Flight Recorder</h2>
				</div>
				<div className='og-fr__header-actions'>
					<span className={`og-fr__status ${snapshot.active ? 'is-live' : ''}`}>{snapshot.active ? 'Recording' : 'Stopped'}</span>
					<button onClick={snapshot.active ? stopRecording : startRecording}>{snapshot.active ? 'Stop' : 'Record'}</button>
					<button onClick={togglePaused}>{paused ? 'Resume UI' : 'Pause UI'}</button>
					<select aria-label='Panel position' value={dock} onChange={(event) => setDock(event.target.value as typeof dock)}>
						<option value='right'>Dock right</option>
						<option value='bottom'>Dock bottom</option>
						<option value='floating'>Float</option>
					</select>
					<button aria-label='Close Flight Recorder' onClick={close}>
						×
					</button>
				</div>
			</header>
			<div className='og-fr__summary'>
				<span>
					<strong>{snapshot.events.length}</strong> retained
				</span>
				<span>
					<strong>{snapshot.dropped}</strong> dropped
				</span>
				<span>{tracePrivacyLabel(snapshot)}</span>
				<span className='og-fr__session'>{snapshot.sessionId ?? 'No session'}</span>
			</div>
			{!snapshot.active && (
				<div className='og-fr__setup'>
					<label>
						Capacity{' '}
						<input
							aria-label='Recorder capacity'
							type='number'
							min={0}
							max={10000}
							value={capacityDraft}
							onChange={(event) => setCapacityDraft(event.target.value)}
							onBlur={() => setCapacityDraft(String(normalizeCapacityDraft(capacityDraft)))}
						/>
					</label>
					<label>
						Value capture{' '}
						<select
							aria-label='Value capture'
							value={captureValues}
							onChange={(event) => setCaptureValues(event.target.value as typeof captureValues)}
						>
							<option value='none'>None (recommended)</option>
							<option value='metadata'>Metadata</option>
							{redactValue && <option value='full'>Full through redactor</option>}
						</select>
					</label>
				</div>
			)}
			<nav className='og-fr__tabs' role='tablist' aria-label='Recorder workspaces'>
				{TABS.map((tab, index) => (
					<button
						id={`og-fr-${instanceId}-tab-${tab.id}`}
						aria-controls={`og-fr-${instanceId}-panel-${tab.id}`}
						key={tab.id}
						role='tab'
						aria-selected={workspace === tab.id}
						tabIndex={workspace === tab.id ? 0 : -1}
						onKeyDown={(event) => handleTabKey(event, index)}
						onClick={() => setWorkspace(tab.id)}
					>
						{tab.short}
						<span>{tab.label}</span>
					</button>
				))}
			</nav>
			<main
				id={`og-fr-${instanceId}-panel-${workspace}`}
				aria-labelledby={`og-fr-${instanceId}-tab-${workspace}`}
				role='tabpanel'
				className='og-fr__body'
			>
				{workspace === 'why' && (
					<section className='og-fr__workspace'>
						<div className='og-fr__workspace-head'>
							<div>
								<span className='og-fr__eyebrow'>Exact cell provenance</span>
								<h3>{focusedCell ? `${focusedCell.rowId} / ${focusedCell.colField}` : 'Focus a cell'}</h3>
							</div>
							<button
								onClick={() => focusedCell && setExplanation(explainFlightRecorderCell(api, focusedCell.rowId, focusedCell.colField))}
							>
								Refresh evidence
							</button>
						</div>
						<div className='og-fr__story'>
							{explanationRows(explanation).map(({ field, evidence }, index) => (
								<article key={field} className={`og-fr__evidence is-${evidence.status}`}>
									<span className='og-fr__rail'>{index + 1}</span>
									<div>
										<strong>{field.replace(/([A-Z])/g, ' $1')}</strong>
										{evidence.status === 'known' ? (
											<>
												<p>{eventTitle(evidence.value)}</p>
												<button
													onClick={() => {
														setSelectedSequence(evidence.value.sequence);
														setWorkspace('timeline');
													}}
												>
													Jump to event #{evidence.value.sequence}
												</button>
											</>
										) : (
											<p>{evidence.reason}</p>
										)}
									</div>
								</article>
							))}
							{['Raw/display provenance', 'Formula & aggregate contributors', 'Integrity evidence'].map((label, index) => (
								<article key={label} className='og-fr__evidence is-not-applicable'>
									<span className='og-fr__rail'>{index + 5}</span>
									<div>
										<strong>{label}</strong>
										<p>Not available in the retained Plan 161 trace contract.</p>
									</div>
								</article>
							))}
						</div>
						{!explanation && (
							<EmptyState title='No focused evidence yet' text='Focus a data cell, then perform an edit to build its causal story.' />
						)}
					</section>
				)}
				{workspace === 'timeline' && (
					<section className='og-fr__workspace og-fr__timeline'>
						<div className='og-fr__filters'>
							<input
								aria-label='Search trace'
								placeholder='Search row, column, reason…'
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							<select aria-label='Event type' value={filter} onChange={(event) => setFilter(event.target.value as TraceFilter)}>
								{EVENT_TYPES.map((type) => (
									<option key={type}>{type}</option>
								))}
							</select>
							<span>{groups.length} causal groups</span>
						</div>
						<div className='og-fr__timeline-grid'>
							<div
								className='og-fr__virtual'
								data-testid='virtual-timeline'
								onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
							>
								<div style={{ height: flattened.length * ROW_HEIGHT, position: 'relative' }}>
									{visibleEvents.map((entry, offset) => (
										<button
											key={entry.sequence}
											className={`og-fr__event ${selectedSequence === entry.sequence ? 'is-selected' : ''}`}
											style={{ top: (start + offset) * ROW_HEIGHT }}
											onClick={() => setSelectedSequence(entry.sequence)}
										>
											<span className={`og-fr__dot is-${entry.event.type}`} />
											<span>
												<strong>{entry.event.type}</strong>
												<small>{eventTitle(entry)}</small>
											</span>
											<time>#{entry.sequence}</time>
										</button>
									))}
								</div>
							</div>
							<EventDetail entry={selected} />
						</div>
					</section>
				)}
				{workspace === 'performance' && (
					<section className='og-fr__workspace'>
						<div className='og-fr__workspace-head'>
							<div>
								<span className='og-fr__eyebrow'>Observed frame work</span>
								<h3>{distribution.frames.length} completed frames</h3>
							</div>
							<span>{distribution.unknownMetrics} with unknown counters</span>
						</div>
						<div className='og-fr__metric-grid'>
							<Metric label='Max duration' value={formatDuration(distribution.maxDurationMs)} />
							<Metric label='P95 duration (nearest-rank)' value={formatDuration(distribution.p95DurationMs)} />
							<Metric label={`Slow frames (≥ ${SLOW_FRAME_THRESHOLD_MS} ms)`} value={distribution.slowFrameCount} />
							<Metric label='Unknown durations' value={distribution.unknownDurations} />
							<Metric label='Max cells written' value={distribution.maxCellsWritten} />
							<Metric label='Max rows visited' value={distribution.maxRowsVisited} />
							<Metric label='Fallbacks' value={snapshot.events.filter((entry) => entry.event.type === 'fallback').length} />
							<Metric
								label='Correlated frames'
								value={distribution.frames.filter((frame) => frame.correlation === 'render-request').length}
							/>
						</div>
						<div className='og-fr__bars' aria-label='Frame duration distribution'>
							{distribution.frames.slice(-40).map((frame, index) => (
								<div
									key={index}
									className='og-fr__bar'
									title={`${formatDuration(frame.durationMs)} · ${frame.cellsWritten ?? 'unknown'} cells · ${frame.rowsVisited ?? 'unknown'} rows`}
									style={{
										height:
											frame.durationMs === undefined
												? 4
												: `${Math.max(5, (frame.durationMs / Math.max(0.001, distribution.maxDurationMs ?? 0.001)) * 100)}%`,
									}}
								/>
							))}
						</div>
						{distribution.frames.length === 0 && (
							<EmptyState title='No completed frames retained' text='Start recording and interact with the rendered grid.' />
						)}
					</section>
				)}
				{workspace === 'faults' && (
					<section className='og-fr__workspace'>
						<div className='og-fr__workspace-head'>
							<div>
								<span className='og-fr__eyebrow'>Privacy-safe handoff</span>
								<h3>Faults & trace</h3>
							</div>
							<div>
								<button onClick={clear}>Clear</button>
								<button onClick={copyTrace}>Copy JSON</button>
								<button onClick={downloadTrace}>Download</button>
							</div>
						</div>
						{snapshot.events
							.filter((entry) => entry.event.type === 'fault')
							.map((entry) => (
								<article className='og-fr__fault' key={entry.sequence}>
									<strong>{eventTitle(entry)}</strong>
									<p>{entry.event.type === 'fault' && entry.event.message}</p>
									<span>Event #{entry.sequence}</span>
								</article>
							))}
						<div className='og-fr__privacy'>
							<strong>{tracePrivacyLabel(snapshot)}</strong>
							<p>Exports use this immutable snapshot. Values are never recovered by DevTools.</p>
							<code>
								v{snapshot.v} · {snapshot.events.length} events · {snapshot.dropped} dropped
							</code>
						</div>
						<GridTraceReplayControls
							onWhyCell={(cell) => {
								setFocusedCell(cell);
								setWorkspace('why');
							}}
						/>
					</section>
				)}
			</main>
		</section>
	);
}

function EmptyState({ title, text }: { title: string; text: string }) {
	return (
		<div className='og-fr__empty'>
			<span>◇</span>
			<strong>{title}</strong>
			<p>{text}</p>
		</div>
	);
}
function formatDuration(value: number | undefined): string {
	return value === undefined ? 'Unknown' : `${value.toFixed(1)} ms`;
}
function Metric({ label, value }: { label: string; value: number | string }) {
	return (
		<article className='og-fr__metric'>
			<strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
			<span>{label}</span>
		</article>
	);
}
function EventDetail({ entry }: { entry: GridCausalTraceEnvelope | null }) {
	return (
		<aside className='og-fr__detail'>
			{entry ? (
				<>
					<span className='og-fr__eyebrow'>Event #{entry.sequence}</span>
					<h3>{entry.event.type}</h3>
					<pre>{JSON.stringify(entry.event, null, 2)}</pre>
				</>
			) : (
				<EmptyState title='Select an event' text='Inspect exact retained evidence without inferred links.' />
			)}
		</aside>
	);
}
