import type {
	GridIntegrityApi,
	GridIntegrityCapabilityMatrix,
	GridIntegrityRunResult,
	GridIntegrityScope,
	GridIntegrityScopeCapability,
	GridIntegritySummary,
} from './integrityTypes.js';

export function makeNoopIntegrityApi<TRowData>(): GridIntegrityApi<TRowData> {
	const _warn = (method: string) => console.warn(`[WitGrid] api.integrity.${method}() called but dataIntegrity is not configured on this grid.`);
	const _noopSummary = (): GridIntegritySummary => ({
		status: 'clean',
		totalIssues: 0,
		blockingIssues: 0,
		warnings: 0,
		errors: 0,
		bySource: {},
	});
	const _noopCapability = (scope: GridIntegrityScope): GridIntegrityScopeCapability => ({
		scope,
		level: 'unsupported',
		complete: false,
		source: 'none',
		reason: 'dataIntegrity not configured',
	});
	const _noopCapabilities = (): GridIntegrityCapabilityMatrix => ({
		allRows: _noopCapability('allRows'),
		loadedRows: _noopCapability('loadedRows'),
		filteredRows: _noopCapability('filteredRows'),
		selectedRows: _noopCapability('selectedRows'),
		visibleRows: _noopCapability('visibleRows'),
		currentPage: _noopCapability('currentPage'),
		serverProvided: _noopCapability('serverProvided'),
	});
	const _noopResult = (): GridIntegrityRunResult => ({
		status: 'unsupported',
		scope: 'loadedRows',
		capability: _noopCapability('loadedRows'),
		reason: 'dataIntegrity not configured',
		summary: _noopSummary(),
		issues: [],
	});
	return {
		run: async (_opts?) => {
			_warn('run');
			return _noopResult();
		},
		getCapabilities: () => {
			_warn('getCapabilities');
			return _noopCapabilities();
		},
		getScopeCapability: (scope) => {
			_warn('getScopeCapability');
			return _noopCapability(scope);
		},
		getSummary: () => {
			_warn('getSummary');
			return _noopSummary();
		},
		getIssues: () => {
			_warn('getIssues');
			return [];
		},
		getCellIssues: () => {
			_warn('getCellIssues');
			return [];
		},
		getRowIssues: () => {
			_warn('getRowIssues');
			return [];
		},
		getBlockingIssues: () => {
			_warn('getBlockingIssues');
			return [];
		},
		canSubmit: () => {
			_warn('canSubmit');
			return true;
		},
		publishIssues: () => {
			_warn('publishIssues');
		},
		publishServerReport: () => {
			_warn('publishServerReport');
		},
		clearIssues: () => {
			_warn('clearIssues');
		},
		validateCell: async () => {
			_warn('validateCell');
			return [];
		},
		validateCellProposal: async () => {
			_warn('validateCellProposal');
			return [];
		},
		validateRow: async () => {
			_warn('validateRow');
			return [];
		},
		validateGrid: async () => {
			_warn('validateGrid');
			return _noopResult();
		},
		setDiffModel: () => {
			_warn('setDiffModel');
		},
		clearDiff: () => {
			_warn('clearDiff');
		},
		getDiffResult: () => {
			_warn('getDiffResult');
			return null;
		},
		acceptCellDiff: async () => {
			_warn('acceptCellDiff');
			return { status: 'notFound', reason: 'dataIntegrity not configured' } as const;
		},
		createStream: () => {
			_warn('createStream');
			throw new Error('[WitGrid] dataIntegrity is not configured on this grid.');
		},
		getStreamState: () => {
			_warn('getStreamState');
			return null;
		},
		getConflicts: () => {
			_warn('getConflicts');
			return [];
		},
		resolveConflict: async () => {
			_warn('resolveConflict');
			return { status: 'notFound' } as const;
		},
		clearConflict: () => {
			_warn('clearConflict');
		},
	};
}
