import type { GridLayoutPlan } from './layoutPlan.js';

/**
 * Declarative DOM-layer registry.
 *
 * Every structural layer the grid mounts is described here once: its class, its
 * parent, its sibling order, and a pure `apply(el, plan)` that positions/sizes it
 * from the layout plan — never from magic pixel constants. `ViewportRenderer` builds
 * the DOM by iterating this table and re-positions every layer by looping it again on
 * each `syncLayoutPlan`. New layers (status bar, pagination, find-bar, side panels)
 * slot in by adding a descriptor here plus a renderer — with no edits to the mount or
 * sync bodies.
 *
 * Invariants enforced by guard tests:
 *  - Every `.og-layer-*` element in the DOM corresponds to a registry entry.
 *  - No renderer sets a layer's structural top/height/width outside its `apply`.
 */

/** A parent is one of the two DOM roots, or another layer's `id`. */
/**
 * `--og-viewport-width`: the scrollport's visible width. Full-width row content (detail rows,
 * full-width group rows) is sized to it and pinned with `position: sticky; left: 0`, so it stays in
 * view during horizontal scroll instead of spanning (and sliding with) the whole content width.
 */
function setViewportWidthVar(el: HTMLElement, plan: GridLayoutPlan): void {
	const width = `${plan.viewport.clientWidth}px`;
	if (el.dataset.ogViewportWidth === width) return;
	el.dataset.ogViewportWidth = width;
	el.style.setProperty('--og-viewport-width', width);
}

export type LayerParentRef = 'scroll-viewport' | 'container' | string;

export interface LayerDescriptor {
	/** Stable id used for parent references and named lookup. */
	id: string;
	className: string;
	parent: LayerParentRef;
	/** Sibling order within the parent (ascending). */
	order: number;
	/** One-time inline setup at mount that does not depend on the plan. */
	init?(el: HTMLDivElement): void;
	/** Position/size purely from the layout plan. Runs on every syncLayoutPlan. */
	apply?(el: HTMLDivElement, plan: GridLayoutPlan): void;
}

