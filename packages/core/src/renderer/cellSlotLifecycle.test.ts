// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	assertCellSlotLifecycleInvariants,
	CellSlotLifecycleEvent,
	CellSlotLifecycleState,
	transitionCellSlotLifecycle,
} from './cellSlotLifecycle.js';
import { CellSlot } from './cellSlot.js';

describe('cell slot lifecycle state machine', () => {
	it('supports repeated physical reuse without reviving destroyed slots', () => {
		let state = CellSlotLifecycleState.Vacant;
		state = transitionCellSlotLifecycle(state, CellSlotLifecycleEvent.Bind);
		expect(state).toBe(CellSlotLifecycleState.Bound);
		state = transitionCellSlotLifecycle(state, CellSlotLifecycleEvent.HotRelease);
		expect(state).toBe(CellSlotLifecycleState.Vacant);
		state = transitionCellSlotLifecycle(state, CellSlotLifecycleEvent.Bind);
		state = transitionCellSlotLifecycle(state, CellSlotLifecycleEvent.Destroy);
		expect(state).toBe(CellSlotLifecycleState.Destroyed);
		expect(() => transitionCellSlotLifecycle(state, CellSlotLifecycleEvent.Bind)).toThrow('Destroyed cell slot');
	});

	it('makes cold destroy idempotent', () => {
		expect(transitionCellSlotLifecycle(CellSlotLifecycleState.Destroyed, CellSlotLifecycleEvent.Destroy)).toBe(CellSlotLifecycleState.Destroyed);
	});

	it('rejects impossible ownership snapshots', () => {
		expect(() =>
			assertCellSlotLifecycleInvariants({
				state: CellSlotLifecycleState.Bound,
				rowIndex: -1,
				rowId: '',
				binding: null,
				renderer: null,
				boundCellCtrl: null,
			})
		).toThrow('row identity');
		expect(() =>
			assertCellSlotLifecycleInvariants({
				state: CellSlotLifecycleState.Destroyed,
				rowIndex: -1,
				rowId: '',
				binding: null,
				renderer: {},
				boundCellCtrl: null,
			})
		).toThrow('renderer or controller');
	});

	it('drives the physical slot through bind, recycle, rebind, and destroy', () => {
		const slot = new CellSlot(document.createElement('div'));
		expect(slot.lifecycleState).toBe(CellSlotLifecycleState.Vacant);

		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 'Alice', 'Alice');
		expect(slot.lifecycleState).toBe(CellSlotLifecycleState.Bound);
		assertCellSlotLifecycleInvariants(slot);

		slot.unbindHot();
		expect(slot.lifecycleState).toBe(CellSlotLifecycleState.Vacant);
		assertCellSlotLifecycleInvariants(slot);

		slot.update(0, 'name', 1, 'r2', 0, -1, 100, 'og-cell', 'text', 'Bob', 'Bob');
		expect(slot.lifecycleState).toBe(CellSlotLifecycleState.Bound);
		slot.destroy();
		expect(slot.lifecycleState).toBe(CellSlotLifecycleState.Destroyed);
		assertCellSlotLifecycleInvariants(slot);
		expect(() => slot.update(0, 'name', 2, 'r3', 0, -1, 100, 'og-cell', 'text', 'Cara', 'Cara')).toThrow('Destroyed cell slot');
	});
});
