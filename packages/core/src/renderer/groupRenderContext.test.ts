// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridInitialState } from '../state/GridState.js';
import type { DomGroupRenderer, GroupRenderContext } from '../rows/hierarchyConfig.js';
import { RenderEngine } from './renderEngine.js';
import { renderGroupToggle } from './hierarchyCell.js';

interface Sale {
	id: string;
	region: string;
	product: string;
	amount: number;
}

const COLUMNS: ColumnDef<Sale>[] = [
	{ field: 'product', header: 'Product', width: 140 },
	{ field: 'region', header: 'Region', width: 120 },
	{ field: 'amount', header: 'Amount', width: 120 },
];

const SALES: Sale[] = [
	{ id: '1', region: 'EMEA', product: 'Cloud', amount: 10 },
	{ id: '2', region: 'EMEA', product: 'Hardware', amount: 20 },
	{ id: '3', region: 'APAC', product: 'Cloud', amount: 5 },
];

function manySales(): Sale[] {
	const rows: Sale[] = [];
	for (const region of ['EMEA', 'APAC']) for (let i = 0; i < 60; i++) rows.push({ id: `${region}-${i}`, region, product: 'Cloud', amount: 1 });
	return rows;
}

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
	renderer.mount(container);
	renderer.fullPaint();
	const api = store.engine.getApiRef();
	const rowAt = (index: number) => container.querySelector<HTMLElement>(`.og-rows-container .og-row[data-row-index="${index}"]`);
	const scrollTo = (top: number) => {
		container.querySelector<HTMLDivElement>('.og-scroll-viewport')!.scrollTop = top;
		store.engine.viewport.setScrollPosition(top, 0);
		renderer.fullPaint();
	};
	const destroy = () => {
		renderer.unmount();
		controller.dispose();
		store.destroy();
	};
	return { store, renderer, container, api, rowAt, scrollTo, destroy };
}

/** A DOM group renderer that records every context it is given. */
function recordingRenderer() {
	const seen: GroupRenderContext<Sale>[] = [];
	const mount = vi.fn();
	const destroy = vi.fn();
	const renderer: DomGroupRenderer<Sale> = {
		mount(container, ctx) {
			mount();
			seen.push(ctx);
			const el = document.createElement('div');
			el.className = 'custom-group';
			const draw = (c: GroupRenderContext<Sale>) => {
				el.textContent = `${c.label}|${c.expanded ? 'open' : 'closed'}|${c.isStuck ? 'stuck' : 'rest'}`;
			};
			draw(ctx);
			container.appendChild(el);
			return {
				update(next) {
					seen.push(next);
					draw(next);
				},
				destroy,
			};
		},
	};
	return { renderer, seen, mount, destroy };
}

const last = <T>(items: T[]): T => items[items.length - 1]!;

afterEach(() => {
	document.body.textContent = '';
	vi.restoreAllMocks();
});

