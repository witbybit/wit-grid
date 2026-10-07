import { groupByColIds } from '../rows/hierarchyConfig.js';
import { afterNextPaint, defaultGridScheduler } from './gridScheduler.js';
import { paintSortIndicator } from './headerRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridApi } from '../api/GridApi.js';
import { reportRendererFault } from './rendererFaults.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { FilterPopoverController } from './filterPopoverController.js';
import type { DomFilterEditorHandle } from '../filters/filterDef.js';

/**
 * Manages the column header context menu/popover lifecycle.
 * Extracted from RenderEngine so that the DOM build and dismiss logic
 * lives in one cohesive place with its own state.
 */
export class HeaderMenuController<TRowData = unknown> {
	private activePopover: HTMLDivElement | null = null;
	private activeHeaderCell: HTMLElement | null = null;

	constructor(
		private readonly engine: GridEngine<TRowData>,
		private readonly portalMountManager: PortalMountManager<TRowData>,
		private readonly getApi: () => GridApi<TRowData>,
		private readonly filters: FilterPopoverController<TRowData>
	) {}

	/** The filter editor embedded in the open menu. */
	private filterHandle: DomFilterEditorHandle | null = null;

	public show(headerCell: HTMLElement, colField: string): void {
		// Toggle: clicking the same header button closes it.
		if (this.activePopover && this.activeHeaderCell === headerCell) {
			this.hide();
			return;
		}
		this.hide();
		this.activeHeaderCell = headerCell;
		this._buildAndShowPopover(headerCell.getBoundingClientRect(), colField);
	}

	/** Open the filter/sort popover anchored to an arbitrary element (e.g. a filter chip).
	 *  Works without a sidebar — uses the same built-in floating popover as the header button. */
	public showForField(colField: string, anchorEl: HTMLElement): void {
		// Toggle: clicking the same chip while the popover is open closes it.
		if (this.activePopover && this._activeColField === colField) {
			this.hide();
			return;
		}
		this.hide();
		this.activeHeaderCell = null;
		this._buildAndShowPopover(anchorEl.getBoundingClientRect(), colField);
	}

	private _activeColField: string | null = null;

