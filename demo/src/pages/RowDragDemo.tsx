/**
 * Row Drag-and-Drop Demo (Plan 063)
 *
 * Managed mode  — grid auto-reorders rows; api.setRowOrder / getRowOrder usable.
 * Unmanaged mode — grid fires rowDragEnd only; host controls the reorder.
 *
 * Also shows:
 *   - rowDrag: true on a column → drag handle appears in that cell
 *   - rowDrag: (params) => boolean → conditional drag (e.g. only non-pinned rows)
 *   - api.getRowOrder() / api.setRowOrder() for programmatic control
 *   - Live event log for all rowDrag* events
 */
import React, { useState, useCallback, useRef } from 'react';
import { Grid, GridEventName } from '@eregister/wit-grid-react';
import type { ColumnDef, GridApi, GridReadyEvent } from '@eregister/wit-grid-react';
import { GripVertical, Shuffle, RotateCcw, List, ArrowUpDown } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface TaskRow {
	id: string;
	rank: number;
	title: string;
	priority: 'Critical' | 'High' | 'Medium' | 'Low';
	assignee: string;
	effort: number;
	locked: boolean;
}

const ASSIGNEES = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank'];
const PRIORITIES: TaskRow['priority'][] = ['Critical', 'High', 'Medium', 'Low'];

function generateTasks(count: number): TaskRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `T-${100 + i}`,
		rank: i + 1,
		title: [
			'Implement auth flow',
			'Fix memory leak in renderer',
			'Write E2E tests',
			'Migrate to TypeScript 5',
			'Optimise bundle size',
			'Add dark mode support',
			'Document public API',
			'Resolve flaky CI',
			'Profile hot path allocations',
			'Triage open issues',
			'Upgrade dependencies',
			'Design new onboarding',
			'Refactor column sizing',
			'Add keyboard shortcuts',
			'Improve error messages',
		][i % 15],
		priority: PRIORITIES[i % 4],
		assignee: ASSIGNEES[i % ASSIGNEES.length],
		effort: ((i * 3) % 8) + 1,
		locked: i === 0 || i === count - 1,
	}));
}

// ─── Priority badge ───────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
	Critical: 'bg-rose-500/10 border-rose-500/25 text-rose-400',
	High: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
	Medium: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400',
	Low: 'bg-slate-700/20 border-slate-600/30 text-slate-400',
};

