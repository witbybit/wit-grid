import type { GridApi as PublicGridApi } from '../../api/GridApiSurfaces.js';
import { isDomCellEditorSpec, type ColumnDef, type DomCellEditorHandle, type DomCellRendererHandle } from '../../columnDef.js';
import type { RecordRow } from '../../records/recordModel.js';
import { h } from './ui.js';

/**
 * One field drawn the way its column draws it: the column's DOM renderer when it has one (status
 * pills, people, progress, ratings), else its formatted text. Recycled across records with show().
 */
export class FieldValue<TRowData = unknown> {
	readonly element: HTMLElement;
	private handle: DomCellRendererHandle | null = null;
	private text: Text | null = null;

	constructor(
		readonly col: ColumnDef<TRowData>,
		private readonly api: PublicGridApi<TRowData>
	) {
		this.element = h('div', 'og-ws-field-value');
	}

	show(row: RecordRow<TRowData>): void {
		const value = this.api.getCellValue?.(row.id, this.col.field) ?? (row.data as Record<string, unknown> | null)?.[this.col.field];
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
		this.element.classList.toggle('og-ws-field-empty', formatted === '');
	}

	destroy(): void {
		this.handle?.destroy?.();
		this.handle = null;
	}
}

/**
 * The column's own editor mounted in place (the inspector), committing through the grid's edit
 * pipeline (validation, capabilities, history). Resolves when the edit ends.
 */
export function mountFieldEditor<T>(
	host: HTMLElement,
	api: PublicGridApi<T>,
	rowId: string,
	col: ColumnDef<T>,
	done: (committed: boolean) => void
): () => void {
	const value = api.getCellValue(rowId, col.field);
	let draft = value;
	let alive = true;
	let pending = false;
	let handle: DomCellEditorHandle | undefined;
	const container = h('div', 'og-ws-editor');
	const error = h('div', 'og-ws-editor-error', { role: 'alert' });
	host.append(container, error);
	const finish = (committed: boolean) => {
		if (!alive) return;
		done(committed);
	};
	const commit = async (next = draft) => {
		if (pending || !alive) return;
		if (next === value) return finish(false);
		pending = true;
		container.setAttribute('aria-busy', 'true');
		try {
			const accepted = await api.commitEdit(rowId, col.field, next);
			if (!alive) return;
			if (accepted) return finish(true);
			error.textContent = 'That value was not accepted.';
		} catch {
			if (alive) error.textContent = 'Could not save. Try again.';
		}
		pending = false;
		container.removeAttribute('aria-busy');
	};
	if (isDomCellEditorSpec<T>(col.cellEditor)) {
		handle = col.cellEditor.editor.mount(container, {
			col,
			api,
			rowId,
			colField: col.field,
			colId: col.colId,
			value,
			onChange: (next) => {
				draft = next;
			},
			onCommit: (next) => void commit(next === undefined ? draft : next),
			onCancel: () => finish(false),
		});
	} else {
		const multiline = typeof value === 'string' && value.length > 60;
		const input = multiline ? h('textarea', 'og-ws-input', { rows: 4 }) : h('input', 'og-ws-input');
		if (input instanceof HTMLInputElement) input.type = typeof value === 'number' ? 'number' : 'text';
		input.setAttribute('aria-label', col.header ?? col.field);
		input.value = value == null ? '' : String(value);
		input.addEventListener('input', () => {
			draft = typeof value === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
		});
		input.addEventListener('keydown', (event) => {
			const key = (event as KeyboardEvent).key;
			if (key === 'Enter' && (!multiline || (event as KeyboardEvent).ctrlKey || (event as KeyboardEvent).metaKey)) {
				event.preventDefault();
				void commit();
			}
			if (key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				finish(false);
			}
		});
		input.addEventListener('blur', () => void commit());
		container.append(input);
		input.focus();
		if (input instanceof HTMLInputElement) input.select();
	}
	return () => {
		alive = false;
		handle?.destroy?.();
		container.remove();
		error.remove();
	};
}

/** Columns whose editor is a grid-only (adapter) component: edit them in the table. */
export function editsInTable<T>(col: ColumnDef<T>, value: unknown): boolean {
	if (col.cellEditor && !isDomCellEditorSpec(col.cellEditor)) return true;
	return !col.cellEditor && value != null && typeof value === 'object';
}
