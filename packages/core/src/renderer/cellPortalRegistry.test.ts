// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CellPortalRegistry, type CellPortalPhysicalIdentity } from './cellPortalRegistry.js';
import type { GridCellContentMount } from './IGridRenderer.js';

const identity = (slot: string, generation = 1): CellPortalPhysicalIdentity => ({
	cellInstanceId: `ci-${slot}`,
	portalHostId: '',
	rowSlotId: slot,
	slotGeneration: generation,
	cellRowBindingGeneration: 0,
});

const mountOf = (cellKey: string, container: HTMLElement): GridCellContentMount =>
	({
		cellKey,
		container,
		rowSlotId: 's',
		slotGeneration: 1,
		value: 1,
		node: {} as never,
		col: { field: 'a' },
		isEditing: false,
		isLoading: false,
	}) as GridCellContentMount;

describe('CellPortalRegistry', () => {
	it('wanting a key again cancels a release waiting in either queue', () => {
		const registry = new CellPortalRegistry();
		const host = document.createElement('div');
		for (const queue of ['deferred', 'transaction'] as const) {
			registry.markWanted('k', host);
			registry.recordMounted('k', identity('a'), false);
			registry.markUnwanted('k');
			registry.queueRelease('k', { cellKey: 'k', container: host, rowSlotId: 'a', slotGeneration: 1 }, queue);
			expect(registry.pendingReleaseCount(queue)).toBe(1);

			registry.markWanted('k', document.createElement('div'));
			expect(registry.pendingReleaseCount(queue)).toBe(0);
			expect(registry.checkInvariants()).toEqual([]);
			registry.clear();
		}
	});

	it('forgets a record once nothing is left, and never before', () => {
		const registry = new CellPortalRegistry();
		const host = document.createElement('div');
		registry.markWanted('k', host);
		registry.queueMount(mountOf('k', host), true);
		registry.markUnwanted('k');
		expect(registry.get('k')).toBeDefined(); // the queued mount still holds it

		expect(registry.cancelMount('k')).toEqual({ canceled: true, cold: true });
		expect(registry.get('k')).toBeUndefined();
		expect(registry.checkInvariants()).toEqual([]);
	});

	it('answers which key a host holds, following a host that switches keys', () => {
		const registry = new CellPortalRegistry();
		const host = document.createElement('div');
		registry.markWanted('C1', host);
		expect(registry.getKeyForContainer(host)).toBe('C1');

		registry.markWanted('E1', host); // the same cell now shows an editor
		expect(registry.getKeyForContainer(host)).toBe('E1');
		registry.markUnwanted('E1');
		expect(registry.getKeyForContainer(host)).toBeUndefined();
		expect(registry.checkInvariants()).toEqual([]);
	});

	it('tracks mounted editors so superseded ones can be found', () => {
		const registry = new CellPortalRegistry();
		registry.markWanted('E1', document.createElement('div'));
		registry.recordMounted('E1', identity('a'), true);
		registry.markWanted('E2', document.createElement('div'));
		registry.recordMounted('E2', identity('b'), true);
		expect(registry.editKeysExcept('E2')).toEqual(['E1']);

		registry.recordReleased('E1');
		expect(registry.editKeysExcept('E2')).toEqual([]);
		expect(registry.checkInvariants()).toEqual([]);
	});

	it('stays internally consistent under random operation sequences', () => {
		// Deterministic LCG, as the repo's adversarial tests require (no Math.random).
		let state = 0x2f6b;
		const next = () => {
			state = (state * 1103515245 + 12345) & 0x7fffffff;
			return state / 0x7fffffff;
		};
		const registry = new CellPortalRegistry();
		const keys = ['C1', 'C2', 'C3', 'E1', 'E2'];
		const hosts = Array.from({ length: 4 }, () => document.createElement('div'));
		for (let step = 0; step < 5000; step++) {
			const key = keys[Math.floor(next() * keys.length)];
			const host = hosts[Math.floor(next() * hosts.length)];
			const op = Math.floor(next() * 9);
			switch (op) {
				case 0:
					registry.markWanted(key, host);
					break;
				case 1:
					registry.markUnwanted(key);
					break;
				case 2:
					registry.queueMount(mountOf(key, host), next() < 0.5);
					break;
				case 3:
					registry.cancelMount(key);
					break;
				case 4:
					registry.recordMounted(key, identity(String(step % 3)), key.startsWith('E'));
					break;
				case 5:
					registry.recordReleased(key);
					break;
				case 6:
					if (!registry.isWanted(key))
						registry.queueRelease(
							key,
							{ cellKey: key, container: host, rowSlotId: 'a', slotGeneration: 1 },
							next() < 0.5 ? 'deferred' : 'transaction'
						);
					break;
				case 7:
					registry.cancelRelease(key);
					break;
				case 8:
					if (next() < 0.02) registry.clearQueues();
					break;
			}
			const violations = registry.checkInvariants();
			if (violations.length > 0) throw new Error(`step ${step} (op ${op} ${key}): ${violations.join('; ')}`);
		}
	});
});
