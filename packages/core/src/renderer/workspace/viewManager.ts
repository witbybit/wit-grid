import type { GridViewConfig, GridViewKind } from '../../views.js';
import type { GridViewDefinition } from '../../workspace/workspaceTypes.js';
import { icon, type WorkspaceIconName } from './icons.js';
import { h, openMenu, type MenuItem } from './ui.js';
import type { WorkspaceHost, WorkspaceTabEntry } from './workspaceHost.js';
import { VIEW_META } from './viewMeta.js';

/** A saved view as a tab: its name, and the view its state shows (the table when it holds none). */
export function savedViewTab<T>(view: GridViewDefinition): WorkspaceTabEntry<T> {
	const config = (view.state.state.view ?? null) as GridViewConfig<T> | null;
	return { id: `saved:${view.id}`, name: view.name, view: config, saved: view };
}

const KINDS: readonly (GridViewKind | 'table')[] = ['table', 'gallery', 'calendar', 'kanban', 'gantt'];
const DESCRIPTIONS: Record<GridViewKind | 'table', string> = {
	table: 'Rows and columns, spreadsheet editing',
	gallery: 'Cards with covers, in sections',
	calendar: 'Records on their dates',
	kanban: 'Columns by status, swimlanes, WIP',
	gantt: 'Schedule, dependencies, critical path',
};

/**
 * Create a view: pick a kind, name it, set what it groups by, and — when the grid has a saved-views
 * store — keep it for yourself or share it with the team. The new view opens at once.
 */
export async function openCreateViewDialog<T>(host: WorkspaceHost<T>, initialKind: GridViewKind | 'table' = 'kanban'): Promise<void> {
	const api = host.engine.getApiRef();
	const reader = host.reader();
	const columns = host.recordColumns();
	const optionFields = columns.filter((col) => col.schema && ['select', 'person', 'checkbox', 'tags', 'multiSelect'].includes(col.schema.kind));
	let kind = initialKind;
	const name = h('input', 'og-ws-input', { type: 'text', 'aria-label': 'View name', placeholder: 'View name' });
	const kinds = h('div', 'og-ws-kind-grid', { role: 'radiogroup', 'aria-label': 'Kind' });
	const options = h('div', 'og-ws-view-options');
	const select = (label: string, choices: { value: string; label: string }[], value: string) => {
		const el = h('select', 'og-ws-input', { 'aria-label': label });
		for (const choice of choices) {
			const option = h('option', null, { value: choice.value }, choice.label);
			option.selected = choice.value === value;
			el.append(option);
		}
		options.append(h('label', 'og-ws-field-row', null, h('span', 'og-ws-hint', null, label), el));
		return el;
	};
	let controls: Record<string, HTMLSelectElement> = {};
	const drawOptions = () => {
		options.replaceChildren();
		controls = {};
		const none = { value: '', label: 'None' };
		const fieldChoices = optionFields.map((col) => ({ value: col.field, label: col.header ?? col.field }));
		if (kind === 'kanban') {
			controls.columnField = select('Columns', fieldChoices, reader.roles.status ?? fieldChoices[0]?.value ?? '');
			controls.swimlaneField = select('Swimlanes', [none, ...fieldChoices], '');
		} else if (kind === 'gallery') {
			controls.groupBy = select('Sections', [none, ...fieldChoices], reader.roles.status ?? '');
			controls.layout = select(
				'Card size',
				[
					{ value: 'small', label: 'Small' },
					{ value: 'medium', label: 'Medium' },
					{ value: 'large', label: 'Large' },
					{ value: 'compact', label: 'Compact rows' },
				],
				'medium'
			);
		} else if (kind === 'gantt') {
			controls.zoom = select(
				'Time scale',
				['day', 'week', 'month', 'quarter', 'year'].map((zoom) => ({ value: zoom, label: zoom[0].toUpperCase() + zoom.slice(1) + 's' })),
				'week'
			);
		} else if (kind === 'table') {
			controls.groupBy = select('Group rows by', [none, ...fieldChoices], '');
		}
		if (!options.childElementCount)
			options.append(h('p', 'og-ws-hint', null, kind === 'calendar' ? 'Records are placed by their schedule or due date.' : ''));
	};
	const drawKinds = () => {
		kinds.replaceChildren(
			...KINDS.map((candidate) => {
				const meta = VIEW_META[candidate];
				const supported =
					candidate === 'table' ||
					candidate === 'gallery' ||
					(candidate === 'kanban' ? optionFields.length > 0 : !!(reader.roles.schedule || reader.roles.start || reader.roles.due));
				const card = h(
					'button',
					'og-ws-kind',
					{ type: 'button', role: 'radio', 'aria-checked': String(candidate === kind), disabled: !supported },
					icon(meta.icon as WorkspaceIconName, 20),
					h('strong', null, null, meta.label),
					h('span', 'og-ws-hint', null, supported ? DESCRIPTIONS[candidate] : 'Needs date fields')
				);
				card.addEventListener('click', () => {
					kind = candidate;
					if (!name.value || name.dataset.auto) {
						name.value = meta.label;
						name.dataset.auto = '1';
					}
					drawKinds();
					drawOptions();
				});
				return card;
			})
		);
	};
	name.addEventListener('input', () => delete name.dataset.auto);
	name.value = VIEW_META[kind].label;
	name.dataset.auto = '1';
	drawKinds();
	drawOptions();
	const saving = api.hasWorkspace();
	const scope = h('select', 'og-ws-input', { 'aria-label': 'Who sees it' });
	scope.append(h('option', null, { value: 'personal' }, 'Only me'), h('option', null, { value: 'team' }, 'Everyone on the team'));
	const body = h(
		'div',
		'og-ws-create-view',
		null,
		h('label', 'og-ws-field-row', null, h('span', 'og-ws-hint', null, 'Name'), name),
		kinds,
		options,
		saving
			? h('label', 'og-ws-field-row', null, h('span', 'og-ws-hint', null, 'Visible to'), scope)
			: h('p', 'og-ws-hint', null, 'This view lasts for the session. Give the grid a saved-views store to keep views.')
	);
	const answer = await host.confirm({ title: 'New view', body, confirm: 'Create view' });
	if (answer !== 'confirm') return;
	const value = (key: string) => controls[key]?.value || undefined;
	let config: GridViewConfig<T> | null;
	switch (kind) {
		case 'kanban':
			config = { kind, columnField: value('columnField'), swimlaneField: value('swimlaneField') ?? null };
			break;
		case 'gallery':
			config = { kind, groupBy: value('groupBy') ?? null, layout: value('layout') as 'medium' };
			break;
		case 'gantt':
			config = { kind, zoom: value('zoom') as 'week' };
			break;
		case 'calendar':
			config = { kind };
			break;
		default:
			config = null;
			api.setGroupBy(value('groupBy') ? [value('groupBy')!] : []);
	}
	const label = name.value.trim() || VIEW_META[kind].label;
	await host.addView(label, config, saving ? (scope.value as 'personal' | 'team') : null);
}

