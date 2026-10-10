import type { GridCellWrite } from '../../api/GridApi.js';
import { GridEventName } from '../../api/GridEvents.js';
import type { ColumnDef } from '../../columnDef.js';
import type { GridEngine } from '../../engine/GridEngine.js';
import type { GridPresencePeer } from '../../presence.js';
import { RecordReader, resolveRecordRoles, type RecordRolesConfig, type RecordRow } from '../../records/recordModel.js';
import type { GridViewConfig, GridWorkspaceOptions, GridWorkspaceTab, RecordActivityEntry } from '../../views.js';
import type { GridViewDefinition } from '../../workspace/workspaceTypes.js';
import { openCreateViewDialog, savedViewTab } from './viewManager.js';
import { VIEW_META } from './viewMeta.js';
import { defaultGridScheduler } from '../gridScheduler.js';
import { CommandBar } from './commandBar.js';
import { CommandPalette } from './commandPalette.js';
import { BulkBar } from './bulkBar.js';
import { Inspector } from './inspector.js';
import { recordAccent } from './recordParts.js';
import { h, openMenu, type MenuItem } from './ui.js';
import type { WorkspaceCommand, WorkspaceDialog, WorkspaceView, WorkspaceViewContext, WorkspaceViewModule, WriteOutcome } from './viewTypes.js';
import { acquireWorkspaceStyles, releaseWorkspaceStyles } from './workspaceStyles.js';
import type { WorkspaceIconName } from './icons.js';

/** View modules load on first use: a grid that never leaves the table never downloads them. */
const VIEW_LOADERS: Record<GridViewConfig['kind'], () => Promise<WorkspaceViewModule<any>>> = {
	gallery: () => import('./views/galleryView.js').then((m) => m.galleryView),
	kanban: () => import('./views/kanbanView.js').then((m) => m.kanbanView),
	gantt: () => import('./views/ganttView.js').then((m) => m.ganttView),
	calendar: () => import('./views/calendarView.js').then((m) => m.calendarView),
};

const ACTIVITY_LIMIT = 60;

/** A tab of the switcher: a configured view, a view made this session, or a saved view. */
export type WorkspaceTabEntry<TRowData> = GridWorkspaceTab<TRowData> & { saved?: GridViewDefinition };

export interface WorkspaceHostParams<TRowData> {
	engine: GridEngine<TRowData>;
	/** The workspace's element: bar, stage and inspector go inside it. */
	root: HTMLElement;
	/** The table element, placed in the stage (shell mode); null when the workspace only covers views. */
	table: HTMLElement | null;
	options: GridWorkspaceOptions<TRowData>;
}

/**
 * The record workspace: one host around every projection. It owns the command bar, the stage the
 * active view draws into, the inspector, bulk actions, the palette and toasts; and the working
 * context that survives view switches — focused record, inspector, per-view navigation. Records,
 * selection, writes and history stay the grid's.
 */
export class WorkspaceHost<TRowData> {
	readonly engine: GridEngine<TRowData>;
	readonly options: GridWorkspaceOptions<TRowData>;
	readonly root: HTMLElement;
	readonly stage: HTMLElement;
	readonly surface: HTMLElement;
	private readonly table: HTMLElement | null;
	private readonly bar: CommandBar<TRowData>;
	private readonly inspector: Inspector<TRowData>;
	private readonly bulk: BulkBar<TRowData>;
	private readonly palette: CommandPalette;
	private readonly toasts: HTMLElement;
	private readonly styles: HTMLStyleElement;
	private view: WorkspaceView | null = null;
	private viewConfig: GridViewConfig<TRowData> | null = null;
	private activeTab: WorkspaceTabEntry<TRowData>;
	private loadToken = 0;
	private frame = 0;
	private focusedId: string | null = null;
	private anchorId: string | null = null;
	private readerCache: { key: unknown; reader: RecordReader<TRowData> } | null = null;
	private rowsCache: RecordRow<TRowData>[] | null = null;
	private readonly memories = new Map<string, Map<string, unknown>>();
	private readonly activity = new Map<string, RecordActivityEntry[]>();
	private activitySeq = 0;
	private readonly unsubscribers: (() => void)[] = [];
	private destroyed = false;
	private presenceByRecord = new Map<string, GridPresencePeer[]>();
	readonly context: WorkspaceViewContext<TRowData>;

	constructor(params: WorkspaceHostParams<TRowData>) {
		this.engine = params.engine;
		this.options = params.options;
		this.root = params.root;
		this.table = params.table;
		this.styles = acquireWorkspaceStyles(this.root.ownerDocument);
		this.root.classList.add('og-ws');
		this.root.toggleAttribute('data-shell', !!this.table);
		this.stage = h('div', 'og-ws-stage');
		this.surface = h('div', 'og-ws-surface', { hidden: true });
		if (this.table) this.stage.append(this.table);
		this.stage.append(this.surface);
		const main = h('div', 'og-ws-main', null, this.stage);
		this.toasts = h('div', 'og-ws-toasts', { role: 'status', 'aria-live': 'polite' });
		this.context = this.createContext();
		this.activeTab = this.tabFor(this.currentView());
		this.bar = new CommandBar(this);
		this.inspector = new Inspector(this, main);
		this.bulk = new BulkBar(this);
		this.palette = new CommandPalette(this.root, () => this.commands());
		this.root.append(this.bar.element, main, this.bulk.element, this.toasts);
		this.bind();
		this.apply(true);
	}

