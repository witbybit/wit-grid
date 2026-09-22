import React, { useState, useCallback } from 'react';
import type { GridApi } from '../../types.js';
import type { GridIntegrityIssue, GridCellDiff, GridCellConflict, ResolveConflictOptions } from '@eregister/wit-grid-core';

type Tab = 'overview' | 'quality' | 'diff' | 'conflicts';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const FocusIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M1 4V1.5h2.5M10 4V1.5H7.5M1 7v2.5h2.5M10 7v2.5H7.5' />
		<circle cx='5.5' cy='5.5' r='1.5' />
	</svg>
);

// ── Shared helpers ────────────────────────────────────────────────────────────

interface Theme {
	panelBg: string;
	borderColor: string;
	text: string;
	mutedText: string;
	accentColor: string;
	hoverBg: string;
}

function resolveTheme(api: GridApi<any>): Theme {
	const t = api.getTheme() as unknown as Record<string, string>;
	return {
		panelBg: t.panelBg ?? t.bgColor ?? '#0f172a',
		borderColor: t.borderColor ?? '#1e293b',
		text: t.text ?? '#e2e8f0',
		mutedText: t.mutedText ?? '#64748b',
		accentColor: t.accentColor ?? '#6366f1',
		hoverBg: t.hoverBg ?? 'rgba(255,255,255,0.04)',
	};
}

function SeverityDot({ severity }: { severity: 'info' | 'warning' | 'error' }) {
	const color = severity === 'error' ? '#f87171' : severity === 'warning' ? '#fbbf24' : '#38bdf8';
	return (
		<svg width='7' height='7' viewBox='0 0 7 7' style={{ flexShrink: 0, marginTop: 3 }}>
			<circle cx='3.5' cy='3.5' r='3' fill={color} />
		</svg>
	);
}

function IssueRow({ issue, theme, onFocus }: { issue: GridIntegrityIssue; theme: Theme; onFocus?: (issue: GridIntegrityIssue) => void }) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'flex-start',
				gap: 6,
				padding: '5px 10px',
				borderBottom: `1px solid ${theme.borderColor}`,
				fontSize: 11,
			}}
		>
			<SeverityDot severity={issue.severity} />
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ display: 'flex', gap: 4, marginBottom: 1 }}>
					<span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: theme.mutedText }}>
						{issue.source}
					</span>
					{issue.colField && (
						<span
							style={{
								fontSize: 9,
								fontFamily: 'monospace',
								color: theme.mutedText,
								background: theme.hoverBg,
								borderRadius: 3,
								padding: '0 3px',
							}}
						>
							{issue.colField}
						</span>
					)}
				</div>
				<div style={{ color: theme.text, lineHeight: 1.4, wordBreak: 'break-word' }}>{issue.message}</div>
			</div>
			{issue.rowId && issue.colField && onFocus && (
				<button
					onClick={() => onFocus(issue)}
					title='Focus cell'
					style={{
						flexShrink: 0,
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						color: theme.mutedText,
						padding: 2,
						borderRadius: 3,
						display: 'flex',
						alignItems: 'center',
					}}
				>
					<FocusIcon />
				</button>
			)}
		</div>
	);
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', quality: 'Quality', diff: 'Diff', conflicts: 'Conflicts' };

