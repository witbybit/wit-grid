// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridInitialState } from '../state/GridState.js';
import { RenderEngine } from './renderEngine.js';
import { writeHierarchyCell, type HierarchyCellModel } from './hierarchyCell.js';

interface Sale {
	id: string;
	region: string;
	product: string;
	amount: number;
	parentId?: string;
}

const COLUMNS: ColumnDef<Sale>[] = [
	{ field: 'product', header: 'Product', width: 140 },
	{ field: 'region', header: 'Region', width: 120 },
	{ field: 'amount', header: 'Amount', width: 120, valueFormatter: ({ value }) => (value == null ? '' : `$${value}`) },
];

const SALES: Sale[] = [
	{ id: '1', region: 'EMEA', product: 'Cloud', amount: 10 },
	{ id: '2', region: 'EMEA', product: 'Hardware', amount: 20 },
	{ id: '3', region: 'APAC', product: 'Cloud', amount: 5 },
];

function mountGrid(initial: Partial<GridInitialState<Sale>>, rows: Sale[] = SALES, height = 400) {
	const store = new GridStore<Sale>({ columns: COLUMNS, defaultRowHeight: 40, getRowId: (row) => row.id, ...initial });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 800,
		bottom: height,
		width: 800,
		height,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	const mountRowContent = vi.fn();
	renderer.portalMountManager.onMountRowContent = mountRowContent;
	renderer.portalMountManager.onUnmountRowContent = vi.fn();
	renderer.mount(container);
	renderer.fullPaint();
	const rowAt = (index: number) => container.querySelector<HTMLElement>(`.og-rows-container .og-row[data-row-index="${index}"]`);
	const cellOf = (row: HTMLElement | null, field: string) => row?.querySelector<HTMLElement>(`[data-col-field="${field}"]`) ?? null;
	const destroy = () => {
		renderer.unmount();
		controller.dispose();
		store.destroy();
	};
	return { store, renderer, container, mountRowContent, rowAt, cellOf, destroy };
}

afterEach(() => {
	document.body.textContent = '';
	vi.restoreAllMocks();
});

