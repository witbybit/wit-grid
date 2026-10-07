// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from '../cellSlot.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { applyLiveCellPresentation } from './liveCellBinder.js';
import { createCellCtrl } from '../controllers/CellCtrl.js';
import { getColumnInstanceIdentity } from '../../columnDef.js';

/**
 * Deterministic unit tests for the LiveFrameBudget mount/update/stand-in branching in
 * liveCellBinder.ts's 'live-mount' case — see liveFrameBudget.ts. These bypass a real virtualized
 * grid (where portal cellKeys recycle per physical CellSlot, so "fresh mount vs update" is hard to
 * force deterministically — see the caveat in liveFrameBudget.e2e.test.ts) and instead mock
 * portalMountManager.isCellMounted/tryConsumeLiveBudget directly.
 */

function makeDeps(overrides: Partial<RowCellBinderDeps<{ id: string; name: string }>> = {}): RowCellBinderDeps<{ id: string; name: string }> {
	return {
		engine: {
			data: { getCachedDisplayValue: vi.fn(() => undefined) },
			hasFormula: vi.fn(() => false),
			getCellDisplaySnapshot: vi.fn(() => undefined),
			getCheapDisplayValue: vi.fn(() => ''),
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
		incrementCurrentScrollCellsWritten: vi.fn(),
		incrementForceLiveMountsDuringScroll: vi.fn(),
		incrementLiveReactMountsDuringScroll: vi.fn(),
		incrementLiveReactUpdatesDuringScroll: vi.fn(),
		incrementLiveReactStandInsDuringScroll: vi.fn(),
		getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		...overrides,
	};
}

function makeRequest(overrides: Partial<BindCellDuringScrollRequest<{ id: string; name: string }>> = {}): BindCellDuringScrollRequest<{
	id: string;
	name: string;
}> {
	return {
		cellSlot: new CellSlot(document.createElement('div')),
		node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
		rowIndex: 0,
		colIndex: 0,
		col: { field: 'name', cellRenderer: () => null, instanceId: 'coli1' } as any,
		lane: 'center',
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

function makeLiveMountPresentation(): Extract<ScrollCellPresentation, { kind: 'live-mount' }> {
	return {
		kind: 'live-mount',
		className: 'og-cell',
		portalCellKey: 'ck1',
		isEditing: false,
		isFocused: false,
		recordVersionsFrom: undefined,
		title: null,
		validationError: undefined,
	};
}

function makeDispatchInput(
	deps: RowCellBinderDeps<{ id: string; name: string }>,
	request: BindCellDuringScrollRequest<{ id: string; name: string }>,
	presentation: Extract<ScrollCellPresentation, { kind: 'live-mount' | 'force-live-interactive-exception' }>,
	rowVersion: number
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
	cellCtrl.visualState.editing = presentation.isEditing;
	cellCtrl.visualState.focused = presentation.isFocused;
	cellCtrl.presentationState = {
		kind: presentation.kind,
		className: presentation.className,
		title: presentation.title ?? null,
		validationError: presentation.validationError,
		needsPostScrollRepair: false,
		freshness: cellCtrl.freshness!,
		portalKey: presentation.portalCellKey,
		isEditing: presentation.isEditing,
		isFocused: presentation.isFocused,
		recordVersions: presentation.recordVersionsFrom,
	};
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

describe('liveCellBinder — LiveFrameBudget branching', () => {
	it('within budget + fresh mount: mounts and counts as a mount, not an update', () => {
		const deps = makeDeps({
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately: vi.fn() } as any,
			tryConsumeLiveBudget: vi.fn(() => true),
		});
		applyLiveCellPresentation(makeDispatchInput(deps, makeRequest(), makeLiveMountPresentation(), 1));

		expect(deps.tryConsumeLiveBudget).toHaveBeenCalledWith('mount');
		expect(deps.incrementLiveReactMountsDuringScroll).toHaveBeenCalledTimes(1);
		expect(deps.incrementLiveReactUpdatesDuringScroll).not.toHaveBeenCalled();
		expect(deps.incrementLiveReactStandInsDuringScroll).not.toHaveBeenCalled();
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledTimes(1);
	});

	it('within budget + already mounted: mounts (re-renders) and counts as an update', () => {
		const deps = makeDeps({
			portalMountManager: { isCellMounted: vi.fn(() => true), mountCellImmediately: vi.fn() } as any,
			tryConsumeLiveBudget: vi.fn(() => true),
		});
		applyLiveCellPresentation(makeDispatchInput(deps, makeRequest(), makeLiveMountPresentation(), 1));

		expect(deps.tryConsumeLiveBudget).toHaveBeenCalledWith('update');
		expect(deps.incrementLiveReactUpdatesDuringScroll).toHaveBeenCalledTimes(1);
		expect(deps.incrementLiveReactMountsDuringScroll).not.toHaveBeenCalled();
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledTimes(1);
	});

	it('over budget + fresh mount: shows an stand-in instead of mounting', () => {
		const deps = makeDeps({
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately: vi.fn() } as any,
			tryConsumeLiveBudget: vi.fn(() => false),
		});
		const request = makeRequest();
		applyLiveCellPresentation(makeDispatchInput(deps, request, makeLiveMountPresentation(), 1));

		expect(deps.incrementLiveReactStandInsDuringScroll).toHaveBeenCalledTimes(1);
		expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
		expect(deps.incrementLiveReactMountsDuringScroll).not.toHaveBeenCalled();
		expect(request.cellSlot.lastContentMode).toBe('pending');
	});

	it("over budget + already mounted for this row: skips this frame's update, leaves DOM untouched", () => {
		const deps = makeDeps({
			portalMountManager: { isCellMounted: vi.fn(() => true), mountCellImmediately: vi.fn() } as any,
			tryConsumeLiveBudget: vi.fn(() => false),
		});
		const request = makeRequest();
		request.cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'ck1');
		applyLiveCellPresentation(makeDispatchInput(deps, request, makeLiveMountPresentation(), 1));

		expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
		expect(deps.incrementLiveReactUpdatesDuringScroll).not.toHaveBeenCalled();
		expect(deps.incrementLiveReactStandInsDuringScroll).not.toHaveBeenCalled();
		expect(request.cellSlot.lastContentMode).toBe('portal');
	});

	it("over budget in a slot recycled from another row: hides that row's content behind the cell's text", () => {
		const deps = makeDeps({
			engine: { ...(makeDeps().engine as any), getCheapDisplayValue: vi.fn(() => 'Name 1') } as any,
			portalMountManager: { isCellMounted: vi.fn(() => true), mountCellImmediately: vi.fn() } as any,
			tryConsumeLiveBudget: vi.fn(() => false),
		});
		const request = makeRequest();
		request.cellSlot.update(0, 'name', 0, 'r0', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'ck1');
		applyLiveCellPresentation(makeDispatchInput(deps, request, makeLiveMountPresentation(), 1));

		expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
		expect(deps.incrementLiveReactStandInsDuringScroll).toHaveBeenCalledTimes(1);
		expect(request.cellSlot.rowId).toBe('r1');
		expect(request.cellSlot.lastContentMode).toBe('fallback');
		expect(request.cellSlot.element.textContent).toContain('Name 1');
	});

	it('over budget for a fresh mount: shows the cell text, not a blank cell', () => {
		const deps = makeDeps({
			engine: { ...(makeDeps().engine as any), getCheapDisplayValue: vi.fn(() => 'Name 1') } as any,
			tryConsumeLiveBudget: vi.fn(() => false),
		});
		const request = makeRequest();
		applyLiveCellPresentation(makeDispatchInput(deps, request, makeLiveMountPresentation(), 1));
		expect(request.cellSlot.lastContentMode).toBe('fallback');
		expect(request.cellSlot.element.textContent).toContain('Name 1');
	});

	it('omitted tryConsumeLiveBudget (no scheduler wired) defaults to unlimited — behaves as before', () => {
		const deps = makeDeps({
			portalMountManager: { isCellMounted: vi.fn(() => false), mountCellImmediately: vi.fn() } as any,
		});
		applyLiveCellPresentation(makeDispatchInput(deps, makeRequest(), makeLiveMountPresentation(), 1));

		expect(deps.incrementLiveReactMountsDuringScroll).toHaveBeenCalledTimes(1);
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledTimes(1);
	});
});
