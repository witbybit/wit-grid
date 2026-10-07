import { describe, it, expect } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
	date: string;
	status: string | null;
}

const ROWS: TestRow[] = [
	{ id: '1', name: 'Apple', price: 10, date: '2024-01-05', status: 'Active' },
	{ id: '2', name: 'Banana', price: 50, date: '2024-03-15', status: 'Inactive' },
	{ id: '3', name: 'Cherry', price: 120, date: '2024-06-20', status: 'Active' },
	{ id: '4', name: 'Date', price: 80, date: '2023-11-01', status: null },
	{ id: '5', name: 'apricot', price: 30, date: '2024-02-10', status: 'Pending' },
];

const COLUMNS = [
	{ field: 'id', header: 'ID' },
	{ field: 'name', header: 'Name' },
	{ field: 'price', header: 'Price' },
	{ field: 'date', header: 'Date' },
	{ field: 'status', header: 'Status' },
];

function makeStore() {
	const store = new GridStore<TestRow>({ columns: COLUMNS });
	const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: ROWS,
		columns: store.getState().columns,
	});
	return { store, controller };
}

function getVisibleNames(store: GridStore<TestRow>): string[] {
	const count = store.getVisualRowCount();
	const names: string[] = [];
	for (let i = 0; i < count; i++) {
		const vr = store.getVisualRow(i);
		if (vr?.kind === 'data') names.push(String(store.getCellValue(vr.rowId, 'name')));
	}
	return names;
}

// ── Text filter ───────────────────────────────────────────────────────────────

describe('text filter', () => {
	it('contains (default) — case-insensitive partial match', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'a' } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'Date', 'apricot']);
		controller.dispose();
	});

	it('notContains', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ name: { type: 'text', operator: 'notContains', value: 'a' } });
		expect(getVisibleNames(store)).toEqual(['Cherry']);
		controller.dispose();
	});

	it('equals — case-insensitive exact match', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ name: { type: 'text', operator: 'equals', value: 'apple' } });
		expect(getVisibleNames(store)).toEqual(['Apple']);
		controller.dispose();
	});

	it('notEquals', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ name: { type: 'text', operator: 'notEquals', value: 'apple' } });
		expect(getVisibleNames(store)).toEqual(['Banana', 'Cherry', 'Date', 'apricot']);
		controller.dispose();
	});

	it('startsWith', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ name: { type: 'text', operator: 'startsWith', value: 'a' } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'apricot']);
		controller.dispose();
	});

	it('endsWith', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ name: { type: 'text', operator: 'endsWith', value: 'e' } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Date']);
		controller.dispose();
	});

	it('blank — matches empty/null cells', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'text', operator: 'blank', value: '' } });
		expect(getVisibleNames(store)).toEqual(['Date']); // status is null
		controller.dispose();
	});

	it('notBlank — matches non-empty cells', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'text', operator: 'notBlank', value: '' } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'Cherry', 'apricot']);
		controller.dispose();
	});
});

// ── Number filter ─────────────────────────────────────────────────────────────

describe('number filter', () => {
	it('gt', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'gt', value: 50 } });
		expect(getVisibleNames(store)).toEqual(['Cherry', 'Date']);
		controller.dispose();
	});

	it('gte', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'gte', value: 50 } });
		expect(getVisibleNames(store)).toEqual(['Banana', 'Cherry', 'Date']);
		controller.dispose();
	});

	it('lt', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'lt', value: 30 } });
		expect(getVisibleNames(store)).toEqual(['Apple']);
		controller.dispose();
	});

	it('lte', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'lte', value: 30 } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'apricot']);
		controller.dispose();
	});

	it('equals', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'equals', value: 50 } });
		expect(getVisibleNames(store)).toEqual(['Banana']);
		controller.dispose();
	});

	it('notEquals', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'notEquals', value: 50 } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Cherry', 'Date', 'apricot']);
		controller.dispose();
	});

	it('inRange — inclusive on both ends', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'inRange', value: 30, valueTo: 80 } });
		expect(getVisibleNames(store)).toEqual(['Banana', 'Date', 'apricot']);
		controller.dispose();
	});

	it('blank — matches rows where value is empty', () => {
		const { store, controller } = makeStore();
		// No row has a blank price, so expect 0
		store.setFilterModel({ price: { type: 'number', operator: 'blank', value: 0 } });
		expect(getVisibleNames(store)).toHaveLength(0);
		controller.dispose();
	});

	it('notBlank', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ price: { type: 'number', operator: 'notBlank', value: 0 } });
		expect(getVisibleNames(store)).toHaveLength(ROWS.length);
		controller.dispose();
	});
});

