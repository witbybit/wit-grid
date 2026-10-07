// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomCellEditor, DomCellRenderer } from '../columnDef.js';
import { cascadeColumnType, linkedRecordColumnType, longTextColumnType, segmentedColumnType, switchColumnType } from './cellTypes.js';
import { createCascadeStore, createCascadeEditor, createCascadeRenderer, type CascadeOption } from './cascade.js';
import { createColorEditor, createColorRenderer, normalizeHexColor } from './color.js';
import { createDateRangeEditor, createDateRangeRenderer, parseDateRange, writeDateRange } from './dateRange.js';
import { createToggleEditor } from './editors.js';
import { createLongTextEditor } from './longText.js';
import { createSparklineRenderer, parseSparklineValues } from './sparkline.js';

function fakeApi() {
	return { selectCell: vi.fn(), setCellValue: vi.fn() };
}

function mountRenderer(renderer: DomCellRenderer<any>, value: unknown, api = fakeApi(), rowId = 'r1') {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const params = (v: unknown, id = rowId) =>
		({
			container,
			value: v,
			node: { id, data: {} },
			col: { field: 'f', header: 'F' },
			api,
			isEditing: false,
			isScrolling: false,
			phase: 'live',
			isFocused: false,
			isSelected: false,
		}) as any;
	const handle = renderer.mount(container, params(value));
	return { container, api, update: (v: unknown, id?: string) => handle.update(params(v, id)) };
}

function mountEditor(editor: DomCellEditor<any>, value: unknown) {
	const cell = document.createElement('div');
	cell.className = 'og-cell';
	cell.tabIndex = -1;
	const container = document.createElement('div');
	cell.appendChild(container);
	document.body.appendChild(cell);
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
		col: { field: 'f', header: 'F' },
	});
	return { container, onCommit, onCancel, onChange, handle, popover: () => document.querySelector<HTMLElement>('.og-ct-popover') };
}

