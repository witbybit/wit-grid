import { describe, expect, it } from 'vitest';
import { CellDisplaySnapshotStore, createCellDisplaySnapshot } from './cellDisplaySnapshot.js';

const snap = (rowId: string, col: string, text = `${rowId}/${col}`) =>
	createCellDisplaySnapshot({
		rowId,
		colField: col,
		rowVersion: 1,
		globalVersion: 1,
		insightVersion: 0,
		styleVersion: 0,
		loadingVersion: 0,
		selectionVersion: 0,
		baseClassName: 'og-cell',
		contentKind: 'text',
		contentMode: 'text',
		formattedValue: text,
		title: '',
	});

describe('CellDisplaySnapshotStore', () => {
	it('reads what was set, replaced, deleted and cleared', () => {
		const store = new CellDisplaySnapshotStore(10);
		store.set(snap('r1', 'a'));
		store.set(snap('r1', 'a', 'again'));
		store.set(snap('r1', 'b'));
		expect(store.get('r1', 'a')?.formattedValue).toBe('again');
		expect(store.get('r1', 'b')?.formattedValue).toBe('r1/b');
		expect(store.get('r2', 'a')).toBeUndefined();
		store.delete('r1', 'a');
		expect(store.get('r1', 'a')).toBeUndefined();
		expect(store.get('r1', 'b')).toBeDefined();
		store.clear();
		expect(store.get('r1', 'b')).toBeUndefined();
	});

	it('evicts the least recently written entries from reads too', () => {
		const store = new CellDisplaySnapshotStore(2);
		store.set(snap('r1', 'a'));
		store.set(snap('r2', 'a'));
		store.set(snap('r1', 'a', 'refreshed')); // most recent again
		store.set(snap('r3', 'a')); // evicts r2/a
		expect(store.get('r2', 'a')).toBeUndefined();
		expect(store.get('r1', 'a')?.formattedValue).toBe('refreshed');
		expect(store.get('r3', 'a')).toBeDefined();
		expect(store.getOwnershipSnapshot()).toMatchObject({ entryCount: 2, evictedSnapshotCount: 1 });
	});
});