export const LAYER_REGISTRY: LayerDescriptor[] = [
	{
		id: 'group-panel',
		className: 'og-group-panel',
		parent: 'scroll-viewport',
		order: 0,
		init(el) {
			el.style.display = 'none';
		},
		apply(el, plan) {
			const visible = plan.chrome.groupPanelHeight > 0;
			el.style.display = visible ? 'flex' : 'none';
			el.style.height = visible ? `${plan.chrome.groupPanelHeight}px` : '0';
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		id: 'filter-chip-bar',
		className: 'og-filter-chip-bar',
		parent: 'scroll-viewport',
		order: 1,
		init(el) {
			el.style.display = 'none';
		},
		apply(el, plan) {
			const visible = plan.chrome.filterChipBarHeight > 0;
			el.style.display = visible ? 'flex' : 'none';
			el.style.top = `${plan.chrome.groupPanelHeight}px`;
			el.style.height = visible ? `${plan.chrome.filterChipBarHeight}px` : '0';
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		id: 'header-wrapper',
		className: 'og-layer-header-wrapper',
		parent: 'scroll-viewport',
		order: 2,
		apply(el, plan) {
			el.style.top = `${plan.origins.headerTop}px`;
			el.style.height = `${plan.chrome.totalHeaderHeight}px`;
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		// Left pin lane is first in DOM so the flex row is: left | center | right.
		id: 'header-left',
		className: 'og-layer-header-left',
		parent: 'header-wrapper',
		order: 0,
		apply(el, plan) {
			const w = plan.columns.pinLeftWidth;
			el.style.width = `${w}px`;
			el.style.display = w > 0 ? '' : 'none';
		},
	},
	{
		// Center lane — flex:1 in CSS; no JS width needed.
		id: 'header',
		className: 'og-layer-header',
		parent: 'header-wrapper',
		order: 1,
	},
	{
		id: 'header-right',
		className: 'og-layer-header-right',
		parent: 'header-wrapper',
		order: 2,
		apply(el, plan) {
			const w = plan.columns.pinRightWidth;
			el.style.width = `${w}px`;
			el.style.display = w > 0 ? '' : 'none';
		},
	},
	// Floating filter row — always-visible inline filter inputs below the header.
	// Mirrors the header's three-lane pattern: center columns are horizontally virtualised,
	// pinned columns always rendered.
	{
		id: 'floating-filter-wrapper',
		className: 'og-layer-floating-filter-wrapper',
		parent: 'scroll-viewport',
		order: 3,
		init(el) {
			el.style.display = 'none';
		},
		apply(el, plan) {
			const visible = plan.chrome.floatingFilterHeight > 0;
			el.style.display = visible ? 'flex' : 'none';
			el.style.top = `${plan.origins.headerTop + plan.chrome.totalHeaderHeight}px`;
			el.style.height = `${plan.chrome.floatingFilterHeight}px`;
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		// Left pin lane is first in DOM so the flex row is: left | center | right.
		id: 'floating-filter-left',
		className: 'og-layer-floating-filter-left',
		parent: 'floating-filter-wrapper',
		order: 0,
		apply(el, plan) {
			const w = plan.columns.pinLeftWidth;
			el.style.width = `${w}px`;
			el.style.display = w > 0 ? '' : 'none';
		},
	},
	{
		// Center lane — flex:1 in CSS; no JS width needed.
		id: 'floating-filter',
		className: 'og-layer-floating-filter',
		parent: 'floating-filter-wrapper',
		order: 1,
	},
	{
		id: 'floating-filter-right',
		className: 'og-layer-floating-filter-right',
		parent: 'floating-filter-wrapper',
		order: 2,
		apply(el, plan) {
			const w = plan.columns.pinRightWidth;
			el.style.width = `${w}px`;
			el.style.display = w > 0 ? '' : 'none';
		},
	},
	{
		// Zero-height sticky band for viewport-pinned top rows. Slots in it are positioned at their
		// constant content offset; the compositor keeps the band stuck below the top chrome.
		id: 'pinned-top',
		className: 'og-layer-pinned-top',
		parent: 'scroll-viewport',
		order: 5,
		apply(el, plan) {
			el.style.width = `${plan.dimensions.contentWidth}px`;
			el.style.top = `${plan.origins.stickyGroupLayerTop}px`;
			setViewportWidthVar(el, plan);
		},
	},
	{
		id: 'rows',
		className: 'og-rows-container',
		parent: 'scroll-viewport',
		order: 6,
		apply(el, plan) {
			el.style.height = `${plan.dimensions.contentHeight}px`;
			el.style.width = `${plan.dimensions.contentWidth}px`;
			setViewportWidthVar(el, plan);
		},
	},
	{
		// Zero-height sticky band at the bottom edge of the scroll viewport for pinned bottom rows,
		// which sit at a constant negative offset above it.
		id: 'pinned-bottom',
		className: 'og-layer-pinned-bottom',
		parent: 'scroll-viewport',
		order: 7,
		apply(el, plan) {
			el.style.width = `${plan.dimensions.contentWidth}px`;
			setViewportWidthVar(el, plan);
		},
	},
	// Exit-animation overlay — holds short-lived clone "ghosts" of rows that left the model
	// (e.g. collapsed group children) while they fade out. Lives in the rows' content
	// coordinate space (ghosts carry their own translateY), is pointer-inert, and is purely
	// a CSS overlay — no plan-driven positioning, so no apply().
	{
		id: 'exiting',
		className: 'og-layer-exiting',
		parent: 'rows',
		order: 0,
	},
	// Peers' cell cursors and cell flashes (PresenceLayer): content coordinates like the rows.
	{
		id: 'presence',
		className: 'og-layer-presence',
		parent: 'rows',
		order: 1,
	},
	// A gallery or calendar view over the table's area; GridViewHost positions and fills it.
	{
		id: 'view',
		className: 'og-layer-view',
		parent: 'container',
		order: 1,
	},
	// The minimap strip beside the vertical scrollbar; MinimapLayer positions and draws it.
	{
		id: 'minimap',
		className: 'og-layer-minimap',
		parent: 'container',
		order: 1,
	},
	{
		id: 'overlay',
		className: 'og-layer-overlay',
		parent: 'container',
		order: 1,
		apply(el, plan) {
			el.style.top = `${plan.origins.overlayTop}px`;
		},
	},
	// Bottom chrome — fixed bars docked below the scroll viewport, parented to the grid
	// container (not the scroll viewport) so they never scroll. They occupy the space
	// the scroll viewport gives up via --og-bottom-chrome-height.
	{
		id: 'status-bar',
		className: 'og-layer-status-bar',
		parent: 'container',
		order: 2,
		apply(el, plan) {
			const visible = plan.chrome.statusBarHeight > 0;
			el.style.display = visible ? 'flex' : 'none';
			el.style.top = `${plan.origins.statusBarTop}px`;
			el.style.height = `${plan.chrome.statusBarHeight}px`;
		},
	},
	{
		id: 'pagination',
		className: 'og-layer-pagination',
		parent: 'container',
		order: 3,
		apply(el, plan) {
			const visible = plan.chrome.paginationHeight > 0;
			el.style.display = visible ? 'flex' : 'none';
			el.style.top = `${plan.origins.paginationTop}px`;
			el.style.height = `${plan.chrome.paginationHeight}px`;
		},
	},
];
