import type { CellOption } from '../../cells/listbox.js';
import { hashCellColor, resolveCellColor, type CellColor } from '../../cells/palette.js';
import { createAvatar, type PersonOption } from '../../cells/renderers.js';
import { openCellPopover, type CellPopover } from '../../cells/popover.js';
import { icon, type WorkspaceIconName } from './icons.js';

/** A small element factory: `h('div', 'og-ws-x', { title: 'y' }, child, 'text')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string | null,
	attrs?: Record<string, string | number | boolean | undefined> | null,
	...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (attrs)
		for (const [name, value] of Object.entries(attrs)) {
			if (value === undefined || value === false) continue;
			element.setAttribute(name, value === true ? '' : String(value));
		}
	for (const child of children) if (child != null && child !== false) element.append(child);
	return element;
}

/** A CSS colour for an option colour name, else a stable colour from its text. */
export function hue(color: CellColor | undefined, fallbackText?: string): string {
	return resolveCellColor(color) ?? (fallbackText ? hashCellColor(fallbackText) : 'var(--og-focus-ring)');
}

/** An icon button (or labelled button). */
export function button(
	options: { icon?: WorkspaceIconName; label?: string; title?: string; className?: string; pressed?: boolean; badge?: string | number },
	onClick?: (event: MouseEvent) => void
): HTMLButtonElement {
	const el = h('button', `og-ws-btn${options.className ? ` ${options.className}` : ''}${options.label ? '' : ' og-ws-btn-icon'}`, {
		type: 'button',
		title: options.title ?? options.label,
		'aria-label': options.title ?? options.label,
		'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed),
	});
	if (options.icon) el.append(icon(options.icon));
	if (options.label) el.append(h('span', 'og-ws-btn-label', null, options.label));
	if (options.badge !== undefined && options.badge !== '' && options.badge !== 0) el.append(h('span', 'og-ws-badge', null, String(options.badge)));
	if (onClick) el.addEventListener('click', onClick);
	return el;
}

/** An option as a tinted pill with its dot (status, priority, team). */
export function pill(option: CellOption | undefined, value: string, variant: 'soft' | 'dot' | 'outline' = 'soft'): HTMLElement {
	const colour = hue(option?.color, value);
	const el = h('span', `og-ws-pill og-ws-pill-${variant}`, { title: option?.label ?? value });
	el.style.setProperty('--og-ws-hue', colour);
	el.append(h('span', 'og-ws-dot'), option?.label ?? value);
	return el;
}

export function avatar(person: PersonOption | undefined, value: string, size: 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
	const el = createAvatar(person, value);
	el.classList.add('og-ws-avatar', `og-ws-avatar-${size}`);
	return el;
}

/** Stacked avatars with “+N”. */
export function avatarStack(people: { person?: PersonOption; value: string }[], max = 3): HTMLElement {
	const stack = h('span', 'og-ws-avatars');
	for (const { person, value } of people.slice(0, max)) stack.append(avatar(person, value));
	if (people.length > max) stack.append(h('span', 'og-ws-avatar og-ws-avatar-sm og-ws-avatar-more', null, `+${people.length - max}`));
	return stack;
}

/** A thin completion bar, optionally with its percentage. */
export function progressBar(value: number | null, options: { label?: boolean; tone?: string } = {}): HTMLElement {
	const fraction = Math.max(0, Math.min(1, value ?? 0));
	const bar = h('span', 'og-ws-progress', {
		role: 'progressbar',
		'aria-valuemin': 0,
		'aria-valuemax': 100,
		'aria-valuenow': Math.round(fraction * 100),
	});
	const fill = h('span', 'og-ws-progress-fill');
	fill.style.width = `${fraction * 100}%`;
	if (options.tone) fill.style.background = options.tone;
	bar.append(h('span', 'og-ws-progress-track', null, fill));
	if (options.label) bar.append(h('span', 'og-ws-progress-label', null, `${Math.round(fraction * 100)}%`));
	return bar;
}