/** Actions on a view tab: rename, duplicate, update from the grid, default, delete. */
export function openTabMenu<T>(host: WorkspaceHost<T>, tab: WorkspaceTabEntry<T>, anchor: HTMLElement): void {
	const api = host.engine.getApiRef();
	const saved = tab.saved;
	const state = api.getWorkspaceState();
	const active = host.getActiveTab().id === tab.id;
	const items: (MenuItem | 'separator')[] = [];
	if (saved) {
		items.push(
			{ heading: true, label: saved.scope === 'team' ? 'Shared with the team' : 'Personal view' },
			{ label: 'Save changes', icon: 'check', disabled: !(active && state.dirty), run: () => void host.saveActiveView() },
			{ label: 'Revert changes', icon: 'undo', disabled: !(active && state.dirty), run: () => void api.revertView() },
			{ label: 'Rename…', icon: 'edit', run: () => void host.renameView(saved) },
			{ label: 'Duplicate', icon: 'copy', run: () => void api.duplicateView(saved.id, `${saved.name} copy`) },
			{
				label: state.defaultViewId === saved.id ? 'Default view' : 'Make default',
				icon: 'star',
				checked: state.defaultViewId === saved.id,
				run: () => void api.setDefaultView(state.defaultViewId === saved.id ? null : saved.id),
			},
			'separator',
			{ label: 'Delete view', icon: 'trash', danger: true, run: () => void host.deleteSavedView(saved) }
		);
	} else {
		items.push({
			label: 'Save as a new view…',
			icon: 'plus',
			disabled: !api.hasWorkspace(),
			run: () => void openCreateViewDialog(host, tab.view?.kind ?? 'table'),
		});
	}
	openMenu(anchor, items, `${tab.name} actions`);
}
