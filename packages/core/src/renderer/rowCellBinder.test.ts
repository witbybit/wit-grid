// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import { createCellInstanceRendererKey } from './identityKeys.js';
import { HtmlScrollSnapshotStore } from './htmlScrollSnapshotStore.js';

describe('bindCellDuringScroll', () => {
	it('shows text impostor for custom-mode portal cells during scroll without mounting the portal', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.lastFormattedValue = 'previous-column-value';

		const deps: RowCellBinderDeps<{ id: string; total: number }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
					getCellValue: vi.fn(() => 42),
				},
				hasFormula: vi.fn(() => true),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', total: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'total', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map(),
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

		// custom-mode portals take the impostor path during scroll — no synchronous mount.
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
		// stale previous-column value must not bleed through (isWarmBindingVersionFresh is false for a new slot)
		expect(cellSlot.lastFormattedValue).toBe('');
		expect(cellSlot.lastContentMode).toBe('empty');
		expect((deps.engine.data as any).getCellValue).not.toHaveBeenCalled();
	});

	it('preserves warm primitive text and class names for a stable cell when the display cache misses during scroll', () => {
		const dirty = vi.fn();
		const wrote = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell og-cell-selected custom-class', 'text', undefined, 'Warm value');
		// Version stamps must match ctx for isWarmBindingVersionFresh to pass.
		cellSlot.lastMountedRowVersion = -1; // rowVersions is empty → rowVersion = -1
		cellSlot.lastMountedGlobalVersion = 1;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: wrote,
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name' } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map(),
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

		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastFormattedValue).toBe('Warm value');
		expect(cellSlot.lastClassName).toBe('og-cell og-cell-selected custom-class');
		expect(cellSlot.element.textContent).toContain('Warm value');
		expect(wrote).not.toHaveBeenCalled();
	});

	it('reuses a fresh logical snapshot for offscreen primitive cells instead of blanking them', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'snap-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'snap-class'],
					className: 'og-cell snap-class',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: 'Snapshot title',
					validationError: 'Invalid value',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(cellSlot.lastFormattedValue).toBe('Snapshot value');
		expect(cellSlot.lastClassName).toBe('og-cell snap-class');
		expect(cellSlot.element.title).toBe('Snapshot title');
		expect(cellSlot.element.dataset.validationError).toBe('Invalid value');
	});

	it('prefers a fresh logical snapshot over warm primitive content for visible cells during scroll', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell warm-class', 'text', undefined, 'Warm value');
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => 'Cached value that should not win') },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'snap-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'snap-class'],
					className: 'og-cell snap-class',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: 'Snapshot title',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastFormattedValue).toBe('Snapshot value');
		expect(cellSlot.lastClassName).toBe('og-cell snap-class');
		expect(cellSlot.element.title).toBe('Snapshot title');
		expect(deps.engine.data.getCachedDisplayValue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	it('does not read cached display values for a visible primitive cell during scroll when no snapshot exists', () => {
		const getCachedDisplayValue = vi.fn(() => 'Cached value that should not win');
		const markCellDirtyAfterScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: true,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(getCachedDisplayValue).not.toHaveBeenCalled();
		expect(cellSlot.lastFormattedValue).toBe('Name 1');
		expect(markCellDirtyAfterScroll).toHaveBeenCalledWith(cellSlot.element);
	});

	it('does not dirty a visible primitive cell solely because insight layers exist when the snapshot insight version is fresh', () => {
		const markCellDirtyAfterScroll = vi.fn();
		const incrementStyleHookCallsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 4,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: '',
					decorationClassName: 'og-cell-validation-error',
					classTokens: ['og-cell', 'og-cell-validation-error'],
					className: 'og-cell og-cell-validation-error',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: 'Needs review',
					validationError: 'Needs review',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name' } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 4,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toBe('og-cell og-cell-validation-error');
		expect(markCellDirtyAfterScroll).not.toHaveBeenCalled();
		expect(incrementStyleHookCallsDuringScroll).not.toHaveBeenCalled();
	});

	it('does not dirty a visible primitive cell solely because style rules changed when the snapshot style version is fresh', () => {
		const markCellDirtyAfterScroll = vi.fn();
		const incrementStyleHookCallsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 5,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'styled-cell',
					decorationClassName: '',
					classTokens: ['og-cell', 'styled-cell'],
					className: 'og-cell styled-cell',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 5, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
				styleVersion: 5,
				selectionVersion: 0,
				hasDeferredCellStyleRules: true,
				hasInsightDecorations: false,
				isScrolling: true,
				loadingVersion: 0,
				styleChangedDuringScroll: true,
				selectionChangedDuringScroll: false,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toBe('og-cell styled-cell');
		expect(markCellDirtyAfterScroll).not.toHaveBeenCalled();
		expect(incrementStyleHookCallsDuringScroll).not.toHaveBeenCalled();
	});

	it('does not dirty a visible primitive cell solely because selection changed when the snapshot selection version is fresh', () => {
		const markCellDirtyAfterScroll = vi.fn();
		const incrementStyleHookCallsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 5,
					loadingVersion: 0,
					selectionVersion: 9,
					baseClassName: 'og-cell',
					stateClassName: 'og-cell-selected',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-selected'],
					className: 'og-cell og-cell-selected',
					contentKind: 'text',
					contentMode: 'text',
					formattedValue: 'Snapshot value',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 5, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
				styleVersion: 5,
				selectionVersion: 9,
				hasDeferredCellStyleRules: true,
				hasInsightDecorations: false,
				isScrolling: true,
				loadingVersion: 0,
				styleChangedDuringScroll: false,
				selectionChangedDuringScroll: true,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toBe('og-cell og-cell-selected');
		expect(markCellDirtyAfterScroll).not.toHaveBeenCalled();
		expect(incrementStyleHookCallsDuringScroll).not.toHaveBeenCalled();
	});

	it('reuses a fresh logical portal snapshot for buffered offscreen cells instead of downgrading them to empty', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell portal-warm', 'portal', undefined, '', portalKey);
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'portal-warm',
					decorationClassName: '',
					classTokens: ['og-cell', 'portal-warm'],
					className: 'og-cell portal-warm',
					contentKind: 'portal-live',
					contentMode: 'portal',
					formattedValue: '',
					title: 'Portal snapshot',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(cellSlot.lastContentMode).toBe('portal');
		expect(cellSlot.lastPortalKey).toBe(portalKey);
		expect(cellSlot.element.title).toBe('Portal snapshot');
	});

	it('does not promote buffered primitive DOM state into snapshot truth during scroll', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell warm-class', 'text', undefined, 'Name 1', undefined);
		cellSlot.element.title = 'Warm title';
		cellSlot.element.dataset.validationError = 'Needs review';
		const snapshotSet = vi.fn();

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(snapshotSet).not.toHaveBeenCalled();
		// The text comes from the row itself (a plain primitive field read), not from the warm DOM,
		// so the buffered cell is already correct when it scrolls into view.
		expect(cellSlot.lastContentMode).toBe('text');
		expect(cellSlot.lastFormattedValue).toBe('Name 1');
		expect(cellSlot.element.title).toBe('');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
	});

	it('does not promote buffered portal DOM state into snapshot truth during scroll', () => {
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell portal-warm', 'portal', undefined, '', portalKey);
		cellSlot.element.title = 'Portal warm title';
		cellSlot.element.dataset.validationError = 'Needs review';
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;
		const snapshotSet = vi.fn();

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: false,
		});

		expect(snapshotSet).not.toHaveBeenCalled();
		expect(cellSlot.lastContentMode).toBe('empty');
		expect(cellSlot.lastPortalKey).toBeUndefined();
		expect(cellSlot.element.title).toBe('');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
	});

	it('trusts a fresh visible portal snapshot and host presence before consulting the mount registry', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const isCellMounted = vi.fn(() => {
			throw new Error('mount registry should not be consulted when snapshot + host are fresh');
		});
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell portal-warm', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'portal-warm',
					decorationClassName: '',
					classTokens: ['og-cell', 'portal-warm'],
					className: 'og-cell portal-warm',
					contentKind: 'portal-live',
					contentMode: 'portal',
					formattedValue: '',
					title: 'Portal snapshot',
				})),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted,
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(isCellMounted).not.toHaveBeenCalled();
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('uses a fresh custom-live impostor snapshot during scroll instead of immediately mounting the portal', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 3,
					globalVersion: 7,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'og-cell-readonly',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-readonly'],
					className: 'og-cell og-cell-readonly',
					contentKind: 'impostor',
					contentMode: 'fallback',
					formattedValue: 'Fallback name',
					title: 'Fallback title',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('Fallback name');
		expect(cellSlot.element.title).toBe('Fallback title');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('synthesizes a cheap text impostor for a new custom-live cell with no prewarm snapshot instead of live-mounting during scroll', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; amount: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => '$42'),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', amount: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'amount', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
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

		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('$42');
	});

	it('BLOCKER: never live-mounts a cold custom-DOM-renderer cell during normal (non-editing, non-focused) active scroll', () => {
		// mode:'custom-dom' is the real compiled-plan shape for a column using a DOM cell renderer
		// (ColumnModel.ts sets this for isDomCellRenderer columns) — it is NOT in the impostor-capable
		// set (custom-live/custom-imperative/custom), so before this fix it fell straight through to a
		// synchronous mountCellImmediately call on first scroll-in. Normal scroll must never mount any
		// renderer type live, regardless of capability bucket.
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; amount: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => ''),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', amount: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'amount', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-dom' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
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

		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastContentMode).not.toBe('portal');
	});

	it('uses impostor snapshot for a pinned-left custom-live cell during scroll, same as center lane', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 1,
					globalVersion: 5,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell og-cell-pinned-left',
					stateClassName: '',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-pinned-left'],
					className: 'og-cell og-cell-pinned-left',
					contentKind: 'impostor',
					contentMode: 'fallback',
					formattedValue: 'Pinned value',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'left',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 5,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 1]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 120,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('Pinned value');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('uses impostor snapshot for a pinned-right custom-live cell during scroll, same as center lane', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; score: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r2',
					colField: 'score',
					rowVersion: 2,
					globalVersion: 9,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell og-cell-pinned-right',
					stateClassName: '',
					decorationClassName: '',
					classTokens: ['og-cell', 'og-cell-pinned-right'],
					className: 'og-cell og-cell-pinned-right',
					contentKind: 'impostor',
					contentMode: 'fallback',
					formattedValue: '99',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r2', data: { id: 'r2', score: 99 } } as any,
			rowIndex: 3,
			colIndex: 0,
			col: { field: 'score', cellRenderer: () => null } as any,
			lane: 'right',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 9,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r2', 2]]),
			} as any,
			pooledRowId: 'slot-2',
			pooledRowGeneration: 0,
			left: 0,
			right: 0,
			width: 80,
			isRowRebind: false,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('99');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('live-mounts a scrollPresentation:"live" cell during scroll instead of showing a text impostor', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const deps: RowCellBinderDeps<{ id: string; price: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => '$99'),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', price: 99 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'price',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'live', live: { update: 'imperative' } },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-imperative' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
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

		expect(mountCellImmediately).toHaveBeenCalled();
		expect(mountCellImmediately.mock.calls[0][0]).toMatchObject({ phase: 'scroll-live', isScrolling: true });
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastContentMode).toBe('portal');
	});

	it('uses textImpostor.render when provided, overriding the generic display value', () => {
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const textImpostorRender = vi.fn(({ formattedValue }: { value: unknown; formattedValue: string }) => `★ ${formattedValue}`);
		const deps: RowCellBinderDeps<{ id: string; price: number }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => '42'),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: (cell) => {
				const h = document.createElement('div');
				cell.appendChild(h);
				return h;
			},
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', price: 42 } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'price',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'text-impostor', textImpostor: { render: textImpostorRender } },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				selectionVersion: 0,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
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

		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(textImpostorRender).toHaveBeenCalled();
		expect(cellSlot.lastContentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('★ 42');
	});

	it('marks visible primitive cells dirty instead of materializing insight snapshots during scroll', () => {
		const dirty = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const snapshotSet = vi.fn();
		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => 'Name 1'),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
				insights: {
					getCellDecorations: vi.fn(() => [
						{
							layerId: 'integrity',
							kind: 'validationError',
							className: 'og-cell-validation-error',
							title: 'Needs review',
						},
					]),
				},
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name' } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 7,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 0,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: true,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		expect(cellSlot.lastClassName).toBe('og-cell');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
		expect(cellSlot.element.title).toBe('');
		expect(snapshotSet).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastFormattedValue).toBe('Name 1');
	});

	it('keeps warm visible primitive text as a temporary compatibility edge but still marks it dirty when snapshots are missing', () => {
		const dirty = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell preserved', 'text', undefined, 'Name 1', undefined);
		// All version stamps must match the ctx for isWarmBindingVersionFresh to pass.
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedRowVersion = 3;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;
		const snapshotSet = vi.fn();

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => 'Name 1'),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
				insights: {
					getCellDecorations: vi.fn(() => [
						{
							layerId: 'integrity',
							kind: 'validationError',
							className: 'og-cell-validation-error',
							title: 'Needs review',
						},
					]),
				},
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => false),
				mountCellImmediately: vi.fn(),
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
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
				hasInsightDecorations: true,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 3]]),
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

		expect(cellSlot.lastClassName).toContain('preserved');
		expect(cellSlot.lastClassName).not.toContain('og-cell-validation-error');
		expect(cellSlot.element.dataset.validationError).toBeUndefined();
		expect(cellSlot.element.title).toBe('');
		expect(snapshotSet).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		expect(cellSlot.lastFormattedValue).toBe('Name 1');
	});

	it('does not mark a stable frozen portal cell dirty during scroll when nothing changed', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 1;
		cellSlot.lastMountedRowVersion = 2;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 2,
					globalVersion: 1,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'custom-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'custom-class'],
					className: 'og-cell custom-class',
					contentKind: 'portal-frozen',
					contentMode: 'portal',
					formattedValue: '',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 2]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('freezes a cell with live portal content in place during scroll without remounting when no snapshot is available', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const snapshotSet = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 1;
		cellSlot.lastMountedRowVersion = 2;
		cellSlot.element.title = 'Portal warm title';
		cellSlot.element.dataset.validationError = 'Needs review';
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => undefined),
					set: snapshotSet,
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 2]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(snapshotSet).not.toHaveBeenCalled();
	});

	it('does not remount a stable frozen custom-live portal during scroll when versions are unchanged', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 4;
		cellSlot.lastMountedRowVersion = 7;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => ({
					rowId: 'r1',
					colField: 'name',
					rowVersion: 7,
					globalVersion: 4,
					insightVersion: 0,
					styleVersion: 0,
					loadingVersion: 0,
					selectionVersion: 0,
					baseClassName: 'og-cell',
					stateClassName: 'custom-class',
					decorationClassName: '',
					classTokens: ['og-cell', 'custom-class'],
					className: 'og-cell custom-class',
					contentKind: 'portal-frozen',
					contentMode: 'portal',
					formattedValue: '',
					title: '',
				})),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('does not dirty a stable frozen portal cell solely because insight layers exist when a fresh portal snapshot is available', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.appendChild(document.createElement('span'));
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class og-cell-validation-error', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 4;
		cellSlot.lastMountedRowVersion = 7;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => ({
						rowId: 'r1',
						colField: 'name',
						rowVersion: 7,
						globalVersion: 4,
						insightVersion: 3,
						styleVersion: 0,
						loadingVersion: 0,
						selectionVersion: 0,
						contentKind: 'portal-live',
						contentMode: 'portal',
						formattedValue: '',
						baseClassName: 'og-cell',
						stateClassName: '',
						decorationClassName: 'og-cell-validation-error',
						classTokens: ['og-cell', 'og-cell-validation-error'],
						className: 'og-cell og-cell-validation-error',
						title: 'Needs review',
						validationError: 'Needs review',
					})),
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				hasInsightDecorations: true,
				insightVersion: 3,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		expect(dirty).not.toHaveBeenCalled();
		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(cellSlot.element.dataset.validationError).toBe('Needs review');
	});

	it('captures frozenHtml from live portal host during freeze and patches the stored snapshot', () => {
		// The freeze-in-place path is the only reliable capture point: React commits async, so
		// reading innerHTML right after mountCell would always return empty HTML. When the cell is
		// frozen in place we know React has already committed, so we read the live DOM here.
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const snapshotSet = vi.fn();
		const htmlSnapshotSet = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		host.innerHTML = '<span class="badge">INFO</span>';
		cellSlot.element.appendChild(host);
		cellSlot.portalHostElement = host;
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 1;
		cellSlot.lastMountedRowVersion = 2;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const existingSnapshot = {
			rowId: 'r1',
			colField: 'name',
			rowVersion: 2,
			globalVersion: 1,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
			contentKind: 'impostor' as const,
			contentMode: 'fallback' as const,
			formattedValue: 'INFO',
			baseClassName: 'og-cell',
			stateClassName: '',
			decorationClassName: '',
			classTokens: ['og-cell'],
			className: 'og-cell',
			title: '',
			// frozenHtml intentionally absent — fidelity render has not yet captured it
		};

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => existingSnapshot),
					set: snapshotSet,
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: htmlSnapshotSet },
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: { isCellMounted: vi.fn(() => true), mountCellImmediately: vi.fn() } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: vi.fn(),
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'name',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'html-snapshot' },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 1,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 2]]),
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

		// HTML snapshot store should be patched with captured innerHTML — `existingSnapshot` itself
		// (a CellDisplaySnapshot, which extends VisualFreshness) is passed through as the freshness stamp.
		expect(htmlSnapshotSet).toHaveBeenCalledWith(
			'r1',
			'name',
			'<span class="badge">INFO</span>',
			expect.objectContaining({
				rowVersion: 2,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				loadingVersion: 0,
				selectionVersion: 0,
			}),
			undefined,
			undefined
		);
		// Cell stays frozen — portal content visible, no remount
		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
	});

	it('injects frozenHtml into portal host during scroll when scrollPresentation:"html-snapshot" is set on the column', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const ensureCellPortalHost = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', undefined, 'raw text', undefined);

		const frozenHost = document.createElement('div');
		ensureCellPortalHost.mockReturnValue(frozenHost);

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => ({
						rowId: 'r1',
						colField: 'name',
						rowVersion: 5,
						globalVersion: 2,
						insightVersion: 0,
						styleVersion: 0,
						loadingVersion: 0,
						selectionVersion: 0,
						contentKind: 'impostor',
						contentMode: 'fallback',
						formattedValue: 'fallback text',
						baseClassName: 'og-cell',
						stateClassName: '',
						decorationClassName: '',
						classTokens: ['og-cell'],
						className: 'og-cell',
						title: '',
					})),
				},
				htmlScrollSnapshots: {
					get: vi.fn(() => ({ html: '<div class="badge badge-info">INFO</div>', rowVersion: 5, rowHeight: undefined })),
					set: vi.fn(),
				},
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'name',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'html-snapshot' },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 2,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 5]]),
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

		// Portal host should receive the frozen HTML clone, not plain text
		expect(frozenHost.innerHTML).toBe('<div class="badge badge-info">INFO</div>');
		// showPortalContent called so CSS shows the portal host
		expect(showPortalContent).toHaveBeenCalledWith(cellSlot.element);
		// Cell is in portal mode (host visible) not fallback mode (text visible)
		expect(cellSlot.element.dataset.contentMode).toBe('portal');
		// Real portal is NOT mounted during scroll
		expect(mountCellImmediately).not.toHaveBeenCalled();
		// Dirty for fidelity upgrade
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
	});

	it('shows a pending shell (not raw text) when scrollPresentation:"html-snapshot" has no fresh capture yet', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', undefined, '', undefined);

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => ({
						rowId: 'r1',
						colField: 'name',
						rowVersion: 5,
						globalVersion: 2,
						insightVersion: 0,
						styleVersion: 0,
						loadingVersion: 0,
						selectionVersion: 0,
						contentKind: 'impostor',
						contentMode: 'fallback',
						formattedValue: 'fallback text',
						baseClassName: 'og-cell',
						stateClassName: '',
						decorationClassName: '',
						classTokens: ['og-cell'],
						className: 'og-cell',
						title: '',
						// frozenHtml intentionally absent — cell has never had a fidelity render
					})),
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: vi.fn(),
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'name',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'html-snapshot' },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 2,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 5]]),
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

		// Shows a stable pending shell, not the snapshot's raw fallback text — html-snapshot mode
		// never shows raw text unless the column/grid explicitly opts into allowTextFallbackWhenMissing.
		expect(cellSlot.element.dataset.contentMode).toBe('pending');
		expect(cellSlot.lastFormattedValue).toBe('');
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('falls back to plain text when scrollPresentation:"html-snapshot" has no capture but allowTextFallbackWhenMissing is set', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', undefined, '', undefined);

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				cellDisplaySnapshots: {
					get: vi.fn(() => ({
						rowId: 'r1',
						colField: 'name',
						rowVersion: 5,
						globalVersion: 2,
						insightVersion: 0,
						styleVersion: 0,
						loadingVersion: 0,
						selectionVersion: 0,
						contentKind: 'impostor',
						contentMode: 'fallback',
						formattedValue: 'fallback text',
						baseClassName: 'og-cell',
						stateClassName: '',
						decorationClassName: '',
						classTokens: ['og-cell'],
						className: 'og-cell',
						title: '',
					})),
				},
				htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: vi.fn(),
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'name',
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'html-snapshot', htmlSnapshot: { allowTextFallbackWhenMissing: true } },
			} as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 2,
				hasDeferredCellStyleRules: false,
				insightVersion: 0,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] },
				selectionVersion: 0,
				styleVersion: 0,
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 5]]),
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

		expect(cellSlot.element.dataset.contentMode).toBe('fallback');
		expect(cellSlot.lastFormattedValue).toBe('fallback text');
		expect(mountCellImmediately).not.toHaveBeenCalled();
	});

	it('defers the portal mount to the fidelity lane when a custom-live host is empty, rather than mounting synchronously during scroll', () => {
		const dirty = vi.fn();
		const showPortalContent = vi.fn();
		const mountCellImmediately = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const portalKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const host = document.createElement('div');
		cellSlot.element.appendChild(host);
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell custom-class', 'portal', undefined, '', portalKey);
		cellSlot.lastMountedGlobalVersion = 4;
		cellSlot.lastMountedRowVersion = 7;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: {
					getCachedDisplayValue: vi.fn(() => undefined),
				},
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent } as any,
			portalMountManager: {
				isCellMounted: vi.fn(() => true),
				mountCellImmediately,
			} as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: null,
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		// The cell had an empty portal host — no live content to freeze.
		// The scroll frame must not call mountCellImmediately; instead, the cell
		// is shown as a cheap text impostor and deferred to the post-scroll fidelity lane.
		expect(mountCellImmediately).not.toHaveBeenCalled();
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
		// No getCheapDisplayValue mock → empty fallback; cell shows 'empty' mode.
		expect(cellSlot.lastContentMode).toBe('empty');
	});

	it('honestly reports isScrolling:true and a distinct phase for the force-live-interactive-exception mount', () => {
		// This is the ONE case allowed to mount live during active scroll (the cell is focused). The
		// mount call must not lie to the renderer about being mid-scroll — it genuinely is — and must
		// use a phase distinct from ordinary 'scroll' (which never mounts) so telemetry and any
		// renderer-side special-casing can tell the two apart.
		const dirty = vi.fn();
		const mountCellImmediately = vi.fn();
		const incrementForceLiveMountsDuringScroll = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		const host = document.createElement('div');

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => host,
			getCellPortalHost: () => host,
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			incrementForceLiveMountsDuringScroll,
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
			lane: 'center',
			ctx: {
				activeEdit: null,
				focusedCell: { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' },
				globalVersion: 4,
				hasDeferredCellStyleRules: false,
				isScrolling: true,
				loadingVersion: 0,
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-dom' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['r1', 7]]),
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

		expect(mountCellImmediately).toHaveBeenCalledWith(expect.objectContaining({ phase: 'scroll-force-live', isScrolling: true }));
		expect(incrementForceLiveMountsDuringScroll).toHaveBeenCalledTimes(1);
	});
});