	private _buildAndShowPopover(rect: DOMRect, colField: string): void {
		this._activeColField = colField;
		const state = this.engine.stateManager.getState();
		const column = state.columns.find((c) => c.field === colField);
		if (!column) return;

		const popover = document.createElement('div');
		popover.className = 'og-header-popover';
		const container = (this.activeHeaderCell ?? document.body).closest('.og-grid-container') as HTMLElement | null;
		if (container && container.dataset.ogThemeScope) {
			popover.dataset.ogThemeScope = container.dataset.ogThemeScope;
		}
		this.activePopover = popover;

		// Custom React header menu (portal-mounted).
		if (column.headerMenuComponent && this.portalMountManager.onMountHeaderMenu) {
			try {
				this.portalMountManager.mountHeaderMenu({
					colField,
					column,
					close: this.hide,
					container: popover,
				});
				document.body.appendChild(popover);
				this._position(popover, rect);
				this._bindDismissListeners();
				return;
			} catch (err) {
				reportRendererFault(this.engine, 'header-menu-component-mount', err, { colField });
			}
		}

		// Custom function header menu renderer.
		if (column.headerMenuRenderer) {
			try {
				column.headerMenuRenderer({
					colField,
					column,
					api: this.getApi(),
					close: this.hide,
					container: popover,
				});
				document.body.appendChild(popover);
				this._position(popover, rect);
				this._bindDismissListeners();
				return;
			} catch (err) {
				reportRendererFault(this.engine, 'header-menu-renderer', err, { colField });
			}
		}

		// Built-in sort + filter popover.
		const api = this.getApi();
		const displayedCols = api.getDisplayedColumns();
		const colIndex = displayedCols.findIndex((c) => c.field === colField);
		const { left: currentLeft, right: currentRight } = api.getPinnedColumns();
		const N = displayedCols.length;

		const handlePinLeft = () => {
			if (colIndex < 0) return;
			if (colIndex < currentLeft) return;
			api.moveColumn(colField, currentLeft);
			const isPinnedRight = colIndex >= N - currentRight;
			const nextRight = isPinnedRight ? Math.max(0, currentRight - 1) : currentRight;
			api.setPinnedColumns({
				left: currentLeft + 1,
				right: nextRight,
			});
			this.hide();
		};

		const handlePinRight = () => {
			if (colIndex < 0) return;
			const isPinnedRight = colIndex >= N - currentRight;
			if (isPinnedRight) return;
			api.moveColumn(colField, N - currentRight - 1);
			const isPinnedLeft = colIndex < currentLeft;
			const nextLeft = isPinnedLeft ? Math.max(0, currentLeft - 1) : currentLeft;
			api.setPinnedColumns({
				left: nextLeft,
				right: currentRight + 1,
			});
			this.hide();
		};

		const handleUnpin = () => {
			if (colIndex < 0) return;
			const isPinnedLeft = colIndex < currentLeft;
			const isPinnedRight = colIndex >= N - currentRight;
			if (isPinnedLeft) {
				api.moveColumn(colField, currentLeft - 1);
				api.setPinnedColumns({
					left: Math.max(0, currentLeft - 1),
					right: currentRight,
				});
			} else if (isPinnedRight) {
				api.moveColumn(colField, N - currentRight);
				api.setPinnedColumns({
					left: currentLeft,
					right: Math.max(0, currentRight - 1),
				});
			}
			this.hide();
		};

		const sections: HTMLDivElement[] = [];

		const isSortable = column.sortable !== false;
		if (isSortable) {
			const sortContainer = document.createElement('div');
			sortContainer.className = 'og-popover-sort-section';

			const currentSort = state.sortModel?.find((s) => s.colId === colField);

			const sortAsc = document.createElement('div');
			sortAsc.className = 'og-popover-item' + (currentSort?.sort === 'asc' ? ' og-active' : '');
			sortAsc.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
				<span>Sort Ascending</span>
			`;
			sortAsc.addEventListener('click', () => this.sortAfterPaint(colField, 'asc'));
			this._makeActivatable(sortAsc);
			sortContainer.appendChild(sortAsc);

			const sortDesc = document.createElement('div');
			sortDesc.className = 'og-popover-item' + (currentSort?.sort === 'desc' ? ' og-active' : '');
			sortDesc.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7 7 7-7"/></svg>
				<span>Sort Descending</span>
			`;
			sortDesc.addEventListener('click', () => this.sortAfterPaint(colField, 'desc'));
			this._makeActivatable(sortDesc);
			sortContainer.appendChild(sortDesc);

			if (currentSort) {
				const clearSort = document.createElement('div');
				clearSort.className = 'og-popover-item og-danger';
				clearSort.innerHTML = `
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
					<span>Clear Sorting</span>
				`;
				clearSort.addEventListener('click', () => this.sortAfterPaint(colField, null));
				this._makeActivatable(clearSort);
				sortContainer.appendChild(clearSort);
			}

			sections.push(sortContainer);
		}

		const isPinnable = column.canPin === undefined || normalizeCapabilityResult(column.canPin({ action: 'pin', colField: column.field })).allowed;
		// Routes through the full capability chain (column.canGroup, column.enableRowGroup, and any
		// grid-level canGroup rule) rather than checking enableRowGroup alone, so canGroup: () => false
		// on a column actually hides the "Group by Column" menu item.
		const isGroupable = api.can('group', { colField: column.field }).allowed;

		if (isPinnable || isGroupable) {
			const pinGroupContainer = document.createElement('div');
			pinGroupContainer.className = 'og-popover-sort-section';

			if (isPinnable) {
				const isPinnedLeft = colIndex >= 0 && colIndex < currentLeft;
				if (!isPinnedLeft) {
					const pinLeft = document.createElement('div');
					pinLeft.className = 'og-popover-item';
					pinLeft.innerHTML = `
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 12H8m4-4-4 4 4 4"/></svg>
						<span>Pin Left</span>
					`;
					pinLeft.addEventListener('click', handlePinLeft);
					this._makeActivatable(pinLeft);
					pinGroupContainer.appendChild(pinLeft);
				}

				const isPinnedRight = colIndex >= 0 && colIndex >= N - currentRight;
				if (!isPinnedRight) {
					const pinRight = document.createElement('div');
					pinRight.className = 'og-popover-item';
					pinRight.innerHTML = `
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M8 12h8m-4-4 4 4-4 4"/></svg>
						<span>Pin Right</span>
					`;
					pinRight.addEventListener('click', handlePinRight);
					this._makeActivatable(pinRight);
					pinGroupContainer.appendChild(pinRight);
				}

				if (isPinnedLeft || isPinnedRight) {
					const unpin = document.createElement('div');
					unpin.className = 'og-popover-item';
					unpin.innerHTML = `
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						<span>Unpin Column</span>
					`;
					unpin.addEventListener('click', handleUnpin);
					this._makeActivatable(unpin);
					pinGroupContainer.appendChild(unpin);
				}
			}

			if (isGroupable) {
				const groupBy = groupByColIds(state.grouping);
				const isGrouped = groupBy.includes(colField);
				const groupBtn = document.createElement('div');
				groupBtn.className = 'og-popover-item';
				if (isGrouped) {
					groupBtn.innerHTML = `
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="8" y1="11" x2="16" y2="11"></line></svg>
						<span>Remove Group By</span>
					`;
					groupBtn.addEventListener('click', () => {
						api.removeGroupBy(colField);
						this.hide();
					});
				} else {
					groupBtn.innerHTML = `
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
						<span>Group by Column</span>
					`;
					groupBtn.addEventListener('click', () => {
						api.addGroupBy(colField);
						this.hide();
					});
				}
				this._makeActivatable(groupBtn);
				pinGroupContainer.appendChild(groupBtn);
			}

			sections.push(pinGroupContainer);
		}

		const isFilterable =
			column.canFilter === undefined || normalizeCapabilityResult(column.canFilter({ action: 'filter', colField: column.field })).allowed;
		if (isFilterable && this.filters.isFilterable(colField)) {
			// The column's filter editor: the same one the header funnel, sidebar and floating row show.
			const filterContainer = document.createElement('div');
			filterContainer.className = 'og-popover-filter-section';
			const filterTitle = document.createElement('div');
			filterTitle.className = 'og-popover-section-title';
			filterTitle.textContent = 'Filter';
			filterContainer.appendChild(filterTitle);
			const body = document.createElement('div');
			body.className = 'og-popover-filter-body';
			filterContainer.appendChild(body);
			this.filterHandle = this.filters.mountEditor(body, colField, 'menu', this.hide);
			sections.push(filterContainer);
		}

		sections.forEach((section, idx) => {
			if (idx > 0) {
				const divider = document.createElement('div');
				divider.className = 'og-popover-divider';
				popover.appendChild(divider);
			}
			popover.appendChild(section);
		});

		popover.setAttribute('role', 'menu');
		document.body.appendChild(popover);
		this._position(popover, rect);
		this._bindDismissListeners();

		const firstFocusable = popover.querySelector<HTMLElement>('.og-popover-item, select, input');
		if (firstFocusable) {
			firstFocusable.focus({ preventScroll: true });
		}
	}

