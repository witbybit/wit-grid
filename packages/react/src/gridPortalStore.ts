import { flushSync } from 'react-dom';
import type { ColumnDef, VisualRow, CellRendererPhase } from '@eregister/wit-grid-core';
import type {
	PortalData,
	RowPortalData,
	MenuPortalData,
	CellPortalSnapshot,
	RowMenuPortalSnapshot,
	ImperativeUpdaterFn,
	CellPortalPhysicalIdentity,
	PortalRowNodeLike,
} from './gridPortalTypes.js';

export type ConcretePortalStore<TRowData> = ReturnType<typeof createPortalStore<TRowData>>;

function isSamePhysicalIdentity(left: CellPortalPhysicalIdentity | undefined, right: CellPortalPhysicalIdentity | undefined): boolean {
	return (
		!!left &&
		!!right &&
		left.cellInstanceId === right.cellInstanceId &&
		left.rowSlotId === right.rowSlotId &&
		left.slotGeneration === right.slotGeneration &&
		left.rowBindingGeneration === right.rowBindingGeneration &&
		left.portalHostId === right.portalHostId
	);
}

export function createPortalStore<TRowData = unknown>() {
	const debugStats = {
		cellStructuralPublishes: 0,
		rowMenuStructuralPublishes: 0,
		cellSnapshotRebuilds: 0,
		rowMenuSnapshotRebuilds: 0,
	};
	// Mutable maps — source of truth
	const portals = new Map<string, PortalData<TRowData>>();
	const rowPortals = new Map<string, RowPortalData<TRowData>>();
	const menuPortals = new Map<string, MenuPortalData<TRowData>>();
	const cellPortalKeyByContainer = new Map<HTMLElement, string>();
	const rowPortalKeyByContainer = new Map<HTMLElement, string>();

	// Per-cell data listeners — fired when a cell's value/props change (not structure)
	const cellDataListeners = new Map<string, Set<() => void>>();

	// Structural listeners — fired when the set of cells/rows/menus changes
	const cellStructuralListeners = new Set<() => void>();
	const rowMenuStructuralListeners = new Set<() => void>();

	// Imperative updaters — registered by ImperativePortalCellWrapper, bypasses React scheduler
	const imperativeUpdaters = new Map<string, ImperativeUpdaterFn<TRowData>>();

	// Snapshots — only rebuilt on structural changes; CellPortalPool's useSyncExternalStore
	// bails out on data updates (cellSnapshot reference unchanged) so only structural changes
	// cause the pool to re-render. Per-cell data flows through PortalCellWrapper's useState.
	let cellSnapshot: CellPortalSnapshot<TRowData> = { cellPortalList: [] };
	let rowMenuSnapshot: RowMenuPortalSnapshot<TRowData> = { rowPortalList: [], menuPortalList: [] };

	// Coalescing flags — one microtask per notification type
	let cellStructuralScheduled = false;
	let rowMenuScheduled = false;

	// ── Snapshot builders ──────────────────────────────────────────────────────
	// Lazy: structural ops mark the snapshot dirty; the O(N) rebuild happens once in
	// the getter when React actually reads it. A budgeted flush chunk of 24 ops would
	// otherwise rebuild 24 times before the single coalesced notification fires.
	let cellSnapshotDirty = false;
	let rowMenuSnapshotDirty = false;

	function rebuildCellSnapshot() {
		cellSnapshotDirty = true;
		debugStats.cellSnapshotRebuilds++;
	}

	function rebuildRowMenuSnapshot() {
		rowMenuSnapshotDirty = true;
		debugStats.rowMenuSnapshotRebuilds++;
	}

	// ── Notification helpers ───────────────────────────────────────────────────

	function notifyCellStructural(sync = false) {
		debugStats.cellStructuralPublishes++;
		if (sync) {
			flushSync(() => {
				for (const l of cellStructuralListeners) l();
			});
			return;
		}
		if (cellStructuralScheduled) return;
		cellStructuralScheduled = true;
		queueMicrotask(() => {
			cellStructuralScheduled = false;
			for (const l of cellStructuralListeners) l();
		});
	}

	function notifyRowMenuStructural() {
		debugStats.rowMenuStructuralPublishes++;
		if (rowMenuScheduled) return;
		rowMenuScheduled = true;
		queueMicrotask(() => {
			rowMenuScheduled = false;
			for (const l of rowMenuStructuralListeners) l();
		});
	}

	// Synchronous — called directly during the grid's paint loop so React can batch all cell updates
	function notifyCellData(cellKey: string) {
		const list = cellDataListeners.get(cellKey);
		if (list) for (const l of list) l();
	}

	// ── Public API ─────────────────────────────────────────────────────────────

	return {
		getDebugStats() {
			let cellDataListenerCount = 0;
			for (const listeners of cellDataListeners.values()) cellDataListenerCount += listeners.size;
			return {
				...debugStats,
				cellPortalCount: portals.size,
				rowPortalCount: rowPortals.size,
				menuPortalCount: menuPortals.size,
				cellListenerKeyCount: cellDataListeners.size,
				cellDataListenerCount,
				cellStructuralListenerCount: cellStructuralListeners.size,
				rowMenuStructuralListenerCount: rowMenuStructuralListeners.size,
				imperativeUpdaterCount: imperativeUpdaters.size,
				pendingCellStructuralNotification: cellStructuralScheduled,
				pendingRowMenuNotification: rowMenuScheduled,
			};
		},
		resetDebugStats() {
			debugStats.cellStructuralPublishes = 0;
			debugStats.rowMenuStructuralPublishes = 0;
			debugStats.cellSnapshotRebuilds = 0;
			debugStats.rowMenuSnapshotRebuilds = 0;
		},
		// Per-cell data subscription — PortalCellWrapper subscribes here for value/props updates
		subscribeToCell(cellKey: string, listener: () => void) {
			let list = cellDataListeners.get(cellKey);
			if (!list) {
				list = new Set();
				cellDataListeners.set(cellKey, list);
			}
			list.add(listener);
			return () => {
				const l = cellDataListeners.get(cellKey);
				if (l) {
					l.delete(listener);
					if (l.size === 0) cellDataListeners.delete(cellKey);
				}
			};
		},
		// Direct read — PortalCellWrapper reads here on each re-render (no snapshot allocation)
		getCellData(cellKey: string) {
			return portals.get(cellKey);
		},

		// ── Optimised split subscriptions ────────────────────────────────────────
		subscribeCells(listener: () => void) {
			cellStructuralListeners.add(listener);
			return () => {
				cellStructuralListeners.delete(listener);
			};
		},
		getCellSnapshot() {
			if (cellSnapshotDirty) {
				cellSnapshotDirty = false;
				cellSnapshot = { cellPortalList: Array.from(portals.values()) };
			}
			return cellSnapshot;
		},

		subscribeRowsMenus(listener: () => void) {
			rowMenuStructuralListeners.add(listener);
			return () => {
				rowMenuStructuralListeners.delete(listener);
			};
		},
		getRowMenuSnapshot() {
			if (rowMenuSnapshotDirty) {
				rowMenuSnapshotDirty = false;
				rowMenuSnapshot = {
					rowPortalList: Array.from(rowPortals.values()).filter(
						(p) => !p.container.classList.contains('og-row-portal-host') || p.container.dataset.rowKey === p.rowKey
					),
					menuPortalList: Array.from(menuPortals.values()),
				};
			}
			return rowMenuSnapshot;
		},

		// ── Imperative update protocol ────────────────────────────────────────────
		registerImperativeUpdater(cellKey: string, fn: ImperativeUpdaterFn<TRowData>) {
			imperativeUpdaters.set(cellKey, fn);
		},
		unregisterImperativeUpdater(cellKey: string) {
			imperativeUpdaters.delete(cellKey);
		},
		tryImperativeUpdate(
			cellKey: string,
			value: unknown,
			node: PortalRowNodeLike<TRowData>,
			col: ColumnDef<TRowData>,
			isEditing: boolean,
			isLoading: boolean,
			phase: CellRendererPhase | undefined,
			isScrolling: boolean | undefined,
			isFocused: boolean | undefined,
			isSelected: boolean | undefined,
			physicalIdentity: CellPortalPhysicalIdentity
		): boolean {
			const fn = imperativeUpdaters.get(cellKey);
			if (!fn) return false;
			const existing = portals.get(cellKey);
			if (!isSamePhysicalIdentity(existing?.physicalIdentity, physicalIdentity)) {
				return false;
			}
			return fn(value, node, col, isEditing, isLoading, phase, isScrolling, isFocused, isSelected);
		},

		// ── Cell mounts ──────────────────────────────────────────────────────────
		mountCell(
			cellKey: string,
			container: HTMLElement,
			value: unknown,
			node: PortalRowNodeLike<TRowData>,
			col: ColumnDef<TRowData>,
			isEditing: boolean,
			isLoading: boolean,
			phase: CellRendererPhase | undefined,
			isScrolling: boolean | undefined,
			isFocused: boolean | undefined,
			isSelected: boolean | undefined,
			physicalIdentity: CellPortalPhysicalIdentity
		) {
			const existing = portals.get(cellKey);

			// Full equality check — skip everything when nothing changed.
			// slotGeneration MUST be compared: a slot rebound to a new row advances the generation
			// while the visible payload (value, node, etc.) may remain identical. Omitting this
			// check allows stale portal ownership to persist across a slot rebind.
			if (
				existing &&
				existing.container === container &&
				existing.value === value &&
				existing.node === node &&
				existing.col === col &&
				existing.isEditing === isEditing &&
				existing.isLoading === isLoading &&
				existing.phase === phase &&
				existing.isScrolling === isScrolling &&
				existing.isFocused === isFocused &&
				existing.isSelected === isSelected &&
				isSamePhysicalIdentity(existing.physicalIdentity, physicalIdentity)
			) {
				cellPortalKeyByContainer.set(container, cellKey);
				return;
			}

			// Container/key conflict resolution
			if (existing && existing.container !== container && cellPortalKeyByContainer.get(existing.container) === cellKey) {
				cellPortalKeyByContainer.delete(existing.container);
			}
			const existingKeyForContainer = cellPortalKeyByContainer.get(container);
			if (existingKeyForContainer && existingKeyForContainer !== cellKey) {
				portals.delete(existingKeyForContainer);
			}

			// A structural change means the SET of cell keys changed, not just the data
			const isStructuralChange =
				!existing || existing.container !== container || (existingKeyForContainer != null && existingKeyForContainer !== cellKey);

			portals.set(cellKey, {
				cellKey,
				container,
				value,
				node,
				col,
				isEditing,
				isLoading,
				phase,
				isScrolling,
				isFocused,
				isSelected,
				physicalIdentity,
			});
			cellPortalKeyByContainer.set(container, cellKey);

			if (isStructuralChange) {
				// Rebuild snapshots — PortalPool components must re-render to add/remove portals
				rebuildCellSnapshot();
				notifyCellStructural();
			} else {
				// Data update only — notify the specific PortalCellWrapper, skip snapshot rebuild.
				notifyCellData(cellKey);
			}
		},

		unmountCell(cellKey: string, container?: HTMLElement, sync = false, physicalIdentity?: CellPortalPhysicalIdentity) {
			const existing = portals.get(cellKey);
			if (!existing || (container && existing.container !== container)) return;
			if (physicalIdentity && !isSamePhysicalIdentity(existing.physicalIdentity, physicalIdentity)) return;
			portals.delete(cellKey);
			if (cellPortalKeyByContainer.get(existing.container) === cellKey) {
				cellPortalKeyByContainer.delete(existing.container);
			}
			imperativeUpdaters.delete(cellKey);
			rebuildCellSnapshot();
			notifyCellStructural(sync);
		},

		flushCell(sync = false) {
			rebuildCellSnapshot();
			notifyCellStructural(sync);
		},

		// ── Row mounts ───────────────────────────────────────────────────────────
		mountRow(rowKey: string, container: HTMLElement, visualRow: VisualRow<TRowData>) {
			const existing = rowPortals.get(rowKey);
			if (existing && existing.container === container && existing.visualRow === visualRow) {
				rowPortalKeyByContainer.set(container, rowKey);
				return;
			}
			if (existing && existing.container !== container && rowPortalKeyByContainer.get(existing.container) === rowKey) {
				rowPortalKeyByContainer.delete(existing.container);
			}
			const existingKeyForContainer = rowPortalKeyByContainer.get(container);
			if (existingKeyForContainer && existingKeyForContainer !== rowKey) {
				rowPortals.delete(existingKeyForContainer);
			}
			rowPortals.set(rowKey, { rowKey, container, visualRow });
			rowPortalKeyByContainer.set(container, rowKey);
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		unmountRow(rowKey: string, container?: HTMLElement) {
			const existing = rowPortals.get(rowKey);
			if (!existing || (container && existing.container !== container)) return;
			rowPortals.delete(rowKey);
			if (rowPortalKeyByContainer.get(existing.container) === rowKey) {
				rowPortalKeyByContainer.delete(existing.container);
			}
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		// ── Menu mounts ──────────────────────────────────────────────────────────
		mountMenu(colField: string, container: HTMLElement, column: ColumnDef<TRowData>, close: () => void) {
			const existing = menuPortals.get(colField);
			if (existing && existing.container === container && existing.column === column) return;
			menuPortals.set(colField, { colField, container, column, close });
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		unmountMenu(colField: string, container?: HTMLElement) {
			const existing = menuPortals.get(colField);
			if (!existing || (container && existing.container !== container)) return;
			menuPortals.delete(colField);
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		clear(silent = false) {
			portals.clear();
			rowPortals.clear();
			menuPortals.clear();
			cellPortalKeyByContainer.clear();
			rowPortalKeyByContainer.clear();
			cellDataListeners.clear();
			cellStructuralListeners.clear();
			rowMenuStructuralListeners.clear();
			imperativeUpdaters.clear();
			rebuildCellSnapshot();
			rebuildRowMenuSnapshot();
			if (!silent) {
				notifyCellStructural();
				notifyRowMenuStructural();
			}
		},
	};
}
