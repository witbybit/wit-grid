import { describe, it, expect, vi } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { InfiniteRowModelController, type InfiniteDatasource } from '../infiniteRowModel.js';
import { ServerSideRowModelController, type ServerSideDatasource } from '../serverSideRowModel.js';
import { GridEventName } from '../api/GridEvents.js';
import { createEmptyQueryModel, isQueryModelActive, countQueryNodes } from './GridQueryModel.js';
import type { FilterCondition } from '../filterModel.js';
import { evaluateQueryModel, applyQueryModelFilter, createQueryEvaluationContext } from './evaluateQueryModel.js';
import type { GridQueryGroup, GridQueryModel } from './GridQueryModel.js';
import type { ColumnDef } from '../columnDef.js';
import { RowNode } from '../rowNode.js';

// ── Shared test data ───────────────────────────────────────────────────────────

interface TestRow {
	id: string;
	name: string;
	salary: number;
	hireDate: string;
	dept: string;
}

const COLUMNS: ColumnDef<TestRow>[] = [
	{ field: 'id', header: 'ID' },
	{ field: 'name', header: 'Name', filterDef: { type: 'text' } },
	{ field: 'salary', header: 'Salary', filterDef: { type: 'number' } },
	{ field: 'hireDate', header: 'Hire Date', filterDef: { type: 'date' } },
	{ field: 'dept', header: 'Dept', filterDef: { type: 'select' } },
];

const ROWS: TestRow[] = [
	{ id: '1', name: 'Alice', salary: 90000, hireDate: '2020-03-15', dept: 'Eng' },
	{ id: '2', name: 'Bob', salary: 60000, hireDate: '2021-07-01', dept: 'Sales' },
	{ id: '3', name: 'Carol', salary: 120000, hireDate: '2019-01-10', dept: 'Eng' },
	{ id: '4', name: 'Dave', salary: 45000, hireDate: '2023-11-20', dept: 'HR' },
	{ id: '5', name: 'Eve', salary: 75000, hireDate: '2022-05-05', dept: 'Sales' },
];

function makeStore() {
	const store = new GridStore<TestRow>({
		getRowId: (r) => r.id,
		columns: COLUMNS,
	});
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

let _idSeq = 0;
function uid() {
	return `t${++_idSeq}`;
}

function andGroup(children: GridQueryGroup['children']): GridQueryGroup {
	return { kind: 'group', id: uid(), operator: 'and', children };
}

function orGroup(children: GridQueryGroup['children']): GridQueryGroup {
	return { kind: 'group', id: uid(), operator: 'or', children };
}

/** A condition on a test column, as a filter condition of that column's filter type. */
function cond(columnId: string, operator: string, value?: unknown, valueTo?: unknown): GridQueryGroup['children'][number] {
	let filter: FilterCondition;
	if (columnId === 'salary')
		filter = { type: 'number', operator: operator as 'gt', value: value as number, valueTo: valueTo as number | undefined };
	else if (columnId === 'hireDate')
		filter = { type: 'date', operator: operator as 'after', dateFrom: String(value ?? ''), dateTo: valueTo as string | undefined };
	else if (columnId === 'dept') filter = { type: 'select', values: value as string[], matchMode: operator === 'notIn' ? 'none' : 'any' };
	else filter = { type: 'text', operator: operator as 'contains', value: String(value ?? '') };
	return { kind: 'condition', id: uid(), columnId, filter };
}

function makeQuery(root: GridQueryGroup): GridQueryModel {
	return { version: 1, root };
}

// ── 1–3: API get/set/clear ─────────────────────────────────────────────────────

describe('api.setQueryModel', () => {
	it('no query at first', () => {
		const { store, controller } = makeStore();
		expect(store.getStateSnapshot().queryModel ?? null).toBeNull();
		controller.dispose();
		store.destroy();
	});

	it('stores the model; the snapshot reflects it', () => {
		const { store, controller } = makeStore();
		const model = makeQuery(andGroup([cond('name', 'contains', 'Alice')]));
		store.setQueryModel(model);
		expect(store.getStateSnapshot().queryModel).toEqual(model);
		controller.dispose();
		store.destroy();
	});

	it('null clears it', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('name', 'equals', 'Alice')])));
		store.setQueryModel(null);
		expect(store.getStateSnapshot().queryModel ?? null).toBeNull();
		controller.dispose();
		store.destroy();
	});
});

// ── 4: AND group evaluation ────────────────────────────────────────────────────

describe('AND group evaluation', () => {
	it('only passes rows matching ALL conditions', () => {
		const { store, controller } = makeStore();
		// Eng dept AND salary > 80000 → Alice (90k Eng), Carol (120k Eng)
		store.setQueryModel(makeQuery(andGroup([cond('dept', 'in', ['Eng']), cond('salary', 'gt', 80000)])));
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Carol']);
		controller.dispose();
		store.destroy();
	});
});

