import { describe, expect, it } from 'vitest';
import { ViewportPlanner } from './viewportPlanner.js';
import { createEmptyRenderWindow, type RenderWindow } from './renderWindow.js';
import { compileColumnTopology } from './columnTopology.js';
import type { CompiledGridPlan, InternalColumnDef } from '../columnDef.js';

function makeCol(field: string, width = 100): InternalColumnDef<unknown> {
	return { field, width, instanceId: field } as unknown as InternalColumnDef<unknown>;
}

function makePlan(cols: InternalColumnDef<unknown>[], pinLeftCount: number, pinRightCount: number, version: number): CompiledGridPlan<unknown> {
	const colWidth = 100;
	const colCount = cols.length;
	const pinRightStart = colCount - pinRightCount;
	const pinLeftWidth = pinLeftCount * colWidth;
	const pinRightWidth = pinRightCount * colWidth;
	const totalWidth = colCount * colWidth;
	return {
		displayedColumns: cols,
		colLefts: cols.map((_, i) => i * colWidth),
		colWidths: cols.map(() => colWidth),
		pinLeftCount,
		pinRightStart,
		pinRightCount,
		pinLeftWidth,
		pinRightWidth,
		pinRightBaseLeft: totalWidth - pinRightWidth,
		totalWidth,
		version,
	} as unknown as CompiledGridPlan<unknown>;
}

function windowWithRows(rowStart: number, rowEnd: number): RenderWindow {
	return { ...createEmptyRenderWindow(), rowStart, rowEnd, rowCount: 100, colCount: 3, colStart: 0, colEnd: 2 };
}

