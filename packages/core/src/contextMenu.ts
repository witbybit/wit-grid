import type { CanonicalGridCellPointer, GridApi, GridCellPointer, GridPlugin, GridPluginRuntime } from './api/GridApi.js';
import { exportToCsv } from './export/csvExport.js';
import { attachRovingMenuKeyboard } from './menuKeyboardNav.js';
import { isFilterableColumn, buildFilterByValue, applyFilterToModel } from './filterOperations.js';
import { findColumnIndexByCanonicalCellPointer, resolveCanonicalCellPointer } from './interaction/cellPointer.js';
import type { ColumnDef } from './columnDef.js';
import { readInteractionState, type CanonicalGridSelectionState } from './interaction/interactionState.js';

export interface ContextMenuParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	pointer: CanonicalGridCellPointer;
	api: GridApi<TRowData>;
	selection: CanonicalGridSelectionState;
}

export interface GridContextMenuItem<TRowData = unknown> {
	id?: string;
	label?: string;
	isDivider?: boolean;
	icon?: string | HTMLElement;
	action?: (params: ContextMenuParams<TRowData>) => void;
	disabled?: boolean | ((params: ContextMenuParams<TRowData>) => boolean);
	hidden?: boolean | ((params: ContextMenuParams<TRowData>) => boolean);
}

export interface GridContextMenuOptions<TRowData = unknown> {
	disabled?: boolean;
	disableDefaults?: boolean;
	excludeDefaults?: Array<
		| 'copy'
		| 'cut'
		| 'paste'
		| 'clear'
		| 'selectAll'
		| 'filterByValue'
		| 'excludeValue'
		| 'clearColumnFilter'
		| 'exportAll'
		| 'exportSelected'
		| 'divider'
	>;
	customItems?: Array<GridContextMenuItem<TRowData>>;
}

type DefaultContextMenuItemId = NonNullable<GridContextMenuOptions['excludeDefaults']>[number];

export class GridContextMenuPlugin<TRowData = unknown> implements GridPlugin<TRowData> {
	readonly name = 'contextMenu';
	private runtime!: GridPluginRuntime<TRowData>;
	private menuElement: HTMLDivElement | null = null;
	private detachKeyboardNav: (() => void) | null = null;
	private activePointer: CanonicalGridCellPointer | null = null;
	private options: GridContextMenuOptions<TRowData>;

	constructor(options: GridContextMenuOptions<TRowData> = {}) {
		this.options = options;
	}

	public setOptions(options: GridContextMenuOptions<TRowData>): void {
		this.options = options;
	}

	public onInit(api: GridPluginRuntime<TRowData>): void {
		this.runtime = api;
	}

	public show(rowId: string, colField: string, clientX: number, clientY: number): void {
		this.showPointer({ rowId, colField }, clientX, clientY);
	}

	private resolveCanonicalPointer(pointer: GridCellPointer, columns: readonly ColumnDef<TRowData>[]): CanonicalGridCellPointer | null {
		return resolveCanonicalCellPointer(columns, pointer);
	}

	public showPointer(pointer: GridCellPointer, clientX: number, clientY: number): void {
		if (this.options.disabled) return;

		const state = this.runtime.getStateSnapshot();
		const canonicalPointer = this.resolveCanonicalPointer(pointer, state.columns);
		if (!canonicalPointer) return;
		const selection = readInteractionState(state).cellSelection.selection;
		const explicitColIdx = findColumnIndexByCanonicalCellPointer(state.columns, canonicalPointer);
		const access = this.runtime.getCellAccessByPointer(canonicalPointer);
		let inSelection = false;
		if (selection.bounds) {
			const rowModel = this.runtime.getRowModel();
			if (rowModel) {
				const clickedRowIdx = access?.rowIndex ?? rowModel.getVisualIndexByRowId(canonicalPointer.rowId);
				const clickedColIdx = explicitColIdx >= 0 ? explicitColIdx : (access?.colIndex ?? explicitColIdx);
				const bounds = selection.bounds;
				if (
					clickedRowIdx >= bounds.minRow &&
					clickedRowIdx <= bounds.maxRow &&
					clickedColIdx >= bounds.minCol &&
					clickedColIdx <= bounds.maxCol
				) {
					inSelection = true;
				}
			}
		}

		if (!inSelection) {
			this.runtime.selectCell(canonicalPointer, 'pointer');
		}

		this.activePointer = canonicalPointer;
		this.renderMenu(clientX, clientY);
	}