describe('group and total rows as cell rows', () => {
	it('draws group rows with a hierarchy cell and aggregates under their columns, without row portals', () => {
		const grid = mountGrid({
			grouping: { by: ['region'], defaultExpanded: true, totals: { groups: 'bottom' } },
			aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
		});
		const group = grid.rowAt(0)!;
		expect(group.classList.contains('og-row-group')).toBe(true);
		expect(grid.cellOf(group, '__hierarchy__')?.querySelector('.og-hierarchy-label')?.textContent).toBe('EMEA');
		expect(grid.cellOf(group, '__hierarchy__')?.querySelector('.og-hierarchy-count')?.textContent).toBe('2');
		// The aggregate goes through the column's own formatter.
		expect(grid.cellOf(group, 'amount')?.textContent).toBe('$30');
		expect(grid.cellOf(group, 'product')?.textContent).toBe('');

		const total = grid.rowAt(3)!;
		expect(total.classList.contains('og-row-total')).toBe(true);
		expect(grid.cellOf(total, '__hierarchy__')?.querySelector('.og-hierarchy-label')?.textContent).toBe('Total');
		expect(grid.cellOf(total, 'amount')?.textContent).toBe('$30');

		// No full-width row content is handed to the adapter for group or total rows.
		const kinds = grid.mountRowContent.mock.calls.map(([mount]) => mount.visualRow.kind);
		expect(kinds).not.toContain('group');
		expect(kinds).not.toContain('total');
		grid.destroy();
	});

	it('puts the hierarchy cell in the pinned-left lane, so it stays put during horizontal scroll', () => {
		const grid = mountGrid({ grouping: { by: ['region'] } });
		const hierarchyCell = grid.cellOf(grid.rowAt(0), '__hierarchy__')!;
		expect(hierarchyCell.classList.contains('og-cell-pinned-left')).toBe(true);
		expect(hierarchyCell.closest('.og-row-pinned-left, [class*="pin-left"], [class*="pinned-left"]')).not.toBeNull();
		grid.destroy();
	});

	it('indents leaf rows under their group and expands / collapses from the toggle', () => {
		const grid = mountGrid({ grouping: { by: ['region'] } });
		const toggle = grid.cellOf(grid.rowAt(0), '__hierarchy__')!.querySelector<HTMLElement>('.og-hierarchy-toggle')!;
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		toggle.click();
		grid.renderer.fullPaint();
		expect(grid.store.isExpanded('group:region=EMEA')).toBe(true);
		const leaf = grid.cellOf(grid.rowAt(1), '__hierarchy__')!;
		expect(leaf.querySelector<HTMLElement>('.og-hierarchy')!.style.paddingLeft).toBe('16px');
		expect(leaf.querySelector('.og-hierarchy-toggle')!.classList.contains('og-hierarchy-toggle-none')).toBe(true);
		expect(grid.cellOf(grid.rowAt(0), '__hierarchy__')!.querySelector('.og-hierarchy-toggle')!.getAttribute('aria-expanded')).toBe('true');
		grid.destroy();
	});

	it('repaints group cells when their aggregates change', () => {
		const grid = mountGrid({
			grouping: { by: ['region'], defaultExpanded: true },
			aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
		});
		grid.store.applyTransaction({ update: [{ id: '1', region: 'EMEA', product: 'Cloud', amount: 100 }] });
		grid.renderer.fullPaint();
		expect(grid.cellOf(grid.rowAt(0), 'amount')?.textContent).toBe('$120');
		grid.destroy();
	});

	it('never leaves a group aggregate behind as the placeholder text of a renderer cell', () => {
		const store = new GridStore<Sale>({
			columns: [
				{ field: 'region', header: 'Region', width: 120 },
				{
					field: 'amount',
					header: 'Amount',
					width: 120,
					renderer: {
						kind: 'dom',
						renderer: {
							mount: (container, params) => {
								container.textContent = `<${String(params.value)}>`;
								return { update: (next) => void (container.textContent = `<${String(next.value)}>`) };
							},
						},
					},
				},
			],
			defaultRowHeight: 40,
			getRowId: (row) => row.id,
			grouping: { by: ['region'] },
			aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: SALES, columns: store.getState().columns });
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 800,
			bottom: 400,
			width: 800,
			height: 400,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.fullPaint();
		const amountText = (index: number) =>
			container.querySelector(`.og-row[data-row-index="${index}"] [data-col-field="amount"] .og-cell-content`)?.textContent ?? '';
		// Row 1 is the collapsed APAC group: its aggregate is the cell text.
		expect(amountText(1)).toBe('5');

		// Expanding EMEA puts a data row where APAC's group row was.
		store.setExpanded('group:region=EMEA', true);
		renderer.fullPaint();
		expect(container.querySelector('.og-row[data-row-index="1"]')?.classList.contains('og-row-group')).toBe(false);
		expect(amountText(1)).not.toContain('5');
		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it("keeps full-width group rows with display: 'row'", () => {
		const grid = mountGrid({ grouping: { by: ['region'], display: 'row' } });
		expect(grid.store.getState().columns.some((column) => column.field === '__hierarchy__')).toBe(false);
		expect(grid.mountRowContent.mock.calls.map(([mount]) => mount.visualRow.kind)).toContain('group');
		grid.destroy();
	});

	it('selects every row of a group from the hierarchy checkbox', () => {
		const grid = mountGrid({ grouping: { by: ['region'] }, hierarchyColumn: { show: { checkbox: true } }, rowSelection: { mode: 'multiple' } });
		const checkbox = grid.cellOf(grid.rowAt(0), '__hierarchy__')!.querySelector<HTMLInputElement>('.og-hierarchy-checkbox')!;
		checkbox.click();
		expect(grid.store.getSelectedRowIds().sort()).toEqual(['1', '2']);
		grid.renderer.fullPaint();
		expect(grid.cellOf(grid.rowAt(0), '__hierarchy__')!.querySelector<HTMLInputElement>('.og-hierarchy-checkbox')!.checked).toBe(true);
		grid.destroy();
	});
});

describe('sticky group headers as cell rows', () => {
	it('draws the nested sticky stack with the same cells as body group rows, no row portals', () => {
		const rows: Sale[] = [];
		for (const region of ['EMEA', 'APAC']) {
			for (const product of ['Cloud', 'Hardware']) {
				for (let i = 0; i < 20; i++) rows.push({ id: `${region}-${product}-${i}`, region, product, amount: 1 });
			}
		}
		const grid = mountGrid(
			{
				grouping: { by: ['region', 'product'], defaultExpanded: true, stickyHeaders: true },
				aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
			},
			rows,
			300
		);
		const viewport = grid.container.querySelector<HTMLDivElement>('.og-scroll-viewport')!;
		// Rows: 0 EMEA, 1 EMEA/Cloud, 2..21 its rows — scroll into the middle of EMEA/Cloud.
		viewport.scrollTop = 400;
		grid.store.engine.viewport.setScrollPosition(400, 0);
		grid.renderer.fullPaint();

		const layer = grid.container.querySelector('.og-layer-sticky-groups')!;
		const labels = [...layer.querySelectorAll('.og-hierarchy-label')].map((label) => label.textContent);
		expect(labels).toEqual(['EMEA', 'Cloud']);
		const emea = layer.querySelector('[data-row-id="group:region=EMEA"]')!;
		expect(emea.querySelector('.og-row-pin-left .og-cell-hierarchy')).not.toBeNull();
		expect(emea.querySelector('[data-col-field="amount"]')?.textContent).toBe('$40');
		expect(grid.mountRowContent.mock.calls.some(([mount]) => mount.rowKey.startsWith('sticky-group:'))).toBe(false);

		// Scrolling on into EMEA/Hardware replaces the inner header, keeps the outer one.
		viewport.scrollTop = 1300;
		grid.store.engine.viewport.setScrollPosition(1300, 0);
		grid.renderer.fullPaint();
		expect([...layer.querySelectorAll('.og-hierarchy-label')].map((label) => label.textContent)).toEqual(['EMEA', 'Hardware']);
		grid.destroy();
	});
});

describe('tree rows in the hierarchy column', () => {
	it('shows treeData.column through its formatter, indented by level, toggle only on parents', () => {
		const tree: Sale[] = [
			{ id: 'root', region: 'All', product: 'Everything', amount: 0 },
			{ id: 'child', region: 'EMEA', product: 'Cloud', amount: 5, parentId: 'root' },
		];
		const grid = mountGrid({ treeData: { getParentId: (row) => row.parentId, column: 'product', defaultExpanded: true } }, tree);
		const root = grid.cellOf(grid.rowAt(0), '__hierarchy__')!;
		const child = grid.cellOf(grid.rowAt(1), '__hierarchy__')!;
		expect(root.querySelector('.og-hierarchy-label')?.textContent).toBe('Everything');
		expect(child.querySelector('.og-hierarchy-label')?.textContent).toBe('Cloud');
		expect(child.querySelector<HTMLElement>('.og-hierarchy')!.style.paddingLeft).toBe('16px');
		expect(root.querySelector('.og-hierarchy-toggle')!.getAttribute('aria-expanded')).toBe('true');
		expect(child.querySelector('.og-hierarchy-toggle')!.classList.contains('og-hierarchy-toggle-none')).toBe(true);
		grid.destroy();
	});

	it('labels every rendered row with its own value after rows are recycled by scrolling', () => {
		const rows: Sale[] = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, region: 'EMEA', product: `P${i}`, amount: i }));
		const grid = mountGrid({ treeData: { getParentId: () => undefined, column: 'product' } }, rows, 300);
		const viewport = grid.container.querySelector<HTMLDivElement>('.og-scroll-viewport')!;
		for (const top of [1200, 4000, 800]) {
			viewport.scrollTop = top;
			grid.store.engine.viewport.setScrollPosition(top, 0);
			grid.renderer.fullPaint();
			for (const row of grid.container.querySelectorAll<HTMLElement>('.og-rows-container .og-row[data-row-index]')) {
				const index = Number(row.dataset.rowIndex);
				expect(grid.cellOf(row, '__hierarchy__')?.querySelector('.og-hierarchy-label')?.textContent).toBe(`P${index}`);
			}
		}
		grid.destroy();
	});
});

