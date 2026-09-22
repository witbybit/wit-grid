import { useEffect, useRef, useState } from 'react';
import { createGridTraceReplay, type GridReplayScheduler, type GridTraceReplay } from '@eregister/wit-grid-core/experimental';
import './gridTraceReplayControls.css';

export interface GridTraceReplayControlsProps {
	/** A redacted replay trace. Imports are validated but never started automatically. */
	readonly trace?: unknown;
	/** Optional deterministic scheduler for embedding hosts and tests. */
	readonly scheduler?: GridReplayScheduler;
	readonly onWhyCell?: (cell: { readonly rowId: string; readonly colField: string }) => void;
}

interface ReplayState {
	readonly replay: GridTraceReplay | null;
	readonly errors: readonly string[];
	readonly status?: string;
}

function openTrace(input: unknown, scheduler?: GridReplayScheduler): ReplayState {
	const result = createGridTraceReplay(input, { scheduler });
	if (result.validation.ok && result.replay) return { replay: result.replay, errors: [] };
	return {
		replay: null,
		status: result.status,
		errors: result.validation.ok ? ['Replay runtime could not be created.'] : result.validation.errors,
	};
}

/**
 * Deliberately manual replay controls for hostile, redacted trace imports. This component
 * owns no live grid API and imported traces never autoplay.
 */
export function GridTraceReplayControls({ trace, scheduler, onWhyCell }: GridTraceReplayControlsProps) {
	const [state, setState] = useState<ReplayState>(() => (trace === undefined ? { replay: null, errors: [] } : openTrace(trace, scheduler)));
	const [speed, setSpeed] = useState('1');
	const current = useRef(state.replay);
	const replay = state.replay;
	useEffect(() => {
		if (trace === undefined) return;
		const next = openTrace(trace, scheduler);
		current.current?.destroy();
		current.current = next.replay;
		setState(next);
	}, [trace, scheduler]);
	useEffect(() => () => current.current?.destroy(), []);
	useEffect(() => replay?.subscribe(() => setState((previous) => ({ ...previous }))), [replay]);
	const refresh = () => setState((previous) => ({ ...previous }));
	const importFile = async (file: File | undefined) => {
		if (!file) return;
		const next = openTrace(await file.text(), scheduler);
		current.current?.destroy();
		current.current = next.replay;
		setState(next);
	};
	const stepBack = () => {
		if (!replay) return;
		replay.seek(Math.max(0, replay.index - 1));
		refresh();
	};
	const play = () => {
		if (!replay) return;
		if (replay.status === 'running') replay.pause();
		else replay.play(Number(speed));
		refresh();
	};
	return (
		<section
			className='og-replay'
			aria-label='Trace replay controls'
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				event.preventDefault();
				void importFile(event.dataTransfer.files[0]);
			}}
		>
			<header>
				<div>
					<span>Safe trace replay</span>
					<h3>Replay in an isolated headless runtime</h3>
				</div>
				<label className='og-replay__open'>
					Open trace
					<input
						aria-label='Open replay trace'
						type='file'
						accept='application/json,.json'
						onChange={(event) => void importFile(event.target.files?.[0])}
					/>
				</label>
			</header>
			<p className='og-replay__privacy'>
				Privacy warning: imported traces are untrusted. They cannot access your live grid, callbacks, network, or DOM.
			</p>
			{state.errors.length > 0 && (
				<div role='alert'>
					<strong>Trace {state.status === 'unsupported' ? 'unsupported' : 'rejected'}</strong>
					<ul>
						{state.errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				</div>
			)}
			{replay && (
				<>
					<div className='og-replay__summary' aria-live='polite'>
						<strong>{replay.status}</strong>
						<span>
							{replay.index} / {replay.total} events
						</span>
						<span>Validated allowlisted commands only</span>
					</div>
					<div className='og-replay__controls'>
						<button onClick={play} disabled={replay.status === 'completed' || replay.status === 'diverged'}>
							{replay.status === 'running' ? 'Pause' : 'Play'}
						</button>
						<button
							onClick={() => {
								replay.pause();
								refresh();
							}}
							disabled={replay.status !== 'running'}
						>
							Pause
						</button>
						<button onClick={stepBack} disabled={replay.index === 0}>
							Back (restart)
						</button>
						<button
							onClick={() => {
								replay.step();
								refresh();
							}}
							disabled={replay.status === 'completed' || replay.status === 'diverged'}
						>
							Step forward
						</button>
						<button
							onClick={() => {
								replay.cancel();
								refresh();
							}}
							disabled={replay.status === 'completed' || replay.status === 'cancelled'}
						>
							Cancel
						</button>
						<label>
							Speed{' '}
							<select
								aria-label='Replay speed'
								value={speed}
								onChange={(event) => {
									setSpeed(event.target.value);
									replay.setSpeed(Number(event.target.value));
								}}
							>
								<option value='0.5'>0.5×</option>
								<option value='1'>1×</option>
								<option value='2'>2×</option>
							</select>
						</label>
					</div>
					<label>
						Event position{' '}
						<input
							aria-label='Replay position'
							type='range'
							min={0}
							max={replay.total}
							value={replay.index}
							onChange={(event) => {
								replay.seek(Number(event.target.value));
								refresh();
							}}
						/>
					</label>
					<ol className='og-replay__events'>
						{replay.checkpoints.map((checkpoint) => (
							<li key={checkpoint.index}>
								#{checkpoint.index + 1} {checkpoint.facts.outcome} <code>{checkpoint.facts.hash}</code>
							</li>
						))}
					</ol>
					{replay.divergence && (
						<aside role='alert'>
							<strong>Diverged at event #{replay.divergence.index + 1}</strong>
							<p>Last matching event: {replay.divergence.lastMatch + 1 || 'none'}.</p>
							<pre>{JSON.stringify({ expected: replay.divergence.expected, actual: replay.divergence.actual }, null, 2)}</pre>
							{replay.divergence.actual.cells[0] && (
								<button onClick={() => onWhyCell?.(replay.divergence!.actual.cells[0]!)}>Why this cell?</button>
							)}
						</aside>
					)}
				</>
			)}
			{!replay && state.errors.length === 0 && (
				<p>Drop a redacted JSON trace here or open one. Replay will remain paused until you choose Play or Step forward.</p>
			)}
		</section>
	);
}
