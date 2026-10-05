import type {
	ColumnDef,
	GridApi,
	VisualRow,
	CellRendererPhase,
	RowRendererSpec,
	GroupRendererSpec,
	GroupRenderContext,
} from '@eregister/wit-grid-core';

export interface PortalRowNodeLike<TRowData = unknown> {
	id: string;
	data: TRowData;
}

export interface CellPortalPhysicalIdentity {
	readonly cellInstanceId: string;
	readonly rowSlotId: string;
	readonly slotGeneration: number;
	readonly rowBindingGeneration: number;
	readonly portalHostId: string;
}

export interface PortalCellProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	col: ColumnDef<TRowData>;
	node: PortalRowNodeLike<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase?: CellRendererPhase;
	isScrolling?: boolean;
	isFocused?: boolean;
	isSelected?: boolean;
	/** Not shown to the renderer: a change makes the memoised cell render again (see CellPortalProps.rowVersion). */
	rowVersion?: number;
}

/** Everything a cell renderer is shown; passed whole to the store's mount/update entry points. */
export interface CellPortalProps<TRowData = unknown> {
	value: unknown;
	node: PortalRowNodeLike<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase: CellRendererPhase | undefined;
	isScrolling: boolean | undefined;
	isFocused: boolean | undefined;
	isSelected: boolean | undefined;
	/** The row's version at mount: a new one redraws the cell even when the props above are equal (row-scoped state such as a detail opening). */
	rowVersion?: number;
	/** Physical ownership identity for pooled cell portals. */
	physicalIdentity: CellPortalPhysicalIdentity;
}

export interface PortalData<TRowData = unknown> extends CellPortalProps<TRowData> {
	cellKey: string;
	container: HTMLElement;
}

/** Snapshot used by the optimised CellPortalPool — rebuilt only on structural changes (add/remove). */
export interface CellPortalSnapshot<TRowData = unknown> {
	cellPortalList: PortalData<TRowData>[];
}

/** Snapshot used by the RowMenuPortalPool — rebuilt only on row/menu structural changes. */
export interface RowMenuPortalSnapshot<TRowData = unknown> {
	rowPortalList: RowPortalData<TRowData>[];
	menuPortalList: MenuPortalData<TRowData>[];
}

export interface RowPortalData<TRowData = unknown> {
	rowKey: string;
	container: HTMLElement;
	visualRow: VisualRow<TRowData>;
	/** The configured renderer spec (`detail.renderer` / `grouping.rowRenderer` / `hierarchyColumn.renderer`), when React. */
	renderer?: RowRendererSpec<TRowData> | GroupRendererSpec<TRowData>;
	/** Group, total and hierarchy-cell content: the props a component is rendered with. */
	context?: GroupRenderContext<TRowData>;
}

export interface MenuPortalData<TRowData = unknown> {
	colField: string;
	container: HTMLElement;
	column: ColumnDef<TRowData>;
	close: () => void;
}

// Imperative updater fn — registered by ImperativePortalCellWrapper, called from the grid view layer
export type ImperativeUpdaterFn<TRowData> = (props: CellPortalProps<TRowData>) => boolean;

export interface PortalStore<TRowData = unknown> {
	getDebugStats?(): {
		cellStructuralPublishes: number;
		rowMenuStructuralPublishes: number;
		cellSnapshotRebuilds: number;
		rowMenuSnapshotRebuilds: number;
		/** Microtask flushSync batches committing recycled cells' new rows before paint. */
		cellSyncCommits: number;
	};
	resetDebugStats?(): void;
	subscribeToCell?(cellKey: string, listener: () => void): () => void;
	getCellData?(cellKey: string): PortalData<TRowData> | undefined;
	// Optimised split subscriptions — implemented by createPortalStore
	subscribeCells?(listener: () => void): () => void;
	getCellSnapshot?(): CellPortalSnapshot<TRowData>;
	subscribeRowsMenus?(listener: () => void): () => void;
	getRowMenuSnapshot?(): RowMenuPortalSnapshot<TRowData>;
	// Imperative update protocol
	registerImperativeUpdater?(cellKey: string, fn: ImperativeUpdaterFn<TRowData>): void;
	unregisterImperativeUpdater?(cellKey: string): void;
	tryImperativeUpdate?(cellKey: string, props: CellPortalProps<TRowData>): boolean;
	mountCell(cellKey: string, container: HTMLElement, props: CellPortalProps<TRowData>): void;
	unmountCell(cellKey: string, container?: HTMLElement, sync?: boolean, physicalIdentity?: CellPortalPhysicalIdentity): void;
}

export interface PortalManagerProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	groupRowRenderer?: (ctx: GroupRenderContext<TRowData>) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	totalRowRenderer?: (ctx: GroupRenderContext<TRowData>) => React.ReactNode;
	store?: PortalStore<TRowData>;
}