	// ─── Tabs and views ───────────────────────────────────────────────────

	/** Configured (or default) tabs, then views made this session, then saved views. */
	tabs(): readonly WorkspaceTabEntry<TRowData>[] {
		const api = this.engine.getApiRef();
		const saved = api.hasWorkspace() ? api.getWorkspaceState().views : [];
		const key = [this.baseTabs(), this.sessionTabs.length, saved];
		if (this.tabCache && this.tabCache.key.every((part, i) => part === key[i])) return this.tabCache.tabs;
		const tabs = [...this.baseTabs(), ...this.sessionTabs, ...saved.map((view) => savedViewTab<TRowData>(view))];
		this.tabCache = { key, tabs };
		return tabs;
	}
	private tabCache: { key: unknown[]; tabs: WorkspaceTabEntry<TRowData>[] } | null = null;
	private readonly sessionTabs: WorkspaceTabEntry<TRowData>[] = [];

	private baseTabs(): readonly WorkspaceTabEntry<TRowData>[] {
		if (this.options.views?.length) return this.options.views;
		const roles = this.reader().roles;
		const tabs: GridWorkspaceTab<TRowData>[] = [
			{ id: 'table', name: 'Table', view: null },
			{ id: 'gallery', name: 'Gallery', view: { kind: 'gallery' } },
		];
		if (roles.due || roles.schedule || roles.start) tabs.push({ id: 'calendar', name: 'Calendar', view: { kind: 'calendar' } });
		if (roles.status) tabs.push({ id: 'kanban', name: 'Kanban', view: { kind: 'kanban' } });
		if (roles.schedule || roles.start) tabs.push({ id: 'gantt', name: 'Gantt', view: { kind: 'gantt' } });
		return this.defaultTabs?.length === tabs.length && this.defaultTabs.every((tab, i) => tab.id === tabs[i].id)
			? this.defaultTabs
			: (this.defaultTabs = tabs);
	}
	private defaultTabs: GridWorkspaceTab<TRowData>[] | null = null;

	/** The tab showing a view config: by identity, else the first of its kind, else an ad-hoc tab. */
	private tabFor(view: GridViewConfig<TRowData> | null): WorkspaceTabEntry<TRowData> {
		const tabs = this.tabs();
		return (
			tabs.find((tab) => tab.view === view || (this.tabConfigs.has(tab.id) && this.tabConfigs.get(tab.id) === view)) ??
			tabs.find((tab) => (tab.view?.kind ?? null) === (view?.kind ?? null)) ?? {
				id: view?.kind ?? 'table',
				name: VIEW_META[view?.kind ?? 'table'].label,
				view,
			}
		);
	}

	getActiveTab(): WorkspaceTabEntry<TRowData> {
		return this.activeTab;
	}

	activate(tab: WorkspaceTabEntry<TRowData>): void {
		this.activeTab = tab;
		if (tab.saved) {
			// A saved view brings its filters, sort, columns and view; one saved without a view is a table.
			const api = this.engine.getApiRef();
			const saved = tab.saved;
			void api.applyView(saved.id).then(
				() => {
					if (!saved.state.state.view && this.currentView()) this.engine.setView(null);
					this.activeTab = tab;
					this.apply(true);
				},
				(error) => this.toast(`Could not open “${saved.name}”: ${error instanceof Error ? error.message : String(error)}`, 'error')
			);
			this.bar.refresh();
			return;
		}
		const view = this.tabConfigs.get(tab.id) ?? tab.view;
		if (this.currentView() === view) this.apply(true);
		else this.engine.setView(view);
	}

	/** Adds a view: saved (personal or team) when the grid has a saved-views store, else for this session. */
	async addView(name: string, view: GridViewConfig<TRowData> | null, scope: 'personal' | 'team' | null): Promise<void> {
		const api = this.engine.getApiRef();
		if (scope && api.hasWorkspace()) {
			this.engine.setView(view);
			try {
				const saved = await api.saveView(name, { scope });
				this.tabCache = null;
				this.activeTab = savedViewTab(saved);
				this.apply(true);
				this.toast(`Saved “${name}”${scope === 'team' ? ' for the team' : ''}`, 'success');
			} catch (error) {
				this.toast(`Could not save “${name}”: ${error instanceof Error ? error.message : String(error)}`, 'error');
			}
			return;
		}
		const tab: WorkspaceTabEntry<TRowData> = { id: `session:${this.sessionTabs.length + 1}`, name, view };
		this.sessionTabs.push(tab);
		this.tabCache = null;
		this.activate(tab);
	}

	async saveActiveView(): Promise<void> {
		const saved = this.activeTab.saved;
		if (!saved) return;
		try {
			await this.engine.getApiRef().updateView(saved.id);
			this.toast(`Saved changes to “${saved.name}”`, 'success');
		} catch (error) {
			this.toast(`Could not save: ${error instanceof Error ? error.message : String(error)}`, 'error');
		}
	}

