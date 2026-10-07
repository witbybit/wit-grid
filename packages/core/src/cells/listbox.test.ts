// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCellListbox, type CellOption } from './listbox.js';
import { openCellPopover } from './popover.js';

const OPTIONS: CellOption[] = [
	{ value: 'todo', label: 'To do', color: 'gray' },
	{ value: 'doing', label: 'In progress', color: 'blue' },
	{ value: 'done', label: 'Done', color: 'green' },
	{ value: 'blocked', label: 'Blocked', color: 'red', disabled: true },
];

const GROUPED: CellOption[] = [
	{ value: 'ui', label: 'UI Design', group: 'Design' },
	{ value: 'ux', label: 'UX Research', group: 'Design' },
	{ value: 'fe', label: 'Frontend', group: 'Engineering' },
	{ value: 'be', label: 'Backend', group: 'Engineering' },
	{ value: 'all', label: 'Everyone' },
];

function key(target: HTMLElement, k: string, init: KeyboardEventInit = {}) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

function labels(root: HTMLElement): string[] {
	return [...root.querySelectorAll('.og-ct-option-label')].map((el) => el.textContent ?? '');
}

function activeLabel(root: HTMLElement): string | null {
	return root.querySelector('.og-ct-option[data-active] .og-ct-option-label')?.textContent ?? null;
}

afterEach(() => {
	document.body.textContent = '';
});

describe('createCellListbox', () => {
	it('starts on the selected option and picks with the keyboard, skipping disabled ones', () => {
		const onSelect = vi.fn();
		const lb = createCellListbox({ options: OPTIONS, selected: ['doing'], onSelect });
		document.body.appendChild(lb.element);
		const list = lb.element.querySelector<HTMLElement>('[role=listbox]')!;
		expect(activeLabel(lb.element)).toBe('In progress');
		expect(lb.element.querySelector('[aria-selected=true] .og-ct-option-label')?.textContent).toBe('In progress');
		key(list, 'ArrowDown');
		key(list, 'ArrowDown'); // Blocked is disabled: stays on Done
		expect(activeLabel(lb.element)).toBe('Done');
		key(list, 'Enter');
		expect(onSelect).toHaveBeenCalledWith('done');
		key(list, 'Home');
		expect(activeLabel(lb.element)).toBe('To do');
		expect(list.getAttribute('aria-activedescendant')).toBe(lb.element.querySelector('[data-active]')!.id);
	});

	it('typeahead jumps to a label when there is no search field', () => {
		const lb = createCellListbox({ options: OPTIONS, selected: [] });
		const list = lb.element.querySelector<HTMLElement>('[role=listbox]')!;
		key(list, 'd');
		expect(activeLabel(lb.element)).toBe('Done');
	});

	it('groups options under headings and filters by label and group', () => {
		const lb = createCellListbox({ options: GROUPED, selected: [], searchable: true });
		document.body.appendChild(lb.element);
		expect([...lb.element.querySelectorAll('.og-ct-group')].map((el) => el.textContent)).toEqual(['Design', 'Engineering']);
		expect(labels(lb.element)).toEqual(['Everyone', 'UI Design', 'UX Research', 'Frontend', 'Backend']);
		const input = lb.element.querySelector('input')!;
		input.value = 'engin';
		input.dispatchEvent(new Event('input'));
		expect(labels(lb.element)).toEqual(['Frontend', 'Backend']);
		expect(activeLabel(lb.element)).toBe('Frontend');
		input.value = 'zzz';
		input.dispatchEvent(new Event('input'));
		expect(lb.element.querySelector('.og-ct-list-empty')?.textContent).toBe('No results found.');
	});

	it('toggles in multiple mode and stays open', () => {
		const onChange = vi.fn();
		const lb = createCellListbox({ options: OPTIONS, selected: ['todo'], multiple: true, onChange });
		const list = lb.element.querySelector<HTMLElement>('[role=listbox]')!;
		key(list, 'ArrowDown');
		key(list, 'Enter');
		expect(onChange).toHaveBeenLastCalledWith(['todo', 'doing']);
		key(list, 'ArrowUp');
		key(list, 'Enter');
		expect(onChange).toHaveBeenLastCalledWith(['doing']);
		expect(lb.element.querySelectorAll('.og-ct-checkbox[data-checked]')).toHaveLength(1);
	});

	it('offers a none entry and Create for unknown text', () => {
		const onSelect = vi.fn();
		const onCreate = vi.fn((label: string) => label.toLowerCase());
		const lb = createCellListbox({
			options: OPTIONS,
			selected: [],
			noneLabel: 'No status',
			searchable: true,
			creatable: true,
			onSelect,
			onCreate,
		});
		expect(labels(lb.element)[0]).toBe('No status');
		expect(lb.element.querySelector('.og-ct-option[aria-selected=true] .og-ct-option-label')?.textContent).toBe('No status');
		const input = lb.element.querySelector('input')!;
		input.value = 'Review';
		input.dispatchEvent(new Event('input'));
		expect(labels(lb.element)).toEqual(['Create “Review”']);
		key(input, 'Enter');
		expect(onCreate).toHaveBeenCalledWith('Review');
		expect(onSelect).toHaveBeenCalledWith('review');
	});
});

describe('openCellPopover', () => {
	it('inherits the grid theme scope and dismisses on outside press and Escape', () => {
		const grid = document.createElement('div');
		grid.dataset.ogThemeScope = '7';
		const anchor = document.createElement('div');
		grid.appendChild(anchor);
		document.body.appendChild(grid);
		const onDismiss = vi.fn();
		const content = document.createElement('div');
		const popover = openCellPopover({ anchor, content, onDismiss });
		expect(popover.element.dataset.ogThemeScope).toBe('7');
		expect(popover.element.parentElement).toBe(document.body);

		content.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		expect(onDismiss).not.toHaveBeenCalled();

		key(content, 'Escape');
		expect(onDismiss).toHaveBeenCalledWith('escape');
		expect(popover.element.isConnected).toBe(false);

		const second = openCellPopover({ anchor, content: document.createElement('div'), onDismiss });
		document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		expect(onDismiss).toHaveBeenLastCalledWith('outside');
		expect(second.element.isConnected).toBe(false);
	});
});
