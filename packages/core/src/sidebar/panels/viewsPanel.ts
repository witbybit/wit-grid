/**
 * Views: the view on the grid now (save changes, revert, save as new), the saved views (one click
 * applies; a menu sets the default, renames, duplicates, deletes), and, with persistence, whether
 * the grid remembers its layout.
 */
import { openCellPopover, type CellPopover } from '../../cells/popover.js';
import type { GridViewDefinition } from '../../workspace/workspaceTypes.js';
import { disposables, el, emptyState, icon, iconButton, searchField, switchRow, textButton } from '../panelKit.js';
import type { SidebarIconName } from '../sidebarIcons.js';
import type { SidebarPanel } from '../sidebarTypes.js';

function ago(timestamp: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
	if (seconds < 45) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** An inline name field: Enter saves, Escape cancels. */
function nameField(initial: string, placeholder: string, onSave: (name: string) => void, onCancel: () => void, saveLabel = 'Save') {
	const row = el('form', 'og-sb-name-field');
	const input = el('input', 'og-sb-input');
	input.value = initial;
	input.placeholder = placeholder;
	input.spellcheck = false;
	input.setAttribute('aria-label', placeholder);
	const save = textButton(saveLabel, () => {}, 'primary');
	save.type = 'submit';
	const cancel = iconButton('x', 'Cancel', onCancel, 14);
	row.append(input, save, cancel);
	const sync = () => (save.disabled = !input.value.trim());
	input.addEventListener('input', sync);
	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		onCancel();
	});
	row.addEventListener('submit', (event) => {
		event.preventDefault();
		const name = input.value.trim();
		if (name) onSave(name);
	});
	sync();
	return { element: row, focus: () => (input.focus(), input.select()) };
}