	async renameView(saved: GridViewDefinition): Promise<void> {
		const input = h('input', 'og-ws-input', { type: 'text', 'aria-label': 'View name' });
		input.value = saved.name;
		const answer = await this.confirm({ title: 'Rename view', body: input, confirm: 'Rename' });
		const name = input.value.trim();
		if (answer === 'confirm' && name && name !== saved.name) await this.engine.getApiRef().renameView(saved.id, name);
	}

	async deleteSavedView(saved: GridViewDefinition): Promise<void> {
		const answer = await this.confirm({
			title: `Delete “${saved.name}”?`,
			body: h('p', 'og-ws-hint', null, saved.scope === 'team' ? 'Everyone on the team loses this view.' : 'This view is removed for you.'),
			confirm: 'Delete',
		});
		if (answer !== 'confirm') return;
		await this.engine.getApiRef().deleteView(saved.id);
		if (this.activeTab.saved?.id === saved.id) this.activate(this.tabs()[0]);
	}

	/** Changes the active view's configuration (swimlanes, fields, zoom); the tab keeps the change. */
	updateView(patch: Partial<GridViewConfig<TRowData>>): void {
		const current = this.viewConfig;
		if (!current) return;
		const next = { ...current, ...patch } as GridViewConfig<TRowData>;
		this.tabConfigs.set(this.activeTab.id, next);
		this.engine.setView(next);
	}
	private readonly tabConfigs = new Map<string, GridViewConfig<TRowData> | null>();

	private currentView(): GridViewConfig<TRowData> | null {
		return (this.engine.getState().view ?? null) as GridViewConfig<TRowData> | null;
	}

	/** The view state changed (a tab, `api.setView`): mount the view it names. */
	private apply(force = false): void {
		const config = this.currentView();
		if (!force && config === this.viewConfig && (this.view || !config)) return;
		const shown = this.tabConfigs.get(this.activeTab.id) ?? this.activeTab.view;
		// A saved view's tab stays active while it shows that kind of view (its config object may be a restored copy).
		const keep = shown === config || (!!this.activeTab.saved && (shown?.kind ?? null) === (config?.kind ?? null));
		if (!keep) this.activeTab = this.tabFor(config);
		this.viewConfig = config;
		this.readerCache = null;
		this.unmountView();
		const showTable = !config;
		this.surface.hidden = showTable;
		this.root.toggleAttribute('data-view', !showTable);
		this.root.dataset.kind = config?.kind ?? 'table';
		if (this.table) {
			this.table.toggleAttribute('inert', !showTable);
			this.table.classList.toggle('og-ws-table-hidden', !showTable);
		}
		this.root.hidden = !this.table && showTable;
		this.bar.refresh();
		if (!config) {
			this.inspector.refresh();
			this.bulk.refresh();
			if (this.table && this.focusedId) this.revealInTable(this.focusedId, undefined, false);
			return;
		}
		const token = ++this.loadToken;
		this.surface.replaceChildren(h('div', 'og-ws-loading', { 'aria-busy': 'true' }, h('span', 'og-ws-spinner'), 'Loading view…'));
		void VIEW_LOADERS[config.kind]().then(
			(module) => {
				if (this.destroyed || token !== this.loadToken) return;
				this.surface.replaceChildren();
				const host = h('div', `og-ws-view og-ws-view-${config.kind}`);
				this.surface.append(host);
				this.view = module.create(host, this.context, config);
				this.view.render();
				this.bar.refresh();
				this.inspector.refresh();
				this.bulk.refresh();
				if (this.focusedId) this.view.reveal(this.focusedId);
			},
			(error) => {
				if (token !== this.loadToken) return;
				this.surface.replaceChildren(h('div', 'og-ws-empty', null, `This view could not load: ${String(error?.message ?? error)}`));
			}
		);
	}

	private unmountView(): void {
		this.view?.destroy();
		this.view = null;
		this.surface.replaceChildren();
	}

	getView(): WorkspaceView | null {
		return this.view;
	}

	getViewConfig(): GridViewConfig<TRowData> | null {
		return this.viewConfig;
	}

	// ─── Records ──────────────────────────────────────────────────────────

	reader(): RecordReader<TRowData> {
		const columns = this.engine.getApiRef().getColumns() as ColumnDef<TRowData>[];
		const viewRoles = (this.viewConfig as { records?: RecordRolesConfig } | null)?.records;
		const key = [columns, this.options.records, viewRoles];
		if (this.readerCache && this.readerCache.key instanceof Array && this.readerCache.key.every((part, i) => part === key[i]))
			return this.readerCache.reader;
		const reader = new RecordReader(columns, resolveRecordRoles(columns, { ...this.options.records, ...viewRoles }));
		this.readerCache = { key, reader };
		return reader;
	}

	rows(): RecordRow<TRowData>[] {
		if (this.rowsCache) return this.rowsCache;
		const model = this.engine.getRowModel();
		const rows: RecordRow<TRowData>[] = [];
		if (model) {
			const count = model.getVisualRowCount();
			for (let i = 0; i < count; i++) {
				const row = model.getVisualRow(i);
				if (row?.kind === 'data' && row.node.data != null) rows.push({ id: row.rowId, data: row.node.data });
			}
		}
		return (this.rowsCache = rows);
	}

	/** The displayed columns that hold record fields (not the grid's own selection / hierarchy columns). */
	recordColumns(): ColumnDef<TRowData>[] {
		return (this.engine.getDisplayedColumns() as ColumnDef<TRowData>[]).filter((col) => !/^__.*__$/.test(col.field));
	}

