import { describe, expect, it } from 'vitest';

import { InvalidationManager } from './invalidationManager.js';

describe('InvalidationManager', () => {
	it('coalesces repeated invalidations into one frame', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateRow('row-1', 'focus');
		manager.invalidateHeaders('sort');

		const frame = manager.consume();

		expect(frame.full).toBe(false);
		expect(frame.cellsByRowId.size).toBe(1);
		expect(frame.cellsByRowId.get('row-1')).toEqual(new Set(['name']));
		expect(frame.rows.size).toBe(1);
		expect(frame.headers).toBe(true);
		expect(frame.reasons).toEqual(['edit', 'focus', 'sort']);
		expect(frame.invalidations).toEqual([
			{ kind: 'cell', rowId: 'row-1', colId: 'name', reason: 'edit' },
			{ kind: 'row', rowId: 'row-1', reason: 'focus' },
			{ kind: 'headers', reason: 'sort' },
		]);

		const next = manager.consume();
		expect(next.cellsByRowId.size).toBe(0);
		expect(next.rows.size).toBe(0);
		expect(next.headers).toBe(false);
		expect(next.invalidations).toEqual([]);
	});

	it('keeps row ids with colons structurally separate from column ids', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row:0', 'name', 'edit');
		manager.invalidateCell('custom:id:abc', 'status', 'edit');
		manager.invalidateCell('group:status:Active', 'name', 'edit');
		manager.invalidateCell('row:0', 'status', 'edit');
		manager.invalidateCell('row:0', 'status', 'edit');

		const frame = manager.consume();

		expect(frame.cellsByRowId.get('row:0')).toEqual(new Set(['name', 'status']));
		expect(frame.cellsByRowId.get('custom:id:abc')).toEqual(new Set(['status']));
		expect(frame.cellsByRowId.get('group:status:Active')).toEqual(new Set(['name']));
		expect(frame.reasons).toEqual(['edit']);
	});

	it('preserves column instance identity when invalidating GridCellPointer arrays', () => {
		const manager = new InvalidationManager();

		manager.invalidateCells(
			[
				{ rowId: 'row-1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' as any },
				{ rowId: 'row-1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' as any },
			],
			'selection'
		);

		const frame = manager.consume();

		expect(frame.cellsByRowId.get('row-1')).toEqual(new Set(['name-a', 'name-b']));
		expect(frame.invalidations).toEqual([
			{ kind: 'cell', rowId: 'row-1', colId: 'name-a', reason: 'selection' },
			{ kind: 'cell', rowId: 'row-1', colId: 'name-b', reason: 'selection' },
		]);
	});

	it('tracks group and row range invalidations as first-class lanes', () => {
		const manager = new InvalidationManager();

		manager.invalidateGroup('group:region:Americas', 'groupBy');
		manager.invalidateGroup('group:region:Americas', 'groupBy');
		manager.invalidateRowRange(12, 4, 'viewport');
		manager.invalidateRowRange(4, 12, 'viewport');
		manager.invalidateColumn('revenue', 'aggregation');

		const frame = manager.consume();

		expect(frame.groups).toEqual(new Set(['group:region:Americas']));
		expect(frame.rowRanges).toEqual([{ startIndex: 4, endIndex: 12, reason: 'viewport' }]);
		expect(frame.columns).toEqual(new Set(['revenue']));
		expect(frame.invalidations).toEqual([
			{ kind: 'group', groupId: 'group:region:Americas', reason: 'groupBy' },
			{ kind: 'row-range', startIndex: 4, endIndex: 12, reason: 'viewport' },
			{ kind: 'column', colId: 'revenue', reason: 'aggregation' },
		]);
	});

	it('lets full invalidation override granular paint work', () => {
		const manager = new InvalidationManager();

		manager.invalidateCell('row-1', 'name', 'edit');
		manager.invalidateGeometry('resize');
		manager.invalidateFull('columns');

		const frame = manager.consume();

		expect(frame.full).toBe(true);
		expect(frame.cellsByRowId.size).toBe(0);
		expect(frame.geometry).toBe(false);
		expect(frame.reasons).toEqual(['edit', 'resize', 'columns']);
		expect(frame.invalidations).toEqual([
			{ kind: 'cell', rowId: 'row-1', colId: 'name', reason: 'edit' },
			{ kind: 'geometry', reason: 'resize' },
			{ kind: 'full', reason: 'columns' },
		]);
	});
});
