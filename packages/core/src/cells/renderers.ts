/**
 * The built-in cell types as DOM renderers: mounted once per cell, updated in the paint loop with
 * no framework work. Each builds its elements on mount and touches the DOM in update() only when
 * what it shows changed. All styling is the theme-derived CSS in cellStyles.ts.
 */
import type { DomCellRenderer, DomCellRendererParams } from '../columnDef.js';
import { cellIconSvg, createCellIcon } from './icons.js';
import { createOptionMarker, optionLabel, type CellOption } from './listbox.js';
import { createCellOptionsStore, isCellOptionsStore, type CellOptionsStore } from './optionsStore.js';
import { hashCellColor, resolveCellColor, type CellColor } from './palette.js';
import {
	formatCellDate,
	formatCellNumber,
	initialsOf,
	isCheckedCellValue,
	parseCellNumber,
	parseMultiValue,
	toggleCheckedValue,
	type DateCellOptions,
	type NumberCellOptions,
} from './format.js';

type Params = DomCellRendererParams<any>;

export function cell(container: HTMLElement, align?: 'end' | 'center'): HTMLDivElement {
	const root = document.createElement('div');
	root.className = align ? `og-ct-cell og-ct-cell-${align}` : 'og-ct-cell';
	container.appendChild(root);
	return root;
}

export function setHue(el: HTMLElement, color: string | undefined) {
	if (color) {
		el.style.setProperty('--og-ct-hue', color);
		el.setAttribute('data-hued', '');
	} else {
		el.style.removeProperty('--og-ct-hue');
		el.removeAttribute('data-hued');
	}
}

/** Writes a value through the grid (selecting the cell first, as a click on it would). */
export function writeValue(params: Params, value: unknown) {
	const rowId = params.node.id;
	const colField = params.col.field;
	params.api.selectCell({ rowId, colField }, 'pointer');
	params.api.setCellValue(rowId, colField, value);
}

/** A renderer that redraws from the value alone, skipping updates whose value did not change. */
export function valueRenderer(
	build: (root: HTMLElement, params: Params) => (value: unknown, params: Params) => void,
	align?: 'end' | 'center',
	/** Sees every update, value changed or not (a recycled cell keeps its value but changes row). */
	onParams?: (root: HTMLElement, params: Params) => void
): DomCellRenderer<any> {
	return {
		mount(container, params) {
			const root = cell(container, align);
			const draw = build(root, params);
			let last: unknown = {};
			const update = (p: Params) => {
				onParams?.(root, p);
				if (Object.is(p.value, last)) return;
				last = p.value;
				draw(p.value, p);
			};
			update(params);
			return { update };
		},
	};
}

// ─── Text-like ────────────────────────────────────────────────────────────────

export function createNumberRenderer(options: NumberCellOptions = {}): DomCellRenderer<any> {
	return valueRenderer((root) => {
		const span = document.createElement('span');
		span.className = 'og-ct-number';
		root.appendChild(span);
		return (value) => {
			span.textContent = formatCellNumber(value, options) ?? '';
			const n = options.colorNegative ? parseCellNumber(value) : null;
			if (n !== null && n < 0) span.setAttribute('data-negative', '');
			else span.removeAttribute('data-negative');
		};
	}, 'end');
}

export function createDateRenderer(options: DateCellOptions & { icon?: boolean } = {}): DomCellRenderer<any> {
	return valueRenderer((root) => {
		const icon = options.icon === false ? null : createCellIcon(options.withTime ? 'clock' : 'calendar', 13);
		const text = document.createElement('span');
		text.className = 'og-ct-text';
		if (icon) root.appendChild(icon);
		root.appendChild(text);
		return (value) => {
			const display = formatCellDate(value, options);
			text.textContent = display ?? '';
			if (icon) icon.style.visibility = display === null ? 'hidden' : '';
		};
	});
}

export interface LinkCellOptions {
	/** 'url' (default) or 'email' (mailto:). */
	kind?: 'url' | 'email';
	/** Shown text; defaults to the value without the protocol. */
	label?: (value: string) => string;
}

