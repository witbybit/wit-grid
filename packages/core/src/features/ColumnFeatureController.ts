import { isHierarchyColumn, withHierarchyColumnFor } from '../rows/hierarchyColumn.js';
import { GridEventName } from '../api/GridEvents.js';
import type { ColumnDef } from '../columnDef.js';
import type { ColumnState } from '../state/GridState.js';
import type { GridFeatureContext } from './GridFeatureContext.js';

export class ColumnFeatureController<TRowData = unknown> {
	/** The field sequence of the last column list the app declared through setColumns. */
	private lastDeclaredFields: string | null = null;

	constructor(private readonly ctx: GridFeatureContext<TRowData>) {
		// The columns the grid was created with are the first declaration.
		this.lastDeclaredFields = declaredFieldKey(ctx.getState().columns.filter((column) => !isHierarchyColumn(column)));
	}

	private applyColumnOrder(requested: ColumnDef<TRowData>[]): void {
		const state = this.ctx.getState();
		// Reordering never moves the hierarchy column out of its (pinned) place.
		const { columns } = withHierarchyColumnFor(requested, state);
		const prevFields = state.columns.map((column) => column.field);
		const nextFields = columns.map((column) => column.field);
		if (prevFields.length === nextFields.length && prevFields.every((field, index) => field === nextFields[index])) {
			return;
		}
		this.ctx.applyChange({
			reason: 'columns:order',
			state: { columns },
			invalidations: [{ kind: 'full' }],
			domains: ['columns', 'geometry'],
			events: [{ type: GridEventName.columnOrderChanged, payload: { columns, columnFields: nextFields } }],
		});
	}

	private moveColumnInList(columns: ColumnDef<TRowData>[], fromIndex: number, toIndex: number): ColumnDef<TRowData>[] {
		const nextColumns = [...columns];
		const [column] = nextColumns.splice(fromIndex, 1);
		nextColumns.splice(toIndex, 0, column);
		return nextColumns;
	}

	public resizeColumn(colField: string, width: number, undoable = true): void {
		const state = this.ctx.getState();
		const oldWidth = state.columnWidths[colField] ?? state.defaultColWidth;
		const col = state.columns.find((c) => c.field === colField);
		const clampedWidth = Math.max(col?.minWidth ?? 20, Math.min(col?.maxWidth ?? Infinity, width));
		if (oldWidth === clampedWidth) return;
		width = clampedWidth;

		this.ctx.applyChange({
			reason: 'columns:resize',
			state: (currState) => ({ columnWidths: { ...currState.columnWidths, [colField]: width } }),
			invalidations: [{ kind: 'geometry' }, { kind: 'viewport' }, { kind: 'headers' }],
			domains: ['columns', 'geometry'],
			events: [{ type: GridEventName.columnResized, payload: { colField, width } }],
			...(undoable
				? {
						history: {
							undo: {
								reason: 'columns:resize',
								state: (currState) => ({ columnWidths: { ...currState.columnWidths, [colField]: oldWidth } }),
								invalidations: [{ kind: 'geometry' }, { kind: 'viewport' }, { kind: 'headers' }],
								domains: ['columns', 'geometry'],
								events: [{ type: GridEventName.columnResized, payload: { colField, width: oldWidth } }],
							},
							redo: {
								reason: 'columns:resize',
								state: (currState) => ({ columnWidths: { ...currState.columnWidths, [colField]: width } }),
								invalidations: [{ kind: 'geometry' }, { kind: 'viewport' }, { kind: 'headers' }],
								domains: ['columns', 'geometry'],
								events: [{ type: GridEventName.columnResized, payload: { colField, width } }],
							},
						},
					}
				: {}),
		});
	}

	public moveColumn(colField: string, toIndex: number): void {
		const state = this.ctx.getState();
		const displayedColumns = this.ctx.columns.getDisplayedColumns();
		const fromIndex = displayedColumns.findIndex((column) => column.field === colField);
		if (fromIndex === -1 || !Number.isFinite(toIndex)) return;

		const boundedToIndex = Math.max(0, Math.min(displayedColumns.length - 1, Math.trunc(toIndex)));
		if (fromIndex === boundedToIndex) return;

		const nextDisplayed = this.moveColumnInList(displayedColumns, fromIndex, boundedToIndex);
		const hiddenColumns = state.columns.filter((column) => column.hide === true);
		this.applyColumnOrder([...nextDisplayed, ...hiddenColumns]);
	}

	public setColumnOrderByFields(colFields: string[]): void {
		const state = this.ctx.getState();
		const orderedFieldSet = new Set<string>();
		const orderedFields = colFields.filter((field) => {
			if (orderedFieldSet.has(field)) return false;
			orderedFieldSet.add(field);
			return true;
		});
		const columnByField = new Map(state.columns.map((column) => [column.field, column]));
		const nextColumns = orderedFields.map((field) => columnByField.get(field)).filter((column): column is ColumnDef<TRowData> => !!column);

		for (const column of state.columns) {
			if (!orderedFieldSet.has(column.field)) {
				nextColumns.push(column);
			}
		}

		this.applyColumnOrder(nextColumns);
	}

