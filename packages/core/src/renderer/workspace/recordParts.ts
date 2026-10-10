import type { PersonOption } from '../../cells/renderers.js';
import { fromDay, today } from '../../records/days.js';
import type { RecordReader, RecordRow } from '../../records/recordModel.js';
import { icon } from './icons.js';
import { avatar, counter, formatDay, h, hue, pill, progressBar } from './ui.js';
import type { WorkspaceViewContext } from './viewTypes.js';

/**
 * The parts every projection draws a record with — identity, status, people, dates, progress,
 * counts, presence — so a record reads the same on a card, a schedule row and the inspector.
 */
export function optionPill<T>(
	reader: RecordReader<T>,
	row: RecordRow<T>,
	field: string | undefined,
	variant: 'soft' | 'dot' | 'outline' = 'soft'
): HTMLElement | null {
	if (!field) return null;
	const value = reader.value(row, field);
	if (value == null || value === '') return null;
	const text = String(Array.isArray(value) ? value[0] : value);
	const el = pill(reader.option(field, text), text, variant);
	// Pressing it edits the field in place (the workspace opens its options).
	el.dataset.quickField = field;
	return el;
}

export function labelPills<T>(reader: RecordReader<T>, row: RecordRow<T>, field: string | undefined, max = 2): HTMLElement | null {
	if (!field) return null;
	const values = reader.values(row, field);
	if (!values.length) return null;
	const wrap = h('span', 'og-ws-pills');
	for (const value of values.slice(0, max)) wrap.append(pill(reader.option(field, value), value, 'outline'));
	if (values.length > max) wrap.append(h('span', 'og-ws-more', null, `+${values.length - max}`));
	return wrap;
}

/** Avatar and name (or stacked avatars for several people). */
export function personChip<T>(reader: RecordReader<T>, row: RecordRow<T>, field: string | undefined, withName = true): HTMLElement | null {
	if (!field) return null;
	const values = reader.values(row, field);
	if (!values.length) return null;
	const people = values.map((value) => ({ value, person: reader.option(field, value) as PersonOption | undefined }));
	const chip = h('span', 'og-ws-person', { 'data-quick-field': field });
	if (people.length === 1) {
		chip.append(avatar(people[0].person, people[0].value));
		if (withName) chip.append(h('span', 'og-ws-person-name', null, people[0].person?.label ?? people[0].value));
		return chip;
	}
	for (const { person, value } of people.slice(0, 3)) chip.append(avatar(person, value));
	if (people.length > 3) chip.append(h('span', 'og-ws-avatar og-ws-avatar-sm og-ws-avatar-more', null, `+${people.length - 3}`));
	chip.classList.add('og-ws-person-stack');
	return chip;
}

/** The due day with a calendar icon; overdue unfinished work is flagged. */
export function dueChip<T>(reader: RecordReader<T>, row: RecordRow<T>): HTMLElement | null {
	const due = reader.due(row);
	if (due == null) return null;
	const overdue = due < today() && !reader.isDone(row);
	const chip = h('span', `og-ws-due${overdue ? ' og-ws-overdue' : ''}`, { title: overdue ? 'Overdue' : 'Due' });
	chip.append(icon('calendar', 14), formatDay(fromDay(due)));
	return chip;
}

export function progressLine<T>(reader: RecordReader<T>, row: RecordRow<T>): HTMLElement | null {
	if (!reader.roles.progress) return null;
	const value = reader.isDone(row) ? Math.max(reader.progress(row) ?? 1, 1) : reader.progress(row);
	return progressBar(value, { label: true });
}

export function countsLine<T>(context: WorkspaceViewContext<T>, row: RecordRow<T>, reader: RecordReader<T>): HTMLElement | null {
	const counts = context.counts(row.id) ?? {};
	const dependencies = reader.dependencies(row).length;
	const parts = [
		counter('paperclip', counts.files, 'files'),
		counter('comment', counts.comments, 'comments'),
		counter('link', counts.links ?? (dependencies || undefined), counts.links ? 'links' : 'dependencies'),
	].filter((part): part is HTMLElement => !!part);
	if (!parts.length) return null;
	return h('span', 'og-ws-counts', null, ...parts);
}

/** Small coloured rings for teammates whose cursor is on this record. */
export function presenceDots<T>(context: WorkspaceViewContext<T>, id: string): HTMLElement | null {
	const peers = context.presence(id);
	if (!peers.length) return null;
	const wrap = h('span', 'og-ws-presence', { title: peers.map((peer) => peer.name).join(', ') });
	for (const peer of peers.slice(0, 3)) {
		const dot = h('span', `og-ws-presence-peer${peer.editing ? ' og-ws-editing' : ''}`, null, initials(peer.name));
		dot.style.setProperty('--og-ws-hue', peer.color);
		wrap.append(dot);
	}
	return wrap;
}

export function blockedBadge(): HTMLElement {
	const badge = h('span', 'og-ws-blocked', { title: 'Blocked: waiting on unfinished work' });
	badge.append(icon('blocked', 13), 'Blocked');
	return badge;
}

export function initials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]!.toUpperCase())
		.join('');
}

/** The record's accent: the view's colour function, else its colour field's option (status by default). */
export function recordAccent<T>(
	reader: RecordReader<T>,
	row: RecordRow<T>,
	color?: (data: T) => string | undefined,
	colorField?: string | null
): string | undefined {
	const custom = color?.(row.data);
	if (custom) return hue(custom);
	const field = colorField === undefined ? reader.roles.status : colorField;
	if (!field) return undefined;
	const value = reader.values(row, field)[0];
	return value ? hue(reader.option(field, value)?.color, value) : undefined;
}
