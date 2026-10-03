import { describe, expect, it } from 'vitest';
import { applyClientSortAndFilter } from '../rowModel.js';
import { RowNode } from '../rowNode.js';
import { compareSortValues } from './sortKeys.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import type { RowTreeNode } from './stages/types.js';

type Row = { id: string; v: unknown };
const columns = [{ field: 'id' }, { field: 'v' }] as never[];

function reference(rows: Row[], desc: boolean): string[] {
	return rows
		.map((row, source) => ({ row, source }))
		.sort((a, b) => (desc ? -1 : 1) * compareSortValues(a.row.v, b.row.v) || a.source - b.source)
		.map(({ row }) => row.id);
}

describe('numeric sort fast paths match the general comparison', () => {
	let seed = 3;
	const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const pool = [0, -0, 1, 1, 2.5, -3, Infinity, -Infinity, 7, 7, 7];
	const numeric: Row[] = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, v: pool[Math.floor(random() * pool.length)] }));
	// A string among the numbers takes the general path; the results must agree with the same reference.
	const mixed: Row[] = numeric.map((row, i) => (i === 50 ? { ...row, v: '4' } : row));

	for (const rows of [numeric, mixed]) {
		for (const desc of [false, true]) {
			const label = `${rows === numeric ? 'numbers' : 'mixed'} ${desc ? 'desc' : 'asc'}`;
			const sortModel = [{ colId: 'v', sort: desc ? 'desc' : 'asc' }] as never;

			it(`flat: ${label}`, () => {
				const nodes = rows.map((row) => new RowNode<Row>(row.id, row));
				const sorted = applyClientSortAndFilter(nodes, columns, sortModel, null).map((item) => item.node.id);
				expect(sorted).toEqual(reference(rows, desc));
			});

			it(`tree leaves: ${label}`, () => {
				const leaves: RowTreeNode<Row>[] = rows.map((row) => ({ kind: 'data', rowId: row.id, node: new RowNode<Row>(row.id, row), depth: 0 }));
				sortTreeStage(leaves, sortModel, columns);
				expect(leaves.map((leaf) => (leaf as { rowId: string }).rowId)).toEqual(reference(rows, desc));
			});
		}
	}
});
