// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GridEventName } from './api/GridEvents.js';
import { ClientRowModelController } from './rowModel.js';
import { GridStore } from './store.js';
import { RenderEngine } from './renderer/renderEngine.js';
import { RuntimeFaultReporter } from './diagnostics/RuntimeFaultReporter.js';

type CompositionRow = {
	id: string;
	team: string;
	city: string;
	score: number;
	note: string;
	formula: string;
	name: string;
	parentId?: string | null;
	status?: string;
};

function createContainer(): HTMLDivElement {
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 520,
		bottom: 200,
		width: 520,
		height: 200,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	return container;
}

function slotDomCount(rowsContainer: HTMLElement): number {
	return Array.from(rowsContainer.children).filter((child) => !child.classList.contains('og-layer-exiting')).length;
}

function drainRafQueue(callbacks: FrameRequestCallback[]): void {
	while (callbacks.length > 0) {
		const callback = callbacks.shift();
		callback?.(0);
	}
}

function mockClipboard() {
	let stored = '';
	const writeText = vi.fn(async (text: string) => {
		stored = text;
	});
	const readText = vi.fn(async () => stored);
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText, readText },
		configurable: true,
		writable: true,
	});
	return {
		writeText,
		readText,
		setStored: (value: string) => {
			stored = value;
		},
	};
}

// Runtime faults are reported, not thrown, so a composition can pass every assertion while the
// renderer quietly faults. Every scenario must also finish fault-free.
let runtimeFaults: string[] = [];
beforeEach(() => {
	runtimeFaults = [];
	const report = RuntimeFaultReporter.prototype.report;
	vi.spyOn(RuntimeFaultReporter.prototype, 'report').mockImplementation(function (this: RuntimeFaultReporter, ...args) {
		runtimeFaults.push(`${args[0].source}:${args[0].operation}`);
		return report.apply(this, args);
	});
});

