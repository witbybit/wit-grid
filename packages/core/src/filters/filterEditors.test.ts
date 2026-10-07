// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnFilter } from '../filterModel.js';
import type { ColumnFilterDef, DomFilterEditorParams } from './filterDef.js';
import { createFilterEditor } from './filterEditors.js';

function mount(def: ColumnFilterDef, filter: ColumnFilter | null = null, extra: Partial<DomFilterEditorParams> = {}) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const onChange = vi.fn();
	const onClose = vi.fn();
	const handle = createFilterEditor(def, 'popover').mount(container, {
		colField: 'f',
		filterDef: def,
		filter,
		surface: 'popover',
		onChange,
		onClose,
		...extra,
	});
	return { container, onChange, onClose, handle };
}

function clickText(root: ParentNode, text: string) {
	const target = [...root.querySelectorAll<HTMLElement>('button, .og-ct-option')].find(
		(el) => el.textContent?.trim() === text || el.querySelector('.og-ct-option-label')?.textContent === text
	);
	if (!target) throw new Error(`no "${text}"`);
	target.click();
}

afterEach(() => {
	document.body.textContent = '';
});

describe('filter editors', () => {
	it('boolean: All / Yes / No', () => {
		const { container, onChange } = mount({ type: 'boolean' });
		clickText(container, 'Yes');
		expect(onChange).toHaveBeenLastCalledWith({ type: 'boolean', value: true });
		clickText(container, 'All');
		expect(onChange).toHaveBeenLastCalledWith(null);
	});

	it('stars: at least N, clicking the current one clears', () => {
		const { container, onChange } = mount({ type: 'number', stars: 5 }, { type: 'number', operator: 'gte', value: 3 });
		expect(container.querySelectorAll('.og-flt-star[data-on]')).toHaveLength(3);
		container.querySelectorAll<HTMLElement>('.og-flt-star')[3].click();
		expect(onChange).toHaveBeenLastCalledWith({ type: 'number', operator: 'gte', value: 4 });
		container.querySelectorAll<HTMLElement>('.og-flt-star')[2].click();
		expect(onChange).toHaveBeenLastCalledWith(null);
	});

	it('list cells: counts, Any / All / None, Select all and Clear', () => {
		const { container, onChange } = mount(
			{
				type: 'select',
				listValues: true,
				options: [
					{ value: 'bug', label: 'Bug' },
					{ value: 'docs', label: 'Docs' },
				],
			},
			null,
			{ distinctValues: () => ({ values: [null, 'bug', 'docs'], counts: [2, 5, 1] }) }
		);
		expect([...container.querySelectorAll('.og-ct-option-count')].map((el) => el.textContent)).toEqual(['2', '5', '1']);
		clickText(container, 'Bug');
		expect(onChange).toHaveBeenLastCalledWith({ type: 'select', values: ['bug'], labels: ['Bug'] });
		clickText(container, 'None of');
		expect(onChange).toHaveBeenLastCalledWith({ type: 'select', values: ['bug'], labels: ['Bug'], matchMode: 'none' });
		clickText(container, 'Select all');
		expect(onChange).toHaveBeenLastCalledWith({
			type: 'select',
			values: ['bug', null, 'docs'],
			labels: ['Bug', '(Blanks)', 'Docs'],
			matchMode: 'none',
		});
		clickText(container, 'Clear');
		expect(onChange).toHaveBeenLastCalledWith(null);
	});

	it('text: a second condition joined by Or', () => {
		const { container, onChange } = mount({ type: 'text' });
		const first = container.querySelector<HTMLInputElement>('.og-flt-input')!;
		first.value = 'a';
		clickText(container, '+ Add condition');
		clickText(container, 'Or');
		const second = container.querySelectorAll<HTMLInputElement>('.og-flt-input')[1];
		second.value = 'b';
		second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(onChange).toHaveBeenLastCalledWith({
			type: 'compound',
			operator: 'OR',
			conditions: [
				{ type: 'text', operator: 'contains', value: 'a' },
				{ type: 'text', operator: 'contains', value: 'b' },
			],
		});
	});

	it('date range: overlaps between two typed dates', () => {
		const { container, onChange } = mount({ type: 'dateRange' });
		const [from, to] = container.querySelectorAll<HTMLInputElement>('.og-flt-input');
		from.value = '2026-03-01';
		to.value = '2026-03-31';
		to.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(onChange).toHaveBeenLastCalledWith({ type: 'dateRange', operator: 'overlaps', dateFrom: '2026-03-01', dateTo: '2026-03-31' });
	});

	it('typed values apply after a pause: date range, text', () => {
		vi.useFakeTimers();
		try {
			const range = mount({ type: 'dateRange' });
			const [from, to] = range.container.querySelectorAll<HTMLInputElement>('.og-flt-input');
			for (const [input, value] of [
				[from, '2026-03-01'],
				[to, '2026-03-31'],
			] as const) {
				input.value = value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}
			expect(range.onChange).not.toHaveBeenCalled();
			vi.advanceTimersByTime(400);
			expect(range.onChange).toHaveBeenLastCalledWith({ type: 'dateRange', operator: 'overlaps', dateFrom: '2026-03-01', dateTo: '2026-03-31' });
			expect(range.onClose).not.toHaveBeenCalled();

			const text = mount({ type: 'text' });
			const input = text.container.querySelector<HTMLInputElement>('.og-flt-input')!;
			input.value = 'mig';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			vi.advanceTimersByTime(400);
			expect(text.onChange).toHaveBeenLastCalledWith({ type: 'text', operator: 'contains', value: 'mig' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('percent numbers are typed as shown: 25 filters 0.25', () => {
		const { container, onChange } = mount({ type: 'number', format: { format: 'percent' } }, { type: 'number', operator: 'equals', value: 0.29 });
		const input = container.querySelector<HTMLInputElement>('.og-flt-input')!;
		expect(input.value).toBe('29');
		input.value = '25';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(onChange).toHaveBeenLastCalledWith({ type: 'number', operator: 'equals', value: 0.25 });
	});

	it('path: a tree checklist where a parent covers its children', () => {
		const def: ColumnFilterDef = {
			type: 'path',
			cascade: {
				options: [
					{
						value: 'in',
						label: 'India',
						children: [
							{ value: 'ka', label: 'Karnataka' },
							{ value: 'mh', label: 'Maharashtra' },
						],
					},
				],
			},
		};
		const { container, onChange } = mount(def);
		container.querySelector<HTMLElement>('.og-flt-caret')!.click();
		clickText(container, 'Karnataka');
		expect(onChange).toHaveBeenLastCalledWith({ type: 'path', paths: [['in', 'ka']], labels: ['India › Karnataka'] });
		clickText(container, 'India');
		expect(onChange).toHaveBeenLastCalledWith({ type: 'path', paths: [['in']], labels: ['India'] });
		// Children of a chosen node show as covered.
		const rows = [...container.querySelectorAll('.og-flt-tree-row')];
		expect(rows[1].getAttribute('aria-disabled')).toBe('true');
		expect(rows[1].querySelector('[data-checked]')).not.toBeNull();
	});

	it('custom: a DOM editor, or an adapter component through the host bridge', () => {
		const editor = { mount: vi.fn((container: HTMLElement) => ((container.textContent = 'mine'), {})) };
		mount({ type: 'custom', editor });
		expect(editor.mount).toHaveBeenCalled();
		const unmount = vi.fn();
		const bridge = vi.fn(() => unmount);
		const render = () => 'component';
		const container = document.createElement('div');
		const handle = createFilterEditor({ type: 'custom', renderFilter: render }, 'sidebar', bridge).mount(container, {
			colField: 'f',
			filterDef: { type: 'custom', renderFilter: render },
			filter: null,
			surface: 'sidebar',
			onChange: vi.fn(),
		});
		expect(bridge).toHaveBeenCalledWith(container, render, expect.objectContaining({ surface: 'sidebar' }));
		handle.destroy?.();
		expect(unmount).toHaveBeenCalled();
	});
});