	/**
	 * Closes the menu and shows the header's new sort at once; the sort itself (a full rebuild on large
	 * grids) runs after the browser paints that, so the choice answers immediately.
	 */
	private sortAfterPaint(colField: string, sort: 'asc' | 'desc' | null): void {
		const headerCell = this.activeHeaderCell;
		const before = this.engine.stateManager.getState().sortModel;
		this.hide();
		if (headerCell) paintSortIndicator(headerCell, sort, true);
		afterNextPaint(() => {
			if (this.engine.stateManager.getState().sortModel !== before) return; // a later sort wins
			this.engine.setSortModel(sort ? [{ colId: colField, sort }] : null);
		});
	}

	public hide = (): void => {
		this.filterHandle?.destroy?.();
		this.filterHandle = null;
		if (this.activePopover) {
			this.activePopover.classList.add('og-closing');
			this.activePopover.classList.remove('og-visible');
			const el = this.activePopover;
			const colField = this.activeHeaderCell?.dataset.colField;
			if (colField) {
				this.portalMountManager.releaseHeaderMenu({ colField, container: el });
			}
			defaultGridScheduler.timeout(() => {
				el.remove();
			}, 120);
			this.activePopover = null;
		}
		this.activeHeaderCell = null;
		this._activeColField = null;
		document.removeEventListener('mousedown', this._handleOutsideClick);
		document.removeEventListener('keydown', this._handleKeyDown);
		window.removeEventListener('scroll', this._handleScroll, { capture: true });
		window.removeEventListener('resize', this.hide);
	};

