import { fromDay, today } from '../../../records/days.js';
import { aggregateRecords, groupRecords, type RecordGroup } from '../../../records/recordGroups.js';
import type { RecordReader, RecordRow } from '../../../records/recordModel.js';
import type { GalleryViewConfig } from '../../../views.js';
import { defaultGridScheduler } from '../../gridScheduler.js';
import { FieldValue } from '../fieldValue.js';
import { icon } from '../icons.js';
import { blockedBadge, countsLine, labelPills, optionPill, personChip, presenceDots } from '../recordParts.js';
import { button, formatDay, formatNumber, h, hue, pill, progressBar } from '../ui.js';
import type {
	ViewSettingsSection,
	WorkspaceCommand,
	WorkspaceMetric,
	WorkspaceView,
	WorkspaceViewContext,
	WorkspaceViewModule,
} from '../viewTypes.js';
import { addViewStyles } from '../workspaceStyles.js';

type Layout = NonNullable<GalleryViewConfig['layout']>;
const GAP = 14;
const PAD = 16;
const SECTION_H = 46;
const OVERSCAN = 500;
const MIN_WIDTH: Record<Layout, number> = { small: 210, medium: 268, large: 340, compact: 360 };
const COVER_H: Record<Layout, number> = { small: 84, medium: 112, large: 170, compact: 0 };
// Body heights fit their content (title, pills, people, progress, footer) without squeezing it.
const BODY_H: Record<Layout, number> = { small: 150, medium: 162, large: 176, compact: 136 };
const LAYOUT_LABEL: Record<Layout, string> = { small: 'Small', medium: 'Medium', large: 'Large', compact: 'Compact rows' };

interface Slot {
	id: string;
	row: RecordRow<unknown> | null;
	section: string;
	x: number;
	y: number;
	/** The quick-add card of a section. */
	add?: boolean;
}
interface Section {
	group: RecordGroup<unknown>;
	y: number;
	collapsed: boolean;
}

/** Deterministic gradient for records without an image (generated covers). */
function generatedCover(seed: string, colour: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	const angle = Math.abs(hash) % 360;
	const shift = 30 + (Math.abs(hash >> 3) % 80);
	return `linear-gradient(${angle}deg, color-mix(in srgb, ${colour} 85%, #000) 0%, color-mix(in srgb, ${colour} 55%, hsl(${shift} 70% 50%)) 60%, color-mix(in srgb, ${colour} 40%, #fff) 130%)`;
}