const PriorityBadge = ({ value }: { value: unknown }) => {
	const v = String(value ?? '');
	return (
		<span
			className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border leading-none inline-block ${PRIORITY_COLORS[v] ?? 'text-slate-400'}`}
		>
			{v}
		</span>
	);
};

// ─── Column definitions ───────────────────────────────────────────────────────

function buildColumns(mode: 'managed' | 'unmanaged'): ColumnDef<TaskRow>[] {
	return [
		{
			field: 'rank',
			header: '#',
			width: 48,
			// Drag handle only on rank column; locked rows (first/last) are not draggable in unmanaged mode demo
			canDrag: mode === 'managed' ? () => true : ({ row }) => !row?.locked,
		},
		{ field: 'title', header: 'Task', width: 240 },
		{
			field: 'priority',
			header: 'Priority',
			width: 100,
			renderer: { kind: 'react', component: ({ value }: { value: unknown }) => <PriorityBadge value={value} /> } as any,
		},
		{ field: 'assignee', header: 'Assignee', width: 100 },
		{ field: 'effort', header: 'Effort (d)', width: 90 },
	];
}

// ─── Event log entry ─────────────────────────────────────────────────────────

interface LogEntry {
	id: number;
	time: string;
	event: string;
	detail: string;
	color: string;
}

const EVENT_COLORS: Partial<Record<string, string>> = {
	rowDragStart: 'text-indigo-400',
	rowDragMove: 'text-slate-400',
	rowDragEnd: 'text-emerald-400',
	rowDragCancelled: 'text-rose-400',
	rowOrderChanged: 'text-amber-400',
};

let logSeq = 0;

// ─── Demo component ───────────────────────────────────────────────────────────

export default function RowDragDemo() {
	const [mode, setMode] = useState<'managed' | 'unmanaged'>('managed');
	const [rows] = useState<TaskRow[]>(() => generateTasks(15));
	// Unmanaged mode: host keeps own order
	const [unmanagedOrder, setUnmanagedOrder] = useState<TaskRow[]>(() => generateTasks(15));
	const [log, setLog] = useState<LogEntry[]>([]);
	const apiRef = useRef<GridApi<TaskRow> | null>(null);

	const addLog = useCallback((event: string, detail: string) => {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
		setLog((prev) => [{ id: ++logSeq, time, event, detail, color: EVENT_COLORS[event] ?? 'text-slate-300' }, ...prev.slice(0, 49)]);
	}, []);

	const handleReady = useCallback(
		(e: GridReadyEvent<TaskRow>) => {
			apiRef.current = e.api;

			e.api.addEventListener(GridEventName.rowDragStart, (ev) => {
				const { rowId, visualIndex } = ev.payload;
				addLog('rowDragStart', `rowId=${rowId}  vi=${visualIndex}`);
			});
			e.api.addEventListener(GridEventName.rowDragMove, (ev) => {
				const { rowId, overRowId, overVisualIndex } = ev.payload;
				if (overRowId) addLog('rowDragMove', `${rowId} over ${overRowId}  vi=${overVisualIndex}`);
			});
			e.api.addEventListener(GridEventName.rowDragEnd, (ev) => {
				const { rowId, overRowId } = ev.payload;
				addLog('rowDragEnd', `rowId=${rowId}  dropped on ${overRowId ?? 'none'}`);
				// Unmanaged: host must apply the reorder
				if (mode === 'unmanaged' && overRowId) {
					setUnmanagedOrder((prev) => {
						const fromIdx = prev.findIndex((r) => r.id === rowId);
						const toIdx = prev.findIndex((r) => r.id === overRowId);
						if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
						const next = [...prev];
						const [item] = next.splice(fromIdx, 1);
						next.splice(toIdx, 0, item);
						return next;
					});
				}
			});
			e.api.addEventListener(GridEventName.rowDragCancelled, (ev) => {
				const { rowId } = ev.payload;
				addLog('rowDragCancelled', `rowId=${rowId}`);
			});
			e.api.addEventListener(GridEventName.rowOrderChanged, (ev) => {
				const { rowIds } = ev.payload;
				addLog('rowOrderChanged', `[${rowIds.slice(0, 5).join(', ')}${rowIds.length > 5 ? ' …' : ''}]`);
			});
		},
		[addLog, mode]
	);

	const handleShuffle = () => {
		const api = apiRef.current;
		if (!api) return;
		const order = api.getRowOrder();
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		api.setRowOrder(order);
		addLog('rowOrderChanged', `[shuffled via api.setRowOrder]`);
	};

	const handleReset = () => {
		const api = apiRef.current;
		if (!api) return;
		api.setRowOrder(rows.map((r) => r.id));
		addLog('rowOrderChanged', `[reset via api.setRowOrder]`);
	};

	const cols = buildColumns(mode);
	const displayRows = mode === 'unmanaged' ? unmanagedOrder : rows;

	return (
		<div className='flex h-full min-h-0 flex-1 gap-4 overflow-hidden'>
			{/* Left: grid + controls */}
			<div className='flex flex-1 min-w-0 flex-col gap-3 overflow-hidden'>
				{/* Toolbar */}
				<div className='flex shrink-0 items-center gap-3 rounded-xl border border-slate-900 bg-slate-950/60 px-4 py-2.5'>
					<span className='flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
						<GripVertical className='h-3.5 w-3.5 text-purple-400' />
						Mode
					</span>

					{(['managed', 'unmanaged'] as const).map((m) => (
						<button
							key={m}
							onClick={() => setMode(m)}
							className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
								mode === m
									? 'bg-purple-600 text-white shadow shadow-purple-600/20'
									: 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
							}`}
						>
							{m === 'managed' ? 'Managed (auto-reorder)' : 'Unmanaged (host-driven)'}
						</button>
					))}

					<div className='ml-auto flex items-center gap-2'>
						<button
							onClick={handleShuffle}
							disabled={mode !== 'managed'}
							className='flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800 transition disabled:opacity-30 disabled:cursor-not-allowed'
						>
							<Shuffle className='h-3 w-3' />
							Shuffle (api)
						</button>
						<button
							onClick={handleReset}
							disabled={mode !== 'managed'}
							className='flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800 transition disabled:opacity-30 disabled:cursor-not-allowed'
						>
							<RotateCcw className='h-3 w-3' />
							Reset
						</button>
					</div>
				</div>

				{/* Info callout */}
				<div className='shrink-0 rounded-lg border border-slate-900 bg-slate-950/40 px-3 py-2 text-[10px] text-slate-400 leading-relaxed'>
					{mode === 'managed' ? (
						<>
							<span className='font-bold text-purple-400'>Managed mode</span> — drag the{' '}
							<span className='inline-flex items-center gap-0.5 font-mono text-slate-300 bg-slate-900 px-1 rounded'>
								<GripVertical className='h-3 w-3 inline' /> #
							</span>{' '}
							handle to reorder. The grid updates row order automatically. Use{' '}
							<span className='font-mono text-indigo-400'>api.setRowOrder()</span> for programmatic control.
						</>
					) : (
						<>
							<span className='font-bold text-amber-400'>Unmanaged mode</span> — drag fires{' '}
							<span className='font-mono text-slate-300'>rowDragEnd</span>; the host applies its own reorder logic. Locked rows (first &
							last) have no drag handle.
						</>
					)}
				</div>

				{/* Grid */}
				<div className='flex-1 min-h-0 overflow-hidden rounded-xl border border-slate-900/60'>
					<Grid<TaskRow>
						key={mode}
						rowModelType='client'
						columns={cols}
						rows={displayRows}
						getRowId={(row) => row.id}
						rowDragMode={mode}
						initialState={{ defaultRowHeight: 36 }}
						onGridReady={handleReady}
					/>
				</div>
			</div>

			{/* Right: event log */}
			<div className='w-72 shrink-0 flex flex-col gap-2 overflow-hidden rounded-xl border border-slate-900 bg-slate-950/60 p-3'>
				<div className='flex items-center justify-between shrink-0'>
					<div className='flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
						<List className='h-3.5 w-3.5 text-purple-400' />
						Drag Events
					</div>
					<button
						onClick={() => setLog([])}
						className='text-[9px] text-slate-600 hover:text-slate-400 transition font-semibold uppercase tracking-wider'
					>
						Clear
					</button>
				</div>

				<div className='flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 font-mono'>
					{log.length === 0 ? (
						<div className='flex flex-col items-center justify-center h-full gap-2 text-center'>
							<ArrowUpDown className='h-6 w-6 text-slate-700' />
							<span className='text-[10px] text-slate-600 font-semibold'>Drag a row to see events</span>
						</div>
					) : (
						log.map((entry) => (
							<div key={entry.id} className='flex flex-col gap-0.5 px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-900'>
								<div className='flex items-center justify-between'>
									<span className={`text-[10px] font-bold ${entry.color}`}>{entry.event}</span>
									<span className='text-[9px] text-slate-600'>{entry.time}</span>
								</div>
								<span className='text-[9px] text-slate-500 break-all leading-relaxed'>{entry.detail}</span>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
