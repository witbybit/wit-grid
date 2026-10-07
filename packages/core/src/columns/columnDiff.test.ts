import { describe, expect, it } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { displayOnlyFunctionChanges, samePipelineColumns } from './columnDiff.js';

type Row = { id: string; group: string; price: number };

describe('displayOnlyFunctionChanges', () => {
	const base = () => [
		{ field: 'id', header: 'Id' },
		{ field: 'price', header: 'Price', width: 90, valueFormatter: ({ value }: { value: unknown }) => String(value) },
	];

	it('reports the fields whose display functions are new, and nothing for identical content', () => {
		const prev = base();
		expect(displayOnlyFunctionChanges(prev, [{ ...prev[0] }, { ...prev[1] }])).toEqual(new Set());
		expect(displayOnlyFunctionChanges(prev, base())).toEqual(new Set(['price']));
	});

	it('is null for anything the cheap path cannot cover', () => {
		const prev = base();
		expect(displayOnlyFunctionChanges(prev, [prev[0], { ...prev[1], header: 'Cost' }])).toBeNull();
		expect(displayOnlyFunctionChanges(prev, [prev[0], { ...prev[1], valueGetter: () => 1 }])).toBeNull();
		expect(displayOnlyFunctionChanges(prev, [prev[1], prev[0]])).toBeNull();
		expect(displayOnlyFunctionChanges(prev, [prev[0]])).toBeNull();
		const withRenderer = [prev[0], { ...prev[1], renderer: { kind: 'react', component: () => null } }];
		expect(displayOnlyFunctionChanges(withRenderer, [prev[0], { ...prev[1], renderer: { kind: 'react', component: () => null } }])).toBeNull();
	});
});

describe('samePipelineColumns', () => {
	it('ignores display props and compares what the pipeline reads', () => {
		const getter = () => 1;
		const a = [{ field: 'price', header: 'Price', valueGetter: getter }];
		expect(samePipelineColumns(a, [{ field: 'price', header: 'Cost', width: 40, valueGetter: getter, valueFormatter: () => '' }])).toBe(true);
		expect(samePipelineColumns(a, [{ field: 'price', valueGetter: () => 2 }])).toBe(false);
		expect(samePipelineColumns(a, [{ field: 'amount', valueGetter: getter }])).toBe(false);
	});
});

describe('re-declaring columns with new inline formatters', () => {
	it('repaints only those columns and keeps live writes incremental', () => {
		const rows: Row[] = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, group: `g${i % 4}`, price: i }));
		const columns = () => [{ field: 'group' }, { field: 'price', valueFormatter: ({ value }: { value: unknown }) => `$${String(value)}` }];
		const store = new GridStore<Row>({ columns: columns() as never, getRowId: (r) => r.id });
		const model = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
			getRowId: (r) => r.id,
		});
		store.setGrouping({ by: ['group'] } as never);
		store.setAggregation({ defs: [{ colId: 'price', aggFunc: 'sum' }] } as never);
		store.setSortModel([{ colId: 'price', sort: 'desc' }] as never);
		// First write builds the incremental index.
		store.transaction({ rows: { update: [{ ...rows[0], price: 1000 }] } });

		let fullRuns = 0;
		const refresh = model.refresh.bind(model);
		model.refresh = (...args) => (fullRuns++, refresh(...args));
		const invalidation = (store as unknown as { engine: { invalidation: { consume(): { full: boolean; columns: Set<string> } } } }).engine
			.invalidation;
		invalidation.consume();

		store.setColumns(columns() as never);
		const frame = invalidation.consume();
		expect(frame.full).toBe(false);
		expect([...frame.columns]).toEqual(['price']);

		store.transaction({ rows: { update: [{ ...rows[1], price: 2000 }] } });
		expect(fullRuns).toBe(0);
		store.destroy();
	});
});
