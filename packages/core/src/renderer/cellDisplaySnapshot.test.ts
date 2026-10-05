import { describe, expect, it } from 'vitest';
import { CellDisplaySnapshotStore, createCellDisplaySnapshot, joinCellSnapshotClassNameParts } from './cellDisplaySnapshot.js';

describe('CellDisplaySnapshotStore', () => {
	function makeSnapshot(rowId: string, colField: string, formattedValue = rowId) {
		return createCellDisplaySnapshot({
			rowId,
			colField,
			rowVersion: 0,
			globalVersion: 0,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
			baseClassName: 'og-cell',
			contentKind: 'text',
			contentMode: 'text',
			formattedValue,
			title: '',
		});
	}

	it('stores snapshots by logical cell identity', () => {
		const store = new CellDisplaySnapshotStore();
		store.set(
			createCellDisplaySnapshot({
				rowId: 'r1',
				colField: 'name',
				rowVersion: 2,
				globalVersion: 5,
				insightVersion: 1,
				styleVersion: 0,
				loadingVersion: 0,
				selectionVersion: 0,
				baseClassName: 'og-cell',
				stateClassName: 'highlight',
				decorationClassName: 'og-cell-validation-error',
				contentKind: 'text',
				contentMode: 'text',
				formattedValue: 'Alice',
				title: 'User name',
				validationError: 'Required',
			})
		);

		expect(store.get('r1', 'name')).toMatchObject({
			formattedValue: 'Alice',
			className: 'og-cell highlight og-cell-validation-error',
			baseClassName: 'og-cell',
			decorationClassName: 'og-cell-validation-error',
			validationError: 'Required',
		});
	});

	it('replaces existing snapshots for the same logical cell', () => {
		const store = new CellDisplaySnapshotStore();
		store.set(
			createCellDisplaySnapshot({
				rowId: 'r1',
				colField: 'name',
				rowVersion: 1,
				globalVersion: 1,
				insightVersion: 0,
				styleVersion: 0,
				loadingVersion: 0,
				selectionVersion: 0,
				baseClassName: 'og-cell',
				contentKind: 'text',
				contentMode: 'text',
				formattedValue: 'Alice',
				title: '',
			})
		);
		store.set(
			createCellDisplaySnapshot({
				rowId: 'r1',
				colField: 'name',
				rowVersion: 2,
				globalVersion: 3,
				insightVersion: 0,
				styleVersion: 0,
				loadingVersion: 0,
				selectionVersion: 0,
				baseClassName: 'og-cell',
				stateClassName: 'fresh',
				contentKind: 'text',
				contentMode: 'text',
				formattedValue: 'Alicia',
				title: 'Updated',
			})
		);

		expect(store.get('r1', 'name')).toMatchObject({
			rowVersion: 2,
			globalVersion: 3,
			formattedValue: 'Alicia',
			className: 'og-cell fresh',
		});
	});

	it('bounds the directional-prewarm working set without making reads mutate ownership', () => {
		const store = new CellDisplaySnapshotStore(2);
		store.set(makeSnapshot('r1', 'name'));
		store.set(makeSnapshot('r2', 'name'));
		expect(store.get('r1', 'name')).toBeDefined();
		store.set(makeSnapshot('r3', 'name'));

		expect(store.get('r1', 'name')).toBeUndefined();
		expect(store.get('r2', 'name')).toBeDefined();
		expect(store.get('r3', 'name')).toBeDefined();
		expect(store.getOwnershipSnapshot()).toEqual({ entryCount: 2, maxEntries: 2, evictedSnapshotCount: 1 });
	});

	it('canonicalizes class segments into a stable snapshot payload', () => {
		const snapshot = createCellDisplaySnapshot({
			rowId: 'r1',
			colField: 'status',
			rowVersion: 7,
			globalVersion: 9,
			insightVersion: 4,
			styleVersion: 2,
			loadingVersion: 1,
			selectionVersion: 6,
			baseClassName: 'og-cell  og-cell-pinned-left',
			stateClassName: ' og-cell-selected og-cell-readonly ',
			decorationClassName: 'og-cell-validation-error og-cell-selected',
			contentKind: 'portal-live',
			contentMode: 'portal',
			formattedValue: '',
			title: 'Frozen',
		});

		expect(snapshot.className).toBe('og-cell og-cell-pinned-left og-cell-selected og-cell-readonly og-cell-validation-error');
		expect(snapshot.classTokens).toEqual(['og-cell', 'og-cell-pinned-left', 'og-cell-selected', 'og-cell-readonly', 'og-cell-validation-error']);
		expect(snapshot.contentKind).toBe('portal-live');
	});

	it('joins class-name parts without duplicating tokens', () => {
		expect(joinCellSnapshotClassNameParts('og-cell og-cell-selected', 'og-cell-selected warm', 'warm decorated')).toEqual({
			className: 'og-cell og-cell-selected warm decorated',
			classTokens: ['og-cell', 'og-cell-selected', 'warm', 'decorated'],
		});
	});
});