// ── 5: OR group evaluation ─────────────────────────────────────────────────────

describe('OR group evaluation', () => {
	it('passes rows matching ANY condition', () => {
		const { store, controller } = makeStore();
		// salary > 100000 OR name equals Bob
		store.setQueryModel(makeQuery(orGroup([cond('salary', 'gt', 100000), cond('name', 'equals', 'Bob')])));
		expect(getVisibleNames(store).sort()).toEqual(['Bob', 'Carol']);
		controller.dispose();
		store.destroy();
	});
});

// ── 6: Nested AND inside OR ────────────────────────────────────────────────────

describe('nested AND inside OR group', () => {
	it('evaluates nested groups correctly', () => {
		const { store, controller } = makeStore();
		// (dept=Eng AND salary>100000) OR name=Bob → Carol, Bob
		store.setQueryModel(
			makeQuery(orGroup([andGroup([cond('dept', 'in', ['Eng']), cond('salary', 'gt', 100000)]), cond('name', 'equals', 'Bob')]))
		);
		expect(getVisibleNames(store).sort()).toEqual(['Bob', 'Carol']);
		controller.dispose();
		store.destroy();
	});
});

// ── 7: Text operator evaluation ───────────────────────────────────────────────

describe('text operator evaluation', () => {
	it('contains — case-insensitive partial match', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('name', 'contains', 'a')])));
		// Alice, Carol, Dave
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Carol', 'Dave']);
		controller.dispose();
		store.destroy();
	});

	it('equals — exact case-insensitive match', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('name', 'equals', 'alice')])));
		expect(getVisibleNames(store)).toEqual(['Alice']);
		controller.dispose();
		store.destroy();
	});

	it('blank — matches rows with empty value', () => {
		const storeBlank = new GridStore<{ id: string; name: string | null }>({
			getRowId: (r) => r.id,
			columns: [{ field: 'id' }, { field: 'name', filterType: 'text' }],
		});
		const ctrl = new ClientRowModelController(storeBlank.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: null },
				{ id: '2', name: 'Bob' },
			],
			columns: storeBlank.getState().columns,
		});
		storeBlank.setQueryModel(makeQuery(andGroup([cond('name', 'blank')])));
		expect(storeBlank.getVisualRowCount()).toBe(1);
		ctrl.dispose();
		storeBlank.destroy();
	});
});

// ── 8: Number operator evaluation ─────────────────────────────────────────────

describe('number operator evaluation', () => {
	it('gt — greater than', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('salary', 'gt', 80000)])));
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Carol']);
		controller.dispose();
		store.destroy();
	});

	it('lte — less than or equal', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('salary', 'lte', 60000)])));
		expect(getVisibleNames(store).sort()).toEqual(['Bob', 'Dave']);
		controller.dispose();
		store.destroy();
	});

	it('inRange — inclusive range', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('salary', 'inRange', 60000, 90000)])));
		// 60000 (Bob), 75000 (Eve), 90000 (Alice)
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Bob', 'Eve']);
		controller.dispose();
		store.destroy();
	});
});

// ── 9: Date operator evaluation ───────────────────────────────────────────────

describe('date operator evaluation', () => {
	it('before — filters rows hired before a date', () => {
		const { store, controller } = makeStore();
		// Carol (2019-01-10) is before 2020-01-01
		store.setQueryModel(makeQuery(andGroup([cond('hireDate', 'before', '2020-01-01')])));
		expect(getVisibleNames(store)).toEqual(['Carol']);
		controller.dispose();
		store.destroy();
	});

	it('after — filters rows hired after a date', () => {
		const { store, controller } = makeStore();
		// Dave (2023-11-20), Eve (2022-05-05)
		store.setQueryModel(makeQuery(andGroup([cond('hireDate', 'after', '2022-01-01')])));
		expect(getVisibleNames(store).sort()).toEqual(['Dave', 'Eve']);
		controller.dispose();
		store.destroy();
	});

	it('inRange — inclusive date range', () => {
		const { store, controller } = makeStore();
		// 2020-03-15 (Alice) to 2021-07-01 (Bob)
		store.setQueryModel(makeQuery(andGroup([cond('hireDate', 'inRange', '2020-01-01', '2022-01-01')])));
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Bob']);
		controller.dispose();
		store.destroy();
	});
});

// ── 10: Set operator evaluation ───────────────────────────────────────────────

describe('set operator evaluation', () => {
	it('in — passes rows whose value is in the set', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('dept', 'in', ['Eng', 'HR'])])));
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Carol', 'Dave']);
		controller.dispose();
		store.destroy();
	});

	it('notIn — passes rows whose value is not in the set', () => {
		const { store, controller } = makeStore();
		store.setQueryModel(makeQuery(andGroup([cond('dept', 'notIn', ['Eng'])])));
		expect(getVisibleNames(store).sort()).toEqual(['Bob', 'Dave', 'Eve']);
		controller.dispose();
		store.destroy();
	});
});

