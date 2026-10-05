/**
 * Adversarial tests for InfiniteRowModelController generation handling.
 *
 * Invariant: out-of-order or stale async server responses must never overwrite
 * a newer generation after purge-triggering actions such as sort/filter/datasource
 * changes.
 *
 * All sequences are generated with a seeded deterministic LCG. Each seed
 * produces a reproducible request/resolve/reject trace.
 */
import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { type InfiniteGetRowsParams, type InfiniteDatasource, InfiniteRowModelController } from './infiniteRowModel.js';

interface TestRow {
	id: string;
	name: string;
}

interface PendingRequest {
	source: string;
	token: string;
	params: InfiniteGetRowsParams;
	resolve: (value: { rows: TestRow[]; totalCount: number }) => void;
	reject: (error: Error) => void;
}

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

function flushAsync(): Promise<void> {
	return Promise.resolve()
		.then(() => undefined)
		.then(() => undefined);
}

function createDeferredDatasource(source: string, getToken: () => string, pending: PendingRequest[]): InfiniteDatasource<TestRow> {
	return {
		getRows: vi.fn().mockImplementation((params: InfiniteGetRowsParams) => {
			return new Promise<{ rows: TestRow[]; totalCount: number }>((resolve, reject) => {
				pending.push({
					source,
					token: getToken(),
					params,
					resolve,
					reject,
				});
			});
		}),
	};
}

function loadedNames(controller: InfiniteRowModelController<TestRow>): string[] {
	const names: string[] = [];
	for (let i = 0; i < controller.getVisualRowCount(); i++) {
		const row = controller.getVisualRow(i);
		if (row?.kind === 'data') {
			names.push(row.node.data.name);
		}
	}
	return names;
}

describe('InfiniteRowModelController — adversarial generation invariants', () => {
	it('stale responses and stale failures are ignored after sort/filter/datasource churn', async () => {
		const rng = makeLcg(0x5eed1234);
		const pending: PendingRequest[] = [];
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		let source = 'A';
		let sequence = 0;
		let currentToken = `${source}|seq=${sequence}|init`;
		const getToken = () => currentToken;
		const datasourceA = createDeferredDatasource('A', getToken, pending);
		const datasourceB = createDeferredDatasource('B', getToken, pending);
		let activeDatasource = datasourceA;

		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			datasource: activeDatasource,
			blockSize: 4,
			columns: store.getState().columns,
		});

		function bump(reason: string): void {
			sequence++;
			currentToken = `${source}|seq=${sequence}|${reason}`;
		}

		async function resolveRequest(request: PendingRequest): Promise<void> {
			const start = request.params.startRow;
			request.resolve({
				rows: Array.from({ length: 4 }, (_, index) => ({
					id: `${request.token}:${start + index}`,
					name: request.token,
				})),
				totalCount: 18,
			});
			await flushAsync();
		}

		async function rejectRequest(request: PendingRequest): Promise<void> {
			request.reject(new Error(`reject:${request.token}`));
			await flushAsync();
		}

		const initialRequest = pending.shift();
		expect(initialRequest?.token).toBe(currentToken);
		await resolveRequest(initialRequest!);

		for (let step = 0; step < 40; step++) {
			const op = lcgInt(rng, 6);
			const label = `seed=0x5eed1234,step=${step},op=${op}`;

			if (op === 0) {
				bump('sort');
				// Re-applying the current sort is a no-op (no new generation), so churn always picks a different one.
				const sortFor = (mode: number) => (mode === 0 ? null : [{ colId: 'name', sort: mode === 1 ? ('asc' as const) : ('desc' as const) }]);
				let sortMode = sequence % 3;
				if (JSON.stringify(sortFor(sortMode)) === JSON.stringify(store.getState().sortModel ?? null)) sortMode = (sortMode + 1) % 3;
				store.setSortModel(sortFor(sortMode));
				expect(store.getState().loading, `[${label}] new generation should enter loading`).toBe(true);
				continue;
			}

			if (op === 1) {
				bump('filter');
				// As for sort: the same filter again is a no-op, so churn always picks a different one.
				const filters = [null, { name: { type: 'text', operator: 'contains', value: 'B' } }, { name: { type: 'text', operator: 'contains', value: 'A' } }] as const;
				let pick = sequence % 2 === 0 ? 0 : sequence % 4 === 0 ? 2 : 1;
				const current = JSON.stringify(store.getState().filterModel ?? null);
				if (JSON.stringify(filters[pick]) === current) pick = (pick + 1) % filters.length;
				store.setFilterModel(filters[pick] as never);
				expect(store.getState().loading, `[${label}] filter purge should enter loading`).toBe(true);
				continue;
			}

			if (op === 2) {
				bump('query');
				store.setQueryModel({
					id: `query-${sequence}`,
					root: {
						kind: 'group',
						operator: 'and',
						children: [
							{
								kind: 'condition',
								field: 'name',
								operator: 'contains',
								value: sequence % 2 === 0 ? 'A' : 'B',
							},
						],
					},
				});
				expect(store.getState().loading, `[${label}] query purge should enter loading`).toBe(true);
				continue;
			}

			if (op === 3) {
				source = source === 'A' ? 'B' : 'A';
				activeDatasource = source === 'A' ? datasourceA : datasourceB;
				bump('datasource');
				controller.setDatasource(activeDatasource);
				expect(store.getState().loading, `[${label}] datasource switch should enter loading`).toBe(true);
				continue;
			}

			if (pending.length === 0) {
				continue;
			}

			const request = pending.splice(lcgInt(rng, pending.length), 1)[0];
			const faultsBefore = store.getRuntimeFaults().length;
			const isCurrent = request.token === currentToken;

			if (op === 4) {
				await resolveRequest(request);
				const names = loadedNames(controller);

				if (isCurrent) {
					expect(names.length, `[${label}] current response should populate rows`).toBeGreaterThan(0);
					expect(new Set(names), `[${label}] only current generation rows may be visible`).toEqual(new Set([request.token]));
					expect(store.getState().loading, `[${label}] settled current response should clear loading`).toBe(false);
				} else {
					expect(names, `[${label}] stale response must not become visible`).not.toContain(request.token);
					expect(store.getRuntimeFaults().length, `[${label}] stale success must not report faults`).toBe(faultsBefore);
				}
				continue;
			}

			await rejectRequest(request);
			const names = loadedNames(controller);

			if (isCurrent) {
				expect(names, `[${label}] current rejection must not leave stale rows behind`).not.toContain(request.token);
				expect(store.getRuntimeFaults().length, `[${label}] current rejection should report exactly one fault`).toBe(faultsBefore + 1);
			} else {
				expect(names, `[${label}] stale rejection must not mutate visible rows`).not.toContain(request.token);
				expect(store.getRuntimeFaults().length, `[${label}] stale rejection must not report faults`).toBe(faultsBefore);
			}
		}

		bump('final-sort');
		const finalSort = store.getState().sortModel?.[0]?.sort === 'asc' ? 'desc' : 'asc';
		store.setSortModel([{ colId: 'name', sort: finalSort }]);
		const finalRequest = pending.splice(
			pending.findIndex((request) => request.token === currentToken),
			1
		)[0];
		expect(finalRequest?.token).toBe(currentToken);
		await resolveRequest(finalRequest);

		const finalNames = loadedNames(controller);
		expect(finalNames.length).toBeGreaterThan(0);
		expect(new Set(finalNames)).toEqual(new Set([currentToken]));

		controller.dispose();
		store.destroy();
	});
});