	lookup(id: string): RecordRow<TRowData> | undefined {
		const data = this.engine.getApiRef().getRawRowById(id);
		return data == null ? undefined : { id, data };
	}

	write(writes: readonly GridCellWrite[], label?: string): WriteOutcome {
		if (!writes.length) return { ok: true, rejected: [] };
		const api = this.engine.getApiRef();
		const allowed = writes.filter((write) => api.canEdit(write.rowId, write.colField));
		const refused = writes.filter((write) => !allowed.includes(write)).map((cell) => ({ cell, reason: 'This field is read-only here.' }));
		const result = allowed.length ? api.transaction({ cells: [...allowed] }) : null;
		const rejected = [...refused, ...(result?.cells.rejected ?? []).map((entry) => ({ cell: entry.cell, reason: entry.reason }))];
		if (result?.status === 'rejected' && !rejected.length) rejected.push(...allowed.map((cell) => ({ cell, reason: result.reason })));
		if (rejected.length) {
			const reason = rejected[0].reason;
			this.toast(
				rejected.length === writes.length ? `Not changed: ${reason}` : `${rejected.length} of ${writes.length} changes refused: ${reason}`,
				'error'
			);
		} else if (label) {
			this.toast(label, 'success', api.canUndo() ? { label: 'Undo', run: () => api.undo() } : undefined);
		}
		// Undo / redo availability changes with the write itself, not a frame later.
		this.bar.refresh();
		this.scheduleRender();
		return { ok: rejected.length === 0, rejected };
	}

	// ─── Focus, selection, inspector ─────────────────────────────────────

	focused(): string | null {
		return this.focusedId;
	}

	focus(id: string | null, options: { inspect?: boolean; scroll?: boolean } = {}): void {
		this.focusedId = id;
		if (id) this.anchorId ??= id;
		this.paintFocus();
		if (options.inspect && id) this.inspector.open(id);
		else if (this.inspector.isOpen() && id && this.inspector.follows()) this.inspector.open(id);
		if (id && options.scroll !== false) {
			const element = this.view?.reveal(id);
			if (element && this.root.contains(document.activeElement)) element.focus({ preventScroll: true });
		}
	}

	inspect(id: string | null): void {
		if (id) {
			this.focusedId = id;
			this.paintFocus();
			this.inspector.open(id);
		} else this.inspector.close();
	}

	selected(): ReadonlySet<string> {
		return new Set(this.engine.getApiRef().getSelectedRowIds());
	}

	select(id: string, mode: 'replace' | 'toggle' | 'range', order: readonly string[]): void {
		const api = this.engine.getApiRef();
		if (mode === 'range' && this.anchorId) {
			const a = order.indexOf(this.anchorId);
			const b = order.indexOf(id);
			if (a >= 0 && b >= 0) {
				api.selectRows(order.slice(Math.min(a, b), Math.max(a, b) + 1) as string[], { mode: 'replace' });
				this.focusedId = id;
				this.paintSelection();
				return;
			}
		}
		if (mode === 'toggle') api.toggleRowSelection(id);
		else api.selectRows([id], { mode: 'replace' });
		this.anchorId = id;
		this.focusedId = id;
		this.paintSelection();
	}

	clearSelection(): void {
		this.engine.getApiRef().clearRowSelection();
		this.paintSelection();
	}

	selectAll(): void {
		const order = this.view?.order() ?? this.rows().map((row) => row.id);
		this.engine.getApiRef().selectRows([...order], { mode: 'replace' });
		this.paintSelection();
	}

	/** Marks selected and focused records in the view (no redraw). */
	private paintSelection(): void {
		const selected = this.selected();
		for (const element of this.surface.querySelectorAll<HTMLElement>('[data-record-id]')) {
			const on = selected.has(element.dataset.recordId!);
			element.toggleAttribute('data-selected', on);
			element.setAttribute('aria-selected', String(on));
		}
		this.paintFocus();
		this.bulk.refresh();
		this.bar.refreshCount();
	}

	private paintFocus(): void {
		for (const element of this.surface.querySelectorAll<HTMLElement>('[data-record-id]')) {
			const on = element.dataset.recordId === this.focusedId;
			element.toggleAttribute('data-focused', on);
			element.tabIndex = on ? 0 : -1;
		}
		const first = this.surface.querySelector<HTMLElement>('[data-record-id]');
		if (first && !this.surface.querySelector('[data-record-id][tabindex="0"]')) first.tabIndex = 0;
	}

	openInTable(id: string, field?: string): void {
		this.focusedId = id;
		if (!this.table) {
			this.engine.setView(null);
			this.revealInTable(id, field, true);
			return;
		}
		this.activate(this.tabs().find((tab) => tab.view === null) ?? { id: 'table', name: 'Table', view: null });
		this.revealInTable(id, field, true);
	}

	/** In the table, the record glides into view and its row flashes. */
	private revealInTable(id: string, field: string | undefined, flash: boolean): void {
		const api = this.engine.getApiRef();
		defaultGridScheduler.raf(() => {
			const columns = this.engine.getDisplayedColumns();
			const target = columns.find((col) => col.field === (field ?? this.reader().roles.title)) ?? columns[0];
			if (!target || this.engine.getRowModel()?.getVisualIndexByRowId(id) == null) return;
			api.scrollToCell(id, target.field, { select: true });
			if (flash) this.engine.flashCells(columns.slice(0, 12).map((col) => ({ rowId: id, field: col.field })));
		});
	}

