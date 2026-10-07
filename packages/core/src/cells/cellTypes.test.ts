// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef, DomCellEditor, DomCellRenderer } from '../columnDef.js';
import {
	BUILTIN_COLUMN_TYPES,
	currencyColumnType,
	multiSelectColumnType,
	resolveColumnTypes,
	selectColumnType,
	tagsColumnType,
} from './cellTypes.js';
import { createDateEditor, createMultiSelectEditor, createNumberEditor, createSelectEditor } from './editors.js';
import { parseCellDate, toggleCheckedValue } from './format.js';
import { createCheckboxRenderer, createLinkRenderer, createMultiSelectRenderer, createSelectRenderer } from './renderers.js';

const STATUS = [
	{ value: 'todo', label: 'To do', color: 'gray' },
	{ value: 'done', label: 'Done', color: 'green' },
	{ value: 'late', label: 'Late', color: 'red', group: 'Problems' },
];

function fakeApi() {
	return { selectCell: vi.fn(), setCellValue: vi.fn() };
}

function mountRenderer(renderer: DomCellRenderer<any>, value: unknown, api = fakeApi()) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const params = (v: unknown) =>
		({
			container,
			value: v,
			node: { id: 'r1', data: {} },
			col: { field: 'f', header: 'F' },
			api,
			isEditing: false,
			isScrolling: false,
			phase: 'live',
			isFocused: false,
			isSelected: false,
		}) as any;
	const handle = renderer.mount(container, params(value));
	return { container, api, update: (v: unknown) => handle.update(params(v)) };
}

function mountEditor(editor: DomCellEditor<any>, value: unknown) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const onCommit = vi.fn();
	const onCancel = vi.fn();
	const onChange = vi.fn();
	const handle = editor.mount(container, {
		rowId: 'r1',
		colField: 'f',
		value,
		onChange,
		onCommit,
		onCancel,
		api: {} as any,
		col: { field: 'f', header: 'Status' },
	});
	const popover = document.querySelector<HTMLElement>('.og-ct-popover');
	return { container, onCommit, onCancel, onChange, handle, popover };
}

function key(target: Element, k: string) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

afterEach(() => {
	document.body.textContent = '';
});

describe('value helpers', () => {
	it('reads a bare ISO day as a local calendar day', () => {
		const date = parseCellDate('2026-03-04')!;
		expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 2, 4, 0]);
	});

	it('toggles a checkbox value in the shape it had', () => {
		expect(toggleCheckedValue(true)).toBe(false);
		expect(toggleCheckedValue('false')).toBe('true');
		expect(toggleCheckedValue(1)).toBe(0);
		expect(toggleCheckedValue(undefined)).toBe(true);
	});
});

