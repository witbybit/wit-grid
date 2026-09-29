import { describe, it, expect, vi } from 'vitest';
import { RowDataStore } from './RowDataStore.js';

function makeStore() {
	return new RowDataStore<{ id: string; name: string }>((row) => row.id);
}

describe('RowDataStore.setRows — row ID validation', () => {
	it('accepts valid unique rows', () => {
		const store = makeStore();
		expect(() =>
			store.setRows([
				{ id: 'a', name: 'Alice' },
				{ id: 'b', name: 'Bob' },
			])
		).not.toThrow();
	});

	it('throws when a row is null', () => {
		const store = makeStore();
		expect(() => store.setRows([null as unknown as { id: string; name: string }])).toThrow('row at index 0 is null or undefined');
	});

	it('throws when a row is undefined', () => {
		const store = makeStore();
		expect(() => store.setRows([undefined as unknown as { id: string; name: string }])).toThrow('row at index 0 is null or undefined');
	});

	it('throws when getRowId returns an empty string', () => {
		const store = new RowDataStore<{ id: string }>((row) => row.id);
		expect(() => store.setRows([{ id: '' }])).toThrow('invalid id for row at index 0');
	});

	it('throws when getRowId returns a non-string', () => {
		const store = new RowDataStore<object>((_row) => null as unknown as string);
		expect(() => store.setRows([{}])).toThrow('invalid id for row at index 0');
	});

	it('throws on duplicate row IDs', () => {
		const store = makeStore();
		expect(() =>
			store.setRows([
				{ id: 'x', name: 'first' },
				{ id: 'x', name: 'duplicate' },
			])
		).toThrow('duplicate row ID');
	});

	it('does not mutate existing state on a bad setRows call', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		expect(() => store.setRows([null as unknown as { id: string; name: string }])).toThrow();
		// State unchanged after the failed call
		expect(store.getAllNodes().length).toBe(1);
		expect(store.getNode('a')?.data.name).toBe('Alice');
	});

	it('updates existing nodes on valid setRows', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		store.setRows([{ id: 'a', name: 'Alice Updated' }]);
		expect(store.getNode('a')?.data.name).toBe('Alice Updated');
	});
});

describe('RowDataStore.updateRows', () => {
	it('returns changed nodes when fields differ', () => {
		const store = makeStore();
		store.setRows([
			{ id: 'a', name: 'Alice' },
			{ id: 'b', name: 'Bob' },
		]);
		const result = store.updateRows((rows) => [{ id: 'a', name: 'Alice 2' }, rows[1]]);
		expect(result.mismatch).toBe(false);
		expect(result.changedNodes).toHaveLength(1);
		expect(result.changedNodes[0].id).toBe('a');
		expect(result.changedFieldsByRow.get('a')?.has('name')).toBe(true);
		expect(store.getNode('a')?.data.name).toBe('Alice 2');
	});

	it('returns mismatch when updater returns a different row count', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => []);
		expect(result.mismatch).toBe(true);
		expect(result.changedNodes).toHaveLength(0);
		// State must not be mutated
		expect(store.getNode('a')?.data.name).toBe('Alice');
	});

	it('returns mismatch when updater changes a row ID', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => [{ id: 'z', name: 'Alice' }]);
		expect(result.mismatch).toBe(true);
	});

	it('returns mismatch when updater returns null at a position', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => [null as unknown as { id: string; name: string }]);
		expect(result.mismatch).toBe(true);
	});

	it('returns empty changedNodes when no fields differ', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows((rows) => [...rows]);
		expect(result.mismatch).toBe(false);
		expect(result.changedNodes).toHaveLength(0);
	});

	it('does not mark a new object changed when all fields are identical', () => {
		const store = makeStore();
		store.setRows([{ id: 'a', name: 'Alice' }]);
		const result = store.updateRows(() => [{ id: 'a', name: 'Alice' }]);
		expect(result.mismatch).toBe(false);
		expect(result.changedNodes).toHaveLength(0);
	});

	it('reports added and removed keys in changed value maps', () => {
		const store = new RowDataStore<{ id: string; name?: string; age?: number; note?: string }>((row) => row.id);
		store.setRows([{ id: 'a', name: 'Alice', age: 30, note: undefined }]);
		const result = store.updateRows(() => [{ id: 'a', name: 'Alice', note: 'new' }]);

		expect(result.changedNodes).toHaveLength(1);
		expect(result.changedFieldsByRow.get('a')).toEqual(new Set(['age', 'note']));
		expect(result.changedValuesByRow.get('a')?.get('age')).toEqual({ oldValue: 30, newValue: undefined });
		expect(result.changedValuesByRow.get('a')?.get('note')).toEqual({ oldValue: undefined, newValue: 'new' });
	});
});

