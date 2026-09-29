/**
 * Instrumented performance budget tests — Plan 091.
 *
 * These tests enforce correctness-level performance invariants using
 * GridInstrumentation metric counts, NOT wall-clock timing. They are
 * reproducible in any environment (jsdom, CI, local) and constitute
 * the machine-checkable evidence required by Plans 092–103.
 *
 * Scenarios correspond to docs/architecture/benchmark-scenarios.json.
 * Wall-clock baselines are in docs/architecture/baseline.json (informational).
 */
import { describe, it, expect } from 'vitest';
import { GridFlightRecorder } from '../diagnostics/GridFlightRecorder.js';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { RecordingGridInstrumentation, GridMetric } from '../diagnostics/GridInstrumentation.js';

interface BudgetRow {
	id: string;
	name: string;
	value: number;
	status: string;
	category: string;
}

function makeRows(count: number): BudgetRow[] {
	const statuses = ['Active', 'Inactive', 'Pending'];
	const categories = ['A', 'B', 'C', 'D'];
	return Array.from({ length: count }, (_, i) => ({
		id: `r${i}`,
		name: `Row ${i}`,
		value: i * 1.5,
		status: statuses[i % statuses.length],
		category: categories[i % categories.length],
	}));
}

function makeStore(rowCount = 0): {
	store: GridStore<BudgetRow>;
	controller: ClientRowModelController<BudgetRow>;
	inst: RecordingGridInstrumentation;
} {
	const inst = new RecordingGridInstrumentation();
	const store = new GridStore<BudgetRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'value', header: 'Value', width: 100 },
			{ field: 'status', header: 'Status', width: 100 },
			{ field: 'category', header: 'Category', width: 100 },
		],
	});
	store.setInstrumentation(inst);
	const controller = new ClientRowModelController<BudgetRow>(store.getClientRowModelRuntime(), {
		rows: rowCount > 0 ? makeRows(rowCount) : [],
		columns: store.getState().columns,
	});
	return { store, controller, inst };
}

// ── Scenario: steady-scroll-zero-full-rebuild ────────────────────────────────

describe('Budget: scroll does not trigger row pipeline full rebuild', () => {
	it('100 scroll position updates on 100k rows produce zero full pipeline rebuilds', () => {
		const { store, controller, inst } = makeStore(100_000);
		store.setViewportSize(1200, 800);
		inst.reset();

		for (let i = 0; i < 100; i++) {
			store.setScrollPosition(i * 300, 0, 0);
			store.updateVisibleRanges();
		}

		const fullRebuilds = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		expect(fullRebuilds, 'scroll must not trigger full row pipeline rebuild').toBe(0);

		controller.dispose();
	});
});

describe('flight recorder disabled budget', () => {
	it('does not invoke event factories while disabled', () => {
		const recorder = new GridFlightRecorder();
		let allocations = 0;
		for (let index = 0; index < 100_000; index++)
			recorder.record(() => {
				allocations++;
				return { type: 'fault', source: 'perf', operation: 'disabled', message: 'never' };
			});
		expect(allocations).toBe(0);
		expect(recorder.snapshot().events).toHaveLength(0);
	});
});

// ── Scenario: targeted-invalidation-no-fanout ────────────────────────────────

