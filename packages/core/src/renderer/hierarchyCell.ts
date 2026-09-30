import type { ColumnDef } from '../columnDef.js';
import type { HierarchyCellContext, HierarchyColumnConfig } from '../rows/hierarchyConfig.js';
import type { DescendantSelectionState } from '../rows/hierarchyIndex.js';
import type { VisualRow } from '../visualRow.js';

/** Everything the hierarchy cell shows, resolved once per bind; the writer only diffs it onto the DOM. */
export interface HierarchyCellModel {
	/** Visual row id the toggle and checkbox act on. */
	targetId: string;
	indentPx: number;
	/** null: the row has no children (the toggle slot keeps the label aligned). */
	toggle: 'open' | 'closed' | null;
	/** null: no checkbox part. */
	checkbox: DescendantSelectionState | null;
	label: string;
	count: string | null;
	cellClass: string;
}

export interface HierarchyCellDeps<TData> {
	getColumn(field: string): ColumnDef<TData> | undefined;
	getCellValue(rowId: string, field: string): unknown;
	isRowSelected(rowId: string): boolean;
	getDescendantSelection(id: string): DescendantSelectionState;
}

export interface HierarchyCellInputs<TData> {
	config: HierarchyColumnConfig<TData> | undefined;
	/** `treeData.column`: the field tree rows show. */
	treeColumn: string | undefined;
	isTree: boolean;
}

const DEFAULT_INDENT = 16;

function formatWith<TData>(column: ColumnDef<TData> | undefined, value: unknown, data: TData | undefined, rowId: string): string {
	if (value == null || value === '')
		return column?.valueFormatter ? column.valueFormatter({ value, rowData: data as TData, colDef: column, rowId }) : '';
	if (column?.valueFormatter) return column.valueFormatter({ value, rowData: data as TData, colDef: column, rowId });
	return String(value);
}

/** Resolves the hierarchy cell for a group, total or data row (tree rows and grouped leaves). */
export function resolveHierarchyCellModel<TData>(
	row: VisualRow<TData>,
	inputs: HierarchyCellInputs<TData>,
	deps: HierarchyCellDeps<TData>
): HierarchyCellModel | null {
	if (row.kind !== 'group' && row.kind !== 'total' && row.kind !== 'data') return null;
	const { config } = inputs;
	const { hierarchy } = row;
	const show = config?.show;

	let ctx: HierarchyCellContext<TData>;
	if (row.kind === 'group') {
		const column = deps.getColumn(row.field);
		const formatted = row.key == null || row.key === '' ? '(Blank)' : formatWith(column, row.key, undefined, row.id) || String(row.key);
		ctx = {
			kind: 'group',
			id: row.id,
			level: hierarchy.level,
			hasChildren: hierarchy.hasChildren,
			expanded: hierarchy.expanded,
			leafCount: hierarchy.leafCount,
			value: row.key,
			formattedValue: formatted,
			field: row.field,
			aggregates: row.aggregates,
		};
	} else if (row.kind === 'total') {
		ctx = {
			kind: 'total',
			id: row.id,
			level: hierarchy.level,
			hasChildren: false,
			expanded: false,
			leafCount: 0,
			value: null,
			formattedValue: row.scope === 'grand' ? 'Grand total' : 'Total',
			field: null,
			aggregates: row.aggregates,
		};
	} else {
		const field = inputs.isTree ? inputs.treeColumn : undefined;
		const value = field ? deps.getCellValue(row.rowId, field) : undefined;
		ctx = {
			kind: 'data',
			id: row.id,
			level: hierarchy.level,
			hasChildren: hierarchy.hasChildren,
			expanded: hierarchy.expanded,
			leafCount: hierarchy.leafCount,
			value,
			formattedValue: field ? formatWith(deps.getColumn(field), value, row.node.data, row.rowId) : '',
			field: field ?? null,
			data: row.node.data,
			aggregates: row.aggregates,
		};
	}

	const label = config?.label ? config.label(ctx) : ctx.formattedValue;
	const count = config?.count ? config.count(ctx) : (show?.count ?? true) && ctx.kind === 'group' ? String(ctx.leafCount) : null;
	let checkbox: DescendantSelectionState | null = null;
	if (show?.checkbox && ctx.kind !== 'total') {
		checkbox = ctx.kind === 'group' ? deps.getDescendantSelection(ctx.id) : deps.isRowSelected((row as { rowId: string }).rowId) ? 'all' : 'none';
	}
	const extraClass = typeof config?.cellClass === 'function' ? config.cellClass(ctx) : config?.cellClass;
	return {
		targetId: ctx.id,
		indentPx: ctx.level * (config?.indentPerLevel ?? DEFAULT_INDENT),
		toggle: (show?.toggle ?? true) && ctx.hasChildren ? (ctx.expanded ? 'open' : 'closed') : null,
		checkbox,
		label,
		count,
		cellClass: `og-cell-hierarchy og-cell-hierarchy-${ctx.kind}${extraClass ? ' ' + extraClass : ''}`,
	};
}

