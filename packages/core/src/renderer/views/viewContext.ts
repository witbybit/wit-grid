import type { ColumnDef, DomCellRendererHandle } from '../../columnDef.js';
import type { GridApi as PublicGridApi } from '../../api/GridApiSurfaces.js';
import { resolveCellColor, type CellColor } from '../../cells/palette.js';

export interface ViewRow<TRowData = unknown> {
	id: string;
	data: TRowData;
}

/** What a view reads from the grid: its displayed rows and columns, and the api to write through. */
export interface GridViewContext<TRowData = unknown> {
	api: PublicGridApi<TRowData>;
	/** Displayed data rows, in display order (filters and sort applied). */
	rows(): readonly ViewRow<TRowData>[];
	/** Displayed columns, in order. */
	columns(): readonly ColumnDef<TRowData>[];
	/** Back to the table, at this row. */
	openInTable(rowId: string): void;
}

export interface GridViewInstance {
	/** Redraw from the current rows (data, filter or sort changed, or the view resized). */
	render(): void;
	destroy(): void;
}

export function viewColour(colour: string | undefined): string | undefined {
	return colour ? (resolveCellColor(colour as CellColor) ?? colour) : undefined;
}

/**
 * One field drawn the way its column draws it: the column's DOM renderer when it has one (status
 * pills, people, progress), else its formatted text. Recycled across rows with update().
 */
export class ViewField<TRowData = unknown> {
	readonly element: HTMLElement;
	private handle: DomCellRendererHandle | null = null;
	private text: Text | null = null;

	constructor(
		private readonly col: ColumnDef<TRowData>,
		private readonly api: PublicGridApi<TRowData>
	) {
		this.element = document.createElement('div');
		this.element.className = 'og-view-field-value';
	}

	show(row: ViewRow<TRowData>): void {
		const value = (row.data as Record<string, unknown> | null)?.[this.col.field];
		const spec = this.col.renderer;
		if (spec?.kind === 'dom') {
			const params = {
				container: this.element,
				value,
				node: row,
				col: this.col,
				isEditing: false,
				isScrolling: false,
				phase: 'initial' as const,
				isFocused: false,
				isSelected: false,
				api: this.api,
			};
			if (this.handle) this.handle.update(params);
			else this.handle = spec.renderer.mount(this.element, params);
			return;
		}
		const formatted =
			value == null
				? ''
				: this.col.valueFormatter
					? this.col.valueFormatter({ value, rowData: row.data, colDef: this.col, rowId: row.id })
					: String(value);
		if (!this.text) {
			this.text = document.createTextNode('');
			this.element.appendChild(this.text);
		}
		if (this.text.data !== formatted) this.text.data = formatted;
	}

	destroy(): void {
		this.handle?.destroy?.();
		this.handle = null;
	}
}

/** The text a field shows (titles, calendar entries). */
export function fieldText<TRowData>(col: ColumnDef<TRowData> | undefined, row: ViewRow<TRowData>): string {
	if (!col) return row.id;
	const value = (row.data as Record<string, unknown> | null)?.[col.field];
	if (value == null) return '';
	return col.valueFormatter ? col.valueFormatter({ value, rowData: row.data, colDef: col, rowId: row.id }) : String(value);
}