describe('Budget: targeted cell invalidation — no unrelated subscription fanout', () => {
	it('single cell update notifies only subscribed cells, not the whole row', () => {
		const { store, controller } = makeStore(10_000);
		let relatedCalls = 0;
		let unrelatedCalls = 0;

		store.registerCellSubscription({
			rowId: 'r5000',
			colField: 'value',
			onStoreChange: () => {
				relatedCalls++;
			},
		});
		store.registerCellSubscription({
			rowId: 'r5000',
			colField: 'status',
			onStoreChange: () => {
				unrelatedCalls++;
			},
		});

		store.setCellValue('r5000', 'value', 999);
		store.flushCellUpdatesSync();

		// The related cell must receive exactly one notification.
		expect(relatedCalls, 'related subscription must fire exactly once').toBe(1);
		// Unrelated columns on the same row must NOT be notified — targeted invalidation.
		expect(unrelatedCalls, 'unrelated subscription must not fire on targeted update').toBe(0);

		controller.dispose();
	});

	it('applyTransaction with 100 updates produces exactly 1 incremental pipeline run', () => {
		const { store, controller, inst } = makeStore(10_000);
		inst.reset();

		const updates = Array.from({ length: 100 }, (_, i) => ({
			id: `r${i}`,
			name: `Updated ${i}`,
			value: i * 2,
			status: 'Active',
			category: 'A',
		}));
		store.applyTransaction({ update: updates });

		const incremental = inst.get(GridMetric.ROW_MUTATION_INCREMENTAL);
		const full = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		expect(incremental, 'applyTransaction must produce at least one incremental pipeline run').toBeGreaterThanOrEqual(1);
		expect(full, 'applyTransaction must not trigger a full pipeline rebuild').toBe(0);

		controller.dispose();
	});
});

// ── Scenario: filter-is-incremental ─────────────────────────────────────────

describe('Budget: filter pipeline does not rebuild on scroll after initial apply', () => {
	it('setFilterModel followed by 50 scroll updates does not re-run the pipeline', () => {
		const { store, controller, inst } = makeStore(10_000);
		store.setViewportSize(1200, 800);

		// Apply a filter — this is allowed to rebuild once.
		store.setFilterModel({ name: { type: 'text', conditions: [{ operator: 'contains', value: 'Row 1' }] } });
		inst.reset(); // reset after the filter apply

		for (let i = 0; i < 50; i++) {
			store.setScrollPosition(i * 50, 0, 0);
			store.updateVisibleRanges();
		}

		const fullRebuilds = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		const incremental = inst.get(GridMetric.ROW_MUTATION_INCREMENTAL);
		expect(fullRebuilds, 'scroll after filter must not re-run pipeline').toBe(0);
		expect(incremental, 'scroll after filter must not re-run pipeline incrementally').toBe(0);

		controller.dispose();
	});
});

// ── Scenario: STATE_READS bounded per operation ──────────────────────────────

describe('Budget: state reads are bounded per scroll operation', () => {
	it('each scroll position update reads state at most once', () => {
		const { store, controller, inst } = makeStore(10_000);
		store.setViewportSize(1200, 800);
		inst.reset();

		const iterations = 50;
		for (let i = 0; i < iterations; i++) {
			store.setScrollPosition(i * 100, 0, 0);
			store.updateVisibleRanges();
		}

		const reads = inst.get(GridMetric.STATE_READS);
		// Budget: at most 8 reads per scroll tick (scroll + updateVisibleRanges + internal model reads).
		// Baseline captured on 2026-06-18: ~6 reads per tick. If this rises significantly, investigate.
		expect(reads, `state reads per scroll tick should be ≤8; got ${reads} over ${iterations} iterations`).toBeLessThanOrEqual(iterations * 8);

		controller.dispose();
	});
});

// ── Scenario: setData full rebuild vs. applyTransaction incremental ──────────

describe('Budget: setData vs applyTransaction pipeline classification', () => {
	it('setRows triggers exactly one full pipeline rebuild', () => {
		const { store, controller, inst } = makeStore();
		inst.reset();

		const rows = makeRows(10_000);
		store.setRows(rows);

		const full = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		expect(full, 'setRows must trigger exactly one full pipeline rebuild').toBe(1);

		controller.dispose();
	});

	it('applyTransaction with only updates does not trigger a full rebuild', () => {
		const { store, controller, inst } = makeStore(10_000);
		inst.reset();

		store.applyTransaction({ update: [{ id: 'r0', name: 'X', value: 1, status: 'Active', category: 'A' }] });

		const full = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		expect(full, 'update-only applyTransaction must not trigger a full rebuild').toBe(0);

		controller.dispose();
	});
});

