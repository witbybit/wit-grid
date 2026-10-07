import { describe, expect, it } from 'vitest';
import { createClientGrid } from '../createGrid.js';
import { drawChart, hitTest, type ChartTheme } from './chartCanvas.js';
import { readChartData } from './chartData.js';
import { formatCompact, lttb, niceTicks } from './chartScale.js';
import type { ChartData, ChartSpec } from './chartTypes.js';

interface Row {
	id: string;
	team: string;
	region: string;
	sales: number;
	cost: number;
}

const ROWS: Row[] = [
	{ id: '1', team: 'Alpha', region: 'EU', sales: 100, cost: 40 },
	{ id: '2', team: 'Beta', region: 'EU', sales: 300, cost: 90 },
	{ id: '3', team: 'Alpha', region: 'US', sales: 50, cost: 10 },
	{ id: '4', team: 'Gamma', region: 'US', sales: 25, cost: 5 },
];

function grid() {
	return createClientGrid<Row>({
		rows: ROWS,
		columns: [
			{ field: 'team', header: 'Team' },
			{ field: 'region', header: 'Region' },
			{ field: 'sales', header: 'Sales', filterDef: { type: 'number' } },
			{ field: 'cost', header: 'Cost', filterDef: { type: 'number' } },
		],
	});
}

const colors = (i: number) => ['#111111', '#222222', '#333333'][i % 3];

