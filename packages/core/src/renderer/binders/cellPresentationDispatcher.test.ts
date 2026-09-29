// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from '../cellSlot.js';
import { PortalRendererHandle } from '../cellRendererHandle.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { dispatchCellPresentation } from './cellPresentationDispatcher.js';
import { createCellCtrl } from '../controllers/CellCtrl.js';
import { getColumnInstanceIdentity } from '../../columnDef.js';

/**
 * One golden test per mode per lane (5 modes x 3 lanes = 15) — proves cellPresentationDispatcher.ts
 * routes each ScrollCellPresentation kind to the correct binder and that binder still performs the
 * same DOM write / telemetry increment the pre-split monolithic applyScrollCellPresentation did.
 * This is a regression harness for the Phase 1 extraction, not a redesign of expected behavior.
 */

function makeDeps(overrides: Partial<RowCellBinderDeps<{ id: string; name: string }>> = {}): RowCellBinderDeps<{ id: string; name: string }> {
	return {
		engine: {
			data: { getCachedDisplayValue: vi.fn(() => undefined) },
			hasFormula: vi.fn(() => false),
			getCellDisplaySnapshot: vi.fn(() => undefined),
			getCheapDisplayValue: vi.fn(() => ''),
			htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
			geometry: { rowHeights: [40] },
		} as any,
		cellRenderer: { showPortalContent: vi.fn(), ensureLoadingSkeleton: vi.fn() } as any,
		portalMountManager: { isCellMounted: vi.fn(() => false), mountCell: vi.fn(), mountCellImmediately: vi.fn() } as any,
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
		incrementForceLiveMountsDuringScroll: vi.fn(),
		incrementLiveReactMountsDuringScroll: vi.fn(),
		incrementHtmlSnapshotHitsDuringScroll: vi.fn(),
		incrementHtmlSnapshotMissesDuringScroll: vi.fn(),
		incrementTextImpostorUsesDuringScroll: vi.fn(),
		getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		...overrides,
	};
}

function makeRequest(
	lane: 'left' | 'center' | 'right',
	overrides: Partial<BindCellDuringScrollRequest<{ id: string; name: string }>> = {}
): BindCellDuringScrollRequest<{ id: string; name: string }> {
	return {
		cellSlot: new CellSlot(document.createElement('div')),
		node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
		rowIndex: 0,
		colIndex: 0,
		col: { field: 'name', cellRenderer: () => null } as any,
		lane,
		ctx: {
			activeEdit: null,
			focusedCell: null,
			globalVersion: 1,
			insightVersion: 0,
			styleVersion: 0,
			selectionVersion: 0,
			loadingVersion: 0,
			hasDeferredCellStyleRules: false,
			isScrolling: true,
			plan: { columnPlans: [{ isCustom: true, mode: 'custom' }], colWidths: [100] },
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
		...overrides,
	};
}

const laneClass: Record<'left' | 'center' | 'right', string> = {
	left: 'og-cell og-cell-pinned-left',
	center: 'og-cell',
	right: 'og-cell og-cell-pinned-right',
};

const LANES: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];

