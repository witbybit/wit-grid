import { describe, expect, it, vi } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { GeometryModel } from './GeometryModel.js';

type Row = { id: string; name: string; price: number };

function createStore(rows: Row[], extra: Record<string, unknown> = {}) {
	const store = new GridStore<Row>({
		columns: [
			{ field: 'name', header: 'Name' },
			{ field: 'price', header: 'Price' },
		],
		defaultRowHeight: 40,
		getRowId: (row) => row.id,
		...extra,
	});
	const controller = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), {
		rows,
		columns: store.getState().columns,
	});
	return { store, controller };
}

const heightsOf = (store: GridStore<Row>, count: number) => Array.from(store.engine.geometry.rowHeights).slice(0, count);
const topsOf = (store: GridStore<Row>, count: number) => Array.from(store.engine.geometry.rowTops).slice(0, count);

describe('GeometryModel.syncRows', () => {
	it('writes only changed rows and recomputes prefix sums from the first changed index', () => {
		const geometry = new GeometryModel();
		const heights = [10, 20, 30, 40];
		expect(geometry.syncRows(4, (i) => heights[i])).toBe(0);
		expect(Array.from(geometry.rowTops)).toEqual([0, 10, 30, 60]);

		// Unchanged sync is a no-op.
		expect(geometry.syncRows(4, (i) => heights[i])).toBe(-1);

		heights[2] = 5;
		expect(geometry.syncRows(4, (i) => heights[i])).toBe(2);
		expect(Array.from(geometry.rowTops)).toEqual([0, 10, 30, 35]);
		expect(geometry.getTotalHeight(40)).toBe(75);
	});

	it('keeps the valid prefix when the typed arrays grow, and handles truncation', () => {
		const geometry = new GeometryModel();
		geometry.syncRows(2, () => 10);
		const reads: number[] = [];
		expect(
			geometry.syncRows(
				5,
				(i) => {
					reads.push(i);
					return 10;
				},
				2
			)
		).toBe(2);
		expect(reads).toEqual([2, 3, 4]);
		expect(Array.from(geometry.rowTops).slice(0, 5)).toEqual([0, 10, 20, 30, 40]);

		expect(geometry.syncRows(3, () => 10)).toBe(3);
		expect(geometry.getRowCount()).toBe(3);
		expect(geometry.getTotalHeight(40)).toBe(30);
	});
});

describe('row geometry sync', () => {
	it('applies setRowHeight to geometry immediately even though visual rows baked their height at flatten time', () => {
		const { store, controller } = createStore([
			{ id: '1', name: 'c', price: 3 },
			{ id: '2', name: 'a', price: 1 },
			{ id: '3', name: 'b', price: 2 },
		]);
		store.setRowHeight('2', 90);
		expect(heightsOf(store, 3)).toEqual([40, 90, 40]);
		expect(topsOf(store, 3)).toEqual([0, 40, 130]);
		controller.dispose();
		store.destroy();
	});

	it('syncs geometry once per row resize commit (no second rebuild)', () => {
		const { store, controller } = createStore([
			{ id: '1', name: 'c', price: 3 },
			{ id: '2', name: 'a', price: 1 },
		]);
		const syncs = vi.spyOn(store.engine.geometry, 'syncRows');
		store.setRowHeight('1', 70);
		expect(syncs).toHaveBeenCalledTimes(1);
		controller.dispose();
		store.destroy();
	});

	it('keeps variable row heights attached to their rows across a live sort-key reorder', () => {
		const { store, controller } = createStore([
			{ id: '1', name: 'c', price: 3 },
			{ id: '2', name: 'a', price: 1 },
			{ id: '3', name: 'b', price: 2 },
		]);
		store.setRowHeight('2', 90);
		store.setSortModel([{ colId: 'price', sort: 'asc' }]);
		expect([0, 1, 2].map((i) => store.getVisualRow(i)?.id)).toEqual(['row:2', 'row:3', 'row:1']);
		expect(heightsOf(store, 3)).toEqual([90, 40, 40]);

		const versionBefore = store.getState().globalVersion;
		store.setCellValue('2', 'price', 10);
		store.flushCellUpdatesSync();
		// Live relocation: same count and no globalVersion bump, yet heights must follow rows.
		expect(store.getState().globalVersion).toBe(versionBefore);
		expect([0, 1, 2].map((i) => store.getVisualRow(i)?.id)).toEqual(['row:3', 'row:1', 'row:2']);
		expect(heightsOf(store, 3)).toEqual([40, 40, 90]);
		expect(topsOf(store, 3)).toEqual([0, 40, 80]);
		controller.dispose();
		store.destroy();
	});
});

