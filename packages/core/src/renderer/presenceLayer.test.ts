// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceStore } from '../presence.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { PresenceLayer, type PresenceGeometry } from './presenceLayer.js';
import type { GridScheduler } from './gridScheduler.js';

const ROWS = ['r0', 'r1', 'r2', 'r3'];
const FIELDS = ['pinned', 'a', 'b'];

function geometry(order = ROWS): PresenceGeometry {
	return {
		getVisualIndexByRowId: (id) => order.indexOf(id),
		getVisualRowCount: () => order.length,
		getColumnIndex: (field) => FIELDS.indexOf(field),
		rowTops: [0, 30, 60, 90],
		rowHeights: [30, 30, 30, 30],
		colLefts: [0, 100, 250],
		colWidths: [100, 150, 120],
	};
}

function plan(scrollLeft = 0, pinLeft = true, pinnedRows = { top: 0, bottom: 0 }): GridLayoutPlan {
	const lane = (colStart: number, colEnd: number, baseLeft: number, width: number) => ({ colStart, colEnd, baseLeft, width });
	return {
		viewport: { width: 600, clientWidth: 600, height: 300, scrollTop: 0, scrollLeft },
		rows: { pinnedTopCount: pinnedRows.top, pinnedBottomCount: pinnedRows.bottom },
		dimensions: { totalRowsHeight: 120 },
		columns: {
			lanes: {
				left: pinLeft ? lane(0, 0, 0, 100) : lane(-1, -1, 0, 0),
				center: lane(pinLeft ? 1 : 0, 2, 0, 270),
				right: lane(-1, -1, 0, 0),
			},
		},
	} as unknown as GridLayoutPlan;
}

function scheduler(): GridScheduler & { flush(): void } {
	const queue: (() => void)[] = [];
	return {
		microtask: (fn) => queue.push(fn),
		raf: (fn) => queue.push(fn),
		cancelRaf: () => {},
		idle: (fn) => queue.push(() => fn()),
		cancelIdle: () => {},
		supportsIdle: () => false,
		timeout: (fn) => queue.push(fn) as unknown as ReturnType<typeof setTimeout>,
		clearTimeout: () => {},
		flush: () => queue.splice(0).forEach((fn) => fn()),
	};
}

function setup(order = ROWS) {
	const store = new PresenceStore();
	const rows = document.createElement('div');
	const pinnedTop = document.createElement('div');
	const pinnedBottom = document.createElement('div');
	const sched = scheduler();
	let geo = geometry(order);
	const layer = new PresenceLayer(store, () => geo, rows, { top: pinnedTop, bottom: pinnedBottom }, sched);
	layer.sync(plan());
	const cursor = (i = 0) => rows.querySelectorAll<HTMLElement>('.og-presence')[i];
	return { store, rows, pinnedTop, pinnedBottom, layer, sched, cursor, reorder: (next: string[]) => (geo = geometry(next)) };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PresenceLayer', () => {
	it("draws each peer's cursor over their cell with a name tag", () => {
		const { store, cursor } = setup();
		store.set([{ id: 'ava', name: 'Ava', color: '#ec4899', cell: { rowId: 'r2', field: 'b' } }]);
		const el = cursor();
		expect(el.style.transform).toBe('translate(250px, 60px)');
		expect(el.style.width).toBe('120px');
		expect(el.style.getPropertyValue('--og-presence-color')).toBe('#ec4899');
		expect(el.querySelector('.og-presence-tag')!.textContent).toBe('Ava');
	});

	it('moves the same element when a peer moves (so it can glide) and removes departed peers', () => {
		const { store, rows, cursor } = setup();
		store.set([{ id: 'ava', name: 'Ava', color: 'red', cell: { rowId: 'r1', field: 'a' } }]);
		const el = cursor();
		store.set([{ id: 'ava', name: 'Ava', color: 'red', cell: { rowId: 'r3', field: 'a' } }]);
		expect(cursor()).toBe(el);
		expect(el.style.transform).toBe('translate(100px, 90px)');
		store.set([]);
		expect(rows.querySelectorAll('.og-presence')).toHaveLength(0);
	});

	it('follows the row when the rows reorder, and hides when the row is filtered out', () => {
		const { store, layer, cursor, reorder } = setup();
		store.set([{ id: 'leo', name: 'Leo', color: 'blue', cell: { rowId: 'r3', field: 'a' } }]);
		reorder(['r3', 'r0', 'r1', 'r2']);
		layer.sync(plan());
		expect(cursor().style.transform).toBe('translate(100px, 0px)');
		// First row: the tag flips below so the header cannot cover it.
		expect(cursor().querySelector('.og-presence-tag-below')).not.toBeNull();
		reorder(['r0', 'r1']);
		layer.sync(plan());
		expect(cursor().hidden).toBe(true);
	});

	it('keeps a pinned-lane cursor on the pinned column as the grid scrolls sideways', () => {
		const { store, layer, cursor } = setup();
		store.set([{ id: 'ava', name: 'Ava', color: 'red', cell: { rowId: 'r0', field: 'pinned' } }]);
		layer.sync(plan(400));
		expect(cursor().style.transform).toBe('translate(400px, 0px)');
	});

	it('pulses while editing and skips DOM writes when nothing changed', () => {
		const { store, layer, cursor } = setup();
		store.set([{ id: 'ava', name: 'Ava', color: 'red', cell: { rowId: 'r1', field: 'a' }, editing: true }]);
		expect(cursor().hasAttribute('data-editing')).toBe(true);
		const spy = vi.spyOn(cursor().style, 'transform', 'set');
		layer.sync(plan());
		expect(spy).not.toHaveBeenCalled();
	});

	it('flashes cells once and cleans the flash up', () => {
		const { store, rows, sched } = setup();
		store.flash([{ rowId: 'r1', field: 'b', color: 'gold' }]);
		const flash = rows.querySelector<HTMLElement>('.og-cell-flash')!;
		expect(flash.style.transform).toBe('translate(250px, 30px)');
		expect(flash.style.getPropertyValue('--og-flash-color')).toBe('gold');
		sched.flush();
		expect(rows.querySelector('.og-cell-flash')).toBeNull();
	});

	it('draws cursors on pinned rows inside the pinned bands, in their coordinates, and moves between bands', () => {
		const { store, layer, rows, pinnedTop, pinnedBottom } = setup();
		const pinned = plan(0, true, { top: 1, bottom: 1 });
		layer.sync(pinned);
		store.set([
			{ id: 'ava', name: 'Ava', color: 'red', cell: { rowId: 'r0', field: 'a' } },
			{ id: 'leo', name: 'Leo', color: 'blue', cell: { rowId: 'r3', field: 'b' } },
		]);
		const top = pinnedTop.querySelector<HTMLElement>('.og-presence-band .og-presence')!;
		expect(top.style.transform).toBe('translate(100px, 0px)');
		// The bottom band lays rows out upward from its edge: row 3 (top 90 of 120) sits at -30.
		const bottom = pinnedBottom.querySelector<HTMLElement>('.og-presence-band .og-presence')!;
		expect(bottom.style.transform).toBe('translate(250px, -30px)');
		expect(bottom.querySelector('.og-presence-tag-below')).toBeNull();
		expect(rows.querySelectorAll('.og-presence')).toHaveLength(0);

		store.set([{ id: 'ava', name: 'Ava', color: 'red', cell: { rowId: 'r1', field: 'a' } }]);
		expect(top.parentElement).toBe(rows);
		expect(top.classList.contains('og-presence-still')).toBe(true);
	});
});
