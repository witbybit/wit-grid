import { describe, it, expect } from 'vitest';
import { RowNode } from '../rowNode.js';
import { RowPipeline } from './RowPipeline.js';
import type { RowPipelineInput } from './RowPipeline.js';

interface Row {
	id: string;
	category: string;
}

function nodes(n: number, cat = (i: number) => (i % 2 === 0 ? 'A' : 'B')): RowNode<Row>[] {
	return Array.from({ length: n }, (_, i) => new RowNode<Row>(`r${i}`, { id: `r${i}`, category: cat(i) }));
}

function baseInput(over: Partial<RowPipelineInput<Row>>): RowPipelineInput<Row> {
	return {
		nodes: [],
		columns: [{ field: 'category', header: 'category' }],
		sortModel: null,
		filterModel: null,
		expansion: { rows: {}, details: {} },
		defaultRowHeight: 40,
		rowHeightsRecord: {},
		...over,
	};
}

describe('RowPipeline client pagination page-window', () => {
	it('leaves output unchanged when no pagination is set (pageWindow undefined)', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(250) }));
		expect(out.pageWindow).toBeUndefined();
		expect(out.visualRows).toHaveLength(250);
	});

	it('slices the first page and reports the full total', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(250), pagination: { pageSize: 100, page: 0 } }));
		expect(out.pageWindow).toMatchObject({ page: 0, pageCount: 3, totalRows: 250, startIndex: 0, endIndex: 100 });
		expect(out.visualRows).toHaveLength(100);
		expect(out.visualRows[0].kind === 'data' && out.visualRows[0].rowId).toBe('r0');
		expect(out.visualRows[99].kind === 'data' && out.visualRows[99].rowId).toBe('r99');
	});

	it('slices a middle page', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(250), pagination: { pageSize: 100, page: 1 } }));
		expect(out.visualRows).toHaveLength(100);
		expect(out.visualRows[0].kind === 'data' && out.visualRows[0].rowId).toBe('r100');
	});

	it('slices a partial last page', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(250), pagination: { pageSize: 100, page: 2 } }));
		expect(out.visualRows).toHaveLength(50);
		expect(out.visualRows[0].kind === 'data' && out.visualRows[0].rowId).toBe('r200');
	});

	it('clamps an out-of-range page to the last page', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(250), pagination: { pageSize: 100, page: 99 } }));
		expect(out.pageWindow?.page).toBe(2);
		expect(out.visualRows[0].kind === 'data' && out.visualRows[0].rowId).toBe('r200');
	});

	it('builds index maps page-relative (0-based) for the sliced rows only', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(250), pagination: { pageSize: 100, page: 1 } }));
		expect(out.rowIdToVisualIndex.size).toBe(100);
		// Data rows are found by row id; the visual-id map holds group, total and detail rows only.
		expect(out.visualRowIdToIndex.size).toBe(0);
		// Page 2 (index 1) holds r100..r199 at page-relative indices 0..99.
		expect(out.rowIdToVisualIndex.get('r100')).toBe(0);
		expect(out.rowIdToVisualIndex.get('r199')).toBe(99);
		// Rows on other pages are not in the page-relative maps.
		expect(out.rowIdToVisualIndex.has('r0')).toBe(false);
		expect(out.rowIdToVisualIndex.has('r200')).toBe(false);
	});

	it('handles an empty grid as page 1 of 1 with an empty slice', () => {
		const out = new RowPipeline<Row>().run(baseInput({ nodes: nodes(0), pagination: { pageSize: 100, page: 0 } }));
		expect(out.visualRows).toHaveLength(0);
		expect(out.pageWindow).toMatchObject({ pageCount: 1, totalRows: 0 });
	});

	it('paginates the flattened rows when grouping is active, with page-relative sticky meta', () => {
		// 10 rows, grouped by category (A/B), groups expanded → visual rows interleave
		// group headers + data rows. Paginate to a small page and assert sticky meta indices
		// stay within the sliced array (no stale full-array indices).
		const out = new RowPipeline<Row>().run(
			baseInput({
				nodes: nodes(10),
				grouping: { by: ['category'], defaultExpanded: true },
				pagination: { pageSize: 4, page: 0 },
			})
		);
		expect(out.visualRows).toHaveLength(4);
		expect(out.pageWindow?.totalRows).toBeGreaterThan(4); // full flattened total exceeds one page
		for (const [groupIdx, lastDesc] of out.stickyGroupMeta) {
			expect(groupIdx).toBeGreaterThanOrEqual(0);
			expect(groupIdx).toBeLessThan(out.visualRows.length);
			expect(lastDesc).toBeLessThan(out.visualRows.length);
			expect(lastDesc).toBeGreaterThan(groupIdx);
		}
		// groupMetaByVisualIndex keys are also page-relative.
		for (const key of out.groupMetaByVisualIndex.keys()) {
			expect(key).toBeLessThan(out.visualRows.length);
		}
	});
});
