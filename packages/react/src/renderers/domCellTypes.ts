/**
 * Built-in number, date and checkbox cells as DOM renderers.
 *
 * Same markup and styles as the React components in CellTypes.tsx, without React: the grid calls
 * mount() once per cell and update() when the value changes, so these cells need no portal, no
 * reconciler pass and no scroll-time freeze. They are what the built-in `number`, `date` and
 * `checkbox` column types use.
 */

import type { DomCellRenderer, DomCellRendererParams } from '../types.js';
import { T } from './cellTypeTokens.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(attrs: Record<string, string>, children: Array<[string, Record<string, string>]>): SVGSVGElement {
	const root = document.createElementNS(SVG_NS, 'svg');
	for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value);
	for (const [tag, childAttrs] of children) {
		const child = document.createElementNS(SVG_NS, tag);
		for (const [name, value] of Object.entries(childAttrs)) child.setAttribute(name, value);
		root.appendChild(child);
	}
	return root;
}

// Built once, cloned per cell: cloneNode is cheaper than rebuilding the SVG tree.
let checkTemplate: SVGSVGElement | null = null;
let calendarTemplate: SVGSVGElement | null = null;

function checkIcon(): SVGSVGElement {
	checkTemplate ??= svg({ width: '10', height: '10', viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' }, [
		['path', { d: 'M2 6L5 9L10 3', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
	]);
	return checkTemplate.cloneNode(true) as SVGSVGElement;
}

function calendarIcon(): SVGSVGElement {
	calendarTemplate ??= svg(
		{
			width: '12',
			height: '12',
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			'stroke-width': '2',
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
			'aria-hidden': 'true',
		},
		[
			['rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }],
			['line', { x1: '16', y1: '2', x2: '16', y2: '6' }],
			['line', { x1: '8', y1: '2', x2: '8', y2: '6' }],
			['line', { x1: '3', y1: '10', x2: '21', y2: '10' }],
		]
	);
	return calendarTemplate.cloneNode(true) as SVGSVGElement;
}

// ─── Number ───────────────────────────────────────────────────────────────────

export interface NumberCellRendererOptions {
	/** String prepended before the number (e.g. `'$'`). */
	prefix?: string;
	/** String appended after the number (e.g. `' yrs'`). */
	suffix?: string;
	/** Fixed decimal places. Omit to use the raw string value. */
	decimals?: number;
	/** Use `toLocaleString` formatting (thousands separator etc). */
	locale?: boolean;
}

/** Display text for a number cell, or null when the value is not a number (shown as a dash). */
export function formatNumberCell(value: unknown, opts: NumberCellRendererOptions = {}): string | null {
	const { prefix = '', suffix = '', decimals, locale = false } = opts;
	const num = parseFloat(String(value));
	if (isNaN(num)) return null;
	let formatted: string;
	if (decimals !== undefined) {
		formatted = locale ? num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : num.toFixed(decimals);
	} else {
		formatted = locale ? num.toLocaleString() : String(num);
	}
	return `${prefix}${formatted}${suffix}`;
}

const NUMBER_STYLE = `font-family: ui-monospace, monospace; font-size: 11px; color: ${T.text}; letter-spacing: 0.02em;`;
const NUMBER_EMPTY_STYLE = `color: ${T.textMuted}; font-size: 11px; font-style: italic;`;

/** DOM number cell. Same options as createNumberCellRenderer. */
export function createNumberDomCellRenderer(opts: NumberCellRendererOptions = {}): DomCellRenderer<any> {
	return {
		mount(container, params) {
			const span = document.createElement('span');
			container.appendChild(span);
			let empty: boolean | null = null;
			let text: string | null = null;
			const render = (value: unknown) => {
				const display = formatNumberCell(value, opts);
				const isEmpty = display === null;
				if (isEmpty !== empty) {
					span.style.cssText = isEmpty ? NUMBER_EMPTY_STYLE : NUMBER_STYLE;
					empty = isEmpty;
				}
				const next = display ?? '—';
				if (next !== text) {
					span.textContent = next;
					text = next;
				}
			};
			render(params.value);
			return { update: (p) => render(p.value) };
		},
	};
}

// ─── Date ─────────────────────────────────────────────────────────────────────

/** Display text for a date cell: YYYY-MM-DD becomes DD/MM/YYYY; empty values become a dash. */
export function formatDateCell(value: unknown): { display: string; isEmpty: boolean } {
	const raw = String(value ?? '');
	const isEmpty = !raw || raw === 'undefined' || raw === 'null';
	if (isEmpty) return { display: '—', isEmpty };
	const parts = raw.split('-');
	return { display: parts.length === 3 && parts[0].length === 4 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw, isEmpty };
}

/** DOM date cell: calendar icon plus DD/MM/YYYY. */
export const DateDomCellRenderer: DomCellRenderer<any> = {
	mount(container, params) {
		const root = document.createElement('div');
		root.style.cssText = 'display: flex; align-items: center; gap: 6px; height: 100%;';
		const icon = document.createElement('span');
		icon.style.cssText = `color: ${T.textMuted}; flex-shrink: 0; display: flex;`;
		icon.appendChild(calendarIcon());
		const label = document.createElement('span');
		label.style.cssText = 'font-size: 11px; font-family: ui-monospace, monospace; letter-spacing: 0.02em;';
		root.append(icon, label);
		container.appendChild(root);
		let empty: boolean | null = null;
		let text: string | null = null;
		const render = (value: unknown) => {
			const { display, isEmpty } = formatDateCell(value);
			if (isEmpty !== empty) {
				root.style.color = isEmpty ? T.textMuted : T.text;
				empty = isEmpty;
			}
			if (display !== text) {
				label.textContent = display;
				text = display;
			}
		};
		render(params.value);
		return { update: (p) => render(p.value) };
	},
};

// ─── Checkbox ─────────────────────────────────────────────────────────────────

export function isCheckedCellValue(value: unknown): boolean {
	return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * DOM checkbox cell. A mousedown selects the cell and toggles the value through the grid api,
 * exactly like CheckboxCellRenderer; the grid then calls update() with the new value.
 */
export const CheckboxDomCellRenderer: DomCellRenderer<any> = {
	mount(container, params) {
		const root = document.createElement('div');
		root.setAttribute('role', 'checkbox');
		root.tabIndex = -1;
		root.style.cssText =
			'display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; cursor: pointer; user-select: none;';
		const box = document.createElement('div');
		box.style.cssText =
			'width: 15px; height: 15px; border-radius: 3px; display: flex; align-items: center; justify-content: center; ' +
			'transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; flex-shrink: 0; color: #fff;';
		root.appendChild(box);
		container.appendChild(root);

		let current: DomCellRendererParams<any> = params;
		let checked: boolean | null = null;
		let icon: SVGSVGElement | null = null;
		const render = (value: unknown) => {
			const next = isCheckedCellValue(value);
			if (next === checked) return;
			checked = next;
			root.setAttribute('aria-checked', String(next));
			box.style.border = `2px solid ${next ? T.accent : T.borderHover}`;
			box.style.background = next ? T.accent : 'transparent';
			box.style.boxShadow = next ? `0 0 0 3px ${T.accentBg}` : 'none';
			if (next) box.appendChild((icon ??= checkIcon()));
			else icon?.remove();
		};
		const onMouseDown = (event: MouseEvent) => {
			event.stopPropagation();
			event.preventDefault();
			const rowId = current.node.id;
			const colField = current.col.field;
			current.api.selectCell({ rowId, colField }, 'pointer');
			current.api.setCellValue(rowId, colField, String(!isCheckedCellValue(current.value)));
		};
		root.addEventListener('mousedown', onMouseDown);
		render(params.value);
		return {
			update(p) {
				current = p;
				render(p.value);
			},
			destroy() {
				root.removeEventListener('mousedown', onMouseDown);
			},
		};
	},
};
