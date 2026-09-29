// Experimental core entrypoint.
//
// Exports from this module are intentionally outside the reviewed alpha
// stability contract and may change or disappear between pre-release versions.
export { compileStyleRules } from './styling/styleRules.js';
export { NoopGridInstrumentation, RecordingGridInstrumentation, NOOP_INSTRUMENTATION } from './diagnostics/GridInstrumentation.js';
export {
	canEditCell,
	canFocusVisualRow,
	isDataVisualRow,
	isDataCellSelectable,
	isEditableVisualRow,
	isFullWidthVisualRow,
	isSelectableVisualRow,
} from './visualRow.js';
export {
	parseVisualRowId,
	toDataVisualRowId,
	toDetailVisualRowId,
	toTotalVisualRowId,
	toGroupVisualRowId,
	toLoadingVisualRowId,
} from './rows/visualRowIds.js';
export type { GroupPathItem } from './rows/visualRowIds.js';
export {
	startFlightRecorder,
	stopFlightRecorder,
	getFlightRecorderSnapshot,
	explainFlightRecorderCell,
	clearFlightRecorder,
} from './flightRecorderExperimental.js';
export type {
	GridCausalEvent,
	GridCausalTraceEnvelope,
	GridCausalTraceSnapshot,
	GridCellExplanation,
	GridFlightRecorderOptions,
} from './diagnostics/GridCausalTrace.js';
export {
	GRID_TRACE_REPLAY_LIMITS,
	GRID_TRACE_REPLAY_VERSION,
	GridTraceReplay,
	createGridTraceReplay,
	validateGridReplayTrace,
} from './diagnostics/GridTraceReplay.js';
export type {
	GridReplayCheckpoint,
	GridReplayCheckpointExpectation,
	GridReplayCommand,
	GridReplayDivergence,
	GridReplayExpectedFacts,
	GridReplayInitialFixture,
	GridReplayObservation,
	GridReplayObservationKind,
	GridReplayScheduler,
	GridReplaySemanticFacts,
	GridTraceReplayStatus,
	GridReplayTrace,
	GridReplayValidation,
	JsonValue,
} from './diagnostics/GridTraceReplay.js';
