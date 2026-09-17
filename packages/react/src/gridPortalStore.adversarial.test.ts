import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef, VisualRow } from '@eregister/open-grid-core';
import { createPortalStore } from './gridPortalStore.js';

interface TestRow {
	id: string;
	name: string;
}

function makeLcg(seed: number): () => number {
	let s = seed >>> 0;
	return (): number => {
		s = Math.imul(1664525, s) + 1013904223;
		s = s >>> 0;
		return s / 0x100000000;
	};
}

function lcgInt(rng: () => number, max: number): number {
	return Math.floor(rng() * max);
}

function flushMicrotasks(): Promise<void> {
	return Promise.resolve().then(() => undefined);
}

const COLUMN: ColumnDef<TestRow> = { field: 'name', header: 'Name' };

function makeIdentity(
	cellInstanceId: string,
	rowSlotId: string,
	slotGeneration: number,
	rowBindingGeneration = 0,
	portalHostId = `${cellInstanceId}-ph`
): import('./gridPortalTypes.js').CellPortalPhysicalIdentity {
	return { cellInstanceId, rowSlotId, slotGeneration, rowBindingGeneration, portalHostId };
}

function makeNode(id: string, name = id) {
	return { id, data: { id, name } };
}

function makeDetailRow(rowKey: string): VisualRow<TestRow> {
	return {
		kind: 'detail',
		id: rowKey,
		parentId: rowKey.replace('detail:', ''),
		depth: 0,
		height: 40,
		render: null,
	};
}