export function createLinkRenderer(options: LinkCellOptions = {}): DomCellRenderer<any> {
	return valueRenderer((root) => {
		const link = document.createElement('a');
		link.className = 'og-ct-link';
		if (options.kind !== 'email') {
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
		}
		// Following the link must not also start a cell selection drag.
		link.addEventListener('mousedown', (event) => event.stopPropagation());
		root.appendChild(link);
		return (value) => {
			const text = value == null ? '' : String(value).trim();
			if (!text) {
				link.removeAttribute('href');
				link.textContent = '';
				return;
			}
			const href = options.kind === 'email' ? `mailto:${text}` : /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
			// Only web and mail links: never javascript: or data: from cell data.
			if (/^(https?|mailto):/i.test(href)) link.href = href;
			else link.removeAttribute('href');
			link.textContent = options.label ? options.label(text) : text.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
		};
	});
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────

/**
 * A checkbox or switch that toggles on press, writing back in the value's own shape (boolean,
 * 'true', 1). Double-clicks stay with the control (two presses), never opening an editor.
 */
function createToggleRenderer(kind: 'checkbox' | 'switch', labels?: { on?: string; off?: string }): DomCellRenderer<any> {
	return {
		mount(container, params) {
			const root = cell(container, kind === 'checkbox' || !labels ? 'center' : undefined);
			root.classList.add('og-ct-checkbox-host');
			root.setAttribute('role', kind);
			let control: HTMLElement;
			let text: HTMLSpanElement | null = null;
			if (kind === 'checkbox') {
				control = document.createElement('span');
				control.className = 'og-ct-checkbox';
				control.innerHTML = cellIconSvg('check', 12);
			} else {
				control = document.createElement('span');
				control.className = 'og-ct-switch';
				control.appendChild(document.createElement('i'));
				if (labels) {
					text = document.createElement('span');
					text.className = 'og-ct-switch-label';
				}
			}
			root.appendChild(control);
			if (text) root.appendChild(text);
			let current = params;
			let checked: boolean | null = null;
			const update = (p: Params) => {
				current = p;
				const next = isCheckedCellValue(p.value);
				if (next === checked) return;
				checked = next;
				root.setAttribute('aria-checked', String(next));
				if (next) control.setAttribute('data-checked', '');
				else control.removeAttribute('data-checked');
				if (text) text.textContent = (next ? labels?.on : labels?.off) ?? '';
			};
			const onMouseDown = (event: MouseEvent) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				event.preventDefault();
				writeValue(current, toggleCheckedValue(current.value));
			};
			const onDoubleClick = (event: MouseEvent) => event.stopPropagation();
			root.addEventListener('mousedown', onMouseDown);
			root.addEventListener('dblclick', onDoubleClick);
			update(params);
			return {
				update,
				destroy() {
					root.removeEventListener('mousedown', onMouseDown);
					root.removeEventListener('dblclick', onDoubleClick);
				},
			};
		},
	};
}

/** A checkbox that toggles on press, writing back in the value's own shape (boolean, 'true', 1). */
export function createCheckboxRenderer(): DomCellRenderer<any> {
	return createToggleRenderer('checkbox');
}

export interface SwitchCellOptions {
	/** Text beside the switch for each state (e.g. 'Active' / 'Paused'). */
	onLabel?: string;
	offLabel?: string;
}

/** An on / off switch, toggled on press. */
export function createSwitchRenderer(options: SwitchCellOptions = {}): DomCellRenderer<any> {
	const labels = options.onLabel || options.offLabel ? { on: options.onLabel, off: options.offLabel } : undefined;
	return createToggleRenderer('switch', labels);
}

// ─── Options: select, multi-select, combobox ─────────────────────────────────

export type BadgeVariant = 'soft' | 'dot' | 'outline' | 'plain' | 'record';

/** Options given as a list or a store: a list becomes a store of static options. */
export type CellOptionsInput = readonly CellOption[] | CellOptionsStore;

export function toOptionsStore(source: CellOptionsInput): CellOptionsStore {
	return isCellOptionsStore(source) ? source : createCellOptionsStore(source);
}

/** A placeholder for a value whose option is still being looked up. */
function createPendingValue(): HTMLElement {
	const bar = document.createElement('span');
	bar.className = 'og-ct-skeleton';
	bar.setAttribute('aria-label', 'Loading');
	return bar;
}

/**
 * A renderer of values looked up in a store. Values the store is still resolving draw as
 * placeholders, and the cell redraws once they are known, if it still shows the same value.
 */
function storeRenderer(
	store: CellOptionsStore,
	keysOf: (value: unknown) => string[],
	draw: (root: HTMLElement, value: unknown) => void,
	setup?: (root: HTMLElement) => void,
	paramsOf?: WeakMap<HTMLElement, DomCellRendererParams<any>>
): DomCellRenderer<any> {
	return valueRenderer(
		(root) => {
			setup?.(root);
			let current: unknown;
			return (value) => {
				current = value;
				const waiting = store.ensure(keysOf(value));
				draw(root, value);
				waiting?.then(() => {
					if (Object.is(current, value)) draw(root, value);
				});
			};
		},
		undefined,
		paramsOf ? (root, params) => paramsOf.set(root, params) : undefined
	);
}

