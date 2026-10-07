/**
 * The grid's sidebar: an icon rail and one open panel beside the grid. Built-in panels and your
 * own (DOM, or an adapter component such as React's `renderPanel`) share the frame: a header with
 * the panel's title, its actions and a close button, over a scrolling body.
 */
import { summarizeAnalysisState } from '../analysis/analysisState.js';
import type { GridApi } from '../api/GridApi.js';
import type { ColumnFilter } from '../filterModel.js';
import type { DomFilterEditorHandle, FilterSurface } from '../filters/filterDef.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';
import { disposables, el, iconButton } from './panelKit.js';
import { columnsPanel } from './panels/columnsPanel.js';
import { filtersPanel } from './panels/filtersPanel.js';
import { queryPanel } from './panels/queryPanel.js';
import { sortPanel } from './panels/sortPanel.js';
import { themesPanel } from './panels/themesPanel.js';
import { sidebarIconSvg, type SidebarIconName } from './sidebarIcons.js';
import type {
	AdapterPanelMount,
	BuiltinSidebarPanelId,
	GridSidebarConfig,
	SidebarPanel,
	SidebarPanelContext,
	SidebarPanelDef,
	SidebarPanelHandle,
} from './sidebarTypes.js';

const DEFAULT_PANELS: BuiltinSidebarPanelId[] = ['columns', 'filters', 'sort', 'views'];
const DEFAULT_WIDTH = 300;
/** Matches the panel's width transition in the stylesheet. */
const CLOSE_MS = 220;

interface BuiltinPanel {
	label: string;
	icon: SidebarIconName;
	panel: SidebarPanel<any>;
}

const BUILTIN: Partial<Record<BuiltinSidebarPanelId, BuiltinPanel>> = {
	columns: { label: 'Columns', icon: 'columns', panel: columnsPanel },
	filters: { label: 'Filters', icon: 'filter', panel: filtersPanel },
	sort: { label: 'Sort', icon: 'sort', panel: sortPanel },
	themes: { label: 'Themes', icon: 'palette', panel: themesPanel },
	query: { label: 'Query', icon: 'query', panel: queryPanel },
};

const BUILTIN_ICONS: Record<BuiltinSidebarPanelId, SidebarIconName> = {
	columns: 'columns',
	filters: 'filter',
	sort: 'sort',
	themes: 'palette',
	views: 'views',
	query: 'query',
	dataIntegrity: 'integrity',
};

interface ResolvedPanel {
	id: string;
	label: string;
	icon: string;
	panel?: SidebarPanel<any>;
	renderPanel?: (context: SidebarPanelContext<any>) => unknown;
}

export interface GridSidebarDeps {
	mountFilterEditor(
		container: HTMLElement,
		colField: string,
		surface: FilterSurface,
		onApplied?: (filter: ColumnFilter | null) => void
	): DomFilterEditorHandle | null;
	mountDraftEditor(
		container: HTMLElement,
		colField: string,
		surface: FilterSurface,
		filter: ColumnFilter | null,
		onChange: (filter: ColumnFilter | null) => void
	): DomFilterEditorHandle | null;
	mountPanel?: AdapterPanelMount;
	scheduler?: GridScheduler;
}

function resolvePanels<TRowData>(config: GridSidebarConfig<TRowData>): ResolvedPanel[] {
	const out: ResolvedPanel[] = [];
	for (const entry of config.panels ?? DEFAULT_PANELS) {
		if (typeof entry === 'string') {
			const builtin = BUILTIN[entry];
			if (builtin) out.push({ id: entry, label: builtin.label, icon: sidebarIconSvg(builtin.icon, 18), panel: builtin.panel });
			continue;
		}
		const fallback = BUILTIN_ICONS[entry.id as BuiltinSidebarPanelId] ?? 'columns';
		out.push({
			id: entry.id,
			label: entry.label,
			icon: entry.icon ?? sidebarIconSvg(fallback, 18),
			panel: entry.panel,
			renderPanel: entry.renderPanel,
		});
	}
	return out;
}

