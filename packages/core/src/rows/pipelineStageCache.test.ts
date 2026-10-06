import { describe, expect, it } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import type { VisualRow } from '../visualRow.js';
import { RowPipeline } from './RowPipeline.js';

interface Sale {
	id: string;
	region: string;
	country: string;
	amount: number;
}

const REGIONS = ['EMEA', 'APAC', 'AMER'];
const COUNTRIES = ['A', 'B', 'C', 'D'];

function sales(count: number): Sale[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `s${i}`,
		region: REGIONS[i % REGIONS.length],
		country: COUNTRIES[(i * 7) % COUNTRIES.length],
		amount: (i * 37) % 100,
	}));
}

function mount(rows: Sale[]) {
	const store = new GridStore<Sale>({
		getRowId: (row) => row.id,
		columns: [
			{ field: 'region', header: 'Region' },
			{ field: 'country', header: 'Country' },
			{ field: 'amount', header: 'Amount' },
		],
		grouping: { by: ['region', 'country'], defaultExpanded: true, totals: { grand: 'bottom' } },
		aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
	});
	const controller = new ClientRowModelController<Sale>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	const internals = controller as unknown as {
		pipeline: RowPipeline<Sale>;
		buildPipelineInput(state: unknown, paginate: boolean): Parameters<RowPipeline<Sale>['run']>[0];
		runtime: { getState(): unknown };
	};
	const visible = (): VisualRow<Sale>[] => Array.from({ length: controller.getVisualRowCount() }, (_, i) => controller.getVisualRow(i)!);
	/** What an uncached pipeline builds from the same state. */
	const freshRun = () =>
		new RowPipeline<Sale>().run({ ...internals.buildPipelineInput(internals.runtime.getState(), true), dataVersion: undefined });
	const fresh = (): VisualRow<Sale>[] => freshRun().visualRows;
	/** Sticky ranges, group metadata and the group-row id index, as maintained vs as a fresh run builds them. */
	const derived = () => {
		const run = freshRun();
		const groupIds = [...run.groupMeta.keys()];
		const live = controller as unknown as { visualRowIdToIndex: Map<string, number> };
		return {
			live: {
				sticky: [...controller.getStickyGroupMeta()],
				meta: groupIds.map((id) => controller.getGroupMeta(id)),
				ids: [...live.visualRowIdToIndex].sort(),
			},
			fresh: {
				sticky: [...run.stickyGroupMeta],
				meta: groupIds.map((id) => run.groupMeta.get(id)),
				ids: [...run.visualRowIdToIndex].sort(),
			},
		};
	};
	return { store, controller, pipeline: internals.pipeline, visible, fresh, derived };
}

/** The parts of a row a user sees: identity, expansion and the numbers. */
function describeRows(rows: readonly VisualRow<Sale>[]): string[] {
	return rows.map((row) => {
		const aggregates = (row as { aggregates?: Record<string, unknown> }).aggregates;
		const parts = [row.kind, row.id, String(row.hierarchy.level), String(row.hierarchy.expanded)];
		if (row.kind === 'group') parts.push(String(row.hierarchy.leafCount));
		if (aggregates) parts.push(JSON.stringify(aggregates));
		return parts.join('|');
	});
}