function singleKey(value: unknown): string[] {
	return value == null || value === '' ? [] : [String(value)];
}

/** A badge for an option (or an unknown value: a neutral badge, or hashed colour with `autoColor`). */
export function createOptionBadge(option: CellOption | undefined, value: string, variant: BadgeVariant, autoColor = false): HTMLElement {
	const label = option ? optionLabel(option) : value;
	if (variant === 'record') {
		// A linked record: a lettered tile in the record's colour, then its name.
		const chip = document.createElement('span');
		chip.className = 'og-ct-record';
		chip.dataset.value = value;
		if (option?.description) chip.title = `${label} · ${option.description}`;
		const tile = document.createElement('span');
		tile.className = 'og-ct-record-tile';
		tile.style.setProperty('--og-ct-hue', resolveCellColor(option?.color as CellColor | undefined) ?? hashCellColor(value));
		tile.textContent = (label.trim()[0] ?? '?').toUpperCase();
		const text = document.createElement('span');
		text.className = 'og-ct-record-label';
		text.textContent = label;
		chip.append(tile, text);
		return chip;
	}
	if (variant === 'plain') {
		const wrap = document.createElement('span');
		wrap.className = 'og-ct-cell';
		const marker = option ? createOptionMarker(option) : null;
		if (marker) wrap.appendChild(marker);
		const text = document.createElement('span');
		text.className = 'og-ct-text';
		text.textContent = label;
		wrap.appendChild(text);
		return wrap;
	}
	const badge = document.createElement('span');
	badge.className = 'og-ct-badge';
	badge.dataset.value = value;
	if (variant !== 'soft') badge.setAttribute('data-variant', variant);
	const color = resolveCellColor(option?.color as CellColor | undefined) ?? (autoColor ? hashCellColor(value) : undefined);
	setHue(badge, color);
	if (option?.icon) badge.appendChild(createCellIcon(option.icon, 12));
	else if (variant !== 'soft' || color) {
		const dot = document.createElement('span');
		dot.className = 'og-ct-dot';
		badge.appendChild(dot);
	}
	const text = document.createElement('span');
	text.textContent = label;
	badge.appendChild(text);
	return badge;
}

export interface SelectRendererOptions {
	/** soft: tinted badge (default) · dot: colour dot + text · outline: bordered badge · plain: marker + text. */
	variant?: BadgeVariant;
}

export function createSelectRenderer(options: CellOptionsInput, config: SelectRendererOptions = {}): DomCellRenderer<any> {
	const store = toOptionsStore(options);
	const variant = config.variant ?? 'soft';
	return storeRenderer(store, singleKey, (root, value) => {
		root.textContent = '';
		if (value == null || value === '') return;
		const key = String(value);
		const option = store.get(key);
		root.appendChild(!option && store.isPending(key) ? createPendingValue() : createOptionBadge(option, key, variant));
	});
}

export interface SegmentedCellOptions {
	/** Show each option's dot / icon in its segment. Default true. */
	markers?: boolean;
}

/**
 * Every option inline as a segmented control: one press picks, no popover. Suits two to four
 * short options (Low / Medium / High). The chosen segment is tinted with its option colour.
 */
export function createSegmentedRenderer(options: readonly CellOption[], config: SegmentedCellOptions = {}): DomCellRenderer<any> {
	const markers = config.markers ?? true;
	return {
		mount(container, params) {
			const root = cell(container);
			const group = document.createElement('div');
			group.className = 'og-ct-segmented';
			group.setAttribute('role', 'radiogroup');
			const segments = options.map((option) => {
				const segment = document.createElement('span');
				segment.className = 'og-ct-segment';
				segment.setAttribute('role', 'radio');
				segment.dataset.value = option.value;
				setHue(segment, resolveCellColor(option.color));
				if (markers && option.icon) segment.appendChild(createCellIcon(option.icon, 12));
				const label = document.createElement('span');
				label.textContent = optionLabel(option);
				segment.appendChild(label);
				group.appendChild(segment);
				return segment;
			});
			root.appendChild(group);
			let current = params;
			let shown: string | null | undefined;
			const update = (p: Params) => {
				current = p;
				const value = p.value == null || p.value === '' ? null : String(p.value);
				if (value === shown) return;
				shown = value;
				for (const segment of segments) segment.setAttribute('aria-checked', String(segment.dataset.value === value));
			};
			const onMouseDown = (event: MouseEvent) => {
				const segment = (event.target as Element).closest<HTMLElement>('.og-ct-segment');
				if (!segment || event.button !== 0) return;
				event.stopPropagation();
				event.preventDefault();
				if (segment.dataset.value !== shown) writeValue(current, segment.dataset.value);
			};
			const onDoubleClick = (event: MouseEvent) => {
				if ((event.target as Element).closest('.og-ct-segment')) event.stopPropagation();
			};
			group.addEventListener('mousedown', onMouseDown);
			group.addEventListener('dblclick', onDoubleClick);
			update(params);
			return {
				update,
				destroy() {
					group.removeEventListener('mousedown', onMouseDown);
					group.removeEventListener('dblclick', onDoubleClick);
				},
			};
		},
	};
}