describe("group rows with display: 'row'", () => {
	it('hands the DOM renderer a context with the hierarchy fields, and updates it in place on expand', () => {
		const rec = recordingRenderer();
		const grid = mountGrid({
			grouping: { by: ['region'], display: 'row', defaultExpanded: true, rowRenderer: { kind: 'dom', renderer: rec.renderer } },
			aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
		});
		const emea = rec.seen.find((ctx) => ctx.id === 'group:region=EMEA')!;
		expect(emea).toMatchObject({
			kind: 'group',
			isTotal: false,
			isStuck: false,
			level: 0,
			hasChildren: true,
			expanded: true,
			leafCount: 2,
			value: 'EMEA',
			formattedValue: 'EMEA',
			field: 'region',
			label: 'EMEA',
			count: '2',
			indentPx: 0,
		});
		expect(emea.aggregates).toEqual({ amount: 30 });
		expect(emea.path).toEqual([{ field: 'region', key: 'EMEA', keyString: 'EMEA' }]);
		expect(emea.api).toBe(grid.api);
		expect(grid.rowAt(0)!.querySelector('.custom-group')!.textContent).toBe('EMEA|open|rest');

		const drawn = grid.rowAt(0)!.querySelector('.custom-group');
		emea.toggle();
		grid.renderer.fullPaint();
		expect(grid.api.isExpanded('group:region=EMEA')).toBe(false);
		expect(grid.rowAt(0)!.querySelector('.custom-group')!.textContent).toBe('EMEA|closed|rest');
		expect(last(rec.seen.filter((ctx) => ctx.id === 'group:region=EMEA')).expanded).toBe(false);
		// Updated, not remounted: the group row keeps its element.
		expect(grid.rowAt(0)!.querySelector('.custom-group')).toBe(drawn);
		grid.destroy();
	});

	it('draws totals through the same renderer with isTotal', () => {
		const rec = recordingRenderer();
		const grid = mountGrid({
			grouping: {
				by: ['region'],
				display: 'row',
				defaultExpanded: true,
				totals: { grand: 'bottom' },
				rowRenderer: { kind: 'dom', renderer: rec.renderer },
			},
			aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
		});
		const total = rec.seen.find((ctx) => ctx.kind === 'total')!;
		expect(total).toMatchObject({ isTotal: true, label: 'Grand total', hasChildren: false });
		expect(total.aggregates).toEqual({ amount: 35 });
		grid.destroy();
	});

	it('expandAll / collapseAll act on the whole subtree, setExpanded on one group, selectChildren on its rows', () => {
		const rec = recordingRenderer();
		const grid = mountGrid({
			grouping: { by: ['region', 'product'], display: 'row', rowRenderer: { kind: 'dom', renderer: rec.renderer } },
			rowSelection: { mode: 'multiple' },
		});
		const emea = rec.seen.find((ctx) => ctx.id === 'group:region=EMEA')!;
		expect(grid.api.isExpanded('group:region=EMEA')).toBe(false);

		emea.expandAll();
		expect(grid.api.isExpanded('group:region=EMEA')).toBe(true);
		expect(grid.api.isExpanded('group:region=EMEA/product=Cloud')).toBe(true);
		expect(grid.api.isExpanded('group:region=EMEA/product=Hardware')).toBe(true);
		// Another group is untouched.
		expect(grid.api.isExpanded('group:region=APAC')).toBe(false);
		expect(grid.api.isExpanded('group:region=APAC/product=Cloud')).toBe(false);

		emea.selectChildren(true);
		expect(grid.api.getDescendantSelection('group:region=EMEA').state).toBe('all');
		expect(grid.api.getDescendantSelection('group:region=APAC').state).toBe('none');
		emea.selectChildren(false);
		expect(grid.api.getDescendantSelection('group:region=EMEA').state).toBe('none');

		emea.collapseAll();
		expect(grid.api.isExpanded('group:region=EMEA')).toBe(false);
		expect(grid.api.isExpanded('group:region=EMEA/product=Cloud')).toBe(false);

		emea.setExpanded(true);
		expect(grid.api.isExpanded('group:region=EMEA')).toBe(true);
		// Only that group: its subgroups stay closed.
		expect(grid.api.isExpanded('group:region=EMEA/product=Cloud')).toBe(false);
		grid.destroy();
	});

	it('draws a stuck sticky header with isStuck, updating the same renderer when it flips', () => {
		const rec = recordingRenderer();
		const grid = mountGrid(
			{
				grouping: {
					by: ['region'],
					display: 'row',
					defaultExpanded: true,
					stickyHeaders: true,
					rowRenderer: { kind: 'dom', renderer: rec.renderer },
				},
			},
			manySales(),
			300
		);
		const stickyHeader = () => grid.container.querySelector<HTMLElement>('.og-sticky-section > .og-row-group-sticky')!;
		expect(stickyHeader().querySelector('.custom-group')!.textContent).toBe('EMEA|open|rest');
		const mountsBefore = rec.mount.mock.calls.length;

		grid.scrollTo(400);
		const header = stickyHeader();
		expect(header.classList.contains('og-row-group-stuck')).toBe(true);
		expect(header.querySelector('.custom-group')!.textContent).toBe('EMEA|open|stuck');
		expect(rec.seen.some((ctx) => ctx.id === 'group:region=EMEA' && ctx.isStuck)).toBe(true);
		expect(rec.mount.mock.calls.length).toBe(mountsBefore);

		grid.scrollTo(0);
		expect(stickyHeader().querySelector('.custom-group')!.textContent).toBe('EMEA|open|rest');
		grid.destroy();
	});
});

describe('hierarchyColumn.renderer', () => {
	it('draws the hierarchy cell with a DOM renderer, updated in place, with the same context', () => {
		const rec = recordingRenderer();
		const grid = mountGrid({
			grouping: { by: ['region'], defaultExpanded: true },
			hierarchyColumn: { renderer: { kind: 'dom', renderer: rec.renderer }, label: (ctx) => `<${ctx.formattedValue}>` },
		});
		const cell = () => grid.rowAt(0)!.querySelector<HTMLElement>('[data-col-field="__hierarchy__"]')!;
		// The built-in parts are gone; the label callback still feeds ctx.label.
		expect(cell().querySelector('.og-hierarchy')).toBeNull();
		expect(cell().querySelector('.custom-group')!.textContent).toBe('<EMEA>|open|rest');
		const ctx = rec.seen.find((c) => c.id === 'group:region=EMEA')!;
		expect(ctx).toMatchObject({ kind: 'group', level: 0, count: '2', indentPx: 0 });

		// EMEA's own cell is updated in place. (Collapsing it moves the APAC group into a slot that
		// showed a leaf row's built-in cell, which mounts the renderer there once.)
		const drawnBefore = cell().querySelector('.custom-group');
		ctx.toggle();
		grid.renderer.fullPaint();
		expect(cell().querySelector('.custom-group')).toBe(drawnBefore);
		expect(cell().querySelector('.custom-group')!.textContent).toBe('<EMEA>|closed|rest');
		grid.destroy();
	});

	it('renders stuck sticky headers with isStuck and destroys renderers on teardown', () => {
		const rec = recordingRenderer();
		const grid = mountGrid(
			{
				grouping: { by: ['region'], defaultExpanded: true, stickyHeaders: true },
				hierarchyColumn: { renderer: { kind: 'dom', renderer: rec.renderer } },
			},
			manySales(),
			300
		);
		grid.scrollTo(400);
		const header = grid.container.querySelector<HTMLElement>('.og-sticky-section > .og-row-group-sticky')!;
		expect(header.querySelector('[data-col-field="__hierarchy__"] .custom-group')!.textContent).toBe('EMEA|open|stuck');
		grid.destroy();
		expect(rec.destroy).toHaveBeenCalled();
	});
});

describe('renderGroupToggle', () => {
	it('draws the built-in toggle element, handled by the grid through its data attribute', () => {
		const toggle = renderGroupToggle({ id: 'group:a', hasChildren: true, expanded: false });
		expect(toggle.className).toBe('og-hierarchy-toggle og-hierarchy-toggle-closed');
		expect(toggle.dataset.ogHierarchyToggle).toBe('group:a');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(renderGroupToggle({ id: 'row:x', hasChildren: false, expanded: false }).className).toBe(
			'og-hierarchy-toggle og-hierarchy-toggle-none'
		);
	});
});
