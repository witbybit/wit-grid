import type { GridApi, GridPresencePeer } from '@eregister/wit-grid-react';

/** How a teammate changes a field: the next value from the current one. */
export type TeammateEdit = (value: unknown) => unknown;

export interface TeammatesOptions {
	peers?: Pick<GridPresencePeer, 'id' | 'name' | 'color'>[];
	/** The fields teammates edit, and how. */
	edits: Record<string, TeammateEdit>;
	/** Pause while the visitor uses the grid, resuming after this much quiet (ms). Default 8000. */
	resumeAfter?: number;
}

const DEFAULT_PEERS = [
	{ id: 'ava', name: 'Ava', color: '#ec4899' },
	{ id: 'leo', name: 'Leo', color: '#22c55e' },
	{ id: 'mia', name: 'Mia', color: '#f59e0b' },
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Fake teammates for a demo grid: each wanders to a cell in view, "types" for a moment, then lands
 * an edit through the normal API (so sort order, formats and validation all react) and flashes it.
 * Returns a stop function.
 */
export function startTeammates<TRowData>(api: GridApi<TRowData>, options: TeammatesOptions): () => void {
	const peers: GridPresencePeer[] = (options.peers ?? DEFAULT_PEERS).map((p) => ({ ...p, cell: null }));
	const fields = Object.keys(options.edits);
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let paused = false;
	let resumeTimer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const later = (ms: number, fn: () => void) => {
		const id = setTimeout(() => {
			timers.delete(id);
			if (!stopped) fn();
		}, ms);
		timers.add(id);
	};
	const publish = () => api.setPresence(peers.map((p) => ({ ...p })));

	const pickCell = () => {
		const { startIdx, endIdx } = api.getVisibleRowRange();
		if (endIdx < startIdx) return null;
		// Keep away from the very edges so tags stay in view.
		const lo = Math.min(startIdx + 1, endIdx);
		const hi = Math.max(lo, endIdx - 1);
		const node = api.getDisplayedRowAtIndex(Math.floor(rand(lo, hi + 1)));
		if (!node?.id || !node.data) return null;
		// Prefer the editable columns in view, so the cursor is seen.
		const { colStart, colEnd } = api.getVisibleColumnRange();
		const inView = api
			.getDisplayedColumns()
			.slice(colStart, colEnd + 1)
			.map((col) => col.field)
			.filter((field) => field in options.edits);
		const choices = inView.length > 0 ? inView : fields;
		return { rowId: node.id, field: choices[Math.floor(Math.random() * choices.length)] };
	};

	const step = (peer: GridPresencePeer) => {
		if (paused) return later(1000, () => step(peer));
		const cell = pickCell();
		if (!cell) return later(1000, () => step(peer));
		peer.cell = cell;
		peer.editing = false;
		publish();
		later(rand(700, 1300), () => {
			if (paused) return later(600, () => step(peer));
			peer.editing = true;
			publish();
			later(rand(900, 1600), () => {
				peer.editing = false;
				const node = api.getRowNode(cell.rowId);
				if (!paused && node?.data) {
					const current = (node.data as Record<string, unknown>)[cell.field];
					const result = api.setCellValue(cell.rowId, cell.field, options.edits[cell.field](current));
					if (result.status === 'applied') api.flashCells([{ ...cell, color: peer.color }]);
				}
				publish();
				later(rand(1200, 2600), () => step(peer));
			});
		});
	};

	// The visitor takes over: teammates step back (cursors hidden) until the grid has been quiet.
	const container = api.getContainer();
	const onVisitor = () => {
		paused = true;
		for (const peer of peers) peer.cell = null;
		publish();
		if (resumeTimer) clearTimeout(resumeTimer);
		resumeTimer = setTimeout(() => (paused = false), options.resumeAfter ?? 8000);
	};
	container?.addEventListener('pointerdown', onVisitor);
	container?.addEventListener('keydown', onVisitor);

	peers.forEach((peer, i) => later(400 + i * 700, () => step(peer)));

	return () => {
		stopped = true;
		for (const id of timers) clearTimeout(id);
		timers.clear();
		if (resumeTimer) clearTimeout(resumeTimer);
		container?.removeEventListener('pointerdown', onVisitor);
		container?.removeEventListener('keydown', onVisitor);
		api.setPresence([]);
	};
}
