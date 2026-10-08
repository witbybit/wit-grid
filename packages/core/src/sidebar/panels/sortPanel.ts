/**
 * Sort: the sort rules in priority order. Drag a rule (or press ↑ / ↓ on its handle) to reorder,
 * flip its direction, remove it, or add a column from a searchable list.
 */
import { createCellListbox } from '../../cells/listbox.js';
import { openCellPopover, type CellPopover } from '../../cells/popover.js';
import type { ColumnDef } from '../../columnDef.js';
import { resolveColumnFilterDef } from '../../filters/filterDef.js';
import type { SortModel } from '../../rowModel.js';
import { disposables, el, emptyState, icon, iconButton, textButton } from '../panelKit.js';
import type { SidebarPanel } from '../sidebarTypes.js';

type SortItem = SortModel[number];

/** Direction labels that read like the column's values. */
function directionLabels(column: ColumnDef<any> | undefined, sample: unknown): [string, string] {
	const kind = column ? resolveColumnFilterDef(column)?.type : undefined;
	// A custom filter says nothing of the values: the first row's tells numbers apart.
	if (kind === 'number' || ((kind === 'custom' || kind === undefined) && typeof sample === 'number')) return ['1 → 9', '9 → 1'];
	if (kind === 'date' || kind === 'dateRange') return ['Old → New', 'New → Old'];
	if (kind === 'boolean') return ['No → Yes', 'Yes → No'];
	return ['A → Z', 'Z → A'];
}

export const sortPanel: SidebarPanel<any> = {
	mount(container, { api, actions }) {
		const d = disposables();
		const root = el('div', 'og-sb-stack');
		container.appendChild(root);
		const clearAll = textButton('Clear all', () => api.setSortModel(null));
		actions.appendChild(clearAll);
		let picker: CellPopover | null = null;

		const items = (): SortItem[] => (api.getStateSnapshot().sortModel as SortModel | null) ?? [];
		const columnOf = (field: string) => api.getColumns().find((c) => c.field === field);
		const labelOf = (field: string) => {
			const column = columnOf(field);
			return column?.header || column?.field || field;
		};
		const commit = (next: SortItem[]) => api.setSortModel(next.length > 0 ? next : null);
		const move = (from: number, to: number) => {
			const next = [...items()];
			const [item] = next.splice(from, 1);
			next.splice(to, 0, item);
			commit(next);
		};

		const openPicker = (anchor: HTMLElement) => {
			picker?.close();
			const used = new Set(items().map((item) => item.colId));
			const options = api
				.getColumns()
				.filter((c) => c.sortable !== false && !used.has(c.field) && !c.field.startsWith('__'))
				.map((c) => ({ value: c.field, label: c.header || c.field }));
			const listbox = createCellListbox({
				options,
				selected: [],
				searchable: options.length > 6,
				searchPlaceholder: 'Find a column…',
				emptyText: 'Every column is sorted',
				onSelect: (value) => {
					picker?.close();
					if (value) commit([...items(), { colId: value, sort: 'asc' }]);
				},
			});
			picker = openCellPopover({
				anchor,
				content: listbox.element,
				label: 'Add a sort column',
				matchAnchorWidth: true,
				onDismiss: () => (picker = null),
			});
			listbox.focus();
		};

		let dragFrom = -1;
		const render = () => {
			const list = items();
			clearAll.hidden = list.length === 0;
			root.textContent = '';
			if (list.length === 0) {
				root.appendChild(emptyState('sort', 'No sorting', 'Rows keep their original order. Add a sort here, or click a column header.'));
			} else {
				const rules = el('div', 'og-sb-rules');
				rules.setAttribute('role', 'list');
				list.forEach((item, index) => {
					const column = columnOf(item.colId);
					const rule = el('div', 'og-sb-rule');
					rule.setAttribute('role', 'listitem');
					rule.draggable = true;
					const grip = el('button', 'og-sb-grip');
					grip.type = 'button';
					grip.title = 'Drag, or press ↑ / ↓, to change priority';
					grip.setAttribute('aria-label', `Priority ${index + 1}: ${labelOf(item.colId)}. Press up or down to move.`);
					grip.appendChild(icon('grip', 14));
					grip.addEventListener('keydown', (event) => {
						const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
						if (to < 0 || to >= list.length) return;
						event.preventDefault();
						move(index, to);
						root.querySelectorAll<HTMLElement>('.og-sb-grip')[to]?.focus();
					});
					const order = el('span', 'og-sb-rule-order', String(index + 1));
					const name = el('span', 'og-sb-rule-name', labelOf(item.colId));
					name.title = labelOf(item.colId);
					const sample = (api.getDisplayedRowAtIndex(0)?.data as Record<string, unknown> | undefined)?.[item.colId];
					const [ascLabel, descLabel] = directionLabels(column, sample);
					const direction = el('div', 'og-sb-seg');
					direction.setAttribute('role', 'radiogroup');
					direction.setAttribute('aria-label', 'Direction');
					for (const [value, text] of [
						['asc', ascLabel],
						['desc', descLabel],
					] as const) {
						const option = el('button', 'og-sb-seg-btn', text);
						option.type = 'button';
						option.setAttribute('role', 'radio');
						option.setAttribute('aria-checked', String(item.sort === value));
						option.addEventListener('click', () => {
							if (item.sort === value) return;
							commit(list.map((other, i) => (i === index ? { ...other, sort: value } : other)));
						});
						direction.appendChild(option);
					}
					const remove = iconButton('x', `Remove ${labelOf(item.colId)} sort`, () => commit(list.filter((_, i) => i !== index)), 13);
					const top = el('div', 'og-sb-rule-top');
					top.append(grip, order, name, remove);
					rule.append(top, direction);

					rule.addEventListener('dragstart', (event) => {
						dragFrom = index;
						rule.setAttribute('data-dragging', '');
						event.dataTransfer?.setData('text/plain', item.colId);
						if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
					});
					rule.addEventListener('dragend', () => {
						dragFrom = -1;
						rule.removeAttribute('data-dragging');
						rules.querySelectorAll('[data-drop]').forEach((node) => node.removeAttribute('data-drop'));
					});
					rule.addEventListener('dragover', (event) => {
						if (dragFrom < 0 || dragFrom === index) return;
						event.preventDefault();
						rules.querySelectorAll('[data-drop]').forEach((node) => node.removeAttribute('data-drop'));
						rule.setAttribute('data-drop', dragFrom < index ? 'after' : 'before');
					});
					rule.addEventListener('drop', (event) => {
						event.preventDefault();
						if (dragFrom >= 0 && dragFrom !== index) move(dragFrom, index);
					});
					rules.appendChild(rule);
				});
				root.appendChild(rules);
			}
			const sortable = api.getColumns().some((c) => c.sortable !== false && !c.field.startsWith('__') && !list.some((i) => i.colId === c.field));
			if (sortable) {
				const add = textButton(list.length === 0 ? 'Add a sort' : 'Add another sort', () => openPicker(add), 'subtle', 'plus');
				add.classList.add('og-sb-add');
				root.appendChild(add);
			}
			if (list.length > 1) root.appendChild(el('div', 'og-sb-hint', 'Rows sort by the first rule, then by the next to break ties.'));
		};

		render();
		d.add(api.subscribeToKey('sortModel', render));
		d.add(api.subscribeToKey('columns', render));
		return {
			destroy() {
				picker?.close();
				d.dispose();
			},
		};
	},
};
