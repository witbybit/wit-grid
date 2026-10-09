import {
	GridApi,
	GridEventName,
	GridCellClickParams,
	GridContextMenuOptions,
	GridContextMenuHandle,
	type GridEventPayloadMap,
	registerGridContextMenu,
	VisualRow,
	GroupRenderContext,
	type AdapterFilterMount,
	type AdapterPanelMount,
	type GridSidebarConfig as CoreGridSidebarConfig,
} from '@eregister/wit-grid-core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GridAdapterContext, GridFilterMountContext } from './gridContext.js';
import {
	GridHostWithAdapter,
	GridAdapterHandle,
	bindGridInteractionSurface,
	hasImperativeRendererCapability,
	mountGridHost,
	type GridInteractionSurfaceBinding,
} from './reactHostBridge.js';
import { PortalManager, createPortalStore } from './GridPortal.js';
import { flashCopiedCells } from './cellFlash.js';
import type { GridSidebarConfig } from './sidebar/sidebarConfig.js';

export interface GridViewProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;
	enableColumnReorder?: boolean;
	enableNavigation?: boolean;
	enableContextMenu?: boolean;
	contextMenuOptions?: GridContextMenuOptions<TRowData>;
	onCellClick?: (params: GridCellClickParams<TRowData>) => void;
	onWriteBlocked?: (event: GridEventPayloadMap<TRowData>[GridEventName.writeBlocked]) => void;
	onCellValueChanged?: (event: GridEventPayloadMap<TRowData>[GridEventName.cellValueChanged]) => void;
	navigationOptions?: {
		editTrigger?: 'singleClick' | 'doubleClick';
		arrowKeyNavigationEdit?: boolean;
	};
	/**
	 * Full-width group rows (`grouping.display: 'row'`). Without one — or with the default cell-row
	 * display — the grid draws group rows itself. A `grouping.rowRenderer` spec takes precedence. Receives the `GroupRenderContext`.
	 */
	groupRowRenderer?: (ctx: GroupRenderContext<TRowData>) => ReactNode;
	/** Detail rows (master-detail). Without one the grid draws a placeholder; `detail.renderer` takes precedence. */
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	/** Full-width total rows (`grouping.display: 'row'`); otherwise totals are cell rows drawn by the grid. */
	totalRowRenderer?: (ctx: GroupRenderContext<TRowData>) => ReactNode;
	sidebar?: GridSidebarConfig<TRowData>;
	enableChart?: boolean;
	/** Dragging a column header out of the grid hides the column. Default true. */
	dragOutHidesColumns?: boolean;
	autoRowHeight?: boolean;
}

function warnInitialOnlyGridViewProp(propName: string): void {
	console.warn(
		`[@eregister/wit-grid-react] Prop "${propName}" is initial-only for the current grid instance. ` +
			'Changing it after mount does not reconfigure the existing runtime. Remount or replace the grid api if you need the new value to take effect.'
	);
}