function create<T>(host: HTMLElement, context: WorkspaceViewContext<T>, initial: GalleryViewConfig<T>): WorkspaceView {
	addViewStyles(host.ownerDocument, 'gallery', GALLERY_STYLES);
	let config = initial;
	const motion = context.motion;
	let layout: Layout = config.layout ?? 'medium';
	let painted = false;
	const scroller = h('div', 'og-ws-gallery', { role: 'grid', 'aria-label': 'Gallery' });
	const canvas = h('div', 'og-ws-gallery-canvas');
	const empty = h('div', 'og-ws-empty', { hidden: true });
	scroller.append(canvas);
	host.append(scroller, empty);
	const collapsedSections = new Set<string>(context.memory<string[]>('collapsed', []));
	const cards = new Map<string, { element: HTMLElement; fields: FieldValue<T>[]; version: unknown }>();
	const headers = new Map<string, HTMLElement>();
	let reader: RecordReader<T> = context.reader();
	let slots: Slot[] = [];
	let sections: Section[] = [];
	let slotById = new Map<string, Slot>();
	let order: string[] = [];
	let columns = 1;
	let cardWidth = 260;
	let projectedWidth = -1;
	let frame = 0;
	let groupField: string | null = null;

	const coverMode = () => config.cover ?? (reader.roles.cover ? 'image' : 'generated');
	const cardHeight = () =>
		layout === 'compact' ? BODY_H.compact : (coverMode() === 'none' ? 0 : COVER_H[layout]) + BODY_H[layout] + fieldsFor().length * 26;
	const fieldsFor = () =>
		(config.fields ?? [])
			.map((field) => reader.column(field))
			.filter((col): col is NonNullable<typeof col> => !!col && !Object.values(reader.roles).includes(col.field))
			.slice(0, layout === 'small' ? 1 : 3);

	const money = (value: number | null) => {
		if (value == null) return '';
		const col = reader.column(reader.roles.value);
		const currency = col?.schema?.number?.currency ?? (col?.schema?.kind === 'currency' ? 'USD' : undefined);
		return formatNumber(value, { currency, compact: value >= 1e6 });
	};

	const project = () => {
		reader = context.reader();
		groupField = config.groupBy === undefined ? (reader.roles.status ?? null) : config.groupBy;
		const width = scroller.clientWidth || host.clientWidth || 1000;
		const min = config.cardWidth ?? MIN_WIDTH[layout];
		columns = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (min + GAP)));
		cardWidth = Math.floor((width - PAD * 2 - GAP * (columns - 1)) / columns);
		projectedWidth = width;
		const rows = context.rows() as RecordRow<T>[];
		const groups: RecordGroup<T>[] = groupField
			? groupRecords(rows, reader, groupField)
			: [{ key: '*', value: null, label: '', rows: [...rows] }];
		const pitch = cardHeight() + GAP;
		slots = [];
		sections = [];
		order = [];
		let y = PAD;
		for (const group of groups) {
			const collapsed = collapsedSections.has(group.key);
			if (groupField) {
				sections.push({ group: group as RecordGroup<unknown>, y, collapsed });
				y += SECTION_H + 8;
			}
			if (collapsed) {
				y += 6;
				continue;
			}
			const items: Slot[] = [];
			if (context.create && groupField) items.push({ id: `+${group.key}`, row: null, section: group.key, x: 0, y: 0, add: true });
			for (const row of group.rows) items.push({ id: row.id, row: row as RecordRow<unknown>, section: group.key, x: 0, y: 0 });
			items.forEach((slot, i) => {
				slot.x = PAD + (i % columns) * (cardWidth + GAP);
				slot.y = y + Math.floor(i / columns) * pitch;
				slots.push(slot);
				if (slot.row) order.push(slot.id);
			});
			y += Math.ceil(items.length / columns) * pitch + (groupField ? 10 : 0);
		}
		slotById = new Map(slots.map((slot) => [slot.id, slot]));
		canvas.style.height = `${y + PAD}px`;
	};

	// ─── Cards ───────────────────────────────────────────────────────────

	const fill = (element: HTMLElement, row: RecordRow<T>, fields: FieldValue<T>[]) => {
		for (const field of fields) field.destroy();
		fields.length = 0;
		const roles = reader.roles;
		const accent = context.accent(row) ?? 'var(--og-focus-ring)';
		element.style.setProperty('--og-ws-accent', accent);
		element.dataset.layout = layout;
		const blocked = reader.isBlocked(row, (id) => context.lookup(id));
		element.toggleAttribute('data-blocked', blocked);
		element.setAttribute('aria-label', reader.title(row));
		const select = h('input', 'og-ws-card-check', { type: 'checkbox', 'aria-label': `Select ${reader.title(row)}`, 'data-no-select': '' });
		select.checked = context.selected().has(row.id);
		select.addEventListener('click', (event) => {
			event.stopPropagation();
			context.select(row.id, event.shiftKey ? 'range' : 'toggle', order);
		});
		const more = button({ icon: 'more', title: 'Actions', className: 'og-ws-card-more' }, (event) => {
			event.stopPropagation();
			context.focus(row.id);
			context.menu(more, [
				{ label: 'Open', icon: 'inspector', run: () => context.inspect(row.id) },
				{ label: 'Show in table', icon: 'table', run: () => context.openInTable(row.id) },
			]);
		});
		const mode = coverMode();
		let cover: HTMLElement | null = null;
		if (mode !== 'none' || layout === 'compact') {
			cover = h('div', 'og-ws-gallery-cover');
			const src = mode === 'image' ? reader.cover(row) : null;
			if (src) {
				const img = h('img', null, { src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
				if (config.coverFit === 'contain') img.style.objectFit = 'contain';
				cover.append(img);
			} else cover.style.backgroundImage = generatedCover(row.id, accent);
			cover.append(select, h('span', 'og-ws-gallery-key', null, reader.key(row)), more);
		}
		const title = h('div', 'og-ws-card-title', { title: reader.title(row) }, reader.title(row));
		const pills = h(
			'div',
			'og-ws-card-pills',
			null,
			blocked ? blockedBadge() : optionPill(reader, row, roles.status),
			optionPill(reader, row, roles.priority, 'dot')
		);
		const due = reader.due(row);
		let dueEl: HTMLElement | null = null;
		if (due != null) {
			const left = due - today();
			const done = reader.isDone(row);
			dueEl = h(
				'span',
				`og-ws-due og-ws-gallery-due${!done && left < 0 ? ' og-ws-overdue' : ''}`,
				{ title: formatDay(fromDay(due), true) },
				icon('calendar', 14),
				h(
					'span',
					null,
					null,
					h('span', 'og-ws-gallery-left', null, done ? 'Done' : left < 0 ? `${-left}d late` : left === 0 ? 'Today' : `${left}d left`),
					h('span', null, null, formatDay(fromDay(due)))
				)
			);
		}
		const people = h('div', 'og-ws-card-meta', null, personChip(reader, row, roles.owner), h('span', 'og-ws-spacer'), dueEl);
		const progress = reader.roles.progress
			? h('div', 'og-ws-card-progress', null, progressBar(reader.isDone(row) ? 1 : reader.progress(row), { label: true }))
			: null;
		const value = roles.value ? reader.text(row, roles.value) : '';
		const foot = h(
			'div',
			'og-ws-card-foot',
			null,
			value ? h('span', 'og-ws-counter og-ws-gallery-value', null, icon('coins', 14), value) : null,
			countsLine(context, row, reader),
			h('span', 'og-ws-spacer'),
			presenceDots(context, row.id)
		);
		const body = h(
			'div',
			'og-ws-gallery-body',
			null,
			cover
				? null
				: h('div', 'og-ws-gallery-head', null, select, h('span', 'og-ws-key', null, reader.key(row)), h('span', 'og-ws-spacer'), more),
			title,
			pills
		);
		if (layout !== 'small') body.append(people);
		else body.append(h('div', 'og-ws-card-meta', null, personChip(reader, row, roles.owner, false), h('span', 'og-ws-spacer'), dueEl));
		if (progress && layout !== 'compact') body.append(progress);
		if (layout === 'large') body.append(labelPills(reader, row, roles.labels, 3) ?? '');
		for (const col of fieldsFor()) {
			const field = new FieldValue(col, context.api);
			field.show(row);
			fields.push(field);
			body.append(h('div', 'og-ws-card-field', null, h('span', 'og-ws-hint', null, col.header ?? col.field), field.element));
		}
		body.append(foot);
		element.replaceChildren(...(cover ? [cover] : []), body);
	};

	const addCard = (section: string): HTMLElement => {
		const group = sections.find((candidate) => candidate.group.key === section)?.group;
		const element = h(
			'button',
			'og-ws-gallery-add',
			{ type: 'button', 'data-add': section },
			h('span', 'og-ws-gallery-add-icon', null, icon('plus', 20)),
			h('strong', null, null, 'New record'),
			h('span', 'og-ws-hint', null, group ? `in ${group.label}` : 'Create a new record')
		);
		element.addEventListener('click', () => {
			const values: Record<string, unknown> = {};
			if (groupField && group) values[groupField] = group.value;
			void context.create?.(values);
		});
		return element;
	};

	const sectionHeader = (section: Section): HTMLElement => {
		const group = section.group as RecordGroup<T>;
		const el = h('div', 'og-ws-gallery-section', { 'data-section': group.key, role: 'rowheader' });
		const toggle = h(
			'button',
			'og-ws-gallery-toggle',
			{
				type: 'button',
				'aria-expanded': String(!section.collapsed),
				'aria-label': `${section.collapsed ? 'Expand' : 'Collapse'} ${group.label}`,
			},
			icon(section.collapsed ? 'chevronRight' : 'chevronDown', 14)
		);
		toggle.addEventListener('click', () => toggleSection(group.key));
		const option = groupField ? reader.option(groupField, group.key) : undefined;
		const label =
			group.key === ''
				? h('strong', 'og-ws-hint', null, group.label)
				: pill(option ?? { value: group.key, label: group.label, color: group.color as never }, group.key);
		el.append(toggle, label, h('span', 'og-ws-hint', null, `${group.rows.length} ${group.rows.length === 1 ? 'card' : 'cards'}`));
		const aggregate = config.aggregate;
		const total = aggregate
			? aggregateRecords(group.rows, reader, aggregate.fn, aggregate.field)
			: reader.roles.value
				? aggregateRecords(group.rows, reader, 'sum', reader.roles.value)
				: null;
		if (total != null)
			el.append(
				h('span', 'og-ws-gallery-total', null, aggregate && aggregate.fn !== 'sum' ? formatNumber(total, { decimals: 1 }) : money(total))
			);
		const progress = aggregateRecords(group.rows, reader, 'progress');
		if (progress != null) {
			const meter = progressBar(progress);
			meter.classList.add('og-ws-gallery-meter');
			meter.style.setProperty('--og-ws-hue', hue(group.color, group.key || 'none'));
			el.append(meter, h('span', 'og-ws-hint', null, `${Math.round(progress * 100)}% avg`));
		}
		el.append(h('span', 'og-ws-spacer'));
		const select = button({ icon: 'check', title: `Select all in ${group.label}` }, () =>
			context.api.selectRows(
				group.rows.map((row) => row.id),
				{ mode: 'replace' }
			)
		);
		el.append(select);
		return el;
	};

	const toggleSection = (key: string) => {
		if (collapsedSections.has(key)) collapsedSections.delete(key);
		else collapsedSections.add(key);
		context.remember('collapsed', [...collapsedSections]);
		render(true);
	};

	/**
	 * Draws the cards in view. `glide` (data, settings, collapse or a reflow — not a scroll): cards move
	 * to their new slots, new ones settle in, ones that left the gallery fade out.
	 */
	const paint = (glide = false) => {
		frame = 0;
		// The width changed (a resize, the inspector opening): reflow, gliding cards to their new columns.
		if ((scroller.clientWidth || 0) !== projectedWidth && scroller.clientWidth) {
			render(true);
			return;
		}
		let entering = 0;
		const top = scroller.scrollTop - OVERSCAN;
		const bottom = scroller.scrollTop + (scroller.clientHeight || 800) + OVERSCAN;
		const height = cardHeight();
		const selected = context.selected();
		const focused = context.focused();
		const wanted = new Set<string>();
		// Slots are in y order: binary search the first in view.
		let lo = 0;
		let hi = slots.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (slots[mid].y + height < top) lo = mid + 1;
			else hi = mid;
		}
		for (let i = lo; i < slots.length && slots[i].y <= bottom; i++) {
			const slot = slots[i];
			wanted.add(slot.id);
			let card = cards.get(slot.id);
			const fresh = !card;
			if (!card) {
				if (slot.add) card = { element: addCard(slot.section), fields: [], version: null };
				else {
					const element = h('article', 'og-ws-card og-ws-gallery-card', { 'data-record-id': slot.id, role: 'gridcell', tabindex: -1 });
					const fields: FieldValue<T>[] = [];
					fill(element, slot.row as RecordRow<T>, fields);
					card = { element, fields, version: slot.row!.data };
				}
				cards.set(slot.id, card);
				canvas.append(card.element);
			} else if (slot.row && (card.version !== slot.row.data || card.element.dataset.stale)) {
				fill(card.element, slot.row as RecordRow<T>, card.fields);
				card.version = slot.row.data;
				delete card.element.dataset.stale;
			}
			const el = card.element;
			el.style.width = `${cardWidth}px`;
			el.style.height = `${height}px`;
			motion.place(el, slot.x, slot.y, glide);
			if (fresh && glide && painted) motion.enter(el, Math.min(entering++, 12) * 18);
			if (slot.row) {
				el.toggleAttribute('data-selected', selected.has(slot.id));
				el.toggleAttribute('data-focused', focused === slot.id);
				el.tabIndex = focused === slot.id ? 0 : -1;
				const check = el.querySelector<HTMLInputElement>('.og-ws-card-check');
				if (check) check.checked = selected.has(slot.id);
			}
		}
		for (const [id, card] of cards)
			if (!wanted.has(id) && !card.element.contains(document.activeElement)) {
				card.fields.forEach((field) => field.destroy());
				cards.delete(id);
				// Gone from the gallery (filtered, deleted, collapsed away): fade. Scrolled away: just go.
				if (glide && !slotById.has(id)) motion.leave(card.element);
				else {
					motion.forget(card.element);
					card.element.remove();
				}
			}
		const wantedSections = new Set<string>();
		for (const section of sections) {
			if (section.y > bottom || section.y + SECTION_H < top) continue;
			wantedSections.add(section.group.key);
			let el = headers.get(section.group.key);
			if (!el || el.dataset.stale) {
				const next = sectionHeader(section);
				if (el) {
					el.replaceChildren(...next.childNodes);
					delete el.dataset.stale;
				} else {
					el = next;
					headers.set(section.group.key, el);
					canvas.append(el);
				}
			}
			motion.place(el, 0, section.y, glide);
		}
		for (const [key, el] of headers)
			if (!wantedSections.has(key)) {
				headers.delete(key);
				motion.forget(el);
				el.remove();
			}
		painted = true;
	};

	const render = (glide = false) => {
		project();
		const nothing = order.length === 0;
		empty.hidden = !nothing;
		if (nothing) {
			const clear = button({ icon: 'filter', label: 'Clear filters' }, () => {
				context.api.setFilterModel(null);
				context.api.setQuickFilter('');
			});
			empty.replaceChildren(
				h('div', 'og-ws-empty-title', null, 'No records'),
				h('p', 'og-ws-hint', null, config.emptyText ?? 'Nothing matches the current filters or search.'),
				clear
			);
		}
		for (const card of cards.values()) card.element.dataset.stale = '1';
		for (const el of headers.values()) el.dataset.stale = '1';
		paint(glide && painted);
	};

	scroller.addEventListener(
		'scroll',
		() => {
			context.remember('scroll', scroller.scrollTop);
			if (!frame) frame = defaultGridScheduler.raf(() => paint(false));
		},
		{ passive: true }
	);

	// Layout and cover are the view's configuration: saved with it, changed in place.
	const setLayout = (next: Layout) => context.updateView({ layout: next });
	const setCover = (next: NonNullable<GalleryViewConfig['cover']>) => context.updateView({ cover: next });

	const settings = (): ViewSettingsSection[] => {
		const groupFields = context
			.columns()
			.filter((col) => col.schema && ['select', 'person', 'checkbox', 'tags', 'multiSelect'].includes(col.schema.kind));
		const numberFields = context
			.columns()
			.filter((col) => col.schema && ['number', 'currency', 'percent', 'progress', 'rating'].includes(col.schema.kind));
		const aggregate = config.aggregate
			? `${config.aggregate.fn}:${config.aggregate.field ?? ''}`
			: reader.roles.value
				? `sum:${reader.roles.value}`
				: 'count:';
		return [
			{
				title: 'Cards',
				settings: [
					{
						kind: 'segmented',
						id: 'layout',
						label: 'Size',
						value: layout,
						options: (['small', 'medium', 'large', 'compact'] as Layout[]).map((value) => ({
							value,
							label: value === 'compact' ? 'Rows' : LAYOUT_LABEL[value],
						})),
						onChange: (value) => setLayout(value as Layout),
					},
					{
						kind: 'segmented',
						id: 'cover',
						label: 'Cover',
						value: coverMode(),
						options: [
							...(reader.roles.cover ? [{ value: 'image', label: 'Image' }] : []),
							{ value: 'generated', label: 'Generated' },
							{ value: 'none', label: 'None' },
						],
						onChange: (value) => setCover(value as 'image'),
					},
					{
						kind: 'toggle',
						id: 'coverFit',
						label: 'Show the whole image',
						hint: 'Fit covers inside the card instead of filling it.',
						value: config.coverFit === 'contain',
						onChange: (value) => context.updateView({ coverFit: value ? 'contain' : 'cover' }),
					},
					{
						kind: 'fields',
						id: 'fields',
						label: 'Extra fields',
						hint: 'Up to three on medium and large cards, one on small.',
						value: config.fields ?? [],
						options: context
							.columns()
							.filter((col) => !Object.values(reader.roles).includes(col.field))
							.map((col) => ({ value: col.field, label: col.header ?? col.field })),
						onChange: (value) => context.updateView({ fields: value }),
					},
				],
			},
			{
				title: 'Sections',
				settings: [
					{
						kind: 'select',
						id: 'groupBy',
						label: 'Group by',
						value: groupField ?? '',
						options: [
							{ value: '', label: 'No sections' },
							...groupFields.map((col) => ({ value: col.field, label: col.header ?? col.field })),
						],
						onChange: (value) => context.updateView({ groupBy: value || null }),
					},
					{
						kind: 'select',
						id: 'aggregate',
						label: 'Section total',
						value: aggregate,
						options: [
							{ value: 'count:', label: 'Card count' },
							...numberFields.flatMap((col) => [
								{ value: `sum:${col.field}`, label: `Sum of ${col.header ?? col.field}` },
								{ value: `avg:${col.field}`, label: `Average ${col.header ?? col.field}` },
							]),
						],
						onChange: (value) => {
							const [fn, field] = value.split(':');
							context.updateView({ aggregate: fn === 'count' ? { fn: 'count' } : { fn: fn as 'sum', field } });
						},
					},
				],
			},
		];
	};

	let layoutButton: HTMLButtonElement | null = null;
	let coverButton: HTMLButtonElement | null = null;
	const refreshTools = () => {
		if (layoutButton) layoutButton.querySelector('.og-ws-btn-label')!.textContent = LAYOUT_LABEL[layout];
		if (coverButton) coverButton.querySelector('.og-ws-btn-label')!.textContent = `Cover: ${coverMode()}`;
	};
	const toolbar = () => {
		layoutButton = button({ icon: 'gallery', label: LAYOUT_LABEL[layout], title: 'Card size' }, () =>
			context.menu(
				layoutButton!,
				(['small', 'medium', 'large', 'compact'] as Layout[]).map((candidate) => ({
					label: LAYOUT_LABEL[candidate],
					checked: candidate === layout,
					run: () => setLayout(candidate),
				}))
			)
		);
		coverButton = button({ icon: 'image', label: `Cover: ${coverMode()}`, title: 'Card cover' }, () =>
			context.menu(coverButton!, [
				{ label: 'Image field', checked: coverMode() === 'image', disabled: !reader.roles.cover, run: () => setCover('image') },
				{ label: 'Generated preview', checked: coverMode() === 'generated', run: () => setCover('generated') },
				{ label: 'No cover', checked: coverMode() === 'none', run: () => setCover('none') },
			])
		);
		return h('div', 'og-ws-group', null, layoutButton, coverButton);
	};

	const summary = (): WorkspaceMetric[] => {
		const rows = context.rows();
		if (!rows.length) return [];
		const total = reader.roles.value ? aggregateRecords(rows, reader, 'sum', reader.roles.value) : null;
		const progress = aggregateRecords(rows, reader, 'progress');
		const out: WorkspaceMetric[] = [];
		if (total != null) out.push({ label: `Total ${reader.column(reader.roles.value)?.header?.toLowerCase() ?? 'value'}`, value: money(total) });
		if (progress != null) out.push({ label: 'Average progress', value: `${Math.round(progress * 100)}%`, meter: progress });
		const overdue = rows.filter((row) => !reader.isDone(row) && (reader.due(row) ?? Infinity) < today()).length;
		out.push({ label: 'Overdue', value: String(overdue), tone: overdue ? '#ef4444' : '#22c55e' });
		return out;
	};

	const commands = (): WorkspaceCommand[] => [
		...(['small', 'medium', 'large', 'compact'] as Layout[]).map((candidate) => ({
			id: `gallery:layout:${candidate}`,
			label: `${LAYOUT_LABEL[candidate]} cards`,
			group: 'Gallery',
			icon: 'gallery' as const,
			run: () => setLayout(candidate),
		})),
		{
			id: 'gallery:collapse',
			label: 'Collapse all sections',
			group: 'Gallery',
			icon: 'collapse',
			enabled: () => sections.length > 0,
			run: () => {
				sections.forEach((section) => collapsedSections.add(section.group.key));
				context.remember('collapsed', [...collapsedSections]);
				render(true);
			},
		},
		{
			id: 'gallery:expand',
			label: 'Expand all sections',
			group: 'Gallery',
			icon: 'expand',
			enabled: () => collapsedSections.size > 0,
			run: () => {
				collapsedSections.clear();
				context.remember('collapsed', []);
				render(true);
			},
		},
	];

	let restored = false;
	return {
		render() {
			render(restored);
			if (!restored) {
				restored = true;
				scroller.scrollTop = context.memory('scroll', 0);
				paint(false);
			}
		},
		update(next) {
			config = next as GalleryViewConfig<T>;
			layout = config.layout ?? 'medium';
			// Every card redraws in its new shape and glides to its new slot.
			for (const card of cards.values()) card.element.dataset.stale = '1';
			render(true);
			refreshTools();
		},
		settings,
		order: () => order,
		reveal(id) {
			let slot = slotById.get(id);
			if (!slot) {
				const row = context.lookup(id);
				const key = row && groupField ? (reader.values(row, groupField)[0] ?? '') : '*';
				if (!collapsedSections.delete(key)) return null;
				context.remember('collapsed', [...collapsedSections]);
				render(true);
				slot = slotById.get(id);
				if (!slot) return null;
			}
			const height = cardHeight();
			if (slot.y < scroller.scrollTop + 8) scroller.scrollTop = slot.y - SECTION_H;
			else if (slot.y + height > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = slot.y + height - scroller.clientHeight + GAP;
			paint();
			return cards.get(id)?.element ?? null;
		},
		onKey(event, id) {
			// Up / down move a whole row of cards.
			if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
			const slot = slotById.get(id);
			if (!slot) return false;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			// The card straight above or below: same column, nearest row (order runs row by row).
			const column = order
				.map((candidate) => slotById.get(candidate)!)
				.filter((other) => other.x === slot.x && (step > 0 ? other.y > slot.y : other.y < slot.y));
			const target = (step > 0 ? column[0] : column[column.length - 1])?.id;
			if (!target) return true;
			if (event.shiftKey) context.select(target, 'range', order);
			context.focus(target);
			return true;
		},
		toolbar,
		summary,
		commands,
		destroy() {
			if (frame) defaultGridScheduler.cancelRaf(frame);
			for (const card of cards.values()) card.fields.forEach((field) => field.destroy());
			scroller.remove();
			empty.remove();
		},
	};
}

export const galleryView: WorkspaceViewModule<GalleryViewConfig<any>> = { kind: 'gallery', label: 'Gallery', icon: 'gallery', create };

const GALLERY_STYLES = `
.og-ws-gallery { flex: 1 1 auto; position: relative; overflow: auto; min-height: 0; overscroll-behavior: contain; }
.og-ws-gallery-canvas { position: relative; width: 100%; }
.og-ws-gallery-card { padding: 0; gap: 0; }
.og-ws-gallery-card::before { display: none; }
.og-ws-gallery-cover { position: relative; flex: none; height: var(--og-ws-cover, 112px); background-size: cover; background-position: center; overflow: hidden; border-bottom: 1px solid var(--og-ws-line); }
.og-ws-gallery-card[data-layout='small'] .og-ws-gallery-cover { --og-ws-cover: 84px; }
.og-ws-gallery-card[data-layout='large'] .og-ws-gallery-cover { --og-ws-cover: 170px; }
.og-ws-gallery-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.og-ws-gallery-cover::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgb(0 0 0 / .32), transparent 45%); pointer-events: none; }
.og-ws-gallery-key { position: absolute; top: 8px; right: 40px; z-index: 1; padding: 2px 7px; border-radius: 6px; background: rgb(0 0 0 / .5); color: #fff; font-size: 11px; font-variant-numeric: tabular-nums; backdrop-filter: blur(4px); }
.og-ws-card-more { position: absolute; top: 5px; right: 6px; z-index: 1; width: 28px; height: 26px; color: #fff; background: rgb(0 0 0 / .35); border-radius: 6px; }
.og-ws-gallery-body .og-ws-card-more { position: static; background: none; color: var(--og-ws-muted); }
.og-ws-card-more:hover:not(:disabled) { background: rgb(0 0 0 / .55); color: #fff; }
.og-ws-card-check { position: absolute; top: 9px; left: 9px; z-index: 1; width: 16px; height: 16px; margin: 0; accent-color: var(--og-focus-ring); opacity: 0; transition: opacity .12s ease; }
.og-ws-gallery-body .og-ws-card-check { position: static; }
.og-ws-gallery-card:hover .og-ws-card-check, .og-ws-gallery-card[data-selected] .og-ws-card-check, .og-ws-card-check:focus-visible { opacity: 1; }
.og-ws-gallery-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 11px 13px 11px; }
.og-ws-gallery-body > * { flex-shrink: 0; }
.og-ws-gallery-head { display: flex; align-items: center; gap: 8px; }
.og-ws-gallery-due { display: inline-flex; align-items: center; gap: 6px; }
.og-ws-gallery-due > span:last-child { display: flex; flex-direction: column; line-height: 1.15; font-size: 11.5px; }
.og-ws-gallery-left { color: var(--og-ws-text); font-weight: 550; }
.og-ws-overdue .og-ws-gallery-left { color: var(--og-ws-danger); }
.og-ws-gallery-value { color: var(--og-ws-text); }
.og-ws-gallery-card[data-layout='compact'] { flex-direction: row; }
.og-ws-gallery-card[data-layout='compact'] .og-ws-gallery-cover { width: 34%; height: auto; border-bottom: 0; border-right: 1px solid var(--og-ws-line); }
.og-ws-gallery-card[data-layout='compact'] .og-ws-gallery-body { gap: 6px; }
.og-ws-gallery-card[data-layout='small'] .og-ws-gallery-body { gap: 6px; padding: 9px 11px; }
.og-ws-gallery-add { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1.5px dashed var(--og-ws-line-strong); border-radius: var(--og-ws-radius); background: transparent; color: var(--og-ws-text); font: inherit; cursor: pointer; transition: border-color .12s ease, background-color .12s ease; }
.og-ws-gallery-add:hover { border-color: color-mix(in srgb, var(--og-focus-ring) 60%, transparent); background: color-mix(in srgb, var(--og-focus-ring) 5%, transparent); }
.og-ws-gallery-add-icon { width: 40px; height: 40px; border-radius: 99px; display: grid; place-items: center; border: 1px solid var(--og-ws-line-strong); color: var(--og-ws-muted); margin-bottom: 4px; }
.og-ws-gallery-section { position: absolute; left: 16px; right: 16px; top: 0; height: 46px; display: flex; align-items: center; gap: 12px; padding: 0 10px 0 6px; border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); background: var(--og-ws-surface); z-index: 1; }
.og-ws-gallery-toggle { width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: 6px; background: none; color: var(--og-ws-muted); cursor: pointer; }
.og-ws-gallery-toggle:hover { background: var(--og-ws-hover); color: var(--og-ws-text); }
.og-ws-gallery-section .og-ws-pill { height: 26px; font-size: 13px; padding: 0 10px; }
.og-ws-gallery-total { font-variant-numeric: tabular-nums; font-weight: 600; }
.og-ws-gallery-meter { width: 140px; }
.og-ws-gallery-meter .og-ws-progress-fill { background: var(--og-ws-hue); }
`;