describe('writeHierarchyCell', () => {
	const base: HierarchyCellModel = { targetId: 'group:a', indentPx: 0, toggle: 'closed', checkbox: null, label: 'A', count: '3', cellClass: '' };

	it('reuses its parts and writes only what changed', () => {
		const content = document.createElement('div');
		const parts = writeHierarchyCell(content, null, base);
		const label = parts.label;
		const setText = vi.spyOn(label, 'textContent', 'set');
		const again = writeHierarchyCell(content, parts, { ...base, toggle: 'open' });
		expect(again).toBe(parts);
		expect(again.label).toBe(label);
		expect(setText).not.toHaveBeenCalled();
		expect(parts.toggle.getAttribute('aria-expanded')).toBe('true');
	});

	it('rebuilds when something else replaced the content', () => {
		const content = document.createElement('div');
		const parts = writeHierarchyCell(content, null, base);
		content.textContent = 'plain text';
		const rebuilt = writeHierarchyCell(content, parts, base);
		expect(rebuilt).not.toBe(parts);
		expect(content.querySelector('.og-hierarchy-label')?.textContent).toBe('A');
	});
});

describe('full-width rows during scroll', () => {
	it('mounts detail rows entering the viewport in the scroll frame, bounded per frame', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb));
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const rows: Sale[] = Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, region: 'EMEA', product: `P${i}`, amount: i }));
		const store = new GridStore<Sale>({
			columns: COLUMNS,
			defaultRowHeight: 40,
			getRowId: (row) => row.id,
			detail: { height: 40 },
			expansion: { rows: {}, details: Object.fromEntries(rows.map((row) => [row.id, true])) },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);
		const renderer = new RenderEngine(store.engine, store);
		const mounts = vi.fn();
		renderer.portalMountManager.onMountRowContent = mounts;
		renderer.portalMountManager.onUnmountRowContent = vi.fn();
		renderer.mount(container);
		mounts.mockClear();

		const viewport = container.querySelector<HTMLDivElement>('.og-scroll-viewport')!;
		viewport.scrollTop = 1600;
		viewport.dispatchEvent(new Event('scroll'));
		callbacks.shift()!(0);

		const detailMounts = mounts.mock.calls.filter(([mount]) => mount.visualRow.kind === 'detail');
		expect(detailMounts.length).toBeGreaterThan(0);
		expect(detailMounts.length).toBeLessThanOrEqual(4);
		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});

