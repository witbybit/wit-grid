import { describe, it, expect, vi } from 'vitest';
import * as publicApi from './index.js';
import * as experimentalApi from './experimental.js';
import * as internalApi from './internal.js';
import { createClientGrid, createInfiniteGrid, createServerSideGrid } from './createGrid.js';
import { GRID_STATE_SCHEMA_VERSION } from './persistence/statePersistence.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('Public/internal boundary', () => {
	describe('Public entry (@eregister/wit-grid-core)', () => {
		it('does not export GridStore', () => {
			expect((publicApi as Record<string, unknown>)['GridStore']).toBeUndefined();
		});

		it('does not export GridRuntime', () => {
			expect((publicApi as Record<string, unknown>)['GridRuntime']).toBeUndefined();
		});

		it('does not export mutable GridState aliases', () => {
			expect((publicApi as Record<string, unknown>)['GridState']).toBeUndefined();
			expect((publicApi as Record<string, unknown>)['InternalGridState']).toBeUndefined();
		});

		it('does not export RenderEngine / GridEngine', () => {
			expect((publicApi as Record<string, unknown>)['RenderEngine']).toBeUndefined();
			expect((publicApi as Record<string, unknown>)['GridEngine']).toBeUndefined();
		});

		it('does not export RowRenderer', () => {
			expect((publicApi as Record<string, unknown>)['RowRenderer']).toBeUndefined();
		});

		it('does not export mountGridHost', () => {
			expect((publicApi as Record<string, unknown>)['mountGridHost']).toBeUndefined();
		});

		it('does not export InternalColumnDef', () => {
			// InternalColumnDef is a type-only export; at runtime it should not appear
			expect((publicApi as Record<string, unknown>)['InternalColumnDef']).toBeUndefined();
		});

		it('does not export renderer classes', () => {
			const rendererClasses = [
				'GeometryController',
				'InvalidationManager',
				'PortalMountManager',
				'RenderOrchestrator',
				'RenderScheduler',
				'CellRenderer',
				'FullWidthRowRenderer',
				'HeaderRenderer',
				'OverlayRenderer',
				'ViewportRenderer',
			];
			for (const name of rendererClasses) {
				expect((publicApi as Record<string, unknown>)[name], `${name} must not be in public entry`).toBeUndefined();
			}
		});

		it('exports createClientGrid', () => {
			expect(typeof publicApi.createClientGrid).toBe('function');
		});

		it('matches the reviewed alpha runtime export snapshot', () => {
			expect(Object.keys(publicApi).sort()).toEqual([
				'BUILT_IN_THEMES',
				'BUILT_IN_THEME_METADATA',
				'BUILT_IN_THEME_ORDER',
				'CAPABILITY_ALLOWED',
				'COOL_BLUE_THEME',
				'DARK_THEME',
				'DATE_OPS',
				'GRID_STATE_SCHEMA_VERSION',
				'GridEventName',
				'GridInsightRegistry',
				'GridMetric',
				'HIGH_CONTRAST_DARK_THEME',
				'HIGH_CONTRAST_LIGHT_THEME',
				'LIGHT_THEME',
				'MINIMAL_MONOCHROME_THEME',
				'NUMBER_OPS',
				'TEXT_OPS',
				'ThemeManager',
				'WARM_ORANGE_THEME',
				'applyFilterToModel',
				'applyQueryModelFilter',
				'areCanonicalCellPointersEqual',
				'areCellPointersEqual',
				'areServerSideRoutesEqual',
				'buildFilterByValue',
				'countQueryNodes',
				'createClientGrid',
				'createEmptyQueryModel',
				'createInfiniteGrid',
				'createLocalStorageAdapter',
				'createLocalStorageWorkspaceAdapter',
				'createQueryEvaluationContext',
				'createServerSideGetRowsRequest',
				'createServerSideGrid',
				'createServerSideRouteKey',
				'createWorkspaceController',
				'customCellRule',
				'date',
				'defaultOpForType',
				'doesCanonicalCellPointerMatchColumn',
				'doesCellPointerMatchColumn',
				'duplicateValueRule',
				'email',
				'evaluateQueryModel',
				'getBuiltInTheme',
				'getCellPointerColumnKey',
				'getFilterChipText',
				'getOpMeta',
				'getOpsForType',
				'getQueryOperator',
				'getQueryOperatorsForType',
				'isBuiltInThemeName',
				'isDomCellRenderer',
				'isFilterableColumn',
				'isQueryModelActive',
				'isRootServerSideRoute',
				'max',
				'min',
				'missingRequiredRule',
				'normalizeCapabilityResult',
				'normalizeServerSideGetRowsResult',
				'normalizeServerSideRoute',
				'number',
				'oneOf',
				'regex',
				'registerGridContextMenu',
				'required',
				'resolveColumnFilterDef',
				'resolveServerSideRowCountState',
				'summarizeAnalysisState',
				'themeToCSSVariables',
				'validateSchemaVersion',
			]);
		});

		it('does not export experimental style-rule compiler or concrete instrumentation helpers', () => {
			for (const name of [
				'RowNode',
				'compileStyleRules',
				'NoopGridInstrumentation',
				'RecordingGridInstrumentation',
				'NOOP_INSTRUMENTATION',
				'canEditCell',
				'canFocusVisualRow',
				'isDataVisualRow',
				'isDataCellSelectable',
				'isEditableVisualRow',
				'isFullWidthVisualRow',
				'isSelectableVisualRow',
				'parseVisualRowId',
				'toDataVisualRowId',
				'toDetailVisualRowId',
				'toFooterVisualRowId',
				'toGroupVisualRowId',
				'toLoadingVisualRowId',
			]) {
				expect((publicApi as Record<string, unknown>)[name], `${name} must not be in public entry`).toBeUndefined();
			}
		});

		it('exports ColumnDef-related types (runtime value: nothing) and GridApi (no runtime value)', () => {
			// These are type-only exports; they leave no runtime footprint — just confirm the module loads
			expect(publicApi).toBeDefined();
		});
	});

	describe('Experimental entry (@eregister/wit-grid-core/experimental)', () => {
		it('exports style-rule compiler, visual-row helpers, and concrete instrumentation helpers', () => {
			expect(typeof (experimentalApi as Record<string, unknown>)['compileStyleRules']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['NoopGridInstrumentation']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['RecordingGridInstrumentation']).toBe('function');
			expect((experimentalApi as Record<string, unknown>)['NOOP_INSTRUMENTATION']).toBeDefined();
			expect(typeof (experimentalApi as Record<string, unknown>)['canEditCell']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['isDataVisualRow']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['parseVisualRowId']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['toDataVisualRowId']).toBe('function');
			expect(typeof (experimentalApi as Record<string, unknown>)['createGridTraceReplay']).toBe('function');
		});

		it('matches the reviewed experimental runtime export snapshot', () => {
			expect(Object.keys(experimentalApi).sort()).toEqual([
				'GRID_TRACE_REPLAY_LIMITS',
				'GRID_TRACE_REPLAY_VERSION',
				'GridTraceReplay',
				'NOOP_INSTRUMENTATION',
				'NoopGridInstrumentation',
				'RecordingGridInstrumentation',
				'canEditCell',
				'canFocusVisualRow',
				'clearFlightRecorder',
				'compileStyleRules',
				'createGridTraceReplay',
				'explainFlightRecorderCell',
				'getFlightRecorderSnapshot',
				'isDataCellSelectable',
				'isDataVisualRow',
				'isEditableVisualRow',
				'isFullWidthVisualRow',
				'isSelectableVisualRow',
				'parseVisualRowId',
				'startFlightRecorder',
				'stopFlightRecorder',
				'toDataVisualRowId',
				'toDetailVisualRowId',
				'toFooterVisualRowId',
				'toGroupVisualRowId',
				'toLoadingVisualRowId',
				'validateGridReplayTrace',
			]);
		});
	});

	describe('Internal entry (@eregister/wit-grid-core/internal)', () => {
		it('exports mountGridHost', () => {
			expect(typeof (internalApi as Record<string, unknown>)['mountGridHost']).toBe('function');
		});

		it('exports the imperative renderer capability helper', () => {
			expect(typeof (internalApi as Record<string, unknown>)['hasImperativeRendererCapability']).toBe('function');
		});

		it('does not export raw store, engine, model, or renderer classes', () => {
			const rawInternals = [
				'GridStore',
				'GridRuntime',
				'GridEngine',
				'StateManager',
				'CommandHistory',
				'EventBus',
				'DataModel',
				'ColumnModel',
				'ViewportModel',
				'CellAccessModel',
				'GeometryController',
				'InvalidationManager',
				'PortalMountManager',
				'RenderEngine',
				'RenderOrchestrator',
				'RenderScheduler',
				'CellRenderer',
				'FullWidthRowRenderer',
				'HeaderRenderer',
				'OverlayRenderer',
				'RowRenderer',
				'ViewportRenderer',
			];
			for (const name of rawInternals) {
				expect((internalApi as Record<string, unknown>)[name], `${name} must not be in internal entry`).toBeUndefined();
			}
		});

		it('matches the reviewed adapter-only runtime export snapshot', () => {
			expect(Object.keys(internalApi).sort()).toEqual(['bindGridInteractionSurface', 'hasImperativeRendererCapability', 'mountGridHost']);
		});

		it('does not export runtime bridge escape hatches', () => {
			expect((internalApi as Record<string, unknown>)['resolveGridRuntimeComposition']).toBeUndefined();
			expect((internalApi as Record<string, unknown>)['resolveGridHostComposition']).toBeUndefined();
			expect((internalApi as Record<string, unknown>)['registerGridRuntimeComposition']).toBeUndefined();
			expect((internalApi as Record<string, unknown>)['resolveGridPluginController']).toBeUndefined();
		});
	});

	describe('GridApi facade', () => {
		it('is frozen', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			expect(Object.isFrozen(api)).toBe(true);
		});

		it('does not expose store, engine, or renderer-level methods on public API', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
			const internalOnlyMethods = [
				'store',
				'engine',
				'getState',
				'getRenderStats',
				'resetRenderStats',
				'getVisualRow',
				'getCellAccess',
				'subscribeToRow',
				'subscribeToViewport',
				'getCachedDisplayValue',
				'getCheapDisplayValue',
				'getComputedCellValue',
				'getCellState',
				'getRowOverscanPx',
				'setRowOverscanPx',
			];
			for (const method of internalOnlyMethods) {
				expect(api[method], `${method} must not be on public GridApi`).toBeUndefined();
			}
		});

		it('exposes getStateSnapshot on the public API', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			expect(typeof api.getStateSnapshot).toBe('function');
			expect(typeof api.subscribeToSnapshotSelector).toBe('function');
			expect(typeof api.subscribeToIntegrity).toBe('function');
			expect(api.getStateSnapshot()).toEqual(
				expect.objectContaining({
					columns: expect.any(Array),
					selection: expect.any(Object),
					selectedRowIds: expect.any(Array),
				})
			);
		});

		it('public API has no __getEngine escape hatch', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
			expect(api['__getEngine']).toBeUndefined();
		});

		it('public API has no __getInternalApi escape hatch', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
			expect(api['__getInternalApi']).toBeUndefined();
		});

		it('Object.getOwnPropertyNames(api) contains no hidden bridge properties', () => {
			const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] });
			const names = Object.getOwnPropertyNames(api);
			expect(names).not.toContain('__getEngine');
			expect(names).not.toContain('__getInternalApi');
		});

		it('restores loaded persisted state without immediately auto-saving it again', () => {
			const adapter = {
				load: vi.fn(() => ({
					v: GRID_STATE_SCHEMA_VERSION,
					state: {
						columnWidths: { id: 180 },
					},
				})),
				save: vi.fn(),
			};

			const api = createClientGrid({
				columns: [{ field: 'id', width: 100 }],
				rows: [{ id: '1' }],
				persistence: adapter,
			});

			expect(api.getGridState().state.columnWidths?.id).toBe(180);
			expect(adapter.save).not.toHaveBeenCalled();
		});

		it('reports a runtime fault for invalid loaded persisted state', () => {
			const adapter = {
				load: vi.fn(() => ({
					v: GRID_STATE_SCHEMA_VERSION,
					state: {
						selection: { focus: null },
					},
				})),
				save: vi.fn(),
			};

			const api = createClientGrid({
				columns: [{ field: 'id', width: 100 }],
				rows: [{ id: '1' }],
				persistence: adapter as any,
			});

			expect(api.getRuntimeFaults()).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						source: 'persistence',
						operation: 'applyGridState',
					}),
				])
			);
			expect(adapter.save).not.toHaveBeenCalled();
		});

		it.each([
			['client', (persistence: object) => createClientGrid({ columns: [{ field: 'id', width: 100 }], rows: [{ id: '1' }], persistence })],
			[
				'infinite',
				(persistence: object) =>
					createInfiniteGrid({
						columns: [{ field: 'id', width: 100 }],
						datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
						persistence,
					}),
			],
			[
				'SSRM',
				(persistence: object) =>
					createServerSideGrid({
						columns: [{ field: 'id', width: 100 }],
						datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
						persistence,
					}),
			],
		] as const)('does not hydrate async persistence after %s destroy', async (_mode, create) => {
			const load = deferred<{
				v: number;
				state: { columnWidths: Record<string, number> };
			}>();
			const api = create({ load: vi.fn(() => load.promise), save: vi.fn() });

			api.destroy();
			load.resolve({ v: GRID_STATE_SCHEMA_VERSION, state: { columnWidths: { id: 180 } } });
			await Promise.resolve();
			await Promise.resolve();

			expect(api.getGridState().state.columnWidths?.id).toBe(100);
		});
	});
});
