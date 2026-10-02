import { describe, expect, it, vi } from 'vitest';
import { AsyncTransactionQueue } from './AsyncTransactionQueue.js';
import type { RowDataTransaction } from '../api/GridApi.js';
import type { RowNodeTransaction } from '../rowTransactions.js';
import type { GridEngineTransaction } from './GridEngine.js';
import type { GridTransactionResult } from '../api/GridApi.js';

type Row = { id: string; v: number };

/** A tiny ordered store with transaction semantics, to compare queued vs sequential results. */
function makeStore(initial: Row[]) {
	let rows = initial.slice();
	const applied: RowDataTransaction<Row>[] = [];
	const apply = (engineTx: GridEngineTransaction<Row>): GridTransactionResult<Row> => {
		const tx = engineTx.rows ?? {};
		applied.push(tx);
		const node = (row: Row) => ({ id: row.id, data: row }) as unknown as RowNodeTransaction<Row>['add'][number];
		const removedIds = new Set((tx.remove ?? []).map((r) => r.id));
		const removed = rows.filter((r) => removedIds.has(r.id));
		rows = rows.filter((r) => !removedIds.has(r.id));
		const updated: Row[] = [];
		for (const u of tx.update ?? []) {
			const i = rows.findIndex((r) => r.id === u.id);
			if (i >= 0) {
				rows[i] = u;
				updated.push(u);
			}
		}
		const adds = tx.add ?? [];
		if (tx.addIndex !== undefined) rows.splice(tx.addIndex, 0, ...adds);
		else rows.push(...adds);
		return {
			status: 'applied',
			rows: { add: adds.map(node), update: updated.map(node), remove: removed.map(node) } as RowNodeTransaction<Row>,
			cells: { committed: [], rejected: [] },
		} as unknown as GridTransactionResult<Row>;
	};
	return {
		apply,
		get rows() {
			return rows;
		},
		applied,
	};
}

function makeQueue(store: ReturnType<typeof makeStore>) {
	let scheduled: (() => void) | null = null;
	const queue = new AsyncTransactionQueue<Row>({
		apply: store.apply,
		getRowId: (r) => r.id,
		schedule: (flush) => {
			scheduled = flush;
			return () => {
				scheduled = null;
			};
		},
	});
	return { queue, runScheduled: () => scheduled?.() };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: i }));