	// ─── Context for views ───────────────────────────────────────────────

	private createContext(): WorkspaceViewContext<TRowData> {
		const api = this.engine.getApiRef();
		return {
			api,
			options: this.options,
			reader: () => this.reader(),
			rows: () => this.rows(),
			lookup: (id) => this.lookup(id),
			columns: () => this.recordColumns(),
			canEdit: (id, field) => api.canEdit(id, field),
			write: (writes, label) => this.write(writes, label),
			create: this.options.createRecord ? (values) => this.createRecord(values) : undefined,
			selected: () => this.selected(),
			select: (id, mode, order) => this.select(id, mode, order),
			focused: () => this.focusedId,
			focus: (id, options) => this.focus(id, options),
			inspect: (id) => this.inspect(id),
			openInTable: (id, field) => this.openInTable(id, field),
			presence: (id) => this.presenceByRecord.get(id) ?? [],
			counts: (id) => this.options.collaboration?.counts?.(id),
			accent: (row) => recordAccent(this.reader(), row, this.viewConfig?.color as ((data: TRowData) => string | undefined) | undefined),
			memory: (key, initial) => {
				const memory = this.memory();
				return (memory.has(key) ? memory.get(key) : initial) as never;
			},
			remember: (key, value) => this.memory().set(key, value),
			updateView: (patch) => this.updateView(patch),
			requestRender: () => this.scheduleRender(),
			toast: (message, tone, action) => this.toast(message, tone, action),
			menu: (anchor, items) => void openMenu(anchor, items),
			confirm: (dialog) => this.confirm(dialog),
		};
	}

	private memory(): Map<string, unknown> {
		const key = this.activeTab.id;
		let memory = this.memories.get(key);
		if (!memory) this.memories.set(key, (memory = new Map()));
		return memory;
	}

	async createRecord(values: Record<string, unknown>): Promise<string | null> {
		const factory = this.options.createRecord;
		if (!factory) return null;
		try {
			const data = await factory(values);
			const api = this.engine.getApiRef();
			const result = api.transaction({ rows: { add: [data] } });
			if (result.status === 'rejected') {
				this.toast(`Could not add: ${result.reason}`, 'error');
				return null;
			}
			const id = api.getRowId(data);
			this.scheduleRender();
			defaultGridScheduler.raf(() => this.focus(id, { inspect: true }));
			return id;
		} catch (error) {
			this.toast(`Could not add: ${error instanceof Error ? error.message : String(error)}`, 'error');
			return null;
		}
	}

	activityFor(id: string): readonly RecordActivityEntry[] {
		return this.activity.get(id) ?? [];
	}

	// ─── Commands ────────────────────────────────────────────────────────

	commands(): WorkspaceCommand[] {
		const api = this.engine.getApiRef();
		const commands: WorkspaceCommand[] = this.tabs().map((tab) => ({
			id: `view:${tab.id}`,
			label: `Switch to ${tab.name}`,
			group: 'Views',
			icon: VIEW_META[tab.view?.kind ?? 'table'].icon,
			keywords: tab.view?.kind ?? 'table grid',
			run: () => this.activate(tab),
		}));
		const workspace = api.hasWorkspace() ? api.getWorkspaceState() : null;
		commands.push(
			{
				id: 'view:new',
				label: 'New view…',
				group: 'Views',
				icon: 'plus',
				keywords: 'create add tab',
				run: () => void openCreateViewDialog(this),
			},
			{
				id: 'view:save',
				label: `Save changes to “${this.activeTab.name}”`,
				group: 'Views',
				icon: 'check',
				enabled: () => !!(workspace?.dirty && this.activeTab.saved),
				run: () => void this.saveActiveView(),
			}
		);
		const focused = this.focusedId;
		const selection = this.selected();
		commands.push(
			{ id: 'edit:undo', label: 'Undo', group: 'Edit', icon: 'undo', hint: 'Ctrl Z', enabled: () => api.canUndo(), run: () => api.undo() },
			{ id: 'edit:redo', label: 'Redo', group: 'Edit', icon: 'redo', hint: 'Ctrl Y', enabled: () => api.canRedo(), run: () => api.redo() },
			{ id: 'select:all', label: 'Select all records', group: 'Selection', icon: 'check', hint: 'Ctrl A', run: () => this.selectAll() },
			{
				id: 'select:clear',
				label: 'Clear selection',
				group: 'Selection',
				icon: 'close',
				hint: 'Esc',
				enabled: () => selection.size > 0,
				run: () => this.clearSelection(),
			},
			{ id: 'search', label: 'Search records', group: 'Navigate', icon: 'search', hint: '/', run: () => this.bar.focusSearch() },
			{ id: 'filter:clear', label: 'Clear filters and search', group: 'Navigate', icon: 'filter', run: () => this.clearFilters() }
		);
		if (focused) {
			const row = this.lookup(focused);
			const title = row ? this.reader().title(row) : focused;
			commands.push(
				{
					id: 'record:inspect',
					label: `Open “${title}”`,
					group: 'Record',
					icon: 'inspector',
					hint: 'Enter',
					run: () => this.inspect(focused),
				},
				{ id: 'record:table', label: `Show “${title}” in the table`, group: 'Record', icon: 'table', run: () => this.openInTable(focused) },
				{
					id: 'record:duplicate',
					label: 'Duplicate record',
					group: 'Record',
					icon: 'copy',
					enabled: () => !!row,
					run: () => this.duplicate([focused]),
				}
			);
		}
		if (this.options.inspector !== false)
			commands.push({
				id: 'inspector:toggle',
				label: this.inspector.isOpen() ? 'Close the inspector' : 'Open the inspector',
				group: 'Navigate',
				icon: 'inspector',
				hint: 'I',
				run: () => this.toggleInspector(),
			});
		commands.push(...this.bulk.commands());
		commands.push(...(this.view?.commands?.() ?? []));
		return commands.filter((command) => command.enabled?.() ?? true);
	}