describe('bindCellFull', () => {
	it('captures frozenHtml from an already-live portal on a normal re-render, without ever going through a scroll freeze', () => {
		// Regression for: scrollPresentation:'html-snapshot' columns showed plain fallback text on their very
		// first scroll, even though the portal had already settled with real content long before
		// any scroll started. The scroll-freeze path can only capture HTML that a PRIOR full bind
		// already made available — it never captures fresh HTML itself. Before this fix, frozenHtml
		// was only ever produced by a scroll freeze, so the first-ever scroll always missed it.
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		const columnInstanceId = 'coli-name' as any;
		const stableKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, columnInstanceId);
		const portalHost = document.createElement('div');
		cellSlot.element.appendChild(portalHost);

		const snapshotStore = new Map<string, any>();
		const htmlScrollSnapshots = new HtmlScrollSnapshotStore();
		const engine = {
			cellAccess: {
				get: vi.fn(() => ({ isFocused: false, isSelected: false, isEditing: false, isLoading: false, value: 'INFO', rawValue: 'INFO' })),
			},
			insights: { getCellDecorations: vi.fn(() => []), getVersion: vi.fn(() => 0) },
			selectionVersion: 0,
			rowVersions: { get: vi.fn(() => 3) },
			cellDisplaySnapshots: {
				get: vi.fn((rowId: string, snapshotColumnInstanceId: string) => snapshotStore.get(`${rowId}:${snapshotColumnInstanceId}`)),
				set: vi.fn((snapshot: any) => snapshotStore.set(`${snapshot.rowId}:${snapshot.columnInstanceId}`, snapshot)),
			},
			htmlScrollSnapshots,
			geometry: { rowHeights: [40] },
			getCheapDisplayValue: vi.fn(() => 'INFO'),
		};

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: engine as any,
			cellRenderer: { showPortalContent: vi.fn(), ensureLoadingSkeleton: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => true), mountCell: vi.fn() } as any,
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
			ensureCellPortalHost: vi.fn(() => portalHost),
			getCellPortalHost: () => portalHost,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		const baseRequest = {
			cellSlot,
			slotId: 'slot-1',
			slotGeneration: 0,
			node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: {
				field: 'name',
				instanceId: columnInstanceId,
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'html-snapshot' as const },
			} as any,
			lane: 'center' as const,
			pinRightBaseLeft: 0,
			plan: { colLefts: [0], colWidths: [100], columnPlans: [{ isCustom: true, mode: 'custom' }] } as any,
			state: { globalVersion: 1, styleRules: undefined } as any,
		};

		// Only rowVersion is checked by default ('row-version-only' mode) — the other dimensions here
		// are placeholders, not asserted against.
		const initialFreshness = { rowVersion: 3, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 };
		const expectedFreshness = { rowVersion: 3, globalVersion: 2, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 };

		// First full bind: portal has never been mounted, nothing exists to capture yet.
		bindCellFull(deps, baseRequest);
		expect(cellSlot.lastPortalKey).toBe(stableKey);
		expect(htmlScrollSnapshots.get('r1', columnInstanceId, initialFreshness)).toBeUndefined();

		// Simulate React having committed the portal's real content sometime after that first bind.
		portalHost.innerHTML = '<div class="badge badge-info">INFO</div>';

		// Second full bind: same row/col identity, triggered by something unrelated (e.g. a focus or
		// selection change elsewhere) — not a scroll, and not the cell's own data changing.
		bindCellFull(deps, { ...baseRequest, state: { globalVersion: 2, styleRules: undefined } as any });

		expect(htmlScrollSnapshots.get('r1', columnInstanceId, expectedFreshness, { rowHeight: 40, colWidth: 100 })?.html).toBe(
			'<div class="badge badge-info">INFO</div>'
		);
	});

	it("does not fall back to a rebound slot's previous row text when the cache misses during a scroll-adjacent full bind", () => {
		// getCheapCellText's isScrolling branch intentionally avoids a real getCellValue call and
		// falls back to warm DOM as a last resort when the authoritative cache misses. That warm
		// DOM must belong to the SAME row/column identity — otherwise this full bind (which is
		// establishing row B's real content) would show row A's leftover text.
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		// Simulate the slot being warm from a previous row A occupant.
		cellSlot.update(0, 'name', 0, 'rowA', 0, -1, 100, 'og-cell', 'text', undefined, 'Stale Row A Value', undefined);

		const engine = {
			cellAccess: {
				get: vi.fn(() => ({ isFocused: false, isSelected: false, isEditing: false, isLoading: false, value: 'Row B', rawValue: 'Row B' })),
			},
			insights: { getCellDecorations: vi.fn(() => []), getVersion: vi.fn(() => 0) },
			selectionVersion: 0,
			rowVersions: { get: vi.fn(() => 1) },
			cellDisplaySnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
			htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() } as any,
			data: { getCachedDisplayValue: vi.fn(() => undefined) },
			hasFormula: vi.fn(() => false),
			getCheapDisplayValue: vi.fn(() => ''),
		};

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: engine as any,
			cellRenderer: { showPortalContent: vi.fn(), ensureLoadingSkeleton: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCell: vi.fn() } as any,
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
			ensureCellPortalHost: vi.fn(),
			getCellPortalHost: () => null,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellFull(deps, {
			cellSlot,
			slotId: 'slot-1',
			slotGeneration: 1,
			node: { id: 'rowB', data: { id: 'rowB', name: 'Row B Value' } } as any,
			rowIndex: 0,
			colIndex: 0,
			col: { field: 'name' } as any,
			lane: 'center',
			pinRightBaseLeft: 0,
			plan: { colLefts: [0], colWidths: [100], columnPlans: [{ isCustom: false, mode: 'primitive' }] } as any,
			state: { globalVersion: 1, styleRules: undefined } as any,
			// isScrolling: true forces getCheapCellText past the authoritative getCellValue path,
			// straight to its cache-or-warm-DOM fallback — the exact branch under test.
			ctx: { isScrolling: true } as any,
		});

		expect(cellSlot.lastFormattedValue).not.toBe('Stale Row A Value');
		expect(cellSlot.lastFormattedValue).toBe('');
	});
});

