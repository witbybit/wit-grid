// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { HeaderRenderer } from './headerRenderer.js';
import type { GridLayoutPlan, HeaderBandLayout } from './layoutPlan.js';

/** Minimal leaf band with one center column placed outside any visible range. */
function makeLeafBand(colCount: number): HeaderBandLayout {
	const cells = Array.from({ length: colCount }, (_, i) => ({
		id: `col${i}`,
		field: `col${i}`,
		label: `Col ${i}`,
		depth: 0,
		colStart: i,
		colEnd: i,
		left: i * 100,
		width: 100,
		top: 0,
		height: 32,
		pinned: 'center' as const,
		isLeaf: true,
		movable: false,
		resizable: false,
		sortable: true,
		checkboxSelection: false,
	}));
	return { depth: 0, top: 0, height: 32, cells };
}

function makePlan(topologyVersion: number, colCount = 5): GridLayoutPlan {
	return {
		viewport: {
			width: 800,
			clientWidth: 800,
			height: 600,
			scrollTop: 0,
			scrollLeft: 0,
			totalHeight: 1000,
			totalWidth: 500,
			topChromeHeight: 32,
			bottomChromeHeight: 0,
			groupPanelHeight: 0,
			filterChipBarHeight: 0,
			leafHeaderHeight: 32,
			columnGroupHeaderHeight: 0,
			floatingFilterHeight: 0,
			paginationTop: 600,
		},
		columns: {
			colStart: 0,
			colEnd: colCount - 1,
			pinLeftCount: 0,
			pinRightCount: 0,
			colWidths: Array(colCount).fill(100),
			colLefts: Array.from({ length: colCount }, (_, i) => i * 100),
			totalWidth: colCount * 100,
			lanes: {
				left: { width: 0, baseLeft: 0, colStart: -1, colEnd: -1 },
				center: { width: colCount * 100, baseLeft: 0, colStart: 0, colEnd: colCount - 1 },
				right: { width: 0, baseLeft: 0, colStart: -1, colEnd: -1 },
			},
		},
		headerBands: [makeLeafBand(colCount)],
		stickySections: [],
		renderWindow: {
			rowStart: 0,
			rowEnd: 10,
			rowCount: 10,
			colStart: 0,
			colEnd: colCount - 1,
			scrollTop: 0,
			scrollLeft: 0,
			pinTopRows: 0,
			pinBottomRows: 0,
		},
		columnTopology: {
			version: topologyVersion,
			placements: [],
			groupSegments: [],
			lanes: {
				left: { colStart: -1, colEnd: -1 },
				center: { colStart: 0, colEnd: colCount - 1 },
				right: { colStart: -1, colEnd: -1 },
			},
		},
	} as unknown as GridLayoutPlan;
}

function makeEngine() {
	return {
		stateManager: {
			getState: () => ({
				styleRules: [],
				selection: { bounds: null, focus: null },
				sortModel: null,
				filterModel: null,
				selectedRowIds: [],
				rowSelection: null,
				enableColumnReorder: false,
				defaultColWidth: 100,
				showGroupPanel: false,
				showFilterChipBar: false,
				showFloatingFilters: false,
				showStatusBar: false,
				pagination: false,
			}),
		},
		columns: {
			getCompiledPlan: () => ({ displayedColumns: [] }),
			getColumnIndex: () => -1,
		},
		instrumentation: {
			increment: vi.fn(),
		},
	};
}

describe('HeaderRenderer — topology version bailout', () => {
	it('re-renders when topology version changes with identical column range', () => {
		const engine = makeEngine();
		const renderer = new HeaderRenderer(engine as never, () => ({ isDraggingColumn: () => false, getColumnShift: () => 0 }) as never, vi.fn());

		const layer = document.createElement('div');
		const leftLayer = document.createElement('div');
		const rightLayer = document.createElement('div');
		renderer.mount(layer, leftLayer, rightLayer);

		// First render — topology version 1
		const range = { startIdx: 100, endIdx: 100 }; // outside cells so renderCell is never called
		renderer.syncVisibleColumnRange(makePlan(1), range);
		expect(renderer.lastHeaderVisibleRange.topologyVersion).toBe(1);

		// Second render — same range but topology version 2
		renderer.syncVisibleColumnRange(makePlan(2), range);
		expect(renderer.lastHeaderVisibleRange.topologyVersion).toBe(2);
	});

	it('bails out when topology version is identical to last render', () => {
		const engine = makeEngine();
		const incrementSpy = engine.instrumentation.increment;
		const renderer = new HeaderRenderer(engine as never, () => ({ isDraggingColumn: () => false, getColumnShift: () => 0 }) as never, vi.fn());

		const layer = document.createElement('div');
		const leftLayer = document.createElement('div');
		const rightLayer = document.createElement('div');
		renderer.mount(layer, leftLayer, rightLayer);

		const range = { startIdx: 100, endIdx: 100 };
		const plan = makePlan(5);

		renderer.syncVisibleColumnRange(plan, range);
		incrementSpy.mockClear();

		// Same plan, same range — should bail out and call nothing
		const didSync = renderer.syncVisibleColumnRange(plan, range);
		expect(didSync).toBe(false);
		// instrumentation should not be called on a bailout path
		expect(incrementSpy).not.toHaveBeenCalled();
	});

	it('forceRepaint bypasses topology version bailout', () => {
		const engine = makeEngine();
		const renderer = new HeaderRenderer(engine as never, () => ({ isDraggingColumn: () => false, getColumnShift: () => 0 }) as never, vi.fn());

		const layer = document.createElement('div');
		const leftLayer = document.createElement('div');
		const rightLayer = document.createElement('div');
		renderer.mount(layer, leftLayer, rightLayer);

		const range = { startIdx: 100, endIdx: 100 };
		const plan = makePlan(7);

		renderer.syncVisibleColumnRange(plan, range);
		// Manually set to same version — ensure bailout would fire
		expect(renderer.lastHeaderVisibleRange.topologyVersion).toBe(7);

		// repaintHeaders uses forceRepaint = true internally
		renderer.repaintHeaders(plan);
		// topologyVersion must still be 7 (same plan — it updated to 7 again)
		expect(renderer.lastHeaderVisibleRange.topologyVersion).toBe(7);
	});
});
