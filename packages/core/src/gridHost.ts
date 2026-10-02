import { RenderEngine } from './renderer/renderEngine.js';
import type { RenderStats } from './renderer/renderTelemetry.js';
import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
} from './renderer/IGridRenderer.js';
import type { CellState, GridApi, GridCellAccess, GridCellPointer } from './api/GridApi.js';
import type { GridCellClickParams } from './api/GridApi.js';
import type { ColumnDef, ColumnInstanceId, InternalColumnDef } from './columnDef.js';
import { resolveGridInteractionController, resolveGridRuntimeComposition } from './internal/apiInternalBridge.js';
import { createGridInteractionEventRouter } from './interaction/GridInteractionEventRouter.js';
import type { GridNavigationOptions } from './interaction/GridInteractionController.js';
import type { VisualRow } from './visualRow.js';
import type { BuiltInThemeName, ThemeTokens } from './renderer/themes.js';

export function hasImperativeRendererCapability<TRowData = unknown>(column: ColumnDef<TRowData>): boolean {
	const caps = (column as InternalColumnDef<TRowData>).cellRendererCapabilities;
	return caps?.imperative === true;
}

export interface GridCellContentAdapter<TRowData = unknown> {
	mountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	unmountCellContent?: (unmount: GridCellContentUnmount) => void;
	flushCellContent?: (flush: { flushSync?: boolean }) => void;
}

export interface GridRowContentAdapter<TRowData = unknown> {
	mountRowContent?: (mount: GridRowContentMount<TRowData>) => void;
	unmountRowContent?: (unmount: GridRowContentUnmount) => void;
	/**
	 * Which full-width rows (detail, full-width group / total, failed, placeholder) the adapter draws
	 * with its own renderers. Rows it does not draw get core's built-in renderers. Unset: all.
	 */
	rendersRow?: (row: VisualRow<TRowData>) => boolean;
}

export interface GridHeaderMenuAdapter<TRowData = unknown> {
	mountHeaderMenu?: (mount: GridHeaderMenuMount<TRowData>) => void;
	unmountHeaderMenu?: (unmount: GridHeaderMenuUnmount) => void;
}

export interface GridHostOptions<TRowData = unknown> {
	pins?: {
		left?: number;
		right?: number;
		top?: number;
		bottom?: number;
	};
	cellContent?: GridCellContentAdapter<TRowData>;
	rowContent?: GridRowContentAdapter<TRowData>;
	headerMenu?: GridHeaderMenuAdapter<TRowData>;
	autoRowHeight?: boolean;
}

export interface GridHost {
	setViewportPins(pins: NonNullable<GridHostOptions['pins']>): void;
	schedulePaint(): void;
	scheduleFullPaint(reason?: string): void;
	scheduleViewportPaint(reason?: string): void;
	scheduleHeaderPaint(reason?: string): void;
	scheduleOverlayPaint(reason?: string): void;
	scheduleGeometryPaint(reason?: string): void;
	getRenderStats(): RenderStats;
	resetRenderStats(): void;
	/** Set a custom theme immediately. */
	setTheme(theme: ThemeTokens): void;
	/** Switch to a built-in theme by name. */
	switchTheme(themeName: string): void;
	/** Get the currently active theme. */
	getTheme(): ThemeTokens;
	/** Get the active built-in theme name, or null for a custom theme. */
	getThemeName(): BuiltInThemeName | null;
	/** List supported built-in theme names. */
	getAvailableThemes(): BuiltInThemeName[];
	/** Subscribe to theme changes. Returns an unsubscribe function. */
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;
	destroy(): void;
}

export interface GridAdapterHandle<TRowData = unknown> {
	/** Resolve the bound cell pointer from a DOM element inside a cell. */
	getCellPointerFromElement(element: Element): GridCellPointer | null;
	/** Get lightweight cell state by logical cell pointer. */
	getCellStateByPointer(pointer: GridCellPointer): CellState | null;
	/** Get full cell access data from a DOM element inside a cell. */
	getCellAccessFromElement(element: Element): GridCellAccess<TRowData> | null;
	/** Get full cell access data by logical cell pointer. */
	getCellAccessByPointer(pointer: GridCellPointer): GridCellAccess<TRowData> | null;
	/** Get full cell access data by row id and column field. */
	getCellAccess(rowId: string, colField: string): GridCellAccess<TRowData> | null;
	/** Returns true when the column uses the imperative-update renderer protocol. */
	isImperativeRendererColumn(column: ColumnDef<TRowData>): boolean;
}

export type GridHostWithAdapter<TRowData = unknown> = GridHost & { adapterHandle: GridAdapterHandle<TRowData> };