// This targets bindCellDuringScroll, not bindCellFull — kept as its own top-level describe so the
// test names accurately reflect which binder function they exercise.
describe('warm DOM cannot authorize correctness (adversarial row rebind)', () => {
	it('does not show a previous row primitive text on a rebound slot when no fresh snapshot exists', () => {
		const dirty = vi.fn();
		const cellSlot = new CellSlot(document.createElement('div'));
		// Simulate a slot that was previously bound to row A and is warm with row A's content.
		cellSlot.update(0, 'name', 5, 'rowA', 0, -1, 100, 'og-cell', 'text', undefined, 'Stale Row A Value', undefined);
		cellSlot.lastMountedRowVersion = 1;
		cellSlot.lastMountedGlobalVersion = 7;
		cellSlot.lastMountedInsightVersion = 0;
		cellSlot.lastMountedStyleVersion = 0;
		cellSlot.lastMountedLoadingVersion = 0;
		cellSlot.lastMountedSelectionVersion = 0;

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => 'Stale Row A Value') },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately: vi.fn() } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
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
			markCellDirtyAfterScroll: dirty,
			releaseCellPortal: vi.fn(),
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		// The physical slot is now rebound to row B at the same column — same rowVersion map
		// entry key ('rowB') never matches the warm 'rowA' identity the slot remembers.
		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'rowB', data: { id: 'rowB', name: 'Row B Value' } } as any,
			rowIndex: 5,
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
				rowVersions: new Map([['rowB', 1]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 1,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: true,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		// Row A's warm text must never leak into row B's slot. With no fresh snapshot, a plain
		// primitive column shows row B's own field value (a direct read), never the cached DOM value.
		expect(cellSlot.lastFormattedValue).not.toBe('Stale Row A Value');
		expect(cellSlot.lastFormattedValue).toBe('Row B Value');
		expect(dirty).toHaveBeenCalledWith(cellSlot.element);
	});

	it('does not freeze or show a previous row live portal on a rebound slot when no fresh snapshot exists', () => {
		const releaseCellPortal = vi.fn();
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		const stableKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, 'name');
		const portalHost = document.createElement('div');
		portalHost.innerHTML = '<div class="badge">Row A Live Content</div>';
		cellSlot.element.appendChild(portalHost);
		// Simulate a slot that was previously bound to row A and has a live, rendered portal.
		cellSlot.update(0, 'name', 5, 'rowA', 0, -1, 100, 'og-cell', 'portal', undefined, '', stableKey);

		const deps: RowCellBinderDeps<{ id: string; name: string }> = {
			engine: {
				data: { getCachedDisplayValue: vi.fn(() => undefined) },
				hasFormula: vi.fn(() => false),
				getCellDisplaySnapshot: vi.fn(() => undefined),
				getCheapDisplayValue: vi.fn(() => ''),
			} as any,
			cellRenderer: { showPortalContent: vi.fn() } as any,
			portalMountManager: { isCellMounted: vi.fn(() => true), mountCellImmediately: vi.fn() } as any,
			selectionPaint: {} as any,
			cellClassScratch: {} as any,
			getViewportContainer: () => null,
			getIsScrolling: () => true,
			getIsScrollFrameActive: () => true,
			programmaticScrollCell: null,
			clearProgrammaticScrollCell: vi.fn(),
			setDeferredFocusCell: vi.fn(),
			applyFocus: vi.fn(),
			isEditorInteractiveElement: () => false,
			ensureCellPortalHost: () => portalHost,
			getCellPortalHost: () => portalHost,
			markCellDirtyAfterScroll: vi.fn(),
			releaseCellPortal,
			incrementStyleHookCallsDuringScroll: vi.fn(),
			incrementCellsBoundDuringScroll: vi.fn(),
			incrementCurrentScrollCellsWritten: vi.fn(),
			getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		};

		bindCellDuringScroll(deps, {
			cellSlot,
			node: { id: 'rowB', data: { id: 'rowB', name: 'Row B Value' } } as any,
			rowIndex: 5,
			colIndex: 0,
			col: { field: 'name', cellRenderer: () => null } as any,
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
				plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				rowVersions: new Map([['rowB', 1]]),
			} as any,
			pooledRowId: 'slot-1',
			pooledRowGeneration: 1,
			left: 0,
			right: -1,
			width: 100,
			isRowRebind: true,
			isRowLoading: false,
			isInVisibleContent: true,
		});

		// The stale row-A portal must be released, not frozen in place for row B.
		expect(releaseCellPortal).toHaveBeenCalledWith(cellSlot.element, false, 'invalidated', expect.any(String));
		// The slot must land on a deterministic placeholder (empty, since no cheap value is
		// available either) rather than continuing to display row A's live portal content.
		expect(cellSlot.lastContentMode).not.toBe('portal');
		expect(cellSlot.lastContentMode).toBe('empty');
	});
});