	private _handleOutsideClick = (e: MouseEvent): void => {
		if ((e.target as HTMLElement | null)?.closest?.('.og-ct-popover')) return;
		if (this.activePopover && !this.activePopover.contains(e.target as Node)) {
			const clickedMenuBtn = (e.target as HTMLElement).closest('.og-header-menu-button');
			if (clickedMenuBtn && this.activeHeaderCell !== null && clickedMenuBtn.closest('.og-header-cell') === this.activeHeaderCell) {
				return;
			}
			this.hide();
		}
	};

	// Escape closes the popover from anywhere (built-in form controls or a custom menu).
	private _handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.activePopover) {
			e.preventDefault();
			this.hide();
			this.activeHeaderCell?.focus?.({ preventScroll: true });
		}
	};

	/** Make a non-native popover row (a div) keyboard-focusable + Enter/Space-activatable,
	 *  so it sits in the natural Tab order alongside the filter's native controls. */
	private _makeActivatable(el: HTMLElement): void {
		el.tabIndex = 0;
		el.setAttribute('role', 'menuitem');
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				el.click();
			}
		});
	}

	private _bindDismissListeners(): void {
		document.addEventListener('mousedown', this._handleOutsideClick);
		document.addEventListener('keydown', this._handleKeyDown);
		window.addEventListener('scroll', this._handleScroll, { capture: true, passive: true });
		window.addEventListener('resize', this.hide);
	}

	/** The page or grid scrolled: close. Scrolling a list inside the menu (or its popovers) does not. */
	private _handleScroll = (e: Event): void => {
		const target = e.target as HTMLElement | null;
		if (target instanceof Element && (this.activePopover?.contains(target) || target.closest('.og-ct-popover'))) return;
		this.hide();
	};

	private _position(popover: HTMLDivElement, rect: DOMRect): void {
		const popoverWidth = 220;
		const popoverHeight = popover.offsetHeight || 215;

		let left = rect.left;
		let top = rect.bottom + 4;
		let flippedAbove = false;

		if (left + popoverWidth > window.innerWidth) {
			left = window.innerWidth - popoverWidth - 8;
		}
		if (top + popoverHeight > window.innerHeight) {
			top = rect.top - popoverHeight - 4;
			flippedAbove = true;
		}

		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
		// Origin-aware entrance: grow/slide from the edge nearest the trigger (shadcn-style).
		popover.classList.add(flippedAbove ? 'og-placement-top' : 'og-placement-bottom');

		defaultGridScheduler.raf(() => {
			popover.classList.add('og-visible');
		});
	}
}
