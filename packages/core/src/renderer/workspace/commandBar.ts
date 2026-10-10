import type { FilterModel, SelectFilterCondition } from '../../filterModel.js';
import type { SortModel } from '../../rowModel.js';
import type { GridViewConfig } from '../../views.js';
import { defaultGridScheduler } from '../gridScheduler.js';
import { icon } from './icons.js';
import { initials } from './recordParts.js';
import { button, h, hue, openPanel } from './ui.js';
import type { WorkspaceHost } from './workspaceHost.js';
import { VIEW_META } from './viewMeta.js';
import { openCreateViewDialog, openTabMenu } from './viewManager.js';
import type { CellPopover } from '../../cells/popover.js';
import type { ColumnValueKind } from '../../cells/fieldSchema.js';

const OPTION_KINDS: readonly ColumnValueKind[] = ['select', 'multiSelect', 'person', 'tags', 'linkedRecord', 'checkbox'];

/**
 * The workspace's command bar: title and view tabs, search, presence, undo / redo and the
 * inspector toggle on the first row; the record count, the view's own controls and Filter / Sort /
 * Group / Fields on the second; the view's summary metrics beneath. The same controls work in the
 * table and every view, because they act on the grid's own models.
 */
export class CommandBar<TRowData> {
	readonly element: HTMLElement;
	private readonly tabs: HTMLElement;
	private readonly search: HTMLInputElement;
	private readonly presence: HTMLElement;
	private readonly count: HTMLElement;
	private readonly viewTools: HTMLElement;
	private readonly summary: HTMLElement;
	private readonly undo: HTMLButtonElement;
	private readonly redo: HTMLButtonElement;
	private readonly inspectorToggle: HTMLButtonElement;
	private readonly filterButton: HTMLButtonElement;
	private readonly sortButton: HTMLButtonElement;
	private readonly groupButton: HTMLButtonElement;
	private readonly fieldsButton: HTMLButtonElement;
	private readonly saveButton: HTMLButtonElement;
	private popover: CellPopover | null = null;
	private toolsFor: unknown = null;
	private searchTimer: ReturnType<typeof defaultGridScheduler.timeout> | null = null;

