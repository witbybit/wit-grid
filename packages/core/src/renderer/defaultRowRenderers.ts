import { GridEventName } from '../api/GridEvents.js';
import type { GridApi } from '../api/GridApiSurfaces.js';
import { isGroupingActive, type DomRowRenderer, type RowRendererParams } from '../rows/hierarchyConfig.js';
import type { VisualRow } from '../visualRow.js';
import { resolveHierarchyCellModel, writeHierarchyCell, type HierarchyCellParts } from './hierarchyCell.js';

/**
 * Core's own full-width row renderers, used when neither a `RowRendererSpec` nor the adapter draws
 * a row. Written against the public grid API only, so they are exactly what a user DOM renderer
 * could do — adapters need no hierarchy logic of their own.
 */

function formatAggregate<TData>(api: GridApi<TData>, colId: string, value: unknown, rowId: string): string {
	const column = api.getColumnDef(colId);
	if (column?.valueFormatter) return column.valueFormatter({ value, rowData: undefined as TData, colDef: column, rowId });
	return value == null ? '' : String(value);
}

interface AggregateChip {
	chip: HTMLSpanElement;
	label: HTMLSpanElement;
	strong: HTMLElement;
}

/**
 * Aggregate chips (`Header value`) in column order, through each column's formatter. Chip elements
 * are kept per aggregate column and patched: only changed text is written, and chips are added or
 * removed only when the set of aggregates with a value changes.
 */
function writeAggregates<TData>(
	host: HTMLElement,
	chips: Map<string, AggregateChip>,
	api: GridApi<TData>,
	row: Extract<VisualRow<TData>, { aggregates: Record<string, unknown> }>
): void {
	const used = new Set<string>();
	let index = 0;
	for (const def of api.getAggregation()) {
		const value = row.aggregates[def.colId];
		if (value == null) continue;
		let entry = chips.get(def.colId);
		if (!entry) {
			const chip = document.createElement('span');
			chip.className = 'og-full-width-aggregate';
			const label = document.createElement('span');
			const strong = document.createElement('strong');
			chip.append(label, strong);
			entry = { chip, label, strong };
			chips.set(def.colId, entry);
		}
		used.add(def.colId);
		const labelText = api.getColumnDef(def.colId)?.header ?? def.colId;
		if (entry.label.textContent !== labelText) entry.label.textContent = labelText;
		const valueText = formatAggregate(api, def.colId, value, row.id);
		if (entry.strong.textContent !== valueText) entry.strong.textContent = valueText;
		if (host.children[index] !== entry.chip) host.insertBefore(entry.chip, host.children[index] ?? null);
		index++;
	}
	for (const [colId, entry] of chips) {
		if (used.has(colId)) continue;
		entry.chip.remove();
		chips.delete(colId);
	}
}

function hierarchyModel<TData>(api: GridApi<TData>, row: VisualRow<TData>) {
	const treeData = api.getTreeData();
	return resolveHierarchyCellModel(
		row,
		{ config: api.getHierarchyColumn() || undefined, treeColumn: treeData?.column, isTree: !isGroupingActive(api.getGrouping()) && !!treeData },
		{
			getColumn: (field) => api.getColumnDef(field),
			getCellValue: (rowId, field) => api.getCellValue(rowId, field),
			isRowSelected: (rowId) => api.isRowNodeSelected(rowId),
			getDescendantSelection: (id) => api.getDescendantSelection(id).state,
		}
	);
}

/**
 * A full-width group (or total) row: the hierarchy parts (toggle, checkbox, label, count — the
 * same parts and click handling as the hierarchy cell) followed by its aggregates.
 */
function createHierarchyRowRenderer<TData>(kind: 'group' | 'total'): DomRowRenderer<TData> {
	return {
		mount(container, initial) {
			let params: RowRendererParams<TData> = initial;
			const root = document.createElement('div');
			root.className = `og-full-width-row og-full-width-${kind}`;
			const parts = document.createElement('div');
			parts.className = 'og-full-width-hierarchy';
			const aggregates = document.createElement('div');
			aggregates.className = 'og-full-width-aggregates';
			root.append(parts, aggregates);
			container.appendChild(root);
			let hierarchyParts: HierarchyCellParts | null = null;
			const chips = new Map<string, AggregateChip>();
			const render = () => {
				const { row, api } = params;
				const model = hierarchyModel(api, row);
				if (model) hierarchyParts = writeHierarchyCell(parts, hierarchyParts, model);
				if (row.kind === 'group' || row.kind === 'total') writeAggregates(aggregates, chips, api, row);
			};
			render();
			// The checkbox reflects selection, which changes without the row changing. Only this
			// row's own selection state (all / some / none) matters; aggregates cannot have changed.
			const unsubscribe = initial.api.addEventListener(GridEventName.rowSelectionChanged, () => {
				const model = hierarchyModel(params.api, params.row);
				if (!model || (hierarchyParts && hierarchyParts.last.checkbox === model.checkbox)) return;
				hierarchyParts = writeHierarchyCell(parts, hierarchyParts, model);
			});
			return {
				update(next) {
					params = next;
					render();
				},
				destroy() {
					unsubscribe();
					root.remove();
				},
			};
		},
	};
}

function createTextRowRenderer<TData>(className: string, text: (row: VisualRow<TData>) => string): DomRowRenderer<TData> {
	return {
		mount(container, initial) {
			const root = document.createElement('div');
			root.className = `og-full-width-row ${className}`;
			root.textContent = text(initial.row);
			container.appendChild(root);
			return {
				update(next) {
					root.textContent = text(next.row);
				},
				destroy() {
					root.remove();
				},
			};
		},
	};
}

const DEFAULTS = {
	group: createHierarchyRowRenderer<unknown>('group'),
	total: createHierarchyRowRenderer<unknown>('total'),
	detail: createTextRowRenderer<unknown>('og-full-width-detail', (row) =>
		row.kind === 'detail' ? `No detail renderer is configured (row ${row.parentId}).` : ''
	),
	failed: createTextRowRenderer<unknown>('og-full-width-failed', (row) => (row.kind === 'failed' ? String(row.error ?? 'Failed to load') : '')),
	placeholder: createTextRowRenderer<unknown>('og-full-width-placeholder', (row) =>
		row.kind === 'placeholder' ? (row.reason ?? 'Unavailable') : ''
	),
} as const;

export function getDefaultRowRenderer<TData>(row: VisualRow<TData>): DomRowRenderer<TData> | undefined {
	return (DEFAULTS as Record<string, DomRowRenderer<unknown> | undefined>)[row.kind] as DomRowRenderer<TData> | undefined;
}
