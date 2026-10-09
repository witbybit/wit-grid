// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridStyleRule } from '../columnDef.js';
import {
	buildLook,
	ConditionalFormatPainter,
	findConditionalFormatPainter,
	registerConditionalFormatPainter,
	unregisterConditionalFormatPainter,
} from './conditionalFormat.js';

function setup(rules: GridStyleRule<any>[], values: Record<string, number | string | null>, enumerable = true) {
	const data = { ...values };
	let version = 1;
	let clock = 1000;
	const root = document.createElement('div');
	root.className = 'og-grid-container';
	document.body.appendChild(root);
	const source = {
		getRules: () => rules,
		getValue: (rowId: string) => data[rowId],
		getVersion: () => version,
		forEachDisplayedRowId: (visit: (rowId: string) => void) => {
			if (!enumerable) return false;
			Object.keys(data).forEach(visit);
			return true;
		},
	};
	const painter = new ConditionalFormatPainter(source, root, () => clock);
	const cell = (rowId: string, field = 'amount') => {
		const el = document.createElement('div');
		el.className = 'og-cell';
		el.dataset.colField = field;
		el.dataset.rowId = rowId;
		root.appendChild(el);
		return el;
	};
	return {
		root,
		painter,
		cell,
		data,
		bump: () => version++,
		tick: (ms: number) => (clock += ms),
	};
}

afterEach(() => {
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('conditional formatting', () => {
	it('draws a data bar sized to the value within the column range, growing from zero', () => {
		const look = buildLook([{ kind: 'dataBar', field: 'amount' }], 50, { min: 0, max: 100 });
		expect(look.image).toContain('transparent 0%');
		expect(look.image).toContain('50%, transparent 50%');
		const negative = buildLook([{ kind: 'dataBar', field: 'amount' }], -25, { min: -50, max: 50 });
		// Zero sits mid-cell; -25 spans 25%..50% in the negative colour.
		expect(negative.image).toContain('transparent 25%');
		expect(negative.image).toContain('#ef4444');
	});

	it('blends a colour scale by position, with the ends taking the end colours', () => {
		const rule = { kind: 'colorScale', field: 'amount', colors: ['#000000', '#ffffff'] } as const;
		expect(buildLook([rule], 0, { min: 0, max: 10 }).image).toContain('#000000 24%');
		expect(buildLook([rule], 10, { min: 0, max: 10 }).image).toContain('#ffffff 24%');
		expect(buildLook([rule], 5, { min: 0, max: 10 }).image).toContain('color-mix(in oklab, #ffffff 50%, #000000)');
	});

	it('picks icon bands by thirds, reversible, and pads the cell for the icon', () => {
		const rule = { kind: 'iconSet', field: 'amount', icons: 'dots' } as const;
		const low = buildLook([rule], 1, { min: 0, max: 9 });
		const high = buildLook([rule], 8, { min: 0, max: 9 });
		expect(low.padding).toBe('28px');
		expect(low.image).not.toBe(high.image);
		expect(buildLook([{ ...rule, reverse: true }], 1, { min: 0, max: 9 }).image).toBe(high.image);
	});

	it('stacks rules on one field: icon over bar over tint', () => {
		const look = buildLook(
			[
				{ kind: 'colorScale', field: 'a' },
				{ kind: 'iconSet', field: 'a' },
				{ kind: 'dataBar', field: 'a' },
			],
			5,
			{ min: 0, max: 10 }
		);
		const layers = look.image.split(/, (?=url|linear)/);
		expect(layers[0]).toMatch(/^url/);
		expect(layers[1]).toContain('90deg');
		expect(look.size.split(', ')).toHaveLength(3);
	});

	it('paints cells from the column range, honours fixed min/max, and clears unformatted or non-numeric cells', () => {
		const { painter, cell } = setup([{ kind: 'dataBar', field: 'amount' }], { a: 0, b: 50, c: 100, d: 'n/a' });
		const el = cell('b');
		painter.paintCell(el, 'b', 'amount');
		expect(el.style.backgroundImage).toContain('50%');

		painter.paintCell(el, 'd', 'amount');
		expect(el.style.backgroundImage).toBe('');

		painter.paintCell(el, 'c', 'amount');
		expect(el.style.backgroundImage).not.toBe('');
		// A recycled element moving to an unformatted column is cleared.
		painter.paintCell(el, 'c', 'name');
		expect(el.style.backgroundImage).toBe('');

		const fixed = setup([{ kind: 'dataBar', field: 'amount', min: 0, max: 200 }], { a: 0, b: 50, c: 100 });
		const fixedEl = fixed.cell('c');
		fixed.painter.paintCell(fixedEl, 'c', 'amount');
		expect(fixedEl.style.backgroundImage).toContain('50%');
	});

	it('skips the style write when a rebind would paint the same look', () => {
		const { painter, cell } = setup([{ kind: 'colorScale', field: 'amount' }], { a: 0, b: 10 });
		const el = cell('a');
		painter.paintCell(el, 'a', 'amount');
		const spy = vi.spyOn(el.style, 'backgroundImage', 'set');
		painter.paintCell(el, 'a', 'amount');
		expect(spy).not.toHaveBeenCalled();
	});

	it('repaints the visible cells when a live value moves the column range', async () => {
		vi.useFakeTimers();
		const { painter, cell, data, tick } = setup([{ kind: 'dataBar', field: 'amount' }], { a: 50, b: 100 });
		const a = cell('a');
		const b = cell('b');
		painter.paintCell(a, 'a', 'amount');
		painter.paintCell(b, 'b', 'amount');
		expect(a.style.backgroundImage).toContain('50%');

		// b streams to 200: same cell, new value, so the range is recomputed and a re-scales to 25%.
		data.b = 200;
		tick(500);
		painter.paintCell(b, 'b', 'amount');
		await vi.runAllTimersAsync();
		expect(a.style.backgroundImage).toContain('25%');
	});

	it('keeps a running range for row models that cannot enumerate their rows', async () => {
		vi.useFakeTimers();
		const { painter, cell } = setup([{ kind: 'dataBar', field: 'amount' }], { a: 10, b: 40 }, false);
		const a = cell('a');
		const b = cell('b');
		painter.paintCell(a, 'a', 'amount');
		painter.paintCell(b, 'b', 'amount');
		await vi.runAllTimersAsync();
		// The range grew to 0..40 (bars include zero): a is a quarter bar.
		expect(a.style.backgroundImage).toContain('25%');
	});

	it('is found from any cell of its grid and released on unregister', () => {
		const { painter, root, cell } = setup([], {});
		registerConditionalFormatPainter(root, painter);
		expect(findConditionalFormatPainter(cell('x'))).toBe(painter);
		unregisterConditionalFormatPainter(root);
		expect(findConditionalFormatPainter(cell('y'))).toBeNull();
		expect(findConditionalFormatPainter(document.createElement('div'))).toBeNull();
	});
});