	toggleInspector(): void {
		if (this.inspector.isOpen()) this.inspector.close();
		else {
			const id = this.focusedId ?? this.view?.order()[0] ?? this.rows()[0]?.id;
			if (id) this.inspect(id);
		}
		this.bar.refresh();
	}

	clearFilters(): void {
		const api = this.engine.getApiRef();
		api.setFilterModel(null);
		api.setQuickFilter('');
		this.bar.refresh();
	}

	duplicate(ids: readonly string[]): void {
		const api = this.engine.getApiRef();
		const factory = this.options.createRecord;
		if (!factory) {
			this.toast('Duplicating needs the workspace’s createRecord option.', 'warn');
			return;
		}
		void Promise.all(
			ids.map(async (id) => {
				const source = this.lookup(id);
				if (!source) return null;
				const copy = { ...(source.data as Record<string, unknown>) };
				const title = this.reader().roles.title;
				if (title && typeof copy[title] === 'string') copy[title] = `${copy[title]} (copy)`;
				return factory(copy);
			})
		).then((created) => {
			const add = created.filter((row): row is NonNullable<typeof row> => row != null) as TRowData[];
			if (!add.length) return;
			api.transaction({ rows: { add } });
			this.toast(`Duplicated ${add.length} ${add.length === 1 ? 'record' : 'records'}`, 'success', { label: 'Undo', run: () => api.undo() });
		});
	}

	deleteRecords(ids: readonly string[]): void {
		const api = this.engine.getApiRef();
		const rows = ids.map((id) => api.getRawRowById(id)).filter((row): row is TRowData => row != null);
		if (!rows.length) return;
		const result = api.transaction({ rows: { remove: rows } });
		if (result.status === 'rejected') {
			this.toast(`Not deleted: ${result.reason}`, 'error');
			return;
		}
		if (this.focusedId && ids.includes(this.focusedId)) {
			this.focusedId = null;
			this.inspector.close();
		}
		this.toast(
			`Deleted ${rows.length} ${rows.length === 1 ? 'record' : 'records'}`,
			'info',
			api.canUndo() ? { label: 'Undo', run: () => api.undo() } : undefined
		);
	}

	recordMenu(anchor: HTMLElement | { x: number; y: number }, id: string): void {
		const ids = this.selected().has(id) ? [...this.selected()] : [id];
		const items: (MenuItem | 'separator')[] = [
			{ label: 'Open', icon: 'inspector', hint: 'Enter', run: () => this.inspect(id) },
			{ label: 'Show in table', icon: 'table', run: () => this.openInTable(id) },
			'separator',
			{
				label: ids.length > 1 ? `Duplicate ${ids.length} records` : 'Duplicate',
				icon: 'copy',
				disabled: !this.options.createRecord,
				run: () => this.duplicate(ids),
			},
			{ label: ids.length > 1 ? `Delete ${ids.length} records` : 'Delete', icon: 'trash', danger: true, run: () => this.deleteRecords(ids) },
		];
		let target: HTMLElement;
		if (anchor instanceof HTMLElement) target = anchor;
		else {
			target = h('span', 'og-ws-anchor');
			const bounds = this.root.getBoundingClientRect();
			target.style.left = `${anchor.x - bounds.left}px`;
			target.style.top = `${anchor.y - bounds.top}px`;
			this.root.append(target);
			defaultGridScheduler.timeout(() => target.remove(), 0);
		}
		openMenu(target, items, 'Record actions');
	}

	// ─── Feedback ────────────────────────────────────────────────────────

	toast(message: string, tone: 'info' | 'warn' | 'error' | 'success' = 'info', action?: { label: string; run: () => void }): void {
		const toast = h('div', `og-ws-toast og-ws-toast-${tone}`, { role: tone === 'error' ? 'alert' : 'status' }, h('span', null, null, message));
		const dismiss = () => {
			toast.classList.add('og-ws-toast-out');
			defaultGridScheduler.timeout(() => toast.remove(), 200);
		};
		if (action) {
			const button = h('button', 'og-ws-toast-action', { type: 'button' }, action.label);
			button.addEventListener('click', () => {
				action.run();
				dismiss();
			});
			toast.append(button);
		}
		this.toasts.append(toast);
		while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
		defaultGridScheduler.timeout(dismiss, tone === 'error' ? 6000 : 4000);
	}

