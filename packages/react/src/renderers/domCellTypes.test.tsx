import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DomCellRenderer, DomCellRendererParams } from '../types.js';
import { CheckboxCellRenderer, DateCellRenderer, createNumberCellRenderer } from './CellTypes.js';
import { CheckboxDomCellRenderer, DateDomCellRenderer, createNumberDomCellRenderer } from './domCellTypes.js';

function params(value: unknown, api: Record<string, unknown> = {}): DomCellRendererParams<any> {
	return {
		container: document.createElement('div'),
		value,
		node: { id: 'r1', data: {} },
		col: { field: 'flag' },
		isEditing: false,
		isScrolling: false,
		phase: 'idle',
		isFocused: false,
		isSelected: false,
		api: api as unknown as DomCellRendererParams<any>['api'],
	} as DomCellRendererParams<any>;
}

function mountDom(renderer: DomCellRenderer<any>, value: unknown, api?: Record<string, unknown>) {
	const container = document.createElement('div');
	const handle = renderer.mount(container, params(value, api));
	return { container, handle, update: (next: unknown) => handle.update({ ...params(next, api), container }) };
}

function reactMarkup(element: React.ReactElement): HTMLElement {
	const container = document.createElement('div');
	container.innerHTML = renderToStaticMarkup(element);
	return container;
}

/** Walks both trees: same tags, same attributes, same inline style properties, same text. */
function expectSameMarkup(dom: Element, react: Element, path = 'root'): void {
	expect(dom.tagName.toLowerCase(), path).toBe(react.tagName.toLowerCase());
	const attrs = (el: Element) =>
		Object.fromEntries(
			Array.from(el.attributes)
				.filter((a) => a.name !== 'style')
				.map((a) => [a.name, a.value])
		);
	expect(attrs(dom), `${path} attributes`).toEqual(attrs(react));
	// Compare declarations, each normalised on its own: jsdom expands a `style.background = ...`
	// write differently from the same attribute text, and cannot parse `background: var(...)` from
	// a style attribute at all.
	const styleOf = (el: Element) => {
		const declarations: Record<string, string> = {};
		for (const declaration of (el.getAttribute('style') ?? '').split(';')) {
			const colon = declaration.indexOf(':');
			if (colon < 0) continue;
			const name = declaration.slice(0, colon).trim().toLowerCase();
			const raw = declaration.slice(colon + 1).trim();
			const scratch = document.createElement('div');
			let value = '';
			try {
				scratch.style.setProperty(name, raw);
				value = scratch.style.getPropertyValue(name);
			} catch {
				// jsdom cannot parse this value; compare the text instead
			}
			declarations[name] = value || raw.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',');
		}
		// jsdom writes out the longhands of an updated `background` next to it; they say nothing more.
		if ('background' in declarations) {
			for (const name of Object.keys(declarations)) if (name.startsWith('background-')) delete declarations[name];
		}
		return declarations;
	};
	expect(styleOf(dom), `${path} style`).toEqual(styleOf(react));
	const text = (el: Element) =>
		Array.from(el.childNodes)
			.filter((n) => n.nodeType === 3)
			.map((n) => n.textContent)
			.join('');
	expect(text(dom), `${path} text`).toBe(text(react));
	expect(dom.children.length, `${path} children`).toBe(react.children.length);
	Array.from(dom.children).forEach((child, i) => expectSameMarkup(child, react.children[i], `${path} > ${child.tagName.toLowerCase()}[${i}]`));
}

const reactProps = (value: unknown) => ({ value, rowId: 'r1', colField: 'flag', api: {} }) as any;

describe('built-in DOM cells match the React components', () => {
	it.each([[42], [1234.5], ['7'], [null], ['abc'], [-0.25]])('number %s', (value) => {
		const Number = createNumberCellRenderer();
		expectSameMarkup(mountDom(createNumberDomCellRenderer(), value).container, reactMarkup(<Number {...reactProps(value)} />));
	});

	it.each([[{ prefix: '$', decimals: 2, locale: true }], [{ suffix: ' yrs' }], [{ locale: true }]])('number with options %j', (opts) => {
		const Number = createNumberCellRenderer(opts);
		expectSameMarkup(mountDom(createNumberDomCellRenderer(opts), 1234567.891).container, reactMarkup(<Number {...reactProps(1234567.891)} />));
	});

	it.each([['2026-09-29'], [''], [null], ['29 Sep']])('date %j', (value) => {
		expectSameMarkup(mountDom(DateDomCellRenderer, value).container, reactMarkup(<DateCellRenderer {...reactProps(value)} />));
	});

	it.each([[true], [false], ['true'], [0], ['1']])('checkbox %j', (value) => {
		expectSameMarkup(mountDom(CheckboxDomCellRenderer, value).container, reactMarkup(<CheckboxCellRenderer {...reactProps(value)} />));
	});

	it('still matches after updates in both directions', () => {
		const Number = createNumberCellRenderer();
		const number = mountDom(createNumberDomCellRenderer(), 5);
		number.update(null);
		expectSameMarkup(number.container, reactMarkup(<Number {...reactProps(null)} />));
		number.update(8);
		expectSameMarkup(number.container, reactMarkup(<Number {...reactProps(8)} />));

		const date = mountDom(DateDomCellRenderer, '');
		date.update('2026-01-02');
		expectSameMarkup(date.container, reactMarkup(<DateCellRenderer {...reactProps('2026-01-02')} />));

		const checkbox = mountDom(CheckboxDomCellRenderer, false);
		checkbox.update(true);
		expectSameMarkup(checkbox.container, reactMarkup(<CheckboxCellRenderer {...reactProps(true)} />));
		checkbox.update(false);
		expectSameMarkup(checkbox.container, reactMarkup(<CheckboxCellRenderer {...reactProps(false)} />));
	});
});

describe('CheckboxDomCellRenderer interaction', () => {
	it('selects the cell and toggles the value through the api on mousedown', () => {
		const api = { selectCell: vi.fn(), setCellValue: vi.fn() };
		const { container, update } = mountDom(CheckboxDomCellRenderer, false, api);
		const target = container.querySelector('[role="checkbox"]')!;
		const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		const outer = vi.fn();
		container.addEventListener('mousedown', outer);
		target.dispatchEvent(event);
		expect(api.selectCell).toHaveBeenCalledWith({ rowId: 'r1', colField: 'flag' }, 'pointer');
		expect(api.setCellValue).toHaveBeenCalledWith('r1', 'flag', 'true');
		expect(event.defaultPrevented).toBe(true);
		expect(outer).not.toHaveBeenCalled(); // the grid's own cell mousedown must not also run

		update(true); // the grid re-renders with the new value
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		expect(api.setCellValue).toHaveBeenLastCalledWith('r1', 'flag', 'false');
	});

	it('removes its listener on destroy', () => {
		const api = { selectCell: vi.fn(), setCellValue: vi.fn() };
		const { container, handle } = mountDom(CheckboxDomCellRenderer, false, api);
		handle.destroy?.();
		container.querySelector('[role="checkbox"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		expect(api.setCellValue).not.toHaveBeenCalled();
	});
});
