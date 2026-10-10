import type { GridCellWrite } from '../../api/GridApi.js';
import { parseDateRange, writeDateRange } from '../../cells/dateRange.js';
import { parseCellDate, toIsoDay } from '../../cells/format.js';
import type { WorkspaceIconName } from './icons.js';
import { icon } from './icons.js';
import { button, h, openMenu, openPanel, type MenuItem } from './ui.js';
import type { WorkspaceCommand } from './viewTypes.js';
import type { WorkspaceHost } from './workspaceHost.js';

/**
 * Bulk actions on the selection, floating over the view: move to a status, assign, set priority,
 * shift dates, duplicate, delete. Each action is one transaction (one undo step) through the same
 * validation and capabilities as a single edit.
 */
export class BulkBar<TRowData> {
	readonly element: HTMLElement;
	private readonly label: HTMLElement;
	private readonly actions: HTMLElement;

	constructor(private readonly host: WorkspaceHost<TRowData>) {
		this.label = h('span', 'og-ws-bulk-count');
		this.actions = h('div', 'og-ws-bulk-actions');
		const clear = button({ icon: 'close', title: 'Clear selection (Esc)' }, () => host.clearSelection());
		this.element = h(
			'div',
			'og-ws-bulk',
			{ role: 'toolbar', 'aria-label': 'Selection actions', hidden: true },
			icon('check'),
			this.label,
			this.actions,
			clear
		);
	}

	refresh(): void {
		const count = this.host.selected().size;
		const visible = count > 1 && !!this.host.getViewConfig();
		this.element.hidden = !visible;
		if (!visible) return;
		this.label.textContent = `${count} selected`;
		this.actions.replaceChildren(...this.buttons());
	}

	private ids(): string[] {
		return [...this.host.selected()];
	}

	private writeAll(field: string, value: unknown, label: string): void {
		const ids = this.ids();
		this.host.write(
			ids.map((rowId) => ({ rowId, colField: field, value })),
			`${label} · ${ids.length} ${ids.length === 1 ? 'record' : 'records'}`
		);
	}

	/** The option fields worth a bulk action, with their verbs. */
	private optionActions(): { field: string; label: string; icon: WorkspaceIconName; verb: string }[] {
		const roles = this.host.reader().roles;
		const out: { field: string; label: string; icon: WorkspaceIconName; verb: string }[] = [];
		if (roles.status) out.push({ field: roles.status, label: 'Move to', icon: 'kanban', verb: 'Moved to' });
		if (roles.owner) out.push({ field: roles.owner, label: 'Assign', icon: 'user', verb: 'Assigned' });
		if (roles.priority) out.push({ field: roles.priority, label: 'Priority', icon: 'flag', verb: 'Priority set' });
		if (roles.team) out.push({ field: roles.team, label: 'Team', icon: 'users', verb: 'Team set' });
		return out;
	}

	private menuFor(field: string, verb: string): (MenuItem | 'separator')[] {
		const reader = this.host.reader();
		const col = reader.column(field);
		const items: (MenuItem | 'separator')[] = reader.options(field).map((option) => ({
			label: option.label ?? option.value,
			color: option.color ?? option.value,
			run: () => this.writeAll(field, col?.schema?.multiple ? [option.value] : option.value, `${verb} ${option.label ?? option.value}`),
		}));
		items.push('separator', { label: 'Clear', icon: 'close', run: () => this.writeAll(field, null, `${col?.header ?? field} cleared`) });
		return items;
	}

	private buttons(): HTMLElement[] {
		const host = this.host;
		const out: HTMLElement[] = [];
		for (const action of this.optionActions()) {
			const el = button({ icon: action.icon, label: action.label }, () => openMenu(el, this.menuFor(action.field, action.verb), action.label));
			out.push(el);
		}
		const roles = host.reader().roles;
		const dateField = roles.schedule ?? roles.due;
		if (dateField) {
			const el = button({ icon: 'calendar', label: 'Dates' }, () => this.openDates(el, dateField));
			out.push(el);
		}
		out.push(button({ icon: 'copy', title: 'Duplicate' }, () => host.duplicate(this.ids())));
		const del = button({ icon: 'trash', title: 'Delete', className: 'og-ws-danger' }, () => host.deleteRecords(this.ids()));
		out.push(del);
		return out;
	}

	/** Shift every selected record's dates, or set one day. */
	private openDates(anchor: HTMLElement, field: string): void {
		const panel = h('div', 'og-ws-sort-panel', null, h('div', 'og-ws-panel-head', null, h('strong', null, null, 'Shift dates')));
		const shift = (days: number) => {
			const writes: GridCellWrite[] = [];
			for (const id of this.ids()) {
				const value = this.host.engine.getApiRef().getCellValue(id, field);
				const range = parseDateRange(value);
				if (range) {
					const move = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
					writes.push({ rowId: id, colField: field, value: writeDateRange(value, { start: move(range.start), end: move(range.end) }) });
					continue;
				}
				const date = parseCellDate(value);
				if (date)
					writes.push({
						rowId: id,
						colField: field,
						value: toIsoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)),
					});
			}
			popover.close();
			this.host.write(writes, `Shifted ${writes.length} by ${days > 0 ? '+' : ''}${days} days`);
		};
		const row = h('div', 'og-ws-chip-list');
		for (const days of [-7, -1, 1, 7, 14]) {
			const chip = h('button', 'og-ws-chip', { type: 'button' }, `${days > 0 ? '+' : ''}${days}d`);
			chip.addEventListener('click', () => shift(days));
			row.append(chip);
		}
		panel.append(row);
		const popover = openPanel(anchor, panel, 'Shift dates');
	}

	commands(): WorkspaceCommand[] {
		const ids = this.ids();
		if (ids.length < 1) return [];
		const reader = this.host.reader();
		const commands: WorkspaceCommand[] = [];
		for (const action of this.optionActions())
			for (const option of reader.options(action.field))
				commands.push({
					id: `bulk:${action.field}:${option.value}`,
					label: `${action.label} ${option.label ?? option.value}`,
					group: ids.length > 1 ? `Selection (${ids.length})` : 'Record',
					icon: action.icon,
					keywords: `${reader.column(action.field)?.header ?? ''} set change`,
					run: () => {
						const col = reader.column(action.field);
						this.writeAll(
							action.field,
							col?.schema?.multiple ? [option.value] : option.value,
							`${action.verb} ${option.label ?? option.value}`
						);
					},
				});
		commands.push({
			id: 'bulk:delete',
			label: ids.length > 1 ? `Delete ${ids.length} records` : 'Delete record',
			group: 'Record',
			icon: 'trash',
			run: () => this.host.deleteRecords(ids),
		});
		return commands;
	}

	destroy(): void {
		this.element.remove();
	}
}