describe('createPortalStore — adversarial lifecycle invariants', () => {
	it('keeps portal, listener, and updater ownership bounded across 500 recycled lifecycles', async () => {
		const store = createPortalStore<TestRow>();
		const containers = Array.from({ length: 12 }, () => document.createElement('div'));
		const unsubscribeStructural = store.subscribeCells?.(vi.fn());
		const unsubscribeRowsMenus = store.subscribeRowsMenus?.(vi.fn());
		let peakCellPortals = 0;
		let peakListenerKeys = 0;

		for (let index = 0; index < 500; index++) {
			const slot = index % containers.length;
			const cellKey = `slot-${slot}:name`;
			const identity = makeIdentity(`cell-${index}`, `slot-${slot}`, index + 1);
			const unsubscribeCell = store.subscribeToCell?.(cellKey, vi.fn());
			store.mountCell(
				cellKey,
				containers[slot]!,
				`value-${index}`,
				makeNode(`row-${index}`),
				COLUMN,
				false,
				false,
				undefined,
				false,
				false,
				false,
				identity
			);
			store.registerImperativeUpdater?.(cellKey, () => true);
			if (index % 5 === 0) {
				store.mountRow?.(`detail:${index}`, containers[slot]!, makeDetailRow(`detail:${index}`));
				store.mountMenu?.(`menu-${slot}`, containers[slot]!, COLUMN, () => {});
			}
			store.unmountCell(cellKey, containers[slot]!, false, identity);
			unsubscribeCell?.();
			if (index % 5 === 0) {
				store.unmountRow?.(`detail:${index}`, containers[slot]!);
				store.unmountMenu?.(`menu-${slot}`, containers[slot]!);
			}
			const stats = store.getDebugStats();
			peakCellPortals = Math.max(peakCellPortals, stats.cellPortalCount);
			peakListenerKeys = Math.max(peakListenerKeys, stats.cellListenerKeyCount);
		}

		expect(peakCellPortals).toBeLessThanOrEqual(containers.length);
		expect(peakListenerKeys).toBeLessThanOrEqual(1);
		await flushMicrotasks();
		expect(store.getDebugStats()).toMatchObject({
			cellPortalCount: 0,
			rowPortalCount: 0,
			menuPortalCount: 0,
			cellListenerKeyCount: 0,
			cellDataListenerCount: 0,
			imperativeUpdaterCount: 0,
		});
		unsubscribeStructural?.();
		unsubscribeRowsMenus?.();
		store.clear(true);
		await flushMicrotasks();
		expect(store.getDebugStats()).toMatchObject({ cellStructuralListenerCount: 0, rowMenuStructuralListenerCount: 0 });
	});

	it('rejects stale imperative updates after slot generation rebinding', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const nodeA = makeNode('row-a', 'Old');
		const nodeB = makeNode('row-b', 'New');
		const updater = vi.fn(() => true);

		store.mountCell(
			'slot-0:name',
			container,
			'Old',
			nodeA,
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			makeIdentity('ci1', 'slot-0', 1)
		);
		store.registerImperativeUpdater?.('slot-0:name', updater);

		expect(
			store.tryImperativeUpdate?.(
				'slot-0:name',
				'Old+',
				nodeA,
				COLUMN,
				false,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				makeIdentity('ci1', 'slot-0', 1)
			)
		).toBe(true);
		expect(updater).toHaveBeenCalledTimes(1);

		store.mountCell(
			'slot-0:name',
			container,
			'New',
			nodeB,
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			makeIdentity('ci1', 'slot-0', 2)
		);

		expect(
			store.tryImperativeUpdate?.(
				'slot-0:name',
				'STALE',
				nodeA,
				COLUMN,
				false,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				makeIdentity('ci1', 'slot-0', 1)
			)
		).toBe(false);
		expect(updater).toHaveBeenCalledTimes(1);
		expect(store.getCellData?.('slot-0:name')?.value).toBe('New');
		expect(store.getCellData?.('slot-0:name')?.physicalIdentity).toEqual(makeIdentity('ci1', 'slot-0', 2));
	});

	it('rejects stale imperative updates when slot id mismatches even if generation matches', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const updater = vi.fn(() => true);

		store.mountCell(
			'slot-0:name',
			container,
			'Current',
			makeNode('row-a', 'Current'),
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			makeIdentity('ci2', 'slot-0', 7)
		);
		store.registerImperativeUpdater?.('slot-0:name', updater);

		expect(
			store.tryImperativeUpdate?.(
				'slot-0:name',
				'STALE-WRONG-SLOT',
				makeNode('row-a', 'Current'),
				COLUMN,
				false,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				makeIdentity('ci2', 'slot-1', 7)
			)
		).toBe(false);
		expect(updater).not.toHaveBeenCalled();
	});

	it('ignores stale unmounts when physical identity mismatches the current owner', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');

		store.mountCell(
			'slot-0:name',
			container,
			'Current',
			makeNode('row-a', 'Current'),
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			makeIdentity('ci3', 'slot-0', 2)
		);

		store.unmountCell('slot-0:name', container, false, makeIdentity('ci3', 'slot-0', 1));
		expect(store.getCellData?.('slot-0:name')?.value).toBe('Current');

		store.unmountCell('slot-0:name', container, false, makeIdentity('ci3', 'slot-1', 2));
		expect(store.getCellData?.('slot-0:name')?.value).toBe('Current');
	});

	it('recycled containers retain only the latest cell and row owners under seeded churn', async () => {
		const rng = makeLcg(0x1080cafe);
		const store = createPortalStore<TestRow>();
		const cellContainers = [document.createElement('div'), document.createElement('div')];
		const rowContainers = [document.createElement('div'), document.createElement('div')];
		const activeCellByContainer = new Map<HTMLElement, string>();
		const activeRowByContainer = new Map<HTMLElement, string>();
		let nextCellId = 1;
		let nextRowId = 1;

		for (let step = 0; step < 80; step++) {
			const op = lcgInt(rng, 4);
			if (op === 0) {
				const container = cellContainers[lcgInt(rng, cellContainers.length)];
				const cellKey = `row-${nextCellId}:name`;
				const generation = nextCellId;
				nextCellId++;
				store.mountCell(
					cellKey,
					container,
					`value-${cellKey}`,
					makeNode(cellKey, `value-${cellKey}`),
					COLUMN,
					false,
					false,
					undefined,
					undefined,
					undefined,
					undefined,
					makeIdentity(`ci-${generation}`, `slot-${container === cellContainers[0] ? 0 : 1}`, generation)
				);
				activeCellByContainer.set(container, cellKey);
			} else if (op === 1) {
				const container = cellContainers[lcgInt(rng, cellContainers.length)];
				const active = activeCellByContainer.get(container);
				if (active) {
					store.unmountCell(active, container);
					activeCellByContainer.delete(container);
				}
			} else if (op === 2) {
				const container = rowContainers[lcgInt(rng, rowContainers.length)];
				const rowKey = `detail:${nextRowId++}`;
				container.dataset.rowKey = rowKey;
				store.mountRow(rowKey, container, makeDetailRow(rowKey));
				activeRowByContainer.set(container, rowKey);
			} else {
				const container = rowContainers[lcgInt(rng, rowContainers.length)];
				const active = activeRowByContainer.get(container);
				if (active) {
					store.unmountRow(active, container);
					delete container.dataset.rowKey;
					activeRowByContainer.delete(container);
				}
			}
		}

		await flushMicrotasks();

		const cellSnapshotKeys = store.getCellSnapshot().cellPortalList.map((portal) => portal.cellKey);
		expect(new Set(cellSnapshotKeys)).toEqual(new Set(activeCellByContainer.values()));
		expect(cellSnapshotKeys).toHaveLength(activeCellByContainer.size);

		for (const [container, expectedCellKey] of activeCellByContainer) {
			expect(store.getCellSnapshot().cellPortalList.find((portal) => portal.container === container)?.cellKey).toBe(expectedCellKey);
		}

		const rowSnapshotKeys = store.getRowMenuSnapshot().rowPortalList.map((portal) => portal.rowKey);
		expect(new Set(rowSnapshotKeys)).toEqual(new Set(activeRowByContainer.values()));
		expect(rowSnapshotKeys).toHaveLength(activeRowByContainer.size);

		for (const [container, expectedRowKey] of activeRowByContainer) {
			expect(store.getRowMenuSnapshot().rowPortalList.find((portal) => portal.container === container)?.rowKey).toBe(expectedRowKey);
		}
	});

	it('rejects stale operations when cellInstanceId differs (same slot + generation)', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');

		store.mountCell(
			'ci-a:name',
			container,
			'A',
			makeNode('row-a'),
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			makeIdentity('ci-a', 'slot-0', 0)
		);

		store.unmountCell('ci-a:name', container, false, makeIdentity('ci-b', 'slot-0', 0));
		expect(store.getCellData?.('ci-a:name')?.value).toBe('A');
	});

	it('rejects stale operations when rowBindingGeneration differs', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');

		store.mountCell(
			'ci-c:name',
			container,
			'C',
			makeNode('row-c'),
			COLUMN,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			makeIdentity('ci-c', 'slot-0', 0, 1)
		);

		// rowBindingGeneration 0 vs 1 — cell was hot-unbound and rebound
		store.unmountCell('ci-c:name', container, false, makeIdentity('ci-c', 'slot-0', 0, 0));
		expect(store.getCellData?.('ci-c:name')?.value).toBe('C');
	});

	it('rejects stale operations when portalHostId differs', () => {
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');

		store.mountCell('ci-d:name', container, 'D', makeNode('row-d'), COLUMN, false, false, undefined, undefined, undefined, undefined, {
			cellInstanceId: 'ci-d',
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			rowBindingGeneration: 0,
			portalHostId: 'ci-d-ph',
		});

		store.unmountCell('ci-d:name', container, false, {
			cellInstanceId: 'ci-d',
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			rowBindingGeneration: 0,
			portalHostId: 'ci-x-ph',
		});
		expect(store.getCellData?.('ci-d:name')?.value).toBe('D');
	});
});