/** The cell's parts, created once per cell and reused across rebinds. */
export interface HierarchyCellParts {
	root: HTMLDivElement;
	toggle: HTMLSpanElement;
	checkbox: HTMLInputElement | null;
	label: HTMLSpanElement;
	count: HTMLSpanElement;
	last: {
		indentPx: number;
		toggle: HierarchyCellModel['toggle'] | undefined;
		targetId: string;
		checkbox: DescendantSelectionState | null | undefined;
		label: string;
		count: string | null | undefined;
	};
}

function createParts(content: HTMLElement): HierarchyCellParts {
	content.textContent = '';
	const root = document.createElement('div');
	root.className = 'og-hierarchy';
	const toggle = document.createElement('span');
	toggle.className = 'og-hierarchy-toggle';
	const label = document.createElement('span');
	label.className = 'og-hierarchy-label';
	const count = document.createElement('span');
	count.className = 'og-hierarchy-count';
	root.append(toggle, label, count);
	content.appendChild(root);
	return {
		root,
		toggle,
		checkbox: null,
		label,
		count,
		last: { indentPx: -1, toggle: undefined, targetId: '', checkbox: undefined, label: '', count: undefined },
	};
}

/**
 * Writes a hierarchy cell, touching only what changed since the last write. Returns the parts to
 * keep on the cell. Cheap enough for every scroll frame: at most a handful of attribute and text
 * writes, no allocation after the first bind.
 */
export function writeHierarchyCell(content: HTMLElement, existing: HierarchyCellParts | null, model: HierarchyCellModel): HierarchyCellParts {
	const parts = existing && existing.root.parentNode === content ? existing : createParts(content);
	const last = parts.last;

	if (last.indentPx !== model.indentPx) {
		parts.root.style.paddingLeft = `${model.indentPx}px`;
		last.indentPx = model.indentPx;
	}
	if (last.targetId !== model.targetId) {
		parts.toggle.dataset.ogHierarchyToggle = model.targetId;
		if (parts.checkbox) parts.checkbox.dataset.ogHierarchySelect = model.targetId;
		last.targetId = model.targetId;
	}
	if (last.toggle !== model.toggle) {
		parts.toggle.className =
			model.toggle === null ? 'og-hierarchy-toggle og-hierarchy-toggle-none' : `og-hierarchy-toggle og-hierarchy-toggle-${model.toggle}`;
		if (model.toggle === null) {
			parts.toggle.removeAttribute('role');
			parts.toggle.removeAttribute('aria-expanded');
			parts.toggle.textContent = '';
		} else {
			parts.toggle.setAttribute('role', 'button');
			parts.toggle.setAttribute('aria-expanded', String(model.toggle === 'open'));
			parts.toggle.setAttribute('aria-label', model.toggle === 'open' ? 'Collapse' : 'Expand');
			if (last.toggle == null) parts.toggle.textContent = '▸';
		}
		last.toggle = model.toggle;
	}
	if (last.checkbox !== model.checkbox) {
		if (model.checkbox === null) {
			parts.checkbox?.remove();
			parts.checkbox = null;
		} else {
			if (!parts.checkbox) {
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.className = 'og-hierarchy-checkbox';
				checkbox.tabIndex = -1;
				checkbox.dataset.ogHierarchySelect = model.targetId;
				parts.root.insertBefore(checkbox, parts.label);
				parts.checkbox = checkbox;
			}
			parts.checkbox.checked = model.checkbox === 'all';
			parts.checkbox.indeterminate = model.checkbox === 'some';
		}
		last.checkbox = model.checkbox;
	}
	if (last.label !== model.label) {
		parts.label.textContent = model.label;
		last.label = model.label;
	}
	if (last.count !== model.count) {
		parts.count.textContent = model.count ?? '';
		parts.count.hidden = model.count === null;
		last.count = model.count;
	}
	return parts;
}