// ── 11: Invalid condition (unknown column) — diagnostic, no crash ─────────────

describe('invalid condition diagnostics', () => {
	it('unknown column produces a diagnostic and does not drop the row', () => {
		const diagnostics: unknown[] = [];
		const ctx = createQueryEvaluationContext(COLUMNS as ColumnDef<TestRow>[], (d) => diagnostics.push(d));
		// Build a fake RowNode-like object
		const rowNode = {
			data: ROWS[0],
			getCellValue: (_field: string, getter: (d: TestRow) => unknown) => getter(ROWS[0]),
		} as unknown as RowNode<TestRow>;
		const model = makeQuery(andGroup([cond('nonexistent', 'contains', 'x')]));
		const result = evaluateQueryModel(model, rowNode, ctx);
		expect(result).toBe(true); // passes — unknown column is treated as pass
		expect(diagnostics.length).toBeGreaterThan(0);
		expect((diagnostics[0] as { reason: string }).reason).toBe('unknown-column');
	});
});

// ── 12: filterModel AND queryModel — both must pass ───────────────────────────

describe('filterModel AND queryModel combined', () => {
	it('a row must pass both filterModel and queryModel to be visible', () => {
		const { store, controller } = makeStore();
		// filterModel: dept contains 'Eng' (text) → Alice, Carol
		store.setFilterModel({ dept: { type: 'text', operator: 'contains', value: 'Eng' } });
		// queryModel: salary > 100000 → Carol (120k)
		store.setQueryModel(makeQuery(andGroup([cond('salary', 'gt', 100000)])));
		expect(getVisibleNames(store)).toEqual(['Carol']);
		controller.dispose();
		store.destroy();
	});
});

// ── 13: Client row pipeline applies queryModel ────────────────────────────────

describe('client row pipeline queryModel integration', () => {
	it('queryModel is applied after filterModel stage in client pipeline', () => {
		const { store, controller } = makeStore();
		// With no filters: 5 rows
		expect(store.getVisualRowCount()).toBe(5);
		// Apply queryModel: salary >= 75000 → Alice (90k), Carol (120k), Eve (75k)
		store.setQueryModel(makeQuery(andGroup([cond('salary', 'gte', 75000)])));
		expect(getVisibleNames(store).sort()).toEqual(['Alice', 'Carol', 'Eve']);
		controller.dispose();
		store.destroy();
	});
});

// ── 14: Infinite datasource receives queryModel in getRows params ──────────────

describe('infinite datasource queryModel passthrough', () => {
	it('queryModel is passed to InfiniteRowModel getRows params', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: COLUMNS,
		});
		const model = makeQuery(andGroup([cond('name', 'contains', 'Alice')]));
		store.setQueryModel(model);

		const getRows = vi.fn().mockResolvedValue({ rows: ROWS.slice(0, 1), totalCount: 1 });
		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: { getRows } as InfiniteDatasource<TestRow>,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRows).toHaveBeenCalled();
		const params = getRows.mock.calls[0][0];
		expect(params.queryModel).toEqual(model);
		controller.dispose();
		store.destroy();
	});
});

// ── 15: Server datasource receives queryModel in getRows params ──────────────

describe('server datasource queryModel passthrough', () => {
	it('queryModel is passed to ServerSideRowModel getRows requests', async () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: COLUMNS,
		});
		const model = makeQuery(andGroup([cond('salary', 'gt', 50000)]));
		store.setQueryModel(model);

		const getRows = vi.fn().mockResolvedValue({ rows: ROWS, rowCount: ROWS.length });
		const controller = new ServerSideRowModelController(store.getServerSideRowModelRuntime(), {
			datasource: { getRows } as ServerSideDatasource<TestRow>,
			blockSize: 50,
			columns: store.getState().columns,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getRows).toHaveBeenCalled();
		const params = getRows.mock.calls[0][0];
		expect(params.queryModel).toEqual(model);
		controller.dispose();
		store.destroy();
	});
});

// ── 16: queryModel fires queryModelChanged event ──────────────────────────────

describe('queryModelChanged event', () => {
	it('fires queryModelChanged with the new model when setQueryModel is called', () => {
		const { store, controller } = makeStore();
		const events: unknown[] = [];
		store.addEventListener(GridEventName.queryModelChanged, (e) => events.push(e));

		const model = makeQuery(andGroup([cond('name', 'equals', 'Alice')]));
		store.setQueryModel(model);

		expect(events.length).toBe(1);
		const payload = (events[0] as { payload: { queryModel: GridQueryModel } }).payload;
		expect(payload.queryModel).toEqual(model);

		store.setQueryModel(null);
		expect(events.length).toBe(2);
		const payload2 = (events[1] as { payload: { queryModel: null } }).payload;
		expect(payload2.queryModel).toBeNull();

		controller.dispose();
		store.destroy();
	});
});
