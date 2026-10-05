import { describe, expect, it } from 'vitest';
import { getScrollMountValue } from './binderShared.js';
import type { RowCellBinderDeps } from '../rowCellBinder.js';
import type { ColumnDef } from '../../columnDef.js';
import type { RowNode } from '../../rowNode.js';

type Row = { amount: number; nested: { score: number } };

function makeDeps(options: { cached?: Record<string, unknown>; formula?: boolean } = {}) {
	const cached = options.cached ?? {};
	return {
		engine: {
			hasFormula: () => options.formula ?? false,
			data: {
				// The display cache stringifies, as DataModel does.
				getCachedDisplayValue: (_rowId: string, field: string) => (field in cached ? String(cached[field]) : undefined),
				getCachedCellValue: (_rowId: string, field: string) => cached[field],
			},
		},
	} as unknown as RowCellBinderDeps<Row>;
}

const node = { id: 'r1', data: { amount: 17, nested: { score: 4.5 } } } as unknown as RowNode<Row>;
const col = (def: Partial<ColumnDef<Row>>) => ({ field: 'amount', ...def }) as ColumnDef<Row>;

describe('getScrollMountValue', () => {
	it('hands DOM renderers the raw value of a plain field, not its display string', () => {
		expect(getScrollMountValue(makeDeps(), node, col({}))).toBe(17);
		expect(getScrollMountValue(makeDeps(), node, col({ field: 'nested.score' }))).toBe(4.5);
	});

	it('hands over the cached computed value of a getter or formula cell, and nothing until it is cached', () => {
		const getter = col({ field: 'total', valueGetter: () => 99 });
		expect(getScrollMountValue(makeDeps({ cached: { total: 99 } }), node, getter)).toBe(99);
		expect(getScrollMountValue(makeDeps(), node, getter)).toBe('');
		expect(getScrollMountValue(makeDeps({ formula: true, cached: { amount: 34 } }), node, col({}))).toBe(34);
	});

	it('gives a loading row nothing', () => {
		expect(getScrollMountValue(makeDeps(), node, col({}), undefined, true)).toBe('');
	});
});