function makeDispatchInput(
	deps: RowCellBinderDeps<{ id: string; name: string }>,
	request: BindCellDuringScrollRequest<{ id: string; name: string }>,
	presentation: ScrollCellPresentation,
	rowVersion: number,
	overrides?: Partial<{ dragShift: number }>
) {
	const cellCtrl = createCellCtrl({
		rowId: request.node.id,
		rowIndex: request.rowIndex,
		rowCtrlKey: request.node.id,
		columnInstanceId: getColumnInstanceIdentity(request.col),
		colId: request.col.colId ?? request.col.field,
		colField: request.col.field,
		colIndex: request.colIndex,
		freshness: {
			rowVersion,
			globalVersion: request.ctx.globalVersion,
			insightVersion: request.ctx.insightVersion,
			styleVersion: request.ctx.styleVersion,
			loadingVersion: request.ctx.loadingVersion,
			selectionVersion: request.ctx.selectionVersion,
		},
	});
	cellCtrl.presentationState = {
		kind: presentation.kind,
		className: presentation.className,
		title: 'title' in presentation ? (presentation.title ?? null) : null,
		validationError: 'validationError' in presentation ? presentation.validationError : undefined,
		requiresFidelity: false,
		freshness: cellCtrl.freshness!,
		contentMode: 'contentMode' in presentation ? presentation.contentMode : undefined,
		formattedValue: 'formattedValue' in presentation ? presentation.formattedValue : undefined,
		portalKey: 'portalCellKey' in presentation ? presentation.portalCellKey : 'portalKey' in presentation ? presentation.portalKey : undefined,
		html: 'frozenHtml' in presentation ? presentation.frozenHtml : undefined,
		markDirty:
			'markDirty' in presentation ? presentation.markDirty : 'shouldMarkDirty' in presentation ? presentation.shouldMarkDirty : undefined,
		isEditing: 'isEditing' in presentation ? presentation.isEditing : false,
		isFocused: 'isFocused' in presentation ? presentation.isFocused : false,
		forceLiveInteractive: 'forceLiveInteractive' in presentation ? presentation.forceLiveInteractive : undefined,
		keepVersionFresh: 'keepVersionFresh' in presentation ? presentation.keepVersionFresh : undefined,
		captureFrozenHtml: 'captureFrozenHtml' in presentation ? presentation.captureFrozenHtml : undefined,
		textImpostorSource: 'source' in presentation ? presentation.source : undefined,
		recordVersions:
			'recordVersionsFrom' in presentation
				? presentation.recordVersionsFrom
				: 'snapshotForCapture' in presentation
					? presentation.snapshotForCapture
					: 'recordVersions' in presentation
						? presentation.recordVersions
						: undefined,
	};
	cellCtrl.rendererState.portalKey = cellCtrl.presentationState.portalKey;
	cellCtrl.visualState.editing = cellCtrl.presentationState.isEditing ?? false;
	cellCtrl.visualState.focused = cellCtrl.presentationState.isFocused ?? false;
	return {
		deps,
		cellCtrl,
		rowCtrl: {
			rowId: request.node.id,
			rowVersion,
			attachedSlotId: undefined,
			attachedGeneration: -1,
			cellKeysByColumnInstanceId: new Map(),
			isEditing: false,
			isFocused: false,
		},
		cellSlot: request.cellSlot,
		viewportPlan: null,
		geometry: {
			rowIndex: request.rowIndex,
			colIndex: request.colIndex,
			left: request.left,
			right: request.right,
			width: request.width,
			dragShift: overrides?.dragShift ?? 0,
			lane: request.lane,
		},
		runtime: {
			globalVersion: request.ctx.globalVersion,
			rowSlotId: request.pooledRowId,
			slotGeneration: request.pooledRowGeneration,
			rowHeight: deps.engine.geometry?.rowHeights?.[request.rowIndex],
			colWidth: request.ctx.plan?.colWidths?.[request.colIndex],
			mount: {
				node: request.node,
				col: request.col,
				value: request.node.data?.name,
				isLoading: request.isRowLoading,
				isSelected: false,
				renderPhase: 'scroll',
			},
		},
		phase: 'scroll' as const,
		rowVersion,
	};
}

describe('cellPresentationDispatcher — one golden test per mode per lane', () => {
	for (const lane of LANES) {
		it(`primitive mode (${lane}): writes text content and releases stale portal`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'primitive',
				className: laneClass[lane],
				contentMode: 'text',
				formattedValue: 'hello',
				markDirty: true,
				title: null,
				validationError: undefined,
				recordVersionsFrom: undefined,
			};
			dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
			expect(request.cellSlot.lastContentMode).toBe('text');
			expect(request.cellSlot.lastFormattedValue).toBe('hello');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
			expect(deps.markCellDirtyAfterScroll).toHaveBeenCalledWith(request.cellSlot.element);
		});

		it(`live mode (${lane}): mounts the real renderer immediately`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'live-renderer',
				className: laneClass[lane],
				portalCellKey: 'ck1',
				isEditing: false,
				isFocused: false,
				forceLiveInteractive: false,
				recordVersionsFrom: undefined,
				title: null,
				validationError: undefined,
			};
			dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
			expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledWith(
				expect.objectContaining({ phase: 'scroll-live', isScrolling: true })
			);
			expect(deps.incrementLiveReactMountsDuringScroll).toHaveBeenCalledTimes(1);
			expect(request.cellSlot.lastContentMode).toBe('portal');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});

		it(`freeze mode (${lane}): freezes an existing live portal in place without remounting`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'frozen-portal',
				className: laneClass[lane],
				portalCellKey: 'ck1',
				title: null,
				validationError: undefined,
				markDirty: false,
				captureFrozenHtml: false,
				keepVersionFresh: false,
				recordVersionsFrom: undefined,
			};
			dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
			expect(deps.cellRenderer.showPortalContent).toHaveBeenCalledWith(request.cellSlot.element);
			expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
			expect(request.cellSlot.lastContentMode).toBe('portal');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});

		it(`text-impostor mode (${lane}): shows the explicit text impostor, never mounts`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'text-impostor',
				className: laneClass[lane],
				contentMode: 'fallback',
				formattedValue: '★ chip',
				recordVersions: { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 },
				title: null,
				validationError: undefined,
				source: 'explicit',
			};
			dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
			expect(deps.incrementTextImpostorUsesDuringScroll).toHaveBeenCalledTimes(1);
			expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
			expect(request.cellSlot.lastFormattedValue).toBe('★ chip');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});

		it(`html-snapshot mode (${lane}): replays frozen HTML into the portal host, never mounts`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'html-snapshot',
				className: laneClass[lane],
				frozenHtml: '<span>frozen</span>',
				recordVersionsFrom: { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 },
				title: null,
				validationError: undefined,
			};
			dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
			expect(deps.incrementHtmlSnapshotHitsDuringScroll).toHaveBeenCalledTimes(1);
			expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
			expect(request.cellSlot.lastContentMode).toBe('portal');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});
	}
});