function TabBar({ tab, setTab, theme }: { tab: Tab; setTab: (t: Tab) => void; theme: Theme }) {
	return (
		<div style={{ display: 'flex', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0 }}>
			{(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
				<button
					key={t}
					onClick={() => setTab(t)}
					style={{
						flex: 1,
						padding: '6px 4px',
						background: 'none',
						border: 'none',
						borderBottom: tab === t ? `2px solid ${theme.accentColor}` : '2px solid transparent',
						color: tab === t ? theme.text : theme.mutedText,
						fontSize: 10,
						fontWeight: tab === t ? 600 : 400,
						cursor: 'pointer',
						transition: 'color 0.1s',
					}}
				>
					{TAB_LABELS[t]}
				</button>
			))}
		</div>
	);
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ api, theme }: { api: GridApi<any>; theme: Theme }) {
	const summary = api.integrity.getSummary();
	const issues = api.integrity.getIssues();

	function handleFocus(issue: GridIntegrityIssue) {
		if (issue.rowId && issue.colField) api.selectCell({ rowId: issue.rowId, colField: issue.colField });
	}

	const stats = [
		{ label: 'Total', value: summary.totalIssues, color: theme.text },
		{ label: 'Errors', value: summary.errors, color: '#f87171' },
		{ label: 'Warnings', value: summary.warnings, color: '#fbbf24' },
		{ label: 'Blocking', value: summary.blockingIssues, color: '#f87171' },
	];

	const statusColor =
		summary.status === 'blocked'
			? '#f87171'
			: summary.status === 'warning'
				? '#fbbf24'
				: summary.status === 'clean'
					? '#4ade80'
					: theme.mutedText;

	return (
		<div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
			{/* Status chip */}
			<div style={{ padding: '8px 10px', borderBottom: `1px solid ${theme.borderColor}`, display: 'flex', alignItems: 'center', gap: 6 }}>
				<span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, display: 'inline-block', flexShrink: 0 }} />
				<span style={{ fontSize: 11, fontWeight: 600, color: statusColor, textTransform: 'capitalize' }}>{summary.status}</span>
			</div>
			{/* Stats row */}
			<div style={{ display: 'flex', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0 }}>
				{stats.map(({ label, value, color }) => (
					<div key={label} style={{ flex: 1, padding: '8px 4px', textAlign: 'center' }}>
						<div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
						<div style={{ fontSize: 9, color: theme.mutedText, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
					</div>
				))}
			</div>
			{/* Issue list */}
			{issues.length === 0 ? (
				<div style={{ padding: 16, color: theme.mutedText, fontSize: 11, textAlign: 'center' }}>No issues.</div>
			) : (
				issues.map((issue) => <IssueRow key={issue.id} issue={issue} theme={theme} onFocus={handleFocus} />)
			)}
		</div>
	);
}

// ── Quality tab ───────────────────────────────────────────────────────────────

function QualityTab({ api, theme }: { api: GridApi<any>; theme: Theme }) {
	const [running, setRunning] = useState(false);
	const [hasRun, setHasRun] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [, forceUpdate] = useState(0);

	const issues = api.integrity.getIssues({ source: 'dataQuality' });

	const handleRun = useCallback(async () => {
		setRunning(true);
		setError(null);
		try {
			await api.integrity.run({ modules: ['quality'] });
			setHasRun(true);
			forceUpdate((n) => n + 1);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRunning(false);
		}
	}, [api]);

	const handleClear = useCallback(() => {
		api.integrity.clearIssues({ source: 'dataQuality' });
		setHasRun(false);
		setError(null);
		forceUpdate((n) => n + 1);
	}, [api]);

	function handleFocus(issue: GridIntegrityIssue) {
		if (issue.rowId && issue.colField) api.selectCell({ rowId: issue.rowId, colField: issue.colField });
	}

	return (
		<div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
			{/* Action bar */}
			<div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0 }}>
				<button
					onClick={handleRun}
					disabled={running}
					style={{
						flex: 1,
						padding: '5px 10px',
						background: theme.accentColor,
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: running ? 'not-allowed' : 'pointer',
						fontSize: 11,
						fontWeight: 600,
						opacity: running ? 0.7 : 1,
					}}
				>
					{running ? 'Running…' : 'Run Checks'}
				</button>
				{hasRun && (
					<button
						onClick={handleClear}
						style={{
							padding: '5px 10px',
							background: 'transparent',
							color: theme.mutedText,
							border: `1px solid ${theme.borderColor}`,
							borderRadius: 4,
							cursor: 'pointer',
							fontSize: 11,
						}}
					>
						Clear
					</button>
				)}
			</div>
			{error && (
				<div
					style={{
						padding: '6px 10px',
						background: 'rgba(248,113,113,0.1)',
						color: '#f87171',
						fontSize: 11,
						borderBottom: `1px solid ${theme.borderColor}`,
					}}
				>
					{error}
				</div>
			)}
			{!hasRun && !running && (
				<div style={{ padding: 16, color: theme.mutedText, fontSize: 11, textAlign: 'center' }}>
					Click <strong>Run Checks</strong> to scan for quality issues.
				</div>
			)}
			{hasRun && issues.length === 0 && (
				<div style={{ padding: 16, color: theme.mutedText, fontSize: 11, textAlign: 'center' }}>No quality issues found.</div>
			)}
			{issues.map((issue) => (
				<IssueRow key={issue.id} issue={issue} theme={theme} onFocus={handleFocus} />
			))}
		</div>
	);
}

