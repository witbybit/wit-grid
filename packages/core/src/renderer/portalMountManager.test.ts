// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { PortalMountManager } from './portalMountManager.js';
import { RenderRuntimeState } from './renderRuntimeState.js';

function makeScrollingRuntimeState(): RenderRuntimeState {
	const rs = new RenderRuntimeState();
	rs.transitionTo('scroll-pending');
	return rs;
}

function makeIdleRuntimeState(): RenderRuntimeState {
	return new RenderRuntimeState();
}

describe('PortalMountManager', () => {
	it('tracks cell portal mount, update, release, and cleanup without DOM method patches', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const container = document.createElement('div');

		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;

		manager.mountCell({
			cellKey: 'r1:name',
			container,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});

		expect(manager.getStats().cells).toBe(1);
		expect(Object.hasOwn(container, '__patchedRemoveChild')).toBe(false);

		manager.mountCell({
			cellKey: 'r1:name',
			container,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'B',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		expect(manager.getStats().cells).toBe(1);
		expect(mount).toHaveBeenCalledTimes(2);

		manager.releaseCell({ cellKey: 'r1:name', container, flushSync: true, rowSlotId: 'slot-0', slotGeneration: 0 });
		expect(manager.getStats().cells).toBe(0);
		expect(release).toHaveBeenCalledWith({ cellKey: 'r1:name', container, flushSync: true, rowSlotId: 'slot-0', slotGeneration: 0 });
	});

	it('releases all tracked portal mounts on cleanup', () => {
		const manager = new PortalMountManager();
		const releaseCell = vi.fn();
		const releaseRow = vi.fn();
		const releaseMenu = vi.fn();
		manager.onUnmountCellContent = releaseCell;
		manager.onUnmountRowContent = releaseRow;
		manager.onUnmountHeaderMenu = releaseMenu;

		manager.mountCell({
			cellKey: 'r1:name',
			container: document.createElement('div'),
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		manager.mountRow({
			rowKey: 'detail:1',
			container: document.createElement('div'),
			visualRow: { kind: 'detail', id: 'detail:1', parentId: '1', depth: 0, height: 40, render: null },
		});
		manager.mountHeaderMenu({
			colField: 'name',
			container: document.createElement('div'),
			column: { field: 'name', header: 'Name' },
			close: vi.fn(),
		});

		manager.releaseAll();

		expect(manager.getStats()).toEqual({ cells: 0, rows: 0, menus: 0 });
		expect(releaseCell).toHaveBeenCalledTimes(1);
		expect(releaseRow).toHaveBeenCalledTimes(1);
		expect(releaseMenu).toHaveBeenCalledTimes(1);
	});

	it('mounts full-width rows during scroll up to the per-frame budget, and defers the rest', () => {
		const manager = new PortalMountManager();
		manager.maxRowMountsPerScrollFrame = 1;
		const mountRow = vi.fn();
		const releaseRow = vi.fn();
		manager.onMountRowContent = mountRow;
		manager.onUnmountRowContent = releaseRow;
		manager.setRuntimeState(makeScrollingRuntimeState());
		const detail = (id: string) => ({ kind: 'detail', id: `detail:${id}`, parentId: id, depth: 0, height: 40, render: null }) as never;

		manager.mountRow({ rowKey: 'detail:1', container: document.createElement('div'), visualRow: detail('1') });
		manager.mountRow({ rowKey: 'detail:2', container: document.createElement('div'), visualRow: detail('2') });
		// Within budget: mounted in-frame. Over budget: waits for scroll to settle.
		expect(mountRow.mock.calls.map(([mount]) => mount.rowKey)).toEqual(['detail:1']);

		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();
		expect(mountRow.mock.calls.map(([mount]) => mount.rowKey)).toEqual(['detail:1', 'detail:2']);
		expect(releaseRow).not.toHaveBeenCalled();
	});

	it('a recycled row container whose mount is deferred hides the previous row and shows the new label', () => {
		const manager = new PortalMountManager();
		manager.maxRowMountsPerScrollFrame = 0;
		const mountRow = vi.fn();
		manager.onMountRowContent = mountRow;
		const container = document.createElement('div');
		const group = (id: string) => ({ kind: 'group', id, depth: 0, height: 40 }) as never;

		// Mounted at rest, then recycled to another group mid-scroll with no budget left this frame.
		manager.mountRow({ rowKey: 'hierarchy-cell:1', container, visualRow: group('group:a') });
		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.mountRow({ rowKey: 'hierarchy-cell:1', container, visualRow: group('group:b'), context: { label: 'B' } as never });
		expect(container.classList.contains('og-row-content-pending')).toBe(true);
		expect(container.getAttribute('data-stand-in')).toBe('B');

		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();
		expect(container.classList.contains('og-row-content-pending')).toBe(false);
		expect(container.hasAttribute('data-stand-in')).toBe(false);
		expect(mountRow).toHaveBeenCalledTimes(2);
	});

	it('defers row portal mounts and releases while scrolling when the budget is spent', () => {
		const manager = new PortalMountManager();
		manager.maxRowMountsPerScrollFrame = 0;
		const mountRow = vi.fn();
		const releaseRow = vi.fn();
		manager.onMountRowContent = mountRow;
		manager.onUnmountRowContent = releaseRow;

		const firstContainer = document.createElement('div');
		const secondContainer = document.createElement('div');

		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.mountRow({
			rowKey: 'detail:1',
			container: firstContainer,
			visualRow: { kind: 'detail', id: 'detail:1', parentId: '1', depth: 0, height: 40, render: null },
		});
		manager.releaseRow({ rowKey: 'detail:1', container: firstContainer });
		manager.mountRow({
			rowKey: 'detail:2',
			container: secondContainer,
			visualRow: { kind: 'detail', id: 'detail:2', parentId: '2', depth: 0, height: 40, render: null },
		});

		expect(mountRow).not.toHaveBeenCalled();
		expect(releaseRow).not.toHaveBeenCalled();
		expect(manager.getScrollStats()).toMatchObject({
			portalMountsDuringScroll: 2,
			portalReleasesDuringScroll: 1,
		});

		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();

		expect(releaseRow).not.toHaveBeenCalled();
		expect(mountRow).toHaveBeenCalledTimes(1);
		expect(mountRow.mock.calls[0][0].rowKey).toBe('detail:2');
	});

	it('updates row portal content when visual row props change without remounting stable rows', () => {
		const manager = new PortalMountManager();
		const mountRow = vi.fn();
		manager.onMountRowContent = mountRow;
		const container = document.createElement('div');
		const collapsed = {
			kind: 'group' as const,
			id: 'group:dept:A',
			field: 'dept',
			key: 'A',
			hierarchy: { level: 0, parentId: null, hasChildren: true, expanded: false, childCount: 2, leafCount: 2, posInSet: 1, setSize: 1 },
			aggregates: {},
			height: 40,
		};
		const expanded = { ...collapsed, hierarchy: { ...collapsed.hierarchy, expanded: true } };

		manager.mountRow({ rowKey: collapsed.id, container, visualRow: collapsed });
		manager.mountRow({ rowKey: collapsed.id, container, visualRow: collapsed });
		manager.mountRow({ rowKey: expanded.id, container, visualRow: expanded });

		expect(mountRow).toHaveBeenCalledTimes(2);
		expect(mountRow.mock.calls[1][0].visualRow).toBe(expanded);
	});

	it('re-renders a group row when only its aggregates change', () => {
		const manager = new PortalMountManager();
		const mountRow = vi.fn();
		manager.onMountRowContent = mountRow;
		const container = document.createElement('div');
		const hierarchy = { level: 0, parentId: null, hasChildren: true, expanded: true, childCount: 2, leafCount: 2, posInSet: 1, setSize: 1 };
		const before = {
			kind: 'group' as const,
			id: 'group:dept=A',
			groupId: 'group:dept=A',
			field: 'dept',
			key: 'A',
			keyString: 'A',
			path: [],
			hierarchy,
			aggregates: { revenue: 100 },
		};
		// A new pipeline run rebuilds the aggregates object: equal values must not remount...
		manager.mountRow({ rowKey: before.id, container, visualRow: before });
		manager.mountRow({ rowKey: before.id, container, visualRow: { ...before, aggregates: { revenue: 100 } } });
		expect(mountRow).toHaveBeenCalledTimes(1);
		// ...but a changed value must, or a live total never updates on screen.
		manager.mountRow({ rowKey: before.id, container, visualRow: { ...before, aggregates: { revenue: 150 } } });
		expect(mountRow).toHaveBeenCalledTimes(2);
	});

	it('defers cell portal mounts while scrolling and drops transient cells before flush', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const stableContainer = document.createElement('div');
		const transientContainer = document.createElement('div');
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;

		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.mountCell({
			cellKey: 'r1:name',
			container: stableContainer,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		manager.mountCell({
			cellKey: 'r2:name',
			container: transientContainer,
			rowSlotId: 'slot-1',
			slotGeneration: 0,
			value: 'B',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		manager.releaseCell({ cellKey: 'r2:name', container: transientContainer, rowSlotId: 'slot-1', slotGeneration: 0 });

		expect(mount).not.toHaveBeenCalled();
		expect(release).not.toHaveBeenCalled();
		expect(manager.getScrollStats()).toMatchObject({
			portalMountsDuringScroll: 2,
			portalReleasesDuringScroll: 1,
		});

		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();

		expect(release).not.toHaveBeenCalled();
		expect(mount).toHaveBeenCalledTimes(1);
		expect(mount.mock.calls[0][0].cellKey).toBe('r1:name');
	});

	it('suppresses synchronous cell portal flushes while scrolling', () => {
		const manager = new PortalMountManager();
		const release = vi.fn();
		const flush = vi.fn();
		const container = document.createElement('div');
		manager.onUnmountCellContent = release;
		manager.onFlushCellContent = flush;

		manager.mountCell({
			cellKey: 'r1:name',
			container,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});

		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.releaseCells([{ cellKey: 'r1:name', container, rowSlotId: 'slot-0', slotGeneration: 0 }], true);

		expect(release).not.toHaveBeenCalled();
		expect(flush).not.toHaveBeenCalled();
		expect(manager.getScrollStats().portalFlushesDuringScroll).toBe(0);

		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred(true);

		expect(release).toHaveBeenCalledWith({ cellKey: 'r1:name', container, flushSync: false, rowSlotId: 'slot-0', slotGeneration: 0 });
		expect(flush).toHaveBeenCalledWith({ flushSync: true });
		expect(manager.getScrollStats().portalFlushesDuringScroll).toBe(0);
	});

	it('flushes deferred portal work in bounded chunks', () => {
		const manager = new PortalMountManager();
		const release = vi.fn();
		manager.onUnmountCellContent = release;

		for (let index = 0; index < 8; index++) {
			manager.mountCell({
				cellKey: `r${index}:name`,
				container: document.createElement('div'),
				rowSlotId: `slot-${index}`,
				slotGeneration: 0,
				value: `A${index}`,
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});
		}
		manager.setRuntimeState(makeScrollingRuntimeState());
		for (let index = 0; index < 8; index++) {
			manager.releaseCell({ cellKey: `r${index}:name`, rowSlotId: `slot-${index}`, slotGeneration: 0 });
		}
		manager.setRuntimeState(makeIdleRuntimeState());

		const first = manager.flushDeferred({ maxItems: 3, reason: 'scroll-idle' });

		expect(first.processed).toBe(3);
		expect(first.remaining).toBe(5);
		expect(release).toHaveBeenCalledTimes(3);
		expect(manager.getScrollStats()).toMatchObject({
			portalFlushChunks: 1,
			maxPortalOpsFlushedInOneChunk: 3,
		});

		const second = manager.flushDeferred({ maxItems: 50, reason: 'scroll-idle' });
		expect(second.processed).toBe(5);
		expect(second.remaining).toBe(0);
		expect(release).toHaveBeenCalledTimes(8);
		expect(manager.getScrollStats().maxPortalOpsFlushedInOneChunk).toBe(5);
	});

	it('keeps scrolled-out custom renderers in a warm root and removes it on cleanup', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const parent = document.createElement('div');
		document.body.appendChild(parent);
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;

		manager.mountCell({
			cellKey: 'logical-1',
			container: parent,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: { id: 'row-1' } as never,
			col: { field: 'name', header: 'Name', cellRenderer: vi.fn() },
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});

		expect(parent.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);

		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.releaseCell({ cellKey: 'logical-1', container: parent, rowSlotId: 'slot-0', slotGeneration: 0 });
		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();

		const warmRoot = document.body.querySelector('.og-hidden-renderer-container');
		expect(warmRoot).not.toBeNull();
		expect(warmRoot?.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);
		expect(release).not.toHaveBeenCalled();

		manager.releaseAll();

		expect(release).toHaveBeenCalledTimes(1);
		expect(document.body.querySelector('.og-hidden-renderer-container')).toBeNull();
	});

	it('rebinds a warm custom renderer by renderer slot key without leaving stale parent DOM', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const firstParent = document.createElement('div');
		const secondParent = document.createElement('div');
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;
		const col = { field: 'name', header: 'Name', cellRenderer: vi.fn() };

		manager.mountCell({
			cellKey: 'row-1:name',
			container: firstParent,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: { id: 'row-1' } as never,
			col,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});
		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.releaseCell({ cellKey: 'row-1:name', container: firstParent, rowSlotId: 'slot-0', slotGeneration: 0 });
		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();

		manager.mountCell({
			cellKey: 'row-2:name',
			container: secondParent,
			rowSlotId: 'slot-0',
			slotGeneration: 1,
			value: 'B',
			node: { id: 'row-2' } as never,
			col,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});

		expect(firstParent.querySelector('.og-custom-renderer-container')).toBeNull();
		expect(secondParent.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);
		expect(manager.getScrollStats().portalFlushChunks).toBe(1);
		expect(mount).toHaveBeenCalledTimes(2);
		expect(release).not.toHaveBeenCalled();
		manager.releaseAll();
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('destroys the previous custom renderer when a physical parent is rebound to a new slot key', () => {
		const manager = new PortalMountManager();
		const release = vi.fn();
		const parent = document.createElement('div');
		const col = { field: 'name', header: 'Name', cellRenderer: vi.fn() };
		manager.onUnmountCellContent = release;

		manager.mountCell({
			cellKey: 'row-1:name',
			container: parent,
			rowSlotId: 'slot-0',
			slotGeneration: 0,
			value: 'A',
			node: { id: 'row-1' } as never,
			col,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});
		manager.mountCell({
			cellKey: 'row-2:name',
			container: parent,
			rowSlotId: 'slot-1',
			slotGeneration: 0,
			value: 'B',
			node: { id: 'row-2' } as never,
			col,
			rowIndex: 1,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});

		expect(parent.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);
		expect(release).toHaveBeenCalledTimes(1);
		expect(release.mock.calls[0][0].cellKey).toBe('row-1:name');
	});

	it('drops a stale deferred mount when a newer immediate mount has already run for the same key (Plan 081)', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const container = document.createElement('div');
		manager.onMountCellContent = mount;

		// Slot gen=1 is queued during scroll
		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.mountCell({
			cellKey: 'slot-a:name',
			container,
			rowSlotId: 'slot-0',
			value: 'old',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
			slotGeneration: 1,
		});

		// Scroll ends — slot is immediately rebound to gen=2 with a new value
		manager.setRuntimeState(makeIdleRuntimeState());
		manager.mountCell({
			cellKey: 'slot-a:name',
			container,
			rowSlotId: 'slot-0',
			value: 'new',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
			slotGeneration: 2,
		});
		expect(mount).toHaveBeenCalledTimes(1);
		expect(mount.mock.calls[0][0].value).toBe('new');

		// The deferred gen=1 mount must be silently dropped
		manager.flushDeferred();
		expect(mount).toHaveBeenCalledTimes(1);
	});

	it('processes a deferred mount normally when no newer generation has displaced it (Plan 081)', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const container = document.createElement('div');
		manager.onMountCellContent = mount;

		manager.setRuntimeState(makeScrollingRuntimeState());
		manager.mountCell({
			cellKey: 'slot-b:name',
			container,
			rowSlotId: 'slot-0',
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
			slotGeneration: 1,
		});

		expect(mount).not.toHaveBeenCalled();

		manager.setRuntimeState(makeIdleRuntimeState());
		manager.flushDeferred();

		expect(mount).toHaveBeenCalledTimes(1);
		expect(mount.mock.calls[0][0].value).toBe('A');
	});

	describe('flushDeferred — stale identity rejection', () => {
		it('rejects deferred release when slotGeneration advanced before flush', () => {
			const manager = new PortalMountManager();
			const release = vi.fn();
			const container = document.createElement('div');
			manager.onUnmountCellContent = release;

			manager.mountCell({
				cellKey: 'ci1-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci1',
				value: 'A',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.releaseCellForScroll({
				cellKey: 'ci1-name',
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci1',
			});

			// Rebind to new row generation before flush
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.mountCell({
				cellKey: 'ci1-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 1,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci1',
				value: 'B',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.flushDeferred();

			expect(release).not.toHaveBeenCalled();
		});

		it('rejects deferred release when cellRowBindingGeneration advanced before flush', () => {
			const manager = new PortalMountManager();
			const release = vi.fn();
			const container = document.createElement('div');
			manager.onUnmountCellContent = release;

			manager.mountCell({
				cellKey: 'ci2-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci2',
				value: 'A',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.releaseCellForScroll({
				cellKey: 'ci2-name',
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci2',
			});

			// Rebind to same slot generation but incremented cell binding generation
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.mountCell({
				cellKey: 'ci2-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 1,
				cellInstanceId: 'ci2',
				value: 'B',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.flushDeferred();

			expect(release).not.toHaveBeenCalled();
		});

		it('rejects deferred release when cellInstanceId differs (CellSlot destroyed and recreated)', () => {
			const manager = new PortalMountManager();
			const release = vi.fn();
			const container = document.createElement('div');
			manager.onUnmountCellContent = release;

			manager.mountCell({
				cellKey: 'ci3-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci3',
				value: 'A',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.releaseCellForScroll({
				cellKey: 'ci3-name',
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci3',
			});

			// New CellSlot at same slot/generation but different cellInstanceId
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.mountCell({
				cellKey: 'ci3-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci4',
				value: 'B',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.flushDeferred();

			expect(release).not.toHaveBeenCalled();
		});

		it('rejects deferred mount when active identity has a newer slotGeneration', () => {
			const manager = new PortalMountManager();
			const mount = vi.fn();
			const container = document.createElement('div');
			manager.onMountCellContent = mount;

			// Enqueue a deferred mount for generation 0
			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.mountCell({
				cellKey: 'ci5-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci5',
				value: 'A',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			// Mount immediately with generation 1 (row rebound) — this updates activeIdentityByKey
			manager.setRuntimeState(makeIdleRuntimeState());
			manager.mountCell({
				cellKey: 'ci5-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 1,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci5',
				value: 'B',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			// mount called once (non-scrolling immediate above)
			expect(mount).toHaveBeenCalledTimes(1);
			mount.mockClear();

			// flush should reject the deferred mount from generation 0
			manager.flushDeferred();

			expect(mount).not.toHaveBeenCalled();
		});

		it('executes legitimate release when identity matches exactly', () => {
			const manager = new PortalMountManager();
			const release = vi.fn();
			const container = document.createElement('div');
			manager.onUnmountCellContent = release;

			manager.mountCell({
				cellKey: 'ci6-name',
				container,
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci6',
				value: 'A',
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});

			manager.setRuntimeState(makeScrollingRuntimeState());
			manager.releaseCellForScroll({
				cellKey: 'ci6-name',
				rowSlotId: 'slot-0',
				slotGeneration: 0,
				cellRowBindingGeneration: 0,
				cellInstanceId: 'ci6',
			});

			manager.setRuntimeState(makeIdleRuntimeState());
			manager.flushDeferred();

			expect(release).toHaveBeenCalledTimes(1);
		});
	});
});

describe('PortalMountManager – cancelDeferredMount', () => {
	const mountFor = (container: HTMLElement) => ({
		cellKey: 'r1:name',
		container,
		rowSlotId: 'slot-0',
		slotGeneration: 0,
		value: 'A',
		node: {} as never,
		col: { field: 'name', header: 'Name' },
		isEditing: false,
		isLoading: false,
	});

	it('drops a mount queued during scroll so it never lands after the cell is released', () => {
		const manager = new PortalMountManager();
		const rs = makeScrollingRuntimeState();
		manager.setRuntimeState(rs);
		const mount = vi.fn();
		manager.onMountCellContent = mount;
		const container = document.createElement('div');

		manager.mountCell(mountFor(container));
		expect(manager.getActiveIdentity('r1:name')).toBeUndefined();
		expect(manager.cancelDeferredMount('r1:name')).toBe(true);

		rs.transitionTo('idle');
		manager.flushDeferred();
		expect(mount).not.toHaveBeenCalled();
		expect(manager.getStats().cells).toBe(0);
	});

	it('leaves really-mounted cells alone', () => {
		const manager = new PortalMountManager();
		manager.setRuntimeState(makeIdleRuntimeState());
		manager.onMountCellContent = vi.fn();
		manager.mountCell(mountFor(document.createElement('div')));

		expect(manager.getActiveIdentity('r1:name')).toBeDefined();
		expect(manager.cancelDeferredMount('r1:name')).toBe(false);
	});
});

describe('PortalMountManager – row-anchored key moving slots inside a release transaction', () => {
	it('does not let the old slot’s queued release unmount the new slot’s mount', () => {
		const manager = new PortalMountManager();
		manager.setRuntimeState(makeIdleRuntimeState());
		const mount = vi.fn();
		const unmount = vi.fn();
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = unmount;
		const oldHost = document.createElement('div');
		const newHost = document.createElement('div');
		const base = {
			cellKey: 'E5:IBM.35:coli3',
			value: 1,
			node: {} as never,
			col: { field: 'change', header: 'Change' },
			isEditing: false,
			isLoading: false,
		};

		manager.mountCell({ ...base, container: oldHost, rowSlotId: 'slot-2', slotGeneration: 1 });

		// A live re-sort moves the focused row from slot-2 to slot-5 within one recycle pass.
		manager.beginCellReleaseTransaction();
		manager.releaseCell({ cellKey: base.cellKey, container: oldHost, flushSync: false, rowSlotId: 'slot-2', slotGeneration: 1 });
		manager.mountCell({ ...base, container: newHost, rowSlotId: 'slot-5', slotGeneration: 3 });
		manager.endCellReleaseTransaction();

		expect(unmount).not.toHaveBeenCalled();
		expect(manager.isCellMounted(base.cellKey)).toBe(true);
		expect(manager.getActiveIdentity(base.cellKey)?.rowSlotId).toBe('slot-5');
	});
});

describe('PortalMountManager – warm-cache eviction forgets the portal record', () => {
	it('drops the record of a warm-parked renderer once the warm cache evicts it', () => {
		const manager = new PortalMountManager();
		const rs = makeIdleRuntimeState();
		manager.setRuntimeState(rs);
		manager.onMountCellContent = vi.fn();
		manager.onUnmountCellContent = vi.fn();
		manager.customRendererManager.setLimits(1, 0);
		const col = { field: 'name', header: 'Name', cellRenderer: () => null };
		const park = (n: number) => {
			const container = document.createElement('div');
			document.body.appendChild(container);
			const cellKey = `C${n}:name`;
			manager.mountCell({
				cellKey,
				container,
				rowSlotId: `slot-${n}`,
				slotGeneration: 1,
				cellInstanceId: `ci${n}`,
				value: n,
				node: { id: `r${n}` } as never,
				col,
				isEditing: false,
				isLoading: false,
			});
			rs.transitionTo('scroll-pending');
			manager.releaseCellForScroll({ cellKey, container, flushSync: false, rowSlotId: `slot-${n}`, slotGeneration: 1 });
			rs.transitionTo('idle');
		};

		park(1);
		expect(manager.getOwnershipSnapshot().trackedCellPortals).toBe(1); // parked warm, identity kept
		park(2); // warm cache holds 1: parking #2 evicts #1
		park(3);
		expect(manager.getOwnershipSnapshot().trackedCellPortals).toBeLessThanOrEqual(1);
		expect(manager.checkCellPortalInvariants()).toEqual([]);
	});
});