/**
 * Beyond the 15 golden mode x lane tests above, these cover the editing/focused/loading/rebind
 * dimensions where a binder's DOM-write behavior is actually distinct — not the full 5 x 3 x 2 x 2 x
 * 2 x 2 combinatorial product (most of those cells are identical to a already-covered case; the pure
 * resolver's own exhaustive tests in scrollCellPresentation.test.ts already cover which *presentation*
 * gets chosen for a given editing/focused/rebind combination). What's tested here is narrower and
 * complementary: given a presentation the resolver already decided on, does the binder correctly
 * thread isEditing/isFocused/isLoading into the actual portal mount call, and does
 * freeze-live-portal's rebind-driven shouldMarkDirty flag actually gate markCellDirtyAfterScroll.
 */
describe('cellPresentationDispatcher — editing/focused/loading/rebind flag threading', () => {
	it('live-mount forwards isEditing/isFocused/isRowLoading through to the portal mount call', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowLoading: true });
		const presentation: ScrollCellPresentation = {
			kind: 'live-renderer',
			className: laneClass.center,
			portalCellKey: 'ck1',
			isEditing: true,
			isFocused: true,
			forceLiveInteractive: false,
			recordVersionsFrom: undefined,
			title: null,
			validationError: undefined,
		};
		dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledWith(
			expect.objectContaining({ isEditing: true, isFocused: true, isLoading: true })
		);
	});

	it('force-live-interactive-exception (the rebind-independent editing/focused override) forwards the same flags and its own counter', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowRebind: true });
		const presentation: ScrollCellPresentation = {
			kind: 'live-renderer',
			className: laneClass.center,
			portalCellKey: 'ck1',
			isEditing: true,
			isFocused: false,
			forceLiveInteractive: true,
			recordVersionsFrom: undefined,
			title: null,
			validationError: undefined,
		};
		dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
		expect(deps.incrementForceLiveMountsDuringScroll).toHaveBeenCalledTimes(1);
		expect(deps.incrementLiveReactMountsDuringScroll).not.toHaveBeenCalled();
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledWith(expect.objectContaining({ isEditing: true, isFocused: false }));
	});

	it('freeze-live-portal with shouldMarkDirty:true (driven by a rebind/version-drift the resolver detected) marks the cell dirty', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowRebind: true });
		const presentation: ScrollCellPresentation = {
			kind: 'frozen-portal',
			className: laneClass.center,
			portalCellKey: 'ck1',
			title: null,
			validationError: undefined,
			markDirty: true,
			captureFrozenHtml: false,
			keepVersionFresh: false,
			recordVersionsFrom: undefined,
		};
		dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
		expect(deps.markCellDirtyAfterScroll).toHaveBeenCalledWith(request.cellSlot.element);
	});

	it('releases a stale portal handle once, not again on every later bind', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowRebind: true });
		// The slot still holds the editor portal of the row that scrolled out.
		request.cellSlot.renderer = new PortalRendererHandle('E4:MA.65:coli3');
		const shell: ScrollCellPresentation = {
			kind: 'frozen-portal',
			className: laneClass.center,
			portalCellKey: 'ck-new-row',
			title: null,
			validationError: undefined,
			markDirty: true,
			captureFrozenHtml: false,
			keepVersionFresh: false,
			recordVersionsFrom: undefined,
		};

		dispatchCellPresentation(makeDispatchInput(deps, request, shell, 1));
		dispatchCellPresentation(makeDispatchInput(deps, request, shell, 1));

		expect(deps.releaseCellPortal).toHaveBeenCalledTimes(1);
		expect(request.cellSlot.renderer).not.toBeInstanceOf(PortalRendererHandle);
	});

	it('freeze-live-portal with shouldMarkDirty:false does not mark the cell dirty', () => {
		const deps = makeDeps();
		const request = makeRequest('center');
		const presentation: ScrollCellPresentation = {
			kind: 'frozen-portal',
			className: laneClass.center,
			portalCellKey: 'ck1',
			title: null,
			validationError: undefined,
			markDirty: false,
			captureFrozenHtml: false,
			keepVersionFresh: false,
			recordVersionsFrom: undefined,
		};
		dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
		expect(deps.markCellDirtyAfterScroll).not.toHaveBeenCalled();
	});

	it('html-snapshot-pending (the loading-adjacent no-capture-yet case) writes a pending shell, not the frozen-HTML portal path', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowLoading: true });
		const presentation: ScrollCellPresentation = {
			kind: 'html-pending',
			className: laneClass.center,
			title: null,
			validationError: undefined,
			recordVersions: { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 },
		};
		dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1));
		expect(deps.incrementHtmlSnapshotMissesDuringScroll).toHaveBeenCalledTimes(1);
		expect(request.cellSlot.lastContentMode).toBe('pending');
		expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
	});

	it('threads dragShift through the binder so body cells can follow live header reorder preview', () => {
		const deps = makeDeps();
		const request = makeRequest('center');
		const presentation: ScrollCellPresentation = {
			kind: 'primitive',
			className: laneClass.center,
			contentMode: 'text',
			formattedValue: 'hello',
			markDirty: false,
			title: null,
			validationError: undefined,
			recordVersionsFrom: undefined,
		};
		dispatchCellPresentation(makeDispatchInput(deps, request, presentation, 1, { dragShift: 24 }));
		expect(request.cellSlot.lastShift).toBe(24);
		expect(request.cellSlot.element.style.transform).toContain('translateX(24px)');
	});
});

