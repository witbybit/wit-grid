// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createPortalStore } from './GridPortal.js';
import type { CellPortalPhysicalIdentity } from './gridPortalTypes.js';

const IDENTITY: CellPortalPhysicalIdentity = {
	cellInstanceId: 'ci-1',
	rowSlotId: 'slot-0',
	slotGeneration: 1,
	rowBindingGeneration: 1,
	portalHostId: 'ph',
};
const col = { field: 'name' } as never;
const rowA = { id: 'a', data: { name: 'A' } } as never;
const rowB = { id: 'b', data: { name: 'B' } } as never;

describe('portal store: a recycled cell showing another row', () => {
	it('commits the new row in one flushSync batch before paint, not in a later render', async () => {
		const store = createPortalStore<{ name: string }>();
		const container = document.createElement('div');
		store.mountCell('k1', container, 'A', rowA, col, false, false, 'scroll-live', true, false, false, IDENTITY);
		const second = document.createElement('div');
		store.mountCell('k2', second, 'A', rowA, col, false, false, 'scroll-live', true, false, false, IDENTITY);
		const listener = vi.fn();
		store.subscribeToCell!('k1', listener);
		store.subscribeToCell!('k2', listener);

		store.mountCell('k1', container, 'B', rowB, col, false, false, 'scroll-live', true, false, false, IDENTITY);
		store.mountCell('k2', second, 'B', rowB, col, false, false, 'scroll-live', true, false, false, IDENTITY);
		// Not inside the grid's frame work: queued for the microtask that runs before paint.
		expect(listener).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(store.getDebugStats!().cellRowChangeSyncFlushes).toBe(1);
		expect(store.getCellData!('k1')?.node).toBe(rowB);
	});

	it('keeps same-row data updates on the existing synchronous notification', () => {
		const store = createPortalStore<{ name: string }>();
		const container = document.createElement('div');
		store.mountCell('k1', container, 'A', rowA, col, false, false, 'scroll-live', true, false, false, IDENTITY);
		const listener = vi.fn();
		store.subscribeToCell!('k1', listener);
		store.mountCell('k1', container, 'A2', rowA, col, false, false, 'scroll-live', true, false, false, IDENTITY);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getDebugStats!().cellRowChangeSyncFlushes).toBe(0);
	});
});
