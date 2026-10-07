/**
 * The grid's host for column filter editors: the header funnel popover, and the editor embedded
 * in the header menu, the floating filter row and the chip bar's popover. Every surface mounts the
 * same editor (from the column's filter definition) and applies changes to the same filter model.
 */
import type { GridEngine } from '../engine/GridEngine.js';
import { applyFilterToModel } from '../filterOperations.js';
import type { ColumnFilter } from '../filterModel.js';
import { createFilterEditor, type AdapterFilterMount } from '../filters/filterEditors.js';
import { resolveColumnFilterDef, type DomFilterEditorHandle, type FilterSurface } from '../filters/filterDef.js';
import { openCellPopover, type CellPopover } from '../cells/popover.js';

export class FilterPopoverController<TRowData = unknown> {
	/** Set by adapters (React) to render `filterDef.renderFilter` components. */
	public mountAdapterFilter?: AdapterFilterMount;

	private popover: CellPopover | null = null;
	private handle: DomFilterEditorHandle | null = null;
	private anchor: HTMLElement | null = null;

	constructor(private readonly engine: GridEngine<TRowData>) {}

	/** Whether a column filters at all. */
	public isFilterable(colField: string): boolean {
		const column = this.engine.columns.getColumnDef(colField);
		return !!column && resolveColumnFilterDef(column) !== null;
	}

	/** Mounts a column's filter editor into a container; returns its handle (null: no filtering). */
	public mountEditor(
		container: HTMLElement,
		colField: string,
		surface: FilterSurface,
		onClose?: () => void,
		/** Told of each filter the editor applies. */
		onApplied?: (filter: ColumnFilter | null) => void
	): DomFilterEditorHandle | null {
		const column = this.engine.columns.getColumnDef(colField);
		const def = column ? resolveColumnFilterDef(column) : null;
		if (!def) return null;
		const editor = createFilterEditor(def, surface, this.mountAdapterFilter);
		return editor.mount(container, {
			colField,
			filterDef: def,
			filter: (this.engine.stateManager.getState().filterModel?.[colField] as ColumnFilter | undefined) ?? null,
			surface,
			onChange: (filter) => {
				onApplied?.(filter);
				this.apply(colField, filter);
			},
			onClose,
			distinctValues: () => this.engine.getColumnDistinctValueSummary(colField),
		});
	}

	public apply(colField: string, filter: ColumnFilter | null): void {
		const model = this.engine.stateManager.getState().filterModel ?? null;
		this.engine.setFilterModel(applyFilterToModel(colField, filter, model));
	}

	/** Opens (or, on the same anchor, closes) the filter popover of a column under `anchor`. */
	public open(anchor: HTMLElement, colField: string): void {
		if (this.popover && this.anchor === anchor) {
			this.close();
			return;
		}
		this.close();
		const column = this.engine.columns.getColumnDef(colField);
		if (!column || !resolveColumnFilterDef(column)) return;
		const panel = document.createElement('div');
		panel.className = 'og-flt-panel';
		const head = document.createElement('div');
		head.className = 'og-flt-panel-head';
		const title = document.createElement('div');
		title.className = 'og-flt-panel-title';
		const prefix = document.createElement('span');
		prefix.textContent = 'Filter · ';
		title.append(prefix, column.header ?? colField);
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'og-ct-btn';
		clear.setAttribute('data-ghost', '');
		clear.textContent = 'Clear';
		clear.addEventListener('mousedown', (event) => event.preventDefault());
		clear.addEventListener('click', () => {
			this.apply(colField, null);
			// Remount so the editor shows the cleared state.
			this.handle?.destroy?.();
			body.textContent = '';
			this.handle = this.mountEditor(body, colField, 'popover', () => this.close());
			this.handle?.focus?.();
		});
		head.append(title, clear);
		const body = document.createElement('div');
		panel.append(head, body);
		this.anchor = anchor;
		this.popover = openCellPopover({
			anchor,
			content: panel,
			label: `Filter ${column.header ?? colField}`,
			onDismiss: () => this.teardown(),
		});
		this.handle = this.mountEditor(body, colField, 'popover', () => this.close());
		this.popover.reposition();
		this.handle?.focus?.();
	}

	public close(): void {
		this.popover?.close();
		this.teardown();
	}

	private teardown(): void {
		this.handle?.destroy?.();
		this.handle = null;
		this.popover = null;
		this.anchor = null;
	}
}
