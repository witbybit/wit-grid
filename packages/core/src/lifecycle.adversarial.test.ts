/**
 * Lifecycle hardening tests.
 *
 * Invariants under test:
 *   1. dispose() is terminal and idempotent — calling it twice does not throw.
 *   2. Subscriptions are silenced after dispose() — sort/filter changes on the
 *      store do not cause the disposed controller to refresh.
 *   3. store.destroy() is idempotent — calling it twice does not throw.
 *   4. Repeated mount/dispose loops do not accumulate state between iterations.
 */
import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';

interface TestRow {
	id: string;
	name: string;
	value: number;
}

const BASE_COLUMNS = [{ field: 'name', header: 'Name' }];

// ── dispose() is terminal ─────────────────────────────────────────────────────

describe('ClientRowModelController — lifecycle hardening', () => {
	it('dispose() called twice does not throw', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', value: 1 }],
			columns: store.getState().columns,
		});

		expect(() => controller.dispose()).not.toThrow();
		expect(() => controller.dispose()).not.toThrow();
	});

	it('dispose() unregisters sort listener — subsequent sort changes are ignored', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Charlie', value: 3 },
				{ id: '2', name: 'Alice', value: 1 },
			],
			columns: store.getState().columns,
		});

		// Before dispose: rows are in insertion order (no sort)
		expect(controller.getVisualRow(0)?.kind === 'data' ? (controller.getVisualRow(0) as { rowId: string }).rowId : null).toBe('1');

		controller.dispose();

		// After dispose: applying sort should NOT update the controller
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);

		// Controller's visual order unchanged (still insertion order)
		expect(controller.getVisualRowCount()).toBe(2);
		const first = controller.getVisualRow(0);
		expect(first?.kind === 'data' ? (first as { rowId: string }).rowId : null).toBe('1');
	});

	it('dispose() unregisters filter listener — subsequent filter changes are ignored', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', value: 1 },
				{ id: '2', name: 'Bob', value: 2 },
			],
			columns: store.getState().columns,
		});

		const countBefore = controller.getVisualRowCount();
		expect(countBefore).toBe(2);

		controller.dispose();

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'Alice' } });

		// After dispose, row count is unchanged
		expect(controller.getVisualRowCount()).toBe(2);
	});

	it('getVisualRowCount() and getVisualRow() remain stable after dispose() — no crash', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', value: 1 }],
			columns: store.getState().columns,
		});

		controller.dispose();

		// Must not throw and must return consistent data
		expect(() => controller.getVisualRowCount()).not.toThrow();
		expect(() => controller.getVisualRow(0)).not.toThrow();
		expect(controller.getVisualRowCount()).toBe(1);
	});

	// ── store.destroy() is idempotent ─────────────────────────────────────────

	it('store.destroy() called twice does not throw', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});

		expect(() => store.destroy()).not.toThrow();
		expect(() => store.destroy()).not.toThrow();
	});

	// ── mount/dispose loop ────────────────────────────────────────────────────

	it('repeated mount/dispose loops (50 iterations) leave no accumulated state', () => {
		for (let i = 0; i < 50; i++) {
			const store = new GridStore<TestRow>({
				getRowId: (r) => r.id,
				columns: BASE_COLUMNS,
			});
			const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
				rows: [
					{ id: 'a', name: 'Alice', value: 1 },
					{ id: 'b', name: 'Bob', value: 2 },
				],
				columns: store.getState().columns,
			});

			expect(controller.getVisualRowCount()).toBe(2);
			controller.dispose();
			store.destroy();
		}
		// Reaching here without throw or memory corruption is the assertion
		expect(true).toBe(true);
	});

	it('dispose() in event handler during sort change does not crash', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', value: 1 }],
			columns: store.getState().columns,
		});

		// Simulate: consumer disposes the controller in response to any state change
		const unsub = store.subscribe(() => {
			controller.dispose();
			unsub();
		});

		expect(() => store.setSortModel([{ colId: 'name', sort: 'asc' }])).not.toThrow();
	});

	// ── Subscription-count leak detector ─────────────────────────────────────

	it('each mount/dispose cycle installs and removes the same number of event listeners', () => {
		// Use a spy on addEventListener to confirm symmetric registration.
		// At least 5 listeners are registered per constructor (sort, filter, quickFilter, queryModel,
		// grouping, treeData, aggregation, detail, paginationChanged) — 9 total.
		// After dispose(), unsubscribers list must be empty.
		for (let i = 0; i < 5; i++) {
			const store = new GridStore<TestRow>({
				getRowId: (r) => r.id,
				columns: BASE_COLUMNS,
			});
			const runtime = store.getClientRowModelRuntime();
			const addSpy = vi.spyOn(runtime, 'addEventListener');

			const controller = new ClientRowModelController<TestRow>(runtime, {
				rows: [],
				columns: store.getState().columns,
			});

			const registered = addSpy.mock.calls.length;
			expect(registered).toBeGreaterThanOrEqual(5);

			controller.dispose();

			// After dispose() the internal unsubscribers array must be cleared.
			// Access via bracket notation to read private field in tests only.
			const unsubsRemaining = (controller as unknown as { unsubscribers: unknown[] }).unsubscribers.length;
			expect(unsubsRemaining, `iteration ${i}: unsubscribers must be empty after dispose`).toBe(0);

			vi.restoreAllMocks();
		}
	});

	// ── Stale async work is ignored by generation checks ─────────────────────

	it('setSortModel after dispose does not corrupt a new controller on the same store', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: BASE_COLUMNS,
		});

		const oldController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Charlie', value: 3 },
				{ id: '2', name: 'Alice', value: 1 },
			],
			columns: store.getState().columns,
		});
		oldController.dispose();

		// New controller for the same store
		const newController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Charlie', value: 3 },
				{ id: '2', name: 'Alice', value: 1 },
			],
			columns: store.getState().columns,
		});

		// Sort should only affect the new controller
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);

		// New controller responds (Alice before Charlie)
		const newFirst = newController.getVisualRow(0);
		expect(newFirst?.kind === 'data' ? (newFirst as { rowId: string }).rowId : null).toBe('2');

		// Old controller is frozen at insertion order
		const oldFirst = oldController.getVisualRow(0);
		expect(oldFirst?.kind === 'data' ? (oldFirst as { rowId: string }).rowId : null).toBe('1');

		newController.dispose();
	});
});
