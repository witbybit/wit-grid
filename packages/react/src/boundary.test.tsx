import { describe, expect, it } from 'vitest';
import * as publicApi from './index.js';
import * as experimentalApi from './experimental.js';

describe('React public boundary', () => {
	it('keeps the alpha entry focused on the grid and stable hooks', () => {
		expect((publicApi as Record<string, unknown>)['Grid']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridApi']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridSelector']).toBeTypeOf('function');
		expect((publicApi as Record<string, unknown>)['useGridKeySelector']).toBeTypeOf('function');
	});

	it('matches the reviewed alpha runtime export snapshot', () => {
		expect(Object.keys(publicApi).sort()).toEqual([
			'BUILTIN_COLUMN_TYPES',
			'BUILT_IN_THEMES',
			'BUILT_IN_THEME_FONTS_URL',
			'BUILT_IN_THEME_METADATA',
			'BUILT_IN_THEME_ORDER',
			'CAPABILITY_ALLOWED',
			'CELL_HUES',
			'GRID_STATE_SCHEMA_VERSION',
			'Grid',
			'GridEventName',
			'GroupCount',
			'GroupToggle',
			'RecordReader',
			'ScheduleModel',
			'TimeScale',
			'WorkCalendar',
			'aggregateRecords',
			'buildBoard',
			'cascadeColumnType',
			'checkboxColumnType',
			'colorColumnType',
			'comboboxColumnType',
			'createCellOptionsStore',
			'createCheckboxRenderer',
			'createDateEditor',
			'createDateRenderer',
			'createGridChart',
			'createLocalStorageAdapter',
			'createLocalStorageWorkspaceAdapter',
			'createMultiSelectEditor',
			'createMultiSelectRenderer',
			'createNumberEditor',
			'createNumberRenderer',
			'createSelectEditor',
			'createSelectRenderer',
			'createSparklineRenderer',
			'createTheme',
			'createTimelineRenderer',
			'currencyColumnType',
			'customCellRule',
			'date',
			'dateColumnType',
			'dateRangeColumnType',
			'dateTimeColumnType',
			'defaultDateRangePresets',
			'duplicateValueRule',
			'email',
			'emailColumnType',
			'getBuiltInTheme',
			'groupRecords',
			'isBuiltInThemeName',
			'isDomCellRenderer',
			'linkedRecordColumnType',
			'longTextColumnType',
			'max',
			'min',
			'missingRequiredRule',
			'multiSelectColumnType',
			'normalizeCapabilityResult',
			'number',
			'numberColumnType',
			'oneOf',
			'openCellPopover',
			'parseMultiValue',
			'percentColumnType',
			'personColumnType',
			'planBoardMove',
			'progressColumnType',
			'rankBetween',
			'ratingColumnType',
			'regex',
			'required',
			'resolveColumnFilterDef',
			'resolveRecordRoles',
			'resourceLoad',
			'segmentedColumnType',
			'selectColumnType',
			'sparklineColumnType',
			'summarizeFilter',
			'switchColumnType',
			'tagsColumnType',
			'themeToCSSVariables',
			'timelineColumnType',
			'urlColumnType',
			'useGridApi',
			'useGridKeySelector',
			'useGridSelector',
		]);
	});

	it('does not export incubating portal, formula, chart, or filter renderer helpers from the main entry', () => {
		const removed = [
			'PortalCell',
			'PortalManager',
			'SLOW_FRAME_THRESHOLD_MS',
			'FormulaBar',
			'ColumnFilterRenderer',
			'GridFlightRecorderDevTools',
			'ChartType',
			'ChartTheme',
			'ValueFormat',
		];
		for (const name of removed) {
			expect((publicApi as Record<string, unknown>)[name], `${name} must not be exported from @eregister/wit-grid-react`).toBeUndefined();
		}
	});

	it('re-homes incubating helpers under the experimental entry', () => {
		expect((experimentalApi as Record<string, unknown>)['PortalCell']).toBeDefined();
		expect((experimentalApi as Record<string, unknown>)['PortalManager']).toBeDefined();
		expect((experimentalApi as Record<string, unknown>)['FormulaBar']).toBeDefined();
		expect((experimentalApi as Record<string, unknown>)['GridFlightRecorderDevTools']).toBeTypeOf('function');
		expect((experimentalApi as Record<string, unknown>)['GridTraceReplayControls']).toBeTypeOf('function');
	});

	it('matches the reviewed experimental runtime export snapshot', () => {
		expect(Object.keys(experimentalApi).sort()).toEqual([
			'FormulaBar',
			'GridFlightRecorderDevTools',
			'GridTraceReplayControls',
			'PortalCell',
			'PortalManager',
			'SLOW_FRAME_THRESHOLD_MS',
			'buildFrameDistribution',
			'filterTraceEvents',
			'groupTimeline',
			'tracePrivacyLabel',
		]);
	});
});