	confirm(dialog: WorkspaceDialog): Promise<'confirm' | 'alternate' | 'cancel'> {
		return new Promise((resolve) => {
			const previous = document.activeElement as HTMLElement | null;
			const scrim = h('div', 'og-ws-scrim');
			const ok = h('button', 'og-ws-btn og-ws-btn-primary', { type: 'button' }, dialog.confirm);
			const cancel = h('button', 'og-ws-btn', { type: 'button' }, dialog.cancel ?? 'Cancel');
			const alternate = dialog.alternate ? h('button', 'og-ws-btn', { type: 'button' }, dialog.alternate) : null;
			const panel = h(
				'div',
				'og-ws-dialog',
				{ role: 'dialog', 'aria-modal': 'true', 'aria-label': dialog.title },
				h('h2', 'og-ws-dialog-title', null, dialog.title),
				h('div', 'og-ws-dialog-body', null, dialog.body),
				h('div', 'og-ws-dialog-actions', null, alternate ? h('span', 'og-ws-spacer', null, alternate) : null, cancel, ok)
			);
			scrim.append(panel);
			const close = (value: 'confirm' | 'alternate' | 'cancel') => {
				scrim.remove();
				previous?.focus?.({ preventScroll: true });
				resolve(value);
			};
			ok.addEventListener('click', () => close('confirm'));
			cancel.addEventListener('click', () => close('cancel'));
			alternate?.addEventListener('click', () => close('alternate'));
			scrim.addEventListener('pointerdown', (event) => {
				if (event.target === scrim) close('cancel');
			});
			panel.addEventListener('keydown', (event) => {
				event.stopPropagation();
				if (event.key === 'Escape') close('cancel');
				if (event.key === 'Tab') {
					const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button')];
					const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
					event.preventDefault();
					buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
				}
			});
			this.root.append(scrim);
			ok.focus();
		});
	}

	// ─── Rendering and events ────────────────────────────────────────────

	scheduleRender(): void {
		if (this.frame || this.destroyed) return;
		this.frame = defaultGridScheduler.raf(() => {
			this.frame = 0;
			this.renderNow();
		});
	}

	private renderNow(): void {
		this.rowsCache = null;
		this.view?.render();
		this.paintSelection();
		this.bar.refresh();
		this.inspector.refresh();
	}

