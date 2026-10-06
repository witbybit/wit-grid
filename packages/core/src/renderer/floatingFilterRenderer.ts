import type { GridEngine } from '../engine/GridEngine.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { computeGridLayoutPlan } from './layoutPlan.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';
import type {
	ColumnFilter,
	FilterModel,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
} from '../filterModel.js';
import type { InternalColumnDef } from '../columnDef.js';
import { type OpOption, getOpsForType, getOpMeta, defaultOpForType, applyFilterToModel } from '../filterOperations.js';

/** Params passed to a custom floatingFilterRenderer function. */
export interface FloatingFilterRendererParams<TRowData = unknown> {
	column: InternalColumnDef<TRowData>;
	colField: string;
	/** Current filter for this column, or null. */
	currentFilter: ColumnFilter | null;
	/** Call this to programmatically update the filter for this column. */
	setFilter(filter: ColumnFilter | null): void;
	/** The cell container element — size to fill it. */
	eCell: HTMLDivElement;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function debounce(fn: (...args: unknown[]) => void, ms: number): (...args: unknown[]) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args) => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}

const DROPDOWN_ID = 'og-floating-set-dropdown';
const OP_MENU_ID = 'og-floating-op-menu';

// ── Main class ───────────────────────────────────────────────────────────────

export class FloatingFilterRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;

	private filterLayer: HTMLDivElement | null = null;
	private filterLeftLayer: HTMLDivElement | null = null;
	private filterRightLayer: HTMLDivElement | null = null;

	// Cell elements keyed by column field (survives reorder)
	private cells = new Map<string, HTMLDivElement>();
	private lastFilterModel: FilterModel | null = null;
	private lastVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1 };
	private lastTopologyVersion = -1;
	private unsubscribers: (() => void)[] = [];
	/**
	 * The menus this grid opened. Per instance, so one grid's horizontal scroll or unmount never
	 * closes another grid's open menu. A ref removed elsewhere is detached; removing it is a no-op.
	 */
	private openDropdownEl: HTMLElement | null = null;
	private openOpMenuEl: HTMLElement | null = null;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	public mount(filterLayer: HTMLDivElement, filterLeftLayer: HTMLDivElement, filterRightLayer: HTMLDivElement): void {
		this.filterLayer = filterLayer;
		this.filterLeftLayer = filterLeftLayer;
		this.filterRightLayer = filterRightLayer;
		this.clearCells();

		// Re-render on filter model change (values may change from outside)
		const unsub1 = this.engine.stateManager.subscribeToKey('filterModel', () => this.repaint());
		// Re-render on column change
		const unsub2 = this.engine.stateManager.subscribeToKey('columns', () => this.repaint());
		this.unsubscribers.push(unsub1, unsub2);
	}

	private closeOpenMenus(): void {
		this.openDropdownEl?.remove();
		this.openDropdownEl = null;
		this.openOpMenuEl?.remove();
		this.openOpMenuEl = null;
	}

	public unmount(): void {
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
		this.closeOpenMenus();
		this.clearCells();
		this.filterLayer = null;
		this.filterLeftLayer = null;
		this.filterRightLayer = null;
	}

	public repaint(layoutPlan?: GridLayoutPlan): void {
		this.syncVisibleFilters(true, layoutPlan ?? computeGridLayoutPlan(this.engine));
	}

	public syncScrollLeft(_layoutPlan: GridLayoutPlan): void {
		// Pin lanes now use CSS position:sticky — no JS counter-transform needed.
		// Close this grid's menus on horizontal scroll (they're fixed-position and won't track).
		this.closeOpenMenus();
	}

	private syncVisibleFilters(force: boolean, plan: GridLayoutPlan): void {
		if (!this.filterLayer || !this.filterLeftLayer || !this.filterRightLayer) return;
		if (plan.chrome.floatingFilterHeight === 0) return;

		const columnPlan = this.engine.columns.getCompiledPlan();
		const columns = columnPlan.displayedColumns as InternalColumnDef<TRowData>[];
		const colWidths = columnPlan.colWidths;
		const topology = plan.columnTopology;
		const colStart = plan.columns.colStart;
		const colEnd = plan.columns.colEnd;
		const filterModel = this.engine.stateManager.getState().filterModel;

		const rangeKey = `${colStart}:${colEnd}:${plan.columns.pinLeftCount}:${plan.columns.pinRightCount}`;
		const filterChanged = filterModel !== this.lastFilterModel;
		const topologyChanged = topology.version !== this.lastTopologyVersion;
		if (
			!force &&
			rangeKey ===
				`${this.lastVisibleRange.startIdx}:${this.lastVisibleRange.endIdx}:${this.lastVisibleRange.pinLeft}:${this.lastVisibleRange.pinRight}` &&
			!filterChanged &&
			!topologyChanged
		) {
			return;
		}
		this.lastFilterModel = filterModel;
		if (topologyChanged) this.engine.instrumentation.increment(GridMetric.TOPOLOGY_VERSION_CHANGED);
		this.lastTopologyVersion = topology.version;
		this.lastVisibleRange = { startIdx: colStart, endIdx: colEnd, pinLeft: plan.columns.pinLeftCount, pinRight: plan.columns.pinRightCount };

		const colCount = columns.length;
		const seen = new Set<string>();

		for (let c = 0; c < colCount; c++) {
			const col = columns[c];
			const placement = topology.byColumnId.get(col.instanceId);
			if (!placement) continue;

			const isPinLeft = placement.lane === 'left';
			const isPinRight = placement.lane === 'right';
			const isCenter = placement.lane === 'center';

			if (isCenter && (c < colStart || c > colEnd)) continue;

			seen.add(col.field);

			// laneOffset is already lane-relative for all three lanes.
			const left = placement.laneOffset;
			const width = colWidths[c] ?? this.engine.stateManager.getState().defaultColWidth;
			const currentFilter = (filterModel?.[col.field] ?? null) as ColumnFilter | null;

			let cell = this.cells.get(col.field);
			if (!cell) {
				cell = this.createCell(c, col, left, width, currentFilter, isPinLeft, isPinRight);
			} else {
				// Update position if column widths changed
				cell.style.left = `${left}px`;
				cell.style.width = `${width}px`;
				// Reparent if lane changed (pin/unpin relocation — move, do not destroy/recreate).
				const targetParent = isPinLeft ? this.filterLeftLayer : isPinRight ? this.filterRightLayer : this.filterLayer;
				if (targetParent && cell.parentNode !== targetParent) {
					targetParent.appendChild(cell);
					this.engine.instrumentation.increment(GridMetric.FLOATING_FILTER_VIEW_RELOCATED);
				} else if (targetParent) {
					// Appending in compiled display order keeps same-lane reorders in
					// topology/DOM order without a layout read.
					targetParent.appendChild(cell);
				}
				// Sync filter value if it changed
				this.updateCellFilterValue(cell, currentFilter, col);
			}
		}

		// Remove cells that are no longer in the visible range
		for (const [field, cell] of this.cells) {
			if (!seen.has(field)) {
				cell.remove();
				this.cells.delete(field);
			}
		}
	}

	private createCell(
		colIndex: number,
		col: InternalColumnDef<TRowData>,
		left: number,
		width: number,
		currentFilter: ColumnFilter | null,
		isPinLeft: boolean,
		isPinRight: boolean
	): HTMLDivElement {
		const cell = document.createElement('div');
		cell.className = 'og-floating-filter-cell';
		cell.dataset.colField = col.field;
		cell.dataset.colIndex = String(colIndex);
		cell.style.left = `${left}px`;
		cell.style.width = `${width}px`;

		const setFilter = (filter: ColumnFilter | null): void => {
			const newModel = applyFilterToModel(col.field, filter, this.engine.stateManager.getState().filterModel);
			this.engine.setFilterModel(newModel);
		};

		// Use custom renderer if provided
		if ((col as any).floatingFilterRenderer) {
			const params: FloatingFilterRendererParams<TRowData> = { column: col, colField: col.field, currentFilter, setFilter, eCell: cell };
			(col as any).floatingFilterRenderer(params);
		} else {
			this.buildDefaultInput(cell, col, currentFilter, setFilter);
		}

		const parent = isPinLeft ? this.filterLeftLayer : isPinRight ? this.filterRightLayer : this.filterLayer;
		parent?.appendChild(cell);
		this.cells.set(col.field, cell);
		return cell;
	}

	// ── Default input builder ──────────────────────────────────────────────────

	private buildDefaultInput(
		cell: HTMLDivElement,
		col: InternalColumnDef<TRowData>,
		currentFilter: ColumnFilter | null,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		const filterType = col.filterType ?? 'text';
		if (filterType === 'none') return;

		if (filterType === 'set') {
			this.buildSetBadge(cell, col, currentFilter as SetFilterCondition | null, setFilter);
			return;
		}

		const ops = getOpsForType(filterType);
		const currentOp = this.currentOperator(currentFilter, filterType);
		const opMeta = getOpMeta(filterType, currentOp);

		cell.dataset.inputType = filterType;
		cell.dataset.filterOp = currentOp;

		// Operator button
		const opBtn = document.createElement('button');
		opBtn.className = 'og-floating-filter-op-btn';
		opBtn.title = `Operator: ${opMeta.label}`;
		opBtn.textContent = opMeta.symbol;
		opBtn.tabIndex = -1;
		opBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openOperatorMenu(opBtn, cell, ops, currentOp, filterType, setFilter);
		});
		cell.appendChild(opBtn);

		if (opMeta.noValue) {
			// blank / notBlank: no input needed
			const noValLabel = document.createElement('span');
			noValLabel.className = 'og-floating-filter-no-value';
			noValLabel.textContent = opMeta.label;
			cell.appendChild(noValLabel);
		} else if (opMeta.range) {
			this.buildRangeInputs(cell, filterType, currentFilter, setFilter, currentOp);
		} else {
			const input = this.buildSingleInput(cell, filterType, currentFilter, setFilter, currentOp);
			this.setupTabNavigation(input);
		}
	}

	private buildSingleInput(
		cell: HTMLDivElement,
		filterType: string,
		currentFilter: ColumnFilter | null,
		setFilter: (f: ColumnFilter | null) => void,
		op: string
	): HTMLInputElement {
		const input = document.createElement('input');
		input.className = 'og-floating-filter-input og-ff-input-primary';

		if (filterType === 'number') {
			input.type = 'number';
			input.placeholder = 'Filter…';
			const numFilter = currentFilter?.type === 'number' ? (currentFilter as NumberFilterCondition) : null;
			if (numFilter && numFilter.value != null && numFilter.operator === op) input.value = String(numFilter.value);
		} else if (filterType === 'date') {
			input.type = 'date';
			const dateFilter = currentFilter?.type === 'date' ? (currentFilter as DateFilterCondition) : null;
			if (dateFilter?.dateFrom && dateFilter.operator === op) input.value = dateFilter.dateFrom;
		} else {
			input.type = 'text';
			input.placeholder = 'Filter…';
			const textFilter = currentFilter?.type === 'text' ? (currentFilter as TextFilterCondition) : null;
			if (textFilter?.value && textFilter.operator === op) input.value = textFilter.value;
		}

		const debouncedUpdate = debounce((...args: unknown[]) => {
			const val = args[0] as string;
			if (!val) {
				setFilter(null);
				return;
			}
			if (filterType === 'number') {
				const n = parseFloat(val);
				if (!isNaN(n)) setFilter({ type: 'number', operator: op as NumberFilterOperator, value: n });
			} else if (filterType === 'date') {
				setFilter({ type: 'date', operator: op as DateFilterOperator, dateFrom: val });
			} else {
				setFilter({ type: 'text', operator: op as TextFilterOperator, value: val });
			}
		}, 200);

		input.addEventListener('input', () => debouncedUpdate(input.value));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				input.value = '';
				setFilter(null);
			}
		});

		cell.appendChild(input);
		return input;
	}

	private buildRangeInputs(
		cell: HTMLDivElement,
		filterType: string,
		currentFilter: ColumnFilter | null,
		setFilter: (f: ColumnFilter | null) => void,
		op: string
	): void {
		const isNumber = filterType === 'number';
		const from = document.createElement('input');
		from.className = 'og-floating-filter-input og-ff-input-primary og-ff-input-range';
		from.type = isNumber ? 'number' : 'date';
		from.placeholder = 'From';
		const to = document.createElement('input');
		to.className = 'og-floating-filter-input og-ff-input-secondary og-ff-input-range';
		to.type = isNumber ? 'number' : 'date';
		to.placeholder = 'To';

		if (isNumber) {
			const nf = currentFilter?.type === 'number' && currentFilter.operator === 'inRange' ? (currentFilter as NumberFilterCondition) : null;
			if (nf) {
				from.value = String(nf.value);
				if (nf.valueTo != null) to.value = String(nf.valueTo);
			}
		} else {
			const df = currentFilter?.type === 'date' && currentFilter.operator === 'inRange' ? (currentFilter as DateFilterCondition) : null;
			if (df) {
				from.value = df.dateFrom ?? '';
				to.value = df.dateTo ?? '';
			}
		}

		const sep = document.createElement('span');
		sep.className = 'og-ff-range-sep';
		sep.textContent = '–';

		const emitRange = debounce((): void => {
			if (isNumber) {
				const f = parseFloat(from.value),
					t = parseFloat(to.value);
				if (!isNaN(f)) setFilter({ type: 'number', operator: 'inRange', value: f, valueTo: !isNaN(t) ? t : undefined });
				else setFilter(null);
			} else {
				if (from.value) setFilter({ type: 'date', operator: 'inRange', dateFrom: from.value, dateTo: to.value || undefined });
				else setFilter(null);
			}
		}, 200);

		from.addEventListener('input', () => emitRange());
		to.addEventListener('input', () => emitRange());
		from.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				from.value = '';
				to.value = '';
				setFilter(null);
			}
		});
		to.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				from.value = '';
				to.value = '';
				setFilter(null);
			}
		});

		this.setupTabNavigation(from);
		this.setupTabNavigation(to);

		cell.appendChild(from);
		cell.appendChild(sep);
		cell.appendChild(to);
	}

	// ── Operator picker menu ───────────────────────────────────────────────────

	private openOperatorMenu(
		anchor: HTMLElement,
		cell: HTMLDivElement,
		ops: OpOption[],
		currentOp: string,
		filterType: string,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		this.openOpMenuEl?.remove();

		const menu = document.createElement('div');
		menu.id = OP_MENU_ID;
		this.openOpMenuEl = menu;
		const rect = anchor.getBoundingClientRect();
		menu.style.cssText = [
			'position:fixed',
			`top:${rect.bottom + 2}px`,
			`left:${rect.left}px`,
			'z-index:9001',
			'min-width:140px',
			'padding:4px 0',
			'border-radius:8px',
			`background:var(--og-popover-bg,#1e293b)`,
			`border:1px solid var(--og-border-color)`,
			`box-shadow:0 8px 24px rgba(0,0,0,0.5)`,
			`font-family:var(--og-font-family)`,
		].join(';');

		// Inherit theme scope
		const gridContainer = cell.closest('.og-grid-container') as HTMLElement | null;
		if (gridContainer?.dataset.ogThemeScope) menu.dataset.ogThemeScope = gridContainer.dataset.ogThemeScope;

		for (const op of ops) {
			const row = document.createElement('div');
			row.style.cssText = [
				'display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;font-size:11px;white-space:nowrap',
				`color:var(--og-text-color)`,
				op.value === currentOp ? `background:color-mix(in srgb,var(--og-focus-ring) 15%,transparent)` : '',
			].join(';');
			row.addEventListener('mouseenter', () => (row.style.background = 'var(--og-popover-item-hover-bg)'));
			row.addEventListener(
				'mouseleave',
				() => (row.style.background = op.value === currentOp ? 'color-mix(in srgb,var(--og-focus-ring) 15%,transparent)' : '')
			);

			const sym = document.createElement('span');
			sym.style.cssText = 'width:20px;text-align:center;font-weight:700;opacity:0.7;flex-shrink:0;font-size:12px';
			sym.textContent = op.symbol;

			const lbl = document.createElement('span');
			lbl.textContent = op.label;

			row.appendChild(sym);
			row.appendChild(lbl);

			row.addEventListener('click', () => {
				menu.remove();
				this.changeOperator(cell, op, filterType, setFilter);
			});
			menu.appendChild(row);
		}

		document.body.appendChild(menu);

		const onOutside = (e: MouseEvent): void => {
			if (!menu.contains(e.target as Node)) {
				menu.remove();
				document.removeEventListener('mousedown', onOutside, true);
			}
		};
		const onEscape = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				menu.remove();
				document.removeEventListener('keydown', onEscape, true);
			}
		};
		setTimeout(() => {
			document.addEventListener('mousedown', onOutside, true);
			document.addEventListener('keydown', onEscape, true);
		}, 0);
	}

	private changeOperator(cell: HTMLDivElement, op: OpOption, filterType: string, setFilter: (f: ColumnFilter | null) => void): void {
		// Read current value from existing primary input (if any)
		const primaryInput = cell.querySelector('.og-ff-input-primary') as HTMLInputElement | null;
		const existingValue = primaryInput?.value ?? '';

		// Rebuild input area: remove everything except the op-btn
		const opBtn = cell.querySelector('.og-floating-filter-op-btn') as HTMLButtonElement;
		while (cell.lastChild && cell.lastChild !== opBtn) cell.removeChild(cell.lastChild);

		cell.dataset.filterOp = op.value;
		opBtn.textContent = op.symbol;
		opBtn.title = `Operator: ${op.label}`;

		// Patch the click handler to use the new op
		const newOpBtn = opBtn.cloneNode(true) as HTMLButtonElement;
		const ops = getOpsForType(filterType);
		newOpBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openOperatorMenu(newOpBtn, cell, ops, op.value, filterType, setFilter);
		});
		opBtn.replaceWith(newOpBtn);

		if (op.noValue) {
			// Emit the blank/notBlank filter immediately; value fields are ignored by rowModel for these operators
			const blankFilter: ColumnFilter =
				filterType === 'number'
					? { type: 'number', operator: op.value as NumberFilterOperator, value: 0 }
					: filterType === 'date'
						? { type: 'date', operator: op.value as DateFilterOperator, dateFrom: '' }
						: { type: 'text', operator: op.value as TextFilterOperator, value: '' };
			setFilter(blankFilter);
			const noValLabel = document.createElement('span');
			noValLabel.className = 'og-floating-filter-no-value';
			noValLabel.textContent = op.label;
			cell.appendChild(noValLabel);
		} else if (op.range) {
			// Clear current filter when switching to range (needs both bounds)
			setFilter(null);
			this.buildRangeInputs(cell, filterType, null, setFilter, op.value);
		} else {
			const input = this.buildSingleInput(cell, filterType, null, setFilter, op.value);
			// Restore value from previous input
			if (existingValue) {
				input.value = existingValue;
				input.dispatchEvent(new Event('input'));
			}
			this.setupTabNavigation(input);
			input.focus();
		}
	}

	// ── Tab navigation ─────────────────────────────────────────────────────────

	private setupTabNavigation(input: HTMLInputElement): void {
		input.addEventListener('keydown', (e) => {
			if (e.key !== 'Tab') return;

			// The wrapper owns one grid's left, center, and right filter lanes in
			// topology order. Restrict traversal to it and use DOM order, avoiding
			// cross-grid focus jumps and layout reads.
			const wrapper = input.closest<HTMLElement>('.og-layer-floating-filter-wrapper');
			if (!wrapper) return;
			const all = Array.from(
				wrapper.querySelectorAll<HTMLElement>('.og-floating-filter-input, .og-floating-filter-set-badge, .og-floating-filter-empty')
			);

			const idx = all.indexOf(input);
			if (idx === -1) return;
			const next = e.shiftKey ? all[idx - 1] : all[idx + 1];
			if (!next) return;

			e.preventDefault();
			next.focus();
		});
	}

	// ── Set filter badge ───────────────────────────────────────────────────────

	private buildSetBadge(
		cell: HTMLDivElement,
		col: InternalColumnDef<TRowData> | null,
		currentFilter: SetFilterCondition | null,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		const openDropdown = (): void => {
			const filterValues = ((col as any)?.filterValues as string[] | undefined) ?? [];
			this.openSetDropdown(cell, filterValues, currentFilter, setFilter);
		};

		if (currentFilter && currentFilter.values.length > 0) {
			const badge = document.createElement('div');
			badge.className = 'og-floating-filter-set-badge';
			const count = currentFilter.values.length;
			badge.title = currentFilter.values.map((v) => (v === null ? '(blank)' : String(v))).join(', ');
			badge.textContent = `${count} value${count !== 1 ? 's' : ''}`;
			badge.addEventListener('click', openDropdown);
			cell.dataset.inputType = 'set';
			cell.appendChild(badge);
		} else {
			const empty = document.createElement('div');
			empty.className = 'og-floating-filter-empty';
			empty.textContent = 'All';
			empty.addEventListener('click', openDropdown);
			cell.dataset.inputType = 'set';
			cell.appendChild(empty);
		}
	}

	private openSetDropdown(
		cell: HTMLDivElement,
		filterValues: string[],
		currentFilter: SetFilterCondition | null,
		setFilter: (f: ColumnFilter | null) => void
	): void {
		// Toggle: if already open for this cell, close it
		const existing = this.openDropdownEl?.isConnected ? this.openDropdownEl : null;
		if (existing) {
			existing.remove();
			if ((existing as any).__cell === cell) return;
		}

		const selected = new Set<string>((currentFilter?.values ?? []).map(String));

		const dropdown = document.createElement('div');
		dropdown.id = DROPDOWN_ID;
		this.openDropdownEl = dropdown;
		(dropdown as any).__cell = cell;
		dropdown.style.cssText = [
			'position:fixed',
			'z-index:9000',
			'min-width:160px',
			'max-height:260px',
			'overflow-y:auto',
			'padding:4px 0',
			'border-radius:8px',
			'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
			`background:var(--og-popover-bg,#1e293b)`,
			`border:1px solid var(--og-border-color)`,
			`font-family:var(--og-font-family)`,
		].join(';');

		const rect = cell.getBoundingClientRect();
		dropdown.style.top = `${rect.bottom + 2}px`;
		dropdown.style.left = `${rect.left}px`;

		const applyFilter = (): void => {
			const arr = [...selected];
			setFilter(arr.length > 0 ? { type: 'set', values: arr } : null);
		};

		for (const v of filterValues) {
			const row = document.createElement('label');
			row.style.cssText =
				'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;font-size:11px;white-space:nowrap;' +
				`color:var(--og-text-color)`;
			row.addEventListener('mouseenter', () => (row.style.background = 'var(--og-popover-item-hover-bg)'));
			row.addEventListener('mouseleave', () => (row.style.background = ''));

			const cb = document.createElement('input');
			cb.type = 'checkbox';
			cb.checked = selected.has(v);
			cb.style.cssText = `accent-color:var(--og-focus-ring);cursor:pointer;flex-shrink:0`;
			cb.addEventListener('change', () => {
				if (cb.checked) selected.add(v);
				else selected.delete(v);
				applyFilter();
			});

			const label = document.createElement('span');
			label.textContent = v;

			row.appendChild(cb);
			row.appendChild(label);
			dropdown.appendChild(row);
		}

		// "Clear" footer if anything is selected
		if (filterValues.length > 0) {
			const sep = document.createElement('div');
			sep.style.cssText = `margin:4px 0;border-top:1px solid var(--og-border-color)`;
			dropdown.appendChild(sep);

			const clearBtn = document.createElement('button');
			clearBtn.textContent = 'Clear filter';
			clearBtn.style.cssText = [
				'width:100%',
				'padding:5px 12px',
				'background:none',
				'border:none',
				'cursor:pointer',
				'font-size:10px',
				'text-align:left',
				`color:var(--og-focus-ring)`,
				`font-family:var(--og-font-family)`,
				'font-weight:600',
			].join(';');
			clearBtn.addEventListener('click', () => {
				selected.clear();
				applyFilter();
				dropdown.remove();
			});
			dropdown.appendChild(clearBtn);
		}

		// Inherit the grid's theme scope so CSS vars (--og-*) resolve correctly
		const gridContainer = cell.closest('.og-grid-container') as HTMLElement | null;
		if (gridContainer?.dataset.ogThemeScope) {
			dropdown.dataset.ogThemeScope = gridContainer.dataset.ogThemeScope;
		}
		document.body.appendChild(dropdown);

		const onOutsideClick = (e: MouseEvent): void => {
			if (!dropdown.contains(e.target as Node) && e.target !== cell) {
				dropdown.remove();
				document.removeEventListener('mousedown', onOutsideClick, true);
			}
		};
		const onEscape = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				dropdown.remove();
				document.removeEventListener('keydown', onEscape, true);
			}
		};
		setTimeout(() => {
			document.addEventListener('mousedown', onOutsideClick, true);
			document.addEventListener('keydown', onEscape, true);
		}, 0);
	}

	// ── Cell update ─────────────────────────────────────────────────────────────

	private currentOperator(filter: ColumnFilter | null, filterType: string): string {
		if (!filter || filter.type === 'compound' || filter.type === 'set') return defaultOpForType(filterType);
		return (filter as TextFilterCondition | NumberFilterCondition | DateFilterCondition).operator ?? defaultOpForType(filterType);
	}

	private updateCellFilterValue(cell: HTMLDivElement, currentFilter: ColumnFilter | null, col?: InternalColumnDef<TRowData>): void {
		const inputType = cell.dataset.inputType;

		// Set filter: rebuild badge if active/inactive state changed
		if (!inputType || inputType === 'set') {
			const hasBadge = cell.querySelector('.og-floating-filter-set-badge');
			const hasEmpty = cell.querySelector('.og-floating-filter-empty');
			const setFilter = (newFilter: ColumnFilter | null): void => {
				const colField = cell.dataset.colField!;
				const state = this.engine.stateManager.getState();
				const newModel: FilterModel = { ...(state.filterModel ?? {}) };
				if (newFilter == null) delete newModel[colField];
				else newModel[colField] = newFilter;
				this.engine.setFilterModel(Object.keys(newModel).length > 0 ? newModel : null);
			};
			const setFilter2 = currentFilter?.type === 'set' ? currentFilter : null;
			if ((setFilter2 && !hasBadge) || (!setFilter2 && !hasEmpty)) {
				cell.innerHTML = '';
				const colField = cell.dataset.colField ?? '';
				const colForBadge = colField
					? ((this.engine.columns.getCompiledPlan().displayedColumns.find((c) => (c as InternalColumnDef<TRowData>).field === colField) as
							| InternalColumnDef<TRowData>
							| undefined) ?? null)
					: null;
				this.buildSetBadge(cell, colForBadge, setFilter2, setFilter);
			}
			return;
		}

		// For text/number/date: if operator changed, rebuild the whole input area
		const newOp = this.currentOperator(currentFilter, inputType);
		const oldOp = cell.dataset.filterOp ?? defaultOpForType(inputType);

		if (newOp !== oldOp) {
			// Operator changed externally (e.g. from header menu) — rebuild
			cell.innerHTML = '';
			if (col) {
				const colField = cell.dataset.colField!;
				const setFilter = (newFilter: ColumnFilter | null): void => {
					const state = this.engine.stateManager.getState();
					const newModel: FilterModel = { ...(state.filterModel ?? {}) };
					if (newFilter == null) delete newModel[colField];
					else newModel[colField] = newFilter;
					this.engine.setFilterModel(Object.keys(newModel).length > 0 ? newModel : null);
				};
				this.buildDefaultInput(cell, col, currentFilter, setFilter);
			}
			return;
		}

		const primaryInput = cell.querySelector('.og-ff-input-primary') as HTMLInputElement | null;
		const secondaryInput = cell.querySelector('.og-ff-input-secondary') as HTMLInputElement | null;
		if (!primaryInput) return;

		if (document.activeElement === primaryInput || document.activeElement === secondaryInput) return;

		if (!currentFilter) {
			if (primaryInput.value !== '') primaryInput.value = '';
			if (secondaryInput && secondaryInput.value !== '') secondaryInput.value = '';
			return;
		}

		if (currentFilter.type === 'text' && inputType === 'text') {
			const v = (currentFilter as TextFilterCondition).value ?? '';
			if (primaryInput.value !== v) primaryInput.value = v;
		} else if (currentFilter.type === 'number' && inputType === 'number') {
			const nf = currentFilter as NumberFilterCondition;
			const v = nf.value != null ? String(nf.value) : '';
			if (primaryInput.value !== v) primaryInput.value = v;
			if (secondaryInput && nf.valueTo != null) {
				const vt = String(nf.valueTo);
				if (secondaryInput.value !== vt) secondaryInput.value = vt;
			}
		} else if (currentFilter.type === 'date' && inputType === 'date') {
			const df = currentFilter as DateFilterCondition;
			const v = df.dateFrom ?? '';
			if (primaryInput.value !== v) primaryInput.value = v;
			if (secondaryInput && df.dateTo) {
				if (secondaryInput.value !== df.dateTo) secondaryInput.value = df.dateTo;
			}
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────

	private clearCells(): void {
		for (const cell of this.cells.values()) cell.remove();
		this.cells.clear();
		this.lastVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1 };
		this.lastFilterModel = null;
		this.lastTopologyVersion = -1;
	}
}