describe('renderers', () => {
	it('select: a hued badge per option, a plain one for an unknown value, nothing for empty', () => {
		const { container, update } = mountRenderer(createSelectRenderer(STATUS), 'done');
		const badge = container.querySelector<HTMLElement>('.og-ct-badge')!;
		expect(badge.textContent).toBe('Done');
		expect(badge.hasAttribute('data-hued')).toBe(true);
		expect(badge.style.getPropertyValue('--og-ct-hue')).toBe('#22c55e');
		update('archived');
		expect(container.querySelector('.og-ct-badge')!.textContent).toBe('archived');
		expect(container.querySelector('.og-ct-badge')!.hasAttribute('data-hued')).toBe(false);
		update(null);
		expect(container.querySelector('.og-ct-badge')).toBeNull();
	});

	it('multi-select: chips up to maxVisible, then +N with the rest in its title', () => {
		const { container } = mountRenderer(createMultiSelectRenderer(STATUS, { maxVisible: 2 }), 'todo,done,late,extra');
		expect([...container.querySelectorAll('.og-ct-badge')].map((el) => el.textContent)).toEqual(['To do', 'Done']);
		const more = container.querySelector<HTMLElement>('.og-ct-more')!;
		expect(more.textContent).toBe('+2');
		expect(more.title).toBe('Late, extra');
	});

	it('checkbox: a press selects the cell and writes the toggled value', () => {
		const { container, api } = mountRenderer(createCheckboxRenderer(), 'true');
		const host = container.querySelector<HTMLElement>('[role=checkbox]')!;
		expect(host.getAttribute('aria-checked')).toBe('true');
		host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
		expect(api.selectCell).toHaveBeenCalledWith({ rowId: 'r1', colField: 'f' }, 'pointer');
		expect(api.setCellValue).toHaveBeenCalledWith('r1', 'f', 'false');
	});

	it('link: web links get https, script URLs never become an href', () => {
		const { container, update } = mountRenderer(createLinkRenderer(), 'example.com/docs/');
		const link = container.querySelector('a')!;
		expect(link.getAttribute('href')).toBe('https://example.com/docs/');
		expect(link.textContent).toBe('example.com/docs');
		update('javascript:alert(1)');
		expect(link.hasAttribute('href')).toBe(false);
	});

	it('number: currency through Intl, right-aligned', () => {
		const type = currencyColumnType({ currency: 'USD', locale: 'en-US' });
		const renderer = (type.renderer as { renderer: DomCellRenderer<any> }).renderer;
		const { container } = mountRenderer(renderer, 1234.5);
		expect(container.querySelector('.og-ct-number')!.textContent).toBe('$1,234.50');
		expect(container.querySelector('.og-ct-cell-end')).not.toBeNull();
		expect(type.valueFormatter!({ value: -3, rowData: {}, colDef: { field: 'f', header: 'F' }, rowId: 'r' })).toBe('-$3.00');
	});
});