describe('full-width row renderer specs', () => {
	it('mounts a DOM detail renderer directly (no adapter), with the master data, and destroys it on collapse', () => {
		const destroy = vi.fn();
		const seen: Array<string | undefined> = [];
		const grid = mountGrid({
			detail: {
				height: 60,
				renderer: {
					kind: 'dom',
					renderer: {
						mount: (container, params) => {
							seen.push((params.masterData as Sale | undefined)?.product);
							container.textContent = `detail of ${(params.masterData as Sale).product}`;
							return { destroy };
						},
					},
				},
			},
			expansion: { rows: {}, details: { '1': true } },
		});
		const detailRow = grid.container.querySelector('.og-row-detail, .og-row[data-row-id^="detail:"]');
		expect(grid.container.textContent).toContain('detail of Cloud');
		expect(seen).toEqual(['Cloud']);
		expect(grid.mountRowContent.mock.calls.some(([mount]) => mount.visualRow.kind === 'detail')).toBe(false);
		void detailRow;

		grid.store.setDetailOpen('1', false);
		grid.renderer.fullPaint();
		expect(destroy).toHaveBeenCalledOnce();
		expect(grid.container.textContent).not.toContain('detail of Cloud');
		grid.destroy();
	});

	it("draws display: 'row' group rows with grouping.rowRenderer and updates them when aggregates change", () => {
		const update = vi.fn();
		const grid = mountGrid({
			grouping: {
				by: ['region'],
				display: 'row',
				rowRenderer: {
					kind: 'dom',
					renderer: {
						mount: (container, params) => {
							const row = params.row as Extract<typeof params.row, { kind: 'group' }>;
							container.textContent = `${String(row.key)}: ${String(row.aggregates.amount)}`;
							return {
								update: (next) => {
									update();
									const nextRow = next.row as typeof row;
									container.textContent = `${String(nextRow.key)}: ${String(nextRow.aggregates.amount)}`;
								},
							};
						},
					},
				},
			},
			aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
		});
		expect(grid.container.textContent).toContain('EMEA: 30');
		grid.store.applyTransaction({ update: [{ id: '1', region: 'EMEA', product: 'Cloud', amount: 110 }] });
		grid.renderer.fullPaint();
		expect(update).toHaveBeenCalled();
		expect(grid.container.textContent).toContain('EMEA: 130');
		expect(grid.mountRowContent.mock.calls.some(([mount]) => mount.visualRow.kind === 'group')).toBe(false);
		grid.destroy();
	});

	it('hands the React spec to the adapter with the mount', () => {
		const component = () => null;
		const grid = mountGrid({ detail: { renderer: { kind: 'react', component } }, expansion: { rows: {}, details: { '1': true } } });
		const detailMount = grid.mountRowContent.mock.calls.find(([mount]) => mount.visualRow.kind === 'detail')?.[0];
		expect(detailMount?.renderer).toEqual({ kind: 'react', component });
		grid.destroy();
	});
});

describe("detail.height: 'auto'", () => {
	it('measures the content and makes the row follow it', () => {
		let deliver: ((entries: Array<{ target: Element; borderBoxSize: Array<{ blockSize: number }> }>) => void) | null = null;
		const observed: Element[] = [];
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: typeof deliver) {
					deliver = callback;
				}
				observe(target: Element) {
					observed.push(target);
				}
				unobserve() {}
				disconnect() {}
			}
		);
		const grid = mountGrid({
			detail: { height: 'auto', estimatedHeight: 90 },
			expansion: { rows: {}, details: { '1': true } },
		});
		const detailIndex = grid.store.getVisualIndexById?.('detail:1') ?? 1;
		expect(grid.store.engine.geometry.getRowHeight(detailIndex, 40)).toBe(90);
		expect(observed).toHaveLength(1);

		deliver!([{ target: observed[0], borderBoxSize: [{ blockSize: 137 }] }]);
		expect(grid.store.getState().rowHeights['detail:1']).toBe(137);
		expect(grid.store.engine.geometry.getRowHeight(detailIndex, 40)).toBe(137);
		grid.destroy();
		vi.unstubAllGlobals();
	});
});
