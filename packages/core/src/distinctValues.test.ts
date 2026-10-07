import { describe, expect, it } from 'vitest';
import { computeDistinctValueSummary } from './distinctValues.js';
import type { RowNode } from './rowNode.js';

const nodes = (values: unknown[]) => values.map((value) => ({ value }) as unknown as RowNode<unknown>);
const getter = (node: RowNode<unknown>) => (node as unknown as { value: unknown }).value;

describe('computeDistinctValueSummary', () => {
	it('list cells count each value, arrays and comma-separated strings alike', () => {
		const summary = computeDistinctValueSummary(nodes([['ava', 'liam'], 'ava, noah', '', []]), 'f', { getter, listValues: true });
		expect(summary.values).toEqual([null, 'ava', 'liam', 'noah']);
		expect(summary.counts).toEqual([2, 2, 1, 1]);
	});

	it('without listValues a comma-separated string is one value', () => {
		const summary = computeDistinctValueSummary(nodes(['a, b', 'a, b']), 'f', { getter });
		expect(summary.values).toEqual(['a, b']);
		expect(summary.counts).toEqual([2]);
	});
});
