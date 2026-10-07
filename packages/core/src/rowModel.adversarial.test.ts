/**
 * Adversarial differential tests for ClientRowModelController.
 *
 * Invariant: the incremental output of the controller must always equal the
 * output of a fresh full-rebuild via applyClientSortAndFilter on the same
 * dataset with the same sort/filter state.
 *
 * All sequences are generated with a seeded deterministic LCG — no nondeterministic
 * RNG, no real timers, no network. Each seed produces a reproducible failing trace.
 */
import { describe, it, expect } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController, applyClientSortAndFilter } from './rowModel.js';
import type { SortModel, FilterModel } from './rowModel.js';
import type { ColumnDef } from './columnDef.js';

// ── Deterministic LCG PRNG ────────────────────────────────────────────────────

function makeLcg(seed: number): () => number {
	let s = seed >>> 0;
	return (): number => {
		s = Math.imul(1664525, s) + 1013904223;
		s = s >>> 0;
		return s / 0x100000000;
	};
}

function lcgInt(rng: () => number, max: number): number {
	return Math.floor(rng() * max);
}

// ── Test domain ───────────────────────────────────────────────────────────────

interface TestRow {
	id: string;
	name: string;
	amount: number;
}

const COLUMNS: ColumnDef<TestRow>[] = [
	{ field: 'name', header: 'Name' },
	{ field: 'amount', header: 'Amount' },
];

const NAME_POOL = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Iris', 'Jack'];

function applyStructuralTransaction(
	controller: ClientRowModelController<TestRow>,
	transaction: Parameters<ClientRowModelController<TestRow>['applyTransactionStructurally']>[0]
): void {
	const writeResult = controller.applyTransactionStructurally(transaction);
	const hasStructural = (writeResult.addedNodes?.length ?? 0) > 0 || (writeResult.removedNodes?.length ?? 0) > 0;
	const changedFields = new Set<string>();
	for (const fields of writeResult.changedFieldsByRow?.values() ?? []) {
		for (const field of fields) changedFields.add(field);
	}
	controller.reconcileAfterDataWrite(
		writeResult,
		hasStructural ? 'insert' : changedFields.size > 0 ? controller.classifyFieldMutation(changedFields) : 'value-only'
	);
}

// ── Reference + invariant checker ────────────────────────────────────────────

function checkInvariants(controller: ClientRowModelController<TestRow>, store: GridStore<TestRow>, opLabel: string): void {
	const allNodes = controller.getAllDataNodes!()!;
	const state = store.getState();

	const reference = applyClientSortAndFilter(allNodes, COLUMNS, state.sortModel, state.filterModel);
	const refIds = reference.map((r) => r.node.id);

	const incrementalIds: string[] = [];
	for (let i = 0; i < controller.getVisualRowCount(); i++) {
		const row = controller.getVisualRow(i);
		if (row?.kind === 'data') incrementalIds.push(row.rowId);
	}

	expect(incrementalIds, `[${opLabel}] incremental row order must match reference`).toEqual(refIds);

	// Visual-index round-trip invariant
	for (let i = 0; i < controller.getVisualRowCount(); i++) {
		const row = controller.getVisualRow(i);
		if (row?.kind !== 'data') continue;
		expect(controller.getVisualIndexByRowId(row.rowId), `[${opLabel}] getVisualIndexByRowId('${row.rowId}') must be ${i}`).toBe(i);
		expect(controller.getVisualIndexById(row.id), `[${opLabel}] getVisualIndexById('${row.id}') must be ${i}`).toBe(i);
	}
}

// ── Sequence runner ───────────────────────────────────────────────────────────

const OP_ADD = 0;
const OP_REMOVE = 1;
const OP_UPDATE = 2;
const OP_SORT_ASC = 3;
const OP_SORT_DESC = 4;
const OP_CLEAR_SORT = 5;
const OP_SET_FILTER = 6;
const OP_CLEAR_FILTER = 7;
const OP_COUNT = 8;