export interface GridInteractionSurfaceBinding {
	updateOptions(options: GridNavigationOptions): void;
	destroy(): void;
}

export interface GridInteractionSurfaceOptions<TRowData = unknown> {
	container: HTMLElement;
	adapterHandle: GridAdapterHandle<TRowData>;
	getNavigationEnabled(): boolean;
	isContextMenuEnabled(): boolean;
	showContextMenu(pointer: GridCellPointer, clientX: number, clientY: number): void;
	onCellClick?(params: GridCellClickParams<TRowData>): void;
}

export function bindGridInteractionSurface<TRowData>(
	api: GridApi<TRowData>,
	options: GridInteractionSurfaceOptions<TRowData>
): GridInteractionSurfaceBinding {
	const interactionController = resolveGridInteractionController(api);
	const router = createGridInteractionEventRouter<TRowData>({
		getApi: () => api,
		getInteraction: () => (options.getNavigationEnabled() ? interactionController : null),
		isEventWithinGrid: (target) => {
			if (!(target instanceof HTMLElement)) return false;
			return target.closest('.og-grid-container') === options.container;
		},
		resolveCellTarget: (event) => {
			const cellEl = (event.target as HTMLElement).closest('.og-cell') as HTMLElement | null;
			if (!cellEl || cellEl.closest('.og-grid-container') !== options.container) return null;
			const pointer = options.adapterHandle.getCellPointerFromElement(cellEl);
			if (!pointer) return null;
			const access = options.adapterHandle.getCellAccessByPointer(pointer);
			return { cellEl, pointer, access };
		},
		focusCellElement: (cellEl) => {
			cellEl.tabIndex = -1;
			cellEl.focus();
		},
		isContextMenuEnabled: () => options.isContextMenuEnabled(),
		showContextMenu: (pointer, clientX, clientY) => {
			options.showContextMenu(pointer, clientX, clientY);
		},
		onCellClick: (params) => {
			options.onCellClick?.(params);
		},
	});
	const unbind = router.bind(options.container);
	return {
		updateOptions(nextOptions) {
			interactionController.updateOptions(nextOptions);
		},
		destroy() {
			unbind();
		},
	};
}

