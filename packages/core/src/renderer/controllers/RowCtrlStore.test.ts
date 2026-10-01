import { describe, expect, it } from 'vitest';
import { RowCtrlStore } from './RowCtrlStore.js';
import { getOrCreateCellCtrl } from './RowCtrl.js';

describe('RowCtrlStore', () => {
	it('creates a fresh RowCtrl for a new rowId', () => {
		const store = new RowCtrlStore();
		const ctrl = store.getOrCreate('r1');
		expect(ctrl.rowId).toBe('r1');
		expect(ctrl.cellKeysByColumnInstanceId.size).toBe(0);
		expect(store.stats.created).toBe(1);
	});

	it('reuses the same RowCtrl object across repeated getOrCreate calls for the same rowId', () => {
		const store = new RowCtrlStore();
		const first = store.getOrCreate('r1');
		const second = store.getOrCreate('r1');
		expect(second).toBe(first);
		expect(store.stats.created).toBe(1);
		expect(store.stats.reused).toBe(1);
	});

	it('row rebind: deleting a rowId does not affect a differently-keyed RowCtrl, and re-creating after delete never resurrects identity', () => {
		const store = new RowCtrlStore();
		const original = store.getOrCreate('r1');
		original.rowVersion = 5;

		store.delete('r1');
		expect(store.get('r1')).toBeUndefined();

		const recreated = store.getOrCreate('r1');
		expect(recreated).not.toBe(original);
		expect(recreated.rowVersion).toBe(-1); // fresh controller, no memory of the deleted one
		expect(store.stats.evicted).toBe(1);
	});

	it('sweep removes every RowCtrl not in the live set', () => {
		const store = new RowCtrlStore();
		store.getOrCreate('r1');
		store.getOrCreate('r2');
		store.getOrCreate('r3');

		const evicted = store.sweep(new Set(['r2']));
		expect(evicted).toBe(2);
		expect(store.get('r1')).toBeUndefined();
		expect(store.get('r2')).toBeDefined();
		expect(store.get('r3')).toBeUndefined();
	});

	it('virtualized-out rows survive: a RowCtrl is not deleted just because attachedSlotId is cleared', () => {
		const store = new RowCtrlStore();
		const ctrl = store.getOrCreate('r1');
		ctrl.attachedSlotId = 'rsp-0';
		ctrl.attachedSlotId = undefined;
		expect(store.get('r1')).toBe(ctrl);
	});
});

describe('getOrCreateCellCtrl', () => {
	it('creates a CellCtrl keyed by columnInstanceId within the row', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const { cellCtrl, created } = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli1' as any, { colField: 'price' });
		expect(created).toBe(true);
		expect(cellCtrl.rowId).toBe('r1');
		expect(cellCtrl.field).toBe('price');
		expect(cellCtrl.columnInstanceId).toBe('coli1');
		expect(rowCtrl.cellKeysByColumnInstanceId.get('coli1' as any)).toBe(cellCtrl.key);
	});

	it('reuses the same CellCtrl object across frames for the same (rowId, columnInstanceId)', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const first = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli1' as any, { colField: 'price' });
		const second = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli1' as any, { colField: 'price' });
		expect(second.cellCtrl).toBe(first.cellCtrl);
		expect(second.created).toBe(false);
	});

	it('same field, different columnInstanceId mints a fresh CellCtrl, does not reuse the stale one', () => {
		const store = new RowCtrlStore();
		const rowCtrl = store.getOrCreate('r1');
		const before = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli1' as any, { colField: 'price' });
		before.cellCtrl.visualState.editing = true;

		const after = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, 'coli2' as any, { colField: 'price' });
		expect(after.created).toBe(true);
		expect(after.cellCtrl).not.toBe(before.cellCtrl);
		expect(after.cellCtrl.visualState.editing).toBe(false);
		expect(after.cellCtrl.columnInstanceId).toBe('coli2');
		expect(rowCtrl.cellKeysByColumnInstanceId.get('coli1' as any)).toBe(before.cellCtrl.key);
		expect(rowCtrl.cellKeysByColumnInstanceId.get('coli2' as any)).toBe(after.cellCtrl.key);
	});

	it('row rebind: CellCtrls for the old row are not visible from the new RowCtrl at the same field', () => {
		const store = new RowCtrlStore();
		const rowA = store.getOrCreate('rowA');
		getOrCreateCellCtrl(rowA, store.cellCtrls, 'coli1' as any, { colField: 'price' }).cellCtrl.visualState.editing = true;

		// A different logical row may reuse the same physical slot conceptually, but CellCtrlStore keys
		// by rowId and columnInstanceId, not slot.
		const rowB = store.getOrCreate('rowB');
		const { cellCtrl, created } = getOrCreateCellCtrl(rowB, store.cellCtrls, 'coli1' as any, { colField: 'price' });
		expect(created).toBe(true);
		expect(cellCtrl.visualState.editing).toBe(false);
	});
});
