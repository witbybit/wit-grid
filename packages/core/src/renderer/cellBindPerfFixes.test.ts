// @vitest-environment jsdom
/**
 * Regression tests for the cell bind-path performance/correctness pass: controller lifetime,
 * scroll-path presentation fixes, and the allocation/DOM-write reductions that are observable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { CellSlot } from './cellSlot.js';
import { RowCtrlStore } from './controllers/RowCtrlStore.js';
import { getOrCreateCellCtrl } from './controllers/RowCtrl.js';
import { createCellCtrl } from './controllers/CellCtrl.js';
import { resolveScrollCellPresentation, type ScrollCellPresentationDeps, type ScrollCellPresentationInput } from './scrollCellPresentation.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import { resolveRowPresentation } from './rowPresentationResolver.js';
import { applySnapshotCellPresentation as applyHtmlSnapshotCellPresentation } from './binders/snapshotCellBinder.js';
import { isOverscanLiveCell } from './binders/binderShared.js';
import { createCellDisplaySnapshot, CellDisplaySnapshotStore, MAX_CELL_DISPLAY_SNAPSHOT_CAPACITY } from './cellDisplaySnapshot.js';
import { DataModel } from '../models/DataModel.js';

interface WideRow {
	id: string;
	[key: string]: string;
}

const COLUMN_COUNT = 8;

function mountWideGrid(rowCount: number) {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
	const columns: ColumnDef<WideRow>[] = Array.from({ length: COLUMN_COUNT }, (_, c) => ({ field: `c${c}`, header: `C${c}`, width: 80 }));
	const store = new GridStore<WideRow>({ columns, defaultRowHeight: 40, defaultColWidth: 80, getRowId: (row) => row.id });
	const rows = Array.from({ length: rowCount }, (_, r) => {
		const row: WideRow = { id: `row-${r}` };
		for (let c = 0; c < COLUMN_COUNT; c++) row[`c${c}`] = `${r}:${c}`;
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

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('CellCtrl / RowCtrl lifetime is bounded by the rendered window', () => {
	it('scrolling through thousands of rows keeps both controller stores near the rendered window size', () => {
		const grid = mountWideGrid(1200);
		const viewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		const renderedCells = () => grid.container.querySelectorAll('.og-cell[data-row-id]').length;

		for (let top = 0; top <= 40 * 1150; top += 40 * 60) {
			viewport.scrollTop = top;
			viewport.dispatchEvent(new Event('scroll'));
		}

		const cellCtrls = grid.store.engine.rowCtrls.cellCtrls.size();
		const rowCtrls = grid.store.engine.rowCtrls.size();
		const rendered = renderedCells();
		expect(rendered).toBeGreaterThan(0);
		// Before the fix every (row, column) ever bound stayed alive — ~1200 x 8 here.
		expect(cellCtrls).toBeLessThanOrEqual(rendered * 2);
		expect(rowCtrls).toBeLessThanOrEqual(grid.renderer.rowRenderer.activeRows.size * 2);

		grid.renderer.unmount();
		grid.controller.dispose();
		grid.store.destroy();
	}, 30_000);

	it('releaseDetachedCellCtrl keeps focused/editing controllers and controllers re-attached to another slot', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const a = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli1' as any, { colField: 'a' }).cellCtrl;
		const b = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli2' as any, { colField: 'b' }).cellCtrl;
		a.lifecycle.attachedSlotInstanceId = 'ci-1';
		b.lifecycle.attachedSlotInstanceId = 'ci-2';

		// Re-attached elsewhere: slot ci-9 no longer owns it.
		expect(store.releaseDetachedCellCtrl(a, 'ci-9')).toBe(false);
		// Focused: survives virtualization.
		a.visualState.focused = true;
		expect(store.releaseDetachedCellCtrl(a, 'ci-1')).toBe(false);
		a.visualState.focused = false;

		expect(store.releaseDetachedCellCtrl(a, 'ci-1')).toBe(true);
		expect(a.lifecycle.destroyed).toBe(true);
		expect(store.cellCtrls.getByRowAndColumn('r1', 'coli1' as any)).toBeUndefined();
		expect(store.get('r1')).toBe(rowCtrl);

		expect(store.releaseDetachedCellCtrl(b, 'ci-2')).toBe(true);
		// Last controller gone and the row is neither focused nor editing — the RowCtrl goes too.
		expect(store.get('r1')).toBeUndefined();
		// A stale reference is a no-op.
		expect(store.releaseDetachedCellCtrl(b, 'ci-2')).toBe(false);
	});

	it('a CellSlot hands its previous controller back when it binds another row, and on cold unbind', () => {
		const store = new RowCtrlStore();
		const slot = new CellSlot(document.createElement('div'));
		const first = getOrCreateCellCtrl(store.getOrCreate('r1'), store.cellCtrls, 'coli1' as any, { colField: 'a' }).cellCtrl;
		first.lifecycle.attachedSlotInstanceId = slot.cellInstanceId;
		slot.attachCellCtrl(first, store);
		const second = getOrCreateCellCtrl(store.getOrCreate('r2'), store.cellCtrls, 'coli1' as any, { colField: 'a' }).cellCtrl;
		slot.attachCellCtrl(second, store);
		second.lifecycle.attachedSlotInstanceId = slot.cellInstanceId;
		expect(first.lifecycle.destroyed).toBe(true);
		expect(store.cellCtrls.size()).toBe(1);

		slot.unbindCold();
		expect(second.lifecycle.destroyed).toBe(true);
		expect(store.cellCtrls.size()).toBe(0);
	});
});

function makeScrollDeps(overrides: Partial<ScrollCellPresentationDeps> = {}): ScrollCellPresentationDeps {
	return {
		getCellPortalHost: vi.fn(() => null),
		getRowHeight: vi.fn(() => 40),
		getColWidth: vi.fn(() => 100),
		getCheapDisplayValue: vi.fn(() => ''),
		getFrozenHtmlSnapshot: vi.fn(() => undefined),
		...overrides,
	};
}

function scrollInput(overrides: Partial<ScrollCellPresentationInput<any>> = {}): ScrollCellPresentationInput<any> {
	return {
		cellSlot: new CellSlot(document.createElement('div')),
		node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
		rowIndex: 0,
		colIndex: 0,
		col: { field: 'name' } as any,
		lane: 'center',
		ctx: {
			activeEdit: null,
			focusedCell: null,
			globalVersion: 7,
			insightVersion: 0,
			styleVersion: 0,
			selectionVersion: 0,
			hasDeferredCellStyleRules: false,
			hasInsightDecorations: false,
			isScrolling: true,
			loadingVersion: 0,
			plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			rowVersions: new Map([['r1', 3]]),
		} as any,
		isRowRebind: false,
		isRowLoading: false,
		isInVisibleContent: true,
		snapshot: undefined,
		isWarmBindingVersionFresh: false,
		rowVersion: 3,
		cellKey: 'ci1:name',
		...overrides,
	};
}

describe('scroll presentation fixes', () => {
	it('a row rebind never freezes the previous row portal content in a recycled slot', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'old-row', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'ci1:name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span')).textContent = 'OLD ROW CONTENT';
		const snapshot = createCellDisplaySnapshot({
			rowId: 'r1',
			colField: 'name',
			rowVersion: 3,
			globalVersion: 7,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
			baseClassName: 'og-cell',
			contentKind: 'portal-live',
			contentMode: 'portal',
			formattedValue: 'new row',
			title: '',
		});
		const presentation = resolveScrollCellPresentation(
			makeScrollDeps({ getCellPortalHost: () => host, getCheapDisplayValue: () => 'new row' }),
			scrollInput({
				cellSlot,
				isRowRebind: true,
				snapshot,
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: { ...scrollInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
			})
		);
		expect(presentation.kind).not.toBe('frozen-portal');
		expect(presentation.kind).toBe('shell');
		if (presentation.kind !== 'shell') throw new Error('unreachable');
		// A shell keeps no portal, so the dispatcher releases row A's portal (see cellPresentationDispatcher.test.ts).
		expect(presentation.formattedValue).toBe('new row');
	});

	it('a portal cell entering view shows its value, not the empty text it was buffered with', () => {
		// An overscan row's portal cell is buffered empty; that empty text is still version-fresh.
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'empty', undefined, '', undefined);
		const presentation = resolveScrollCellPresentation(
			makeScrollDeps({ getCheapDisplayValue: () => '513' }),
			scrollInput({
				cellSlot,
				isWarmBindingVersionFresh: true,
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: { ...scrollInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
			})
		);
		if (presentation.kind !== 'shell') throw new Error(`expected a shell, got ${presentation.kind}`);
		expect(presentation.formattedValue).toBe('513');
		expect(presentation.contentMode).toBe('fallback');
	});

	it('a plain primitive column shows its field value (not "...") during scroll with no snapshot', () => {
		const presentation = resolveScrollCellPresentation(makeScrollDeps({ hasFormula: () => false }), scrollInput());
		if (presentation.kind !== 'primitive') throw new Error('unreachable');
		expect(presentation.formattedValue).toBe('Name 1');
		expect(presentation.markDirty).toBe(true);
	});

	it('keeps the "..." placeholder for formula cells, formatted columns and nested fields', () => {
		const formula = resolveScrollCellPresentation(makeScrollDeps({ hasFormula: () => true }), scrollInput());
		const formatted = resolveScrollCellPresentation(
			makeScrollDeps({ hasFormula: () => false }),
			scrollInput({ ctx: { ...scrollInput().ctx, plan: { columnPlans: [{ isCustom: false, mode: 'primitive-formatted' }] } } as any })
		);
		const nested = resolveScrollCellPresentation(makeScrollDeps({ hasFormula: () => false }), scrollInput({ col: { field: 'a.b' } as any }));
		for (const p of [formula, formatted, nested]) {
			if (p.kind !== 'primitive') throw new Error('unreachable');
			expect(p.formattedValue).toBe('...');
		}
	});

	it('explicit text-impostor columns reuse the full-bind impostor text from a fresh snapshot', () => {
		const render = vi.fn(({ formattedValue }: { formattedValue: string }) => `chip:${formattedValue}`);
		const snapshot = createCellDisplaySnapshot({
			rowId: 'r1',
			colField: 'name',
			rowVersion: 3,
			globalVersion: 7,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
			baseClassName: 'og-cell',
			contentKind: 'impostor',
			contentMode: 'fallback',
			formattedValue: 'chip:Formatted Name',
			title: '',
		});
		const presentation = resolveScrollCellPresentation(
			makeScrollDeps({ getCheapDisplayValue: () => 'Name 1' }),
			scrollInput({
				snapshot,
				col: {
					field: 'name',
					cellRenderer: () => null,
					cellRendererCapabilities: { scrollPresentation: 'text-impostor', textImpostor: { render } },
				} as any,
				ctx: { ...scrollInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
			})
		);
		if (presentation.kind !== 'text-impostor') throw new Error('unreachable');
		expect(presentation.formattedValue).toBe('chip:Formatted Name');
		expect(render).not.toHaveBeenCalled();
	});

	it('explicit text-impostor without a snapshot hands the renderer the real field value', () => {
		const render = vi.fn(({ value }: { value: unknown }) => `v:${String(value)}`);
		const presentation = resolveScrollCellPresentation(
			makeScrollDeps({ getCheapDisplayValue: () => 'Name 1', hasFormula: () => false }),
			scrollInput({
				col: {
					field: 'name',
					cellRenderer: () => null,
					cellRendererCapabilities: { scrollPresentation: 'text-impostor', textImpostor: { render } },
				} as any,
				ctx: { ...scrollInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
			})
		);
		if (presentation.kind !== 'text-impostor') throw new Error('unreachable');
		expect(render).toHaveBeenCalledWith({ value: 'Name 1', formattedValue: 'Name 1' });
	});
});

function makeBinderDeps(engine: Record<string, unknown>, overrides: Partial<RowCellBinderDeps<any>> = {}): RowCellBinderDeps<any> {
	return {
		engine: engine as any,
		cellRenderer: { showPortalContent: vi.fn(), ensureLoadingSkeleton: vi.fn() } as any,
		portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately: vi.fn() } as any,
		selectionPaint: {} as any,
		cellClassScratch: {} as any,
		getViewportContainer: () => null,
		getIsScrolling: () => false,
		getIsScrollFrameActive: () => false,
		programmaticScrollCell: null,
		clearProgrammaticScrollCell: vi.fn(),
		setDeferredFocusCell: vi.fn(),
		applyFocus: vi.fn(),
		isEditorInteractiveElement: () => false,
		ensureCellPortalHost: (cell) => {
			const host = document.createElement('div');
			cell.appendChild(host);
			return host;
		},
		getCellPortalHost: () => null,
		markCellDirtyAfterScroll: vi.fn(),
		releaseCellPortal: vi.fn(),
		incrementStyleHookCallsDuringScroll: vi.fn(),
		incrementCurrentScrollCellsWritten: vi.fn(),
		getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		...overrides,
	};
}

function fullBindEngine(data: Record<string, unknown>, rowVersion = 1) {
	return {
		cellAccess: {
			get: vi.fn(() => ({ isFocused: false, isSelected: false, isEditing: false, isLoading: false, value: 42, rawValue: 42 })),
		},
		insights: { getCellDecorations: vi.fn(() => []), getVersion: vi.fn(() => 0) },
		selectionVersion: 0,
		rowVersions: { get: vi.fn(() => rowVersion) },
		cellDisplaySnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
		htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
		data,
		hasFormula: vi.fn(() => false),
		getCheapDisplayValue: vi.fn(() => ''),
	};
}

const sharedNode = { id: 'r1', data: { id: 'r1', amount: 42 } } as any;

function fullBindRequest(cellSlot: CellSlot<any>, col: any, ctx?: any) {
	return {
		cellSlot,
		slotId: 'slot-1',
		slotGeneration: 1,
		node: sharedNode,
		rowIndex: 0,
		colIndex: 0,
		col,
		lane: 'center' as const,
		pinRightBaseLeft: 0,
		plan: { colLefts: [0], colWidths: [100], columnPlans: [{ isCustom: false, mode: 'primitive-formatted' }] } as any,
		state: { globalVersion: 1, styleRules: undefined } as any,
		ctx,
	};
}

describe('value formatter inputs and caching', () => {
	it('passes the raw value (not its String()) to valueFormatter on the scrolling full-bind path', () => {
		const valueFormatter = vi.fn(({ value }: { value: unknown }) => `${typeof value}:${String(value)}`);
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps = makeBinderDeps(fullBindEngine({ getCachedDisplayValue: vi.fn(() => '42') }));
		bindCellFull(deps, fullBindRequest(cellSlot, { field: 'amount', valueFormatter }, { isScrolling: true }));
		expect(valueFormatter).toHaveBeenCalledTimes(1);
		expect(valueFormatter.mock.calls[0][0].value).toBe(42);
		expect(cellSlot.lastFormattedValue).toBe('number:42');
	});

	it('memoizes formatter output per cell until the row version changes', () => {
		const valueFormatter = vi.fn(({ value }: { value: unknown }) => `$${String(value)}`);
		const data = new DataModel({} as any);
		const col = { field: 'amount', valueFormatter };
		const cellSlot = new CellSlot(document.createElement('div'));

		bindCellFull(makeBinderDeps(fullBindEngine(data as any, 1)), fullBindRequest(cellSlot, col));
		bindCellFull(makeBinderDeps(fullBindEngine(data as any, 1)), fullBindRequest(cellSlot, col));
		expect(valueFormatter).toHaveBeenCalledTimes(1);
		expect(cellSlot.lastFormattedValue).toBe('$42');

		bindCellFull(makeBinderDeps(fullBindEngine(data as any, 2)), fullBindRequest(cellSlot, col));
		expect(valueFormatter).toHaveBeenCalledTimes(2);

		data.clearValueGetterCache();
		bindCellFull(makeBinderDeps(fullBindEngine(data as any, 2)), fullBindRequest(cellSlot, col));
		expect(valueFormatter).toHaveBeenCalledTimes(3);
	});
});

describe('custom-dom scrollPresentation', () => {
	function bindDomCell(capabilities: Record<string, unknown> | undefined) {
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps = makeBinderDeps(
			{
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => ''),
			},
			{
				portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
				getIsScrolling: () => true,
				getIsScrollFrameActive: () => true,
			}
		);
		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', amount: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'amount', cellRenderer: { mount: vi.fn() }, cellRendererCapabilities: capabilities } as any,
			lane: 'center',
			ctx: {
				...scrollInput().ctx,
				globalVersion: 1,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-dom' }] },
				rowVersions: new Map([['r1', 1]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});
		return { mountCellImmediately, cellSlot };
	}

	it('honours an explicit scrollPresentation:"live" by updating the DOM renderer in-frame', () => {
		const { mountCellImmediately, cellSlot } = bindDomCell({ scrollPresentation: 'live' });
		expect(mountCellImmediately).toHaveBeenCalledTimes(1);
		expect(mountCellImmediately.mock.calls[0][0]).toMatchObject({ value: 42, isScrolling: true });
		expect(cellSlot.lastContentMode).toBe('portal');
	});

	it('keeps the default (freeze) for DOM renderers without an explicit live presentation', () => {
		const { mountCellImmediately } = bindDomCell({ scrollPresentation: 'freeze' });
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});
});

describe('row decorations', () => {
	function resolveRow(isScrollFrameActive: boolean) {
		const getRowDecorations = vi.fn(() => [{ className: 'og-row-diff' }]);
		const result = resolveRowPresentation(
			{
				engine: { insights: { size: 1, getRowDecorations }, data: { isRowLoading: () => false } } as any,
				selectionPaint: { hoveredRowIndex: null, selectedRowIdSet: null } as any,
			},
			{
				visualRow: { kind: 'data', id: 'r1', node: { id: 'r1', data: { id: 'r1' } } } as any,
				rowIndex: 3,
				state: { focus: { cell: null }, cellSelection: { selection: { bounds: null } }, rowSelection: { selectedRowIds: [] } } as any,
				compiledStyleRules: { hasRowRules: false } as any,
				isScrollFrameActive,
				isRowRebind: true,
				slotLastVisualRowId: '',
				slotRowKind: '',
				slotLastClassName: '',
				pinTopRows: 0,
				pinBottomRows: 0,
				rowCount: 10,
				shouldDeferWarmRowVisualRefresh: false,
			}
		);
		return { result, getRowDecorations };
	}

	it('applies insight row decorations at rest, like updateRowClassNameSlot does', () => {
		const { result } = resolveRow(false);
		expect(result.className.split(' ')).toContain('og-row-diff');
	});

	it('defers row decorations to the post-scroll repaint during an active scroll frame', () => {
		const { result, getRowDecorations } = resolveRow(true);
		expect(getRowDecorations).not.toHaveBeenCalled();
		expect(result.markDirtyAfterScroll).toBe(true);
	});
});

describe('DOM write reductions', () => {
	it('updates cell text in place instead of replacing the Text node', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 'a', 'Alice');
		const textNode = slot.contentElement.firstChild;
		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 'b', 'Bob');
		expect(slot.contentElement.firstChild).toBe(textNode);
		expect(slot.contentElement.textContent).toBe('Bob');
		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'empty', undefined, '');
		expect(slot.contentElement.childNodes.length).toBe(0);
	});

	it('html-snapshot binds skip rewriting the host when it still holds the same HTML', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const host = cellSlot.getOrCreatePortalHost();
		const cellCtrl = createCellCtrl('r1', 'coli1' as any, 'name');
		cellCtrl.presentationState = {
			kind: 'html-snapshot',
			className: 'og-cell',
			html: '<b>frozen</b>',
			requiresFidelity: true,
			freshness: cellCtrl.presentationState.freshness,
		};
		const deps = makeBinderDeps({}, { ensureCellPortalHost: () => host });
		const input = {
			deps,
			cellCtrl,
			rowCtrl: {} as any,
			cellSlot,
			viewportPlan: null,
			geometry: { rowIndex: 0, colIndex: 0, left: 0, right: -1, width: 100, dragShift: 0, lane: 'center' as const },
			runtime: { globalVersion: 1, rowSlotId: 'slot-1', slotGeneration: 0 },
			phase: 'scroll' as const,
			rowVersion: 1,
		};
		applyHtmlSnapshotCellPresentation(input);
		const written = host.firstChild;
		expect(host.innerHTML).toBe('<b>frozen</b>');
		applyHtmlSnapshotCellPresentation(input);
		expect(host.firstChild).toBe(written);

		// Anything else touching the host forces a rewrite.
		host.innerHTML = '<i>live</i>';
		applyHtmlSnapshotCellPresentation(input);
		expect(host.innerHTML).toBe('<b>frozen</b>');
	});
});

describe('small lookup/allocation helpers', () => {
	it('isOverscanLiveCell matches the linear scan it replaces', () => {
		const overscan = [
			{ rowIndex: 3, columnInstanceId: 'a' },
			{ rowIndex: 4, columnInstanceId: 'b' },
		];
		expect(isOverscanLiveCell(overscan, 3, 'a')).toBe(true);
		expect(isOverscanLiveCell(overscan, 3, 'b')).toBe(false);
		expect(isOverscanLiveCell(overscan, 5, 'a')).toBe(false);
		overscan.push({ rowIndex: 5, columnInstanceId: 'a' });
		expect(isOverscanLiveCell(overscan, 5, 'a')).toBe(true);
		expect(isOverscanLiveCell([], 3, 'a')).toBe(false);
	});

	it('display snapshot class normalization is unchanged for already-normalized and messy input', () => {
		const base = {
			rowId: 'r',
			colField: 'f',
			rowVersion: 0,
			globalVersion: 0,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
		};
		const clean = createCellDisplaySnapshot({
			...base,
			baseClassName: 'og-cell og-cell-pinned-left',
			stateClassName: 'og-cell-focused',
			contentKind: 'text',
			contentMode: 'text',
			formattedValue: '',
			title: '',
		});
		expect(clean.className).toBe('og-cell og-cell-pinned-left og-cell-focused');
		const messy = createCellDisplaySnapshot({
			...base,
			baseClassName: '  og-cell\tog-x  ',
			decorationClassName: ' og-y og-z ',
			contentKind: 'text',
			contentMode: 'text',
			formattedValue: '',
			title: '',
		});
		expect(messy.className).toBe('og-cell og-x og-y og-z');
	});

	it('the display snapshot store grows with the render window up to a cap, never shrinking', () => {
		const store = new CellDisplaySnapshotStore();
		store.ensureCapacity(3000);
		expect(store.getOwnershipSnapshot().maxEntries).toBe(3000);
		store.ensureCapacity(10);
		expect(store.getOwnershipSnapshot().maxEntries).toBe(3000);
		store.ensureCapacity(10_000_000);
		expect(store.getOwnershipSnapshot().maxEntries).toBe(MAX_CELL_DISPLAY_SNAPSHOT_CAPACITY);
	});
});