describe('ViewportPlanner', () => {
	it('first frame — no prior window/topology, no columnWindowDelta, frame counter starts at 1', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a'), makeCol('b')], 0, 0, 1));
		const plan = planner.computePlan(windowWithRows(0, 9), topology);

		expect(plan.frame).toBe(1);
		expect(plan.columnWindowDelta).toBeUndefined();
		expect(plan.renderWindow.rowStart).toBe(0);
		expect(plan.liveCells.overscan).toEqual([]);
	});

	it('frame counter increments monotonically across calls', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		const first = planner.computePlan(windowWithRows(0, 9), topology);
		const second = planner.computePlan(windowWithRows(1, 10), topology);
		expect(second.frame).toBe(first.frame + 1);
	});

	it('reuses unchanged column lists across vertical frames and refreshes them when the column window moves', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 1));
		const first = planner.computePlan({ ...windowWithRows(0, 9), colEnd: 1, visibleColStart: 0, visibleColEnd: 1 }, topology);
		const vertical = planner.computePlan({ ...windowWithRows(10, 19), colEnd: 1, visibleColStart: 0, visibleColEnd: 1 }, topology);
		expect(vertical.visibleCenterColumns).toBe(first.visibleCenterColumns);
		expect(vertical.renderedCenterColumns).toBe(first.renderedCenterColumns);
		expect(vertical.pinnedLeftColumns).toBe(first.pinnedLeftColumns);
		expect(vertical.liveCenterColumnWindow).toBe(vertical.visibleCenterColumns);
		const horizontal = planner.computePlan({ ...windowWithRows(10, 19), colStart: 1, visibleColStart: 1 }, topology);
		expect(horizontal.visibleCenterColumns).not.toBe(vertical.visibleCenterColumns);
		expect(horizontal.renderedCenterColumns).not.toBe(vertical.renderedCenterColumns);
	});

	it('routine horizontal scroll (same topology version) computes ColumnInstanceId entered/stayed/exited without marking the delta structural', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a'), makeCol('b'), makeCol('c')], 0, 0, 1));
		planner.computePlan({ ...windowWithRows(0, 9), colStart: 0, colEnd: 1, visibleColStart: 0, visibleColEnd: 1 }, topology);
		const plan = planner.computePlan({ ...windowWithRows(0, 9), colStart: 1, colEnd: 2, visibleColStart: 1, visibleColEnd: 2 }, topology);

		expect(plan.columnWindowDelta).toBeDefined();
		expect(plan.columnWindowDelta!.structural).toBe(false);
		expect(plan.columnWindowDelta!.enteredCenterColumns).toEqual(['c']);
		expect(plan.columnWindowDelta!.exitedCenterColumns).toEqual(['a']);
		expect(plan.columnWindowDelta!.stayedCenterColumns).toEqual(['b']);
	});

	it('topology version change (pin/reorder) — columnWindowDelta is computed against the prior topology', () => {
		const planner = new ViewportPlanner();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c')];
		const topologyV1 = compileColumnTopology(makePlan(cols, 0, 0, 1));
		planner.computePlan(windowWithRows(0, 9), topologyV1);

		const topologyV2 = compileColumnTopology(makePlan(cols, 1, 0, 2)); // pin 'a' left
		const plan = planner.computePlan(windowWithRows(0, 9), topologyV2);

		expect(plan.columnWindowDelta).toBeDefined();
		expect(plan.columnWindowDelta!.structural).toBe(true);
		expect(plan.columnWindowDelta!.laneMoves.length).toBeGreaterThan(0);
	});

	it('duplicate-field columns remain distinct in routine horizontal delta because instance ids differ', () => {
		const planner = new ViewportPlanner();
		const cols = [makeCol('price#raw'), makeCol('price#badge'), makeCol('price#spark')];
		const topology = compileColumnTopology(makePlan(cols, 0, 0, 1));
		planner.computePlan({ ...windowWithRows(0, 9), colStart: 0, colEnd: 1, visibleColStart: 0, visibleColEnd: 1 }, topology);
		const plan = planner.computePlan({ ...windowWithRows(0, 9), colStart: 1, colEnd: 2, visibleColStart: 1, visibleColEnd: 2 }, topology);
		expect(plan.columnWindowDelta!.exitedCenterColumns).toEqual(['price#raw']);
		expect(plan.columnWindowDelta!.stayedCenterColumns).toEqual(['price#badge']);
		expect(plan.columnWindowDelta!.enteredCenterColumns).toEqual(['price#spark']);
	});

	it('retainedFocusEditRowIndices passes through unchanged — planner does not compute retention itself', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		const retained = new Set([42]);
		const plan = planner.computePlan(windowWithRows(0, 9), topology, retained);
		expect(plan.retainedFocusEditRowIndices).toBe(retained);
	});

	it('live window is clamped to the executable rendered window', () => {
		const planner = new ViewportPlanner();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d'), makeCol('e')];
		const topology = compileColumnTopology(makePlan(cols, 0, 0, 1));
		const plan = planner.computePlan(
			{
				...windowWithRows(10, 19),
				colStart: 1,
				colEnd: 3,
				visibleRowStart: 12,
				visibleRowEnd: 15,
				visibleColStart: 2,
				visibleColEnd: 2,
			},
			topology,
			new Set(),
			makePlan(cols, 0, 0, 1),
			{ live: { rowOverscan: 10, columnOverscan: 10 } }
		);
		expect(plan.liveRowRange).toEqual({ start: 10, end: 19 });
		expect(plan.liveCenterColumnWindow).toEqual(['b', 'c', 'd']);
	});

	it('increasing live overscan beyond the physical render window does not create executable cells outside rendered rows/columns', () => {
		const planner = new ViewportPlanner();
		const cols = [makeCol('a'), makeCol('b'), makeCol('c'), makeCol('d'), makeCol('e')];
		const compiledPlan = makePlan(cols, 0, 0, 1);
		const plan = planner.computePlan(
			{
				...windowWithRows(20, 24),
				colStart: 1,
				colEnd: 2,
				visibleRowStart: 21,
				visibleRowEnd: 22,
				visibleColStart: 1,
				visibleColEnd: 1,
			},
			compileColumnTopology(compiledPlan),
			new Set(),
			{
				...compiledPlan,
				displayedColumns: cols.map((col, index) =>
					index === 1 || index === 2 ? ({ ...col, cellRendererCapabilities: { scroll: 'live' } } as InternalColumnDef<unknown>) : col
				),
			} as CompiledGridPlan<unknown>,
			{ live: { rowOverscan: 999, columnOverscan: 999 } }
		);
		expect(plan.liveCells.overscan.every((cell) => cell.rowIndex >= plan.renderedRows.start && cell.rowIndex <= plan.renderedRows.end)).toBe(
			true
		);
		expect(plan.liveCells.overscan.every((cell) => plan.renderedCenterColumns.includes(cell.columnInstanceId))).toBe(true);
	});

	it('keeps a 1,000-column plan bounded to the visible and pinned executable window', () => {
		let rendererModeReads = 0;
		const cols = Array.from({ length: 1_000 }, (_, index) => {
			const column = makeCol(`c${index}`);
			Object.defineProperty(column, 'cellRendererCapabilities', {
				get() {
					rendererModeReads++;
					return { scroll: 'live' };
				},
			});
			return column;
		});
		const compiledPlan = makePlan(cols, 2, 2, 1);
		const topology = compileColumnTopology(compiledPlan);
		let centerPlacementReads = 0;
		const countedTopology = {
			...topology,
			center: new Proxy(topology.center, {
				get(target, property) {
					if (typeof property === 'string' && /^\d+$/.test(property)) centerPlacementReads++;
					return Reflect.get(target, property);
				},
			}),
		};
		const window = {
			...windowWithRows(8, 14),
			colCount: 1_000,
			colStart: 398,
			colEnd: 406,
			visibleRowStart: 10,
			visibleRowEnd: 12,
			visibleColStart: 400,
			visibleColEnd: 404,
			pinLeftCols: 2,
			pinRightCols: 2,
		};
		const planner = new ViewportPlanner();
		const plan = planner.computePlan(window, countedTopology, new Set(), compiledPlan, { live: { columnOverscan: 2 } });

		// The 2 overscan center columns on each side of the 5 visible ones, across 3 visible rows.
		expect(plan.liveCells.overscan).toHaveLength(12);
		// Three bounded center slices read 5 + 9 + 9 placements plus their range boundaries,
		// rather than walking all 996 center columns.
		expect(centerPlacementReads).toBeLessThanOrEqual(30);
		expect(rendererModeReads).toBe(1_000);

		planner.computePlan(window, countedTopology, new Set(), compiledPlan, { live: { columnOverscan: 2 } });
		// Renderer mode classification is retained while both compiled-plan and topology versions match.
		expect(rendererModeReads).toBe(1_000);
	});

	it('reset() clears diffing state so the next frame is treated as freshly-entered', () => {
		const planner = new ViewportPlanner();
		const topology = compileColumnTopology(makePlan([makeCol('a')], 0, 0, 1));
		planner.computePlan(windowWithRows(5, 14), topology);
		planner.reset();
		const plan = planner.computePlan(windowWithRows(5, 14), topology);
		expect(plan.frame).toBe(1);
		expect(plan.viewportDelta.rowsEntered.length).toBeGreaterThan(0);
	});
});
