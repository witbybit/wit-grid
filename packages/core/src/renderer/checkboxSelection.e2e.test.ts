// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridInitialState } from '../state/GridState.js';
import { RenderEngine } from './renderEngine.js';

interface Order {
	id: string;
	region: string;
	country: string;
	amount: number;
}

const COLUMNS: ColumnDef<Order>[] = [
	{ field: 'id', header: 'Order', width: 120 },
	{ field: 'region', header: 'Region', width: 120 },
	{ field: 'country', header: 'Country', width: 120 },
	{ field: 'amount', header: 'Amount', width: 120 },
];

const ROW_HEIGHT = 32;
const VIEWPORT_HEIGHT = 320;

/** Two regions × two countries × `perCountry` orders, so groups nest two deep. */
function orders(perCountry: number): Order[] {
	const rows: Order[] = [];
	for (const [region, countries] of [
		['EMEA', ['DE', 'NL']],
		['APAC', ['JP', 'SG']],
	] as const) {
		for (const country of countries) {
			for (let i = 0; i < perCountry; i++) rows.push({ id: `${country}-${i}`, region, country, amount: i });
		}
	}
	return rows;
}

async function mountGrid(initial: Partial<GridInitialState<Order>>, rows: Order[]) {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
	// The checkbox column createGrid adds for rowSelection (pinned left, first).
	const checkboxColumn = { field: '__rowSelect__', header: '', width: 40, checkboxSelection: true, sortable: false } as ColumnDef<Order>;
	const store = new GridStore<Order>({
		columns: [checkboxColumn, ...COLUMNS],
		defaultRowHeight: ROW_HEIGHT,
		getRowId: (row) => row.id,
		pinnedColumns: { left: 1, right: 0 },
		...initial,
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 900,
		bottom: VIEWPORT_HEIGHT,
		width: 900,
		height: VIEWPORT_HEIGHT,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	await vi.advanceTimersByTimeAsync(200);
	const viewport = container.querySelector<HTMLDivElement>('.og-scroll-viewport')!;
	const rowEls = () =>
		[...container.querySelectorAll<HTMLElement>('.og-rows-container .og-row')].filter((row) => row.dataset.rowIndex !== undefined);
	const rowById = (id: string) => rowEls().find((row) => row.dataset.rowId === id) ?? null;
	const selectCell = (row: HTMLElement | null) => row?.querySelector<HTMLElement>('[data-col-field="__rowSelect__"]') ?? null;
	const checkboxOf = (row: HTMLElement | null) => selectCell(row)?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
	const selected = () => [...store.getSelectedRowIds()].sort();
	const settle = (ms = 400) => vi.advanceTimersByTimeAsync(ms);
	const scrollTo = async (top: number) => {
		viewport.scrollTop = top;
		viewport.dispatchEvent(new Event('scroll'));
		await vi.advanceTimersByTimeAsync(16);
	};
	const destroy = () => {
		renderer.unmount();
		controller.dispose();
		store.destroy();
	};
	return { store, renderer, container, viewport, rowEls, rowById, selectCell, checkboxOf, selected, settle, scrollTo, destroy };
}

type Grid = Awaited<ReturnType<typeof mountGrid>>;

const GROUP_EMEA = 'group:region=EMEA';
const GROUP_EMEA_DE = 'group:region=EMEA/country=DE';
const GROUPED: Partial<GridInitialState<Order>> = {
	grouping: { by: ['region', 'country'], defaultExpanded: true },
	rowSelection: { mode: 'multiple' },
};

async function clickCell(grid: Grid, row: HTMLElement, field: string, init: MouseEventInit = {}) {
	const cell = row.querySelector<HTMLElement>(`[data-col-field="${field}"]`)!;
	cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...init }));
	cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...init }));
	cell.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...init }));
	await grid.settle();
}

/** Every rendered row's checkbox matches the store, and only group rows carry group checkboxes. */
function expectCheckboxesTruthful(grid: Grid, context: string) {
	const selected = new Set(grid.store.getSelectedRowIds());
	for (const row of grid.rowEls()) {
		const id = row.dataset.rowId!;
		const checkbox = grid.checkboxOf(row);
		if (id.startsWith('group:')) {
			expect(checkbox?.classList.contains('og-group-select-checkbox'), `${context}: ${id} has a group checkbox`).toBe(true);
		} else if (id.startsWith('row:')) {
			const rowId = id.slice('row:'.length);
			expect(checkbox?.classList.contains('og-group-select-checkbox'), `${context}: ${id} has a row checkbox`).toBe(false);
			expect(checkbox?.checked, `${context}: ${id} checked`).toBe(selected.has(rowId));
		} else {
			expect(checkbox, `${context}: ${id} has no checkbox`).toBeNull();
		}
	}
}