export class GridSidebar<TRowData = unknown> {
	public readonly element: HTMLDivElement;
	private readonly rail: HTMLDivElement;
	private readonly panelArea: HTMLDivElement;
	private readonly title: HTMLHeadingElement;
	private readonly actions: HTMLDivElement;
	private readonly body: HTMLDivElement;
	private panels: ResolvedPanel[] = [];
	private config: GridSidebarConfig<TRowData>;
	private open: {
		id: string;
		handle: SidebarPanelHandle | void;
		unmount?: () => void;
		/** An adapter panel: its host, context and the render it was last given. */
		adapter?: { host: HTMLElement; context: SidebarPanelContext<TRowData>; render: (context: SidebarPanelContext<any>) => unknown };
	} | null = null;
	private closeTimer: ReturnType<GridScheduler['timeout']> | null = null;
	private readonly subscriptions = disposables();
	private readonly scheduler: GridScheduler;

	constructor(
		private readonly api: GridApi<TRowData>,
		config: GridSidebarConfig<TRowData>,
		private readonly deps: GridSidebarDeps
	) {
		this.config = config;
		this.scheduler = deps.scheduler ?? defaultGridScheduler;
		this.element = el('div', 'og-sb');
		this.rail = el('div', 'og-sb-rail');
		this.rail.setAttribute('role', 'tablist');
		this.rail.setAttribute('aria-orientation', 'vertical');
		this.rail.addEventListener('keydown', (event) => this.onRailKey(event));

		this.panelArea = el('div', 'og-sb-panel');
		const inner = el('div', 'og-sb-panel-inner');
		const head = el('div', 'og-sb-head');
		this.title = el('h2', 'og-sb-title');
		this.actions = el('div', 'og-sb-actions');
		head.append(
			this.title,
			this.actions,
			iconButton('x', 'Close panel', () => this.api.closePanel())
		);
		this.body = el('div', 'og-sb-body');
		inner.append(head, this.body);
		this.panelArea.appendChild(inner);
		this.panelArea.setAttribute('role', 'tabpanel');
		this.panelArea.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || event.defaultPrevented) return;
			event.preventDefault();
			const id = this.open?.id;
			this.api.closePanel();
			if (id) this.tabFor(id)?.focus();
		});
		this.element.append(this.panelArea, this.rail);

		this.applyConfig();
		this.subscriptions.add(this.api.subscribeToKey('sidebarOpenPanel', () => this.syncOpen()));
		for (const key of ['filterModel', 'sortModel', 'queryModel'] as const) {
			this.subscriptions.add(this.api.subscribeToKey(key, () => this.syncBadges()));
		}
		if (this.api.getOpenPanel() == null && config.defaultOpen) this.api.openPanel(config.defaultOpen);
		this.syncOpen();
	}

	/** Takes a new config; rebuilds only what changed. */
	public setConfig(config: GridSidebarConfig<TRowData>): void {
		this.config = config;
		this.applyConfig();
		this.syncOpen();
		// A new render for the open adapter panel (its closure saw new data): the adapter updates it in place.
		const open = this.open;
		const render = open?.adapter && this.panels.find((p) => p.id === open.id)?.renderPanel;
		if (open?.adapter && render && render !== open.adapter.render && this.deps.mountPanel) {
			open.adapter.render = render;
			this.deps.mountPanel(open.adapter.host, render, open.adapter.context);
		}
	}

	public destroy(): void {
		this.subscriptions.dispose();
		this.unmountPanel();
		if (this.closeTimer !== null) this.scheduler.clearTimeout(this.closeTimer);
		this.element.remove();
	}

	private applyConfig(): void {
		const next = resolvePanels(this.config);
		const sameRail =
			next.length === this.panels.length && next.every((p, i) => p.id === this.panels[i].id && p.label === this.panels[i].label && p.icon === this.panels[i].icon);
		this.panels = next;
		this.element.dataset.position = this.config.position ?? 'right';
		this.element.style.setProperty('--og-sb-width', `${this.config.width ?? DEFAULT_WIDTH}px`);
		if (sameRail) return;
		this.rail.textContent = '';
		for (const panel of next) {
			const tab = el('button', 'og-sb-tab');
			tab.type = 'button';
			tab.dataset.panel = panel.id;
			tab.title = panel.label;
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-label', panel.label);
			tab.innerHTML = panel.icon;
			tab.appendChild(el('span', 'og-sb-badge'));
			tab.addEventListener('click', () => this.api.togglePanel(panel.id));
			this.rail.appendChild(tab);
		}
		this.syncBadges();
	}

	private tabFor(id: string): HTMLButtonElement | null {
		return [...this.rail.querySelectorAll<HTMLButtonElement>('.og-sb-tab')].find((tab) => tab.dataset.panel === id) ?? null;
	}

	private onRailKey(event: KeyboardEvent): void {
		const tabs = [...this.rail.querySelectorAll<HTMLButtonElement>('.og-sb-tab')];
		const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		let next = -1;
		if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
		else if (event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = tabs.length - 1;
		if (next < 0) return;
		event.preventDefault();
		tabs[next].focus();
	}

	private syncBadges(): void {
		const state = this.api.getStateSnapshot();
		const summary = summarizeAnalysisState(state.filterModel ?? null, state.queryModel ?? null);
		const counts: Record<string, number> = {
			filters: summary.filterCount,
			query: summary.queryConditionCount,
			sort: state.sortModel?.length ?? 0,
		};
		for (const tab of this.rail.querySelectorAll<HTMLElement>('.og-sb-tab')) {
			const count = counts[tab.dataset.panel ?? ''] ?? 0;
			const badge = tab.querySelector('.og-sb-badge')!;
			badge.textContent = count > 9 ? '9+' : count > 0 ? String(count) : '';
			tab.toggleAttribute('data-badged', count > 0);
		}
	}

	private syncOpen(): void {
		const id = this.api.getOpenPanel();
		const panel = id ? (this.panels.find((p) => p.id === id) ?? null) : null;
		for (const tab of this.rail.querySelectorAll<HTMLElement>('.og-sb-tab')) {
			const selected = !!panel && tab.dataset.panel === panel.id;
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected || (!panel && tab === this.rail.firstElementChild) ? 0 : -1;
		}
		if (panel && this.open?.id === panel.id) return;
		if (this.closeTimer !== null) {
			this.scheduler.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}
		if (!panel) {
			this.element.removeAttribute('data-open');
			// Keep the content through the closing slide, then let it go.
			if (this.open) this.closeTimer = this.scheduler.timeout(() => ((this.closeTimer = null), this.unmountPanel()), CLOSE_MS);
			return;
		}
		this.unmountPanel();
		this.element.setAttribute('data-open', '');
		this.title.textContent = panel.label;
		const context: SidebarPanelContext<TRowData> = {
			api: this.api,
			actions: this.actions,
			close: () => this.api.closePanel(),
			mountFilterEditor: (container, colField, options = {}) => {
				const surface = options.surface ?? 'sidebar';
				if (options.draft) return this.deps.mountDraftEditor(container, colField, surface, options.draft.filter, options.draft.onChange);
				return this.deps.mountFilterEditor(container, colField, surface, options.onApplied);
			},
		};
		if (panel.panel) {
			this.open = { id: panel.id, handle: panel.panel.mount(this.body, context) };
		} else if (panel.renderPanel && this.deps.mountPanel) {
			// Its own host: clearing the body detaches it whole, and the adapter unmounts its tree from it.
			const host = this.body.appendChild(el('div', 'og-sb-adapter'));
			this.open = {
				id: panel.id,
				handle: undefined,
				unmount: this.deps.mountPanel(host, panel.renderPanel, context),
				adapter: { host, context, render: panel.renderPanel },
			};
		} else {
			this.open = { id: panel.id, handle: undefined };
		}
	}

	private unmountPanel(): void {
		if (!this.open) return;
		this.open.handle?.destroy?.();
		this.open.unmount?.();
		this.open = null;
		this.body.textContent = '';
		this.actions.textContent = '';
	}
}
