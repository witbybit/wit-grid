// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { RowSlot } from './rowSlot.js';
import { CellSlot } from './cellSlot.js';
import { reconcileCellTopologyForScroll, reconcileTopology } from './rowCellBindingLanes.js';
import { compileColumnTopology } from './columnTopology.js';
import { CELL_SLOT_RETENTION_CONFIG } from './cellSlotRetention.js';

type Row = Record<string, string>;
const COLS = 200;

function mountWide(colCount = COLS) {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
	const columns: ColumnDef<Row>[] = Array.from({ length: colCount }, (_, c) => ({ field: `c${c}`, header: `Col ${c}`, width: 100 }));
	const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 100, getRowId: (row) => row.id });
	const rows = Array.from({ length: 6 }, (_, r) => {
		const row: Row = { id: `r${r}` };
		for (let c = 0; c < colCount; c++) row[`c${c}`] = `R${r}C${c}`;
		return row;
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
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
	} as DOMRect);
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer };
}

describe('horizontal scroll reuses cell and header elements', () => {
	it('header cells are reused across columns and always show their own column', () => {
		// 60 columns, 800 px wide: the header window moves by several columns per step.
		const grid = mountWide(60);
		const viewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		const seenCells = new Map<Element, Set<string>>();
		const seenHeaders = new Map<Element, Set<string>>();
		const recordCells = () => {
			for (const cell of grid.container.querySelectorAll<HTMLElement>('.og-rows-container .og-cell[data-col-field]')) {
				const set = seenCells.get(cell) ?? new Set();
				set.add(cell.dataset.colField!);
				seenCells.set(cell, set);
				// The cell shows exactly its own row and column's value.
				expect(cell.textContent).toBe(`${cell.dataset.rowId!.toUpperCase()}${cell.dataset.colField!.toUpperCase()}`);
			}
		};
		const recordHeaders = () => {
			for (const header of grid.container.querySelectorAll<HTMLElement>('.og-header-cell[data-col-field]')) {
				const set = seenHeaders.get(header) ?? new Set();
				set.add(header.dataset.colField!);
				seenHeaders.set(header, set);
				expect(header.textContent).toBe(`Col ${header.dataset.colField!.slice(1)}`);
			}
		};
		for (const left of [0, 1500, 3000, 4500, 3000, 0]) {
			viewport.scrollLeft = left;
			grid.store.engine.viewport.setScrollPosition(0, left);
			// Scroll frame: cells go through the scroll-time retention path (where recycling happens).
			viewport.dispatchEvent(new Event('scroll'));
			recordCells();
			grid.renderer.fullPaint();
			recordHeaders();
		}
		// Elements served more than one column: they were recycled, not rebuilt.
		expect([...seenHeaders.values()].some((cols) => cols.size > 1)).toBe(true);
		grid.renderer.unmount();
		grid.controller.dispose();
		grid.store.destroy();
		vi.unstubAllGlobals();
	}, 20_000); // full paints over a wide grid in jsdom: slow under full-suite load
});

describe('scroll-time cell retention recycles evicted plain cells', () => {
	function plan(cols: ColumnDef<unknown>[]) {
		const colLefts = cols.map((_, i) => i * 100);
		return {
			displayedColumns: cols,
			colLefts,
			colWidths: cols.map(() => 100),
			totalWidth: cols.length * 100,
			pinLeftCount: 0,
			pinRightCount: 0,
			pinLeftWidth: 0,
			pinRightWidth: 0,
			pinRightBaseLeft: cols.length * 100,
			columnPlans: cols.map(() => ({ isCustom: false, mode: 'primitive' })),
		} as any;
	}

	it('hands an evicted text cell to the next entering column, never a portal cell', () => {
		const cols = Array.from({ length: COLS }, (_, c) => ({ field: `c${c}`, instanceId: `c${c}` }) as unknown as ColumnDef<unknown>);
		const topology = compileColumnTopology(plan(cols));
		const slot = new RowSlot<unknown>('slot-1', document.createElement('div'));
		const initCell = (el: HTMLDivElement) => void CellSlot.fromElement(el);
		const release = (cell: CellSlot<unknown>) => cell.releaseCold();
		reconcileTopology(slot, topology, null, 0, 10, null, cols, initCell, release);
		const bind = () =>
			slot.centerCells.forEach((cell, i) =>
				cell.update(
					slot.centerColStart + i,
					`c${slot.centerColStart + i}`,
					0,
					'r0',
					0,
					-1,
					100,
					'og-cell',
					'text',
					undefined,
					`v${slot.centerColStart + i}`
				)
			);
		bind();
		// One portal-mode cell: must never be recycled.
		slot.centerCells[0].update(0, 'c0', 0, 'r0', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'portal-key');
		const portalCell = slot.centerCells[0];
		const servedColumns = new Map<CellSlot<unknown>, Set<string>>();
		for (let start = 1; start + 10 <= COLS; start += 4) {
			reconcileCellTopologyForScroll(slot, topology, null, start, 10, null, cols, initCell, release);
			slot.centerCells.forEach((cell, i) => {
				expect(cell.columnInstanceId).toBe(`c${start + i}`);
				const set = servedColumns.get(cell) ?? new Set();
				set.add(cell.columnInstanceId);
				servedColumns.set(cell, set);
			});
			bind();
		}
		expect([...servedColumns.values()].some((ids) => ids.size > 1)).toBe(true);
		expect(servedColumns.get(portalCell)?.size ?? 0).toBeLessThanOrEqual(1);
		expect(slot.recycledCells).not.toContain(portalCell);
		expect(slot.recycledCells.length).toBeLessThanOrEqual(CELL_SLOT_RETENTION_CONFIG.maxRecycledCellsPerRowSlot);
	});
});
