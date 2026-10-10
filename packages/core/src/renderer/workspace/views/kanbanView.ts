import { aggregateRecords } from '../../../records/recordGroups.js';
import { toDay } from '../../../records/days.js';
import { buildBoard, planBoardMove, SINGLE_LANE, type BoardModel, type BoardOptions } from '../../../records/board.js';
import type { RecordReader, RecordRow } from '../../../records/recordModel.js';
import type { KanbanViewConfig } from '../../../views.js';
import { defaultGridScheduler } from '../../gridScheduler.js';
import { FieldValue } from '../fieldValue.js';
import { icon } from '../icons.js';
import { blockedBadge, countsLine, dueChip, initials, labelPills, optionPill, personChip, presenceDots, progressLine } from '../recordParts.js';
import { button, formatNumber, h, hue } from '../ui.js';
import type {
	ViewSettingsSection,
	WorkspaceCommand,
	WorkspaceMetric,
	WorkspaceView,
	WorkspaceViewContext,
	WorkspaceViewModule,
} from '../viewTypes.js';

const GAP = 10;
const PAD = 12;
const HEAD_H = 76;
const LANE_HEAD_H = 46;
const COLLAPSED_W = 46;
const OVERSCAN = 400;
/** Cards entering together cascade, capped so a big change still settles quickly. */
const ENTER_STAGGER = 18;

interface CellBox {
	x: number;
	y: number;
	width: number;
	cards: RecordRow<unknown>[];
}
interface LaneBox {
	key: string;
	top: number;
	/** Top of the cards area. */
	body: number;
	height: number;
	collapsed: boolean;
	cells: Map<string, CellBox>;
}
interface Layout {
	columnX: Map<string, number>;
	columnW: Map<string, number>;
	lanes: LaneBox[];
	width: number;
	height: number;
	pitch: number;
	cardH: number;
}
interface Drag {
	ids: string[];
	pointerId: number;
	startX: number;
	startY: number;
	moved: boolean;
	ghost: HTMLElement | null;
	target: { column: string; lane: string; index: number } | null;
	rejected: string | null;
	lastX: number;
	lastY: number;
}