	public setColumnReorderEnabled(enabled: boolean): void {
		this.ctx.applyChange({
			reason: 'columns:reorder-toggle',
			state: { enableColumnReorder: enabled },
			invalidations: [{ kind: 'headers' }],
			events: [{ type: GridEventName.columnReorderToggled, payload: { enabled } }],
		});
	}

	public setColumns(nextColumns: ColumnDef<TRowData>[], undoable = false): void {
		const state = this.ctx.getState();
		// The hierarchy column belongs to the grouping / tree configuration, not the caller's list.
		const { columns: declaredColumns, pinnedColumns } = withHierarchyColumnFor(nextColumns, state);
		const pinnedPatch = pinnedColumns ? { pinnedColumns } : {};
		const prevColumns = state.columns;
		// The user's column moves survive a re-declaration of the same columns (a React app passing
		// a new but equivalent columns array on every render); a changed declaration (columns added,
		// removed or reordered by the app) is applied as declared.
		const declaredFields = declaredFieldKey(nextColumns);
		const columns = declaredFields === this.lastDeclaredFields ? inCurrentOrder(declaredColumns, prevColumns) : declaredColumns;
		this.lastDeclaredFields = declaredFields;
		const prevWidths = state.columnWidths;

		const nextWidths = columns.reduce<Record<string, number>>((acc, column) => {
			const existingWidth = prevWidths[column.field];
			if (existingWidth !== undefined) {
				acc[column.field] = existingWidth;
			} else if (column.width !== undefined) {
				acc[column.field] = column.width;
			}
			return acc;
		}, {});

		this.ctx.applyChange({
			reason: 'columns:set',
			state: { columns, columnWidths: nextWidths, ...pinnedPatch },
			invalidations: [{ kind: 'full' }],
			domains: ['columns', 'geometry'],
			events: [{ type: GridEventName.columnsChanged, payload: { columns, columnFields: columns.map((c) => c.field) } }],
			...(undoable
				? {
						history: {
							undo: {
								reason: 'columns:set',
								state: { columns: prevColumns, columnWidths: prevWidths },
								invalidations: [{ kind: 'full' }],
								domains: ['columns', 'geometry'],
								requestRender: true,
							},
							redo: {
								reason: 'columns:set',
								state: { columns, columnWidths: nextWidths },
								invalidations: [{ kind: 'full' }],
								domains: ['columns', 'geometry'],
								requestRender: true,
							},
						},
					}
				: {}),
		});
	}

	public getColumnState(): ColumnState[] {
		const state = this.ctx.getState();
		const { left = 0, right = 0 } = state.pinnedColumns ?? {};
		const displayedCols = state.columns.filter((c) => !c.hide);
		const displayedCount = displayedCols.length;
		const displayedIndexMap = new Map(displayedCols.map((c, i) => [c.field, i]));
		const sortMap = new Map((state.sortModel ?? []).map((s, i) => [s.colId, { sort: s.sort, sortIndex: i }]));

		return state.columns.map((col) => {
			const cs: ColumnState = { field: col.field };
			const width = state.columnWidths[col.field];
			if (width !== undefined) cs.width = width;
			if (col.hide) cs.hide = true;

			if (!col.hide) {
				const di = displayedIndexMap.get(col.field)!;
				if (di < left) cs.pinned = 'left';
				else if (right > 0 && di >= displayedCount - right) cs.pinned = 'right';
				else cs.pinned = false;
			}

			const sortEntry = sortMap.get(col.field);
			if (sortEntry !== undefined) {
				cs.sort = sortEntry.sort;
				cs.sortIndex = sortEntry.sortIndex;
			}

			return cs;
		});
	}

	public applyColumnState(states: ColumnState[], opts?: { applyOrder?: boolean }): void {
		for (const cs of states) {
			if (cs.width !== undefined) this.resizeColumn(cs.field, cs.width, false);
			if (cs.hide !== undefined) {
				const columns = this.ctx.getState().columns;
				const column = columns.find((candidate) => candidate.field === cs.field);
				if (column && column.hide !== cs.hide) {
					this.setColumns(
						columns.map((candidate) => (candidate.field === cs.field ? { ...candidate, hide: cs.hide } : candidate)),
						false
					);
				}
			}
		}
		if (opts?.applyOrder) {
			this.setColumnOrderByFields(states.map((s) => s.field));
		}
	}
}

/** `columns` in the order the same fields have in `current`; unchanged when any field is new. */
function inCurrentOrder<TRowData>(columns: ColumnDef<TRowData>[], current: readonly ColumnDef<TRowData>[]): ColumnDef<TRowData>[] {
	const position = new Map(current.map((column, index) => [column.field, index]));
	if (!columns.every((column) => position.has(column.field))) return columns;
	return [...columns].sort((a, b) => position.get(a.field)! - position.get(b.field)!);
}

function declaredFieldKey(columns: readonly { field: string }[]): string {
	return columns.map((column) => column.field).join('\u0000');
}