export const viewsPanel: SidebarPanel<any> = {
	mount(container, { api }) {
		const d = disposables();
		let menu: CellPopover | null = null;
		let mode: { kind: 'idle' } | { kind: 'saveAs' } | { kind: 'rename'; id: string } = { kind: 'idle' };
		let confirmDelete: string | null = null;
		let confirmReset = false;
		let query = '';
		const root = el('div', 'og-sb-stack og-sb-views');
		container.appendChild(root);

		if (!api.hasWorkspace()) {
			root.appendChild(
				emptyState('views', 'Views are not set up', 'Give the grid a workspace (for example createLocalStorageWorkspaceAdapter) to save and switch views.')
			);
			return { destroy: () => d.dispose() };
		}

		const current = el('div', 'og-sb-current');
		const error = el('div', 'og-sb-warn');
		const listHead = el('div', 'og-sb-list-head');
		const search = searchField('Find a view…', (q) => {
			query = q;
			renderList();
		});
		const list = el('div', 'og-sb-views-list');
		list.setAttribute('role', 'list');
		const footer = el('div', 'og-sb-views-footer');
		root.append(current, error, listHead, search.element, list, footer);

		const guard = (work: Promise<unknown>) => work.catch(() => {}); // failures land in lastError (shown) and runtime faults
		const state = () => api.getWorkspaceState();
		const writable = (v: GridViewDefinition | undefined) => !!v && v.scope !== 'system';

		const renderCurrent = () => {
			const s = state();
			const active = s.activeViewId ? s.views.find((v) => v.id === s.activeViewId) : undefined;
			current.textContent = '';
			current.toggleAttribute('data-dirty', !!active && s.dirty);
			const top = el('div', 'og-sb-current-top');
			const badge = el('span', 'og-sb-current-icon');
			badge.appendChild(icon('views', 16));
			const text = el('div', 'og-sb-current-text');
			text.append(
				el('span', 'og-sb-current-kicker', active ? 'Current view' : 'Current layout'),
				el('span', 'og-sb-current-name', active ? active.name : 'Unsaved layout')
			);
			top.append(badge, text);
			if (active) {
				const pill = el('span', 'og-sb-status-pill', s.dirty ? 'Edited' : 'Saved');
				pill.toggleAttribute('data-dirty', s.dirty);
				top.appendChild(pill);
			}
			current.appendChild(top);

			if (mode.kind === 'saveAs') {
				const field = nameField(
					active ? `${active.name} copy` : '',
					'View name',
					(name) => {
						mode = { kind: 'idle' };
						void guard(api.saveView(name));
						render();
					},
					() => {
						mode = { kind: 'idle' };
						render();
					}
				);
				current.appendChild(field.element);
				field.focus();
				return;
			}
			const buttons = el('div', 'og-sb-current-actions');
			if (active && s.dirty) {
				if (writable(active)) buttons.appendChild(textButton('Save changes', () => void guard(api.updateView(active.id)), 'primary'));
				buttons.appendChild(textButton('Revert', () => void guard(api.revertView())));
			}
			buttons.appendChild(
				textButton(
					active ? 'Save as new' : 'Save as view',
					() => {
						mode = { kind: 'saveAs' };
						render();
					},
					active && s.dirty ? 'ghost' : 'subtle',
					'plus'
				)
			);
			current.appendChild(buttons);
			if (active && s.dirty && !writable(active)) current.appendChild(el('div', 'og-sb-hint', 'This is a shared view: save your changes as a new one.'));
		};

		const openMenu = (anchor: HTMLElement, view: GridViewDefinition) => {
			menu?.close();
			const s = state();
			const box = el('div', 'og-sb-menu');
			box.setAttribute('role', 'menu');
			const item = (label: string, iconName: SidebarIconName, onClick: () => void, danger = false) => {
				const b = el('button', 'og-sb-menu-item');
				b.type = 'button';
				b.setAttribute('role', 'menuitem');
				b.toggleAttribute('data-danger', danger);
				b.append(icon(iconName, 14), el('span', undefined, label));
				b.addEventListener('click', onClick);
				box.appendChild(b);
				return b;
			};
			const isDefault = s.defaultViewId === view.id;
			item(isDefault ? 'Remove as default' : 'Open by default', 'star', () => {
				menu?.close();
				void guard(api.setDefaultView(isDefault ? null : view.id));
			});
			if (writable(view))
				item('Rename', 'pencil', () => {
					menu?.close();
					mode = { kind: 'rename', id: view.id };
					renderList();
				});
			item('Duplicate', 'columns', () => {
				menu?.close();
				void guard(api.duplicateView(view.id, `${view.name} copy`));
			});
			if (writable(view)) {
				box.appendChild(el('div', 'og-sb-menu-sep'));
				const del = item('Delete', 'trash', () => {
					if (confirmDelete !== view.id) {
						confirmDelete = view.id;
						del.querySelector('span:not(.og-sb-icon)')!.textContent = 'Click again to delete';
						return;
					}
					confirmDelete = null;
					menu?.close();
					void guard(api.deleteView(view.id));
				}, true);
			}
			menu = openCellPopover({
				anchor,
				content: box,
				label: `${view.name} actions`,
				onDismiss: () => {
					menu = null;
					confirmDelete = null;
				},
			});
			box.querySelector<HTMLElement>('button')?.focus();
		};

		const renderList = () => {
			const s = state();
			listHead.textContent = '';
			listHead.append(el('span', 'og-sb-list-title', 'Saved views'));
			if (s.views.length > 0) listHead.appendChild(el('span', 'og-sb-count', String(s.views.length)));
			search.element.hidden = s.views.length < 7;
			list.textContent = '';
			if (s.loading && s.views.length === 0) {
				list.appendChild(el('div', 'og-sb-hint', 'Loading views…'));
				return;
			}
			if (s.views.length === 0) {
				list.appendChild(emptyState('views', 'No saved views yet', 'Save the columns, sort, filters and grouping you set up, and switch back to them in one click.'));
				return;
			}
			const shown = query ? s.views.filter((v) => v.name.toLowerCase().includes(query)) : s.views;
			if (shown.length === 0) {
				list.appendChild(el('div', 'og-sb-hint', `No view is called “${query}”.`));
				return;
			}
			// The default first, then the most recently changed.
			const sorted = [...shown].sort((a, b) => Number(b.id === s.defaultViewId) - Number(a.id === s.defaultViewId) || b.updatedAt - a.updatedAt);
			for (const view of sorted) {
				if (mode.kind === 'rename' && mode.id === view.id) {
					const field = nameField(
						view.name,
						'View name',
						(name) => {
							mode = { kind: 'idle' };
							void guard(api.renameView(view.id, name));
							renderList();
						},
						() => {
							mode = { kind: 'idle' };
							renderList();
						},
						'Rename'
					);
					list.appendChild(field.element);
					field.focus();
					continue;
				}
				const active = s.activeViewId === view.id;
				const row = el('div', 'og-sb-view');
				row.setAttribute('role', 'listitem');
				row.toggleAttribute('data-active', active);
				const apply = el('button', 'og-sb-view-main');
				apply.type = 'button';
				apply.title = active ? `${view.name} is on the grid` : `Apply ${view.name}`;
				apply.setAttribute('aria-current', String(active));
				const mark = el('span', 'og-sb-view-mark');
				if (active) mark.appendChild(icon('check', 12));
				const text = el('span', 'og-sb-view-text');
				const name = el('span', 'og-sb-view-name', view.name);
				const meta = el('span', 'og-sb-view-meta');
				if (s.defaultViewId === view.id) {
					const star = el('span', 'og-sb-view-default');
					star.append(icon('star', 11), el('span', undefined, 'Default'));
					meta.appendChild(star);
				}
				if (view.scope !== 'personal') meta.appendChild(el('span', 'og-sb-view-scope', view.scope === 'team' ? 'Team' : 'System'));
				meta.appendChild(el('span', undefined, `Updated ${ago(view.updatedAt)}`));
				text.append(name, meta);
				apply.append(mark, text);
				apply.addEventListener('click', () => {
					if (!active || s.dirty) void guard(api.applyView(view.id));
				});
				const more = iconButton('more', `${view.name} actions`, () => openMenu(more, view), 16);
				more.classList.add('og-sb-view-more');
				row.append(apply, more);
				list.appendChild(row);
			}
		};

		const renderError = () => {
			const message = state().lastError;
			error.hidden = !message;
			error.textContent = '';
			if (message) error.append(icon('alert', 14), el('span', undefined, message));
		};

		const renderFooter = () => {
			footer.textContent = '';
			footer.hidden = !api.hasPersistence();
			if (footer.hidden) return;
			const status = api.getPersistenceStatus();
			const box = el('div', 'og-sb-group-options');
			box.appendChild(switchRow('Remember layout', status.autoSave, (on) => api.setAutoSave(on)));
			footer.appendChild(box);
			const line = el('div', 'og-sb-save-line');
			const text =
				status.status === 'saving'
					? 'Saving…'
					: status.status === 'error'
						? 'Could not save the layout'
						: status.lastSavedAt
							? `Saved ${ago(status.lastSavedAt)}`
							: status.autoSave
								? 'Changes are saved as you go'
								: 'Changes are not saved';
			const label = el('span', 'og-sb-save-status', text);
			label.toggleAttribute('data-error', status.status === 'error');
			const reset = textButton(confirmReset ? 'Click again to reset' : 'Reset layout', () => {
				if (!confirmReset) {
					confirmReset = true;
					renderFooter();
					return;
				}
				confirmReset = false;
				void Promise.resolve(api.clearPersistedState()).catch(() => {});
				renderFooter();
			});
			reset.toggleAttribute('data-danger', confirmReset);
			line.append(label, reset);
			footer.appendChild(line);
		};

		const render = () => {
			renderCurrent();
			renderError();
			renderList();
			renderFooter();
		};
		render();
		d.add(api.subscribeToWorkspaceState(() => (mode.kind === 'saveAs' ? (renderError(), renderList()) : render())));
		d.add(api.subscribeToPersistenceStatus(renderFooter));
		return {
			destroy() {
				menu?.close();
				d.dispose();
			},
		};
	},
};
