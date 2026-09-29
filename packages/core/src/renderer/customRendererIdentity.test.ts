// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CustomRendererManager, type AcquireRendererParams } from './customRendererManager.js';
import { DomCellRendererManager, type AcquireDomRendererParams } from './domCellRendererManager.js';
import { PortalMountManager } from './portalMountManager.js';
import type { GridCellContentMount, GridCellContentUnmount } from './IGridRenderer.js';
import type { DomCellRenderer } from '../columnDef.js';

interface Row {
	id: string;
}

function makeEngineStub(): any {
	return {
		isScrolling: false,
		customRendererMountsDuringScroll: 0,
		customRendererWarmHits: 0,
		customRendererWarmMisses: 0,
		stateManager: { getState: () => ({}) },
	};
}

function params(key: string, parentContainer: HTMLElement, overrides: Partial<AcquireRendererParams<Row>> = {}): AcquireRendererParams<Row> {
	return {
		rendererKey: key,
		cellKey: key,
		rowSlotId: 'slot-3',
		slotGeneration: 7,
		cellRowBindingGeneration: 4,
		cellInstanceId: `ci-${key}`,
		portalHostId: `ci-${key}-ph`,
		parentContainer,
		value: 'v',
		node: { id: 'row-1', data: { id: 'row-1' } } as any,
		col: { field: 'c' } as any,
		isEditing: false,
		isLoading: false,
		phase: 'initial',
		isScrolling: false,
		isFocused: false,
		isSelected: false,
		...overrides,
	};
}

describe('CustomRendererManager physical identity forwarding', () => {
	it('emits the full mount identity on destroy with no intermediate update (invalidated release)', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub());
		const unmounts: GridCellContentUnmount[] = [];
		manager.onUnmountCellContent = (u) => unmounts.push(u);
		const parent = document.createElement('div');

		manager.acquire(params('k1', parent));
		manager.releaseByCellKey('k1', 'invalidated');

		expect(unmounts).toHaveLength(1);
		expect(unmounts[0]).toMatchObject({
			cellKey: 'k1',
			rowSlotId: 'slot-3',
			slotGeneration: 7,
			cellRowBindingGeneration: 4,
			cellInstanceId: 'ci-k1',
			portalHostId: 'ci-k1-ph',
		});
	});

	it('forwards the full identity on update notifications and on the unmount that follows', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub());
		const mounts: GridCellContentMount<Row>[] = [];
		const unmounts: GridCellContentUnmount[] = [];
		manager.onMountCellContent = (m) => mounts.push(m);
		manager.onUnmountCellContent = (u) => unmounts.push(u);
		const parent = document.createElement('div');

		manager.acquire(params('k1', parent));
		manager.acquire(params('k1', parent, { value: 'v2', cellRowBindingGeneration: 5 }));

		expect(mounts).toHaveLength(2);
		expect(mounts[1]).toMatchObject({
			lifecycleOperation: 'update',
			cellInstanceId: 'ci-k1',
			portalHostId: 'ci-k1-ph',
			cellRowBindingGeneration: 5,
		});

		manager.releaseByCellKey('k1', 'destroyed');
		expect(unmounts[0]).toMatchObject({ cellInstanceId: 'ci-k1', portalHostId: 'ci-k1-ph', cellRowBindingGeneration: 5 });
	});

	it('notifies the adapter when only the physical identity changes so its stored identity stays in sync', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub());
		const mounts: GridCellContentMount<Row>[] = [];
		manager.onMountCellContent = (m) => mounts.push(m);
		const parent = document.createElement('div');

		const first = params('k1', parent);
		manager.acquire(first);
		manager.acquire({ ...first, slotGeneration: 8 });

		expect(mounts).toHaveLength(2);
		expect(mounts[1]).toMatchObject({ slotGeneration: 8, cellInstanceId: 'ci-k1' });
	});

	it('LRU-evicts the least recently warmed entry and reports its identity', () => {
		const manager = new CustomRendererManager<Row>(makeEngineStub());
		manager.setLimits(2, 30000);
		const unmounts: GridCellContentUnmount[] = [];
		manager.onUnmountCellContent = (u) => unmounts.push(u);
		const parent = document.createElement('div');

		for (const key of ['a', 'b']) {
			manager.acquire(params(key, parent));
			manager.releaseByCellKey(key, 'scrolled-out');
		}
		// Re-touch 'a' so 'b' becomes least recently used.
		manager.acquire(params('a', parent));
		manager.releaseByCellKey('a', 'scrolled-out');
		manager.acquire(params('c', parent));
		manager.releaseByCellKey('c', 'scrolled-out');

		expect(unmounts.map((u) => u.cellKey)).toEqual(['b']);
		expect(unmounts[0]).toMatchObject({ cellInstanceId: 'ci-b', portalHostId: 'ci-b-ph' });
		expect(manager.getStats()).toMatchObject({ warmCount: 2, evictions: 1 });
	});
});