describe('AsyncTransactionQueue', () => {
	it('combines independent transactions into one applied transaction', () => {
		const store = makeStore(rows(5));
		const { queue, runScheduled } = makeQueue(store);
		for (let i = 0; i < 5; i++) queue.enqueue({ rows: { update: [{ id: `r${i}`, v: 100 + i }] } });
		expect(store.applied).toHaveLength(0);
		runScheduled();
		expect(store.applied).toHaveLength(1);
		expect(store.rows.map((r) => r.v)).toEqual([100, 101, 102, 103, 104]);
	});

	it('gives exactly the sequential result for dependent transactions (same row, add then update, addIndex)', () => {
		const txs: RowDataTransaction<Row>[] = [
			{ update: [{ id: 'r1', v: 10 }] },
			{ update: [{ id: 'r1', v: 11 }] }, // same row again
			{ add: [{ id: 'n1', v: 1 }] },
			{ update: [{ id: 'n1', v: 2 }] }, // updates a row added above
			{ add: [{ id: 'n2', v: 3 }], addIndex: 0 }, // positional
			{ remove: [{ id: 'r0', v: 0 }], add: [{ id: 'n3', v: 4 }] },
			{ remove: [{ id: 'n1', v: 2 }] },
			{ add: [{ id: 'n1', v: 9 }] }, // re-added after removal
		];
		const sequential = makeStore(rows(4));
		for (const tx of txs) sequential.apply({ rows: tx });

		const queued = makeStore(rows(4));
		const { queue } = makeQueue(queued);
		for (const tx of txs) queue.enqueue({ rows: tx });
		queue.flush();

		expect(queued.rows).toEqual(sequential.rows);
		expect(queued.applied.length).toBeLessThan(txs.length); // some were combined
	});

	it('hands each callback its own part of a combined result', () => {
		const store = makeStore(rows(3));
		const { queue } = makeQueue(store);
		const a = vi.fn();
		const b = vi.fn();
		queue.enqueue({ rows: { update: [{ id: 'r0', v: 7 }] } }, a);
		queue.enqueue({ rows: { add: [{ id: 'x', v: 8 }], remove: [{ id: 'r2', v: 2 }] } }, b);
		queue.flush();
		expect(a.mock.calls[0][0].rows.update.map((n: { id: string }) => n.id)).toEqual(['r0']);
		expect(a.mock.calls[0][0].rows.add).toEqual([]);
		expect(b.mock.calls[0][0].rows.add.map((n: { id: string }) => n.id)).toEqual(['x']);
		expect(b.mock.calls[0][0].rows.remove.map((n: { id: string }) => n.id)).toEqual(['r2']);
	});

	it('schedules one flush for many enqueues, and a manual flush cancels it', () => {
		const store = makeStore(rows(2));
		const schedule = vi.fn(() => () => {});
		const queue = new AsyncTransactionQueue<Row>({ apply: store.apply, getRowId: (r) => r.id, schedule });
		queue.enqueue({ rows: { update: [{ id: 'r0', v: 1 }] } });
		queue.enqueue({ rows: { update: [{ id: 'r1', v: 1 }] } });
		expect(schedule).toHaveBeenCalledTimes(1);
		queue.flush();
		expect(queue.pendingCount).toBe(0);
	});

	it('applies a transaction with cell writes on its own, in order, between merged row transactions', () => {
		const store = makeStore(rows(4));
		const { queue } = makeQueue(store);
		queue.enqueue({ rows: { update: [{ id: 'r0', v: 10 }] } });
		queue.enqueue({ rows: { update: [{ id: 'r1', v: 11 }] } });
		queue.enqueue({ cells: [{ rowId: 'r2', colField: 'v', value: 12 }] });
		queue.enqueue({ rows: { update: [{ id: 'r3', v: 13 }] } });
		queue.flush();
		// r0+r1 merged, the cell transaction alone (no row part), then r3.
		expect(store.applied).toHaveLength(3);
		expect(store.rows.map((r) => r.v)).toEqual([10, 11, 2, 13]);
	});

	it('drops pending transactions on destroy without calling back', () => {
		const store = makeStore(rows(2));
		const { queue } = makeQueue(store);
		const cb = vi.fn();
		queue.enqueue({ rows: { update: [{ id: 'r0', v: 1 }] } }, cb);
		queue.destroy();
		queue.flush();
		expect(store.applied).toHaveLength(0);
		expect(cb).not.toHaveBeenCalled();
	});
});

describe('AsyncTransactionQueue – randomized equivalence with sequential application', () => {
	it('matches applying each transaction one by one, for random mixes of add / update / remove / addIndex', () => {
		let seed = 0x5eed;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		for (let trial = 0; trial < 300; trial++) {
			const start = rows(6);
			const live = new Set(start.map((r) => r.id));
			let next = 0;
			const txs: RowDataTransaction<Row>[] = [];
			for (let t = 0; t < 12; t++) {
				const tx: RowDataTransaction<Row> = {};
				const ids = [...live];
				const pickLive = () => ids[Math.floor(rand() * ids.length)];
				const roll = rand();
				if (roll < 0.35 && ids.length) {
					const id = pickLive();
					tx.update = [{ id, v: Math.floor(rand() * 1000) }];
				} else if (roll < 0.6) {
					const id = `n${next++}`;
					tx.add = [{ id, v: t }];
					if (rand() < 0.3) tx.addIndex = Math.floor(rand() * (live.size + 1));
					live.add(id);
				} else if (roll < 0.85 && ids.length) {
					const id = pickLive();
					tx.remove = [{ id, v: 0 }];
					live.delete(id);
				} else if (ids.length) {
					const id = pickLive();
					tx.remove = [{ id, v: 0 }];
					live.delete(id);
					const added = `n${next++}`;
					tx.add = [{ id: added, v: t }];
					live.add(added);
				}
				txs.push(tx);
			}
			const sequential = makeStore(start);
			for (const tx of txs) sequential.apply({ rows: tx });
			const queued = makeStore(start);
			const { queue } = makeQueue(queued);
			for (const tx of txs) queue.enqueue({ rows: tx });
			queue.flush();
			expect(queued.rows, `trial ${trial}`).toEqual(sequential.rows);
		}
	});
});
