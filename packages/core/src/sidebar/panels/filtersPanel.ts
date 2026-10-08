/**
 * Filters: every filterable column as a section holding its filter editor (the grid's own, from
 * the column's `filterDef`). A collapsed section summarizes its filter.
 */
import type { ColumnDef } from '../../columnDef.js';
import type { ColumnFilter, FilterModel } from '../../filterModel.js';
import { applyFilterToModel, summarizeFilter } from '../../filterOperations.js';
import type { DomFilterEditorHandle } from '../../filters/filterDef.js';
import { resolveColumnFilterDef } from '../../filters/filterDef.js';
import { disposables, el, emptyState, icon, iconButton, searchField, textButton } from '../panelKit.js';
import type { SidebarPanel } from '../sidebarTypes.js';

interface Section {
	field: string;
	element: HTMLDivElement;
	toggle: HTMLButtonElement;
	summary: HTMLSpanElement;
	clear: HTMLButtonElement;
	body: HTMLDivElement | null;
	editor: DomFilterEditorHandle | null;
	/** The filter the editor last applied or was mounted with. */
	shown: ColumnFilter | null;
}

export const filtersPanel: SidebarPanel<any> = {
	mount(container, { api, actions, mountFilterEditor }) {
		const d = disposables();
		const model = () => (api.getStateSnapshot().filterModel as FilterModel | null) ?? null;
		const filterOf = (field: string) => (model()?.[field] as ColumnFilter | undefined) ?? null;
		const apply = (field: string, filter: ColumnFilter | null) => api.setFilterModel(applyFilterToModel(field, filter, model()));

		const root = el('div', 'og-sb-stack');
		const search = searchField('Find a column…', (q) => {
			query = q;
			build();
		});
		const list = el('div', 'og-sb-sections');
		root.append(search.element, list);
		container.appendChild(root);

		const clearAll = textButton('Clear all', () => api.setFilterModel(null));
		actions.appendChild(clearAll);

		let query = '';
		// Filtered columns start open; the rest open on demand.
		const open = new Set(Object.keys(model() ?? {}));
		const sections = new Map<string, Section>();

		const mountEditor = (section: Section) => {
			section.editor?.destroy?.();
			section.body!.textContent = '';
			section.shown = filterOf(section.field);
			section.editor = mountFilterEditor(section.body!, section.field, { onApplied: (applied) => (section.shown = applied) });
		};

		const setOpen = (section: Section, next: boolean) => {
			if (next) open.add(section.field);
			else open.delete(section.field);
			section.element.toggleAttribute('data-open', next);
			section.toggle.setAttribute('aria-expanded', String(next));
			if (next && !section.body) {
				section.body = section.element.appendChild(el('div', 'og-sb-section-body'));
				mountEditor(section);
			} else if (!next && section.body) {
				section.editor?.destroy?.();
				section.editor = null;
				section.body.remove();
				section.body = null;
			}
		};

		const paint = (section: Section, column: ColumnDef<any>) => {
			const filter = filterOf(section.field);
			section.element.toggleAttribute('data-active', !!filter);
			section.summary.textContent = filter ? summarizeFilter(filter, resolveColumnFilterDef(column)) : '';
			section.clear.hidden = !filter;
			// A filter set elsewhere (header, floating row, chip, api): show it in the editor.
			if (section.body && filter !== section.shown) mountEditor(section);
		};

		const columns = () => api.getDisplayedColumns().filter((column) => resolveColumnFilterDef(column) !== null);

		const build = () => {
			for (const section of sections.values()) section.editor?.destroy?.();
			sections.clear();
			list.textContent = '';
			const all = columns();
			if (all.length === 0) {
				list.appendChild(emptyState('filter', 'Nothing to filter', 'None of the columns are filterable.'));
				return;
			}
			const shown = query ? all.filter((c) => `${c.header ?? ''} ${c.field}`.toLowerCase().includes(query)) : all;
			if (shown.length === 0) {
				list.appendChild(emptyState('search', 'No columns match', `Nothing is called “${query}”.`));
				return;
			}
			for (const column of shown) {
				const label = column.header || column.field;
				const element = el('div', 'og-sb-section');
				const head = el('div', 'og-sb-section-head');
				const toggle = el('button', 'og-sb-section-toggle');
				toggle.type = 'button';
				const chevron = icon('chevronRight', 14);
				chevron.classList.add('og-sb-chevron');
				const text = el('span', 'og-sb-section-text');
				const summary = el('span', 'og-sb-section-summary');
				text.append(el('span', 'og-sb-section-label', label), summary);
				toggle.append(chevron, text);
				const clear = iconButton('x', `Clear ${label} filter`, () => apply(column.field, null), 13);
				clear.classList.add('og-sb-section-clear');
				head.append(toggle, clear);
				element.appendChild(head);
				list.appendChild(element);
				const section: Section = { field: column.field, element, toggle, summary, clear, body: null, editor: null, shown: null };
				sections.set(column.field, section);
				toggle.addEventListener('click', () => setOpen(section, !open.has(column.field)));
				setOpen(section, open.has(column.field));
				paint(section, column);
			}
		};

		const sync = () => {
			const count = Object.keys(model() ?? {}).length;
			clearAll.hidden = count === 0;
			for (const column of columns()) {
				const section = sections.get(column.field);
				if (section) paint(section, column);
			}
		};

		build();
		sync();
		d.add(api.subscribeToKey('filterModel', sync));
		d.add(api.subscribeToKey('columns', build));
		return {
			destroy() {
				d.dispose();
				for (const section of sections.values()) section.editor?.destroy?.();
			},
		};
	},
};