// ── Diff tab ──────────────────────────────────────────────────────────────────

function DiffTab({ api, theme }: { api: GridApi<any>; theme: Theme }) {
	const [, forceUpdate] = useState(0);
	const refresh = () => forceUpdate((n) => n + 1);

	const result = api.integrity.getDiffResult();

	function handleFocus(cell: GridCellDiff) {
		api.selectCell({ rowId: cell.rowId, colField: cell.colField });
	}

	async function handleAccept(cell: GridCellDiff) {
		await api.integrity.acceptCellDiff(cell.rowId, cell.colField);
		refresh();
	}

	function handleClear() {
		api.integrity.clearDiff();
		refresh();
	}

	const chipStyle = (color: string): React.CSSProperties => ({
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '1px 6px',
		borderRadius: 4,
		background: `${color}22`,
		color,
		fontSize: 11,
		fontWeight: 600,
	});

	const sectionLabel: React.CSSProperties = {
		fontSize: 10,
		fontWeight: 700,
		color: theme.mutedText,
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginBottom: 4,
	};

	const btn = (color: string, bg: string): React.CSSProperties => ({
		fontSize: 10,
		padding: '1px 6px',
		borderRadius: 3,
		border: `1px solid ${color}`,
		background: bg,
		color,
		cursor: 'pointer',
	});

	return (
		<div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
			{!result ? (
				<div style={{ color: theme.mutedText, fontSize: 11, textAlign: 'center', marginTop: 24 }}>
					No diff active.
					<br />
					Use <code>api.integrity.setDiffModel()</code> to compare datasets.
				</div>
			) : (
				<>
					<div>
						<div style={sectionLabel}>Summary</div>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
							<span style={chipStyle('#22c55e')}>{result.addedRows.length} added</span>
							<span style={chipStyle('#ef4444')}>{result.removedRows.length} removed</span>
							<span style={chipStyle('#f59e0b')}>{result.changedRows.length} changed rows</span>
							<span style={chipStyle('#6366f1')}>{result.changedCells.length} changed cells</span>
						</div>
					</div>

					{result.removedRows.length > 0 && (
						<div>
							<div style={sectionLabel}>Removed Rows ({result.removedRows.length})</div>
							<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
								{result.removedRows.map((id) => (
									<div
										key={id}
										style={{
											fontSize: 11,
											color: '#ef4444',
											padding: '2px 6px',
											background: 'rgba(239,68,68,0.08)',
											borderRadius: 4,
										}}
									>
										{id}
									</div>
								))}
							</div>
						</div>
					)}

					{result.changedCells.length > 0 && (
						<div>
							<div style={sectionLabel}>Changed Cells ({result.changedCells.length})</div>
							<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
								{result.changedCells.map((cell, i) => (
									<div
										key={i}
										style={{
											fontSize: 11,
											color: theme.text,
											padding: '5px 7px',
											background: 'rgba(245,158,11,0.06)',
											border: '1px solid rgba(245,158,11,0.2)',
											borderRadius: 5,
										}}
									>
										<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
											<span style={{ fontWeight: 600 }}>{cell.colField}</span>
											<span style={{ fontSize: 10, color: theme.mutedText }}>{cell.rowId}</span>
										</div>
										<div
											style={{
												display: 'flex',
												gap: 6,
												alignItems: 'center',
												fontSize: 10,
												color: theme.mutedText,
												marginBottom: 5,
											}}
										>
											<span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{String(cell.oldValue ?? '—')}</span>
											<span>→</span>
											<span style={{ color: '#22c55e' }}>{String(cell.newValue ?? '—')}</span>
										</div>
										<div style={{ display: 'flex', gap: 4 }}>
											<button onClick={() => handleFocus(cell)} style={btn(theme.mutedText, 'none')}>
												Focus
											</button>
											<button onClick={() => handleAccept(cell)} style={btn('#22c55e', 'rgba(34,197,94,0.08)')}>
												Accept
											</button>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{result.addedRows.length > 0 && (
						<div>
							<div style={sectionLabel}>Added Rows ({result.addedRows.length})</div>
							<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
								{result.addedRows.map((id) => (
									<div
										key={id}
										style={{
											fontSize: 11,
											color: '#22c55e',
											padding: '2px 6px',
											background: 'rgba(34,197,94,0.08)',
											borderRadius: 4,
										}}
									>
										{id}
									</div>
								))}
							</div>
						</div>
					)}

					<button
						onClick={handleClear}
						style={{
							marginTop: 4,
							padding: '5px 10px',
							borderRadius: 5,
							border: `1px solid ${theme.borderColor}`,
							background: 'none',
							color: theme.mutedText,
							cursor: 'pointer',
							fontSize: 11,
						}}
					>
						Clear Diff
					</button>
				</>
			)}
		</div>
	);
}

// ── Conflicts tab ─────────────────────────────────────────────────────────────

function ConflictsTab({ api, theme }: { api: GridApi<any>; theme: Theme }) {
	const [, forceUpdate] = useState(0);
	const refresh = () => forceUpdate((n) => n + 1);

	const realConflicts: readonly GridCellConflict[] = api.integrity.getConflicts();
	const realConflictsByCell = new Map(realConflicts.map((c) => [`${c.rowId}:${c.colField}`, c]));
	const allConflictIssues: readonly GridIntegrityIssue[] = api.integrity.getIssues({ source: 'conflict' });
	const publishedIssues = allConflictIssues.filter((i) => !i.rowId || !i.colField || !realConflictsByCell.has(`${i.rowId}:${i.colField}`));
	const totalCount = realConflicts.length + publishedIssues.length;

	async function handleResolve(conflict: GridCellConflict, options: ResolveConflictOptions) {
		await api.integrity.resolveConflict(conflict.id, options);
		refresh();
	}

	function handleClearConflict(conflict: GridCellConflict) {
		api.integrity.clearConflict(conflict.id);
		refresh();
	}

	function handleDismissIssue(issue: GridIntegrityIssue) {
		const remaining = allConflictIssues.filter((i) => i.id !== issue.id);
		api.integrity.clearIssues({ source: 'conflict' });
		if (remaining.length > 0) api.integrity.publishIssues('conflict', remaining);
		refresh();
	}

	function handleClearAll() {
		for (const c of realConflicts) api.integrity.clearConflict(c.id);
		api.integrity.clearIssues({ source: 'conflict' });
		refresh();
	}

	function handleFocus(rowId: string, colField: string) {
		api.selectCell({ rowId, colField });
	}

	const sectionLabel: React.CSSProperties = {
		fontSize: 10,
		fontWeight: 700,
		color: theme.mutedText,
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginBottom: 4,
	};

	const sourceBadge: React.CSSProperties = {
		display: 'inline-block',
		padding: '0 5px',
		borderRadius: 3,
		fontSize: 9,
		fontWeight: 700,
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		background: 'rgba(99,102,241,0.15)',
		color: '#818cf8',
	};

	const btn = (color: string, bg: string, border: string): React.CSSProperties => ({
		fontSize: 10,
		padding: '1px 6px',
		borderRadius: 3,
		border: `1px solid ${border}`,
		background: bg,
		color,
		cursor: 'pointer',
	});

	return (
		<div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
			{totalCount === 0 ? (
				<div style={{ color: theme.mutedText, fontSize: 11, textAlign: 'center', marginTop: 24 }}>
					No active conflicts.
					<br />
					Use a live stream with <code>dirtyCellPolicy: 'markConflict'</code> to register conflicts.
				</div>
			) : (
				<>
					{realConflicts.length > 0 && (
						<>
							<div style={sectionLabel}>Live Conflicts ({realConflicts.length})</div>
							{realConflicts.map((c) => (
								<div
									key={c.id}
									style={{
										fontSize: 11,
										color: theme.text,
										padding: '7px 9px',
										background: 'rgba(239,68,68,0.06)',
										border: '1px solid rgba(239,68,68,0.2)',
										borderRadius: 5,
									}}
								>
									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
										<span style={{ fontWeight: 600 }}>{c.colField}</span>
										<span style={sourceBadge}>{c.source}</span>
									</div>
									<div style={{ fontSize: 11, color: theme.mutedText, marginBottom: 4 }}>{c.rowId}</div>
									<div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, marginBottom: 6 }}>
										<div>
											<span style={{ color: theme.mutedText }}>Base: </span>
											{String(c.baseValue ?? '—')}
										</div>
										<div>
											<span style={{ color: theme.mutedText }}>Local: </span>
											<span style={{ color: '#22c55e' }}>{String(c.localValue ?? '—')}</span>
										</div>
										<div>
											<span style={{ color: theme.mutedText }}>Remote: </span>
											<span style={{ color: '#f59e0b' }}>{String(c.remoteValue ?? '—')}</span>
										</div>
									</div>
									<div style={{ display: 'flex', gap: 4 }}>
										{c.rowId && c.colField && (
											<button
												onClick={() => handleFocus(c.rowId, c.colField)}
												style={btn(theme.mutedText, 'none', theme.borderColor)}
											>
												Focus
											</button>
										)}
										<button
											onClick={() => handleResolve(c, { strategy: 'local' })}
											style={btn('#22c55e', 'rgba(34,197,94,0.08)', 'rgba(34,197,94,0.4)')}
										>
											Keep Local
										</button>
										<button
											onClick={() => handleResolve(c, { strategy: 'remote' })}
											style={btn('#f59e0b', 'rgba(245,158,11,0.08)', 'rgba(245,158,11,0.4)')}
										>
											Use Remote
										</button>
									</div>
								</div>
							))}
						</>
					)}

					{publishedIssues.length > 0 && (
						<>
							<div style={sectionLabel}>Conflict Issues ({publishedIssues.length})</div>
							{publishedIssues.map((issue) => (
								<div
									key={issue.id}
									style={{
										fontSize: 11,
										color: theme.text,
										padding: '7px 9px',
										background: 'rgba(239,68,68,0.04)',
										border: '1px solid rgba(239,68,68,0.15)',
										borderRadius: 5,
									}}
								>
									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
										<span style={{ fontWeight: 600 }}>{issue.colField ?? '—'}</span>
										<span style={sourceBadge}>conflict</span>
									</div>
									{issue.rowId && <div style={{ fontSize: 11, color: theme.mutedText, marginBottom: 4 }}>{issue.rowId}</div>}
									<div style={{ fontSize: 10, color: theme.text, marginBottom: 6, lineHeight: 1.4 }}>{issue.message}</div>
									<div style={{ display: 'flex', gap: 4 }}>
										{issue.rowId && issue.colField && (
											<button
												onClick={() => handleFocus(issue.rowId!, issue.colField!)}
												style={btn(theme.mutedText, 'none', theme.borderColor)}
											>
												Focus
											</button>
										)}
										<button
											onClick={() => handleDismissIssue(issue)}
											style={btn('#f87171', 'rgba(239,68,68,0.08)', 'rgba(239,68,68,0.4)')}
										>
											Dismiss
										</button>
									</div>
								</div>
							))}
						</>
					)}

					{totalCount > 1 && (
						<button
							onClick={handleClearAll}
							style={{
								marginTop: 4,
								padding: '5px 10px',
								borderRadius: 5,
								border: `1px solid ${theme.borderColor}`,
								background: 'none',
								color: theme.mutedText,
								cursor: 'pointer',
								fontSize: 11,
							}}
						>
							Clear All
						</button>
					)}
				</>
			)}
		</div>
	);
}

// ── Panel shell ───────────────────────────────────────────────────────────────

export function DataIntegrityPanel({ api, onClose }: { api: GridApi<any>; onClose: () => void }) {
	const [tab, setTab] = useState<Tab>('overview');
	const theme = resolveTheme(api);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.panelBg, color: theme.text, fontSize: 12 }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '10px 12px',
					borderBottom: `1px solid ${theme.borderColor}`,
					flexShrink: 0,
				}}
			>
				<span style={{ fontWeight: 600, fontSize: 12 }}>Data Integrity</span>
				<button
					onClick={onClose}
					style={{
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						color: theme.mutedText,
						padding: 2,
						display: 'flex',
						alignItems: 'center',
					}}
				>
					<CloseIcon />
				</button>
			</div>

			<TabBar tab={tab} setTab={setTab} theme={theme} />

			{tab === 'overview' && <OverviewTab api={api} theme={theme} />}
			{tab === 'quality' && <QualityTab api={api} theme={theme} />}
			{tab === 'diff' && <DiffTab api={api} theme={theme} />}
			{tab === 'conflicts' && <ConflictsTab api={api} theme={theme} />}
		</div>
	);
}