describe('scroll anchoring', () => {
	const rows = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, price: i }));

	it('records a scroll correction only for height changes strictly above the first visible row', () => {
		const { store, controller } = createStore(rows);
		store.setViewportSize(300, 200);
		store.setScrollPosition(400, 0, 1000); // first visible row: index 10

		store.setRowHeight('r3', 100); // above: +60
		expect(store.engine.viewport.consumeScrollAnchor(400)).toBe(60);

		store.setRowHeight('r10', 100); // the anchor row itself: its top does not move
		expect(store.engine.viewport.consumeScrollAnchor(400)).toBe(0);

		store.setRowHeight('r20', 100); // below the anchor
		expect(store.engine.viewport.consumeScrollAnchor(400)).toBe(0);

		// A correction recorded at another scrollTop is stale once the user scrolls.
		store.setRowHeight('r4', 80);
		expect(store.engine.viewport.consumeScrollAnchor(420)).toBe(0);
		controller.dispose();
		store.destroy();
	});

	it('does not anchor at scrollTop 0', () => {
		const { store, controller } = createStore(rows);
		store.setViewportSize(300, 200);
		store.setRowHeight('r0', 100);
		expect(store.engine.viewport.consumeScrollAnchor(0)).toBe(0);
		controller.dispose();
		store.destroy();
	});

	it('does not anchor on structural changes (sort)', () => {
		const { store, controller } = createStore(rows);
		store.setViewportSize(300, 200);
		store.setScrollPosition(400, 0, 1000);
		store.setRowHeight('r49', 100);
		store.engine.viewport.consumeScrollAnchor(400);
		store.setSortModel([{ colId: 'price', sort: 'desc' }]);
		expect(store.engine.viewport.consumeScrollAnchor(400)).toBe(0);
		controller.dispose();
		store.destroy();
	});
});

describe('viewport range queries', () => {
	const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, price: i }));

	it('keeps adaptive overscan range queries pure and shrinks by elapsed time, not call count', () => {
		const { store, controller } = createStore(rows, { overscanAdaptive: true, rowOverscanPx: 480 });
		store.setViewportSize(300, 200);
		store.setScrollPosition(100, 0, 1000);
		store.setScrollPosition(250, 0, 1100); // vy = 1.5 px/ms
		const fast = store.getVisibleRowRange();
		expect(fast).toEqual({ startIdx: 0, endIdx: 48 });

		// Slow scroll: the expansion wants to shrink but is held; many queries must not advance it.
		store.setScrollPosition(251, 0, 1110);
		for (let i = 0; i < 50; i++) store.getVisibleRowRange();
		expect(store.getVisibleRowRange().endIdx).toBe(48);

		// Still within 200ms of the first shrink request: held.
		store.setScrollPosition(252, 0, 1250);
		expect(store.getVisibleRowRange().endIdx).toBe(48);

		// 200ms after the shrink began: collapses to the base overscan.
		store.setScrollPosition(253, 0, 1310);
		expect(store.getVisibleRowRange().endIdx).toBe(Math.floor((253 + 200 + 480) / 40));
		controller.dispose();
		store.destroy();
	});

	it('bounds the column range by displayed columns, not all state columns', () => {
		const store = new GridStore<Row>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'price', header: 'Price', width: 100 },
				{ field: 'id', header: 'Id', width: 100, hide: true },
			],
			defaultRowHeight: 40,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'a', price: 1 }],
			columns: store.getState().columns,
		});
		store.setViewportSize(1000, 200);
		expect(store.getVisibleColumnRange().colEnd).toBe(1);
		controller.dispose();
		store.destroy();
	});

	it('adds pixel-based leading-edge column overscan when colOverscanPx is set, keeping the count-based default otherwise', () => {
		const columns = Array.from({ length: 40 }, (_, i) => ({ field: `c${i}`, header: `C${i}`, width: 50 }));
		const make = (extra: Record<string, unknown>) => {
			const store = new GridStore<Record<string, unknown>>({ columns, defaultRowHeight: 40, colBuffer: 2, ...extra });
			new ClientRowModelController<Record<string, unknown>>(store.getClientRowModelRuntime(), { rows: [{ id: '1' }], columns });
			store.setViewportSize(500, 200);
			return store;
		};
		const countOnly = make({});
		// Visible 0..10 (500px / 50px) + 2 buffered columns.
		expect(countOnly.getVisibleColumnRange()).toEqual({ colStart: 0, colEnd: 12, total: 40 });

		const withPx = make({ colOverscanPx: 250 });
		// Right edge: max(2 columns, 250px = 5 columns) past the visible edge.
		expect(withPx.getVisibleColumnRange()).toEqual({ colStart: 0, colEnd: 15, total: 40 });
		// Scrolling left moves the pixel buffer to the left edge; the right keeps colBuffer.
		withPx.setScrollPosition(0, 1000, 1000);
		withPx.setScrollPosition(0, 900, 1100);
		expect(withPx.getVisibleColumnRange()).toEqual({ colStart: 13, colEnd: 30, total: 40 });
		countOnly.destroy();
		withPx.destroy();
	});
});
