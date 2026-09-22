import { memo, useSyncExternalStore } from 'react';
import { GridApi, VisualRow } from '@eregister/wit-grid-core';
import { createPortal } from 'react-dom';
import { GridProvider } from './gridContext.js';
import { hasImperativeRendererCapability } from './reactHostBridge.js';
import { createPortalStore, type ConcretePortalStore } from './gridPortalStore.js';
import {
	PortalCell,
	PortalCellWrapper,
	ImperativePortalCellWrapper,
	DefaultGroupRowRenderer,
	DefaultDetailRowRenderer,
	DefaultFooterRowRenderer,
	DefaultFailedRowRenderer,
	DefaultPlaceholderRowRenderer,
} from './gridPortalHosts.js';
import type { PortalStore, PortalManagerProps } from './gridPortalTypes.js';

export { createPortalStore };
export type { PortalStore };
export {
	PortalCell,
	DefaultGroupRowRenderer,
	DefaultDetailRowRenderer,
	DefaultFooterRowRenderer,
	DefaultFailedRowRenderer,
	DefaultPlaceholderRowRenderer,
};
export type { PortalCellProps, PortalData, CellPortalSnapshot, RowMenuPortalSnapshot, PortalManagerProps } from './gridPortalTypes.js';

// ─── CellPortalPool ───────────────────────────────────────────────────────────

interface CellPortalPoolProps<TRowData = unknown> {
	store: ConcretePortalStore<TRowData>;
	api: GridApi<TRowData>;
}

/**
 * Renders only custom cell portals. Re-renders only when the CELL SLOT LIST changes
 * (a cell enters or leaves the visible area). Individual cell value changes do NOT cause
 * this component to re-render — they go directly to PortalCellWrapper via subscribeToCell,
 * or are handled imperatively by ImperativePortalCellWrapper.
 */
function CellPortalPoolInner<TRowData = unknown>({ store }: CellPortalPoolProps<TRowData>) {
	const snapshot = useSyncExternalStore(store.subscribeCells, store.getCellSnapshot, store.getCellSnapshot);
	const { cellPortalList } = snapshot;

	return (
		<>
			{cellPortalList.map((p) => {
				const useImperative = hasImperativeRendererCapability(p.col);
				// Key MUST be createPortal's third argument: the pool reconciles an array of
				// portal objects, and a portal whose containerInfo differs is never reused.
				// Without it React matches by index and one structural change remounts every
				// portal after it. Context (GridProvider) is inherited from PortalManager.
				return createPortal(
					useImperative ? (
						<ImperativePortalCellWrapper<TRowData> cellKey={p.cellKey} store={store} />
					) : (
						<PortalCellWrapper<TRowData> cellKey={p.cellKey} store={store} />
					),
					p.container,
					p.cellKey
				);
			})}
		</>
	);
}

const CellPortalPool = memo(CellPortalPoolInner) as typeof CellPortalPoolInner;

// ─── RowMenuPortalPool ────────────────────────────────────────────────────────

interface RowMenuPortalPoolProps<TRowData = unknown> {
	store: ConcretePortalStore<TRowData>;
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	footerRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
}

/**
 * Renders group/detail/footer row portals and header menu portals. Re-renders only when rows
 * or menus change — completely isolated from custom cell updates.
 */
function RowMenuPortalPoolInner<TRowData = unknown>({
	store,
	api,
	groupRowRenderer,
	detailRowRenderer,
	footerRowRenderer,
}: RowMenuPortalPoolProps<TRowData>) {
	const snapshot = useSyncExternalStore(store.subscribeRowsMenus, store.getRowMenuSnapshot, store.getRowMenuSnapshot);
	const { rowPortalList, menuPortalList } = snapshot;

	return (
		<>
			{rowPortalList.map((rp) => {
				const { rowKey, container, visualRow } = rp;
				let content: React.ReactNode = null;
				if (visualRow.kind === 'group') {
					content = groupRowRenderer ? groupRowRenderer({ visualRow, api }) : <DefaultGroupRowRenderer visualRow={visualRow} api={api} />;
				} else if (visualRow.kind === 'detail') {
					content = detailRowRenderer ? (
						detailRowRenderer({ visualRow, api })
					) : (
						<DefaultDetailRowRenderer visualRow={visualRow} api={api} />
					);
				} else if (visualRow.kind === 'footer') {
					content = footerRowRenderer ? (
						footerRowRenderer({ visualRow, api })
					) : (
						<DefaultFooterRowRenderer visualRow={visualRow} api={api} />
					);
				} else if (visualRow.kind === 'failed') {
					content = <DefaultFailedRowRenderer visualRow={visualRow} api={api} />;
				} else if (visualRow.kind === 'placeholder') {
					content = <DefaultPlaceholderRowRenderer visualRow={visualRow} api={api} />;
				}
				// Keyed via createPortal's third arg — see CellPortalPool note.
				return createPortal(content, container, rowKey);
			})}
			{menuPortalList.map((mp) => {
				const { colField, container, column, close } = mp;
				const CustomComponent = column.headerMenuComponent;
				if (!CustomComponent) return null;
				return createPortal(<CustomComponent colField={colField} column={column} api={api} close={close} />, container, `menu-${colField}`);
			})}
		</>
	);
}

const RowMenuPortalPool = memo(RowMenuPortalPoolInner) as typeof RowMenuPortalPoolInner;

// ─── PortalManager (public API) ───────────────────────────────────────────────

/**
 * Renders all portal content for the grid.
 *
 * Cell updates and row/menu updates are completely isolated — a price-tick in one cell
 * never causes the row-portal tree to re-render, and a group-row expansion never causes
 * all cell wrappers to re-render.
 *
 * For cells with capabilities.live.update: 'imperative', updates bypass React's scheduler entirely —
 * the grid calls ref.current.update() directly in the paint loop.
 */
export function PortalManager<TRowData = unknown>({
	api,
	groupRowRenderer,
	detailRowRenderer,
	footerRowRenderer,
	store,
}: PortalManagerProps<TRowData>) {
	if (!store?.subscribeCells || !store?.subscribeRowsMenus) {
		// Store is required — the grid view always provides createPortalStore()
		return null;
	}
	const concreteStore = store as ConcretePortalStore<TRowData>;
	// One GridProvider for ALL portals (they inherit context from where createPortal is
	// rendered, not from their DOM container) — keeps PortalManager self-contained while
	// avoiding the old one-provider-per-portal overhead.
	return (
		<GridProvider api={api}>
			<CellPortalPool store={concreteStore} api={api} />
			<RowMenuPortalPool
				store={concreteStore}
				api={api}
				groupRowRenderer={groupRowRenderer}
				detailRowRenderer={detailRowRenderer}
				footerRowRenderer={footerRowRenderer}
			/>
		</GridProvider>
	);
}