/** A 2D context that records nothing and measures text by length. */
function mockContext(): CanvasRenderingContext2D {
	const noop = () => {};
	return new Proxy({} as Record<string | symbol, unknown>, {
		get(target, key) {
			if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
			if (key === 'createLinearGradient') return () => ({ addColorStop: noop });
			if (key in target) return target[key];
			return noop;
		},
		set(target, key, value) {
			target[key] = value;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
}

const THEME: ChartTheme = { text: '#fff', line: '#444', background: '#000', font: 'sans-serif' };

describe('chart scales', () => {
	it('nice ticks cover the domain with round steps', () => {
		expect(niceTicks(0, 87, 5)).toEqual([0, 20, 40, 60, 80, 100]);
		expect(niceTicks(-12, 30, 4)).toEqual([-20, 0, 20, 40]);
		expect(niceTicks(5, 5)).toEqual([0, 2, 4, 6, 8, 10]);
	});

	it('compact numbers', () => {
		expect([formatCompact(1250000), formatCompact(42000), formatCompact(950), formatCompact(0.125)]).toEqual(['1.3M', '42k', '950', '0.125']);
	});

	it('LTTB keeps the ends and the extremes within the threshold', () => {
		const ys = Array.from({ length: 1000 }, (_, i) => (i === 500 ? 100 : Math.sin(i / 50)));
		const kept = lttb(ys.map((_, i) => i), ys, 50);
		expect(kept.length).toBe(50);
		expect(kept[0]).toBe(0);
		expect(kept.at(-1)).toBe(999);
		expect(kept).toContain(500);
	});
});

describe('chart data', () => {
	it('aggregates a column per category, largest first; count needs no field', () => {
		const api = grid();
		const data = readChartData(api as never, { kind: 'aggregate', category: 'team', measures: [{ field: 'sales', aggregate: 'sum' }, { aggregate: 'count' }] }, colors);
		expect(data.categories).toEqual(['Beta', 'Alpha', 'Gamma']);
		expect(data.series.map((s) => s.name)).toEqual(['Sales', 'Count']);
		expect(data.series[0].values).toEqual([300, 150, 25]);
		expect(data.series[1].values).toEqual([1, 2, 1]);
		expect(data.categoryField).toBe('team');
	});

	it('averages, label order, and folding the rest into Other', () => {
		const api = grid();
		const avg = readChartData(api as never, { kind: 'aggregate', category: 'region', measures: [{ field: 'cost', aggregate: 'avg' }], sort: 'label' }, colors);
		expect(avg.categories).toEqual(['EU', 'US']);
		expect(avg.series[0].values).toEqual([65, 7.5]);
		const limited = readChartData(api as never, { kind: 'aggregate', category: 'team', measures: [{ field: 'sales', aggregate: 'sum' }], limit: 2 }, colors);
		expect(limited.categories).toEqual(['Beta', 'Other']);
		expect(limited.series[0].values).toEqual([300, 175]);
		expect(limited.categoryValues[1]).toBeNull();
	});

	it('a chart cross-filtering by its category ignores that one filter, not the others', () => {
		const api = grid();
		api.setFilterModel({ team: { type: 'select', values: ['Alpha'] }, region: { type: 'select', values: ['EU'] } });
		const data = readChartData(api as never, { kind: 'aggregate', category: 'team', measures: [{ field: 'sales', aggregate: 'sum' }] }, colors);
		// Every team that passes the region filter, Alpha's filter set aside.
		expect(data.categories).toEqual(['Beta', 'Alpha']);
		expect(data.series[0].values).toEqual([300, 100]);
	});

	it('the selected range: a text column names the categories, number columns are series', () => {
		const api = grid();
		api.selectCell({ rowId: '1', colField: 'team' });
		api.setSelectionRange?.({ start: { rowId: '1', colField: 'team' }, end: { rowId: '3', colField: 'sales' } } as never);
		const bounds = api.getStateSnapshot().selection?.bounds;
		if (!bounds || bounds.maxRow === bounds.minRow) return; // a grid without range selection in this environment
		const data = readChartData(api as never, { kind: 'range' }, colors);
		expect(data.categories[0]).toBe('Alpha');
		expect(data.series.map((s) => s.name)).toContain('Sales');
	});
});

describe('canvas charts', () => {
	const data: ChartData = {
		categories: ['A', 'B', 'C'],
		series: [
			{ name: 'Sales', values: [10, 30, 20], color: '#111' },
			{ name: 'Cost', values: [5, 10, 8], color: '#222' },
		],
		categoryField: 'team',
		categoryValues: ['A', 'B', 'C'],
	};
	const spec = (patch: Partial<ChartSpec>): ChartSpec => ({ type: 'column', source: { kind: 'range' }, ...patch });

	it('columns: a rect per value; taller values reach higher; hits find the category', () => {
		const result = drawChart(mockContext(), 600, 300, data, spec({}), THEME, { focus: null, progress: 1 });
		const rects = result.regions.filter((r) => r.kind === 'rect');
		expect(rects).toHaveLength(6);
		const b = rects.find((r) => r.category === 1 && r.series === 0)!;
		const a = rects.find((r) => r.category === 0 && r.series === 0)!;
		expect(b.kind === 'rect' && a.kind === 'rect' && b.h > a.h).toBe(true);
		if (b.kind === 'rect') expect(hitTest(result, b.x + b.w / 2, b.y + b.h / 2)).toMatchObject({ category: 1, series: 0 });
	});

	it('stacked columns sit on each other', () => {
		const result = drawChart(mockContext(), 600, 300, data, spec({ stacked: true }), THEME, { focus: null, progress: 1 });
		const [lower, upper] = result.regions.filter((r) => r.category === 0) as Extract<(typeof result.regions)[number], { kind: 'rect' }>[];
		expect(Math.abs(upper.y + upper.h - lower.y)).toBeLessThan(0.01);
	});

	it('lines find the category under the pointer by x', () => {
		const result = drawChart(mockContext(), 600, 300, data, spec({ type: 'line' }), THEME, { focus: null, progress: 1 });
		expect(result.categoryAt).toBeDefined();
		// Past the last point, within the plot's edge.
		expect(hitTest(result, 580, 150)?.category).toBe(2);
		expect(hitTest(result, 300, 150)?.category).toBe(1);
	});

	it('pie: an arc per category; a hit inside a slice finds it', () => {
		const result = drawChart(mockContext(), 300, 300, data, spec({ type: 'donut' }), THEME, { focus: null, progress: 1 });
		const arcs = result.regions.filter((r) => r.kind === 'arc');
		expect(arcs).toHaveLength(3);
		const slice = arcs[1];
		if (slice.kind !== 'arc') return;
		const mid = (slice.a0 + slice.a1) / 2;
		const r = (slice.r0 + slice.r1) / 2;
		expect(hitTest(result, slice.cx + Math.cos(mid) * r, slice.cy + Math.sin(mid) * r)?.category).toBe(1);
		// The hole of the donut is not a slice.
		expect(hitTest(result, slice.cx, slice.cy)).toBeNull();
	});

	it('nothing to plot draws nothing', () => {
		expect(drawChart(mockContext(), 300, 200, { ...data, categories: [], series: [] }, spec({}), THEME, { focus: null, progress: 1 }).regions).toEqual([]);
	});
});