describe('PortalMountManager physical identity forwarding', () => {
	it('forwards portalHostId into the custom renderer so its destroy matches the adapter-side mount identity', () => {
		const manager = new PortalMountManager<Row>();
		const mounts: GridCellContentMount<Row>[] = [];
		const unmounts: GridCellContentUnmount[] = [];
		manager.onMountCellContent = (m) => mounts.push(m);
		manager.onUnmountCellContent = (u) => unmounts.push(u);
		const parent = document.createElement('div');

		manager.mountCell({
			cellKey: 'r1:name',
			container: parent,
			rowSlotId: 'slot-0',
			slotGeneration: 2,
			cellRowBindingGeneration: 3,
			cellInstanceId: 'ci-9',
			portalHostId: 'ci-9-ph',
			value: 'A',
			node: { id: 'r1' } as never,
			col: { field: 'name', header: 'Name', cellRenderer: vi.fn() } as never,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});
		manager.releaseCell({ cellKey: 'r1:name', container: parent, reason: 'invalidated', rowSlotId: 'slot-0', slotGeneration: 2 });

		expect(mounts[0]).toMatchObject({ cellInstanceId: 'ci-9', portalHostId: 'ci-9-ph', cellRowBindingGeneration: 3 });
		expect(unmounts).toHaveLength(1);
		expect(unmounts[0]).toMatchObject({
			cellKey: 'r1:name',
			rowSlotId: 'slot-0',
			slotGeneration: 2,
			cellRowBindingGeneration: 3,
			cellInstanceId: 'ci-9',
			portalHostId: 'ci-9-ph',
		});
	});

	it('includes cellInstanceId/portalHostId on the identity-derived unmount of a non-custom portal', () => {
		const manager = new PortalMountManager<Row>();
		const unmounts: GridCellContentUnmount[] = [];
		manager.onUnmountCellContent = (u) => unmounts.push(u);

		manager.mountCell({
			cellKey: 'r1:plain',
			container: document.createElement('div'),
			rowSlotId: 'slot-1',
			slotGeneration: 5,
			cellRowBindingGeneration: 6,
			cellInstanceId: 'ci-2',
			portalHostId: 'ci-2-ph',
			value: 'A',
			node: { id: 'r1' } as never,
			col: { field: 'plain', header: 'Plain' },
			isEditing: false,
			isLoading: false,
		});
		manager.releaseAll();

		expect(unmounts).toHaveLength(1);
		expect(unmounts[0]).toMatchObject({
			cellKey: 'r1:plain',
			rowSlotId: 'slot-1',
			slotGeneration: 5,
			cellRowBindingGeneration: 6,
			cellInstanceId: 'ci-2',
			portalHostId: 'ci-2-ph',
		});
	});
});

describe('DomCellRendererManager warm cache eviction', () => {
	function domParams(key: string, parent: HTMLElement, renderer: DomCellRenderer<Row>): AcquireDomRendererParams<Row> {
		return {
			rendererKey: key,
			cellKey: key,
			parentContainer: parent,
			renderer,
			value: key,
			node: { id: key, data: { id: key } } as any,
			col: { field: 'c' } as any,
			isEditing: false,
			phase: 'initial',
			isScrolling: false,
			isFocused: false,
			isSelected: false,
		};
	}

	function makeRenderer(): { renderer: DomCellRenderer<Row>; mounted: string[]; destroyed: string[] } {
		const mounted: string[] = [];
		const destroyed: string[] = [];
		const renderer = {
			mount: (_container: HTMLElement, p: { value: unknown }) => {
				const key = String(p.value);
				mounted.push(key);
				return { update: () => {}, destroy: () => destroyed.push(key) };
			},
		} as unknown as DomCellRenderer<Row>;
		return { renderer, mounted, destroyed };
	}

	it('does not destroy a warm entry just because many unrelated mounts advanced the LRU counter', () => {
		const manager = new DomCellRendererManager<Row>(makeEngineStub());
		manager.setLimits(3);
		const { renderer, mounted, destroyed } = makeRenderer();
		const parent = document.createElement('div');

		manager.acquire(domParams('warm', document.createElement('div'), renderer));
		manager.releaseByCellKey('warm', 'scrolled-out');
		// Many active cold mounts (each advances lruCounter) well past the old maxWarm*2 threshold.
		for (let i = 0; i < 20; i++) manager.acquire(domParams(`active-${i}`, document.createElement('div'), renderer));
		// A scrolled-out release runs pruneWarmCache; the warm cache (2 entries) is under its size limit.
		manager.releaseByCellKey('active-0', 'scrolled-out');

		expect(destroyed).toEqual([]);
		const mountsBefore = mounted.length;
		manager.acquire(domParams('warm', parent, renderer));
		expect(mounted.length).toBe(mountsBefore);
	});

	it('evicts the least recently warmed entry first', () => {
		const manager = new DomCellRendererManager<Row>(makeEngineStub());
		manager.setLimits(2);
		const { renderer, destroyed } = makeRenderer();
		const parent = document.createElement('div');

		for (const key of ['a', 'b']) {
			manager.acquire(domParams(key, parent, renderer));
			manager.releaseByCellKey(key, 'scrolled-out');
		}
		manager.acquire(domParams('a', parent, renderer));
		manager.releaseByCellKey('a', 'scrolled-out');
		manager.acquire(domParams('c', parent, renderer));
		manager.releaseByCellKey('c', 'scrolled-out');

		expect(destroyed).toEqual(['b']);
	});
});