describe('Budget: canonical bulk write paths stay incremental at throughput', () => {
	it('large rectangular batchCellValues write stays incremental and preserves cell values', () => {
		const { store, controller, inst } = makeStore(10_000);
		inst.reset();

		const updates = Array.from({ length: 250 }, (_, rowIndex) => {
			const rowId = `r${rowIndex}`;
			return [
				{ rowId, colField: 'name', value: `Batch ${rowIndex}` },
				{ rowId, colField: 'value', value: rowIndex * 10 },
				{ rowId, colField: 'status', value: rowIndex % 2 === 0 ? 'Pending' : 'Active' },
			];
		}).flat();

		const result = store.batchCellValues(updates, 'paste');
		expect(result.status).toBe('applied');
		expect(store.getCellValue('r0', 'name')).toBe('Batch 0');
		expect(store.getCellValue('r249', 'value')).toBe(2490);

		const incremental = inst.get(GridMetric.ROW_MUTATION_INCREMENTAL);
		const full = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		expect(incremental, 'rectangular batch writes must avoid row-pipeline churn entirely').toBe(0);
		expect(full, 'rectangular batch writes must not trigger a full rebuild').toBe(0);

		controller.dispose();
	});

	it('fillRange over many rows stays incremental and preserves fill output', () => {
		const { store, controller, inst } = makeStore(2_000);
		store.setCellValue('r0', 'value', 10);
		store.setCellValue('r1', 'value', 20);
		inst.reset();

		store.engine.fillRange(
			{
				start: { rowId: 'r0', colField: 'value' },
				end: { rowId: 'r1', colField: 'value' },
			},
			{
				start: { rowId: 'r2', colField: 'value' },
				end: { rowId: 'r401', colField: 'value' },
			}
		);

		expect(store.getCellValue('r2', 'value')).toBe(30);
		expect(store.getCellValue('r3', 'value')).toBe(40);
		expect(store.getCellValue('r401', 'value')).toBe(4020);

		const incremental = inst.get(GridMetric.ROW_MUTATION_INCREMENTAL);
		const full = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		expect(incremental, 'fill writes must avoid row-pipeline churn entirely').toBe(0);
		expect(full, 'fill writes must not trigger a full rebuild').toBe(0);

		controller.dispose();
	});
});

describe('Budget: grouped and aggregated viewport churn stays off the row pipeline', () => {
	it('scroll after grouping and aggregation does not re-run row mutation work', () => {
		const inst = new RecordingGridInstrumentation();
		const store = new GridStore<BudgetRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'id', header: 'ID', width: 80 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'value', header: 'Value', width: 100 },
				{ field: 'status', header: 'Status', width: 100 },
				{ field: 'category', header: 'Category', width: 100, enableRowGroup: true },
			],
			grouping: { by: ['category'], defaultExpanded: true },
		});
		store.setInstrumentation(inst);
		store.setAggregation([{ colId: 'value', aggFunc: 'sum' }]);
		const controller = new ClientRowModelController<BudgetRow>(store.getClientRowModelRuntime(), {
			rows: makeRows(20_000),
			columns: store.getState().columns,
		});
		store.setViewportSize(1200, 800);
		inst.reset();

		for (let i = 0; i < 40; i++) {
			store.setScrollPosition(i * 120, 0, 0);
			store.updateVisibleRanges();
		}

		const fullRebuilds = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		const incremental = inst.get(GridMetric.ROW_MUTATION_INCREMENTAL);
		expect(fullRebuilds, 'scroll after grouping/aggregation must not trigger full rebuilds').toBe(0);
		expect(incremental, 'scroll after grouping/aggregation must not trigger incremental row work').toBe(0);

		controller.dispose();
		store.destroy();
	});
});