afterEach(() => {
	expect(runtimeFaults).toEqual([]);
	document.body.textContent = '';
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('Plan 142 - cross-feature composition gauntlets', () => {
	it('keeps selection, focus, and targeted invalidation coherent through sort + filter + grouping composition', () => {
		const store = new GridStore<CompositionRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'team', header: 'Team', enableRowGroup: true },
				{ field: 'city', header: 'City' },
				{ field: 'score', header: 'Score' },
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', team: 'East', city: 'Austin', score: 40, note: 'ok', formula: '', name: 'A' },
				{ id: 'r2', team: 'West', city: 'Boston', score: 10, note: 'ok', formula: '', name: 'B' },
				{ id: 'r3', team: 'East', city: 'Atlanta', score: 30, note: 'ok', formula: '', name: 'C' },
				{ id: 'r4', team: 'East', city: 'Chicago', score: 20, note: 'ok', formula: '', name: 'D' },
			],
			columns: store.getState().columns,
		});
		const events: string[] = [];
		store.addEventListener(GridEventName.renderInvalidated, () => events.push('renderInvalidated'));
		store.addEventListener(GridEventName.groupByChanged, () => events.push('groupByChanged'));
		store.addEventListener(GridEventName.sortChanged, () => events.push('sortChanged'));
		store.addEventListener(GridEventName.filterChanged, () => events.push('filterChanged'));

		store.engine.invalidation.consume();
		store.setGroupBy(['team']);
		expect(events.splice(0)).toEqual(['renderInvalidated', 'groupByChanged']);
		const groupFrame = store.engine.invalidation.consume();
		expect(groupFrame.full).toBe(false);
		expect(groupFrame.viewport).toBe(true);
		expect(groupFrame.headers).toBe(true);
		expect(groupFrame.overlay).toBe(true);

		const eastGroup = Array.from({ length: store.getVisualRowCount() }, (_, index) => store.getVisualRow(index)).find((row) => {
			if (row?.kind !== 'group') return false;
			return row.groupId.includes('East') || row.id.includes('East');
		});
		expect(eastGroup?.kind).toBe('group');

		store.toggleGroupExpanded(eastGroup!.groupId);
		const expandFrame = store.engine.invalidation.consume();
		expect(expandFrame.full).toBe(false);
		expect(expandFrame.viewport).toBe(true);
		expect(expandFrame.groups.has(eastGroup!.groupId)).toBe(true);
		expect(expandFrame.rowRanges.length).toBeGreaterThan(0);

		store.selectRange({ rowId: 'r4', colField: 'score' }, { rowId: 'r4', colField: 'score' });
		const selectionFrame = store.engine.invalidation.consume();
		expect(selectionFrame.full).toBe(false);
		expect(selectionFrame.rows.has('r4')).toBe(true);
		expect(selectionFrame.headers).toBe(true);
		store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['r4'], source: 'api' });
		const rowSelectionFrame = store.engine.invalidation.consume();
		expect(rowSelectionFrame.full).toBe(false);
		expect(rowSelectionFrame.rows.has('r4')).toBe(true);
		expect(rowSelectionFrame.headers).toBe(true);

		store.setSortModel([{ colId: 'score', sort: 'asc' }]);
		const sortEvents = events.splice(0);
		expect(sortEvents.filter((event) => event === 'sortChanged')).toHaveLength(1);
		expect(sortEvents.indexOf('renderInvalidated')).toBeGreaterThanOrEqual(0);
		expect(sortEvents.indexOf('sortChanged')).toBeGreaterThan(sortEvents.indexOf('renderInvalidated'));
		const sortFrame = store.engine.invalidation.consume();
		expect(sortFrame.full).toBe(false);
		expect(sortFrame.viewport).toBe(true);
		expect(sortFrame.headers).toBe(true);

		store.setFilterModel({ city: { type: 'text', operator: 'contains', value: 'c' } });
		const filterEvents = events.splice(0);
		expect(filterEvents.filter((event) => event === 'filterChanged')).toHaveLength(1);
		expect(filterEvents.indexOf('renderInvalidated')).toBeGreaterThanOrEqual(0);
		expect(filterEvents.indexOf('filterChanged')).toBeGreaterThan(filterEvents.indexOf('renderInvalidated'));
		const filterFrame = store.engine.invalidation.consume();
		expect(filterFrame.full).toBe(false);
		expect(filterFrame.viewport).toBe(true);
		expect(filterFrame.overlay).toBe(true);

		expect(store.getSelectedRowIds()).toEqual(['r4']);
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'r4', colField: 'score' }));
		expect(store.getState().selection.anchor).toEqual(expect.objectContaining({ rowId: 'r4', colField: 'score' }));
		expect(store.getVisualIndexByRowId('r4')).toBe(1);
		expect(store.getVisualRow(1)?.kind).toBe('data');
		expect(store.getVisualRow(1)?.node.data.id).toBe('r4');
		expect(store.getState().selection.bounds).toEqual({ minRow: 1, maxRow: 1, minCol: 2, maxCol: 2 });

		controller.dispose();
		store.destroy();
	});

	it('keeps formulas, validation, paste/fill writes, and undo/redo boundaries coherent', async () => {
		mockClipboard().setStored('7\t\n8\tready');
		const store = new GridStore<CompositionRow>(
			{
				getRowId: (row) => row.id,
				columns: [
					{ field: 'score', header: 'Score' },
					{ field: 'note', header: 'Note' },
					{ field: 'formula', header: 'Formula' },
				],
			},
			{
				dataIntegrity: {
					validation: {
						cellRules: [
							{ id: 'required-note', field: 'note', validate: ({ value }) => (value ? null : { message: 'Note is required' }) },
						],
					},
				},
			}
		);
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', team: 'East', city: 'Austin', score: 5, note: 'seed', formula: '', name: 'A' },
				{ id: 'r2', team: 'East', city: 'Boston', score: 10, note: 'seed', formula: '', name: 'B' },
				{ id: 'r3', team: 'West', city: 'Chicago', score: 15, note: 'seed', formula: '', name: 'C' },
			],
			columns: store.getState().columns,
		});
		const events: string[] = [];
		store.addEventListener(GridEventName.renderInvalidated, () => events.push('renderInvalidated'));
		store.addEventListener(GridEventName.cellsPasted, () => events.push('cellsPasted'));

		store.setCellValue('r1', 'formula', '=[r1:score]*2', false);
		store.engine.invalidation.consume();

		store.setCellValue('r1', 'note', '');
		await new Promise((res) => setTimeout(res, 0));
		expect(store.engine.dataIntegrity?.getCellErrorMessage('r1', 'note')).toBe('Note is required');

		store.engine.fillRange(
			{
				start: { rowId: 'r1', colField: 'formula' },
				end: { rowId: 'r1', colField: 'formula' },
			},
			{
				start: { rowId: 'r2', colField: 'formula' },
				end: { rowId: 'r3', colField: 'formula' },
			}
		);
		const fillFrame = store.engine.invalidation.consume();
		expect(fillFrame.full).toBe(false);
		expect(store.getCellValue('r2', 'formula')).toBe(20);
		expect(store.getCellValue('r3', 'formula')).toBe(30);
		expect(store.canUndo()).toBe(true);

		events.length = 0;
		store.selectCell({ rowId: 'r2', colField: 'score' });
		store.engine.invalidation.consume();
		await store.pasteFromClipboard();
		const pasteEvents = events.splice(0);
		expect(pasteEvents.filter((event) => event === 'cellsPasted')).toHaveLength(1);
		expect(pasteEvents.indexOf('renderInvalidated')).toBeGreaterThanOrEqual(0);
		expect(pasteEvents.indexOf('cellsPasted')).toBeGreaterThan(pasteEvents.indexOf('renderInvalidated'));
		const pasteFrame = store.engine.invalidation.consume();
		expect(pasteFrame.full).toBe(false);

		expect(store.getCellValue('r2', 'score')).toBe('7');
		expect(store.getCellValue('r3', 'score')).toBe('8');
		expect(store.getCellState('r2', 'formula').value).toBe('=[r2:score]*2');
		expect(store.getCellState('r3', 'formula').value).toBe('=[r3:score]*2');
		expect(store.getCellValue('r2', 'formula')).toBe(14);
		expect(store.getCellValue('r3', 'formula')).toBe(16);
		await new Promise((res) => setTimeout(res, 0));
		expect(store.engine.dataIntegrity?.getCellErrorMessage('r2', 'note')).toBe('Note is required');
		expect(store.engine.dataIntegrity?.getCellErrorMessage('r3', 'note')).toBeNull();

		store.undo();
		expect(store.getCellValue('r2', 'score')).toBe(10);
		expect(store.getCellValue('r3', 'score')).toBe(15);
		expect(store.getCellValue('r2', 'formula')).toBe(20);
		expect(store.getCellValue('r3', 'formula')).toBe(30);
		await store.integrity.validateCell('r2', 'note');
		expect(store.engine.dataIntegrity?.getCellErrorMessage('r2', 'note')).toBeNull();

		store.undo();
		expect(store.getCellState('r2', 'formula').value).toBe('');
		expect(store.getCellState('r3', 'formula').value).toBe('');
		expect(store.engine.hasFormula('r2', 'formula')).toBe(false);
		expect(store.engine.hasFormula('r3', 'formula')).toBe(false);

		store.redo();
		expect(store.getCellValue('r2', 'formula')).toBe(20);
		expect(store.getCellValue('r3', 'formula')).toBe(30);

		store.redo();
		expect(store.getCellValue('r2', 'formula')).toBe(14);
		expect(store.getCellValue('r3', 'formula')).toBe(16);
		await store.integrity.validateCell('r2', 'note');
		expect(store.engine.dataIntegrity?.getCellErrorMessage('r2', 'note')).toBe('Note is required');

		controller.dispose();
		store.destroy();
	});

	it('keeps the hot scroll path and custom renderer hydration stable under targeted writes', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});

		const store = new GridStore<CompositionRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name', width: 160, cellRenderer: () => null }],
			defaultRowHeight: 40,
			defaultColWidth: 160,
			rowOverscanPx: 0,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 100 }, (_, index) => ({
				id: `row-${index}`,
				name: `Row ${index}`,
				team: index % 2 === 0 ? 'East' : 'West',
				city: `City ${index}`,
				score: index,
				note: 'ok',
				formula: '',
			})),
			columns: store.getState().columns,
		});
		const container = createContainer();
		const renderer = new RenderEngine(store.engine, store);
		const lifecycleLog: string[] = [];
		const invalidationSpy = vi.spyOn(store.engine.invalidation, 'applyNormalizedPlan');

		renderer.onMountCellContent = ({ container: portalHost, value, lifecycleOperation }) => {
			lifecycleLog.push(lifecycleOperation ?? 'update');
			portalHost.textContent = `${lifecycleOperation ?? 'update'}:${String(value)}`;
		};
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.mount(container);

		const rowsContainer = container.querySelector('.og-rows-container') as HTMLElement;
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		lifecycleLog.length = 0;
		invalidationSpy.mockClear();
		renderer.resetRenderStats();

		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));
		if (callbacks.length > 0) callbacks.shift()?.(0);

		const visibleCell = container.querySelector<HTMLElement>('.og-cell[data-row-id="row-40"][data-col-field="name"]');
		expect(visibleCell).not.toBeNull();
		expect(container.querySelector('.og-cell[data-content-mode="pending"]')).toBeNull();
		expect(renderer.portalMountManager.onUnmountCellContent).not.toHaveBeenCalled();

		lifecycleLog.length = 0;
		store.setCellValue('row-40', 'name', 'Updated 40');
		expect(invalidationSpy).toHaveBeenCalled();
		const targetedPlan = invalidationSpy.mock.calls.at(-1)?.[0];
		expect(targetedPlan?.full).toBe(false);

		drainRafQueue(callbacks);

		const updatedCell = container.querySelector<HTMLElement>('.og-cell[data-row-id="row-40"][data-col-field="name"]');
		expect(updatedCell?.dataset.contentMode).toBe('portal');
		expect(updatedCell?.textContent).toContain('Updated 40');
		expect(lifecycleLog).toContain('update');
		expect(renderer.portalMountManager.onUnmountCellContent).not.toHaveBeenCalled();
		expect(renderer.rowRenderer.rowSlotPool.count).toBe(slotDomCount(rowsContainer));

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps tree structure, pinned lanes, focus, selection, and copy coherent through structural moves', async () => {
		const clipboard = mockClipboard();
		const store = new GridStore<CompositionRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'name', header: 'Name', width: 160, pinned: 'left' },
				{ field: 'score', header: 'Score', width: 100 },
				{ field: 'status', header: 'Status', width: 120, pinned: 'right' },
			],
			pinnedColumns: { left: 1, right: 1 },
			rowModelConfig: {
				type: 'client',
				treeData: {
					enabled: true,
					getParentId: (row) => row.parentId ?? null,
					getParentIdDependencies: ['parentId'],
				},
			},
			expansion: {
				groups: {},
				treeRows: { root: true, other: true },
				details: {},
			},
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'root', parentId: null, name: 'Root', team: 'A', city: 'Austin', score: 0, note: 'ok', formula: '', status: 'Open' },
				{ id: 'child-a', parentId: 'root', name: 'Child A', team: 'A', city: 'Boston', score: 1, note: 'ok', formula: '', status: 'Open' },
				{ id: 'child-b', parentId: 'root', name: 'Child B', team: 'A', city: 'Chicago', score: 2, note: 'ok', formula: '', status: 'Open' },
				{ id: 'other', parentId: null, name: 'Other Root', team: 'B', city: 'Denver', score: 3, note: 'ok', formula: '', status: 'Closed' },
			],
			columns: store.getState().columns,
		});

		expect(store.getPinnedColumns()).toEqual({ left: 1, right: 1 });
		store.selectCell({ rowId: 'child-b', colField: 'name' });
		store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['child-b'], source: 'api' });
		await store.copySelectedRange();
		expect(clipboard.writeText).toHaveBeenCalledWith('Child B');

		const beforeMoveIndex = store.getVisualIndexByRowId('child-b');
		store.updateRows((rows) => rows.map((row) => (row.id === 'child-b' ? { ...row, parentId: 'other' } : row)));

		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'child-b', colField: 'name' }));
		expect(store.getSelectedRowIds()).toEqual(['child-b']);
		expect(store.getVisualIndexByRowId('child-b')).not.toBe(beforeMoveIndex);
		expect(store.getVisualIndexByRowId('child-b')).toBeGreaterThan(store.getVisualIndexByRowId('other'));

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'Child' } });
		expect(store.getVisualIndexByRowId('other')).toBeGreaterThanOrEqual(0);
		expect(store.getVisualIndexByRowId('child-b')).toBeGreaterThan(store.getVisualIndexByRowId('other'));
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'child-b', colField: 'name' }));

		store.selectCell({ rowId: 'other', colField: 'name' });
		store.toggleGroupExpanded('other');
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'other', colField: 'name' }));
		expect(store.getSelectedRowIds()).toEqual(['child-b']);
		expect(store.getVisualIndexByRowId('child-b')).toBeNull();

		store.toggleGroupExpanded('other');
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'other', colField: 'name' }));
		expect(store.getSelectedRowIds()).toEqual(['child-b']);
		expect(store.getVisualIndexByRowId('child-b')).toBeGreaterThan(store.getVisualIndexByRowId('other'));

		controller.dispose();
		store.destroy();
	});

	it('keeps grouped detail rows, sticky structure, pinned lanes, and variable-height geometry coherent under scroll and targeted writes', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});

		const store = new GridStore<CompositionRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'name', header: 'Name', width: 160 },
				{ field: 'team', header: 'Team', width: 120 },
				{ field: 'score', header: 'Score', width: 120 },
				{ field: 'status', header: 'Status', width: 120 },
			],
			groupBy: ['team'],
			enableStickyGroupRows: true,
			masterDetailEnabled: true,
			detailRowHeight: 120,
			pinnedColumns: { left: 1, right: 1 },
			expansion: {
				groups: { 'group:team=East': true, 'group:team=West': true },
				treeRows: {},
				details: { 'row-12': true },
			},
			defaultRowHeight: 40,
			defaultColWidth: 120,
			rowOverscanPx: 0,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, index) => ({
				id: `row-${index}`,
				name: `Row ${index}`,
				team: index < 20 ? 'East' : 'West',
				city: `City ${index}`,
				score: index,
				note: 'ok',
				formula: '',
				status: index % 2 === 0 ? 'Ready' : 'Hold',
			})),
			columns: store.getState().columns,
		});
		const container = createContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		store.selectCell({ rowId: 'row-12', colField: 'name' });
		const rowIndexBeforeSort = store.getVisualIndexByRowId('row-12');
		expect(store.getVisualRow(rowIndexBeforeSort + 1)?.kind).toBe('detail');
		expect(Array.from(store.engine.geometry.rowHeights)[rowIndexBeforeSort + 1]).toBe(120);

		store.setSortModel([{ colId: 'score', sort: 'desc' }]);
		const rowIndexAfterSort = store.getVisualIndexByRowId('row-12');
		expect(rowIndexAfterSort).not.toBe(rowIndexBeforeSort);
		expect(store.getVisualRow(rowIndexAfterSort + 1)?.kind).toBe('detail');
		expect(Array.from(store.engine.geometry.rowHeights)[rowIndexAfterSort + 1]).toBe(120);
		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'row-12', colField: 'name' }));

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = Math.max(0, rowIndexAfterSort * 40 - 80);
		scrollViewport.dispatchEvent(new Event('scroll'));
		drainRafQueue(callbacks);

		expect(container.querySelector('.og-sticky-group-row-host')).not.toBeNull();
		expect(container.querySelector('.og-cell-pinned-left')).not.toBeNull();
		expect(container.querySelector('.og-cell-pinned-right')).not.toBeNull();

		store.setCellValue('row-12', 'status', 'Updated');
		drainRafQueue(callbacks);
		expect(store.getCellValue('row-12', 'status')).toBe('Updated');
		expect(store.getVisualRow(store.getVisualIndexByRowId('row-12') + 1)?.kind).toBe('detail');
		expect(container.querySelector('.og-row-detail')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});
});
