import { describe, expect, it } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { RowPipeline } from './RowPipeline.js';

type Row = { id: string; price: number | null; qty: number; tag: string };

const approx = (value: unknown): unknown =>
	typeof value === 'number'
		? Number(value.toPrecision(12))
		: value && typeof value === 'object'
			? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, approx(v)]))
			: value;

describe('flat grid with a grand total: live writes stay incremental and match a full run', () => {
	for (const placement of ['bottom', 'top'] as const) {
		it(`grand total ${placement}`, () => {
			let seed = 11;
			const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
			const rows: Row[] = Array.from({ length: 400 }, (_, i) => ({
				id: `r${i}`,
				price: Math.floor(random() * 100),
				qty: i % 7,
				tag: `t${i % 3}`,
			}));
			const store = new GridStore<Row>({
				columns: [{ field: 'id' }, { field: 'price' }, { field: 'qty' }, { field: 'tag' }] as never,
				getRowId: (r) => r.id,
			});
			const model = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
				getRowId: (r) => r.id,
			});
			store.setGrouping({ by: [], totals: { grand: placement } } as never);
			store.setAggregation({
				defs: [
					{ colId: 'price', aggFunc: 'sum' },
					{ colId: 'qty', aggFunc: 'avg' },
					{ colId: 'tag', aggFunc: 'count' },
				],
			} as never);
			store.setSortModel([{ colId: 'price', sort: 'desc' }] as never);
			const minMax = () =>
				store.setAggregation({
					defs: [
						{ colId: 'price', aggFunc: 'max' },
						{ colId: 'qty', aggFunc: 'min' },
						{ colId: 'tag', aggFunc: 'first' },
						{ colId: 'id', aggFunc: 'last' },
					],
				} as never);
			const snapshot = (visualRows: Array<{ kind: string; id: string; aggregates?: unknown }>) => ({
				ids: visualRows.map((row) => row.id),
				total: approx(visualRows.find((row) => row.kind === 'total')?.aggregates),
			});
			const fullRun = () =>
				snapshot(
					new RowPipeline<Row>().run(
						(model as never as { buildPipelineInput: (s: unknown, p: boolean) => never }).buildPipelineInput(store.getState(), true)
					).visualRows
				);
			const live = () => snapshot(Array.from({ length: model.getVisualRowCount() }, (_, i) => model.getVisualRow(i)!) as never);
			let fullRuns = 0;
			const refresh = model.refresh.bind(model);
			model.refresh = (...args) => (fullRuns++, refresh(...args));
			for (let round = 0; round < 40; round++) {
				if (round === 20) minMax();
				const runsBefore = fullRuns;
				const current = store.rows().getAll() as Row[];
				const update: Row[] = [];
				for (let k = 0; k < 1 + Math.floor(random() * 30); k++) {
					const row = current[Math.floor(random() * current.length)];
					// Prices hit the extremes and nulls; quantities and tags change without moving rows.
					const roll = random();
					update.push({
						...row,
						price: roll < 0.1 ? null : roll < 0.2 ? 1000 : Math.floor(random() * 100) + random(),
						qty: Math.floor(random() * 9),
						tag: `t${Math.floor(random() * 3)}`,
					});
				}
				store.transaction({ rows: { update } });
				expect(live()).toEqual(fullRun());
				// Only the aggregation change at round 20 runs the pipeline; every write is incremental.
				if (round !== 20) expect(fullRuns).toBe(runsBefore);
			}
			store.destroy();
		});
	}
});