/** An icon with a count (comments, files, links); nothing for zero. */
export function counter(name: WorkspaceIconName, count: number | undefined, title: string): HTMLElement | null {
	if (!count) return null;
	const el = h('span', 'og-ws-counter', { title: `${count} ${title}` });
	el.append(icon(name, 14), String(count));
	return el;
}

const compact = new Map<string, Intl.NumberFormat>();
/** Money and large numbers kept short: US$28,200 / 1.2M. */
export function formatNumber(value: number | null, options: { currency?: string; compact?: boolean; decimals?: number } = {}): string {
	if (value == null) return '';
	const key = `${options.currency ?? ''}|${options.compact ? 1 : 0}|${options.decimals ?? ''}`;
	let format = compact.get(key);
	if (!format) {
		format = new Intl.NumberFormat(undefined, {
			style: options.currency ? 'currency' : 'decimal',
			currency: options.currency,
			notation: options.compact ? 'compact' : 'standard',
			maximumFractionDigits: options.decimals ?? (options.compact ? 1 : 0),
		});
		compact.set(key, format);
	}
	return format.format(value);
}

export interface MenuItem {
	label: string;
	icon?: WorkspaceIconName;
	hint?: string;
	checked?: boolean;
	disabled?: boolean;
	danger?: boolean;
	/** A heading row (no action). */
	heading?: boolean;
	run?: () => void;
}

/** A keyboard-navigable menu in a popover; returns the popover so callers can close it. */
export function openMenu(anchor: HTMLElement, items: readonly (MenuItem | 'separator')[], label = 'Menu'): CellPopover {
	const list = h('div', 'og-ws-menu', { role: 'menu', 'aria-label': label });
	let popover: CellPopover | null = null;
	const buttons: HTMLButtonElement[] = [];
	for (const item of items) {
		if (item === 'separator') {
			list.append(h('div', 'og-ws-menu-sep', { role: 'separator' }));
			continue;
		}
		if (item.heading) {
			list.append(h('div', 'og-ws-menu-heading', null, item.label));
			continue;
		}
		const el = h('button', `og-ws-menu-item${item.danger ? ' og-ws-danger' : ''}`, {
			type: 'button',
			role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
			'aria-checked': item.checked === undefined ? undefined : String(item.checked),
			disabled: item.disabled,
		});
		el.append(item.icon ? icon(item.icon) : h('span', 'og-ws-icon'), h('span', 'og-ws-menu-label', null, item.label));
		if (item.checked) el.append(icon('check', 14));
		else if (item.hint) el.append(h('kbd', 'og-ws-kbd', null, item.hint));
		el.addEventListener('click', () => {
			popover?.close();
			item.run?.();
		});
		buttons.push(el);
		list.append(el);
	}
	list.addEventListener('keydown', (event) => {
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			for (let i = 1; i <= buttons.length; i++) {
				const next = buttons[(index + step * i + buttons.length * 2) % buttons.length];
				if (!next.disabled) {
					next.focus();
					break;
				}
			}
		}
	});
	popover = openCellPopover({ anchor, content: list, label, className: 'og-ws-popover', onDismiss: () => anchor.focus?.() });
	buttons.find((b) => !b.disabled)?.focus();
	return popover;
}

/** A popover holding arbitrary content (field lists, settings). */
export function openPanel(anchor: HTMLElement, content: HTMLElement, label: string, onClose?: () => void): CellPopover {
	return openCellPopover({ anchor, content, label, className: 'og-ws-popover og-ws-popover-panel', onDismiss: () => onClose?.() });
}

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const longDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function formatDay(date: Date, withYear = false): string {
	return (withYear ? longDayFormat : dayFormat).format(date);
}

/** Toggles a class for one animation cycle (drop landed, record changed). */
export function pulse(element: HTMLElement, className = 'og-ws-pulse'): void {
	element.classList.remove(className);
	void element.offsetWidth;
	element.classList.add(className);
	element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
}

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