describe('checkbox selection — end to end', () => {
	let grid: Grid | null = null;
	afterEach(() => {
		grid?.destroy();
		grid = null;
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('Ctrl+click toggles the row exactly once per click', async () => {
		grid = await mountGrid({ rowSelection: { mode: 'multiple' } }, orders(3));
		const row = grid.rowById('row:DE-1')!;
		await clickCell(grid, row, 'amount', { ctrlKey: true });
		expect(grid.selected()).toEqual(['DE-1']);
		await clickCell(grid, grid.rowById('row:DE-2')!, 'amount', { ctrlKey: true });
		expect(grid.selected()).toEqual(['DE-1', 'DE-2']);
		await clickCell(grid, grid.rowById('row:DE-1')!, 'amount', { metaKey: true });
		expect(grid.selected()).toEqual(['DE-2']);
	});

	it('a group row checkbox selects every order beneath it, nested groups included', async () => {
		grid = await mountGrid(GROUPED, orders(3));
		const emea = grid.checkboxOf(grid.rowById(GROUP_EMEA));
		expect(emea?.classList.contains('og-group-select-checkbox')).toBe(true);
		emea!.click();
		await grid.settle();
		expect(grid.selected()).toEqual(['DE-0', 'DE-1', 'DE-2', 'NL-0', 'NL-1', 'NL-2']);
		expect(grid.checkboxOf(grid.rowById(GROUP_EMEA))!.checked).toBe(true);
		expect(grid.checkboxOf(grid.rowById(GROUP_EMEA_DE))!.checked).toBe(true);
		expectCheckboxesTruthful(grid, 'after group select');

		grid.checkboxOf(grid.rowById(GROUP_EMEA))!.click();
		await grid.settle();
		expect(grid.selected()).toEqual([]);
		expectCheckboxesTruthful(grid, 'after group deselect');
	});

	it('ancestor group checkboxes go indeterminate and then checked as their orders are selected', async () => {
		grid = await mountGrid(GROUPED, orders(2));
		grid.checkboxOf(grid.rowById('row:DE-0'))!.click();
		await grid.settle();
		expect(grid.selected()).toEqual(['DE-0']);
		const emea = grid.checkboxOf(grid.rowById(GROUP_EMEA))!;
		const de = grid.checkboxOf(grid.rowById(GROUP_EMEA_DE))!;
		expect([emea.checked, emea.indeterminate]).toEqual([false, true]);
		expect([de.checked, de.indeterminate]).toEqual([false, true]);

		grid.checkboxOf(grid.rowById('row:DE-1'))!.click();
		await grid.settle();
		expect([de.checked, de.indeterminate]).toEqual([true, false]);
		expect([emea.checked, emea.indeterminate]).toEqual([false, true]);
	});

	it('selects a collapsed group’s hidden orders and reports them on expand', async () => {
		grid = await mountGrid({ ...GROUPED, grouping: { by: ['region', 'country'], defaultExpanded: false } }, orders(2));
		grid.checkboxOf(grid.rowById(GROUP_EMEA))!.click();
		await grid.settle();
		expect(grid.selected()).toEqual(['DE-0', 'DE-1', 'NL-0', 'NL-1']);
		grid.store.engine.groupingFeature.toggleExpanded(GROUP_EMEA);
		await grid.settle();
		expectCheckboxesTruthful(grid, 'after expand');
	});

	it('keeps every checkbox truthful on every scroll frame while slots recycle between orders and groups', async () => {
		grid = await mountGrid(GROUPED, orders(60));
		grid.store.selectRows(['DE-5', 'NL-30', 'JP-59', 'SG-12'], { mode: 'replace' } as never);
		await grid.settle();
		let top = 0;
		for (let frame = 0; frame < 30; frame++) {
			top += 7 * ROW_HEIGHT + 5;
			await grid.scrollTo(top);
			expectCheckboxesTruthful(grid, `frame ${frame}`);
		}
		await grid.settle(1000);
		expectCheckboxesTruthful(grid, 'at rest');
	});

	it('a click on a recycled checkbox acts on the row it shows now, never the row it showed before', async () => {
		grid = await mountGrid(GROUPED, orders(60));
		let top = 0;
		for (let frame = 0; frame < 12; frame++) {
			top += 9 * ROW_HEIGHT;
			await grid.scrollTo(top);
		}
		// Mid-gesture, before any post-scroll repair: click whatever is on screen.
		const dataRow = grid.rowEls().find((row) => row.dataset.rowId?.startsWith('row:'))!;
		const rowId = dataRow.dataset.rowId!.slice('row:'.length);
		grid.checkboxOf(dataRow)!.click();
		await grid.settle();
		expect(grid.selected()).toEqual([rowId]);

		const groupRow = grid.rowEls().find((row) => row.dataset.rowId?.startsWith('group:') && row.dataset.rowId.includes('country='))!;
		const descendants = [...grid.store.engine.groupingFeature.getDescendantRowIds(groupRow.dataset.rowId!)];
		grid.checkboxOf(groupRow)!.click();
		await grid.settle();
		expect(grid.selected()).toEqual([...new Set([rowId, ...descendants])].sort());
	});

	it('shows no group checkboxes in single-selection mode', async () => {
		grid = await mountGrid({ ...GROUPED, rowSelection: { mode: 'single' } }, orders(2));
		expect(grid.checkboxOf(grid.rowById(GROUP_EMEA))).toBeNull();
		expect(grid.checkboxOf(grid.rowById('row:DE-0'))).not.toBeNull();
	});
});