function press(el: Element) {
	el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

function key(target: Element, k: string, init: KeyboardEventInit = {}) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rendererOf(type: { renderer?: unknown }): DomCellRenderer<any> {
	return (type.renderer as { renderer: DomCellRenderer<any> }).renderer;
}

function editorOf(type: { cellEditor?: unknown }): DomCellEditor<any> {
	return (type.cellEditor as { editor: DomCellEditor<any> }).editor;
}

afterEach(() => {
	document.body.textContent = '';
});

describe('switch and segmented', () => {
	it('a switch toggles on press in the value shape; double-clicks stay with it', () => {
		const { container, api } = mountRenderer(rendererOf(switchColumnType({ onLabel: 'Active', offLabel: 'Paused' })), 'false');
		const host = container.querySelector('[role=switch]')!;
		expect(host.textContent).toBe('Paused');
		press(host);
		expect(api.setCellValue).toHaveBeenCalledWith('r1', 'f', 'true');
		const dbl = new MouseEvent('dblclick', { bubbles: true });
		const outer = vi.fn();
		container.addEventListener('dblclick', outer);
		host.dispatchEvent(dbl);
		expect(outer).not.toHaveBeenCalled();
	});

	it('Enter on a toggle cell toggles and ends the edit; a remount before then does not', async () => {
		const live = mountEditor(createToggleEditor(), true);
		await flush();
		expect(live.onCommit).toHaveBeenCalledWith(false);
		const dropped = mountEditor(createToggleEditor(), true);
		dropped.handle.destroy?.();
		await flush();
		expect(dropped.onCommit).not.toHaveBeenCalled();
	});

	it('segmented: one press picks, pressing the chosen segment writes nothing', () => {
		const type = segmentedColumnType([
			{ value: 'low', label: 'Low', color: 'gray' },
			{ value: 'high', label: 'High', color: 'red' },
		]);
		const { container, api } = mountRenderer(rendererOf(type), 'low');
		const [low, high] = container.querySelectorAll<HTMLElement>('.og-ct-segment');
		expect(low.getAttribute('aria-checked')).toBe('true');
		press(low);
		expect(api.setCellValue).not.toHaveBeenCalled();
		press(high);
		expect(api.setCellValue).toHaveBeenCalledWith('r1', 'f', 'high');
		expect(type.valueFormatter!({ value: 'high' } as any)).toBe('High');
	});
});

describe('colour', () => {
	it('normalizes hex values', () => {
		expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
		expect(normalizeHexColor('12ab34')).toBe('#12ab34');
		expect(normalizeHexColor('red')).toBeNull();
	});

	it('renders a swatch and hex; the editor commits a swatch or a typed hex', () => {
		const { container } = mountRenderer(createColorRenderer(), '#3b82f6');
		expect(container.querySelector('.og-ct-hex')!.textContent).toBe('#3B82F6');

		const first = mountEditor(createColorEditor(), '#3b82f6');
		first.popover()!.querySelector<HTMLElement>('.og-ct-swatch-button[data-color="#ffffff"]')!.click();
		expect(first.onCommit).toHaveBeenCalledWith('#ffffff');
		first.handle.destroy?.();

		const typed = mountEditor(createColorEditor(), null);
		const input = typed.container.querySelector('input')!;
		input.value = 'zz';
		input.dispatchEvent(new Event('input'));
		expect(input.hasAttribute('data-invalid')).toBe(true);
		key(input, 'Enter');
		expect(typed.onCommit).not.toHaveBeenCalled();
		input.value = '#0f0';
		input.dispatchEvent(new Event('input'));
		key(input, 'Enter');
		expect(typed.onCommit).toHaveBeenCalledWith('#00ff00');
	});
});

describe('long text', () => {
	it('shows one line in the cell, keeps lines in the tooltip', () => {
		const { container } = mountRenderer(rendererOf(longTextColumnType()), 'First line\nSecond line of a note that runs long');
		const span = container.querySelector('.og-ct-longtext') as HTMLElement;
		expect(span.textContent).toBe('First line · Second line of a note that runs long');
		expect(span.title).toContain('\n');
	});

	it('Enter adds a line, Ctrl+Enter saves, Escape abandons; counts toward maxLength', () => {
		const editor = mountEditor(createLongTextEditor({ maxLength: 20 }), 'Hi');
		const area = editor.popover()!.querySelector('textarea')!;
		expect(document.activeElement).toBe(area);
		expect(editor.popover()!.querySelector('.og-ct-count')!.textContent).toBe('2 / 20');
		key(area, 'Enter');
		expect(editor.onCommit).not.toHaveBeenCalled();
		area.value = 'Hi\nthere';
		area.dispatchEvent(new Event('input'));
		expect(editor.onChange).toHaveBeenLastCalledWith('Hi\nthere');
		key(area, 'Enter', { ctrlKey: true });
		expect(editor.onCommit).toHaveBeenCalledWith('Hi\nthere');
		editor.handle.destroy?.();

		const cancelled = mountEditor(createLongTextEditor(), 'x');
		key(cancelled.popover()!.querySelector('textarea')!, 'Escape');
		expect(cancelled.onCancel).toHaveBeenCalled();
	});
});

describe('linked records', () => {
	it('draws record chips and opens the pressed record with its row', () => {
		const onOpen = vi.fn();
		const type = linkedRecordColumnType(
			[
				{ value: 'p1', label: 'Apollo', description: 'Q3 launch' },
				{ value: 'p2', label: 'Borealis' },
			],
			{ onOpen }
		);
		const { container, update } = mountRenderer(rendererOf(type), ['p1', 'p2']);
		const chips = container.querySelectorAll<HTMLElement>('.og-ct-record');
		expect([...chips].map((chip) => chip.textContent)).toEqual(['AApollo', 'BBorealis']);
		expect(chips[0].title).toBe('Apollo · Q3 launch');
		// A recycled cell: same value, another row.
		update(['p1', 'p2'], 'r7');
		press(container.querySelectorAll('.og-ct-record')[1]);
		expect(onOpen).toHaveBeenCalledWith(
			'p2',
			expect.objectContaining({ node: expect.objectContaining({ id: 'r7' }) }),
			container.querySelectorAll('.og-ct-record')[1]
		);
	});
});

const TREE: CascadeOption[] = [
	{
		value: 'in',
		label: 'India',
		children: [
			{
				value: 'ka',
				label: 'Karnataka',
				children: [
					{ value: 'blr', label: 'Bengaluru' },
					{ value: 'mys', label: 'Mysuru' },
				],
			},
			{ value: 'mh', label: 'Maharashtra', children: [{ value: 'bom', label: 'Mumbai' }] },
		],
	},
	{ value: 'jp', label: 'Japan', children: [{ value: 'tk', label: 'Tokyo', children: [{ value: 'shb', label: 'Shibuya' }] }] },
];

function columnLabels(popover: HTMLElement): string[][] {
	return [...popover.querySelectorAll('.og-ct-cascade-column')].map((col) =>
		[...col.querySelectorAll('.og-ct-option-label')].map((el) => el.textContent ?? '')
	);
}

describe('cascading select', () => {
	it('shows the path; opens the stored path; keyboard walks levels and commits a leaf', () => {
		const type = cascadeColumnType({ options: TREE });
		const { container } = mountRenderer(rendererOf(type), ['in', 'ka', 'blr']);
		expect(container.querySelector('.og-ct-path')!.textContent).toBe('India › Karnataka › Bengaluru');
		expect(type.valueFormatter!({ value: 'jp/tk/shb' } as any)).toBe('Japan › Tokyo › Shibuya');

		const editor = mountEditor(editorOf(type), ['in', 'ka', 'blr']);
		const popover = editor.popover()!;
		expect(columnLabels(popover)).toEqual([
			['India', 'Japan'],
			['Karnataka', 'Maharashtra'],
			['Bengaluru', 'Mysuru'],
		]);
		const input = popover.querySelector('input')!;
		key(input, 'ArrowDown'); // Mysuru
		key(input, 'Enter');
		expect(editor.onCommit).toHaveBeenCalledWith(['in', 'ka', 'mys']);
		editor.handle.destroy?.();

		const walk = mountEditor(editorOf(type), 'in/mh/bom');
		const searchBox = walk.popover()!.querySelector('input')!;
		key(searchBox, 'ArrowLeft');
		key(searchBox, 'ArrowLeft'); // to the first column
		key(searchBox, 'ArrowDown'); // Japan
		key(searchBox, 'Enter'); // opens Japan, moves to its column
		key(searchBox, 'Enter'); // opens Tokyo
		key(searchBox, 'Enter'); // Shibuya: a leaf
		expect(walk.onCommit).toHaveBeenCalledWith('jp/tk/shb');
	});

	it('search finds leaf paths through any level', () => {
		const editor = mountEditor(editorOf(cascadeColumnType({ options: TREE })), null);
		const input = editor.popover()!.querySelector('input')!;
		input.value = 'karna';
		input.dispatchEvent(new Event('input'));
		const results = [...editor.popover()!.querySelectorAll('.og-ct-option-label')].map((el) => el.textContent);
		expect(results).toEqual(['India › Karnataka › Bengaluru', 'India › Karnataka › Mysuru']);
		key(input, 'Enter');
		expect(editor.onCommit).toHaveBeenCalledWith(['in', 'ka', 'blr']);
	});

	it('loads levels on demand and resolves labels of stored paths', async () => {
		const loadChildren = vi.fn(async (path: string[]) => {
			if (path.length === 0) return [{ value: 'in', label: 'India' }];
			if (path.length === 1) return [{ value: 'ka', label: 'Karnataka', isLeaf: true }];
			return [];
		});
		const resolvePath = vi.fn(async () => [
			{ value: 'in', label: 'India' },
			{ value: 'ka', label: 'Karnataka' },
		]);
		const store = createCascadeStore({ loadChildren, resolvePath });
		const { container } = mountRenderer(createCascadeRenderer(store), ['in', 'ka']);
		expect(container.querySelector('.og-ct-skeleton')).not.toBeNull();
		await flush();
		expect(container.querySelector('.og-ct-path')!.textContent).toBe('India › Karnataka');

		const fresh = createCascadeStore({ loadChildren });
		const editor = mountEditor(createCascadeEditor(fresh), null);
		expect(editor.popover()!.querySelector('.og-ct-list-status')?.textContent).toContain('Loading');
		await flush();
		expect(columnLabels(editor.popover()!)).toEqual([['India']]);
		editor.popover()!.querySelector<HTMLElement>('.og-ct-option')!.click();
		await flush();
		expect(loadChildren).toHaveBeenLastCalledWith(['in'], expect.anything());
		expect(columnLabels(editor.popover()!)).toEqual([['India'], ['Karnataka']]);
		editor.popover()!.querySelectorAll<HTMLElement>('.og-ct-cascade-column')[1].querySelector<HTMLElement>('.og-ct-option')!.click();
		expect(editor.onCommit).toHaveBeenCalledWith(['in', 'ka']);
	});
});

describe('date range', () => {
	it('reads and writes objects, arrays and ISO intervals, in order', () => {
		const range = parseDateRange('2026-03-18/2026-03-04')!;
		expect([range.start.getDate(), range.end.getDate()]).toEqual([4, 18]);
		expect(writeDateRange('x/y', range)).toBe('2026-03-04/2026-03-18');
		expect(writeDateRange(['a', 'b'], range)).toEqual(['2026-03-04', '2026-03-18']);
		expect(writeDateRange(null, range)).toEqual({ start: '2026-03-04', end: '2026-03-18' });
	});

	it('renders the range and its length', () => {
		const { container } = mountRenderer(createDateRangeRenderer({ locale: 'en-US' }), { start: '2026-03-04', end: '2026-03-18' });
		expect(container.querySelector('.og-ct-text')!.textContent).toMatch(/Mar 4\s*–\s*18, 2026/);
		expect(container.querySelector('.og-ct-range-length')!.textContent).toBe('15d');
	});

	it('two clicks pick the range (either order), Apply saves; a preset saves at once', () => {
		const editor = mountEditor(createDateRangeEditor({ months: 1, locale: 'en-US' }), { start: '2026-03-04', end: '2026-03-06' });
		const day = (n: number) => [...editor.popover()!.querySelectorAll<HTMLElement>('.og-ct-cal-day')].find((el) => el.textContent === String(n))!;
		day(20).click();
		expect(editor.popover()!.querySelector('.og-ct-range-summary')!.textContent).toBe('Pick an end date');
		day(10).click();
		expect(editor.popover()!.querySelectorAll('.og-ct-cal-day[data-in-range]')).toHaveLength(9);
		[...editor.popover()!.querySelectorAll<HTMLButtonElement>('.og-ct-btn')].find((b) => b.textContent === 'Apply')!.click();
		expect(editor.onCommit).toHaveBeenCalledWith({ start: '2026-03-10', end: '2026-03-20' });
		editor.handle.destroy?.();

		const preset = mountEditor(createDateRangeEditor({ months: 1 }), null);
		[...preset.popover()!.querySelectorAll<HTMLElement>('.og-ct-range-preset')].find((b) => b.textContent === 'Last 7 days')!.click();
		const saved = preset.onCommit.mock.calls[0][0] as { start: string; end: string };
		expect(parseDateRange(saved)!.end.getTime() - parseDateRange(saved)!.start.getTime()).toBe(6 * 86_400_000);
	});
});

describe('sparkline', () => {
	it('parses arrays, strings and { values }', () => {
		expect(parseSparklineValues([1, '2', 'x', 3])).toEqual([1, 2, 3]);
		expect(parseSparklineValues('4, 5,6')).toEqual([4, 5, 6]);
		expect(parseSparklineValues({ values: [7] })).toEqual([7]);
	});

	it('area: path, gradient, last marker and label; trend colour', () => {
		const { container } = mountRenderer(createSparklineRenderer({ colorBy: 'trend' }), [3, 5, 4, 9]);
		const svg = container.querySelector('svg')!;
		expect(svg.querySelectorAll('path')).toHaveLength(2);
		expect(svg.querySelector('linearGradient')).not.toBeNull();
		expect(svg.style.color).toBe('rgb(34, 197, 94)');
		expect(container.querySelectorAll('.og-ct-spark-dot')).toHaveLength(1);
		expect(container.querySelector('.og-ct-spark-label')!.textContent).toBe('9.0');
		expect(container.querySelector<HTMLElement>('.og-ct-spark')!.title).toContain('min 3.0');
	});

	it('bars below zero use the negative colour; change label; min / max markers', () => {
		const bars = mountRenderer(createSparklineRenderer({ type: 'bar', label: 'change' }), [10, -5, 15]);
		const rects = bars.container.querySelectorAll('rect');
		expect(rects).toHaveLength(3);
		expect(rects[1].getAttribute('fill')).toBe('var(--og-ct-danger)');
		expect(bars.container.querySelector('.og-ct-spark-label')!.textContent).toBe('+50%');
		const line = mountRenderer(createSparklineRenderer({ type: 'line', markers: 'minmax', reference: 'average', curve: 'smooth' }), [1, 8, 2, 6]);
		expect(line.container.querySelectorAll('.og-ct-spark-dot')).toHaveLength(2);
		expect(line.container.querySelector('.og-ct-spark-ref')).not.toBeNull();
		expect(line.container.querySelector('path')!.getAttribute('d')).toContain('C');
	});
});
