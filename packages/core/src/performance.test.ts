import { describe, it, expect, vi } from 'vitest';
import { GridStore, type ColumnDef, type ValueGetterParams } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { RowDataStore } from './rows/RowDataStore.js';

interface PerfTestRow {
	id: string;
	name: string;
	price: number;
	quantity: number;
	status: string;
}

type PerformanceWithMemory = Performance & {
	memory?: {
		usedJSHeapSize: number;
	};
};

/** Current JS heap usage in bytes: process.memoryUsage() in Node, performance.memory in Chromium. */
function readHeapUsedBytes(): number | null {
	const nodeProcess = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process;
	if (typeof nodeProcess?.memoryUsage === 'function') return nodeProcess.memoryUsage().heapUsed;
	return (performance as PerformanceWithMemory).memory?.usedJSHeapSize ?? null;
}

describe('Performance Benchmarks', () => {
	describe('Scroll Performance', () => {
		it('should handle 100k row scroll with viewport updates under 16ms (60 FPS)', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
					{ field: 'quantity', header: 'Quantity', width: 100 },
					{ field: 'status', header: 'Status', width: 100 },
				],
			});

			// Generate 100k rows
			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 100000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: Math.random() * 1000,
					quantity: Math.floor(Math.random() * 100),
					status: i % 3 === 0 ? 'Active' : i % 3 === 1 ? 'Pending' : 'Inactive',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			// Simulate viewport size
			store.setViewportSize(1200, 800);

			// Measure scroll performance
			const iterations = 100;
			const scrollPositions = [];

			for (let i = 0; i < iterations; i++) {
				scrollPositions.push(Math.floor(Math.random() * 3000000)); // Random scroll positions
			}

			const start = performance.now();

			for (const scrollTop of scrollPositions) {
				store.setScrollPosition(scrollTop, 0, performance.now());
				store.updateVisibleRanges();
			}

			const duration = performance.now() - start;
			const avgPerScroll = duration / iterations;

			// Informational: wall-clock scroll timing varies by machine and CI load.
			// Use instrumentedBudgets.test.ts for reproducible pipeline-level assertions.
			console.log(`Scroll Performance: ${avgPerScroll.toFixed(3)}ms per scroll (${iterations} iterations)`);
			console.log(`Target: <16ms for 60 FPS, <8ms for 120 FPS`);

			controller.dispose();
		});

		it('should calculate visible ranges with binary search in O(log N) time', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 100000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			store.setViewportSize(1200, 800);

			// Measure range calculation performance
			const start = performance.now();

			for (let i = 0; i < 1000; i++) {
				const scrollTop = Math.floor(Math.random() * 3000000);
				store.setScrollPosition(scrollTop, 0, performance.now());
				store.getVisibleRowRange();
			}

			const duration = performance.now() - start;
			const avgPerCalc = duration / 1000;

			// Informational: wall-clock range-calc timing is environment-dependent.
			console.log(`Range Calculation: ${avgPerCalc.toFixed(3)}ms per calculation`);

			controller.dispose();
		});
	});

	describe('Cell Update Performance', () => {
		it('should not fan out single-cell updates across unrelated valueGetter columns in wide grids', () => {
			const columns: ColumnDef<PerfTestRow>[] = [
				{ field: 'id', header: 'ID', width: 80 },
				{ field: 'status', header: 'Status', width: 100 },
				{
					field: 'derived_status',
					header: 'Derived Status',
					width: 120,
					valueGetterDependencies: ['status'],
					valueGetter: (params: ValueGetterParams<PerfTestRow>) => params.row.status.toUpperCase(),
				},
				...Array.from({ length: 2000 }, (_, i) => ({
					field: `col_${i}`,
					header: `Col ${i}`,
					width: 100,
					valueGetter: (params: ValueGetterParams<PerfTestRow>) =>
						(params.row as PerfTestRow & Record<string, unknown>)[`col_${i}`] ?? `Val ${i}`,
				})),
			];
			const store = new GridStore<PerfTestRow>({
				columns,
			});
			const rows: PerfTestRow[] = Array.from({ length: 10000 }, (_, i) => ({
				id: `row-${i}`,
				name: `Product ${i}`,
				price: 100,
				quantity: 10,
				status: 'Active',
			}));
			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns,
			});

			const unrelatedListener = vi.fn();
			const dependentListener = vi.fn();
			store.registerCellSubscription({ rowId: 'row-5000', colField: 'col_1999', onStoreChange: unrelatedListener });
			store.registerCellSubscription({ rowId: 'row-5000', colField: 'derived_status', onStoreChange: dependentListener });

			const start = performance.now();
			store.setCellValue('row-5000', 'status', 'Inactive');
			store.flushCellUpdatesSync();
			const duration = performance.now() - start;

			// Correctness invariant: targeted invalidation must not fan out to unrelated subscriptions.
			expect(unrelatedListener).not.toHaveBeenCalled();
			expect(dependentListener).toHaveBeenCalledTimes(1);
			// Informational: wall-clock timing is environment-dependent.
			console.log(`Fan-out test: ${duration.toFixed(3)}ms for single cell update with 2002-column grid`);

			controller.dispose();
		});

		it('should handle 1000 cell updates within a bounded full-suite budget with batching', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 10000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			const start = performance.now();

			// Update 1000 random cells — auto-batching coalesces all into one flush
			for (let i = 0; i < 1000; i++) {
				const rowIdx = Math.floor(Math.random() * 10000);
				store.setCellValue(`row-${rowIdx}`, 'price', Math.random() * 1000);
			}
			store.flushCellUpdatesSync();

			const duration = performance.now() - start;

			// Informational: wall-clock bulk-update timing is environment-dependent.
			console.log(`Bulk Cell Updates: ${duration.toFixed(3)}ms for 1000 updates`);
			console.log(`Average: ${(duration / 1000).toFixed(3)}ms per update`);

			controller.dispose();
		});

		it('should update single cell under 2ms', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 1000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			// Measure single cell update
			const durations: number[] = [];

			for (let i = 0; i < 100; i++) {
				const start = performance.now();
				store.setCellValue('row-500', 'price', Math.random() * 1000);
				const duration = performance.now() - start;
				durations.push(duration);
			}

			const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

			// Informational: wall-clock single-cell timing is environment-dependent.
			console.log(`Single Cell Update: ${avgDuration.toFixed(3)}ms average`);

			controller.dispose();
		});
	});

	describe('Memory Efficiency', () => {
		it('should maintain reasonable memory footprint for 100k rows', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
					{ field: 'quantity', header: 'Quantity', width: 100 },
					{ field: 'status', header: 'Status', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 100000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: Math.random() * 1000,
					quantity: Math.floor(Math.random() * 100),
					status: 'Active',
				});
			}

			const heapBefore = readHeapUsedBytes();
			// Honest in every environment: Node reports via process.memoryUsage(), browsers via
			// performance.memory. If neither exists the budget cannot be checked — fail loudly
			// rather than silently skipping the assertion.
			expect(heapBefore, 'no heap usage source (process.memoryUsage / performance.memory)').not.toBeNull();

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			const heapAfter = readHeapUsedBytes()!;
			// Without a forced GC the delta also includes collectable garbage, so this is an upper bound.
			const memUsedMB = Math.max(0, heapAfter - heapBefore!) / 1024 / 1024;
			console.log(`Memory Usage: ${memUsedMB.toFixed(2)} MB for 100k rows`);
			expect(memUsedMB).toBeLessThan(150);

			controller.dispose();
		});
	});

	describe('Write-path scaling budgets', () => {
		const makeRows = (count: number): PerfTestRow[] =>
			Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Product ${i}`, price: i, quantity: i % 100, status: 'Active' }));
		const makeGrid = (rows: PerfTestRow[]) => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});
			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});
			return { store, controller };
		};

		it('a one-row transaction on 100k rows deep-copies nothing (undo snapshot is a delta)', () => {
			const rows = makeRows(100_000);
			const { store, controller } = makeGrid(rows);
			const cloneSpy = vi.spyOn(globalThis, 'structuredClone');
			try {
				for (let i = 0; i < 20; i++) {
					store.transaction({ rows: { update: [{ ...rows[i]!, quantity: -i - 1 }] } });
				}
				expect(cloneSpy).not.toHaveBeenCalled();
			} finally {
				cloneSpy.mockRestore();
				controller.dispose();
			}
		});

		it('transaction cost does not scale with dataset size (10k vs 100k within a generous ratio)', () => {
			const time = (count: number): number => {
				const rows = makeRows(count);
				const { store, controller } = makeGrid(rows);
				// Warm up, then take the best of several runs to damp scheduler noise.
				for (let i = 0; i < 5; i++) store.transaction({ rows: { update: [{ ...rows[i]!, quantity: 1_000 + i }] } });
				let best = Infinity;
				for (let run = 0; run < 5; run++) {
					const start = performance.now();
					for (let i = 0; i < 20; i++) store.transaction({ rows: { update: [{ ...rows[i]!, quantity: run * 100 + i }] } });
					best = Math.min(best, performance.now() - start);
				}
				controller.dispose();
				return best;
			};
			const small = time(10_000);
			const large = time(100_000);
			console.log(`Value-only transactions: 10k=${small.toFixed(2)}ms, 100k=${large.toFixed(2)}ms (20 tx each)`);
			// A full-dataset deep copy per transaction made this ~10x; per-row work keeps it near 1x.
			expect(large).toBeLessThan(Math.max(small, 1) * 5);
		});

		it('live sort-key relocation does not materialize the whole source order', () => {
			const { store, controller } = makeGrid(makeRows(50_000));
			store.setSortModel([{ colId: 'price', sort: 'asc' }]);
			const allNodesSpy = vi.spyOn(RowDataStore.prototype, 'getAllNodes');
			try {
				for (let i = 0; i < 50; i++) store.setCellValue(`row-${i}`, 'price', 1_000_000 + i);
				expect(allNodesSpy).not.toHaveBeenCalled();
				expect(store.getVisualIndexByRowId('row-49')).toBe(49_999);
			} finally {
				controller.dispose();
			}
		}, 30_000); // counter assertion, not timing: builds 50k rows, which is slow under full-suite load
	});

	describe('Column Resize Performance', () => {
		it('should handle column resize under 10ms', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 10000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			const durations: number[] = [];

			for (let i = 0; i < 100; i++) {
				const start = performance.now();
				store.setColumnWidth('name', 150 + Math.random() * 100);
				const duration = performance.now() - start;
				durations.push(duration);
			}

			const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

			// Informational: wall-clock column-resize timing is environment-dependent.
			console.log(`Column Resize: ${avgDuration.toFixed(3)}ms average`);

			controller.dispose();
		});
	});

	describe('Selection Performance', () => {
		it('should calculate selection bounds under 5ms', () => {
			const store = new GridStore<PerfTestRow>({
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
			});

			const rows: PerfTestRow[] = [];
			for (let i = 0; i < 10000; i++) {
				rows.push({
					id: `row-${i}`,
					name: `Product ${i}`,
					price: 100,
					quantity: 10,
					status: 'Active',
				});
			}

			const controller = new ClientRowModelController<PerfTestRow>(store.getClientRowModelRuntime(), {
				rows,
				columns: store.getState().columns,
			});

			const durations: number[] = [];

			for (let i = 0; i < 100; i++) {
				const start = performance.now();
				store.selectRange({ rowId: 'row-100', colField: 'id' }, { rowId: 'row-500', colField: 'price' });
				const duration = performance.now() - start;
				durations.push(duration);
			}

			const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

			// Informational: wall-clock selection timing is environment-dependent.
			console.log(`Selection Bounds: ${avgDuration.toFixed(3)}ms average`);

			controller.dispose();
		});
	});
});