	public hide = (): void => {
		if (this.detachKeyboardNav) {
			this.detachKeyboardNav();
			this.detachKeyboardNav = null;
		}
		if (this.menuElement) {
			this.menuElement.classList.remove('og-visible');
			const el = this.menuElement;
			setTimeout(() => {
				el.remove();
			}, 150);
			this.menuElement = null;
		}
		document.removeEventListener('mousedown', this.handleOutsideClick);
		window.removeEventListener('scroll', this.hide, { capture: true });
		window.removeEventListener('resize', this.hide);
	};

	public onDestroy(): void {
		this.hide();
	}

	private reportFault(operation: string, error: unknown, context?: Record<string, unknown>): void {
		this.runtime.reportRuntimeFault({
			source: 'plugin',
			operation,
			error,
			context: { plugin: this.name, ...context },
		});
	}

	private handleOutsideClick = (e: MouseEvent): void => {
		if (this.menuElement && !this.menuElement.contains(e.target as Node)) {
			this.hide();
		}
	};

	private renderMenu(clientX: number, clientY: number): void {
		if (this.menuElement) {
			this.menuElement.remove();
		}

		if (this.options.disabled) return;

		const activePointer = this.activePointer;
		if (!activePointer) return;
		const { rowId, colField } = activePointer;

		const menu = document.createElement('div');
		menu.className = 'og-context-menu';
		this.menuElement = menu;

		const state = this.runtime.getStateSnapshot();
		const selection = readInteractionState(state).cellSelection.selection;
		const params: ContextMenuParams<TRowData> = {
			rowId,
			colField,
			pointer: activePointer,
			api: this.runtime,
			selection,
		};

		const defaultItems: Array<GridContextMenuItem<TRowData>> = [
			{
				id: 'copy',
				label: 'Copy Selected Range',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
				action: (p) => this.copySelectedRange(p),
			},
			{
				id: 'cut',
				label: 'Cut Selection',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="9.8" y1="8.2" x2="21" y2="19"></line><line x1="9.8" y1="15.8" x2="21" y2="5"></line></svg>`,
				action: (p) => this.cutSelectedRange(p),
			},
			{
				id: 'paste',
				label: 'Paste Clipboard',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`,
				action: (p) => {
					this.pasteSelectedRange(p);
				},
			},
			{
				id: 'clear',
				label: 'Clear Selection',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`,
				action: (p) => this.clearSelection(p),
			},
			{ id: 'divider', isDivider: true },
			{
				id: 'selectAll',
				label: 'Select All',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4"></rect></svg>`,
				action: (p) => this.selectAll(p),
			},
			{ id: 'divider', isDivider: true },
			{
				id: 'filterByValue',
				label: 'Filter by Value',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,
				hidden: (p) => !this.canFilterColumn(p.colField),
				action: (p) => this.filterByValue(p, false),
			},
			{
				id: 'excludeValue',
				label: 'Exclude This Value',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon><line x1="4" y1="4" x2="20" y2="20"></line></svg>`,
				hidden: (p) => !this.canFilterColumn(p.colField),
				action: (p) => this.filterByValue(p, true),
			},
			{
				id: 'clearColumnFilter',
				label: 'Clear Column Filter',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
				hidden: (p) => !this.hasColumnFilter(p.colField),
				action: (p) => this.clearColumnFilter(p),
			},
			{ id: 'divider', isDivider: true },
			{
				id: 'exportAll',
				label: 'Export All as CSV',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
				action: () => exportToCsv(this.runtime, { fileName: 'export.csv' }),
			},
			{
				id: 'exportSelected',
				label: 'Export Selection as CSV',
				icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
				hidden: (p) => !p.selection.bounds,
				action: (p) => this.exportSelectionAsCsv(p),
			},
		];

		const exclude = this.options.excludeDefaults || [];
		const activeDefaults = this.options.disableDefaults
			? []
			: defaultItems.filter((item) => !item.id || !exclude.includes(item.id as DefaultContextMenuItemId));
		const custom = this.options.customItems || [];

		const items = [...activeDefaults, ...custom];

		const visibleItems = items.filter((item) => {
			if (typeof item.hidden === 'function') {
				return !item.hidden(params);
			}
			return !item.hidden;
		});

		const hasAnyIcon = visibleItems.some((item) => item.icon !== undefined);

		// Enabled, activatable item elements collected for keyboard navigation.
		const navItems: HTMLElement[] = [];

		visibleItems.forEach((item) => {
			if (item.isDivider) {
				const divider = document.createElement('div');
				divider.className = 'og-context-menu-divider';
				divider.setAttribute('role', 'separator');
				menu.appendChild(divider);
			} else if (item.label) {
				const el = document.createElement('div');
				el.className = 'og-context-menu-item';
				el.setAttribute('role', 'menuitem');

				let isItemDisabled = false;
				if (typeof item.disabled === 'function') {
					isItemDisabled = !!item.disabled(params);
				} else if (item.disabled !== undefined) {
					isItemDisabled = !!item.disabled;
				}

				if (isItemDisabled) {
					el.classList.add('og-disabled');
				}

				if (hasAnyIcon) {
					const iconContainer = document.createElement('div');
					iconContainer.className = 'og-context-menu-item-icon';
					if (item.icon) {
						if (item.icon instanceof HTMLElement) {
							iconContainer.appendChild(item.icon);
						} else if (typeof item.icon === 'string') {
							if (item.icon.trim().startsWith('<')) {
								iconContainer.innerHTML = item.icon;
							} else {
								iconContainer.textContent = item.icon;
							}
						}
					}
					el.appendChild(iconContainer);
				}

				const labelSpan = document.createElement('span');
				labelSpan.className = 'og-context-menu-item-label';
				labelSpan.textContent = item.label;
				el.appendChild(labelSpan);

				if (!isItemDisabled && item.action) {
					el.addEventListener('click', (e) => {
						e.stopPropagation();
						if (item.action) {
							item.action(params);
						}
						this.hide();
					});
					navItems.push(el);
				} else if (isItemDisabled) {
					el.setAttribute('aria-disabled', 'true');
					el.addEventListener('click', (e) => {
						e.stopPropagation();
						e.preventDefault();
					});
				}
				menu.appendChild(el);
			}
		});

		const container = this.runtime.getContainer();
		if (container && container.dataset.ogThemeScope) {
			menu.dataset.ogThemeScope = container.dataset.ogThemeScope;
		}

		document.body.appendChild(menu);

		const menuWidth = 190;
		const menuHeight = visibleItems.length * 35;

		let left = clientX;
		let top = clientY;
		let flippedUp = false;
		let flippedLeft = false;

		if (clientX + menuWidth > window.innerWidth) {
			left = window.innerWidth - menuWidth - 8;
			flippedLeft = true;
		}
		if (clientY + menuHeight > window.innerHeight) {
			top = window.innerHeight - menuHeight - 8;
			flippedUp = true;
		}

		menu.setAttribute('role', 'menu');
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
		// Origin-aware entrance — grow from the corner nearest the pointer (shadcn-style).
		menu.classList.add(flippedUp ? 'og-placement-top' : 'og-placement-bottom');
		if (flippedLeft) menu.classList.add('og-placement-left');

		// Keyboard navigation: arrows move, Enter/Space activate, Escape/Tab close.
		this.detachKeyboardNav = attachRovingMenuKeyboard({
			container: menu,
			items: navItems,
			activeClass: 'og-menu-active',
			onActivate: (el) => el.click(),
			onClose: this.hide,
		});

		// Interaction-only animation staging: this is not grid render scheduling.
		// We wait one frame so the initial placement styles commit before toggling
		// the visible class, allowing the menu entrance transition to animate.
		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => {
				menu.classList.add('og-visible');
			});
		} else {
			menu.classList.add('og-visible');
		}

		document.addEventListener('mousedown', this.handleOutsideClick);
		window.addEventListener('scroll', this.hide, { capture: true, passive: true });
		window.addEventListener('resize', this.hide);
	}

	private copySelectedRange(_params: ContextMenuParams<TRowData>): void {
		void this.runtime.copySelectedRange();
	}

	private cutSelectedRange(params: ContextMenuParams<TRowData>): void {
		this.copySelectedRange(params);
		this.clearSelection(params);
	}

	private async pasteSelectedRange(_params: ContextMenuParams<TRowData>): Promise<void> {
		return this.runtime.pasteFromClipboard();
	}

	private clearSelection(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		if (!bounds) return;

		const updates: { rowId: string; colField: string; value: unknown }[] = [];
		const columns = params.api.getStateSnapshot().columns;
		for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
			const visualRow = this.runtime.getVisualRow(r);
			if (visualRow?.kind !== 'data') continue;
			const rowId = visualRow.rowId;
			for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
				const col = columns[c];
				if (!col) continue;
				updates.push({ rowId, colField: col.field, value: '' });
			}
		}
		if (updates.length > 0) this.runtime.transaction({ cells: updates });
	}

	private selectAll(params: ContextMenuParams<TRowData>): void {
		const state = params.api.getStateSnapshot();
		const columns = state.columns;
		const rowCount = this.runtime.getVisualRowCount();
		if (columns.length === 0 || rowCount === 0) return;

		const firstRow = this.runtime.getVisualRow(0);
		const lastRow = this.runtime.getVisualRow(rowCount - 1);
		if (firstRow?.kind !== 'data' || lastRow?.kind !== 'data') return;

		const firstRowId = firstRow.rowId;
		const lastRowId = lastRow.rowId;

		params.api.selectRange({ rowId: firstRowId, colField: columns[0].field }, { rowId: lastRowId, colField: columns[columns.length - 1].field });
	}

	private exportSelectionAsCsv(params: ContextMenuParams<TRowData>): void {
		const bounds = params.selection.bounds;
		if (!bounds) return;

		const rowIds: string[] = [];
		for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
			const visualRow = this.runtime.getVisualRow(r);
			if (visualRow?.kind !== 'data') continue;
			rowIds.push(visualRow.rowId);
		}
		if (rowIds.length === 0) return;

		const state = params.api.getStateSnapshot();
		const colFields = state.columns.slice(bounds.minCol, bounds.maxCol + 1).map((c) => c.field);

		exportToCsv(this.runtime, { fileName: 'export-selection.csv', rowIds, columns: colFields });
	}

	// ── Filter by value helpers ────────────────────────────────────────────────

	private canFilterColumn(colField: string): boolean {
		const col = this.runtime.getColumnDef(colField);
		return col ? isFilterableColumn(col) : false;
	}

	private hasColumnFilter(colField: string): boolean {
		return !!this.runtime.getStateSnapshot().filterModel?.[colField];
	}

	private filterByValue(params: ContextMenuParams<TRowData>, exclude: boolean): void {
		const { rowId, colField, api } = params;
		const col = api.getColumnDef(colField);
		if (!col) return;
		const rawValue = api.getCellValue(rowId, colField);
		api.setFilterModel(buildFilterByValue(col, rawValue, exclude, api.getStateSnapshot().filterModel));
	}

	private clearColumnFilter(params: ContextMenuParams<TRowData>): void {
		const { colField, api } = params;
		api.setFilterModel(applyFilterToModel(colField, null, api.getStateSnapshot().filterModel));
	}
}
