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

function cell(container: HTMLElement, align?: 'end' | 'center'): HTMLDivElement {
	const root = document.createElement('div');
	root.className = align ? `og-ct-cell og-ct-cell-${align}` : 'og-ct-cell';
	container.appendChild(root);
	return root;
}

function setHue(el: HTMLElement, color: string | undefined) {
	if (color) {
		el.style.setProperty('--og-ct-hue', color);
		el.setAttribute('data-hued', '');
	} else {
		el.style.removeProperty('--og-ct-hue');
		el.removeAttribute('data-hued');
	}
}

/** Writes a value through the grid (selecting the cell first, as a click on it would). */
function writeValue(params: Params, value: unknown) {
	const rowId = params.node.id;
	const colField = params.col.field;
	params.api.selectCell({ rowId, colField }, 'pointer');
	params.api.setCellValue(rowId, colField, value);
}

/** A renderer that redraws from the value alone, skipping updates whose value did not change. */
function valueRenderer(
	build: (root: HTMLElement, params: Params) => (value: unknown, params: Params) => void,
	align?: 'end' | 'center'
): DomCellRenderer<any> {
	return {
		mount(container, params) {
			const root = cell(container, align);
			const draw = build(root, params);
			let last: unknown = {};
			const update = (p: Params) => {
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

/** A checkbox that toggles on press, writing back in the value's own shape (boolean, 'true', 1). */
export function createCheckboxRenderer(): DomCellRenderer<any> {
	return {
		mount(container, params) {
			const root = cell(container, 'center');
			root.classList.add('og-ct-checkbox-host');
			root.setAttribute('role', 'checkbox');
			const box = document.createElement('span');
			box.className = 'og-ct-checkbox';
			box.innerHTML = cellIconSvg('check', 12);
			root.appendChild(box);
			let current = params;
			let checked: boolean | null = null;
			const update = (p: Params) => {
				current = p;
				const next = isCheckedCellValue(p.value);
				if (next === checked) return;
				checked = next;
				root.setAttribute('aria-checked', String(next));
				if (next) box.setAttribute('data-checked', '');
				else box.removeAttribute('data-checked');
			};
			const onMouseDown = (event: MouseEvent) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				event.preventDefault();
				writeValue(current, toggleCheckedValue(current.value));
			};
			root.addEventListener('mousedown', onMouseDown);
			update(params);
			return { update, destroy: () => root.removeEventListener('mousedown', onMouseDown) };
		},
	};
}

// ─── Options: select, multi-select, combobox ─────────────────────────────────

export type BadgeVariant = 'soft' | 'dot' | 'outline' | 'plain';

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
	setup?: (root: HTMLElement) => void
): DomCellRenderer<any> {
	return valueRenderer((root) => {
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
	});
}

function singleKey(value: unknown): string[] {
	return value == null || value === '' ? [] : [String(value)];
}

/** A badge for an option (or an unknown value: a neutral badge, or hashed colour with `autoColor`). */
export function createOptionBadge(option: CellOption | undefined, value: string, variant: BadgeVariant, autoColor = false): HTMLElement {
	const label = option ? optionLabel(option) : value;
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

export interface MultiSelectRendererOptions {
	variant?: BadgeVariant;
	/** Chips shown before “+N”. Default: as many as the column fits. */
	maxVisible?: number;
	/** Colour values with no option from the palette (free tags). Default true. */
	autoColor?: boolean;
}

export function createMultiSelectRenderer(options: CellOptionsInput, config: MultiSelectRendererOptions = {}): DomCellRenderer<any> {
	const store = toOptionsStore(options);
	const variant = config.variant ?? 'soft';
	const autoColor = config.autoColor ?? true;
	const maxVisible = config.maxVisible ?? 3;
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
		(root) => root.classList.add('og-ct-chips')
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