function create<T>(host: HTMLElement, context: WorkspaceViewContext<T>, initial: KanbanViewConfig<T>): WorkspaceView {
	let config = initial;
	const motion = context.motion;
	const scroller = h('div', 'og-ws-board', { role: 'grid', 'aria-label': 'Board' });
	const head = h('div', 'og-ws-board-head');
	const canvas = h('div', 'og-ws-board-canvas');
	const empty = h('div', 'og-ws-empty', { hidden: true });
	scroller.append(head, canvas);
	host.append(scroller, empty);
	const collapsedColumns = new Set<string>(context.memory('collapsedColumns', [...(config.collapsedColumns ?? [])]));
	const collapsedLanes = new Set<string>(context.memory<string[]>('collapsedLanes', []));
	const cards = new Map<string, { element: HTMLElement; fields: FieldValue<T>[]; version: unknown }>();
	// The frame — headers, lanes, cell backgrounds — is keyed too, so columns glide when they collapse, hide or move.
	const headers = new Map<string, HTMLElement>();
	const laneHeads = new Map<string, HTMLElement>();
	const cellElements = new Map<string, HTMLElement>();
	let reader: RecordReader<T> = context.reader();
	let board: BoardModel<T> = { columns: [], lanes: [], blocked: new Set(), placement: new Map() };
	let options: BoardOptions<T> = { columnField: '' };
	let layout: Layout = { columnX: new Map(), columnW: new Map(), lanes: [], width: 0, height: 0, pitch: 0, cardH: 0 };
	let order: string[] = [];
	let drag: Drag | null = null;
	let frame = 0;
	let autoScroll = 0;
	let painted = false;
	const indicator = h('div', 'og-ws-drop-indicator', { hidden: true });
	const dropHint = h('div', 'og-ws-drop-hint', { hidden: true });

	const columnWidth = () => Math.max(220, config.columnWidth ?? 280);

	const fieldsFor = () =>
		(config.fields ?? [])
			.map((field) => reader.column(field))
			.filter((col): col is NonNullable<typeof col> => !!col && !Object.values(reader.roles).includes(col.field));

	const project = () => {
		reader = context.reader();
		const columnField = config.columnField ?? reader.roles.status;
		if (!columnField) {
			board = { columns: [], lanes: [], blocked: new Set(), placement: new Map() };
			return;
		}
		const sorted = (context.api.getStateSnapshot().sortModel?.length ?? 0) > 0;
		options = {
			columnField,
			laneField: config.swimlaneField ?? undefined,
			columnOrder: config.columns,
			wipLimits: config.wipLimits,
			// A count needs no field; otherwise the configured field, else the value role.
			valueField: config.aggregate ? config.aggregate.field : reader.roles.value,
			valueAggregate: config.aggregate?.fn,
			useRank: !!reader.roles.rank && !sorted,
			lookup: (id) => context.lookup(id),
		};
		board = buildBoard(context.rows(), reader, options);
		// Hidden columns, and empty ones when asked, drop out of the board (their records stay in the grid).
		const hidden = new Set(config.hiddenColumns ?? []);
		if (hidden.size || config.hideEmptyColumns)
			board = {
				...board,
				columns: board.columns.filter((column) => !hidden.has(column.key) && !(config.hideEmptyColumns && column.rows.length === 0)),
			};
	};

	const measure = () => {
		const compact = config.density === 'compact';
		const extra = fieldsFor().length * 26;
		const cardH = (compact ? 96 : reader.roles.progress ? 172 : 146) + extra;
		const pitch = cardH + GAP;
		const columnX = new Map<string, number>();
		const columnW = new Map<string, number>();
		let x = PAD;
		for (const column of board.columns) {
			const width = collapsedColumns.has(column.key) ? COLLAPSED_W : columnWidth();
			columnX.set(column.key, x);
			columnW.set(column.key, width);
			x += width + GAP;
		}
		const lanes: LaneBox[] = [];
		let y = 0;
		const single = board.lanes.length === 1 && board.lanes[0].key === SINGLE_LANE;
		for (const lane of board.lanes) {
			const collapsed = collapsedLanes.has(lane.key);
			const top = y;
			const body = top + (single ? GAP : LANE_HEAD_H);
			let rows = 1;
			const cells = new Map<string, CellBox>();
			for (const column of board.columns) {
				const list = lane.cells.get(column.key) ?? [];
				cells.set(column.key, { x: columnX.get(column.key)!, y: body, width: columnW.get(column.key)!, cards: list as RecordRow<unknown>[] });
				if (!collapsedColumns.has(column.key)) rows = Math.max(rows, list.length);
			}
			const height = collapsed ? LANE_HEAD_H : body - top + rows * pitch + (context.create ? 36 : 0) + GAP;
			lanes.push({ key: lane.key, top, body, height, collapsed, cells });
			y += height + (single ? 0 : GAP);
		}
		layout = { columnX, columnW, lanes, width: x + PAD - GAP, height: y + PAD, pitch, cardH };
		order = [];
		for (const lane of lanes)
			if (!lane.collapsed)
				for (const column of board.columns)
					if (!collapsedColumns.has(column.key)) for (const row of lane.cells.get(column.key)!.cards) order.push(row.id);
	};

	// ─── Column actions ─────────────────────────────────────────────────

	/** The board's column order as values (for `columns`), skipping the no-value column. */
	const columnOrder = () => board.columns.map((column) => column.key).filter((key) => key !== '');

	const moveColumn = (key: string, step: -1 | 1) => {
		const keys = columnOrder();
		const at = keys.indexOf(key);
		const to = at + step;
		if (at < 0 || to < 0 || to >= keys.length) return;
		[keys[at], keys[to]] = [keys[to], keys[at]];
		context.updateView({ columns: keys });
	};

	const setColumnHidden = (key: string, hidden: boolean) => {
		const current = new Set(config.hiddenColumns ?? []);
		if (hidden) current.add(key);
		else current.delete(key);
		context.updateView({ hiddenColumns: [...current] });
	};

	const setLimit = (key: string, limit: number | null) => {
		const limits = { ...(config.wipLimits ?? {}) };
		if (limit == null) delete limits[key];
		else limits[key] = limit;
		context.updateView({ wipLimits: limits });
	};

	const askLimit = async (key: string) => {
		const column = board.columns.find((candidate) => candidate.key === key);
		if (!column) return;
		const input = h('input', 'og-ws-input', { type: 'number', min: 0, step: 1, placeholder: 'No limit', 'aria-label': 'Work-in-progress limit' });
		input.value = column.limit == null ? '' : String(column.limit);
		const body = h(
			'div',
			'og-ws-create-view',
			null,
			h('p', 'og-ws-hint', null, `At most this many cards in ${column.label}. Leave empty for no limit.`),
			input
		);
		defaultGridScheduler.timeout(() => input.select(), 0);
		const answer = await context.confirm({ title: `WIP limit for ${column.label}`, body, confirm: 'Set limit' });
		if (answer !== 'confirm') return;
		setLimit(key, input.value === '' ? null : Math.max(0, Math.round(Number(input.value))));
	};

	const columnMenu = (anchor: HTMLElement, key: string) => {
		const column = board.columns.find((candidate) => candidate.key === key)!;
		const ids = board.lanes.flatMap((lane) => lane.cells.get(key)!.map((row) => row.id));
		const keys = columnOrder();
		const at = keys.indexOf(key);
		context.menu(anchor, [
			{
				label: `Select ${ids.length} cards`,
				icon: 'check',
				disabled: !ids.length,
				run: () => context.api.selectRows(ids, { mode: 'replace' }),
			},
			{ label: 'Add a card here', icon: 'plus', disabled: !context.create, run: () => void quickAdd(key, board.lanes[0]?.key ?? SINGLE_LANE) },
			'separator',
			{ label: column.limit != null ? `WIP limit: ${column.limit}…` : 'Set a WIP limit…', icon: 'alert', run: () => void askLimit(key) },
			{ label: 'Move left', icon: 'chevronLeft', disabled: at <= 0, run: () => moveColumn(key, -1) },
			{ label: 'Move right', icon: 'chevronRight', disabled: at < 0 || at >= keys.length - 1, run: () => moveColumn(key, 1) },
			{
				label: collapsedColumns.has(key) ? 'Expand column' : 'Collapse column',
				icon: collapsedColumns.has(key) ? 'expand' : 'collapse',
				run: () => toggleColumn(key),
			},
			{ label: 'Hide column', icon: 'close', run: () => setColumnHidden(key, true) },
		]);
	};

	const toggleColumn = (key: string) => {
		if (collapsedColumns.has(key)) collapsedColumns.delete(key);
		else collapsedColumns.add(key);
		context.remember('collapsedColumns', [...collapsedColumns]);
		render(true);
	};

	const toggleLane = (key: string) => {
		if (collapsedLanes.has(key)) collapsedLanes.delete(key);
		else collapsedLanes.add(key);
		context.remember('collapsedLanes', [...collapsedLanes]);
		render(true);
	};

	const quickAdd = async (column: string, lane: string) => {
		const values: Record<string, unknown> = {};
		const target = board.columns.find((candidate) => candidate.key === column);
		if (target && options.columnField) values[options.columnField] = target.value;
		const laneModel = board.lanes.find((candidate) => candidate.key === lane);
		if (laneModel && options.laneField && lane !== SINGLE_LANE) values[options.laneField] = laneModel.value;
		await context.create?.(values);
	};

	const money = (value: number | null) => {
		if (value == null) return '';
		const col = reader.column(options.valueField);
		const currency = col?.schema?.number?.currency ?? (col?.schema?.kind === 'currency' ? 'USD' : undefined);
		return formatNumber(value, { currency, compact: value >= 1e6 });
	};

	// ─── Frame: headers, lanes, cell backgrounds (keyed; they glide) ─────

	/** Reuses the keyed element (or makes one), fills it, and places it; unused ones leave. */
	const reconcile = (map: Map<string, HTMLElement>, wanted: Set<string>, glide: boolean) => {
		for (const [key, element] of map)
			if (!wanted.has(key)) {
				map.delete(key);
				if (glide) motion.leave(element);
				else element.remove();
			}
	};

	const keyed = (map: Map<string, HTMLElement>, key: string, parent: HTMLElement, make: () => HTMLElement, glide: boolean): HTMLElement => {
		let element = map.get(key);
		if (!element) {
			element = make();
			map.set(key, element);
			parent.append(element);
			if (glide && painted) defaultGridScheduler.raf(() => motion.enter(element!));
		}
		return element;
	};

	const drawFrame = (glide: boolean) => {
		const editable = config.editable !== false && !!options.columnField;
		head.style.width = `${layout.width}px`;
		const wantedHeads = new Set<string>();
		for (const column of board.columns) {
			wantedHeads.add(column.key);
			const collapsed = collapsedColumns.has(column.key);
			const header = keyed(
				headers,
				column.key,
				head,
				() => h('div', 'og-ws-col-head', { 'data-column': column.key, role: 'columnheader' }),
				glide
			);
			header.className = `og-ws-col-head${collapsed ? ' og-ws-collapsed' : ''}${column.over ? ' og-ws-over' : ''}`;
			header.title = column.over ? `Over the WIP limit of ${column.limit}` : '';
			header.style.width = `${layout.columnW.get(column.key)}px`;
			header.style.setProperty('--og-ws-hue', hue(column.color, column.key || 'none'));
			motion.place(header, layout.columnX.get(column.key)!, 8, glide);
			const count = column.limit != null ? `${column.rows.length} / ${column.limit}` : String(column.rows.length);
			const name = h(
				'button',
				'og-ws-col-name',
				{ type: 'button', 'aria-expanded': String(!collapsed), title: collapsed ? 'Expand' : 'Collapse' },
				h('span', 'og-ws-dot og-ws-dot-lg'),
				h('strong', null, null, column.label)
			);
			name.addEventListener('click', () => toggleColumn(column.key));
			const badge = h('span', `og-ws-count-badge${column.over ? ' og-ws-over' : ''}`, null, count);
			if (collapsed) {
				header.replaceChildren(name, badge);
				continue;
			}
			const more = button({ icon: 'more', title: `${column.label} actions` });
			more.addEventListener('click', () => columnMenu(more, column.key));
			const add = context.create
				? button({ icon: 'plus', title: `Add to ${column.label}` }, () => void quickAdd(column.key, board.lanes[0]?.key ?? SINGLE_LANE))
				: null;
			const top = h('div', 'og-ws-col-top', null, name, badge, h('span', 'og-ws-spacer'), more, add);
			if (!editable) top.append(icon('lock', 13));
			const total =
				column.total != null
					? h('div', 'og-ws-col-total', null, money(column.total))
					: h('div', 'og-ws-col-total og-ws-hint', null, column.rows.length === 1 ? '1 card' : `${column.rows.length} cards`);
			header.replaceChildren(top, total);
			if (column.limit != null) {
				const fill = h('span', 'og-ws-wip-fill');
				fill.style.width = `${Math.min(1, column.rows.length / Math.max(1, column.limit)) * 100}%`;
				header.append(h('span', 'og-ws-wip', null, fill));
			}
		}
		reconcile(headers, wantedHeads, glide);
		// Document order follows board order (reading and tab order), moved only when it changed.
		const headerOrder = board.columns.map((column) => headers.get(column.key)!);
		if (headerOrder.some((element, i) => head.children[i] !== element)) head.append(...headerOrder);

		canvas.style.width = `${layout.width}px`;
		canvas.style.height = `${layout.height}px`;
		const single = layout.lanes.length === 1 && layout.lanes[0].key === SINGLE_LANE;
		const wantedLanes = new Set<string>();
		const wantedCells = new Set<string>();
		for (const lane of layout.lanes) {
			const model = board.lanes.find((candidate) => candidate.key === lane.key)!;
			if (!single) {
				wantedLanes.add(lane.key);
				const laneHead = keyed(
					laneHeads,
					lane.key,
					canvas,
					() => h('div', 'og-ws-lane-head', { 'data-lane': lane.key, role: 'rowheader' }),
					glide
				);
				laneHead.style.width = `${layout.width - PAD * 2}px`;
				motion.place(laneHead, PAD, lane.top, glide);
				const chevron = button(
					{ icon: 'chevronDown', title: lane.collapsed ? 'Expand lane' : 'Collapse lane', className: 'og-ws-chevron' },
					() => toggleLane(lane.key)
				);
				chevron.toggleAttribute('data-collapsed', lane.collapsed);
				const mark = h('span', 'og-ws-lane-mark', null, initials(model.label || '—') || '—');
				mark.style.setProperty('--og-ws-hue', hue(model.color, model.label || lane.key));
				const counts = h('span', 'og-ws-lane-counts');
				for (const column of board.columns) {
					const n = model.cells.get(column.key)!.length;
					const chip = h('span', 'og-ws-lane-count', { title: `${column.label}: ${n}` }, h('span', 'og-ws-ring'), String(n));
					chip.style.setProperty('--og-ws-hue', hue(column.color, column.key || 'none'));
					counts.append(chip);
				}
				const sticky = h(
					'div',
					'og-ws-lane-sticky',
					null,
					chevron,
					mark,
					h('strong', null, null, model.label),
					h('span', 'og-ws-hint', null, `${model.count} ${model.count === 1 ? 'card' : 'cards'}`),
					model.total != null ? h('span', 'og-ws-lane-total', null, money(model.total)) : null
				);
				laneHead.replaceChildren(sticky, h('span', 'og-ws-spacer'), counts);
				if (context.create)
					laneHead.append(
						button({ icon: 'plus', title: `Add to ${model.label}` }, () => void quickAdd(board.columns[0]?.key ?? '', lane.key))
					);
			}
			if (lane.collapsed) continue;
			for (const column of board.columns) {
				const cell = lane.cells.get(column.key)!;
				const key = `${lane.key}\u0000${column.key}`;
				wantedCells.add(key);
				const bg = keyed(cellElements, key, canvas, () => h('div', 'og-ws-cell', { 'data-cell': key }), glide);
				const collapsed = collapsedColumns.has(column.key);
				bg.classList.toggle('og-ws-collapsed', collapsed);
				bg.style.width = `${cell.width}px`;
				bg.style.height = `${lane.top + lane.height - lane.body - GAP + 8}px`;
				motion.place(bg, cell.x, lane.body - 4, glide);
				if (collapsed) {
					const vertical = h(
						'button',
						'og-ws-cell-collapsed',
						{ type: 'button', title: `Expand ${column.label}` },
						`${column.label} · ${cell.cards.length}`
					);
					vertical.addEventListener('click', () => toggleColumn(column.key));
					bg.replaceChildren(vertical);
				} else if (context.create) {
					const add = h('button', 'og-ws-cell-add', { type: 'button' }, icon('plus', 14), 'Add card');
					add.style.top = `${cell.cards.length * layout.pitch + 4}px`;
					add.addEventListener('click', () => void quickAdd(column.key, lane.key));
					bg.replaceChildren(add);
				} else bg.replaceChildren();
			}
		}
		reconcile(laneHeads, wantedLanes, glide);
		reconcile(cellElements, wantedCells, glide);
		canvas.append(indicator, dropHint);
	};

	// ─── Cards (virtualized) ─────────────────────────────────────────────

	const buildCard = (row: RecordRow<T>): { element: HTMLElement; fields: FieldValue<T>[] } => {
		const element = h('article', 'og-ws-card og-ws-kanban-card', { 'data-record-id': row.id, role: 'gridcell', tabindex: -1 });
		const fields: FieldValue<T>[] = [];
		fill(element, row, fields);
		return { element, fields };
	};

	const fill = (element: HTMLElement, row: RecordRow<T>, fields: FieldValue<T>[]) => {
		for (const field of fields) field.destroy();
		fields.length = 0;
		const roles = reader.roles;
		element.style.setProperty('--og-ws-accent', context.accent(row) ?? 'var(--og-ws-line-strong)');
		const blocked = board.blocked.has(row.id);
		element.toggleAttribute('data-blocked', blocked);
		element.toggleAttribute('data-done', reader.isDone(row));
		const editable = config.editable !== false && !!options.columnField && context.canEdit(row.id, options.columnField);
		element.toggleAttribute('data-draggable', editable);
		element.setAttribute('aria-label', reader.title(row));
		const value = roles.value ? reader.text(row, roles.value) : '';
		const top = h(
			'div',
			'og-ws-card-top',
			null,
			h('span', 'og-ws-key', null, reader.key(row)),
			presenceDots(context, row.id),
			h('span', 'og-ws-spacer'),
			value ? h('span', 'og-ws-card-value', null, value) : null
		);
		const title = h('div', 'og-ws-card-title', null, reader.title(row));
		const pills = h(
			'div',
			'og-ws-card-pills',
			null,
			blocked ? blockedBadge() : null,
			optionPill(reader, row, roles.priority),
			labelPills(reader, row, roles.team !== options.laneField ? roles.team : undefined, 1) ?? labelPills(reader, row, roles.labels, 2)
		);
		const meta = h('div', 'og-ws-card-meta', null, personChip(reader, row, roles.owner), h('span', 'og-ws-spacer'), dueChip(reader, row));
		element.replaceChildren(top, title);
		if (config.density === 'compact') {
			meta.prepend(optionPill(reader, row, roles.priority, 'dot') ?? '');
			element.append(meta);
		} else {
			element.append(pills, meta);
			const progress = progressLine(reader, row);
			if (progress) element.append(h('div', 'og-ws-card-progress', null, progress));
		}
		for (const col of fieldsFor()) {
			const field = new FieldValue(col, context.api);
			field.show(row);
			fields.push(field);
			element.append(h('div', 'og-ws-card-field', null, h('span', 'og-ws-hint', null, col.header ?? col.field), field.element));
		}
		if (config.density !== 'compact') element.append(h('div', 'og-ws-card-foot', null, countsLine(context, row, reader) ?? h('span')));
	};

	/**
	 * Draws the cards in view. `glide` (a data or settings change, not a scroll): cards that moved glide
	 * to their new place, new ones settle in, and ones that left the board fade out.
	 */
	const paintCards = (glide = false) => {
		frame = 0;
		const top = scroller.scrollTop - OVERSCAN;
		const bottom = scroller.scrollTop + (scroller.clientHeight || 800) + OVERSCAN;
		const left = scroller.scrollLeft - OVERSCAN;
		const right = scroller.scrollLeft + (scroller.clientWidth || 1200) + OVERSCAN;
		const visible = new Set<string>();
		const selected = context.selected();
		const focused = context.focused();
		let entering = 0;
		for (const lane of layout.lanes) {
			if (lane.collapsed || lane.top > bottom || lane.top + lane.height < top) continue;
			for (const column of board.columns) {
				if (collapsedColumns.has(column.key)) continue;
				const cell = lane.cells.get(column.key)!;
				if (cell.x > right || cell.x + cell.width < left) continue;
				const first = Math.max(0, Math.floor((top - cell.y) / layout.pitch));
				const last = Math.min(cell.cards.length - 1, Math.ceil((bottom - cell.y) / layout.pitch));
				for (let i = first; i <= last; i++) {
					const row = cell.cards[i] as RecordRow<T>;
					visible.add(row.id);
					let card = cards.get(row.id);
					const fresh = !card;
					if (!card) {
						const built = buildCard(row);
						card = { ...built, version: row.data };
						cards.set(row.id, card);
						canvas.append(card.element);
					} else if (card.version !== row.data || card.element.dataset.stale) {
						fill(card.element, row, card.fields);
						card.version = row.data;
						delete card.element.dataset.stale;
					}
					const el = card.element;
					el.style.width = `${cell.width}px`;
					el.style.height = `${layout.cardH}px`;
					motion.place(el, cell.x, cell.y + i * layout.pitch, glide);
					if (fresh && glide && painted) motion.enter(el, Math.min(entering++, 12) * ENTER_STAGGER);
					el.toggleAttribute('data-selected', selected.has(row.id));
					el.toggleAttribute('data-focused', focused === row.id);
					el.tabIndex = focused === row.id ? 0 : -1;
					if (drag?.moved && drag.ids.includes(row.id)) el.setAttribute('data-drag-source', '');
				}
			}
		}
		for (const [id, card] of cards)
			if (!visible.has(id)) {
				if (card.element.contains(document.activeElement)) continue;
				for (const field of card.fields) field.destroy();
				cards.delete(id);
				// Off the board (filtered out, deleted, hidden column): fade. Scrolled away: just go.
				if (glide && !board.placement.has(id)) motion.leave(card.element);
				else {
					motion.forget(card.element);
					card.element.remove();
				}
			}
		painted = true;
	};

	const schedulePaint = () => {
		if (!frame) frame = defaultGridScheduler.raf(() => paintCards(false));
	};

	const render = (glide = false) => {
		project();
		if (!board.columns.length) {
			scroller.hidden = true;
			empty.hidden = false;
			empty.replaceChildren(
				h('div', 'og-ws-empty-title', null, options.columnField ? 'No columns' : 'This board needs a status field'),
				h(
					'p',
					'og-ws-hint',
					null,
					options.columnField
						? (config.emptyText ?? 'Every column is hidden. Show some in Customize.')
						: 'Add a select column named Status, or set `records.status`.'
				)
			);
			return;
		}
		scroller.hidden = false;
		const nothing = board.columns.every((column) => column.rows.length === 0);
		empty.hidden = !nothing;
		if (nothing) {
			const clear = button({ icon: 'filter', label: 'Clear filters' }, () => {
				context.api.setFilterModel(null);
				context.api.setQuickFilter('');
			});
			empty.replaceChildren(
				h('div', 'og-ws-empty-title', null, 'No cards'),
				h('p', 'og-ws-hint', null, config.emptyText ?? 'No records match the current filters or search.'),
				clear
			);
		}
		for (const card of cards.values()) card.element.dataset.stale = '1';
		measure();
		drawFrame(glide && painted);
		for (const card of cards.values()) canvas.append(card.element);
		paintCards(glide && painted);
	};

	// ─── Drag and drop ───────────────────────────────────────────────────

	const locate = (clientX: number, clientY: number): { column: string; lane: string; index: number } | null => {
		const rect = canvas.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const column = board.columns.find((candidate) => {
			const left = layout.columnX.get(candidate.key)!;
			return x >= left - GAP / 2 && x <= left + layout.columnW.get(candidate.key)! + GAP / 2;
		});
		if (!column) return null;
		const lane =
			layout.lanes.find((candidate) => y >= candidate.top && y < candidate.top + candidate.height + GAP) ??
			(y < 0 ? layout.lanes[0] : layout.lanes[layout.lanes.length - 1]);
		if (!lane || lane.collapsed) return null;
		const cell = lane.cells.get(column.key)!;
		const moving = new Set(drag?.ids ?? []);
		const others = cell.cards.filter((row) => !moving.has(row.id));
		const index = Math.max(0, Math.min(others.length, Math.round((y - cell.y) / layout.pitch)));
		return { column: column.key, lane: lane.key, index };
	};

	const showTarget = () => {
		for (const el of cellElements.values()) {
			el.removeAttribute('data-drop');
			el.removeAttribute('data-rejected');
		}
		if (!drag?.target) {
			indicator.hidden = true;
			dropHint.hidden = true;
			return;
		}
		const { column, lane, index } = drag.target;
		const cellEl = cellElements.get(`${lane}\u0000${column}`);
		cellEl?.setAttribute(drag.rejected ? 'data-rejected' : 'data-drop', '');
		const box = layout.lanes.find((candidate) => candidate.key === lane)?.cells.get(column);
		if (!box) return;
		const columnModel = board.columns.find((candidate) => candidate.key === column)!;
		const moving = new Set(drag.ids);
		const count = box.cards.filter((row) => !moving.has(row.id)).length;
		if (!drag.rejected && options.useRank) {
			dropHint.hidden = true;
			const wasHidden = indicator.hidden;
			indicator.hidden = false;
			indicator.style.width = `${box.width}px`;
			// The insertion line glides between slots.
			motion.place(indicator, box.x, box.y + index * layout.pitch - GAP / 2 - 1, !wasHidden);
			return;
		}
		indicator.hidden = true;
		const wasHidden = dropHint.hidden;
		dropHint.hidden = false;
		if (drag.rejected) {
			dropHint.className = 'og-ws-drop-hint og-ws-rejected';
			dropHint.replaceChildren(icon('blocked'), h('strong', null, null, 'Can’t drop here'), h('span', null, null, drag.rejected));
		} else {
			dropHint.className = 'og-ws-drop-hint';
			dropHint.replaceChildren(icon('plus'), h('strong', null, null, 'Drop here'), h('span', null, null, `Move to ${columnModel.label}`));
		}
		dropHint.style.width = `${box.width}px`;
		dropHint.style.height = `${layout.cardH}px`;
		motion.place(dropHint, box.x, box.y + count * layout.pitch, !wasHidden);
		if (wasHidden) motion.enter(dropHint);
	};

	const evaluate = (target: Drag['target']): string | null => {
		if (!target || !drag) return null;
		const ids = drag.ids;
		if (!ids.every((id) => context.canEdit(id, options.columnField))) return 'You can’t change the status of these cards.';
		if (options.laneField && target.lane !== SINGLE_LANE && !ids.every((id) => context.canEdit(id, options.laneField!)))
			return 'You can’t change the swimlane of these cards.';
		const plan = planBoardMove(board, reader, options, { ids, column: target.column, lane: target.lane }, { wip: config.wipPolicy });
		return plan.rejected ?? null;
	};

	const edgeScroll = () => {
		autoScroll = 0;
		if (!drag?.moved) return;
		const rect = scroller.getBoundingClientRect();
		const zone = 56;
		const dx = drag.lastX < rect.left + zone ? -1 : drag.lastX > rect.right - zone ? 1 : 0;
		const dy = drag.lastY < rect.top + HEAD_H + zone ? -1 : drag.lastY > rect.bottom - zone ? 1 : 0;
		if (!dx && !dy) return;
		scroller.scrollLeft += dx * 14;
		scroller.scrollTop += dy * 14;
		updateTarget();
		autoScroll = defaultGridScheduler.raf(edgeScroll);
	};

	const updateTarget = () => {
		if (!drag) return;
		const target = locate(drag.lastX, drag.lastY);
		const same =
			target && drag.target && target.column === drag.target.column && target.lane === drag.target.lane && target.index === drag.target.index;
		if (same) return;
		drag.target = target;
		drag.rejected = evaluate(target);
		showTarget();
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || config.editable === false) return;
		const element = (event.target as Element).closest<HTMLElement>('.og-ws-kanban-card[data-draggable]');
		if (!element || (event.target as Element).closest('button, a, input, [data-quick-field]')) return;
		const id = element.dataset.recordId!;
		const selected = context.selected();
		const ids = selected.has(id) && selected.size > 1 ? order.filter((candidate) => selected.has(candidate)) : [id];
		drag = {
			ids,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
			ghost: null,
			target: null,
			rejected: null,
			lastX: event.clientX,
			lastY: event.clientY,
		};
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.lastX = event.clientX;
		drag.lastY = event.clientY;
		if (!drag.moved) {
			if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
			drag.moved = true;
			try {
				scroller.setPointerCapture(event.pointerId);
			} catch {
				/* synthetic pointer */
			}
			const source = cards.get(drag.ids[0])?.element;
			if (source) {
				const ghost = source.cloneNode(true) as HTMLElement;
				ghost.className = 'og-ws-card og-ws-kanban-card og-ws-drag-ghost';
				ghost.removeAttribute('data-record-id');
				ghost.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 6}px)`;
				ghost.style.width = `${source.offsetWidth}px`;
				if (drag.ids.length > 1) ghost.append(h('span', 'og-ws-drag-count', null, String(drag.ids.length)));
				drag.ghost = ghost;
				host.ownerDocument.body.append(ghost);
				const scope = host.closest<HTMLElement>('[data-og-theme-scope]')?.dataset.ogThemeScope;
				if (scope) ghost.dataset.ogThemeScope = scope;
			}
			scroller.setAttribute('data-dragging', '');
			for (const id of drag.ids) cards.get(id)?.element.setAttribute('data-drag-source', '');
		}
		// The ghost leans into the direction of travel.
		if (drag.ghost) {
			const tilt = Math.max(-6, Math.min(6, (event.movementX || 0) * 0.6));
			drag.ghost.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 6}px) rotate(${2 + tilt}deg)`;
		}
		updateTarget();
		if (!autoScroll) autoScroll = defaultGridScheduler.raf(edgeScroll);
	};

	const endDrag = (dropped = false) => {
		if (!drag) return;
		const ghost = drag.ghost;
		// Cancelled: the ghost flies back to its card; dropped: it fades as the card lands.
		if (ghost && !dropped && motion.enabled) {
			const source = cards.get(drag.ids[0])?.element.getBoundingClientRect();
			if (source) {
				const back = ghost.animate(
					[{ transform: ghost.style.transform }, { transform: `translate(${source.left}px, ${source.top}px)`, opacity: 0.4 }],
					{
						duration: 220,
						easing: 'cubic-bezier(.2,.8,.2,1)',
					}
				);
				back.onfinish = () => ghost.remove();
			} else ghost.remove();
		} else ghost?.remove();
		if (scroller.hasPointerCapture?.(drag.pointerId)) scroller.releasePointerCapture(drag.pointerId);
		scroller.removeAttribute('data-dragging');
		for (const card of cards.values()) card.element.removeAttribute('data-drag-source');
		if (autoScroll) defaultGridScheduler.cancelRaf(autoScroll);
		autoScroll = 0;
		drag = null;
		showTarget();
	};

	const onPointerUp = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const state = drag;
		if (state.moved) cards.get(state.ids[0])?.element.setAttribute('data-drag-suppress-click', '');
		const accepted = state.moved && !!state.target && !state.rejected;
		endDrag(accepted);
		if (!state.moved || !state.target) return;
		if (state.rejected) {
			context.toast(state.rejected, 'warn');
			return;
		}
		const { column, lane, index } = state.target;
		const cell = layout.lanes.find((candidate) => candidate.key === lane)?.cells.get(column);
		const moving = new Set(state.ids);
		const others = (cell?.cards ?? []).filter((row) => !moving.has(row.id));
		const plan = planBoardMove(
			board,
			reader,
			options,
			{ ids: state.ids, column, lane, beforeId: others[index]?.id ?? null },
			{ wip: config.wipPolicy }
		);
		const columnLabel = board.columns.find((candidate) => candidate.key === column)?.label ?? column;
		const changed = plan.writes.some((write) => write.colField !== reader.roles.rank);
		const outcome = context.write(
			plan.writes,
			changed
				? `Moved ${state.ids.length === 1 ? `“${reader.title(context.lookup(state.ids[0])!)}”` : `${state.ids.length} cards`} to ${columnLabel}`
				: undefined
		);
		for (const warning of plan.warnings) context.toast(warning, 'warn');
		if (outcome.ok)
			defaultGridScheduler.timeout(() => {
				for (const id of state.ids) {
					const el = cards.get(id)?.element;
					if (el) motion.flash(el);
				}
			}, 320);
	};

	const onPointerCancel = () => endDrag();
	const onKeyEscape = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && drag?.moved) {
			event.stopPropagation();
			endDrag();
		}
	};

	scroller.addEventListener('pointerdown', onPointerDown);
	scroller.addEventListener('pointermove', onPointerMove);
	scroller.addEventListener('pointerup', onPointerUp);
	scroller.addEventListener('pointercancel', onPointerCancel);
	scroller.addEventListener(
		'scroll',
		() => {
			context.remember('scroll', [scroller.scrollLeft, scroller.scrollTop]);
			schedulePaint();
		},
		{ passive: true }
	);
	host.ownerDocument.addEventListener('keydown', onKeyEscape, true);
	const [savedLeft, savedTop] = context.memory<[number, number]>('scroll', [0, 0]);

	const moveByKeyboard = (id: string, step: number): boolean => {
		const place = board.placement.get(id);
		if (!place || config.editable === false) return false;
		const visibleColumns = board.columns.filter((column) => !collapsedColumns.has(column.key));
		const index = visibleColumns.findIndex((column) => column.key === place.column);
		const target = visibleColumns[index + step];
		if (!target) return true;
		const ids = context.selected().has(id) ? order.filter((candidate) => context.selected().has(candidate)) : [id];
		const plan = planBoardMove(board, reader, options, { ids, column: target.key }, { wip: config.wipPolicy });
		if (plan.rejected) {
			context.toast(plan.rejected, 'warn');
			return true;
		}
		context.write(plan.writes, `Moved to ${target.label}`);
		return true;
	};

	const reorderByKeyboard = (id: string, step: number): boolean => {
		const place = board.placement.get(id);
		if (!place || !options.useRank) return false;
		const cell = layout.lanes.find((lane) => lane.key === place.lane)?.cells.get(place.column);
		if (!cell) return false;
		const others = cell.cards.filter((row) => row.id !== id);
		const current = cell.cards.findIndex((row) => row.id === id);
		const at = Math.max(0, Math.min(others.length, current + step));
		const plan = planBoardMove(board, reader, options, { ids: [id], column: place.column, lane: place.lane, beforeId: others[at]?.id ?? null });
		context.write(plan.writes);
		return true;
	};

	const metrics = (): WorkspaceMetric[] => {
		const rows = context.rows();
		if (!rows.length) return [];
		const out: WorkspaceMetric[] = [];
		const total = options.valueField ? aggregateRecords(rows, reader, 'sum', options.valueField) : null;
		if (total != null) out.push({ label: `Total ${reader.column(options.valueField)?.header?.toLowerCase() ?? 'value'}`, value: money(total) });
		const done = aggregateRecords(rows, reader, 'done') ?? 0;
		out.push({ label: 'Completed', value: `${Math.round((done / rows.length) * 100)}%`, meter: done / rows.length });
		// Under way: started (by its dates, or its progress) and not finished.
		const today = toDay(new Date());
		const active = rows.filter((row) => {
			if (reader.isDone(row) || board.blocked.has(row.id)) return false;
			const span = reader.span(row);
			return (reader.progress(row) ?? 0) > 0 || (!!span && span.start <= today);
		}).length;
		out.push({ label: 'Active', value: active.toLocaleString(), tone: '#3b82f6' });
		out.push({ label: 'Blocked', value: board.blocked.size.toLocaleString(), tone: board.blocked.size ? '#ef4444' : '#71717a' });
		const limits = board.columns.filter((column) => column.limit != null);
		if (limits.length) {
			const used = limits.reduce((sum, column) => sum + column.rows.length, 0);
			const capacity = limits.reduce((sum, column) => sum + column.limit!, 0);
			out.push({
				label: 'WIP capacity',
				value: `${Math.round((used / capacity) * 100)}%`,
				meter: used / capacity,
				title: `${used} of ${capacity} WIP slots`,
			});
		}
		return out;
	};

	// ─── Toolbar, settings, commands ────────────────────────────────────

	let lanesButton: HTMLButtonElement | null = null;
	let densityButton: HTMLButtonElement | null = null;
	const laneFieldOptions = () =>
		context.columns().filter((col) => col.schema && ['select', 'person'].includes(col.schema.kind) && col.field !== options.columnField);
	const refreshToolbar = () => {
		if (lanesButton)
			lanesButton.querySelector('.og-ws-btn-label')!.textContent = config.swimlaneField
				? `Lanes: ${reader.column(config.swimlaneField)?.header ?? config.swimlaneField}`
				: 'No lanes';
		if (densityButton) densityButton.querySelector('.og-ws-btn-label')!.textContent = config.density === 'compact' ? 'Compact' : 'Comfortable';
	};
	const toolbar = () => {
		densityButton = button({ icon: 'layout', label: 'Comfortable', title: 'Card size' }, () =>
			context.updateView({ density: config.density === 'compact' ? 'comfortable' : 'compact' })
		);
		lanesButton = button({ icon: 'group', label: 'No lanes', title: 'Swimlanes' }, () =>
			context.menu(lanesButton!, [
				{ label: 'No swimlanes', checked: !config.swimlaneField, run: () => context.updateView({ swimlaneField: null }) },
				...laneFieldOptions().map((col) => ({
					label: col.header ?? col.field,
					checked: config.swimlaneField === col.field,
					run: () => context.updateView({ swimlaneField: col.field }),
				})),
			])
		);
		refreshToolbar();
		return h('div', 'og-ws-group', null, lanesButton, densityButton);
	};

	const settings = (): ViewSettingsSection[] => {
		const optionFields = context.columns().filter((col) => col.schema && ['select', 'person', 'checkbox'].includes(col.schema.kind));
		const numberFields = context
			.columns()
			.filter((col) => col.schema && ['number', 'currency', 'percent', 'progress', 'rating'].includes(col.schema.kind));
		const all = buildBoard(context.rows(), reader, options).columns;
		const hidden = new Set(config.hiddenColumns ?? []);
		const aggregate = config.aggregate
			? `${config.aggregate.fn}:${config.aggregate.field ?? ''}`
			: options.valueField
				? `sum:${options.valueField}`
				: 'count:';
		return [
			{
				title: 'Board',
				settings: [
					{
						kind: 'select',
						id: 'columnField',
						label: 'Columns',
						value: options.columnField,
						options: optionFields.map((col) => ({ value: col.field, label: col.header ?? col.field })),
						onChange: (value) =>
							context.updateView({ columnField: value, columns: undefined, wipLimits: undefined, hiddenColumns: undefined }),
					},
					{
						kind: 'select',
						id: 'swimlaneField',
						label: 'Swimlanes',
						value: config.swimlaneField ?? '',
						options: [
							{ value: '', label: 'None' },
							...laneFieldOptions().map((col) => ({ value: col.field, label: col.header ?? col.field })),
						],
						onChange: (value) => context.updateView({ swimlaneField: value || null }),
					},
					{
						kind: 'select',
						id: 'aggregate',
						label: 'Column total',
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
					{
						kind: 'toggle',
						id: 'hideEmpty',
						label: 'Hide empty columns',
						value: !!config.hideEmptyColumns,
						onChange: (value) => context.updateView({ hideEmptyColumns: value }),
					},
				],
			},
			{
				title: 'Columns',
				settings: [
					{
						kind: 'limits',
						id: 'limits',
						label: 'Visibility and WIP limits',
						hint: 'Empty limit means none.',
						rows: all.map((column) => ({
							value: column.key,
							label: column.label,
							color: column.color,
							limit: config.wipLimits?.[column.key] ?? null,
							hidden: hidden.has(column.key),
						})),
						onChange: (key, limit) => setLimit(key, limit),
						onToggle: (key, visible) => setColumnHidden(key, !visible),
					},
					{
						kind: 'segmented',
						id: 'wipPolicy',
						label: 'Over the limit',
						value: config.wipPolicy ?? 'warn',
						options: [
							{ value: 'warn', label: 'Warn' },
							{ value: 'block', label: 'Refuse the drop' },
						],
						onChange: (value) => context.updateView({ wipPolicy: value as 'warn' | 'block' }),
					},
				],
			},
			{
				title: 'Cards',
				settings: [
					{
						kind: 'segmented',
						id: 'density',
						label: 'Card size',
						value: config.density ?? 'comfortable',
						options: [
							{ value: 'compact', label: 'Compact' },
							{ value: 'comfortable', label: 'Comfortable' },
						],
						onChange: (value) => context.updateView({ density: value as 'compact' }),
					},
					{
						kind: 'fields',
						id: 'fields',
						label: 'Extra fields',
						hint: 'Title, status, owner, dates and progress are always drawn.',
						value: config.fields ?? [],
						options: context
							.columns()
							.filter((col) => !Object.values(reader.roles).includes(col.field))
							.map((col) => ({ value: col.field, label: col.header ?? col.field })),
						onChange: (value) => context.updateView({ fields: value }),
					},
				],
			},
		];
	};

	const commands = (): WorkspaceCommand[] => [
		...board.columns.map((column) => ({
			id: `kanban:collapse:${column.key}`,
			label: `${collapsedColumns.has(column.key) ? 'Expand' : 'Collapse'} column “${column.label}”`,
			group: 'Board',
			icon: (collapsedColumns.has(column.key) ? 'expand' : 'collapse') as 'expand' | 'collapse',
			run: () => toggleColumn(column.key),
		})),
		...(config.hiddenColumns ?? []).map((key) => ({
			id: `kanban:show:${key}`,
			label: `Show column “${reader.option(options.columnField, key)?.label ?? key}”`,
			group: 'Board',
			icon: 'expand' as const,
			run: () => setColumnHidden(key, false),
		})),
		{
			id: 'kanban:density',
			label: `Switch to ${config.density === 'compact' ? 'comfortable' : 'compact'} cards`,
			group: 'Board',
			icon: 'layout',
			run: () => context.updateView({ density: config.density === 'compact' ? 'comfortable' : 'compact' }),
		},
		{
			id: 'kanban:collapse-lanes',
			label: 'Collapse all swimlanes',
			group: 'Board',
			icon: 'collapse',
			enabled: () => board.lanes.length > 1,
			run: () => {
				board.lanes.forEach((lane) => collapsedLanes.add(lane.key));
				context.remember('collapsedLanes', [...collapsedLanes]);
				render(true);
			},
		},
		{
			id: 'kanban:expand-lanes',
			label: 'Expand all swimlanes',
			group: 'Board',
			icon: 'expand',
			enabled: () => collapsedLanes.size > 0,
			run: () => {
				collapsedLanes.clear();
				context.remember('collapsedLanes', []);
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
				scroller.scrollLeft = savedLeft;
				scroller.scrollTop = savedTop;
				paintCards(false);
			}
		},
		update(next) {
			const before = config;
			config = next as KanbanViewConfig<T>;
			// A new card shape rebuilds every card; position-only changes glide them.
			if (before.density !== config.density || before.fields !== config.fields || before.colorField !== config.colorField)
				for (const card of cards.values()) card.element.dataset.stale = '1';
			render(true);
			refreshToolbar();
		},
		settings,
		order: () => order,
		reveal(id) {
			const place = board.placement.get(id);
			if (!place) return null;
			if (collapsedLanes.delete(place.lane) || collapsedColumns.delete(place.column)) render(true);
			const lane = layout.lanes.find((candidate) => candidate.key === place.lane);
			const cell = lane?.cells.get(place.column);
			if (!cell) return null;
			const index = cell.cards.findIndex((row) => row.id === id);
			const y = cell.y + index * layout.pitch;
			const viewTop = scroller.scrollTop + HEAD_H;
			if (y < viewTop) scroller.scrollTop = y - HEAD_H - GAP;
			else if (y + layout.cardH > scroller.scrollTop + scroller.clientHeight)
				scroller.scrollTop = y + layout.cardH - scroller.clientHeight + GAP;
			if (cell.x < scroller.scrollLeft) scroller.scrollLeft = cell.x - PAD;
			else if (cell.x + cell.width > scroller.scrollLeft + scroller.clientWidth)
				scroller.scrollLeft = cell.x + cell.width - scroller.clientWidth + PAD;
			paintCards(false);
			return cards.get(id)?.element ?? null;
		},
		onKey(event, id) {
			if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
				return moveByKeyboard(id, event.key === 'ArrowRight' ? 1 : -1);
			if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))
				return reorderByKeyboard(id, event.key === 'ArrowDown' ? 1 : -1);
			return false;
		},
		toolbar,
		summary: metrics,
		commands,
		destroy() {
			endDrag();
			if (frame) defaultGridScheduler.cancelRaf(frame);
			host.ownerDocument.removeEventListener('keydown', onKeyEscape, true);
			for (const card of cards.values()) for (const field of card.fields) field.destroy();
			cards.clear();
			scroller.remove();
			empty.remove();
		},
	};
}

export const kanbanView: WorkspaceViewModule<KanbanViewConfig<any>> = { kind: 'kanban', label: 'Kanban', icon: 'kanban', create };