describe('RowDataStore.applyTransaction', () => {
	it('uses the same field diff semantics for update transactions', () => {
		const store = new RowDataStore<{ id: string; name?: string; age?: number; note?: string }>((row) => row.id);
		store.setRows([{ id: 'a', name: 'Alice', age: 30, note: undefined }]);
		const result = store.applyTransaction({ update: [{ id: 'a', name: 'Alice', note: 'new' }] });

		expect(result.updated).toHaveLength(1);
		expect(result.changedFieldsByRow.get('a')).toEqual(new Set(['age', 'note']));
		expect(result.changedValuesByRow.get('a')?.get('age')).toEqual({ oldValue: 30, newValue: undefined });
		expect(result.changedValuesByRow.get('a')?.get('note')).toEqual({ oldValue: undefined, newValue: 'new' });
	});

	it('captures a delta snapshot by reference: restores the pre-write row object without cloning', () => {
		type NestedRow = { id: string; profile: { name: string; stats: { score: number } } };
		const store = new RowDataStore<NestedRow>((row) => row.id);
		const rows: NestedRow[] = [
			{ id: 'a', profile: { name: 'Alice', stats: { score: 1 } } },
			{ id: 'b', profile: { name: 'Bob', stats: { score: 2 } } },
		];
		store.setRows(rows);

		const cloneSpy = vi.spyOn(globalThis, 'structuredClone');
		const update = { id: 'a', profile: { name: 'Alicia', stats: { score: 5 } } };
		const snapshot = store.captureTransactionSnapshot({ update: [update] });
		store.applyTransaction({ update: [update] });
		store.restoreTransactionSnapshot(snapshot);
		expect(cloneSpy).not.toHaveBeenCalled();
		cloneSpy.mockRestore();

		// Immutable replacement means the captured reference *is* the old value.
		expect(store.getNode('a')!.data).toBe(rows[0]);
		expect(store.getNode('b')!.data).toBe(rows[1]);
		// Untouched rows are not part of the snapshot at all.
		expect([...snapshot.entries.keys()]).toEqual(['a']);
		expect(snapshot.sourceOrder).toBeNull();
	});

	it('snapshots rows that hold functions or class instances (structuredClone would throw)', () => {
		class Money {
			constructor(readonly cents: number) {}
		}
		type FnRow = { id: string; onClick: () => void; price: Money };
		const store = new RowDataStore<FnRow>((row) => row.id);
		const original: FnRow = { id: 'a', onClick: () => {}, price: new Money(100) };
		store.setRows([original]);

		const update: FnRow = { id: 'a', onClick: () => {}, price: new Money(200) };
		const snapshot = store.captureTransactionSnapshot({ update: [update] });
		store.applyTransaction({ update: [update] });
		expect(store.getNode('a')!.data.price.cents).toBe(200);
		store.restoreTransactionSnapshot(snapshot);
		expect(store.getNode('a')!.data).toBe(original);
		expect(store.getNode('a')!.data.price).toBeInstanceOf(Money);
	});

	it('keeps getSourceIndex in sync across appends, inserts, removals, reorders and restores', () => {
		type Row = { id: string };
		const store = new RowDataStore<Row>((row) => row.id);
		store.setRows([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
		const expectIndexes = () => {
			store.getSourceOrder().forEach((id, index) => expect(store.getSourceIndex(id)).toBe(index));
		};
		expectIndexes();
		store.applyTransaction({ add: [{ id: 'd' }] });
		expectIndexes();
		store.applyTransaction({ add: [{ id: 'e' }], addIndex: 1 });
		expectIndexes();
		const snapshot = store.captureTransactionSnapshot({ remove: [{ id: 'a' }] });
		store.applyTransaction({ remove: [{ id: 'a' }] });
		expect(store.getSourceIndex('a')).toBeUndefined();
		expectIndexes();
		store.restoreTransactionSnapshot(snapshot);
		expect(store.getSourceOrder()).toEqual(['a', 'e', 'b', 'c', 'd']);
		expectIndexes();
		store.setRowOrder(['d', 'c', 'b', 'e', 'a']);
		expectIndexes();
		store.applyTransaction({ add: [{ id: 'f' }], addIndex: -1 });
		expect(store.getSourceOrder()).toEqual(['d', 'c', 'b', 'e', 'f', 'a']);
		expectIndexes();
	});

	it('restores original row node identities, deep data, added/removal state, and source order', () => {
		type NestedRow = { id: string; category: string; profile: { name: string; stats: { score: number } } };
		const store = new RowDataStore<NestedRow>((row) => row.id);
		store.setRows([
			{ id: 'a', category: 'A', profile: { name: 'Alice', stats: { score: 1 } } },
			{ id: 'b', category: 'B', profile: { name: 'Bob', stats: { score: 2 } } },
		]);

		const originalNodeA = store.getNode('a');
		const originalNodeB = store.getNode('b');
		const snapshot = store.captureTransactionSnapshot();

		store.applyTransaction({
			remove: [{ id: 'a', category: 'A', profile: { name: 'Alice', stats: { score: 1 } } }],
			update: [{ id: 'b', category: 'C', profile: { name: 'Bobby', stats: { score: 20 } } }],
			add: [{ id: 'c', category: 'D', profile: { name: 'Cara', stats: { score: 3 } } }],
			addIndex: 0,
		});

		expect(store.getNode('a')).toBeNull();
		expect(store.getNode('c')).not.toBeNull();
		expect(store.getSourceOrder()).toEqual(['c', 'b']);

		store.restoreTransactionSnapshot(snapshot);

		expect(store.getNode('a')).toBe(originalNodeA);
		expect(store.getNode('b')).toBe(originalNodeB);
		expect(store.getNode('c')).toBeNull();
		expect(store.getSourceOrder()).toEqual(['a', 'b']);
		expect(store.getNode('a')!.data.profile.name).toBe('Alice');
		expect(store.getNode('a')!.data.profile.stats.score).toBe(1);
		expect(store.getNode('b')!.data.category).toBe('B');
		expect(store.getNode('b')!.data.profile.name).toBe('Bob');
		expect(store.getNode('b')!.data.profile.stats.score).toBe(2);
	});
});
