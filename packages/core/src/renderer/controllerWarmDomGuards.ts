import type { CellCtrl } from './controllers/CellCtrl.js';
import type { CellSlot } from './cellSlot.js';

export function mustClearSlotForControllerChange<TRowData>(cellSlot: CellSlot<TRowData>, cellCtrl: CellCtrl): boolean {
	if (cellSlot.rowId !== '' && cellSlot.rowId !== cellCtrl.rowId) return true;
	if (cellSlot.columnInstanceId !== '' && cellSlot.columnInstanceId !== cellCtrl.columnInstanceId) return true;
	if (cellCtrl.lifecycle.attachedSlotInstanceId && cellCtrl.lifecycle.attachedSlotInstanceId !== cellSlot.cellInstanceId) return true;
	return false;
}
