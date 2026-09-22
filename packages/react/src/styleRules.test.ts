import { type GridStyleRule } from '@eregister/wit-grid-core';
import { compileStyleRules } from '@eregister/wit-grid-core/experimental';
import { describe, expect, it } from 'vitest';

interface Row {
	id: string;
	risk: string;
}

describe('compileStyleRules', () => {
	it('returns an empty compiled rule set for empty rules', () => {
		expect(compileStyleRules([])).toMatchObject({
			hasRowRules: false,
			hasGroupRowRules: false,
			hasDetailRowRules: false,
			hasCellRules: false,
			hasHeaderRules: false,
		});
	});

	it('categorizes each supported rule kind', () => {
		const rules: GridStyleRule<Row>[] = [
			{ kind: 'row', when: () => true, rowClass: 'row-class' },
			{ kind: 'groupRow', rowClass: 'group-class' },
			{ kind: 'detailRow', rowClass: 'detail-class' },
			{ kind: 'cell', when: () => true, cellClass: 'cell-class' },
			{ kind: 'headerCell', when: () => true, headerCellClass: 'header-class' },
		];

		const compiled = compileStyleRules(rules);

		expect(compiled.rowRules).toHaveLength(1);
		expect(compiled.groupRowRules).toHaveLength(1);
		expect(compiled.detailRowRules).toHaveLength(1);
		expect(compiled.cellRules).toHaveLength(1);
		expect(compiled.headerRules).toHaveLength(1);
	});

	it('indexes field-scoped cell and header rules', () => {
		const rules: GridStyleRule<Row>[] = [
			{ kind: 'cell', field: 'risk', when: () => true, cellClass: 'cell-class' },
			{ kind: 'headerCell', field: 'risk', when: () => true, headerCellClass: 'header-class' },
		];

		const compiled = compileStyleRules(rules);

		expect(compiled.cellRulesByField.get('risk')).toHaveLength(1);
		expect(compiled.headerRulesByField.get('risk')).toHaveLength(1);
	});

	it('reuses compiled output for the same array reference', () => {
		const rules: GridStyleRule<Row>[] = [{ kind: 'row', when: (row) => row.risk === 'high', rowClass: 'danger' }];
		expect(compileStyleRules(rules)).toBe(compileStyleRules(rules));
	});
});
