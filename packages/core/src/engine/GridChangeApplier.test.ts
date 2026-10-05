import { describe, it, expect, vi } from 'vitest';
import { GridChangeApplier, GridCommitKernel, type GridChangeApplierDeps, type GridCommitKernelDeps } from './GridChangeApplier.js';
import { StateManager } from '../state/StateManager.js';
import { InvalidationManager } from '../renderer/invalidationManager.js';
import { EventBus } from '../events/EventBus.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { GridEventName } from '../store.js';
import { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import { createDefaultGridDomainMutationExecutorRegistry } from './GridDomainMutation.js';
import type { InternalGridState } from '../state/GridState.js';

type TestRow = { id: string; name: string };

function makeApplier(): {
	applier: GridChangeApplier<TestRow>;
	stateManager: StateManager<TestRow>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TestRow>;
	commandHistory: CommandHistory;
	requestRender: ReturnType<typeof vi.fn>;
	publishDomains: ReturnType<typeof vi.fn>;
	projectStateChange: ReturnType<typeof vi.fn>;
	faultReporter: RuntimeFaultReporter<TestRow>;
} {
	const stateManager = new StateManager<TestRow>({
		columns: [],
		selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
		selectedRowIds: [],
		rowHeights: {},
		columnWidths: {},
		defaultRowHeight: 40,
		defaultColWidth: 100,
		enableColumnReorder: true,
		activeEdit: null,
		sortModel: null,
		filterModel: null,
		globalVersion: 0,
		visibleRowRange: { startIdx: 0, endIdx: 0 },
		visibleColRange: { startIdx: 0, endIdx: 0 },
		expansion: { groups: {}, treeRows: {}, details: {} },
		rowOverscanPx: 400,
		colBuffer: 1,
	} as unknown as InternalGridState<TestRow>);

	const invalidation = new InvalidationManager();
	const eventBus = new EventBus<TestRow>();
	const faultReporter = new RuntimeFaultReporter<TestRow>({ log: () => undefined });
	eventBus.setRuntimeFaultReporter(faultReporter);
	const commandHistory = new CommandHistory(faultReporter);
	const requestRender = vi.fn();
	const publishDomains = vi.fn();
	const projectStateChange = vi.fn();

	const deps: GridChangeApplierDeps<TestRow> = {
		stateManager,
		invalidation,
		eventBus,
		commandHistory,
		requestRender,
		publishDomains,
		projectStateChange,
		faultReporter,
	};

	return {
		applier: new GridChangeApplier(deps),
		stateManager,
		invalidation,
		eventBus,
		commandHistory,
		requestRender,
		publishDomains,
		projectStateChange,
		faultReporter,
	};
}

describe('GridChangeApplier', () => {
	it('returns a committed result for a state change', () => {
		const { applier, stateManager } = makeApplier();

		const result = applier.apply({
			reason: 'test',
			state: { columnWidths: { name: 200 } },
		});

		expect(result).toEqual({ status: 'committed', changeId: 1, faults: [] });
		expect(stateManager.getState().columnWidths).toEqual({ name: 200 });
	});

	it('returns noop when there is no work and rendering is suppressed', () => {
		const { applier, requestRender } = makeApplier();

		const result = applier.apply({
			reason: 'noop',
			requestRender: false,
		});

		expect(result).toEqual({ status: 'noop' });
		expect(requestRender).not.toHaveBeenCalled();
	});

	it('rejects precondition failures atomically', () => {
		const { applier, stateManager, requestRender } = makeApplier();

		const result = applier.apply({
			reason: 'precondition',
			precondition: () => 'blocked',
			state: { columnWidths: { name: 250 } },
		});

		expect(result).toEqual({ status: 'rejected', reason: 'blocked' });
		expect(stateManager.getState().columnWidths).toEqual({});
		expect(requestRender).not.toHaveBeenCalled();
	});

	it('fails-before-commit when a precondition throws without committing state', () => {
		const { applier, stateManager, faultReporter } = makeApplier();

		const result = applier.apply({
			reason: 'precondition-throws',
			precondition: () => {
				throw new Error('bad precondition');
			},
			state: { columnWidths: { name: 250 } },
		});

		expect(result.status).toBe('failed-before-commit');
		expect(stateManager.getState().columnWidths).toEqual({});
		expect(faultReporter.snapshot()[0]?.operation).toBe('validate-precondition');
	});

	it('applies commit phases in deterministic order: state -> domains -> invalidations -> history -> render -> events', () => {
		const { applier, stateManager, invalidation, eventBus, requestRender, publishDomains, commandHistory, projectStateChange } = makeApplier();
		const callOrder: string[] = [];

		const origCommitState = stateManager.commitState.bind(stateManager);
		stateManager.commitState = vi.fn((...args) => {
			callOrder.push('state');
			return origCommitState(...args);
		}) as typeof stateManager.commitState;
		projectStateChange.mockImplementation(() => {
			callOrder.push('projection');
		});
		publishDomains.mockImplementation(() => {
			callOrder.push('domains');
		});
		vi.spyOn(invalidation, 'applyNormalizedPlan').mockImplementation(() => {
			callOrder.push('invalidation');
		});
		vi.spyOn(commandHistory, 'add').mockImplementation(() => {
			callOrder.push('history');
		});
		vi.spyOn(eventBus, 'dispatchEvent').mockImplementation(() => {
			callOrder.push('event');
		});
		requestRender.mockImplementation(() => {
			callOrder.push('render');
		});

		applier.apply({
			reason: 'combined',
			state: { columnWidths: { name: 300 } },
			domains: ['columns'],
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'combined:undo', state: { columnWidths: { name: 100 } }, requestRender: false },
				redo: { reason: 'combined:redo', state: { columnWidths: { name: 300 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 300 } }],
		});

		expect(callOrder).toEqual(['state', 'projection', 'domains', 'invalidation', 'history', 'render', 'event']);
	});

	it('runs the projection phase exactly once per logical commit and before key listeners', () => {
		const { applier, stateManager, projectStateChange } = makeApplier();
		const seen: string[] = [];
		stateManager.subscribeToKey('visibleRowRange', () => {
			seen.push('listener');
		});
		projectStateChange.mockImplementation((phase) => {
			seen.push('projection');
			phase.setDerivedState({ visibleRowRange: { startIdx: 1, endIdx: 3 } } as Partial<InternalGridState<TestRow>>);
		});

		applier.apply({
			reason: 'projection-once',
			state: { columnWidths: { name: 240 } },
		});

		expect(projectStateChange).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['projection', 'listener']);
		expect(stateManager.getState().visibleRowRange).toEqual({ startIdx: 1, endIdx: 3 });
	});

	it('resolves event payload factories after projection against committed state', () => {
		const { applier } = makeApplier();
		const listener = vi.fn();
		applier['deps'].eventBus.addEventListener(GridEventName.columnResized, listener);

		applier.apply({
			reason: 'event-payload-factory',
			state: { columnWidths: { name: 240 } },
			events: [
				{
					type: GridEventName.columnResized,
					payload: (state) => ({ colField: 'name', width: state.columnWidths['name'] ?? 0 }),
				},
			],
		});

		expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { colField: 'name', width: 240 } }));
	});

	it('registers bounded history entries and replays them through the same commit protocol', () => {
		const { applier, commandHistory, stateManager } = makeApplier();

		applier.apply({
			reason: 'history',
			state: { columnWidths: { name: 200 } },
			history: {
				undo: {
					reason: 'history:undo',
					state: { columnWidths: { name: 100 } },
					requestRender: false,
				},
				redo: {
					reason: 'history:redo',
					state: { columnWidths: { name: 200 } },
					requestRender: false,
				},
			},
		});

		commandHistory.undo();
		expect(stateManager.getState().columnWidths).toEqual({ name: 100 });

		commandHistory.redo();
		expect(stateManager.getState().columnWidths).toEqual({ name: 200 });
	});

	it('commits row-order domain mutations through registered executors with inverse history', () => {
		const stateManager = new StateManager<TestRow>({
			columns: [],
			selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
			selectedRowIds: [],
			rowHeights: {},
			columnWidths: {},
			defaultRowHeight: 40,
			defaultColWidth: 100,
			enableColumnReorder: true,
			activeEdit: null,
			sortModel: null,
			filterModel: null,
			globalVersion: 0,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			expansion: { groups: {}, treeRows: {}, details: {} },
			rowOverscanPx: 400,
			colBuffer: 1,
		} as unknown as InternalGridState<TestRow>);
		const invalidation = new InvalidationManager();
		const eventBus = new EventBus<TestRow>();
		const faultReporter = new RuntimeFaultReporter<TestRow>({ log: () => undefined });
		const commandHistory = new CommandHistory(faultReporter);
		const requestRender = vi.fn();
		const publishDomains = vi.fn();
		let rowOrder = ['1', '2', '3'];
		const rowModel = {
			getRowOrder: () => rowOrder.slice(),
			setRowOrder: (rowIds: string[]) => {
				rowOrder = rowIds.slice();
			},
		};

		const deps: GridCommitKernelDeps<TestRow> = {
			stateManager,
			invalidation,
			eventBus,
			commandHistory,
			requestRender,
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => rowModel as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
			publishDomains,
			faultReporter,
		};

		const kernel = new GridCommitKernel(deps);
		const eventSpy = vi.fn();
		eventBus.addEventListener(GridEventName.rowOrderChanged, eventSpy);

		const result = kernel.commit({
			reason: 'rows:set-order',
			domainMutations: [{ kind: 'row-order', rowIds: ['3', '1', '2'] }],
		});

		expect(result.status).toBe('committed');
		expect(rowOrder).toEqual(['3', '1', '2']);
		expect(publishDomains).toHaveBeenCalledWith(['rows']);
		expect(requestRender).toHaveBeenCalledWith('rows:set-order', 1);
		expect(eventSpy).toHaveBeenCalledOnce();
		expect(commandHistory.canUndo()).toBe(true);

		commandHistory.undo();
		expect(rowOrder).toEqual(['1', '2', '3']);

		commandHistory.redo();
		expect(rowOrder).toEqual(['3', '1', '2']);
	});

	it('supports mixed state and domain mutation commits atomically', () => {
		const stateManager = new StateManager<TestRow>({
			columns: [],
			selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
			selectedRowIds: [],
			rowHeights: {},
			columnWidths: {},
			defaultRowHeight: 40,
			defaultColWidth: 100,
			enableColumnReorder: true,
			activeEdit: null,
			sortModel: null,
			filterModel: null,
			globalVersion: 0,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			expansion: { groups: {}, treeRows: {}, details: {} },
			rowOverscanPx: 400,
			colBuffer: 1,
		} as unknown as InternalGridState<TestRow>);
		const deps: GridCommitKernelDeps<TestRow> = {
			stateManager,
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => ({ getRowOrder: () => ['1'], setRowOrder: () => undefined }) as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		};
		const kernel = new GridCommitKernel(deps);

		expect(
			kernel.commit({
				reason: 'rows:set-order',
				state: { colBuffer: 2 },
				domainMutations: [{ kind: 'row-order', rowIds: ['1'] }],
			})
		).toEqual({ status: 'committed', changeId: 1, faults: [], rejectedMutations: undefined });
		expect(stateManager.getState().colBuffer).toBe(2);
	});

	it('commitDetailed exposes row-transaction mutation results from typed executors', () => {
		const stateManager = new StateManager<TestRow>({
			columns: [],
			selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
			selectedRowIds: [],
			rowHeights: {},
			columnWidths: {},
			defaultRowHeight: 40,
			defaultColWidth: 100,
			enableColumnReorder: true,
			activeEdit: null,
			sortModel: null,
			filterModel: null,
			globalVersion: 0,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			expansion: { groups: {}, treeRows: {}, details: {} },
			rowOverscanPx: 400,
			colBuffer: 1,
		} as unknown as InternalGridState<TestRow>);
		const resultPayload = {
			add: [{ id: '2' }],
			remove: [],
			update: [],
		};
		const rowModel = {
			captureTransactionSnapshot: vi.fn(() => ({ modelType: 'test', snapshot: {} })),
			replaceRowsStructurally: vi.fn(),
			applyTransactionStructurally: vi.fn(() => resultPayload),
			writeCellValueStructurally: vi.fn(),
			reconcileAfterDataWrite: vi.fn(() => ({ changed: false })),
			classifyFieldMutation: vi.fn(() => 'value-only'),
			restoreTransactionSnapshot: vi.fn(),
		};
		const kernel = new GridCommitKernel<TestRow>({
			stateManager,
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => rowModel as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const execution = kernel.commitDetailed({
			reason: 'rows:apply-transaction',
			domainMutations: [{ kind: 'row-transaction', transaction: { add: [{ id: '2', name: 'B' } as TestRow] } }],
		});

		expect(execution.result.status).toBe('committed');
		expect(rowModel.applyTransactionStructurally).toHaveBeenCalledOnce();
		expect(execution.appliedMutations[0]?.result).toStrictEqual(resultPayload);
	});

	it('row-transaction commits create undo history that restores previous rows and order', () => {
		const stateManager = new StateManager<TestRow>({
			columns: [],
			selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
			selectedRowIds: [],
			rowHeights: {},
			columnWidths: {},
			defaultRowHeight: 40,
			defaultColWidth: 100,
			enableColumnReorder: true,
			activeEdit: null,
			sortModel: null,
			filterModel: null,
			globalVersion: 0,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			expansion: { groups: {}, treeRows: {}, details: {} },
			rowOverscanPx: 400,
			colBuffer: 1,
		} as unknown as InternalGridState<TestRow>);
		let rows: TestRow[] = [{ id: '1', name: 'A' }];
		let rowOrder = ['1'];
		const rowModel = {
			captureTransactionSnapshot: vi.fn(() => ({
				modelType: 'test',
				snapshot: {
					rows: rows.slice(),
					rowOrder: rowOrder.slice(),
				},
			})),
			replaceRowsStructurally: vi.fn(),
			applyTransactionStructurally: vi.fn((transaction: { add?: TestRow[] }) => {
				if (transaction.add) {
					rows = rows.concat(transaction.add);
					rowOrder = rowOrder.concat(transaction.add.map((row) => row.id));
				}
				return { add: transaction.add?.map((row) => ({ id: row.id })) ?? [], remove: [], update: [], visualChange: 'full' };
			}),
			writeCellValueStructurally: vi.fn(),
			reconcileAfterDataWrite: vi.fn(() => ({ changed: false })),
			classifyFieldMutation: vi.fn(() => 'value-only'),
			restoreTransactionSnapshot: vi.fn((snapshot: { snapshot: { rows: TestRow[]; rowOrder: string[] } }) => {
				rows = snapshot.snapshot.rows.slice();
				rowOrder = snapshot.snapshot.rowOrder.slice();
			}),
		};
		const commandHistory = new CommandHistory();
		const kernel = new GridCommitKernel<TestRow>({
			stateManager,
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory,
			requestRender: vi.fn(),
			commitContext: {
				getState: () => stateManager.getState(),
				getRowModel: () => rowModel as any,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const result = kernel.commit({
			reason: 'rows:apply-transaction',
			domainMutations: [{ kind: 'row-transaction', transaction: { add: [{ id: '2', name: 'B' }] } }],
		});

		expect(result.status).toBe('committed');
		expect(rows.map((row) => row.id)).toEqual(['1', '2']);
		expect(commandHistory.canUndo()).toBe(true);

		commandHistory.undo();
		expect(rows.map((row) => row.id)).toEqual(['1']);
		expect(rowOrder).toEqual(['1']);
	});

	it('commits cell-value domain mutations through typed executors with inverse history', () => {
		const rowValues = new Map([['1:name', 'Alpha']]);
		const kernel = new GridCommitKernel<TestRow>({
			stateManager: new StateManager<TestRow>({
				columns: [],
				selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
				selectedRowIds: [],
				rowHeights: {},
				columnWidths: {},
				defaultRowHeight: 40,
				defaultColWidth: 100,
				enableColumnReorder: true,
				activeEdit: null,
				sortModel: null,
				filterModel: null,
				globalVersion: 0,
				visibleRowRange: { startIdx: 0, endIdx: 0 },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				expansion: { groups: {}, treeRows: {}, details: {} },
				rowOverscanPx: 400,
				colBuffer: 1,
			} as unknown as InternalGridState<TestRow>),
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => ({}) as InternalGridState<TestRow>,
				getRowModel: () =>
					({
						getRawRowById: (rowId: string) => (rowId === '1' ? ({ id: '1', name: rowValues.get('1:name') } as TestRow) : null),
						writeCellValueStructurally: (rowId: string) => ({
							updatedNodes: [{ id: rowId } as any],
							changedFieldsByRow: new Map([[rowId, new Set(['name'])]]),
							visualChange: 'none' as const,
						}),
					}) as any,
				getCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getRawCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getStoredCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getColumnDef: () => ({ field: 'name' }) as any,
				applyCellValueChange: (rowId, colField, value) => {
					const key = `${rowId}:${colField}`;
					const oldRawValue = rowValues.get(key);
					if (oldRawValue === value) {
						return {
							applied: false,
							rowId,
							colField,
							oldRawValue,
							oldComputedValue: oldRawValue,
							newRawValue: value,
							invalidatedCells: [],
						};
					}
					rowValues.set(key, value as string);
					return {
						applied: true,
						rowId,
						colField,
						oldRawValue,
						oldComputedValue: oldRawValue,
						newRawValue: value,
						newComputedValue: value,
						invalidatedCells: [{ rowId, colField }],
					};
				},
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const result = kernel.commit({
			reason: 'data:set-cell-value',
			domainMutations: [{ kind: 'cell-value', rowId: '1', colField: 'name', value: 'Beta' }],
		});

		expect(result.status).toBe('committed');
		expect(rowValues.get('1:name')).toBe('Beta');
	});

	it('rejects atomic batch-cell mutations before writes when a prepared update is invalid', () => {
		const rowValues = new Map([
			['1:name', 'Alpha'],
			['2:name', 'Beta'],
		]);
		const applyCellValueChange = vi.fn((rowId: string, colField: string, value: unknown) => ({
			applied: true,
			rowId,
			colField,
			oldRawValue: rowValues.get(`${rowId}:${colField}`),
			oldComputedValue: rowValues.get(`${rowId}:${colField}`),
			newRawValue: value,
			newComputedValue: value,
			invalidatedCells: [{ rowId, colField }],
		}));
		const kernel = new GridCommitKernel<TestRow>({
			stateManager: new StateManager<TestRow>({
				columns: [],
				selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
				selectedRowIds: [],
				rowHeights: {},
				columnWidths: {},
				defaultRowHeight: 40,
				defaultColWidth: 100,
				enableColumnReorder: true,
				activeEdit: null,
				sortModel: null,
				filterModel: null,
				globalVersion: 0,
				visibleRowRange: { startIdx: 0, endIdx: 0 },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				expansion: { groups: {}, treeRows: {}, details: {} },
				rowOverscanPx: 400,
				colBuffer: 1,
			} as unknown as InternalGridState<TestRow>),
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory: new CommandHistory(),
			requestRender: vi.fn(),
			commitContext: {
				getState: () => ({}) as InternalGridState<TestRow>,
				getRowModel: () =>
					({
						getRawRowById: (rowId: string) =>
							rowId === '1' || rowId === '2' ? ({ id: rowId, name: rowValues.get(`${rowId}:name`) } as TestRow) : null,
						writeCellValueStructurally: (rowId: string) => ({
							updatedNodes: [{ id: rowId } as any],
							changedFieldsByRow: new Map([[rowId, new Set(['name'])]]),
							visualChange: 'none' as const,
						}),
					}) as any,
				getCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getRawCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getStoredCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getColumnDef: () => ({ field: 'name' }) as any,
				applyCellValueChange,
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const result = kernel.commit({
			reason: 'data:batch-cell-values',
			domainMutations: [
				{
					kind: 'batch-cell',
					updates: [
						{ rowId: '1', colField: 'name', value: 'Alpha 2' },
						{ rowId: 'missing', colField: 'name', value: 'Ghost' },
					],
				},
			],
		});

		expect(result).toEqual({
			status: 'rejected',
			reason: 'row unavailable',
			rejections: [{ mutationKind: 'batch-cell', reason: 'row unavailable', index: 1 }],
		});
		expect(applyCellValueChange).not.toHaveBeenCalled();
	});

	it('commits non-atomic batch-cell mutations with committed and rejected subsets', () => {
		const rowValues = new Map([
			['1:name', 'Alpha'],
			['2:name', 'Beta'],
		]);
		const commandHistory = new CommandHistory();
		const kernel = new GridCommitKernel<TestRow>({
			stateManager: new StateManager<TestRow>({
				columns: [],
				selection: { focus: null, anchor: null, range: null, bounds: null, source: 'api' },
				selectedRowIds: [],
				rowHeights: {},
				columnWidths: {},
				defaultRowHeight: 40,
				defaultColWidth: 100,
				enableColumnReorder: true,
				activeEdit: null,
				sortModel: null,
				filterModel: null,
				globalVersion: 0,
				visibleRowRange: { startIdx: 0, endIdx: 0 },
				visibleColRange: { startIdx: 0, endIdx: 0 },
				expansion: { groups: {}, treeRows: {}, details: {} },
				rowOverscanPx: 400,
				colBuffer: 1,
			} as unknown as InternalGridState<TestRow>),
			invalidation: new InvalidationManager(),
			eventBus: new EventBus<TestRow>(),
			commandHistory,
			requestRender: vi.fn(),
			commitContext: {
				getState: () => ({}) as InternalGridState<TestRow>,
				getRowModel: () =>
					({
						getRawRowById: (rowId: string) => (rowId === '1' ? ({ id: rowId, name: rowValues.get(`${rowId}:name`) } as TestRow) : null),
						writeCellValueStructurally: (rowId: string) => ({
							updatedNodes: [{ id: rowId } as any],
							changedFieldsByRow: new Map([[rowId, new Set(['name'])]]),
							visualChange: 'none' as const,
						}),
					}) as any,
				getCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getRawCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getStoredCellValue: (rowId, colField) => rowValues.get(`${rowId}:${colField}`),
				getColumnDef: () => ({ field: 'name' }) as any,
				applyBatchCellValues: (updates) =>
					updates.map((update) => {
						const key = `${update.rowId}:${update.colField}`;
						const oldValue = rowValues.get(key);
						if (oldValue === update.value) {
							return {
								applied: false,
								rowId: update.rowId,
								colField: update.colField,
								oldRawValue: oldValue,
								oldComputedValue: oldValue,
								newRawValue: update.value,
								invalidatedCells: [],
							};
						}
						rowValues.set(key, update.value as string);
						return {
							applied: true,
							rowId: update.rowId,
							colField: update.colField,
							oldRawValue: oldValue,
							oldComputedValue: oldValue,
							newRawValue: update.value,
							newComputedValue: update.value,
							invalidatedCells: [{ rowId: update.rowId, colField: update.colField }],
						};
					}),
				applyCellValueChange: (rowId, colField, value) => {
					const key = `${rowId}:${colField}`;
					const oldValue = rowValues.get(key);
					if (oldValue === value) {
						return {
							applied: false,
							rowId,
							colField,
							oldRawValue: oldValue,
							oldComputedValue: oldValue,
							newRawValue: value,
							invalidatedCells: [],
						};
					}
					rowValues.set(key, value as string);
					return {
						applied: true,
						rowId,
						colField,
						oldRawValue: oldValue,
						oldComputedValue: oldValue,
						newRawValue: value,
						newComputedValue: value,
						invalidatedCells: [{ rowId, colField }],
					};
				},
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TestRow>(),
		});

		const execution = kernel.commitDetailed({
			reason: 'data:batch-cell-values',
			domainMutations: [
				{
					kind: 'batch-cell',
					atomic: false,
					updates: [
						{ rowId: '1', colField: 'name', value: 'Alpha Updated' },
						{ rowId: 'missing', colField: 'name', value: 'Ghost' },
					],
				},
			],
		});

		expect(execution.result.status).toBe('committed');
		expect(rowValues.get('1:name')).toBe('Alpha Updated');
		expect(rowValues.get('2:name')).toBe('Beta');
		expect(execution.appliedMutations[0]?.result).toEqual({
			results: [
				{
					applied: true,
					rowId: '1',
					colField: 'name',
					oldRawValue: 'Alpha',
					oldComputedValue: 'Alpha',
					newRawValue: 'Alpha Updated',
					newComputedValue: 'Alpha Updated',
					invalidatedCells: [{ rowId: '1', colField: 'name' }],
				},
			],
			committed: [
				{
					applied: true,
					rowId: '1',
					colField: 'name',
					oldRawValue: 'Alpha',
					oldComputedValue: 'Alpha',
					newRawValue: 'Alpha Updated',
					newComputedValue: 'Alpha Updated',
					invalidatedCells: [{ rowId: '1', colField: 'name' }],
				},
			],
			rejected: [{ index: 1, update: { rowId: 'missing', colField: 'name', value: 'Ghost' }, reason: 'row unavailable' }],
		});
		expect(commandHistory.canUndo()).toBe(true);

		commandHistory.undo();
		expect(rowValues.get('1:name')).toBe('Alpha');
		expect(rowValues.get('2:name')).toBe('Beta');
	});

	it('requestRender: false skips render request', () => {
		const { applier, requestRender } = makeApplier();

		applier.apply({
			reason: 'no-render',
			state: { columnWidths: { name: 200 } },
			requestRender: false,
		});

		expect(requestRender).not.toHaveBeenCalled();
	});

	it('event listener faults do not prevent render scheduling or committed results', () => {
		const { applier, eventBus, requestRender, faultReporter } = makeApplier();

		eventBus.addEventListener(GridEventName.columnResized, () => {
			throw new Error('listener exploded');
		});

		const result = applier.apply({
			reason: 'listener-fault',
			state: { columnWidths: { name: 200 } },
			invalidations: [{ kind: 'geometry' }],
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 200 } }],
		});

		expect(result).toEqual({ status: 'committed', changeId: 1, faults: [] });
		expect(requestRender).toHaveBeenCalledWith('listener-fault', 1);
		expect(faultReporter.snapshot()).toHaveLength(1);
		expect(faultReporter.snapshot()[0]?.source).toBe('event-bus');
	});

	it('post-commit phase faults return committed-with-faults but preserve later completion steps', () => {
		const { applier, eventBus, requestRender, stateManager, faultReporter } = makeApplier();
		const dispatchSpy = vi.spyOn(eventBus, 'dispatchEvent');

		requestRender.mockImplementation(() => {
			throw new Error('render failed');
		});

		const result = applier.apply({
			reason: 'render-fault',
			state: { columnWidths: { name: 220 } },
			invalidations: [{ kind: 'geometry' }],
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 220 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.changeId).toBe(1);
		expect(result.faults).toHaveLength(1);
		expect(stateManager.getState().columnWidths).toEqual({ name: 220 });
		expect(dispatchSpy).toHaveBeenCalledWith(GridEventName.columnResized, { colField: 'name', width: 220 });
		expect(faultReporter.snapshot()[0]?.source).toBe('grid-change');
		expect(faultReporter.snapshot()[0]?.operation).toBe('request-render');
	});

	it('domain publication faults do not block invalidations, history, render, or events', () => {
		const { applier, invalidation, eventBus, requestRender, publishDomains, commandHistory, faultReporter } = makeApplier();
		const callOrder: string[] = [];

		publishDomains.mockImplementation(() => {
			callOrder.push('domains');
			throw new Error('domain failed');
		});
		vi.spyOn(invalidation, 'applyNormalizedPlan').mockImplementation(() => {
			callOrder.push('invalidation');
		});
		vi.spyOn(commandHistory, 'add').mockImplementation(() => {
			callOrder.push('history');
		});
		vi.spyOn(eventBus, 'dispatchEvent').mockImplementation(() => {
			callOrder.push('event');
		});
		requestRender.mockImplementation(() => {
			callOrder.push('render');
		});

		const result = applier.apply({
			reason: 'domain-fault',
			state: { columnWidths: { name: 200 } },
			domains: ['columns'],
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'domain-fault:undo', state: { columnWidths: {} }, requestRender: false },
				redo: { reason: 'domain-fault:redo', state: { columnWidths: { name: 200 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 200 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.faults).toHaveLength(1);
		expect(callOrder).toEqual(['domains', 'invalidation', 'history', 'render', 'event']);
		expect(faultReporter.snapshot()[0]?.operation).toBe('publish-domains');
	});

	it('invalidation faults do not block history, render, or events', () => {
		const { applier, invalidation, eventBus, requestRender, commandHistory, faultReporter } = makeApplier();
		const callOrder: string[] = [];

		vi.spyOn(invalidation, 'applyNormalizedPlan').mockImplementation(() => {
			callOrder.push('invalidation');
			throw new Error('invalidate failed');
		});
		vi.spyOn(commandHistory, 'add').mockImplementation(() => {
			callOrder.push('history');
		});
		vi.spyOn(eventBus, 'dispatchEvent').mockImplementation(() => {
			callOrder.push('event');
		});
		requestRender.mockImplementation(() => {
			callOrder.push('render');
		});

		const result = applier.apply({
			reason: 'invalidation-fault',
			state: { columnWidths: { name: 210 } },
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'invalidation-fault:undo', state: { columnWidths: {} }, requestRender: false },
				redo: { reason: 'invalidation-fault:redo', state: { columnWidths: { name: 210 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 210 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.faults).toHaveLength(1);
		expect(callOrder).toEqual(['invalidation', 'history', 'render', 'event']);
		expect(faultReporter.snapshot()[0]?.operation).toBe('apply-invalidations');
	});

	it('history registration faults do not block render or events', () => {
		const { applier, eventBus, requestRender, commandHistory, faultReporter } = makeApplier();
		const callOrder: string[] = [];

		vi.spyOn(commandHistory, 'add').mockImplementation(() => {
			callOrder.push('history');
			throw new Error('history failed');
		});
		vi.spyOn(eventBus, 'dispatchEvent').mockImplementation(() => {
			callOrder.push('event');
		});
		requestRender.mockImplementation(() => {
			callOrder.push('render');
		});

		const result = applier.apply({
			reason: 'history-fault',
			state: { columnWidths: { name: 230 } },
			invalidations: [{ kind: 'geometry' }],
			history: {
				undo: { reason: 'history-fault:undo', state: { columnWidths: {} }, requestRender: false },
				redo: { reason: 'history-fault:redo', state: { columnWidths: { name: 230 } }, requestRender: false },
			},
			events: [{ type: GridEventName.columnResized, payload: { colField: 'name', width: 230 } }],
		});

		expect(result.status).toBe('committed');
		expect(result.faults).toHaveLength(1);
		expect(callOrder).toEqual(['history', 'render', 'event']);
		expect(faultReporter.snapshot()[0]?.operation).toBe('register-history');
	});

	it('state commit faults return failed-before-commit and do not publish follow-up phases', () => {
		const { applier, stateManager, requestRender, publishDomains } = makeApplier();
		const originalCommitState = stateManager.commitState;
		stateManager.commitState = vi.fn(() => {
			throw new Error('write failed');
		}) as typeof originalCommitState;

		const result = applier.apply({
			reason: 'state-fault',
			state: { columnWidths: { name: 260 } },
			domains: ['columns'],
		});

		expect(result.status).toBe('failed-before-commit');
		expect(requestRender).not.toHaveBeenCalled();
		expect(publishDomains).not.toHaveBeenCalled();
		expect(stateManager.getState().columnWidths).toEqual({});
		stateManager.commitState = originalCommitState;
	});

	it('multiple invalidations of different kinds are all applied', () => {
		const { applier, invalidation } = makeApplier();
		const spyApply = vi.spyOn(invalidation, 'applyNormalizedPlan');

		applier.apply({
			reason: 'multi-invalidate',
			invalidations: [{ kind: 'geometry' }, { kind: 'headers' }, { kind: 'viewport' }, { kind: 'column', colId: 'name' }],
		});

		expect(spyApply).toHaveBeenCalledTimes(1);
		const plan = spyApply.mock.calls[0][0];
		expect(plan.geometry).toBe(true);
		expect(plan.headers).toBe(true);
		expect(plan.viewport).toBe(true);
		expect(plan.columns.has('name')).toBe(true);
	});
});
