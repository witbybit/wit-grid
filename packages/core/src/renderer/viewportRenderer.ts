import { PresenceLayer } from './presenceLayer.js';
import { ConditionalFormatPainter, registerConditionalFormatPainter, unregisterConditionalFormatPainter } from '../styling/conditionalFormat.js';
import { isHierarchyActive } from '../rows/hierarchyConfig.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import { CORE_STYLES } from './styles.js';
import { CELL_STYLES } from '../cells/cellStyles.js';
import { SIDEBAR_STYLES } from '../sidebar/sidebarStyles.js';
import { CHART_STYLES } from '../charts/chartStyles.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { LAYER_REGISTRY } from './layerRegistry.js';
import type { BuiltInThemeName, ThemeTokens } from './themes.js';
import { ThemeManager, DARK_THEME, getBuiltInTheme, isBuiltInThemeName } from './themes.js';

export class ViewportRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;

	public container: HTMLElement | null = null;
	private lastAriaRowCount = -1;
	private lastAriaColCount = -1;
	private lastActiveDescendantId: string | null = null;
	public scrollViewport: HTMLDivElement | null = null;

	// Single rows container — all row elements live here (no separate left/right layers)
	public rowsContainer: HTMLDivElement | null = null;

	// Zero-height sticky bands holding viewport-pinned top / bottom rows.
	public pinnedTopLayer: HTMLDivElement | null = null;
	public pinnedBottomLayer: HTMLDivElement | null = null;

	// Group panel — optional sticky strip above the header for groupBy chips.
	// Only present in the DOM; shown/hidden by syncLayoutPlan().
	public groupPanel: HTMLDivElement | null = null;

	// Filter chip bar — shown when any filterModel entries are active.
	public filterChipBar: HTMLDivElement | null = null;

	// Header layers — kept as three overlapping absolute divs inside a sticky wrapper
	public headerWrapper: HTMLDivElement | null = null;
	public headerLayer: HTMLDivElement | null = null;
	public headerLeftLayer: HTMLDivElement | null = null;
	public headerRightLayer: HTMLDivElement | null = null;

	// Floating filter layers — mirror of the header's three-lane pattern
	public floatingFilterWrapper: HTMLDivElement | null = null;
	public floatingFilterLayer: HTMLDivElement | null = null;
	public floatingFilterLeftLayer: HTMLDivElement | null = null;
	public floatingFilterRightLayer: HTMLDivElement | null = null;

	// Overlay sits outside the scroll viewport so it covers the full grid without scrolling
	public overlayLayer: HTMLDivElement | null = null;

	private styleTag: HTMLStyleElement | null = null;
	private layoutPlan: GridLayoutPlan | null = null;
	private themeManager: ThemeManager | null = null;
	private themeSelector = '';
	private static nextThemeScopeId = 0;

	// All registry-built layers, keyed by descriptor id. Named fields above are
	// assigned from this map after mount for the renderers that hold references.
	private readonly layers = new Map<string, HTMLDivElement>();

	// Every plan scalar the container custom properties and layer `apply()` descriptors read.
	// None of them depend on scroll position, so on a scroll frame they are almost always
	// unchanged; comparing them lets syncLayoutPlan skip ~30 style writes per frame.
	private readonly appliedLayoutScalars: number[] = [];
	private hasAppliedLayout = false;

	constructor(engine: GridEngine<TRowData>, geometryController: GeometryController<TRowData>) {
		this.engine = engine;
		this.geometryController = geometryController;
	}

	public mount(container: HTMLElement): void {
		this.container = container;
		this.injectStyles();
		this.container.classList.add('og-grid-container');
		// ARIA grid root. Row/col counts are kept current in syncLayoutPlan().
		this.container.setAttribute('role', 'grid');
		this.container.setAttribute('aria-multiselectable', 'true');

		const stateThemeName = this.engine.getState().themeName;
		const initialThemeName: BuiltInThemeName = isBuiltInThemeName(stateThemeName ?? '') ? stateThemeName : 'dark';
		const themeScopeId = ++ViewportRenderer.nextThemeScopeId;
		this.container.dataset.ogThemeScope = String(themeScopeId);
		this.themeSelector = `[data-og-theme-scope="${themeScopeId}"]`;

		// Resolve base theme + any initial overrides atomically, before ThemeManager exists — no
		// separate imperative mergeTheme() call is needed (or even possible) to get overrides onto
		// the very first paint. This makes initialState.themeOverrides work identically for every
		// adapter (React, vanilla, or otherwise), not just ones that happen to apply overrides in
		// the right effect-timing window.
		const themeOverrides = this.engine.getState().themeOverrides;
		const initialTheme = themeOverrides ? { ...getBuiltInTheme(initialThemeName), ...themeOverrides } : getBuiltInTheme(initialThemeName);

		// Initialize theme manager with grid-scoped CSS variables.
		this.themeManager = new ThemeManager(initialTheme, initialThemeName);
		this.themeManager.mount(this.themeSelector);

		// Single scroll container — the only element that has overflow:auto. This and the
		// grid container are the two DOM roots the layer registry parents layers onto.
		this.scrollViewport = document.createElement('div');
		this.scrollViewport.className = 'og-scroll-viewport';
		this.container.appendChild(this.scrollViewport);

		this.buildLayers();
		this.mountConditionalFormatting(container);
		this.mountPresence();
	}

	private presenceLayer: PresenceLayer | null = null;

	private mountPresence(): void {
		const layer = this.layers.get('presence');
		if (!layer) return;
		const engine = this.engine;
		this.presenceLayer = new PresenceLayer(
			engine.presence,
			() => {
				const model = engine.getRowModel();
				const geometry = engine.geometry;
				return {
					getVisualIndexByRowId: (rowId) => model?.getVisualIndexByRowId(rowId) ?? -1,
					getVisualRowCount: () => model?.getVisualRowCount() ?? 0,
					getColumnIndex: (field) => engine.getColumnIndex(field),
					rowTops: geometry.rowTops,
					rowHeights: geometry.rowHeights,
					colLefts: geometry.colLefts,
					colWidths: geometry.colWidths,
				};
			},
			layer
		);
	}

	private mountConditionalFormatting(container: HTMLElement): void {
		const engine = this.engine;
		const painter = new ConditionalFormatPainter(
			{
				getRules: () => engine.getState().styleRules,
				getValue: (rowId, field) => engine.getComputedCellValue(rowId, field),
				getVersion: () => engine.getDomainVersions().rows + engine.getState().globalVersion,
				forEachDisplayedRowId: (visit) => {
					const model = engine.getRowModel();
					if (!model || model.kind !== 'client') return false;
					const count = model.getVisualRowCount();
					for (let i = 0; i < count; i++) {
						const row = model.getVisualRow(i);
						if (row?.kind === 'data') visit(row.rowId);
					}
					return true;
				},
			},
			container
		);
		registerConditionalFormatPainter(container, painter);
	}

	/**
	 * Build every structural layer from LAYER_REGISTRY. Layers are created first, then
	 * appended parent-before-child so a layer can parent onto another layer's id. Within
	 * a parent, siblings append in ascending `order`. Named fields (rowsContainer,
	 * headerLayer, …) are bound from the resulting map for renderers that hold refs.
	 */
	private buildLayers(): void {
		this.layers.clear();
		this.hasAppliedLayout = false;
		for (const d of LAYER_REGISTRY) {
			const el = document.createElement('div');
			el.className = d.className;
			d.init?.(el);
			this.layers.set(d.id, el);
		}

		const ordered = [...LAYER_REGISTRY].sort((a, b) => a.order - b.order);
		const placed = new Set<string>(['scroll-viewport', 'container']);
		let remaining = ordered.length;
		// Resolve in passes: append a layer only once its parent exists in the DOM.
		while (remaining > 0) {
			let progressed = false;
			for (const d of ordered) {
				if (placed.has(d.id) || !placed.has(d.parent)) continue;
				const parent =
					d.parent === 'scroll-viewport' ? this.scrollViewport : d.parent === 'container' ? this.container : this.layers.get(d.parent);
				parent?.appendChild(this.layers.get(d.id)!);
				placed.add(d.id);
				progressed = true;
				remaining--;
			}
			if (!progressed) break; // guards against a descriptor referencing an unknown parent
		}

		this.groupPanel = this.layers.get('group-panel') ?? null;
		this.filterChipBar = this.layers.get('filter-chip-bar') ?? null;
		this.headerWrapper = this.layers.get('header-wrapper') ?? null;
		this.headerLayer = this.layers.get('header') ?? null;
		this.headerLeftLayer = this.layers.get('header-left') ?? null;
		this.headerRightLayer = this.layers.get('header-right') ?? null;
		this.floatingFilterWrapper = this.layers.get('floating-filter-wrapper') ?? null;
		this.floatingFilterLayer = this.layers.get('floating-filter') ?? null;
		this.floatingFilterLeftLayer = this.layers.get('floating-filter-left') ?? null;
		this.floatingFilterRightLayer = this.layers.get('floating-filter-right') ?? null;
		this.rowsContainer = this.layers.get('rows') ?? null;
		this.pinnedTopLayer = this.layers.get('pinned-top') ?? null;
		this.pinnedBottomLayer = this.layers.get('pinned-bottom') ?? null;
		this.overlayLayer = this.layers.get('overlay') ?? null;
	}

	/** Look up a registry-built layer element by descriptor id. */
	public getLayer(id: string): HTMLDivElement | null {
		return this.layers.get(id) ?? null;
	}

	public unmount(): void {
		this.presenceLayer?.dispose();
		this.presenceLayer = null;
		if (this.container) unregisterConditionalFormatPainter(this.container);
		this.themeManager?.unmount();
		this.themeManager = null;

		if (this.container) {
			this.container.classList.remove('og-grid-container');
			this.container.removeAttribute('role');
			this.container.removeAttribute('aria-multiselectable');
			this.container.removeAttribute('aria-rowcount');
			this.container.removeAttribute('aria-colcount');
			delete this.container.dataset.ogThemeScope;
			this.container.textContent = '';
		}
		this.lastAriaRowCount = -1;
		this.lastAriaColCount = -1;
		this.lastActiveDescendantId = null;
		if (this.styleTag && this.styleTag.parentNode) {
			this.styleTag.remove();
		}
		this.container = null;
		this.scrollViewport = null;
		this.rowsContainer = null;
		this.pinnedTopLayer = null;
		this.pinnedBottomLayer = null;
		this.groupPanel = null;
		this.filterChipBar = null;
		this.headerWrapper = null;
		this.headerLayer = null;
		this.headerLeftLayer = null;
		this.headerRightLayer = null;
		this.floatingFilterWrapper = null;
		this.floatingFilterLayer = null;
		this.floatingFilterLeftLayer = null;
		this.floatingFilterRightLayer = null;
		this.overlayLayer = null;
		this.styleTag = null;
		this.layers.clear();
		this.hasAppliedLayout = false;
	}

	private lastScrolledLeft = false;
	private lastScrolledRight = false;

	/** A scroll event read the position since the last DOM sync (the engine holds it); a programmatic scroll clears it. */
	private eventReadFresh = false;
	/** A DOM sync ran in the current task (one frame flush); cleared on a microtask after it. */
	private frameReadFresh = false;

	/** The scroll event handler read scrollTop/scrollLeft and handed them to the engine. */
	public notePositionFromScrollEvent(): void {
		this.eventReadFresh = true;
	}

	/** The grid moved the scroll position itself: the next sync must read the DOM. */
	public invalidatePositionReads(): void {
		this.eventReadFresh = false;
		this.frameReadFresh = false;
	}

	/**
	 * Reads the scroll position and viewport width into the engine. Reading after DOM writes forces a
	 * synchronous layout, so a caller may reuse a read the engine already holds: `'event'` one made by
	 * the scroll event since the last sync (it ran before this frame's writes), `'frame'` one made
	 * earlier in this frame flush. Width changes come from resizes and full paints, which read.
	 */
	public syncViewportScrollFromDom(reuse: 'none' | 'event' | 'frame' = 'none'): void {
		if (!this.scrollViewport) return;
		if ((reuse === 'event' && this.eventReadFresh) || (reuse === 'frame' && this.frameReadFresh)) {
			this.eventReadFresh = false;
			this.markFrameRead();
			const viewport = this.engine.viewport;
			this.syncHorizontalScrollEdges(viewport.scrollLeft, viewport.scrollViewportClientWidth || viewport.viewportWidth);
			return;
		}
		const clientWidth = this.scrollViewport.clientWidth || this.engine.viewport.viewportWidth;
		const scrollLeft = this.scrollViewport.scrollLeft;
		this.engine.viewport.setScrollViewportClientWidth(clientWidth);
		this.engine.viewport.setScrollPosition(this.scrollViewport.scrollTop, scrollLeft);
		this.syncHorizontalScrollEdges(scrollLeft, clientWidth);
		this.eventReadFresh = false;
		this.markFrameRead();
	}

	private markFrameRead(): void {
		if (this.frameReadFresh) return;
		this.frameReadFresh = true;
		queueMicrotask(() => (this.frameReadFresh = false));
	}

	/**
	 * Pinned lanes cast their edge shadow only while content is scrolled under them: og-scrolled-left
	 * when content has scrolled under the left lane, og-scrolled-right while more lies under the right
	 * one. From values already read this frame; classes written only on change.
	 */
	private syncHorizontalScrollEdges(scrollLeft: number, clientWidth: number): void {
		if (!this.container) return;
		const scrolledLeft = scrollLeft > 0;
		const totalWidth = this.engine.geometry.getTotalWidth(this.engine.stateManager.getState().defaultColWidth);
		const scrolledRight = scrollLeft + clientWidth < totalWidth - 1;
		if (scrolledLeft !== this.lastScrolledLeft) {
			this.lastScrolledLeft = scrolledLeft;
			this.container.classList.toggle('og-scrolled-left', scrolledLeft);
		}
		if (scrolledRight !== this.lastScrolledRight) {
			this.lastScrolledRight = scrolledRight;
			this.container.classList.toggle('og-scrolled-right', scrolledRight);
		}
	}

	/**
	 * Toggle the container-level scrolling marker class. CSS uses it to disable row
	 * hover matching and background transitions during scroll — both trigger style
	 * recalc/paint work per frame as the cursor sweeps moving rows.
	 */
	public setScrollingClass(scrolling: boolean): void {
		this.container?.classList.toggle('og-is-scrolling', scrolling);
	}

	/**
	 * Records the plan's layout scalars and reports whether any differ from the last applied set.
	 * Keep in sync with the fields read below and by LAYER_REGISTRY `apply()` descriptors.
	 */
	private layoutScalarsChanged(plan: GridLayoutPlan): boolean {
		const { chrome, origins, dimensions, columns } = plan;
		let changed = !this.hasAppliedLayout;
		// Each call runs unconditionally (call first, then `||`) so every slot stays current.
		changed = this.recordLayoutScalar(0, chrome.leafHeaderHeight) || changed;
		changed = this.recordLayoutScalar(1, chrome.totalHeaderHeight) || changed;
		changed = this.recordLayoutScalar(2, chrome.groupPanelHeight) || changed;
		changed = this.recordLayoutScalar(3, chrome.filterChipBarHeight) || changed;
		changed = this.recordLayoutScalar(4, chrome.floatingFilterHeight) || changed;
		changed = this.recordLayoutScalar(5, chrome.statusBarHeight) || changed;
		changed = this.recordLayoutScalar(6, chrome.paginationHeight) || changed;
		changed = this.recordLayoutScalar(7, chrome.bottomChromeHeight) || changed;
		changed = this.recordLayoutScalar(8, origins.headerTop) || changed;
		changed = this.recordLayoutScalar(9, origins.overlayTop) || changed;
		changed = this.recordLayoutScalar(10, origins.stickyGroupLayerTop) || changed;
		changed = this.recordLayoutScalar(11, origins.statusBarTop) || changed;
		changed = this.recordLayoutScalar(12, origins.paginationTop) || changed;
		changed = this.recordLayoutScalar(13, dimensions.contentWidth) || changed;
		changed = this.recordLayoutScalar(14, dimensions.contentHeight) || changed;
		changed = this.recordLayoutScalar(15, columns.pinLeftWidth) || changed;
		changed = this.recordLayoutScalar(16, columns.pinRightWidth) || changed;
		this.hasAppliedLayout = true;
		return changed;
	}

	private recordLayoutScalar(index: number, value: number): boolean {
		if (this.appliedLayoutScalars[index] === value) return false;
		this.appliedLayoutScalars[index] = value;
		return true;
	}

	public syncLayoutPlan(plan: GridLayoutPlan): void {
		this.layoutPlan = plan;
		this.presenceLayer?.sync(plan);

		this.syncAriaCounts();

		// Layout styles are a pure function of the scalars above; skip every write when none moved.
		if (!this.layoutScalarsChanged(plan)) return;

		// Container-level CSS custom properties (consumed by stylesheet rules, not a layer).
		this.container?.style.setProperty('--og-leaf-header-height', `${plan.chrome.leafHeaderHeight}px`);
		this.container?.style.setProperty('--og-total-header-height', `${plan.chrome.totalHeaderHeight}px`);
		this.container?.style.setProperty('--og-group-panel-height', `${plan.chrome.groupPanelHeight}px`);
		this.container?.style.setProperty('--og-floating-filter-height', `${plan.chrome.floatingFilterHeight}px`);
		this.container?.style.setProperty('--og-overlay-top', `${plan.origins.overlayTop}px`);
		this.container?.style.setProperty('--og-bottom-chrome-height', `${plan.chrome.bottomChromeHeight}px`);
		this.container?.style.setProperty('--og-content-width', `${plan.dimensions.contentWidth}px`);

		// Every structural layer positions itself from the plan via its descriptor.
		for (const d of LAYER_REGISTRY) {
			if (!d.apply) continue;
			const el = this.layers.get(d.id);
			if (el) d.apply(el, plan);
		}
	}

	private lastAriaRole = 'grid';

	private syncAriaCounts(): void {
		// ARIA counts — guarded so we only touch the DOM when they actually change.
		if (this.container) {
			const role = isHierarchyActive(this.engine.stateManager.getState()) ? 'treegrid' : 'grid';
			if (this.lastAriaRole !== role) {
				this.lastAriaRole = role;
				this.container.setAttribute('role', role);
			}
			const rowCount = this.engine.getRowModel()?.getVisualRowCount() ?? 0;
			const colCount = this.engine.columns.getCompiledPlan().displayedColumns.length;
			if (this.lastAriaRowCount !== rowCount) {
				this.lastAriaRowCount = rowCount;
				this.container.setAttribute('aria-rowcount', String(rowCount));
			}
			if (this.lastAriaColCount !== colCount) {
				this.lastAriaColCount = colCount;
				this.container.setAttribute('aria-colcount', String(colCount));
			}
		}
	}

	public syncActiveDescendant(cell: HTMLElement | null): void {
		if (!this.container) return;
		const nextId = cell?.id ?? null;
		if (this.lastActiveDescendantId === nextId) return;
		this.lastActiveDescendantId = nextId;
		if (nextId) this.container.setAttribute('aria-activedescendant', nextId);
		else this.container.removeAttribute('aria-activedescendant');
	}

	public getLayoutPlan(): GridLayoutPlan | null {
		return this.layoutPlan;
	}

	/**
	 * Get the theme manager instance for runtime theme switching.
	 * Useful for exposing theme control to the application.
	 */
	public getThemeManager(): ThemeManager | null {
		return this.themeManager;
	}

	/**
	 * Set a custom theme immediately.
	 */
	public setTheme(theme: ThemeTokens): void {
		this.themeManager?.setTheme(theme, this.themeSelector);
	}

	/**
	 * Switch to a built-in theme by name (e.g., 'light', 'dark', 'cool-blue').
	 */
	public switchTheme(themeName: string): void {
		if (!isBuiltInThemeName(themeName)) return;
		this.themeManager?.switchTheme(themeName, this.themeSelector);
	}

	/**
	 * Get the currently active theme.
	 */
	public getTheme(): ThemeTokens {
		return this.themeManager?.getTheme() ?? DARK_THEME;
	}

	public getThemeName(): BuiltInThemeName | null {
		return this.themeManager?.getThemeName() ?? null;
	}

	/**
	 * Subscribe to theme changes.
	 * Returns an unsubscribe function.
	 */
	public mergeTheme(partial: Partial<ThemeTokens>): void {
		this.themeManager?.mergeTheme(partial, this.themeSelector);
	}

	public onThemeChange(listener: (theme: ThemeTokens) => void): () => void {
		return this.themeManager?.onThemeChange(listener) ?? (() => {});
	}

	private injectStyles(): void {
		if (typeof document === 'undefined') return;
		this.styleTag = document.createElement('style');
		this.styleTag.textContent = CORE_STYLES + CELL_STYLES + SIDEBAR_STYLES + CHART_STYLES;
		document.head.appendChild(this.styleTag);
	}
}