export interface MultiSelectRendererOptions {
	variant?: BadgeVariant;
	/** Chips shown before “+N”. Default: as many as the column fits. */
	maxVisible?: number;
	/** Colour values with no option from the palette (free tags). Default true. */
	autoColor?: boolean;
	/**
	 * Called when a chip is pressed (open the linked record, say), with the chip to anchor a preview
	 * to (`openCellPopover`). The press does not select the cell.
	 */
	onOpen?: (value: string, params: DomCellRendererParams<any>, chip: HTMLElement) => void;
}

export function createMultiSelectRenderer(options: CellOptionsInput, config: MultiSelectRendererOptions = {}): DomCellRenderer<any> {
	const store = toOptionsStore(options);
	const variant = config.variant ?? 'soft';
	const autoColor = config.autoColor ?? variant !== 'record';
	const maxVisible = config.maxVisible ?? 3;
	// The latest params of each mounted cell, for `onOpen`.
	const paramsOf = new WeakMap<HTMLElement, DomCellRendererParams<any>>();
	return storeRenderer(
		store,
		parseMultiValue,
		(root, value) => {
			root.textContent = '';
			const values = parseMultiValue(value);
			const shown = values.slice(0, maxVisible);
			for (const v of shown) {
				const option = store.get(v);
				root.appendChild(!option && store.isPending(v) ? createPendingValue() : createOptionBadge(option, v, variant, autoColor));
			}
			if (values.length > shown.length) {
				const more = document.createElement('span');
				more.className = 'og-ct-more';
				more.textContent = `+${values.length - shown.length}`;
				more.title = values
					.slice(shown.length)
					.map((v) => {
						const option = store.get(v);
						return option ? optionLabel(option) : v;
					})
					.join(', ');
				root.appendChild(more);
			}
		},
		(root) => {
			root.classList.add('og-ct-chips');
			if (!config.onOpen) return;
			root.setAttribute('data-openable', '');
			root.addEventListener('mousedown', (event) => {
				const chip = (event.target as Element).closest<HTMLElement>('[data-value]');
				if (!chip || event.button !== 0) return;
				event.stopPropagation();
				event.preventDefault();
				const params = paramsOf.get(root);
				if (params) config.onOpen!(chip.dataset.value!, params, chip);
			});
		},
		paramsOf
	);
}

// ─── Rating, progress ────────────────────────────────────────────────────────

export interface RatingCellOptions {
	max?: number;
	/** Click a star to set the rating (click the current one to clear). Default true. */
	interactive?: boolean;
}

export function createRatingRenderer(config: RatingCellOptions = {}): DomCellRenderer<any> {
	const max = config.max ?? 5;
	const interactive = config.interactive ?? true;
	return {
		mount(container, params) {
			const root = cell(container);
			const stars = document.createElement('span');
			stars.className = 'og-ct-stars';
			stars.setAttribute('role', 'img');
			if (interactive) stars.setAttribute('data-interactive', '');
			const items: HTMLSpanElement[] = [];
			for (let i = 0; i < max; i++) {
				const star = document.createElement('span');
				star.className = 'og-ct-star';
				star.innerHTML = cellIconSvg('star', 14, true);
				star.dataset.value = String(i + 1);
				items.push(star);
				stars.appendChild(star);
			}
			root.appendChild(stars);
			let current = params;
			let shown = -1;
			const update = (p: Params) => {
				current = p;
				const n = Math.max(0, Math.min(max, Math.round(parseCellNumber(p.value) ?? 0)));
				if (n === shown) return;
				shown = n;
				stars.setAttribute('aria-label', `${n} of ${max}`);
				for (let i = 0; i < max; i++) {
					if (i < n) items[i].setAttribute('data-on', '');
					else items[i].removeAttribute('data-on');
				}
			};
			const onMouseDown = (event: MouseEvent) => {
				const star = (event.target as Element).closest<HTMLElement>('.og-ct-star');
				if (!star || event.button !== 0) return;
				event.stopPropagation();
				event.preventDefault();
				const next = Number(star.dataset.value);
				writeValue(current, next === shown ? 0 : next);
			};
			if (interactive) stars.addEventListener('mousedown', onMouseDown);
			update(params);
			return { update, destroy: () => stars.removeEventListener('mousedown', onMouseDown) };
		},
	};
}

