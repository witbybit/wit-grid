// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomCellRendererParams } from '../columnDef.js';
import { createTimelineRenderer } from './timeline.js';

type Row = { id: string; plan: unknown };

function setup(rows: Row[], options: Parameters<typeof createTimelineRenderer>[0] = {}) {
	const setCellValue = vi.fn();
	const api = {
		forEachNode: (fn: (node: { id: string; data: Row }) => void) => rows.forEach((row) => fn({ id: row.id, data: row })),
		selectCell: vi.fn(),
		setCellValue,
	};
	const renderer = createTimelineRenderer(options);
	const mount = (row: Row) => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const params = {
			container,
			value: row.plan,
			node: { id: row.id, data: row },
			col: { field: 'plan' },
			api,
		} as unknown as DomCellRendererParams<Row>;
		const handle = renderer.mount(container, params);
		const bar = container.querySelector<HTMLElement>('.og-ct-timeline-bar')!;
		const track = container.querySelector<HTMLElement>('.og-ct-timeline')!;
		return { container, params, handle, bar, track };
	};
	return { mount, setCellValue };
}

const percent = (value: string) => Number.parseFloat(value);

afterEach(() => {
	document.body.innerHTML = '';
});

describe('timeline cells', () => {
	const range = { start: '2026-03-02', end: '2026-03-31' };

	it('places each bar on the fixed range, ending at the end of its last day', () => {
		const rows = [
			{ id: 'a', plan: { start: '2026-03-02', end: '2026-03-02' } },
			{ id: 'b', plan: { start: '2026-03-16', end: '2026-03-30' } },
		];
		const { mount } = setup(rows, { range });
		const a = mount(rows[0]);
		const b = mount(rows[1]);
		expect(percent(a.bar.style.left)).toBe(0);
		expect(percent(a.bar.style.width)).toBeCloseTo(100 / 29, 2);
		expect(percent(b.bar.style.left)).toBeCloseTo((14 / 29) * 100, 2);
		expect(b.bar.querySelector('.og-ct-timeline-label')!.textContent).toBe('15d');
	});

	it('shares one auto scale across the column, padded to whole weeks, and hides empty cells', () => {
		const rows = [
			{ id: 'a', plan: { start: '2026-03-04', end: '2026-03-10' } },
			{ id: 'b', plan: null },
		];
		const { mount } = setup(rows);
		const a = mount(rows[0]);
		expect(percent(a.bar.style.left)).toBeGreaterThan(0);
		expect(percent(a.bar.style.left) + percent(a.bar.style.width)).toBeLessThan(100);
		expect(mount(rows[1]).bar.hidden).toBe(true);
	});

	it('widens the shared scale when a value falls outside it, redrawing every cell', () => {
		const rows = [{ id: 'a', plan: { start: '2026-03-04', end: '2026-03-10' } }];
		const { mount } = setup(rows);
		const a = mount(rows[0]);
		const before = percent(a.bar.style.width);
		const later = { id: 'b', plan: { start: '2026-06-01', end: '2026-06-20' } };
		mount(later);
		expect(percent(a.bar.style.width)).toBeLessThan(before);
	});

	it('drags the bar to move it, writing the range once on release in the shape the cell held', () => {
		const rows = [{ id: 'a', plan: ['2026-03-09', '2026-03-12'] }];
		const { mount, setCellValue } = setup(rows, { range });
		const { bar, track } = mount(rows[0]);
		Object.defineProperty(track, 'clientWidth', { value: 290 });
		bar.getBoundingClientRect = () => ({ left: 70, right: 110 }) as DOMRect;
		bar.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 90, bubbles: true }));
		// 290px over 29 days: 10px a day; +30px moves three days.
		bar.dispatchEvent(new PointerEvent('pointermove', { clientX: 120 }));
		expect(setCellValue).not.toHaveBeenCalled();
		bar.dispatchEvent(new PointerEvent('pointerup', { clientX: 120 }));
		expect(setCellValue).toHaveBeenCalledWith('a', 'plan', ['2026-03-12', '2026-03-15']);
	});

	it('resizes from an end without crossing the start', () => {
		const rows = [{ id: 'a', plan: { start: '2026-03-09', end: '2026-03-12' } }];
		const { mount, setCellValue } = setup(rows, { range });
		const { bar, track } = mount(rows[0]);
		Object.defineProperty(track, 'clientWidth', { value: 290 });
		bar.getBoundingClientRect = () => ({ left: 70, right: 110 }) as DOMRect;
		bar.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 108, bubbles: true }));
		bar.dispatchEvent(new PointerEvent('pointermove', { clientX: 8 }));
		bar.dispatchEvent(new PointerEvent('pointerup', { clientX: 8 }));
		expect(setCellValue).toHaveBeenCalledWith('a', 'plan', { start: '2026-03-09', end: '2026-03-09' });
	});

	it('does not start a drag when not editable, and a click without movement writes nothing', () => {
		const rows = [{ id: 'a', plan: { start: '2026-03-09', end: '2026-03-12' } }];
		const readOnly = setup(rows, { range, editable: false });
		const ro = readOnly.mount(rows[0]);
		const down = new PointerEvent('pointerdown', { button: 0, clientX: 90, bubbles: true, cancelable: true });
		ro.bar.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(false);

		const editable = setup(rows, { range });
		const { bar } = editable.mount(rows[0]);
		bar.getBoundingClientRect = () => ({ left: 70, right: 110 }) as DOMRect;
		bar.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 90 }));
		bar.dispatchEvent(new PointerEvent('pointerup', { clientX: 90 }));
		expect(editable.setCellValue).not.toHaveBeenCalled();
	});

	it('draws month lines dashed (quarters in their own colour), today solid, and names the day under the pointer', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 4, 20, 12));
		try {
			const rows = [{ id: 'a', plan: { start: '2026-03-02', end: '2026-03-03' } }];
			const { mount } = setup(rows, { range: { start: '2026-03-02', end: '2026-07-30' } });
			const { track, handle } = mount(rows[0]);
			const ticks = track.style.getPropertyValue('--og-ct-ticks');
			// Apr, May, Jun, Jul: April and July start quarters (each line names its colour twice).
			expect(ticks.match(/--og-ct-timeline-quarter/g)).toHaveLength(4);
			expect(ticks.match(/--og-ct-timeline-tick\)/g)).toHaveLength(4);
			expect(track.style.backgroundImage).toContain('--og-ct-timeline-today');

			vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 150 } as DOMRect);
			track.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, bubbles: true }));
			expect(track.title).toMatch(/Mar/);
			expect(track.title).toMatch(/\b2\b/);

			// The day turns: the today line steps to the next day.
			const before = track.style.backgroundImage;
			vi.advanceTimersByTime(13 * 3_600_000);
			expect(track.style.backgroundImage).not.toBe(before);
			handle.destroy();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