	constructor(private readonly host: WorkspaceHost<TRowData>) {
		const api = host.engine.getApiRef();
		this.tabs = h('div', 'og-ws-tabs', { role: 'tablist', 'aria-label': 'Views' });
		this.search = h('input', 'og-ws-search-input', { type: 'search', placeholder: 'Search records…', 'aria-label': 'Search records' });
		this.search.addEventListener('input', () => {
			if (this.searchTimer) defaultGridScheduler.clearTimeout(this.searchTimer);
			this.searchTimer = defaultGridScheduler.timeout(() => api.setQuickFilter(this.search.value), 120);
		});
		this.search.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				this.search.value = '';
				api.setQuickFilter('');
				this.search.blur();
			}
		});
		const searchBox = h('label', 'og-ws-search', null, icon('search'), this.search, h('kbd', 'og-ws-kbd', null, '/'));
		this.presence = h('div', 'og-ws-peers');
		this.undo = button({ icon: 'undo', title: 'Undo (Ctrl+Z)' }, () => api.undo());
		this.redo = button({ icon: 'redo', title: 'Redo (Ctrl+Y)' }, () => api.redo());
		this.inspectorToggle = button({ icon: 'inspector', title: 'Inspector (I)' }, () => host.toggleInspector());
		const palette = button({ icon: 'command', title: 'Command palette (Ctrl+K)', className: 'og-ws-palette-btn' }, () =>
			host.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
		);
		const title = host.options.title ? h('div', 'og-ws-title', null, host.options.title) : null;
		this.saveButton = button(
			{ icon: 'check', label: 'Save view', title: 'Save changes to this view', className: 'og-ws-btn-primary og-ws-save' },
			() => void host.saveActiveView()
		);
		this.saveButton.hidden = true;
		const top = h(
			'div',
			'og-ws-bar-row og-ws-bar-top',
			null,
			title,
			this.tabs,
			this.saveButton,
			h('span', 'og-ws-spacer'),
			searchBox,
			this.presence,
			h('span', 'og-ws-group', null, this.undo, this.redo),
			host.options.inspector === false ? null : this.inspectorToggle,
			palette
		);
		this.count = h('span', 'og-ws-count', { 'aria-live': 'polite' });
		this.viewTools = h('div', 'og-ws-view-tools');
		this.filterButton = button({ icon: 'filter', label: 'Filter' }, () => this.openFilter());
		this.sortButton = button({ icon: 'sort', label: 'Sort' }, () => this.openSort());
		this.groupButton = button({ icon: 'group', label: 'Group' }, () => this.openGroup());
		this.fieldsButton = button({ icon: 'fields', label: 'Fields' }, () => this.openFields());
		const second = h(
			'div',
			'og-ws-bar-row og-ws-bar-sub',
			null,
			this.count,
			this.viewTools,
			h('span', 'og-ws-spacer'),
			h('span', 'og-ws-group', null, this.filterButton, this.sortButton, this.groupButton, this.fieldsButton)
		);
		this.summary = h('div', 'og-ws-summary', { role: 'list', 'aria-label': 'Summary' });
		this.element = h('div', 'og-ws-bar', { role: 'toolbar', 'aria-label': 'Workspace' }, top, second, this.summary);
	}

	focusSearch(): void {
		this.search.focus();
		this.search.select();
	}

	refresh(): void {
		const host = this.host;
		const api = host.engine.getApiRef();
		const active = host.getActiveTab();
		const tabs = host.tabs();
		const workspace = api.hasWorkspace() ? api.getWorkspaceState() : null;
		const signature = tabs.map((tab) => `${tab.id}:${tab.name}:${tab.saved?.scope ?? ''}`).join('|');
		if (this.tabs.dataset.signature !== signature) {
			this.tabs.dataset.signature = signature;
			const nodes: HTMLElement[] = [];
			tabs.forEach((tab, i) => {
				if (i > 0 && (tab.saved || tab.id.startsWith('session:')) && !(tabs[i - 1].saved || tabs[i - 1].id.startsWith('session:')))
					nodes.push(h('span', 'og-ws-tab-divider', { role: 'separator' }));
				const meta = VIEW_META[tab.view?.kind ?? 'table'];
				const el = h(
					'button',
					'og-ws-tab',
					{
						type: 'button',
						role: 'tab',
						'data-tab': tab.id,
						title: tab.saved
							? `${tab.name} · ${tab.saved.scope === 'team' ? 'shared with the team' : 'personal'} — right-click for options`
							: tab.name,
					},
					icon(meta.icon),
					h('span', null, null, tab.name)
				);
				if (tab.saved?.scope === 'team') el.append(h('span', 'og-ws-scope', null, icon('users', 12)));
				el.addEventListener('click', () => host.activate(tab));
				el.addEventListener('contextmenu', (event) => {
					event.preventDefault();
					openTabMenu(host, tab, el);
				});
				nodes.push(el);
			});
			const add = button({ icon: 'plus', title: 'New view', className: 'og-ws-tab-add' }, () => void openCreateViewDialog(host));
			nodes.push(add);
			this.tabs.replaceChildren(...nodes);
		}
		for (const el of this.tabs.querySelectorAll<HTMLElement>('.og-ws-tab')) {
			const on = el.dataset.tab === active.id;
			el.setAttribute('aria-selected', String(on));
			el.tabIndex = on ? 0 : -1;
			const dirty = on && !!workspace?.dirty && !!active.saved;
			let dot = el.querySelector('.og-ws-dirty');
			if (dirty && !dot) el.append((dot = h('span', 'og-ws-dirty', { title: 'Unsaved changes' })));
			else if (!dirty) dot?.remove();
		}
		this.saveButton.hidden = !(workspace?.dirty && active.saved);
		if (document.activeElement !== this.search) this.search.value = api.getQuickFilter()?.text ?? '';
		this.undo.disabled = !api.canUndo();
		this.redo.disabled = !api.canRedo();
		this.inspectorToggle.setAttribute('aria-pressed', String(host.root.hasAttribute('data-inspecting')));
		const snapshot = api.getStateSnapshot();
		this.badge(this.filterButton, Object.keys(snapshot.filterModel ?? {}).length);
		this.badge(this.sortButton, snapshot.sortModel?.length ?? 0);
		const config = host.getViewConfig();
		const grouping = config ? this.viewGroupField(config) : null;
		this.groupButton.hidden = !!config && grouping === undefined;
		this.badge(this.groupButton, config ? (grouping ? 1 : 0) : api.getGroupBy().length);
		this.refreshCount();
		const view = host.getView();
		if (this.toolsFor !== view) {
			this.toolsFor = view;
			this.viewTools.replaceChildren();
			const tools = view?.toolbar?.();
			if (tools) this.viewTools.append(tools);
		}
		const metrics = view?.summary?.() ?? [];
		this.summary.hidden = metrics.length === 0;
		this.summary.replaceChildren(
			...metrics.map((metric) => {
				const value = h('strong', 'og-ws-metric-value', null);
				if (metric.tone) {
					const dot = h('span', 'og-ws-dot');
					dot.style.background = metric.tone;
					value.append(dot);
				}
				value.append(metric.value);
				const card = h(
					'div',
					'og-ws-metric',
					{ role: 'listitem', title: metric.title },
					h('span', 'og-ws-metric-label', null, metric.label),
					value
				);
				if (metric.meter != null) {
					const fill = h('span', 'og-ws-meter-fill');
					fill.style.width = `${Math.max(0, Math.min(1, metric.meter)) * 100}%`;
					card.append(h('span', 'og-ws-meter', null, fill));
				}
				return card;
			})
		);
	}

	refreshCount(): void {
		const host = this.host;
		const shown = host.getViewConfig() ? (host.getView()?.order().length ?? host.rows().length) : host.rows().length;
		const model = host.engine.getRowModel() as { getSourceRowCount?: () => number } | null;
		const total = model?.getSourceRowCount?.() ?? shown;
		const selected = host.selected().size;
		const noun = shown === 1 ? 'record' : 'records';
		this.count.textContent = `${shown.toLocaleString()}${total > shown ? ` of ${total.toLocaleString()}` : ''} ${noun}${selected ? ` · ${selected} selected` : ''}`;
	}

	refreshPresence(): void {
		const peers = this.host.engine.presence.peers;
		this.presence.replaceChildren(
			...peers.slice(0, 4).map((peer) => {
				const el = h('span', 'og-ws-peer', { title: peer.name }, initials(peer.name));
				el.style.setProperty('--og-ws-hue', peer.color);
				return el;
			})
		);
		if (peers.length > 4) this.presence.append(h('span', 'og-ws-peer og-ws-peer-more', null, `+${peers.length - 4}`));
	}

	private badge(el: HTMLButtonElement, count: number): void {
		let badge = el.querySelector<HTMLElement>('.og-ws-badge');
		if (!count) {
			badge?.remove();
			el.removeAttribute('data-active');
			return;
		}
		if (!badge) el.append((badge = h('span', 'og-ws-badge')));
		badge.textContent = String(count);
		el.setAttribute('data-active', '');
	}

	/** The field a view groups by (undefined when the view cannot group). */
	private viewGroupField(config: GridViewConfig<TRowData>): string | null | undefined {
		if (config.kind === 'kanban') return config.swimlaneField ?? null;
		if (config.kind === 'gallery') return config.groupBy === undefined ? (this.host.reader().roles.status ?? null) : config.groupBy;
		return undefined;
	}

	private open(anchor: HTMLElement, content: HTMLElement, label: string): void {
		this.popover?.close();
		this.popover = openPanel(anchor, content, label, () => (this.popover = null));
	}

	/** Quick filters over the option fields (status, people, priority, team, labels). */
	private openFilter(): void {
		const host = this.host;
		const api = host.engine.getApiRef();
		const reader = host.reader();
		const columns = host.recordColumns().filter((col) => col.schema && OPTION_KINDS.includes(col.schema.kind) && col.schema.kind !== 'checkbox');
		const panel = h('div', 'og-ws-filter-panel');
		const render = () => {
			const model: FilterModel = { ...(api.getStateSnapshot().filterModel ?? {}) };
			panel.replaceChildren();
			const head = h('div', 'og-ws-panel-head', null, h('strong', null, null, 'Filter'));
			const clear = button({ label: 'Clear all', className: 'og-ws-btn-quiet' }, () => {
				api.setFilterModel(null);
				render();
				this.refresh();
			});
			clear.disabled = Object.keys(model).length === 0;
			head.append(clear);
			panel.append(head);
			if (!columns.length) panel.append(h('p', 'og-ws-hint', null, 'No option fields to filter by. Column filters still apply.'));
			for (const col of columns) {
				const current = model[col.field] as SelectFilterCondition | undefined;
				const chosen = new Set((current?.type === 'select' ? current.values : []).map(String));
				const section = h('div', 'og-ws-filter-section', null, h('div', 'og-ws-section-label', null, col.header ?? col.field));
				const options = reader.options(col.field).length
					? reader.options(col.field)
					: api
							.getColumnDistinctValues(col.field)
							.filter((value) => value != null)
							.slice(0, 30)
							.map((value) => ({ value: String(value), label: String(value), color: undefined as string | undefined }));
				const list = h('div', 'og-ws-chip-list');
				for (const option of options.slice(0, 40)) {
					const chip = h('button', 'og-ws-chip', { type: 'button', 'aria-pressed': String(chosen.has(option.value)) });
					const dot = h('span', 'og-ws-dot');
					dot.style.background = hue(option.color, option.value);
					chip.append(dot, option.label ?? option.value);
					chip.addEventListener('click', () => {
						if (chosen.has(option.value)) chosen.delete(option.value);
						else chosen.add(option.value);
						const next: FilterModel = { ...(api.getStateSnapshot().filterModel ?? {}) };
						if (chosen.size)
							next[col.field] = {
								type: 'select',
								values: [...chosen],
								matchMode: col.schema?.multiple ? 'any' : undefined,
							} as SelectFilterCondition;
						else delete next[col.field];
						api.setFilterModel(Object.keys(next).length ? next : null);
						render();
						this.refresh();
					});
					list.append(chip);
				}
				section.append(list);
				panel.append(section);
			}
			const others = Object.keys(model).filter((field) => !columns.some((col) => col.field === field));
			if (others.length)
				panel.append(
					h('p', 'og-ws-hint', null, `Also filtered by ${others.map((field) => api.getColumnDef(field)?.header ?? field).join(', ')}.`)
				);
		};
		render();
		this.open(this.filterButton, panel, 'Filter');
	}

	/** Sort by a field: click cycles ascending → descending → off; Shift adds a level. */
	private openSort(): void {
		const host = this.host;
		const api = host.engine.getApiRef();
		const panel = h('div', 'og-ws-sort-panel');
		const render = () => {
			const model: SortModel = [...(api.getStateSnapshot().sortModel ?? [])];
			panel.replaceChildren(
				h('div', 'og-ws-panel-head', null, h('strong', null, null, 'Sort'), h('span', 'og-ws-hint', null, 'Shift-click adds a level'))
			);
			for (const col of host.recordColumns()) {
				const index = model.findIndex((item) => item.colId === col.field);
				const entry = model[index];
				const row = h('button', 'og-ws-list-item', { type: 'button', 'aria-pressed': String(!!entry) });
				row.append(h('span', 'og-ws-list-label', null, col.header ?? col.field));
				if (entry)
					row.append(
						h('span', 'og-ws-sort-dir', null, `${model.length > 1 ? `${index + 1} · ` : ''}${entry.sort === 'asc' ? 'A → Z' : 'Z → A'}`)
					);
				row.addEventListener('click', (event) => {
					let next: SortModel;
					const dir = !entry ? 'asc' : entry.sort === 'asc' ? 'desc' : null;
					if (event.shiftKey)
						next = dir
							? [...model.filter((item) => item.colId !== col.field), { colId: col.field, sort: dir }]
							: model.filter((item) => item.colId !== col.field);
					else next = dir ? [{ colId: col.field, sort: dir }] : [];
					api.setSortModel(next.length ? next : null);
					render();
					this.refresh();
				});
				panel.append(row);
			}
		};
		render();
		this.open(this.sortButton, panel, 'Sort');
	}

	/** Table: grid grouping. Board: swimlanes. Gallery: sections. */
	private openGroup(): void {
		const host = this.host;
		const api = host.engine.getApiRef();
		const config = host.getViewConfig();
		const reader = host.reader();
		const panel = h('div', 'og-ws-sort-panel');
		const current = config ? this.viewGroupField(config) : (api.getGroupBy()[0] ?? null);
		const label = config?.kind === 'kanban' ? 'Swimlanes' : config?.kind === 'gallery' ? 'Sections' : 'Group rows';
		panel.append(h('div', 'og-ws-panel-head', null, h('strong', null, null, label)));
		const choose = (field: string | null) => {
			if (!config) api.setGroupBy(field ? [field] : []);
			else if (config.kind === 'kanban') host.updateView({ swimlaneField: field });
			else if (config.kind === 'gallery') host.updateView({ groupBy: field });
			this.popover?.close();
			this.refresh();
		};
		const option = (field: string | null, text: string) => {
			const row = h('button', 'og-ws-list-item', { type: 'button', 'aria-pressed': String(current === field) });
			row.append(h('span', 'og-ws-list-label', null, text));
			if (current === field) row.append(icon('check', 14));
			row.addEventListener('click', () => choose(field));
			panel.append(row);
		};
		option(null, 'None');
		const candidates = host
			.recordColumns()
			.filter(
				(col) =>
					(col.schema ? ['select', 'person', 'checkbox', 'tags', 'multiSelect'].includes(col.schema.kind) : !config) &&
					col.field !== (config?.kind === 'kanban' ? (config.columnField ?? reader.roles.status) : '')
			);
		for (const col of candidates) option(col.field, col.header ?? col.field);
		this.open(this.groupButton, panel, label);
	}

	/** Which fields show: table columns, or the fields drawn on cards / outline rows. */
	private openFields(): void {
		const host = this.host;
		const api = host.engine.getApiRef();
		const config = host.getViewConfig();
		const panel = h('div', 'og-ws-sort-panel og-ws-fields-panel');
		const render = () => {
			panel.replaceChildren(h('div', 'og-ws-panel-head', null, h('strong', null, null, config ? 'Fields on records' : 'Columns')));
			const columns = config ? host.recordColumns() : api.getColumns().filter((col) => !/^__.*__$/.test(col.field));
			const shown = new Set(config ? (config.fields ?? []) : columns.filter((col) => !col.hide).map((col) => col.field));
			const roles = host.reader().roles as Record<string, unknown>;
			for (const col of columns) {
				const role = Object.keys(roles).find((key) => roles[key] === col.field && !['doneValues', 'blockedValues'].includes(key));
				const row = h('label', 'og-ws-list-item og-ws-check');
				const box = h('input', null, { type: 'checkbox' });
				box.checked = shown.has(col.field);
				box.addEventListener('change', () => {
					if (!config) api.setColumnVisible(col.field, box.checked);
					else {
						const fields = (config.fields ?? []).filter((field) => field !== col.field);
						if (box.checked) fields.push(col.field);
						host.updateView({ fields });
					}
					render();
				});
				row.append(box, h('span', 'og-ws-list-label', null, col.header ?? col.field));
				if (role && config) row.append(h('span', 'og-ws-role', { title: 'Drawn by the view as its ' + role }, role));
				panel.append(row);
			}
			if (config)
				panel.append(h('p', 'og-ws-hint', null, 'Title, status, owner, dates and progress are drawn by the view; tick fields to add them.'));
		};
		render();
		this.open(this.fieldsButton, panel, 'Fields');
	}

	destroy(): void {
		if (this.searchTimer) defaultGridScheduler.clearTimeout(this.searchTimer);
		this.popover?.close();
	}
}
