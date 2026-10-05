import type { InvalidationFrame } from './invalidationManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { asSelectableDataRowModel } from '../rowModel.js';
import type { ColumnInteractionController } from './columnInteractionController.js';
import { computeGridLayoutPlan, type GridLayoutPlan, type HeaderCellLayout } from './layoutPlan.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { reportRendererFault } from './rendererFaults.js';
import { compileStyleRules, evaluateHeaderCellStyleRules } from '../styling/styleRules.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';

/** Writes an inline display value only when it differs, so an unchanged header re-sync restyles nothing. */
function setDisplay(el: HTMLElement | SVGElement, display: string): void {
	if (el.style.display !== display) el.style.display = display;
}

const MAX_FREE_LEAF_HEADER_CELLS = 64;

export class HeaderRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly columnInteractionsGetter: () => ColumnInteractionController<TRowData>;
	private readonly showHeaderMenu: (cell: HTMLElement, colField: string) => void;

	// Keyed by cell.id — leaf: the column's instance id (columnInstanceId, not field — stable across
	// pin/unpin/reorder of an equivalent column, changes only if the column is semantically replaced);
	// group: "grp:depth:firstField:lastField". Stable identity so the DOM element is relocated
	// rather than destroyed+recreated.
	private headerCells = new Map<string, HTMLDivElement>();
	/** Detached leaf header cells, reused when columns enter the window during horizontal scroll
	 *  instead of building a new cell (with its icons) per column. Every per-column detail is
	 *  rewritten by renderCell; cells that grew a select-all checkbox are never pooled. */
	private readonly freeLeafHeaderCells: HTMLDivElement[] = [];
	private headerLayer: HTMLDivElement | null = null;
	private headerLeftLayer: HTMLDivElement | null = null;
	private headerRightLayer: HTMLDivElement | null = null;

	private getSelectableDataRowIds(scope: import('../api/GridApi.js').RowSelectionScope): string[] {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return [];
		const selectableRowModel = asSelectableDataRowModel(rowModel);
		if (selectableRowModel) return selectableRowModel.getSelectableDataRowIds(scope);
		const ids: string[] = [];
		const vCount = rowModel.getVisualRowCount();
		for (let i = 0; i < vCount; i++) {
			const row = rowModel.getVisualRow(i);
			if (row?.kind === 'data') ids.push(row.rowId);
		}
		return ids;
	}

	public lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1, topologyVersion: -1 };
	private lastTopologyVersion = -1;
	private readonly renderedHeaderScratch = new Set<string>();

	constructor(
		engine: GridEngine<TRowData>,
		columnInteractionsGetter: () => ColumnInteractionController<TRowData>,
		showHeaderMenu: (cell: HTMLElement, colField: string) => void
	) {
		this.engine = engine;
		this.columnInteractionsGetter = columnInteractionsGetter;
		this.showHeaderMenu = showHeaderMenu;
	}

	public mount(headerLayer: HTMLDivElement, headerLeftLayer: HTMLDivElement, headerRightLayer: HTMLDivElement): void {
		this.headerLayer = headerLayer;
		this.headerLeftLayer = headerLeftLayer;
		this.headerRightLayer = headerRightLayer;
		this.clearHeaderCells();
	}

	public unmount(): void {
		this.clearHeaderCells();
		this.headerLayer = null;
		this.headerLeftLayer = null;
		this.headerRightLayer = null;
	}

	public clearHeaderCells(): void {
		for (const cell of this.headerCells.values()) {
			cell.remove();
		}
		this.headerCells.clear();
		this.freeLeafHeaderCells.length = 0;
		this.lastHeaderVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1, colCount: -1, topologyVersion: -1 };
		this.lastTopologyVersion = -1;
	}

	public sync(_frame: InvalidationFrame): void {
		this.repaintHeaders();
	}

	public repaintHeaders(layoutPlan?: GridLayoutPlan): void {
		this.syncVisibleHeaders(true, layoutPlan ?? computeGridLayoutPlan(this.engine));
	}

	public syncVisibleColumnRange(layoutPlan: GridLayoutPlan, range?: { startIdx: number; endIdx: number }): boolean {
		const band = layoutPlan.headerBands[0];
		const colCount = band?.cells.length ?? 0;
		const { pinLeftCount: pinLeft, pinRightCount: pinRight } = layoutPlan.columns;
		const colStart = range?.startIdx ?? layoutPlan.columns.colStart;
		const colEnd = range?.endIdx ?? layoutPlan.columns.colEnd;
		const topologyVersion = layoutPlan.columnTopology.version;

		if (
			colStart === this.lastHeaderVisibleRange.startIdx &&
			colEnd === this.lastHeaderVisibleRange.endIdx &&
			pinLeft === this.lastHeaderVisibleRange.pinLeft &&
			pinRight === this.lastHeaderVisibleRange.pinRight &&
			colCount === this.lastHeaderVisibleRange.colCount &&
			topologyVersion === this.lastTopologyVersion
		) {
			return false;
		}

		this.syncVisibleHeaders(false, layoutPlan, range);
		return true;
	}

	private syncVisibleHeaders(forceRepaint = false, layoutPlan: GridLayoutPlan, range?: { startIdx: number; endIdx: number }): void {
		if (!this.headerLayer || !this.headerLeftLayer || !this.headerRightLayer) return;

		const { headerBands } = layoutPlan;
		if (headerBands.length === 0) {
			this.clearHeaderCells();
			return;
		}

		// Leaf band is always the last band
		const leafBand = headerBands[headerBands.length - 1];
		if (leafBand.cells.length === 0) {
			this.clearHeaderCells();
			return;
		}

		const state = this.engine.stateManager.getState();
		const interaction = readInteractionState(state);
		const compiledStyleRules = compileStyleRules(state.styleRules);
		// bounds is only set when a range exists (drag / shift+arrow). For plain single-cell
		// focus (click / arrow key) bounds is null, so fall back to the focus column's index.
		const { bounds, focus } = interaction.cellSelection.selection;
		const focusColIdx = focus !== null ? this.engine.columns.getIndexMapper().idToVisualIndex(focus.columnInstanceId) : -1;
		const highlightMinCol = bounds !== null ? bounds.minCol : focusColIdx >= 0 ? focusColIdx : null;
		const highlightMaxCol = bounds !== null ? bounds.maxCol : focusColIdx >= 0 ? focusColIdx : null;
		const { pinLeftCount, pinRightCount } = layoutPlan.columns;
		const colCount = leafBand.cells.length;
		const colStart = range?.startIdx ?? layoutPlan.columns.colStart;
		const colEnd = range?.endIdx ?? layoutPlan.columns.colEnd;

		if (
			!forceRepaint &&
			colStart === this.lastHeaderVisibleRange.startIdx &&
			colEnd === this.lastHeaderVisibleRange.endIdx &&
			pinLeftCount === this.lastHeaderVisibleRange.pinLeft &&
			pinRightCount === this.lastHeaderVisibleRange.pinRight &&
			colCount === this.lastHeaderVisibleRange.colCount &&
			layoutPlan.columnTopology.version === this.lastHeaderVisibleRange.topologyVersion
		) {
			return;
		}

		const rendered = this.renderedHeaderScratch;
		rendered.clear();

		const renderCell = (cell: HeaderCellLayout) => {
			// cell.id is stable across pin/unpin: column field for leaves,
			// "grp:depth:firstField:lastField" for group spans.
			const cellKey = cell.id;

			let headerCell = this.headerCells.get(cellKey);
			if (!headerCell) {
				headerCell = (cell.isLeaf ? this.freeLeafHeaderCells.pop() : undefined) ?? this.createHeaderCellElement(cell.isLeaf);
				this.headerCells.set(cellKey, headerCell);
			}
			rendered.add(cellKey);

			// cell.left is lane-relative for all three lanes (WS10). No per-lane subtraction needed.
			let className = cell.isLeaf ? 'og-header-cell' : 'og-header-cell og-header-group-cell';
			const cellLeft = cell.left;
			let targetLayer = this.headerLayer;

			if (cell.pinned === 'left') {
				className += ' og-header-cell-pinned-left';
				targetLayer = this.headerLeftLayer;
			} else if (cell.pinned === 'right') {
				className += ' og-header-cell-pinned-right';
				targetLayer = this.headerRightLayer;
			}

			if (cell.isLeaf) {
				if (compiledStyleRules.hasHeaderRules) {
					try {
						const col = this.engine.columns.getCompiledPlan().displayedColumns[cell.colStart];
						if (!col) return;
						const customHeaderClass = evaluateHeaderCellStyleRules(compiledStyleRules, col);
						if (customHeaderClass) className += ' ' + customHeaderClass;
					} catch (e) {
						reportRendererFault(this.engine, 'header-cell-class', e, { colField: cell.field, colIndex: cell.colStart });
					}
				}
				if (cell.movable) className += ' og-header-cell-movable';
				if (cell.checkboxSelection) className += ' og-header-cell-row-selector';

				const columnInteractions = this.columnInteractionsGetter();
				const isDraggingThis = columnInteractions.isDraggingColumn(cell.field);
				if (isDraggingThis) className += ' og-header-cell-dragging';
				if (highlightMinCol !== null && cell.colStart >= highlightMinCol && cell.colStart <= highlightMaxCol!)
					className += ' og-header-cell-col-focus';

				if (headerCell.className !== className) headerCell.className = className;
				// Live column-reorder preview: slide this header to its previewed post-drop
				// position. Folded into the positioning transform; the existing
				// `.og-header-cell-movable { transition: transform }` makes it glide + settle.
				const shiftedLeft = cellLeft + columnInteractions.getColumnShift(cell.colStart);
				const nextTransform = isDraggingThis ? `translate3d(${shiftedLeft}px, -2px, 0) scale(1.035)` : `translate3d(${shiftedLeft}px, 0, 0)`;
				if (headerCell.style.transform !== nextTransform) headerCell.style.transform = nextTransform;
				const nextWidth = `${cell.width}px`;
				if (headerCell.style.width !== nextWidth) headerCell.style.width = nextWidth;
				const nextTop = `${cell.top}px`;
				if (headerCell.style.top !== nextTop) headerCell.style.top = nextTop;
				const nextHeight = `${cell.height}px`;
				if (headerCell.style.height !== nextHeight) headerCell.style.height = nextHeight;

				const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
				if (cell.isLeaf) {
					const col = this.engine.columns.getCompiledPlan().displayedColumns[cell.colStart];
					const menuBtnEl = headerCell.querySelector<HTMLDivElement>('.og-header-menu-button');
					if (menuBtnEl) setDisplay(menuBtnEl, cell.checkboxSelection || (col && col.suppressHeaderMenu === true) ? 'none' : '');
					const resizeEl = headerCell.querySelector<HTMLDivElement>('.og-header-resize-handle');
					if (resizeEl) setDisplay(resizeEl, cell.checkboxSelection ? 'none' : '');
				}

				if (cell.checkboxSelection) {
					let checkbox = headerCell.querySelector<HTMLInputElement>('input[type="checkbox"].og-header-checkbox');
					if (!checkbox) {
						checkbox = document.createElement('input');
						checkbox.type = 'checkbox';
						checkbox.className = 'og-header-checkbox';
						checkbox.addEventListener('change', (e) => {
							e.stopPropagation();
							const state = this.engine.stateManager.getState();
							const scope = state.rowSelection?.selectAllScope ?? 'page';
							if ((e.target as HTMLInputElement).checked) {
								this.engine.selectAllDataRows('headerCheckbox', scope);
							} else {
								const ids = this.getSelectableDataRowIds(scope);
								if (ids.length > 0) this.engine.deselectRowIds(ids, 'headerCheckbox');
								else this.engine.clearRowSelection('headerCheckbox');
							}
						});
						if (textSpan) textSpan.textContent = '';
						headerCell.insertBefore(checkbox, textSpan);
					}
					const scope = state.rowSelection?.selectAllScope ?? 'page';
					const scopedIds = this.getSelectableDataRowIds(scope);
					const totalDataRows = scopedIds.length;
					const scopedSet = new Set(scopedIds);
					const selectedCount = interaction.rowSelection.selectedRowIds.filter((rowId) => scopedSet.has(rowId)).length;
					const newChecked = selectedCount > 0 && selectedCount >= totalDataRows;
					const newIndeterminate = selectedCount > 0 && selectedCount < totalDataRows;
					checkbox.title = selectedCount > 0 ? `${selectedCount} of ${totalDataRows} rows selected` : `Select all ${totalDataRows} rows`;
					checkbox.setAttribute('aria-label', newChecked ? 'Clear row selection' : 'Select all rows');
					if (checkbox.checked !== newChecked) checkbox.checked = newChecked;
					if (checkbox.indeterminate !== newIndeterminate) checkbox.indeterminate = newIndeterminate;
				} else if (textSpan && textSpan.textContent !== cell.label) {
					textSpan.textContent = cell.label;
				}

				const currentSort = state.sortModel?.find((s) => s.colId === cell.field);
				// Each indicator's display is decided once and written only when it changes: this runs for
				// every visible header cell on every horizontal scroll frame, and an inline-style write
				// (even one that restores the same value) makes the browser restyle the element.
				const sortIndicator = headerCell.querySelector('.og-header-sort-indicator') as HTMLDivElement | null;
				if (sortIndicator) {
					setDisplay(sortIndicator, currentSort && !cell.checkboxSelection ? 'flex' : 'none');
					if (currentSort) {
						const isAsc = currentSort.sort === 'asc';
						const svgAsc = sortIndicator.querySelector('.og-sort-svg-asc') as SVGElement | null;
						const svgDesc = sortIndicator.querySelector('.og-sort-svg-desc') as SVGElement | null;
						if (svgAsc) setDisplay(svgAsc, isAsc ? 'block' : 'none');
						if (svgDesc) setDisplay(svgDesc, isAsc ? 'none' : 'block');
					}
				}
				const filterIndicator = headerCell.querySelector('.og-header-filter-indicator') as HTMLDivElement | null;
				if (filterIndicator) setDisplay(filterIndicator, state.filterModel && state.filterModel[cell.field] ? 'flex' : 'none');
				// ARIA sort state (none unless this column is sorted, and only for sortable columns).
				const nextSort = currentSort ? (currentSort.sort === 'asc' ? 'ascending' : 'descending') : cell.sortable === false ? null : 'none';
				if (nextSort === null) headerCell.removeAttribute('aria-sort');
				else if (headerCell.getAttribute('aria-sort') !== nextSort) headerCell.setAttribute('aria-sort', nextSort);

				if (headerCell.dataset.colField !== cell.field) headerCell.dataset.colField = cell.field;
				const colIndexText = String(cell.colStart);
				if (headerCell.dataset.colIndex !== colIndexText) headerCell.dataset.colIndex = colIndexText;
				const ariaCol = String(cell.colStart + 1);
				if (headerCell.getAttribute('aria-colindex') !== ariaCol) headerCell.setAttribute('aria-colindex', ariaCol);
			} else {
				// Group header cell — simpler rendering: label only, no interactive chrome
				if (headerCell.className !== className) headerCell.className = className;
				const nextTransform = `translate3d(${cellLeft}px, 0, 0)`;
				if (headerCell.style.transform !== nextTransform) headerCell.style.transform = nextTransform;
				const nextWidth = `${cell.width}px`;
				if (headerCell.style.width !== nextWidth) headerCell.style.width = nextWidth;
				const nextTop = `${cell.top}px`;
				if (headerCell.style.top !== nextTop) headerCell.style.top = nextTop;
				const nextHeight = `${cell.height}px`;
				if (headerCell.style.height !== nextHeight) headerCell.style.height = nextHeight;

				const textSpan = headerCell.firstElementChild as HTMLSpanElement | null;
				if (textSpan && textSpan.textContent !== cell.label) textSpan.textContent = cell.label;
			}

			if (headerCell.parentNode !== targetLayer) {
				targetLayer!.appendChild(headerCell);
				this.engine.instrumentation.increment(GridMetric.HEADER_VIEW_RELOCATED);
			}
		};

		// Render group bands (all cells fully visible — group bands aren't virtualized)
		for (let b = 0; b < headerBands.length - 1; b++) {
			for (const cell of headerBands[b].cells) {
				if (cell.pinned === 'left') renderCell(cell);
			}
			for (const cell of headerBands[b].cells) {
				if (cell.pinned === 'center') renderCell(cell);
			}
			for (const cell of headerBands[b].cells) {
				if (cell.pinned === 'right') renderCell(cell);
			}
		}

		// Render leaf band with visible-range virtualization
		for (const cell of leafBand.cells) {
			if (cell.pinned === 'left') renderCell(cell);
		}
		for (const cell of leafBand.cells) {
			if (cell.pinned === 'center' && cell.colStart >= colStart && cell.colStart <= colEnd) {
				renderCell(cell);
			}
		}
		for (const cell of leafBand.cells) {
			if (cell.pinned === 'right') renderCell(cell);
		}

		// Remove cells that are no longer in any rendered band
		for (const [cellKey, cell] of this.headerCells.entries()) {
			if (!rendered.has(cellKey)) {
				cell.remove();
				this.headerCells.delete(cellKey);
				if (
					this.freeLeafHeaderCells.length < MAX_FREE_LEAF_HEADER_CELLS &&
					!cell.classList.contains('og-header-group-cell') &&
					cell.querySelector('.og-header-sort-indicator') !== null &&
					cell.querySelector('.og-header-checkbox') === null
				) {
					this.freeLeafHeaderCells.push(cell);
				}
			}
		}

		if (layoutPlan.columnTopology.version !== this.lastTopologyVersion) {
			this.engine.instrumentation.increment(GridMetric.TOPOLOGY_VERSION_CHANGED);
		}
		this.lastTopologyVersion = layoutPlan.columnTopology.version;
		this.lastHeaderVisibleRange = {
			startIdx: colStart,
			endIdx: colEnd,
			pinLeft: pinLeftCount,
			pinRight: pinRightCount,
			colCount,
			topologyVersion: layoutPlan.columnTopology.version,
		};
	}

	private createHeaderCellElement(isLeaf = true): HTMLDivElement {
		const headerCell = document.createElement('div');
		headerCell.setAttribute('role', 'columnheader');

		const textSpan = document.createElement('span');
		textSpan.style.overflow = 'hidden';
		textSpan.style.textOverflow = 'ellipsis';
		textSpan.style.whiteSpace = 'nowrap';
		textSpan.style.flex = '1';
		headerCell.appendChild(textSpan);

		if (!isLeaf) {
			// Group header cells have no interactive chrome
			return headerCell;
		}

		headerCell.addEventListener('mousedown', (e) => this.columnInteractionsGetter().onHeaderCellMouseDown(e));

		const sortIndicator = document.createElement('div');
		sortIndicator.className = 'og-header-sort-indicator';

		// Pre-create sort indicator SVG nodes to avoid innerHTML churn
		const svgAsc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svgAsc.setAttribute('width', '10');
		svgAsc.setAttribute('height', '10');
		svgAsc.setAttribute('viewBox', '0 0 24 24');
		svgAsc.setAttribute('fill', 'none');
		svgAsc.setAttribute('stroke', 'currentColor');
		svgAsc.setAttribute('stroke-width', '3');
		svgAsc.setAttribute('stroke-linecap', 'round');
		svgAsc.setAttribute('stroke-linejoin', 'round');
		svgAsc.setAttribute('class', 'og-sort-svg-asc');
		svgAsc.style.display = 'none';
		svgAsc.innerHTML = '<path d="M12 19V5M5 12l7-7 7 7"/>';

		const svgDesc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svgDesc.setAttribute('width', '10');
		svgDesc.setAttribute('height', '10');
		svgDesc.setAttribute('viewBox', '0 0 24 24');
		svgDesc.setAttribute('fill', 'none');
		svgDesc.setAttribute('stroke', 'currentColor');
		svgDesc.setAttribute('stroke-width', '3');
		svgDesc.setAttribute('stroke-linecap', 'round');
		svgDesc.setAttribute('stroke-linejoin', 'round');
		svgDesc.setAttribute('class', 'og-sort-svg-desc');
		svgDesc.style.display = 'none';
		svgDesc.innerHTML = '<path d="M12 5v14M5 12l7 7 7-7"/>';

		sortIndicator.appendChild(svgAsc);
		sortIndicator.appendChild(svgDesc);
		headerCell.appendChild(sortIndicator);

		const filterIndicator = document.createElement('div');
		filterIndicator.className = 'og-header-filter-indicator';
		filterIndicator.style.display = 'none';
		// Funnel icon
		filterIndicator.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
		headerCell.appendChild(filterIndicator);

		const menuButton = document.createElement('div');
		menuButton.className = 'og-header-menu-button';
		menuButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2.5"></circle><circle cx="12" cy="5" r="2.5"></circle><circle cx="12" cy="19" r="2.5"></circle></svg>`;
		menuButton.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		menuButton.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			const colField = headerCell.dataset.colField;
			if (colField) {
				this.showHeaderMenu(headerCell, colField);
			}
		});
		headerCell.appendChild(menuButton);

		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'og-header-resize-handle';
		resizeHandle.addEventListener('mousedown', (e) => this.columnInteractionsGetter().onHeaderResizeMouseDown(e));
		resizeHandle.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			const cell = (e.currentTarget as HTMLElement).closest('.og-header-cell') as HTMLElement | null;
			const colField = cell?.dataset.colField;
			if (colField) this.engine.autoSizeColumn(colField);
		});
		headerCell.appendChild(resizeHandle);

		return headerCell;
	}
}