function runAdversarialSequence(seed: number, steps: number): void {
	const rng = makeLcg(seed);

	const store = new GridStore<TestRow>({
		getRowId: (row) => row.id,
		columns: COLUMNS,
	});

	let nextId = 1;
	const initialRows: TestRow[] = [];
	for (let i = 0; i < 5; i++) {
		initialRows.push({
			id: String(nextId++),
			name: NAME_POOL[lcgInt(rng, NAME_POOL.length)],
			amount: lcgInt(rng, 200),
		});
	}

	const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: initialRows,
		columns: store.getState().columns,
	});

	checkInvariants(controller, store, 'init');

	for (let step = 0; step < steps; step++) {
		const op = lcgInt(rng, OP_COUNT);
		const allNodes = controller.getAllDataNodes!()!;
		const label = `seed=${seed.toString(16)},step=${step},op=${op}`;

		if (op === OP_ADD) {
			const newRow: TestRow = {
				id: String(nextId++),
				name: NAME_POOL[lcgInt(rng, NAME_POOL.length)],
				amount: lcgInt(rng, 200),
			};
			applyStructuralTransaction(controller, { add: [newRow] });
		} else if (op === OP_REMOVE) {
			if (allNodes.length > 0) {
				const target = allNodes[lcgInt(rng, allNodes.length)];
				applyStructuralTransaction(controller, { remove: [target.data] });
			}
		} else if (op === OP_UPDATE) {
			if (allNodes.length > 0) {
				const target = allNodes[lcgInt(rng, allNodes.length)];
				const newAmount = lcgInt(rng, 200);
				const cellWr = controller.writeCellValueStructurally(target.id, 'amount', newAmount);
				controller.reconcileAfterDataWrite(cellWr, controller.classifyFieldMutation(new Set(['amount'])));
			}
		} else if (op === OP_SORT_ASC) {
			const colId = lcgInt(rng, 2) === 0 ? 'name' : 'amount';
			store.setSortModel([{ colId, sort: 'asc' }]);
		} else if (op === OP_SORT_DESC) {
			const colId = lcgInt(rng, 2) === 0 ? 'name' : 'amount';
			store.setSortModel([{ colId, sort: 'desc' }]);
		} else if (op === OP_CLEAR_SORT) {
			store.setSortModel(null);
		} else if (op === OP_SET_FILTER) {
			const threshold = lcgInt(rng, 150);
			const filterModel: FilterModel = {
				amount: { type: 'number', operator: 'gt', value: threshold },
			};
			store.setFilterModel(filterModel);
		} else if (op === OP_CLEAR_FILTER) {
			store.setFilterModel(null);
		}

		checkInvariants(controller, store, label);
	}

	controller.dispose();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClientRowModelController — adversarial differential invariants', () => {
	it('incremental output equals full-rebuild reference under 200 flat mutations (seed 0xdeadbeef)', () => {
		runAdversarialSequence(0xdeadbeef, 200);
	});

	it('incremental output equals full-rebuild reference under 200 flat mutations (seed 0xcafebabe)', () => {
		runAdversarialSequence(0xcafebabe, 200);
	});

	it('incremental output equals full-rebuild reference under 200 flat mutations (seed 0x01234567)', () => {
		runAdversarialSequence(0x01234567, 200);
	});

	it('getVisualRow/getVisualIndexById round-trip holds for all visual rows after repeated add/remove', () => {
		const rng = makeLcg(0xfeedface);
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: COLUMNS,
		});

		let nextId = 1;
		const initial: TestRow[] = Array.from({ length: 10 }, () => ({
			id: String(nextId++),
			name: NAME_POOL[lcgInt(rng, NAME_POOL.length)],
			amount: lcgInt(rng, 200),
		}));

		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: initial,
			columns: store.getState().columns,
		});

		for (let i = 0; i < 50; i++) {
			const nodes = controller.getAllDataNodes!()!;
			if (nodes.length > 1 && lcgInt(rng, 2) === 0) {
				const idx = lcgInt(rng, nodes.length);
				applyStructuralTransaction(controller, { remove: [nodes[idx].data] });
			} else {
				applyStructuralTransaction(controller, {
					add: [{ id: String(nextId++), name: NAME_POOL[lcgInt(rng, NAME_POOL.length)], amount: lcgInt(rng, 200) }],
				});
			}

			const count = controller.getVisualRowCount();
			for (let j = 0; j < count; j++) {
				const row = controller.getVisualRow(j);
				expect(row, `visual row at index ${j} must exist`).not.toBeNull();
				if (row?.kind === 'data') {
					expect(controller.getVisualIndexByRowId(row.rowId)).toBe(j);
					expect(controller.getVisualIndexById(row.id)).toBe(j);
					expect(controller.getRawRowById!(row.rowId)).not.toBeNull();
				}
			}

			expect(controller.getVisualRow(-1)).toBeNull();
			expect(controller.getVisualRow(count)).toBeNull();
		}

		controller.dispose();
	});

	it('visual row count equals reference count after concurrent sort and filter changes', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: COLUMNS,
		});

		const rows: TestRow[] = [
			{ id: '1', name: 'Alice', amount: 10 },
			{ id: '2', name: 'Bob', amount: 50 },
			{ id: '3', name: 'Charlie', amount: 30 },
			{ id: '4', name: 'Diana', amount: 80 },
			{ id: '5', name: 'Eve', amount: 20 },
		];

		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		// filter then sort — both applied in state, model rebuilt once
		store.setFilterModel({ amount: { type: 'number', operator: 'gt', value: 25 } });
		store.setSortModel([{ colId: 'amount', sort: 'asc' }]);
		checkInvariants(controller, store, 'filter+sort');

		// change filter while sort is active
		store.setFilterModel({ amount: { type: 'number', operator: 'lt', value: 60 } });
		checkInvariants(controller, store, 'change-filter');

		// add rows while filtered+sorted
		applyStructuralTransaction(controller, { add: [{ id: '6', name: 'Frank', amount: 45 }] });
		checkInvariants(controller, store, 'add-while-filtered');

		// remove a visible row
		applyStructuralTransaction(controller, { remove: [{ id: '3', name: 'Charlie', amount: 30 }] });
		checkInvariants(controller, store, 'remove-while-filtered');

		// clear both
		store.setFilterModel(null);
		store.setSortModel(null);
		checkInvariants(controller, store, 'clear-all');

		controller.dispose();
	});

	it('transaction add+remove in the same call preserves invariants', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: COLUMNS,
			sortModel: [{ colId: 'name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Charlie', amount: 30 },
				{ id: '2', name: 'Alice', amount: 10 },
				{ id: '3', name: 'Bob', amount: 20 },
			],
			columns: store.getState().columns,
		});

		applyStructuralTransaction(controller, {
			add: [{ id: '4', name: 'Diana', amount: 40 }],
			remove: [{ id: '2', name: 'Alice', amount: 10 }],
		});

		checkInvariants(controller, store, 'combined-add-remove');

		controller.dispose();
	});

	it('full replace via setRows resets visual order to match reference', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: COLUMNS,
			sortModel: [{ colId: 'amount', sort: 'desc' }],
		});

		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', amount: 10 },
				{ id: '2', name: 'Bob', amount: 50 },
			],
			columns: store.getState().columns,
		});

		checkInvariants(controller, store, 'before-setRows');

		const setRowsResult = controller.replaceRowsStructurally([
			{ id: '3', name: 'Zoe', amount: 5 },
			{ id: '4', name: 'Anna', amount: 99 },
			{ id: '5', name: 'Mark', amount: 42 },
		]);
		controller.reconcileAfterDataWrite(setRowsResult, 'value-only');

		checkInvariants(controller, store, 'after-setRows');

		controller.dispose();
	});
});
