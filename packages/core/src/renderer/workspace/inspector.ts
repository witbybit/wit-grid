import type { ColumnDef } from '../../columnDef.js';
import type { RecordRow } from '../../records/recordModel.js';
import type { RecordActivityEntry, RecordComment, RecordFile, RecordLink } from '../../views.js';
import { editsInTable, FieldValue, mountFieldEditor } from './fieldValue.js';
import { icon, type WorkspaceIconName } from './icons.js';
import { blockedBadge, initials, presenceDots } from './recordParts.js';
import { button, h, hue } from './ui.js';
import type { InspectorTab } from './viewTypes.js';
import type { WorkspaceHost } from './workspaceHost.js';

const ROLE_ICONS: Record<string, WorkspaceIconName> = {
	owner: 'user',
	due: 'calendar',
	schedule: 'calendar',
	start: 'calendar',
	end: 'calendar',
	estimate: 'clock',
	value: 'coins',
	progress: 'progress',
	team: 'users',
	labels: 'tag',
	dependencies: 'dependency',
	parent: 'layout',
	baseline: 'baseline',
	milestone: 'diamond',
	priority: 'flag',
	status: 'progress',
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
export function timeAgo(at: number): string {
	const seconds = Math.round((at - Date.now()) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 45) return 'just now';
	if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
	if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
	return relative.format(Math.round(seconds / 86400), 'day');
}

/**
 * The record workspace beside the view: identity, status and priority, every property drawn and
 * edited by its column, dependencies, the description, and tabs for discussion, history, files,
 * links and whatever the view adds (schedule, resources). It follows the focused record across
 * view switches, and redraws in place when the record changes.
 */
export class Inspector<TRowData> {
	readonly element: HTMLElement;
	private recordId: string | null = null;
	private fields: FieldValue<TRowData>[] = [];
	private cleanups: (() => void)[] = [];
	private editing: (() => void) | null = null;
	private tab = 'comments';
	private body: HTMLElement;
	private renderedFor: unknown = null;

	constructor(
		private readonly host: WorkspaceHost<TRowData>,
		parent: HTMLElement
	) {
		this.element = h('aside', 'og-ws-inspector', { 'aria-label': 'Record', hidden: true });
		const width = host.options.inspector ? host.options.inspector.width : undefined;
		if (width) this.element.style.setProperty('--og-ws-inspector-width', `${width}px`);
		this.body = h('div', 'og-ws-inspector-body');
		this.element.append(this.body);
		parent.append(this.element);
	}

	isOpen(): boolean {
		return this.recordId !== null;
	}

	follows(): boolean {
		return this.isOpen() && !this.editing;
	}

	open(id: string): void {
		if (this.host.options.inspector === false) return;
		if (this.recordId === id && !this.element.hidden && !this.element.hasAttribute('data-leaving')) return;
		const switching = this.recordId !== null && !this.element.hidden;
		this.recordId = id;
		this.element.removeAttribute('data-leaving');
		this.element.hidden = false;
		this.host.root.setAttribute('data-inspecting', '');
		this.render();
		// Another record in the open inspector: the body cross-fades rather than snapping.
		if (switching && this.host.motion.enabled) {
			this.body.removeAttribute('data-switching');
			void this.body.offsetWidth;
			this.body.setAttribute('data-switching', '');
		}
	}

	close(): void {
		const id = this.recordId;
		this.teardown();
		this.recordId = null;
		this.host.root.removeAttribute('data-inspecting');
		const hide = () => {
			// Reopened while leaving: stay.
			if (this.recordId !== null) return;
			this.element.hidden = true;
			this.element.removeAttribute('data-leaving');
			this.host.scheduleRender();
		};
		if (this.host.motion.enabled && !this.element.hidden) {
			this.element.setAttribute('data-leaving', '');
			this.element.addEventListener('animationend', hide, { once: true });
		} else hide();
		if (id) this.host.getView()?.reveal(id)?.focus({ preventScroll: true });
	}

	/** The record changed (or anything did): redraw values in place, keeping an open editor. */
	refresh(id?: string): void {
		if (!this.recordId || (id && id !== this.recordId)) return;
		const row = this.host.lookup(this.recordId);
		if (!row) {
			this.close();
			return;
		}
		if (this.editing) return;
		// Values redraw in place; structure (tabs from a new view) rebuilds.
		if (this.renderedFor !== this.host.getView()) {
			this.render();
			return;
		}
		for (const field of this.fields) field.show(row);
		const title = this.body.querySelector<HTMLElement>('.og-ws-inspector-title');
		const text = this.host.reader().title(row);
		if (title && title.textContent !== text && document.activeElement !== title) title.textContent = text;
	}

	private teardown(): void {
		this.editing?.();
		this.editing = null;
		for (const field of this.fields) field.destroy();
		this.fields = [];
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups = [];
	}

	private render(): void {
		this.teardown();
		const host = this.host;
		const id = this.recordId!;
		const row = host.lookup(id);
		this.renderedFor = host.getView();
		if (!row) {
			this.body.replaceChildren(h('div', 'og-ws-empty', null, 'This record is no longer available.'));
			return;
		}
		const reader = host.reader();
		const roles = reader.roles;
		const api = host.engine.getApiRef();

		// Header: key, actions, title, status / priority.
		const expand = button({ icon: 'table', title: 'Show in table' }, () => host.openInTable(id));
		const close = button({ icon: 'close', title: 'Close (Esc)' }, () => this.close());
		const head = h(
			'header',
			'og-ws-inspector-head',
			null,
			h('span', 'og-ws-key', null, reader.key(row)),
			presenceDots(host.context, id),
			h('span', 'og-ws-spacer'),
			expand,
			close
		);
		const title = h('h2', 'og-ws-inspector-title', { tabindex: 0 }, reader.title(row));
		if (roles.title && api.canEdit(id, roles.title)) {
			title.contentEditable = 'true';
			title.setAttribute('role', 'textbox');
			title.setAttribute('aria-label', 'Title');
			title.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					title.blur();
				}
				if (event.key === 'Escape') {
					title.textContent = reader.title(row);
					title.blur();
				}
			});
			title.addEventListener('blur', () => {
				const next = title.textContent?.trim() ?? '';
				if (next && next !== reader.title(host.lookup(id) ?? row)) host.write([{ rowId: id, colField: roles.title!, value: next }]);
			});
		}
		const chips = h('div', 'og-ws-inspector-chips');
		for (const field of [roles.status, roles.priority]) {
			const col = reader.column(field);
			if (col) chips.append(this.property(col, row, true));
		}
		const blocked = this.isBlocked(row);
		if (blocked) chips.append(blockedBadge());

		// Properties: roles first, then the remaining fields.
		const configured = host.options.inspector ? host.options.inspector.fields : undefined;
		const shownRoles = [
			'owner',
			'due',
			'schedule',
			'start',
			'end',
			'estimate',
			'value',
			'progress',
			'team',
			'labels',
			'baseline',
			'milestone',
		] as const;
		const columns = host.recordColumns();
		const ordered: ColumnDef<TRowData>[] = configured
			? configured.map((field) => reader.column(field)).filter((col): col is ColumnDef<TRowData> => !!col)
			: [
					...shownRoles.map((role) => reader.column(roles[role])).filter((col): col is ColumnDef<TRowData> => !!col),
					...columns.filter(
						(col) =>
							![
								roles.title,
								roles.status,
								roles.priority,
								roles.description,
								roles.dependencies,
								roles.parent,
								roles.key,
								roles.rank,
								roles.cover,
							].includes(col.field) && !shownRoles.some((role) => roles[role] === col.field)
					),
				];
		const props = h('div', 'og-ws-props', { role: 'list' });
		const seen = new Set<string>();
		for (const col of ordered) {
			if (seen.has(col.field)) continue;
			seen.add(col.field);
			props.append(this.property(col, row, false));
		}
		const dependencies = this.dependencies(row);

		// Description.
		const description = reader.column(roles.description);
		const about = description
			? h(
					'section',
					'og-ws-inspector-section',
					null,
					h('h3', null, null, description.header ?? 'Description'),
					this.property(description, row, true, true)
				)
			: null;

		// Tabs.
		const tabs = this.tabs(row);
		const tabList = h('div', 'og-ws-inspector-tabs', { role: 'tablist' });
		const panel = h('div', 'og-ws-inspector-panel', { role: 'tabpanel' });
		if (!tabs.some((tab) => tab.id === this.tab)) this.tab = tabs[0]?.id ?? '';
		const show = (tab: InspectorTab) => {
			this.tab = tab.id;
			for (const el of tabList.children as HTMLCollectionOf<HTMLElement>) el.setAttribute('aria-selected', String(el.dataset.tab === tab.id));
			panel.replaceChildren();
			const cleanup = tab.render(panel);
			if (cleanup) this.cleanups.push(cleanup);
		};
		for (const tab of tabs) {
			const el = h('button', 'og-ws-inspector-tab', { type: 'button', role: 'tab', 'data-tab': tab.id }, tab.label);
			if (tab.count) el.append(h('span', 'og-ws-badge og-ws-badge-quiet', null, String(tab.count)));
			el.addEventListener('click', () => show(tab));
			tabList.append(el);
		}
		this.body.replaceChildren(head, title, chips, props, dependencies ?? '', about ?? '', tabs.length ? tabList : '', tabs.length ? panel : '');
		const active = tabs.find((tab) => tab.id === this.tab);
		if (active) show(active);
	}

	private isBlocked(row: RecordRow<TRowData>): boolean {
		return this.host.reader().isBlocked(row, (id) => this.host.lookup(id));
	}

	/** A field drawn by its column; click (or Enter) edits it with the column's editor. */
	private property(col: ColumnDef<TRowData>, row: RecordRow<TRowData>, bare: boolean, block = false): HTMLElement {
		const host = this.host;
		const api = host.engine.getApiRef();
		const reader = host.reader();
		const role = Object.entries(reader.roles).find(([, field]) => field === col.field)?.[0];
		const field = new FieldValue(col, api);
		field.show(row);
		this.fields.push(field);
		const value = h('div', `og-ws-prop-value${block ? ' og-ws-prop-block' : ''}`, null, field.element);
		const editable = api.canEdit(row.id, col.field);
		if (editable) {
			value.tabIndex = 0;
			value.setAttribute('role', 'button');
			value.setAttribute('aria-label', `Edit ${col.header ?? col.field}`);
			const edit = () => {
				if (this.editing) return;
				const current = api.getCellValue(row.id, col.field);
				if (editsInTable(col, current)) {
					host.openInTable(row.id, col.field);
					api.startEditing(row.id, col.field);
					return;
				}
				field.element.hidden = true;
				value.setAttribute('data-editing', '');
				const stop = mountFieldEditor(value, api, row.id, col, () => {
					this.editing?.();
					this.editing = null;
					value.focus();
				});
				this.editing = () => {
					stop();
					field.element.hidden = false;
					value.removeAttribute('data-editing');
					const latest = host.lookup(row.id);
					if (latest) field.show(latest);
				};
			};
			value.addEventListener('click', (event) => {
				if (!(event.target as Element).closest('.og-ws-editor')) edit();
			});
			value.addEventListener('keydown', (event) => {
				if ((event.key === 'Enter' || event.key === 'F2') && event.target === value) {
					event.preventDefault();
					edit();
				}
			});
		} else value.setAttribute('aria-readonly', 'true');
		if (bare) return value;
		const label = h('span', 'og-ws-prop-label', null, icon(ROLE_ICONS[role ?? ''] ?? 'fields', 15), col.header ?? col.field);
		if (!editable) label.append(icon('lock', 12));
		return h('div', 'og-ws-prop', { role: 'listitem' }, label, value);
	}

	private dependencies(row: RecordRow<TRowData>): HTMLElement | null {
		const host = this.host;
		const reader = host.reader();
		if (!reader.roles.dependencies) return null;
		const predecessors = reader.dependencies(row);
		const successors = host.rows().flatMap((other) => reader.dependencies(other).filter((link) => link.from === row.id));
		const chip = (id: string, direction: 'up' | 'down', type: string) => {
			const other = host.lookup(id);
			const done = other ? reader.isDone(other) : false;
			const el = h('button', `og-ws-dep-chip${done ? ' og-ws-done' : ''}`, {
				type: 'button',
				title: `${direction === 'up' ? 'Waits on' : 'Blocks'} ${other ? reader.title(other) : id} (${type})`,
			});
			el.append(h('span', `og-ws-dep-arrow og-ws-dep-${direction}`, null, direction === 'up' ? '↑' : '↓'), other ? reader.key(other) : id);
			el.addEventListener('click', () => host.focus(id, { inspect: true }));
			return el;
		};
		const list = h(
			'div',
			'og-ws-dep-list',
			null,
			...predecessors.map((link) => chip(link.from, 'up', link.type)),
			...successors.map((link) => chip(link.to, 'down', link.type))
		);
		if (!predecessors.length && !successors.length) list.append(h('span', 'og-ws-hint', null, 'None'));
		return h('div', 'og-ws-prop', { role: 'listitem' }, h('span', 'og-ws-prop-label', null, icon('dependency', 15), 'Dependencies'), list);
	}

	private tabs(row: RecordRow<TRowData>): InspectorTab[] {
		const host = this.host;
		const collaboration = host.options.collaboration;
		const counts = collaboration?.counts?.(row.id) ?? {};
		const tabs: InspectorTab[] = [];
		if (collaboration?.listComments)
			tabs.push({ id: 'comments', label: 'Comments', count: counts.comments, render: (panel) => this.comments(panel, row.id) });
		tabs.push({ id: 'activity', label: 'Activity', render: (panel) => this.activity(panel, row.id) });
		if (collaboration?.listFiles) tabs.push({ id: 'files', label: 'Files', count: counts.files, render: (panel) => this.files(panel, row.id) });
		if (collaboration?.listLinks) tabs.push({ id: 'links', label: 'Links', count: counts.links, render: (panel) => this.links(panel, row.id) });
		tabs.push(...(host.getView()?.inspectorTabs?.(row.id) ?? []));
		return tabs;
	}

	private async load<T>(
		panel: HTMLElement,
		source: () => Promise<readonly T[]> | readonly T[],
		draw: (items: readonly T[]) => void
	): Promise<void> {
		panel.replaceChildren(h('div', 'og-ws-hint', null, 'Loading…'));
		try {
			const items = await source();
			if (panel.isConnected) draw(items);
		} catch (error) {
			if (panel.isConnected)
				panel.replaceChildren(h('div', 'og-ws-hint', null, `Could not load: ${error instanceof Error ? error.message : String(error)}`));
		}
	}

	private personBadge(person: { name: string; color?: string; avatarUrl?: string } | undefined): HTMLElement {
		const el = h('span', 'og-ws-avatar og-ws-avatar-md og-ws-actor', null, initials(person?.name ?? '?'));
		el.style.setProperty('--og-ct-hue', hue(person?.color, person?.name ?? '?'));
		return el;
	}

	private comments(panel: HTMLElement, id: string): void {
		const collaboration = this.host.options.collaboration!;
		const list = h('div', 'og-ws-feed');
		const input = h('textarea', 'og-ws-input og-ws-composer-input', { rows: 1, placeholder: 'Add a comment…', 'aria-label': 'Add a comment' });
		const send = button({ icon: 'send', title: 'Send (Ctrl+Enter)' });
		const composer = h('div', 'og-ws-composer', null, this.personBadge(collaboration.me), input, send);
		const submit = async () => {
			const body = input.value.trim();
			if (!body || !collaboration.addComment) return;
			input.value = '';
			send.disabled = true;
			try {
				await collaboration.addComment(id, body);
				draw();
			} catch (error) {
				this.host.toast(`Comment not sent: ${error instanceof Error ? error.message : String(error)}`, 'error');
				input.value = body;
			}
			send.disabled = false;
		};
		send.addEventListener('click', () => void submit());
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				void submit();
			}
		});
		const draw = () =>
			void this.load<RecordComment>(
				list,
				() => collaboration.listComments!(id),
				(items) => {
					list.replaceChildren(
						...(items.length
							? items.map((comment) => {
									const reactions = h('div', 'og-ws-reactions');
									for (const reaction of comment.reactions ?? [])
										reactions.append(
											h(
												'span',
												`og-ws-reaction${reaction.mine ? ' og-ws-mine' : ''}`,
												null,
												`${reaction.emoji} ${reaction.count}`
											)
										);
									return h(
										'article',
										'og-ws-comment',
										null,
										this.personBadge(comment.author),
										h(
											'div',
											'og-ws-comment-main',
											null,
											h(
												'div',
												'og-ws-comment-head',
												null,
												h('strong', null, null, comment.author.name),
												h('span', 'og-ws-hint', null, timeAgo(comment.createdAt))
											),
											h('p', 'og-ws-comment-body', null, comment.body),
											reactions.childElementCount ? reactions : null
										)
									);
								})
							: [h('div', 'og-ws-hint', null, 'No comments yet.')])
					);
				}
			);
		if (collaboration.addComment) panel.append(composer);
		panel.append(list);
		draw();
	}

	private activity(panel: HTMLElement, id: string): void {
		const host = this.host;
		const local = host.activityFor(id);
		const remote = host.options.collaboration?.listActivity;
		const draw = (entries: readonly RecordActivityEntry[]) => {
			const merged = [...local, ...entries].sort((a, b) => b.at - a.at);
			if (!merged.length) {
				panel.replaceChildren(h('div', 'og-ws-hint', null, 'No changes yet. Edits made here are recorded as they happen.'));
				return;
			}
			const api = host.engine.getApiRef();
			const format = (field: string | undefined, value: unknown) => {
				if (value == null || value === '') return 'empty';
				const col = field ? api.getColumnDef(field) : undefined;
				return col?.valueFormatter
					? col.valueFormatter({ value, rowData: null as never, colDef: col, rowId: id })
					: typeof value === 'object'
						? JSON.stringify(value)
						: String(value);
			};
			panel.replaceChildren(
				h(
					'ol',
					'og-ws-timeline',
					null,
					...merged.map((entry) => {
						const what =
							entry.kind === 'edit'
								? h(
										'span',
										null,
										null,
										'changed ',
										h('strong', null, null, api.getColumnDef(entry.field ?? '')?.header ?? entry.field ?? 'a field'),
										' from ',
										h('span', 'og-ws-old', null, format(entry.field, entry.from)),
										' to ',
										h('span', 'og-ws-new', null, format(entry.field, entry.to))
									)
								: h('span', null, null, entry.text ?? entry.kind);
						return h(
							'li',
							'og-ws-timeline-item',
							null,
							this.personBadge(entry.actor ?? { name: 'You' }),
							h(
								'div',
								null,
								null,
								h('strong', null, null, entry.actor?.name ?? 'You'),
								' ',
								what,
								h('div', 'og-ws-hint', null, timeAgo(entry.at))
							)
						);
					})
				)
			);
		};
		if (remote) void this.load<RecordActivityEntry>(panel, () => remote(id), draw);
		else draw([]);
	}

	private files(panel: HTMLElement, id: string): void {
		void this.load<RecordFile>(
			panel,
			() => this.host.options.collaboration!.listFiles!(id),
			(files) => {
				panel.replaceChildren(
					...(files.length
						? files.map((file) =>
								h(
									'a',
									'og-ws-file',
									{ href: file.url, target: '_blank', rel: 'noopener' },
									icon('paperclip'),
									h('span', 'og-ws-list-label', null, file.name),
									file.size ? h('span', 'og-ws-hint', null, `${Math.max(1, Math.round(file.size / 1024))} KB`) : null
								)
							)
						: [h('div', 'og-ws-hint', null, 'No files.')])
				);
			}
		);
	}

	private links(panel: HTMLElement, id: string): void {
		void this.load<RecordLink>(
			panel,
			() => this.host.options.collaboration!.listLinks!(id),
			(links) => {
				panel.replaceChildren(
					...(links.length
						? links.map((link) => {
								const el = h(
									'button',
									'og-ws-file',
									{ type: 'button' },
									icon('link'),
									h('span', 'og-ws-list-label', null, link.label)
								);
								if (link.status) el.append(h('span', 'og-ws-hint', null, link.status));
								el.addEventListener('click', () => {
									if (link.recordId) this.host.focus(link.recordId, { inspect: true });
									else if (link.url) window.open(link.url, '_blank', 'noopener');
								});
								return el;
							})
						: [h('div', 'og-ws-hint', null, 'No links.')])
				);
			}
		);
	}

	destroy(): void {
		this.teardown();
		this.element.remove();
	}
}
