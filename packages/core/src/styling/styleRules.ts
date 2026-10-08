import type {
	CellStyleRule,
	ColumnDef,
	DetailRowStyleRule,
	GridCellClassParams,
	GridRowClassParams,
	GridStyleRule,
	GroupRowStyleRule,
	HeaderCellStyleRule,
	RowStyleRule,
} from '../columnDef.js';
import type { DetailVisualRow, GroupVisualRow } from '../visualRow.js';

export interface CompiledStyleRules<TRowData = unknown> {
	rowRules: RowStyleRule<TRowData>[];
	groupRowRules: GroupRowStyleRule<TRowData>[];
	detailRowRules: DetailRowStyleRule<TRowData>[];
	cellRules: CellStyleRule<TRowData>[];
	cellRulesByField: Map<string, CellStyleRule<TRowData>[]>;
	headerRules: HeaderCellStyleRule<TRowData>[];
	headerRulesByField: Map<string, HeaderCellStyleRule<TRowData>[]>;
	hasRowRules: boolean;
	hasGroupRowRules: boolean;
	hasDetailRowRules: boolean;
	hasCellRules: boolean;
	hasHeaderRules: boolean;
}

const EMPTY_COMPILED_RULES: CompiledStyleRules<unknown> = {
	rowRules: [],
	groupRowRules: [],
	detailRowRules: [],
	cellRules: [],
	cellRulesByField: new Map(),
	headerRules: [],
	headerRulesByField: new Map(),
	hasRowRules: false,
	hasGroupRowRules: false,
	hasDetailRowRules: false,
	hasCellRules: false,
	hasHeaderRules: false,
};

const compiledRulesCache = new WeakMap<readonly GridStyleRule<any>[], CompiledStyleRules<any>>();

export function compileStyleRules<TRowData>(rules: readonly GridStyleRule<TRowData>[] | undefined): CompiledStyleRules<TRowData> {
	if (!rules || rules.length === 0) return EMPTY_COMPILED_RULES as CompiledStyleRules<TRowData>;

	const cached = compiledRulesCache.get(rules);
	if (cached) return cached;

	const compiled: CompiledStyleRules<TRowData> = {
		rowRules: [],
		groupRowRules: [],
		detailRowRules: [],
		cellRules: [],
		cellRulesByField: new Map(),
		headerRules: [],
		headerRulesByField: new Map(),
		hasRowRules: false,
		hasGroupRowRules: false,
		hasDetailRowRules: false,
		hasCellRules: false,
		hasHeaderRules: false,
	};

	for (const rule of rules) {
		switch (rule.kind) {
			case 'row':
				compiled.rowRules.push(rule);
				compiled.hasRowRules = true;
				break;
			case 'groupRow':
				compiled.groupRowRules.push(rule);
				compiled.hasGroupRowRules = true;
				break;
			case 'detailRow':
				compiled.detailRowRules.push(rule);
				compiled.hasDetailRowRules = true;
				break;
			case 'cell':
				if (rule.field) {
					const fieldRules = compiled.cellRulesByField.get(rule.field);
					if (fieldRules) fieldRules.push(rule);
					else compiled.cellRulesByField.set(rule.field, [rule]);
				} else {
					compiled.cellRules.push(rule);
				}
				compiled.hasCellRules = true;
				break;
			case 'headerCell':
				if (rule.field) {
					const fieldRules = compiled.headerRulesByField.get(rule.field);
					if (fieldRules) fieldRules.push(rule);
					else compiled.headerRulesByField.set(rule.field, [rule]);
				} else {
					compiled.headerRules.push(rule);
				}
				compiled.hasHeaderRules = true;
				break;
			case 'colorScale':
			case 'dataBar':
			case 'iconSet':
				// Value-scaled: painted per cell by ConditionalFormatPainter, not as classes.
				break;
		}
	}

	compiledRulesCache.set(rules, compiled);
	return compiled;
}

function appendClassName(result: string[], className: string | undefined): void {
	if (className) result.push(className);
}

export function evaluateRowStyleRules<TRowData>(rules: CompiledStyleRules<TRowData>, row: TRowData, params: GridRowClassParams<TRowData>): string {
	if (!rules.hasRowRules) return '';
	const classes: string[] = [];
	for (const rule of rules.rowRules) {
		if (rule.when(row, params)) appendClassName(classes, rule.rowClass);
	}
	return classes.join(' ');
}

export function evaluateGroupRowStyleRules<TRowData>(rules: CompiledStyleRules<TRowData>, visualRow: GroupVisualRow<TRowData>): string {
	if (!rules.hasGroupRowRules) return '';
	const classes: string[] = [];
	for (const rule of rules.groupRowRules) {
		if (!rule.when || rule.when(visualRow)) appendClassName(classes, rule.rowClass);
	}
	return classes.join(' ');
}

export function evaluateDetailRowStyleRules<TRowData>(rules: CompiledStyleRules<TRowData>, visualRow: DetailVisualRow<TRowData>): string {
	if (!rules.hasDetailRowRules) return '';
	const classes: string[] = [];
	for (const rule of rules.detailRowRules) {
		if (!rule.when || rule.when(visualRow)) appendClassName(classes, rule.rowClass);
	}
	return classes.join(' ');
}

export function evaluateCellStyleRules<TRowData>(
	rules: CompiledStyleRules<TRowData>,
	col: ColumnDef<TRowData>,
	row: TRowData,
	params: GridCellClassParams<TRowData>
): string {
	if (!rules.hasCellRules) return '';
	const classes: string[] = [];
	for (const rule of rules.cellRules) {
		if (rule.when(row, col, params)) appendClassName(classes, rule.cellClass);
	}
	const fieldRules = rules.cellRulesByField.get(col.field);
	if (fieldRules) {
		for (const rule of fieldRules) {
			if (rule.when(row, col, params)) appendClassName(classes, rule.cellClass);
		}
	}
	return classes.join(' ');
}

export function evaluateHeaderCellStyleRules<TRowData>(rules: CompiledStyleRules<TRowData>, col: ColumnDef<TRowData>): string {
	if (!rules.hasHeaderRules) return '';
	const classes: string[] = [];
	for (const rule of rules.headerRules) {
		if (rule.when(col)) appendClassName(classes, rule.headerCellClass);
	}
	const fieldRules = rules.headerRulesByField.get(col.field);
	if (fieldRules) {
		for (const rule of fieldRules) {
			if (rule.when(col)) appendClassName(classes, rule.headerCellClass);
		}
	}
	return classes.join(' ');
}