describe('RowPipeline tree cache', () => {
	it('reuses the row tree when only expansion changes, and keeps unchanged rows identical', () => {
		const grid = mount(sales(60));
		const before = grid.visible();
		// One group: spliced in place, no pipeline run at all.
		const runsBefore = grid.pipeline.treeCacheHits;
		grid.store.setExpanded('group:region=APAC/country=B', false);
		expect(grid.pipeline.treeCacheHits).toBe(runsBefore);
		expect(describeRows(grid.visible())).toEqual(describeRows(grid.fresh()));
		// Expand all changes many groups at once: a pipeline run that reuses the tree.
		grid.store.expandAll();
		expect(grid.pipeline.treeCacheHits).toBe(runsBefore + 1);
		grid.store.setExpanded('group:region=APAC/country=B', false);
		const after = grid.visible();
		expect(describeRows(after)).toEqual(describeRows(grid.fresh()));
		// A leaf in another group is the same row object as before the collapse.
		const leaf = before.find((row) => row.kind === 'data' && row.node.data.region === 'EMEA')!;
		expect(after).toContain(leaf);
		grid.controller.dispose();
	});

	it('rebuilds the tree after a data write, a sort, a filter or an aggregation change', () => {
		const grid = mount(sales(30));
		// The change never reuses the old tree (a sort, filter or aggregation change runs the pipeline
		// itself; a data write may be patched incrementally). The next toggles then match a fresh run.
		const check = (label: string, fn: () => void) => {
			const hits = grid.pipeline.treeCacheHits;
			fn();
			expect(grid.pipeline.treeCacheHits, label).toBe(hits);
			grid.store.setExpanded('group:region=EMEA', false);
			expect(describeRows(grid.visible()), label).toEqual(describeRows(grid.fresh()));
			grid.store.setExpanded('group:region=EMEA', true);
			expect(describeRows(grid.visible()), label).toEqual(describeRows(grid.fresh()));
		};
		check('add', () => grid.store.transaction({ rows: { add: [{ id: 'new', region: 'EMEA', country: 'A', amount: 5 }] } }));
		check('edit', () => grid.store.engine.setCellValue('s1', 'amount', 999));
		check('sort', () => grid.store.setSortModel([{ colId: 'amount', sort: 'desc' }]));
		check('filter', () => grid.store.setFilterModel({ amount: { type: 'number', operator: 'greaterThan', value: 10 } }));
		check('aggregation', () => grid.store.setAggregation([{ colId: 'amount', aggFunc: 'max' }]));
		expect(describeRows(grid.visible())).toEqual(describeRows(grid.fresh()));
		grid.controller.dispose();
	});

	it('matches an uncached pipeline across random sequences of expansion, edits, transactions, sorts and filters', () => {
		for (let seed = 1; seed <= 6; seed++) {
			const grid = mount(sales(80));
			let random = seed;
			const next = (n: number) => {
				random = (random * 1103515245 + 12345) >>> 0;
				return random % n;
			};
			const groupIds = () =>
				grid
					.visible()
					.filter((row) => row.kind === 'group')
					.map((row) => row.id);
			for (let step = 0; step < 40; step++) {
				const op = next(7);
				if (op <= 2) {
					const ids = groupIds();
					if (ids.length > 0) {
						const id = ids[next(ids.length)];
						grid.store.setExpanded(id, !grid.store.isExpanded?.(id) && next(2) === 0);
					}
				} else if (op === 3) {
					grid.store.engine.setCellValue(`s${next(80)}`, 'amount', next(1000));
				} else if (op === 4) {
					const id = `s${next(80)}`;
					grid.store.transaction({ rows: { update: [{ id, region: REGIONS[next(3)], country: COUNTRIES[next(4)], amount: next(100) }] } });
				} else if (op === 5) {
					grid.store.setSortModel(next(2) === 0 ? null : [{ colId: 'amount', sort: next(2) === 0 ? 'asc' : 'desc' }]);
				} else {
					grid.store.setFilterModel(next(2) === 0 ? null : { amount: { type: 'number', operator: 'greaterThan', value: next(90) } });
				}
				expect(describeRows(grid.visible()), `seed ${seed}, step ${step}, op ${op}`).toEqual(describeRows(grid.fresh()));
				const { live, fresh } = grid.derived();
				expect(live, `derived: seed ${seed}, step ${step}, op ${op}`).toEqual(fresh);
				// Every displayed data row resolves to its position.
				const rows = grid.visible();
				for (let i = 0; i < rows.length; i += 7) {
					const row = rows[i];
					if (row.kind === 'data') expect(grid.controller.getVisualIndexByRowId(row.rowId), `position: seed ${seed}, step ${step}`).toBe(i);
				}
			}
			grid.controller.dispose();
		}
	});
});