export interface ProgressCellOptions {
	/** The value that fills the bar. Default 100 (use 1 for fractions). */
	max?: number;
	showLabel?: boolean;
	color?: CellColor;
	/** Colour by fill: red under 34%, amber under 67%, else green. Overrides `color`. */
	traffic?: boolean;
}

export function createProgressRenderer(config: ProgressCellOptions = {}): DomCellRenderer<any> {
	const max = config.max ?? 100;
	const fixed = resolveCellColor(config.color);
	return valueRenderer((root) => {
		const track = document.createElement('span');
		track.className = 'og-ct-progress';
		track.setAttribute('role', 'progressbar');
		track.setAttribute('aria-valuemin', '0');
		track.setAttribute('aria-valuemax', '100');
		const bar = document.createElement('i');
		track.appendChild(bar);
		root.appendChild(track);
		const label = config.showLabel === false ? null : document.createElement('span');
		if (label) {
			label.className = 'og-ct-progress-label';
			root.appendChild(label);
		}
		return (value) => {
			const n = parseCellNumber(value);
			const pct = n === null ? 0 : Math.max(0, Math.min(100, (n / max) * 100));
			bar.style.width = `${pct}%`;
			track.setAttribute('aria-valuenow', String(Math.round(pct)));
			const color = config.traffic ? (pct < 34 ? 'var(--og-ct-danger)' : pct < 67 ? '#f59e0b' : '#22c55e') : fixed;
			if (color) bar.style.background = color;
			if (label) label.textContent = n === null ? '' : `${Math.round(pct)}%`;
		};
	});
}

// ─── Person ───────────────────────────────────────────────────────────────────

/** A person: an option (label is the name, description the role or e-mail) with an avatar. */
export interface PersonOption extends CellOption {
	avatarUrl?: string;
}

export interface PersonCellOptions {
	/** The people, or a store that loads them (see `createCellOptionsStore`). */
	people?: readonly PersonOption[] | CellOptionsStore;
	/** A cell may hold several people (array or comma-separated). */
	multiple?: boolean;
	/** Avatars shown before “+N” in a multiple cell. Default 3. */
	maxVisible?: number;
}

export function createAvatar(person: PersonOption | undefined, value: string): HTMLSpanElement {
	const name = person?.label ?? value;
	const avatar = document.createElement('span');
	avatar.className = 'og-ct-avatar';
	avatar.title = name;
	avatar.style.setProperty('--og-ct-hue', resolveCellColor(person?.color) ?? hashCellColor(value));
	if (person?.avatarUrl) {
		const img = document.createElement('img');
		img.alt = '';
		img.src = person.avatarUrl;
		img.addEventListener('error', () => img.replaceWith(document.createTextNode(initialsOf(name))), { once: true });
		avatar.appendChild(img);
	} else {
		avatar.textContent = initialsOf(name);
	}
	return avatar;
}

export function createPersonRenderer(config: PersonCellOptions = {}): DomCellRenderer<any> {
	const store = toOptionsStore(config.people ?? []);
	const person = (value: string) => store.get(value) as PersonOption | undefined;
	const maxVisible = config.maxVisible ?? 3;
	const keysOf = config.multiple ? parseMultiValue : singleKey;
	return storeRenderer(store, keysOf, (root, value) => {
		root.textContent = '';
		const values = keysOf(value);
		if (values.length === 0) return;
		if (values.length === 1) {
			if (!person(values[0]) && store.isPending(values[0])) {
				root.appendChild(createPendingValue());
				return;
			}
			root.appendChild(createAvatar(person(values[0]), values[0]));
			const name = document.createElement('span');
			name.className = 'og-ct-text';
			name.textContent = person(values[0])?.label ?? values[0];
			root.appendChild(name);
			return;
		}
		const stack = document.createElement('span');
		stack.className = 'og-ct-avatars';
		for (const v of values.slice(0, maxVisible)) stack.appendChild(createAvatar(person(v), v));
		root.appendChild(stack);
		if (values.length > maxVisible) {
			const more = document.createElement('span');
			more.className = 'og-ct-more';
			more.textContent = `+${values.length - maxVisible}`;
			root.appendChild(more);
		}
	});
}
