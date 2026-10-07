// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RowSlot } from './rowSlot.js';
import { CellSlot } from './cellSlot.js';

describe('RowSlot & CellSlot Controllers', () => {
	it('should prevent redundant DOM writes on CellSlot if values match', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		// First update should write to DOM (left=0, right=-1, width=100)
		const updated1 = cell.update(0, 'col1', 5, 'row-5', 0, -1, 100, 'og-cell my-class', 'text', 'hello', 'hello');
		expect(updated1).toBe(true);
		expect(div.style.left).toBe('0px');
		expect(div.style.width).toBe('100px');
		expect(div.className).toBe('og-cell my-class');
		expect(div.querySelector('.og-cell-content')?.textContent).toBe('hello');

		// Second update with identical values should NOT write to DOM
		const updated2 = cell.update(0, 'col1', 5, 'row-5', 0, -1, 100, 'og-cell my-class', 'text', 'hello', 'hello');
		expect(updated2).toBe(false);
	});

	it('commitBinding() records all identity fields and unbindHot() clears them', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		expect(cell.binding).toBeNull();

		cell.update(3, 'price', 42, 'row-42', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'slot-1::price');
		cell.commitBinding('slot-1', 'row-42', 42, 'price', 3, 'slot-1::price', 'portal');
		expect(cell.binding).toEqual({
			rowSlotId: 'slot-1',
			rowId: 'row-42',
			rowIndex: 42,
			colId: 'price',
			colIndex: 3,
			cellKey: 'slot-1::price',
			contentMode: 'portal',
		});

		cell.unbindHot();
		expect(cell.binding).toBeNull();
	});

	it('commitBinding() reuses its identity record across physical rebinds', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);

		cell.update(0, 'name', 0, 'row-1', 0, -1, 100, 'og-cell', 'text', 'one', 'one');
		cell.commitBinding('slot-1', 'row-1', 0, 'name', 0, 'slot-1::name', 'text');
		const firstBindingRecord = cell.binding;
		cell.update(0, 'name', 1, 'row-2', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'slot-1::name');
		cell.commitBinding('slot-1', 'row-2', 1, 'name', 0, 'slot-1::name', 'portal');

		expect(cell.binding?.rowId).toBe('row-2');
		expect(cell.binding?.contentMode).toBe('portal');
		expect(cell.binding).toBe(firstBindingRecord);
	});

	it('destroy() clears binding and resets cached DOM state', () => {
		const div = document.createElement('div');
		const cell = new CellSlot(div);
		cell.update(0, 'name', 0, 'row-1', 0, -1, 100, 'og-cell', 'text', 'one', 'one');
		cell.commitBinding('slot-1', 'row-1', 0, 'name', 0, 'slot-1::name', 'text');
		cell.lastMountedRowVersion = 5;
		cell.lastMountedGlobalVersion = 3;
		cell.lastMountedInsightVersion = 2;
		cell.lastMountedStyleVersion = 4;
		cell.lastMountedLoadingVersion = 1;
		cell.lastMountedSelectionVersion = 6;

		cell.destroy();

		expect(cell.binding).toBeNull();
		expect(cell.lastMountedRowVersion).toBe(-1);
		expect(cell.lastMountedGlobalVersion).toBe(-1);
		expect(cell.lastMountedInsightVersion).toBe(-1);
		expect(cell.lastMountedStyleVersion).toBe(-1);
		expect(cell.lastMountedLoadingVersion).toBe(-1);
		expect(cell.lastMountedSelectionVersion).toBe(-1);
	});

	it('should prevent redundant DOM writes on RowSlot if layout values match', () => {
		const div = document.createElement('div');
		const row = new RowSlot('row-1', div);

		const updated1 = row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		expect(updated1).toBe(true);
		expect(div.style.transform).toBe('translateY(80px)');
		expect(div.style.height).toBe('40px');

		const updated2 = row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		expect(updated2).toBe(false);
	});

	it('unbindHot() hides the row without detaching warm cell DOM', () => {
		const rowEl = document.createElement('div');
		const row = new RowSlot('row-1', rowEl);
		const cellEl = document.createElement('div');
		const cell = new CellSlot(cellEl);
		cell.columnInstanceId = 'name' as any;
		row.cellsByColumnInstanceId.set('name' as any, cell);
		row.centerCells.push(cell);
		rowEl.appendChild(cellEl);

		row.unbindHot();

		expect(rowEl.style.visibility).toBe('hidden');
		expect(cellEl.parentNode).toBe(rowEl);
		expect(row.cellsByColumnInstanceId.get('name' as any)).toBe(cell);
	});

	it('unbindHot() preserves warm row dataset mirrors for same-row rebound', () => {
		const rowEl = document.createElement('div');
		const row = new RowSlot('row-1', rowEl);

		row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		row.unbindHot();

		expect(rowEl.dataset.rowIndex).toBe('2');
		expect(rowEl.dataset.rowId).toBe('row-2');
		expect(rowEl.getAttribute('aria-rowindex')).toBe('3');
	});

	it('update() makes a hot-unbound slot visible when it is rebound', () => {
		const rowEl = document.createElement('div');
		const row = new RowSlot('row-1', rowEl);

		row.update(2, 'row-2', 'data', 80, 40, 'og-row selected');
		row.unbindHot();
		const updated = row.update(4, 'row-4', 'data', 160, 40, 'og-row');

		expect(updated).toBe(true);
		expect(rowEl.style.visibility).toBe('');
		expect(rowEl.dataset.rowIndex).toBe('4');
	});
});