// ── Date filter ───────────────────────────────────────────────────────────────

describe('date filter', () => {
	it('before', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ date: { type: 'date', operator: 'before', dateFrom: '2024-01-05' } });
		expect(getVisibleNames(store)).toEqual(['Date']); // 2023-11-01
		controller.dispose();
	});

	it('after', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ date: { type: 'date', operator: 'after', dateFrom: '2024-03-15' } });
		expect(getVisibleNames(store)).toEqual(['Cherry']); // 2024-06-20
		controller.dispose();
	});

	it('equals — same calendar day', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ date: { type: 'date', operator: 'equals', dateFrom: '2024-01-05' } });
		expect(getVisibleNames(store)).toEqual(['Apple']);
		controller.dispose();
	});

	it('inRange — inclusive on both ends', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ date: { type: 'date', operator: 'inRange', dateFrom: '2024-01-05', dateTo: '2024-03-15' } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'apricot']);
		controller.dispose();
	});

	it('blank/notBlank on date column', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ date: { type: 'date', operator: 'blank', dateFrom: '' } });
		expect(getVisibleNames(store)).toHaveLength(0); // all rows have dates
		controller.dispose();
	});
});

// ── Set filter ────────────────────────────────────────────────────────────────

describe('select filter', () => {
	it('includes only rows with matching values', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'select', values: ['Active', 'Pending'] } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Cherry', 'apricot']);
		controller.dispose();
	});

	it('null in values matches blank cells', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'select', values: [null] } });
		expect(getVisibleNames(store)).toEqual(['Date']);
		controller.dispose();
	});

	it('empty values array matches no rows', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'select', values: [] } });
		expect(getVisibleNames(store)).toHaveLength(0);
		controller.dispose();
	});

	it('select filter with null and a value', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'select', values: ['Active', null] } });
		expect(getVisibleNames(store)).toEqual(['Apple', 'Cherry', 'Date']);
		controller.dispose();
	});
});

// ── Compound filter ───────────────────────────────────────────────────────────

describe('compound filter', () => {
	it('AND: both conditions must pass', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({
			price: {
				type: 'compound',
				operator: 'AND',
				conditions: [
					{ type: 'number', operator: 'gt', value: 20 },
					{ type: 'number', operator: 'lt', value: 90 },
				],
			},
		});
		// 30 (apricot), 50 (Banana), 80 (Date) pass both
		expect(getVisibleNames(store)).toEqual(['Banana', 'Date', 'apricot']);
		controller.dispose();
	});

	it('OR: either condition passes', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({
			price: {
				type: 'compound',
				operator: 'OR',
				conditions: [
					{ type: 'number', operator: 'lt', value: 20 },
					{ type: 'number', operator: 'gt', value: 100 },
				],
			},
		});
		// 10 (Apple) < 20, 120 (Cherry) > 100
		expect(getVisibleNames(store)).toEqual(['Apple', 'Cherry']);
		controller.dispose();
	});
});

// ── getColumnDistinctValues ───────────────────────────────────────────────────