	private bind(): void {
		const engine = this.engine;
		const dataChanged = () => {
			this.rowsCache = null;
			this.scheduleRender();
		};
		this.unsubscribers.push(
			engine.stateManager.subscribeToKey('view', () => this.apply()),
			engine.subscribeDomain('rows', dataChanged),
			engine.subscribeDomain('columns', () => {
				this.readerCache = null;
				this.defaultTabs = null;
				this.apply(true);
			}),
			engine.addEventListener(GridEventName.cellValueChanged, ({ payload }) => {
				this.logEdit(payload.rowId, payload.colField, payload.oldValue, payload.newValue);
				dataChanged();
			}),
			engine.addEventListener(GridEventName.rowsUpdated, dataChanged),
			engine.addEventListener(GridEventName.rowSelectionChanged, () => this.paintSelection()),
			engine.addEventListener(GridEventName.quickFilterChanged, () => this.bar.refresh()),
			engine.addEventListener(GridEventName.filterChanged, () => this.bar.refresh()),
			engine.addEventListener(GridEventName.focusChanged, ({ payload }) => {
				if (this.viewConfig) return;
				// In the table, the focused cell's row is the focused record (the inspector follows it).
				const rowId = payload.focus?.rowId;
				if (rowId && rowId !== this.focusedId) this.focus(rowId, { scroll: false });
			}),
			engine.presence.subscribe(() => this.updatePresence())
		);
		const api = engine.getApiRef();
		if (api.hasWorkspace())
			this.unsubscribers.push(
				api.subscribeToWorkspaceState(() => {
					this.tabCache = null;
					const saved = this.activeTab.saved;
					if (saved) {
						const fresh = api.getWorkspaceState().views.find((view) => view.id === saved.id);
						if (fresh) this.activeTab = savedViewTab(fresh);
					}
					this.bar.refresh();
				})
			);
		const collaboration = this.options.collaboration;
		if (collaboration?.subscribe)
			this.unsubscribers.push(
				collaboration.subscribe((id) => {
					this.inspector.refresh(id);
					this.scheduleRender();
				})
			);
		this.surface.addEventListener('click', this.onClick);
		this.surface.addEventListener('contextmenu', this.onContextMenu);
		this.root.addEventListener('keydown', this.onKeyDown);
		const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.scheduleRender()) : null;
		resize?.observe(this.surface);
		this.unsubscribers.push(() => resize?.disconnect());
		this.updatePresence();
	}

	private logEdit(rowId: string, field: string, from: unknown, to: unknown): void {
		let entries = this.activity.get(rowId);
		if (!entries) this.activity.set(rowId, (entries = []));
		const now = Date.now();
		const last = entries[0];
		// A drag that writes the same field repeatedly reads as one change.
		if (last && last.field === field && now - last.at < 1500) {
			last.to = to;
			last.at = now;
		} else entries.unshift({ id: `a${++this.activitySeq}`, at: now, kind: 'edit', field, from, to, actor: this.options.collaboration?.me });
		if (entries.length > ACTIVITY_LIMIT) entries.length = ACTIVITY_LIMIT;
		if (this.activity.size > 5000) this.activity.delete(this.activity.keys().next().value!);
	}

	private updatePresence(): void {
		const byRecord = new Map<string, GridPresencePeer[]>();
		for (const peer of this.engine.presence.peers) {
			const id = peer.cell?.rowId;
			if (!id) continue;
			const list = byRecord.get(id) ?? [];
			list.push(peer);
			byRecord.set(id, list);
		}
		this.presenceByRecord = byRecord;
		this.bar.refreshPresence();
		if (this.viewConfig) this.scheduleRender();
	}

	private recordFrom(target: EventTarget | null): HTMLElement | null {
		return (target as Element | null)?.closest?.<HTMLElement>('[data-record-id]') ?? null;
	}

	private onClick = (event: MouseEvent): void => {
		const element = this.recordFrom(event.target);
		if (!element || (event.target as Element).closest('button, input, textarea, select, a, [data-no-select]')) return;
		if (element.hasAttribute('data-drag-suppress-click')) {
			element.removeAttribute('data-drag-suppress-click');
			return;
		}
		const id = element.dataset.recordId!;
		const order = this.view?.order() ?? [];
		if (event.shiftKey) this.select(id, 'range', order);
		else if (event.ctrlKey || event.metaKey) this.select(id, 'toggle', order);
		else {
			this.select(id, 'replace', order);
			this.focus(id, { inspect: this.options.inspector !== false, scroll: false });
			element.focus({ preventScroll: true });
		}
	};

	private onContextMenu = (event: MouseEvent): void => {
		const element = this.recordFrom(event.target);
		if (!element) return;
		event.preventDefault();
		const id = element.dataset.recordId!;
		if (!this.selected().has(id)) this.select(id, 'replace', this.view?.order() ?? []);
		this.recordMenu({ x: event.clientX, y: event.clientY }, id);
	};

	private onKeyDown = (event: KeyboardEvent): void => {
		const target = event.target as HTMLElement;
		const typing = !!target.closest('input, textarea, select, [contenteditable="true"]');
		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.toLowerCase();
		if (mod && key === 'k') {
			event.preventDefault();
			event.stopPropagation();
			this.palette.open();
			return;
		}
		if (typing || this.palette.isOpen()) return;
		// The table handles its own keys; only workspace shortcuts apply there.
		const inView = this.surface.contains(target);
		if (key === '/' && !mod) {
			event.preventDefault();
			this.bar.focusSearch();
			return;
		}
		if (!this.viewConfig || !inView) return;
		if (mod && (key === 'z' || key === 'y')) {
			event.preventDefault();
			const api = this.engine.getApiRef();
			if (key === 'y' || event.shiftKey) api.redo();
			else api.undo();
			return;
		}
		if (mod && key === 'a') {
			event.preventDefault();
			this.selectAll();
			return;
		}
		if (event.key === 'Escape') {
			if (this.inspector.isOpen()) this.inspector.close();
			else this.clearSelection();
			return;
		}
		const recordElement = this.recordFrom(target);
		const id = recordElement?.dataset.recordId ?? this.focusedId;
		if (!id) {
			if (event.key.startsWith('Arrow')) {
				const first = this.view?.order()[0];
				if (first) {
					event.preventDefault();
					this.focus(first);
				}
			}
			return;
		}
		if (this.view?.onKey?.(event, id)) {
			event.preventDefault();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			this.inspect(id);
			return;
		}
		if (event.key === ' ') {
			event.preventDefault();
			this.select(id, 'toggle', this.view?.order() ?? []);
			return;
		}
		if (key === 'i' && !mod) {
			event.preventDefault();
			this.toggleInspector();
			return;
		}
		if (event.key === 'Delete' && this.selected().size) {
			event.preventDefault();
			this.deleteRecords([...this.selected()]);
			return;
		}
		const steps: Record<string, number> = {
			ArrowDown: 1,
			ArrowRight: 1,
			ArrowUp: -1,
			ArrowLeft: -1,
			Home: -Infinity,
			End: Infinity,
			j: 1,
			k: -1,
		};
		if (!(event.key in steps)) return;
		event.preventDefault();
		const order = this.view?.order() ?? [];
		const index = order.indexOf(id);
		const next = order[Math.max(0, Math.min(order.length - 1, (index < 0 ? 0 : index) + steps[event.key]))];
		if (!next) return;
		if (event.shiftKey) this.select(next, 'range', order);
		this.focus(next);
	};

	destroy(): void {
		this.destroyed = true;
		for (const off of this.unsubscribers) off();
		this.unsubscribers.length = 0;
		if (this.frame) defaultGridScheduler.cancelRaf(this.frame);
		this.surface.removeEventListener('click', this.onClick);
		this.surface.removeEventListener('contextmenu', this.onContextMenu);
		this.root.removeEventListener('keydown', this.onKeyDown);
		this.unmountView();
		this.inspector.destroy();
		this.bar.destroy();
		this.palette.destroy();
		this.bulk.destroy();
		this.table?.removeAttribute('inert');
		this.table?.classList.remove('og-ws-table-hidden');
		if (this.table) this.root.parentElement?.insertBefore(this.table, this.root);
		this.root.replaceChildren();
		this.root.classList.remove('og-ws');
		releaseWorkspaceStyles(this.styles);
	}
}
