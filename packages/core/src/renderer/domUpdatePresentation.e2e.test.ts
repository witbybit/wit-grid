// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import type { GridRendererOptions } from '../columnDef.js';
import { RenderEngine } from './renderEngine.js';

// Contract for DOM renderers during scroll (scrollPresentation: 'update', their default): a cell
// entering during scroll is drawn with its own row's content inside the scroll frame (the
// renderer's update() in place, or mount() for a slot's first use), within the frame's DOM-update
// budget, and is final as drawn. React portals keep the no-mount-during-scroll rule.

interface Row {
	id: string;
	value: string;
	other: string;
}

async function nextFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	await Promise.resolve();
	await Promise.resolve();
}

function mountGrid(options: { capabilities?: { scrollPresentation?: 'update' | 'freeze' }; rendererOptions?: GridRendererOptions } = {}) {
	const updates: Array<{ value: string; isScrolling: boolean }> = [];
	const columns: ColumnDef<Row>[] = [
		{
			field: 'value',
			header: 'DOM',
			width: 120,
			renderer: {
				kind: 'dom',
				renderer: {
					mount(el: HTMLElement, params: { value: unknown }) {
						const span = document.createElement('span');
						span.className = 'dom-value';
						span.textContent = String(params.value);
						el.appendChild(span);
						return {
							update(next: { value: unknown; isScrolling: boolean }) {
								updates.push({ value: String(next.value), isScrolling: next.isScrolling });
								span.textContent = String(next.value);
							},
						};
					},
				},
				capabilities: options.capabilities,
			},
		},
		{ field: 'other', header: 'Text', width: 120 },
	];
	const store = new GridStore<Row>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 120,
		getRowId: (r) => r.id,
		rendererOptions: options.rendererOptions,
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: 20_000 }, (_, i) => ({ id: `r${i}`, value: `v${i}`, other: `o${i}` })),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 400,
		bottom: 400,
		width: 400,
		height: 400,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	const viewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
	return { store, controller, container, renderer, viewport, updates };
}

/** Visible DOM-renderer cells: [row id, the text its renderer is showing]. */
function visibleDomCells(container: HTMLElement): Array<[string, string]> {
	return Array.from(container.querySelectorAll<HTMLElement>('.og-row .og-cell[data-col-field="value"]'))
		.filter((cell) => cell.dataset.contentMode === 'portal')
		.map((cell) => [cell.dataset.rowId ?? '', cell.querySelector('.dom-value')?.textContent ?? '']);
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.textContent = '';
});

describe('DOM renderers during scroll (update presentation)', () => {
	it('draws cells entering during scroll with their own row, inside the scroll frame', async () => {
		// An ample budget isolates this property from budget refusals, which a loaded test run could
		// otherwise trigger (covered by the stand-in test below).
		const grid = mountGrid({ rendererOptions: { domUpdate: { maxMsPerFrame: 10_000 } } });
		await nextFrame();
		grid.renderer.resetRenderStats();
		grid.updates.length = 0;

		grid.viewport.scrollTop = 400_000; // a cold band: no snapshot, no warm state
		grid.viewport.dispatchEvent(new Event('scroll'));
		await nextFrame();

		const stats = grid.renderer.getRenderStats() as unknown as Record<string, number>;
		expect(stats.domUpdatesDuringScroll).toBeGreaterThan(0);
		expect(stats.customRendererMountsDuringScroll ?? 0).toBe(0); // no React portal mounted
		expect(grid.updates.length).toBeGreaterThan(0);
		// Drawn in the scroll frame, and each cell shows its own row's value.
		const cells = visibleDomCells(grid.container);
		expect(cells.length).toBeGreaterThan(0);
		for (const [rowId, text] of cells) expect(text).toBe(`v${rowId.slice(1)}`);

		grid.renderer.unmount();
		grid.controller.dispose();
		grid.store.destroy();
	});

	it('does not redo in-frame updates when scrolling settles', async () => {
		// An ample budget isolates this property from budget refusals, which a loaded test run could
		// otherwise trigger (covered by the stand-in test below).
		const grid = mountGrid({ rendererOptions: { domUpdate: { maxMsPerFrame: 10_000 } } });
		await nextFrame();
		grid.viewport.scrollTop = 400_000;
		grid.viewport.dispatchEvent(new Event('scroll'));
		await nextFrame();
		const afterScrollFrame = grid.updates.length;

		for (let i = 0; i < 12; i++) await nextFrame(); // scroll-end and post-scroll repair
		const afterSettle = grid.updates.length;
		// Scroll end changes only isScrolling/phase, which a renderer without scrollState ignores, and
		// the in-frame cells are already fresh — settle must not re-run update() for them.
		expect(afterSettle - afterScrollFrame).toBe(0);

		grid.renderer.unmount();
		grid.controller.dispose();
		grid.store.destroy();
	});

	it('shows a stand-in only for cells the frame budget refuses, then repairs them after scroll', async () => {
		const grid = mountGrid({ rendererOptions: { domUpdate: { maxMsPerFrame: 0 } } });
		await nextFrame();
		grid.renderer.resetRenderStats();
		grid.viewport.scrollTop = 400_000;
		grid.viewport.dispatchEvent(new Event('scroll'));
		await nextFrame();

		const stats = grid.renderer.getRenderStats() as unknown as Record<string, number>;
		expect(stats.domUpdatesDeferredDuringScroll).toBeGreaterThan(0);
		expect(stats.domUpdatesDuringScroll ?? 0).toBe(0);

		for (let i = 0; i < 12; i++) await nextFrame();
		const cells = visibleDomCells(grid.container);
		expect(cells.length).toBeGreaterThan(0);
		for (const [rowId, text] of cells) expect(text).toBe(`v${rowId.slice(1)}`);

		grid.renderer.unmount();
		grid.controller.dispose();
		grid.store.destroy();
	});

	it("keeps the no-mount-during-scroll guarantee for an explicit scrollPresentation: 'freeze'", async () => {
		const grid = mountGrid({ capabilities: { scrollPresentation: 'freeze' } });
		await nextFrame();
		grid.renderer.resetRenderStats();
		grid.updates.length = 0;
		grid.viewport.scrollTop = 400_000;
		grid.viewport.dispatchEvent(new Event('scroll'));
		await nextFrame();

		const stats = grid.renderer.getRenderStats() as unknown as Record<string, number>;
		expect(stats.domUpdatesDuringScroll ?? 0).toBe(0);
		expect(grid.updates.filter((u) => u.isScrolling)).toEqual([]);

		grid.renderer.unmount();
		grid.controller.dispose();
		grid.store.destroy();
	});

	it('rejects the update presentation on a React renderer', () => {
		expect(
			() =>
				new GridStore<Row>({
					columns: [
						{
							field: 'value',
							header: 'V',
							renderer: { kind: 'react', component: () => null, capabilities: { scrollPresentation: 'update' } },
						},
					],
					getRowId: (r) => r.id,
				})
		).toThrow(/only valid for DOM renderers/);
	});
});