describe('getColumnDistinctValues', () => {
	it('returns distinct status values sorted', () => {
		const { store, controller } = makeStore();
		const vals = store.getColumnDistinctValues('status');
		// null sorts first, then alphabetical
		expect(vals).toEqual([null, 'Active', 'Inactive', 'Pending']);
		controller.dispose();
	});

	it('returns distinct numeric values for price', () => {
		const { store, controller } = makeStore();
		const vals = store.getColumnDistinctValues('price');
		// Numbers returned as numbers, sorted
		expect(vals).toEqual([10, 30, 50, 80, 120]);
		controller.dispose();
	});

	it('bounds large distinct-value scans through the summary API', () => {
		const store = new GridStore<{ id: string; status: string }>({
			columns: [{ field: 'id' }, { field: 'status', filterType: 'set' }],
			runtimeLimits: { maxFilterDistinctValues: 2 },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', status: 'Zulu' },
				{ id: '2', status: 'Alpha' },
				{ id: '3', status: 'Beta' },
			],
			columns: store.getState().columns,
		});

		const summary = store.getColumnDistinctValueSummary('status');
		expect(summary.values).toHaveLength(2);
		expect(summary.truncated).toBe(true);
		expect(summary.limit).toBe(2);

		controller.dispose();
	});
});

// ── Quick filter (search across columns) ───────────────────────────────────────

describe('quick filter', () => {
	it('matches across every column by default (no columnIds)', () => {
		const { store, controller } = makeStore();
		// "active" appears in the status column of 'Apple'/'Cherry' (Active) and 'Banana' (Inactive
		// contains "active" as a substring) — not in any name field.
		store.setQuickFilter('active');
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'Cherry']);
		controller.dispose();
	});

	it('is case-insensitive', () => {
		const { store, controller } = makeStore();
		store.setQuickFilter('ACTIVE');
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'Cherry']);
		controller.dispose();
	});

	it('restricts matching to the given columnIds', () => {
		const { store, controller } = makeStore();
		// "active" would also match the status column, but we restrict the search to `name`.
		store.setQuickFilter('active', ['name']);
		expect(getVisibleNames(store)).toEqual([]);
		controller.dispose();
	});

	it('matches a name-only search when restricted to the name column', () => {
		const { store, controller } = makeStore();
		store.setQuickFilter('ban', ['name']);
		expect(getVisibleNames(store)).toEqual(['Banana']);
		controller.dispose();
	});

	it('combines with an active column FilterModel via AND', () => {
		const { store, controller } = makeStore();
		store.setFilterModel({ status: { type: 'text', operator: 'contains', value: 'active' } });
		// Matches 'Active' and 'Inactive' via the column filter...
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'Cherry']);
		// ...quick filter narrows further to rows whose name also contains "ban".
		store.setQuickFilter('ban');
		expect(getVisibleNames(store)).toEqual(['Banana']);
		controller.dispose();
	});

	it('clears when set to an empty or whitespace-only string', () => {
		const { store, controller } = makeStore();
		store.setQuickFilter('active');
		expect(getVisibleNames(store)).not.toEqual(['Apple', 'Banana', 'Cherry', 'Date', 'apricot']);
		store.setQuickFilter('   ');
		expect(getVisibleNames(store)).toEqual(['Apple', 'Banana', 'Cherry', 'Date', 'apricot']);
		expect(store.getQuickFilter()).toBeNull();
		controller.dispose();
	});

	it('getQuickFilter reflects the active model, trimmed', () => {
		const { store, controller } = makeStore();
		expect(store.getQuickFilter()).toBeNull();
		store.setQuickFilter('  apricot  ', ['name']);
		expect(store.getQuickFilter()).toEqual({ text: 'apricot', columnIds: ['name'] });
		controller.dispose();
	});

	it('matches numeric and other non-string column values by their string representation', () => {
		const { store, controller } = makeStore();
		store.setQuickFilter('120');
		expect(getVisibleNames(store)).toEqual(['Cherry']);
		controller.dispose();
	});
});