describe('cellPresentationDispatcher — the one portal transition rule', () => {
	// A cell holding portal 'held' moves to each presentation. The held portal is released exactly
	// once (across repeated binds) unless the next presentation keeps that same portal.
	const cases: Array<[string, Partial<ReturnType<typeof makeDispatchInput>['cellCtrl']['presentationState']>, boolean]> = [
		['primitive', { kind: 'primitive', contentMode: 'text', formattedValue: 'x' }, true],
		['buffered text', { kind: 'buffered', contentMode: 'text', formattedValue: 'x', portalKey: undefined }, true],
		['buffered keeping the portal', { kind: 'buffered', contentMode: 'portal', portalKey: 'held' }, false],
		['loading', { kind: 'loading', formattedValue: '' }, true],
		['shell', { kind: 'shell', contentMode: 'fallback', formattedValue: 'x' }, true],
		['text-impostor', { kind: 'text-impostor', contentMode: 'fallback', formattedValue: 'x', textImpostorSource: 'explicit' }, true],
		['html-pending', { kind: 'html-pending' }, true],
		['html-snapshot', { kind: 'html-snapshot', html: '<b>x</b>' }, true],
		['frozen-portal of the same key', { kind: 'frozen-portal', portalKey: 'held' }, false],
		['live renderer of the same key', { kind: 'live-renderer', portalKey: 'held' }, false],
		['live renderer of another key', { kind: 'live-renderer', portalKey: 'other' }, true],
		['checkbox selector', { kind: 'checkbox-selector', markDirty: false }, true],
	];
	for (const [name, next, expectRelease] of cases) {
		it(`${expectRelease ? 'releases' : 'keeps'} the held portal when moving to ${name}`, () => {
			const deps = makeDeps();
			const request = makeRequest('center');
			request.cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'held');
			const base: ScrollCellPresentation = {
				kind: 'primitive',
				className: 'og-cell',
				contentMode: 'text',
				formattedValue: '',
				markDirty: false,
				title: null,
				validationError: undefined,
				recordVersionsFrom: undefined,
			};
			for (let bind = 0; bind < 2; bind++) {
				const input = makeDispatchInput(deps, request, base, 1);
				Object.assign(input.cellCtrl.presentationState, next);
				dispatchCellPresentation(input);
			}
			const releasesOfHeld = (deps.releaseCellPortal as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[3] === 'held');
			expect(releasesOfHeld).toHaveLength(expectRelease ? 1 : 0);
		});
	}
});