export function GridView<TRowData = unknown>({
	api,
	pinLeftColumns,
	pinRightColumns,
	pinTopRows = 0,
	pinBottomRows = 0,
	enableColumnReorder,
	enableNavigation = true,
	enableContextMenu = true,
	contextMenuOptions,
	onCellClick,
	onWriteBlocked,
	onCellValueChanged,
	navigationOptions = {},
	groupRowRenderer,
	detailRowRenderer,
	totalRowRenderer,
	sidebar,
	enableChart = false,
	dragOutHidesColumns = true,
	autoRowHeight,
}: GridViewProps<TRowData>) {
	const portalStore = useMemo(() => createPortalStore<TRowData>(), []);
	// Custom filter components render through the portal tree, so they keep the grid's React context.
	const filterMount = useMemo<AdapterFilterMount>(
		() => (container, render, params) => {
			portalStore.mountFilter(container, render(params));
			return () => portalStore.unmountFilter(container);
		},
		[portalStore]
	);
	// Custom sidebar panels (`renderPanel`) render through the portal tree too.
	const panelMount = useMemo<AdapterPanelMount>(
		() => (container, render, context) => {
			portalStore.mountFilter(container, render(context));
			return () => portalStore.unmountFilter(container);
		},
		[portalStore]
	);
	const sidebarRef = useRef(sidebar);
	sidebarRef.current = sidebar;
	const hasSidebar = sidebar != null;
	// Which full-width rows React draws: only kinds the user gave a renderer for. Core draws the rest.
	const userRowRenderersRef = useRef({ group: false, detail: false, total: false });
	userRowRenderersRef.current = { group: !!groupRowRenderer, detail: !!detailRowRenderer, total: !!totalRowRenderer };
	const containerRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<GridHostWithAdapter<TRowData> | null>(null);
	const [adapterHandle, setAdapterHandle] = useState<GridAdapterHandle<unknown> | null>(null);
	const warnedInitialOnlyPropsRef = useRef(new Set<string>());
	const sidebarDefaultOpenRef = useRef(sidebar?.defaultOpen);
	const sidebarInitialApiRef = useRef(api);

	if (sidebarInitialApiRef.current !== api) {
		sidebarInitialApiRef.current = api;
		sidebarDefaultOpenRef.current = sidebar?.defaultOpen;
		warnedInitialOnlyPropsRef.current.clear();
	}

	useEffect(() => {
		if (pinLeftColumns !== undefined || pinRightColumns !== undefined) {
			hostRef.current?.setViewportPins({
				left: pinLeftColumns ?? 0,
				right: pinRightColumns ?? 0,
				top: pinTopRows,
				bottom: pinBottomRows,
			});
		}
	}, [pinLeftColumns, pinRightColumns, pinTopRows, pinBottomRows]);

	useEffect(() => {
		if (enableColumnReorder !== undefined) {
			api.setColumnReorderEnabled(enableColumnReorder);
		}
	}, [api, enableColumnReorder]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const storePins = api.getPinnedColumns();
		const host = mountGridHost(api, container, {
			pins: {
				left: pinLeftColumns !== undefined ? pinLeftColumns : storePins.left,
				right: pinRightColumns !== undefined ? pinRightColumns : storePins.right,
				top: pinTopRows,
				bottom: pinBottomRows,
			},
			cellContent: {
				mountCellContent: (mount) => {
					const props = {
						value: mount.value,
						node: mount.node,
						col: mount.col,
						isEditing: mount.isEditing,
						isLoading: mount.isLoading,
						phase: mount.phase,
						isScrolling: mount.isScrolling,
						isFocused: mount.isFocused,
						isSelected: mount.isSelected,
						rowVersion: mount.rowVersion,
						physicalIdentity: {
							cellInstanceId: mount.cellInstanceId ?? '',
							rowSlotId: mount.rowSlotId,
							slotGeneration: mount.slotGeneration,
							rowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
							portalHostId: mount.portalHostId ?? '',
						},
					};
					if (hasImperativeRendererCapability(mount.col) && !mount.isEditing && portalStore.tryImperativeUpdate(mount.cellKey, props))
						return;
					portalStore.mountCell(mount.cellKey, mount.container, props);
				},
				unmountCellContent: (unmount) => {
					portalStore.unmountCell(unmount.cellKey, unmount.container, unmount.flushSync ?? false, {
						cellInstanceId: unmount.cellInstanceId ?? '',
						rowSlotId: unmount.rowSlotId,
						slotGeneration: unmount.slotGeneration,
						rowBindingGeneration: unmount.cellRowBindingGeneration ?? 0,
						portalHostId: unmount.portalHostId ?? '',
					});
				},
				flushCellContent: () => {},
			},
			rowContent: {
				rendersRow: (row) => (userRowRenderersRef.current as Record<string, boolean>)[row.kind] ?? false,
				mountRowContent: (mount) => {
					portalStore.mountRow(mount.rowKey, mount.container, mount.visualRow, mount.renderer, mount.context);
				},
				unmountRowContent: (unmount) => {
					portalStore.unmountRow(unmount.rowKey, unmount.container);
				},
			},
			mountFilter: filterMount,
			sidebar: sidebarRef.current as CoreGridSidebarConfig<TRowData> | undefined,
			mountPanel: panelMount,
			chart: enableChart,
			dragOutHidesColumns,
			headerMenu: {
				mountHeaderMenu: (mount) => {
					portalStore.mountMenu(mount.colField, mount.container, mount.column, mount.close);
				},
				unmountHeaderMenu: (unmount) => {
					portalStore.unmountMenu(unmount.colField, unmount.container);
				},
			},
			autoRowHeight,
		});
		hostRef.current = host;
		setAdapterHandle(host.adapterHandle as GridAdapterHandle<unknown>);
		const interactionBinding = bindGridInteractionSurface(api, {
			container: host.gridElement,
			adapterHandle: host.adapterHandle,
			getNavigationEnabled: () => !!enableNavigationRef.current,
			isContextMenuEnabled: () => !!enableContextMenuRef.current && !!contextMenuRef.current,
			showContextMenu: (pointer, clientX, clientY) => {
				contextMenuRef.current?.showPointer(pointer, clientX, clientY);
			},
			onCellClick: (params) => {
				onCellClickRef.current?.(params);
			},
		});
		interactionBindingRef.current = interactionBinding;
		interactionBinding.updateOptions({
			editTrigger: navigationOptions.editTrigger ?? 'doubleClick',
			arrowKeyNavigationEdit: navigationOptions.arrowKeyNavigationEdit ?? false,
		});

		return () => {
			if (interactionBindingRef.current === interactionBinding) {
				interactionBindingRef.current = null;
			}
			interactionBinding.destroy();
			hostRef.current = null;
			setAdapterHandle(null);
			host.destroy();
			portalStore.clear(true);
		};
	}, [api, portalStore, hasSidebar, enableChart, dragOutHidesColumns]);

	useEffect(() => {
		if (sidebar) hostRef.current?.setSidebar(sidebar as CoreGridSidebarConfig<TRowData>);
	}, [sidebar]);

	const contextMenuOptionsRef = useRef(contextMenuOptions);
	contextMenuOptionsRef.current = contextMenuOptions;
	const contextMenuRef = useRef<GridContextMenuHandle<TRowData> | null>(null);

	useEffect(() => {
		if (!enableContextMenu) {
			contextMenuRef.current = null;
			return;
		}
		const plugin = registerGridContextMenu<TRowData>(api, contextMenuOptions);
		contextMenuRef.current = plugin;

		return () => {
			if (contextMenuRef.current === plugin) {
				contextMenuRef.current = null;
			}
			plugin.dispose();
		};
	}, [api, enableContextMenu]);

	useEffect(() => {
		contextMenuRef.current?.setOptions(contextMenuOptionsRef.current ?? {});
	}, [contextMenuOptions]);

	const interactionBindingRef = useRef<GridInteractionSurfaceBinding | null>(null);
	const onCellClickRef = useRef(onCellClick);
	onCellClickRef.current = onCellClick;
	const enableNavigationRef = useRef(enableNavigation);
	enableNavigationRef.current = enableNavigation;
	const enableContextMenuRef = useRef(enableContextMenu);
	enableContextMenuRef.current = enableContextMenu;

	useEffect(() => {
		interactionBindingRef.current?.updateOptions({
			editTrigger: navigationOptions.editTrigger ?? 'doubleClick',
			arrowKeyNavigationEdit: navigationOptions.arrowKeyNavigationEdit ?? false,
		});
	}, [navigationOptions.arrowKeyNavigationEdit, navigationOptions.editTrigger]);

	useEffect(() => {
		let cancelFlash: (() => void) | undefined;
		const unsub = api.addEventListener(GridEventName.cellsCopied, ({ payload }) => {
			const container = hostRef.current?.gridElement ?? containerRef.current;
			if (!container) return;
			cancelFlash?.();
			cancelFlash = flashCopiedCells(container, payload.cells);
		});
		return () => {
			unsub();
			cancelFlash?.();
		};
	}, [api]);

	useEffect(() => {
		if (!onWriteBlocked) return;
		return api.addEventListener(GridEventName.writeBlocked, ({ payload }) => {
			onWriteBlocked(payload);
		});
	}, [api, onWriteBlocked]);

	useEffect(() => {
		if (!onCellValueChanged) return;
		return api.addEventListener(GridEventName.cellValueChanged, ({ payload }) => {
			onCellValueChanged(payload);
		});
	}, [api, onCellValueChanged]);

	useEffect(() => {
		const initialValue = sidebarDefaultOpenRef.current;
		const currentValue = sidebar?.defaultOpen;
		if (Object.is(initialValue, currentValue)) return;
		if (warnedInitialOnlyPropsRef.current.has('sidebar.defaultOpen')) return;
		warnedInitialOnlyPropsRef.current.add('sidebar.defaultOpen');
		warnInitialOnlyGridViewProp('sidebar.defaultOpen');
	}, [api, sidebar?.defaultOpen]);

	const gridPane = (
		<div ref={containerRef} tabIndex={-1} style={{ width: '100%', height: '100%', position: 'relative' }}>
			<PortalManager
				store={portalStore}
				api={api}
				groupRowRenderer={groupRowRenderer}
				detailRowRenderer={detailRowRenderer}
				totalRowRenderer={totalRowRenderer}
			/>
		</div>
	);

	return (
		<GridAdapterContext.Provider value={adapterHandle}>
			<GridFilterMountContext.Provider value={filterMount}>{gridPane}</GridFilterMountContext.Provider>
		</GridAdapterContext.Provider>
	);
}