export function mountGridHost<TRowData>(
	api: GridApi<TRowData>,
	container: HTMLElement,
	options: GridHostOptions<TRowData> = {}
): GridHostWithAdapter<TRowData> {
	const runtime = resolveGridRuntimeComposition(api);
	const host = runtime.host;
	const engine = host.engine;
	const internalApi = host.api;
	const renderEngine = new RenderEngine(engine, internalApi, runtime.interactionController);

	renderEngine.onMountCellContent = options.cellContent?.mountCellContent;
	renderEngine.onUnmountCellContent = options.cellContent?.unmountCellContent;
	renderEngine.portalMountManager.onFlushCellContent = options.cellContent?.flushCellContent;
	renderEngine.onMountRowContent = options.rowContent?.mountRowContent;
	renderEngine.onUnmountRowContent = options.rowContent?.unmountRowContent;
	renderEngine.portalMountManager.rendersRow = options.rowContent?.rendersRow;
	renderEngine.onMountHeaderMenu = options.headerMenu?.mountHeaderMenu;
	renderEngine.onUnmountHeaderMenu = options.headerMenu?.unmountHeaderMenu;
	if (options.autoRowHeight) renderEngine.setAutoRowHeight(true);

	// Bind live runtime ports — exclusive: only one host may be active at a time.
	const bindResult = internalApi.bindRuntimePorts({
		renderer: {
			requestRender: () => {},
			getStats: () => renderEngine.getRenderStats(),
			resetStats: () => renderEngine.resetRenderStats(),
			getContainer: () => container,
			scrollCellIntoView: (rowId, colField) => renderEngine.scrollCellIntoView(rowId, colField),
			scrollRowIntoView: (rowId) => renderEngine.scrollRowIntoView(rowId),
		},
		theme: {
			getTheme: () => renderEngine.viewportRenderer.getTheme(),
			getThemeName: () => renderEngine.viewportRenderer.getThemeName(),
			getAvailableThemes: () => renderEngine.viewportRenderer.getThemeManager()?.getAvailableThemes() ?? [],
			switchTheme: (themeName) => renderEngine.viewportRenderer.switchTheme(themeName),
			mergeTheme: (partial) => {
				renderEngine.viewportRenderer.mergeTheme(partial);
				if ('leafHeaderHeight' in partial) {
					renderEngine.scheduleFullPaint('theme-layout');
				}
			},
			setTheme: (theme) => {
				renderEngine.viewportRenderer.setTheme(theme);
				// A full theme swap can change any token, including layout-affecting ones
				// (e.g. leafHeaderHeight) — always re-run layout, not just on mergeTheme's narrower check.
				renderEngine.scheduleFullPaint('theme-layout');
			},
			onThemeChange: (listener) => renderEngine.viewportRenderer.onThemeChange(listener),
		},
	});
	if (!bindResult.ok) {
		// Binding rejected — renderEngine was never mounted, so no DOM cleanup is needed.
		throw new Error(`mountGridHost: port binding rejected (${bindResult.reason}). Destroy the active host before mounting a new one.`);
	}
	const binding = bindResult.binding;

	if (options.pins) {
		internalApi.setViewportPins(options.pins);
	}

	host.setContainerElement(container);
	renderEngine.mount(container);

	const observer = new ResizeObserver((entries) => {
		if (!internalApi.isBindingCurrent(binding)) return;
		if (!entries || entries.length === 0) return;
		const { width, height } = entries[0].contentRect;
		if (internalApi.setViewportSize(width, height)) {
			internalApi.updateVisibleRanges();
			renderEngine.scheduleGeometryPaint('resize');
		}
	});
	observer.observe(container);

	const adapterHandle: GridAdapterHandle<TRowData> = {
		getCellPointerFromElement(element: Element) {
			const cellEl = element.closest('.og-cell') as HTMLElement | null;
			if (!cellEl) return null;
			const cellSlot = (
				cellEl as HTMLElement & {
					__cellSlot?: {
						binding?: { rowId: string; colId: string } | null;
						colField?: string;
						columnInstanceId?: ColumnInstanceId;
					};
				}
			).__cellSlot;
			const binding = cellSlot?.binding;
			const colField = cellSlot?.colField ?? cellEl.dataset.colField;
			const rowId = binding?.rowId ?? cellEl.dataset.rowId;
			if (!rowId || !colField) return null;
			return {
				rowId,
				colField,
				colId: binding?.colId ?? colField,
				columnInstanceId: cellSlot?.columnInstanceId,
			};
		},
		getCellAccessFromElement(element: Element) {
			const pointer = adapterHandle.getCellPointerFromElement(element);
			if (!pointer) return null;
			return internalApi.getCellAccessByPointer(pointer);
		},
		getCellStateByPointer(pointer: GridCellPointer) {
			return internalApi.getCellStateByPointer(pointer);
		},
		getCellAccessByPointer(pointer: GridCellPointer) {
			return internalApi.getCellAccessByPointer(pointer);
		},
		getCellAccess(rowId: string, colField: string) {
			return internalApi.getCellAccess(rowId, colField);
		},
		isImperativeRendererColumn(column) {
			return hasImperativeRendererCapability(column);
		},
	};

	return {
		setViewportPins(pins) {
			internalApi.setViewportPins(pins);
			internalApi.updateVisibleRanges();
			renderEngine.scheduleViewportPaint('pins');
			renderEngine.scheduleHeaderPaint('pins');
		},
		schedulePaint() {
			renderEngine.schedulePaint();
		},
		scheduleFullPaint(reason) {
			renderEngine.scheduleFullPaint(reason);
		},
		scheduleViewportPaint(reason) {
			renderEngine.scheduleViewportPaint(reason);
		},
		scheduleHeaderPaint(reason) {
			renderEngine.scheduleHeaderPaint(reason);
		},
		scheduleOverlayPaint(reason) {
			renderEngine.scheduleOverlayPaint(reason);
		},
		scheduleGeometryPaint(reason) {
			renderEngine.scheduleGeometryPaint(reason);
		},
		getRenderStats() {
			return renderEngine.getRenderStats();
		},
		resetRenderStats() {
			renderEngine.resetRenderStats();
		},
		setTheme(theme) {
			renderEngine.viewportRenderer.setTheme(theme);
		},
		switchTheme(themeName) {
			internalApi.switchTheme(themeName);
		},
		getTheme() {
			return renderEngine.viewportRenderer.getTheme();
		},
		getThemeName() {
			return renderEngine.viewportRenderer.getThemeName();
		},
		getAvailableThemes() {
			return renderEngine.viewportRenderer.getThemeManager()?.getAvailableThemes() ?? [];
		},
		onThemeChange(listener) {
			return renderEngine.viewportRenderer.onThemeChange(listener);
		},
		destroy() {
			observer.disconnect();
			renderEngine.unmount();
			internalApi.unbindRuntimePorts(binding);
		},
		adapterHandle,
	};
}