describe('editors', () => {
	it('select: opens its list at once; Enter commits, Escape cancels', () => {
		const first = mountEditor(createSelectEditor(STATUS), 'todo');
		expect(first.popover).not.toBeNull();
		expect(first.popover!.querySelector('.og-ct-group')!.textContent).toBe('Problems');
		const list = first.popover!.querySelector('[role=listbox]')!;
		expect(document.activeElement).toBe(list);
		key(list, 'ArrowDown');
		key(list, 'Enter');
		expect(first.onCommit).toHaveBeenCalledWith('done');
		first.handle.destroy?.();
		expect(document.querySelector('.og-ct-popover')).toBeNull();

		const second = mountEditor(createSelectEditor(STATUS), 'todo');
		key(second.popover!.querySelector('[role=listbox]')!, 'Escape');
		expect(second.onCancel).toHaveBeenCalled();
		expect(second.onCommit).not.toHaveBeenCalled();
	});

	it('multi-select: toggles keep the list open; clicking away commits in the value shape', () => {
		const { popover, onChange, onCommit, container } = mountEditor(createMultiSelectEditor(STATUS), ['todo']);
		const list = popover!.querySelector('[role=listbox]')!;
		key(list, 'ArrowDown');
		key(list, 'Enter');
		expect(onChange).toHaveBeenLastCalledWith(['todo', 'done']);
		expect([...container.querySelectorAll('.og-ct-badge')].map((el) => el.textContent)).toEqual(['To do', 'Done']);
		document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		expect(onCommit).toHaveBeenCalledWith(['todo', 'done']);
	});

	it('tags: unknown text is created and selected', () => {
		const editor = (tagsColumnType(['alpha']).cellEditor as { editor: DomCellEditor<any> }).editor;
		const { popover, onChange } = mountEditor(editor, 'alpha');
		const input = popover!.querySelector('input')!;
		input.value = 'beta';
		input.dispatchEvent(new Event('input'));
		key(input, 'Enter');
		expect(onChange).toHaveBeenLastCalledWith('alpha,beta');
		expect([...popover!.querySelectorAll('.og-ct-option-label')].map((el) => el.textContent)).toEqual(['alpha', 'beta']);
	});

	it('date: typed ISO day commits on Enter; a calendar day commits on click', () => {
		const typed = mountEditor(createDateEditor(), '2026-03-04');
		const input = typed.container.querySelector('input')!;
		expect(input.value).toBe('2026-03-04');
		input.value = '2026-05-01';
		input.dispatchEvent(new Event('input'));
		expect(typed.popover!.querySelector('[aria-selected=true]')!.textContent).toBe('1');
		key(input, 'Enter');
		expect(typed.onCommit).toHaveBeenCalledWith('2026-05-01');
		typed.handle.destroy?.();

		const clicked = mountEditor(createDateEditor(), '2026-03-04');
		const day = [...clicked.popover!.querySelectorAll<HTMLElement>('.og-ct-cal-day:not([data-outside])')].find((el) => el.textContent === '20')!;
		day.click();
		expect(clicked.onCommit).toHaveBeenCalledWith('2026-03-20');
	});

	it('number: the grid taking focus back to the cell does not end the edit', () => {
		const cell = document.createElement('div');
		cell.className = 'og-cell';
		cell.tabIndex = -1;
		const container = document.createElement('div');
		cell.appendChild(container);
		document.body.appendChild(cell);
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		createNumberEditor().mount(container, {
			rowId: 'r1',
			colField: 'f',
			value: 5,
			onChange: vi.fn(),
			onCommit,
			onCancel,
			api: {} as any,
			col: { field: 'f', header: 'F' },
		});
		const input = container.querySelector('input')!;
		expect(document.activeElement).toBe(input);
		// Focus passes through <body> on its way back to the cell.
		input.blur();
		cell.focus();
		expect(document.activeElement).toBe(input);
		expect(onCommit).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('number and date: Enter hands focus back to the cell', () => {
		for (const editor of [createNumberEditor(), createDateEditor()]) {
			const cell = document.createElement('div');
			cell.className = 'og-cell';
			cell.tabIndex = -1;
			const container = document.createElement('div');
			cell.appendChild(container);
			document.body.appendChild(cell);
			const handle = editor.mount(container, {
				rowId: 'r1',
				colField: 'f',
				value: '2026-03-04',
				onChange: vi.fn(),
				onCommit: vi.fn(),
				onCancel: vi.fn(),
				api: {} as any,
				col: { field: 'f', header: 'F' },
			});
			const input = container.querySelector('input')!;
			expect(document.activeElement).toBe(input);
			key(input, 'Enter');
			expect(document.activeElement).toBe(cell);
			handle.destroy?.();
			cell.remove();
		}
	});

	it('number: arrows step within bounds, Enter commits a number', () => {
		const { container, onCommit, onChange } = mountEditor(createNumberEditor({ min: 0, max: 10, step: 5 }), 8);
		const input = container.querySelector('input')!;
		key(input, 'ArrowUp');
		expect(input.value).toBe('10');
		expect(onChange).toHaveBeenLastCalledWith(10);
		input.value = '-4';
		key(input, 'Enter');
		expect(onCommit).toHaveBeenCalledWith(0);
	});
});

describe('column types', () => {
	it('fill in what a column does not set, by name or registered type', () => {
		const columns: ColumnDef<any>[] = [
			{ field: 'a', header: 'A', type: 'currency' },
			{ field: 'b', header: 'B', type: 'status', valueFormatter: () => 'own' },
			{ field: 'c', header: 'C', type: 'missing' },
		];
		const [a, b, c] = resolveColumnTypes(columns, { status: selectColumnType(STATUS) });
		expect(a.renderer).toBe(BUILTIN_COLUMN_TYPES.currency.renderer);
		expect(b.renderer?.kind).toBe('dom');
		expect(b.valueFormatter!({} as any)).toBe('own');
		expect(b.filterDef?.type).toBe('select');
		expect(c).toBe(columns[2]);
		expect(multiSelectColumnType(STATUS).valueFormatter!({ value: ['todo', 'x'] } as any)).toBe('To do, x');
	});
});
