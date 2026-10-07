/**
 * A chart of grid data in any container: `createGridChart(api, element, spec)`. It follows the
 * grid (data, filters, the selection for range charts, the theme), redraws at most once a frame,
 * and cross-filters the grid when a category is clicked.
 */
import type { GridApi } from '../api/GridApi.js';
import { triggerDownload } from '../export/csvExport.js';
import type { FilterModel } from '../filterModel.js';
import { applyFilterToModel } from '../filterOperations.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';
import { drawChart, hitTest, type ChartTheme, type DrawResult } from './chartCanvas.js';
import { readChartData } from './chartData.js';
import { formatCompact } from './chartScale.js';
import type { ChartData, ChartSpec } from './chartTypes.js';

export interface GridChartHandle {
	readonly element: HTMLElement;
	getSpec(): ChartSpec;
	/** Merges into the spec and redraws. */
	update(patch: Partial<ChartSpec>): void;
	/** The data as plotted (series hidden in the legend left out). */
	getData(): ChartData;
	toPNG(): Promise<Blob>;
	downloadPNG(fileName?: string): Promise<void>;
	destroy(): void;
}

const BASE_PALETTE = ['#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#14b8a6', '#f97316', '#64748b'];
const ENTRY_MS = 420;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function createGridChart<TRowData>(api: GridApi<TRowData>, container: HTMLElement, initial: ChartSpec, scheduler: GridScheduler = defaultGridScheduler): GridChartHandle {
	let spec: ChartSpec = { ...initial };
	const anyApi = api as GridApi<any>;
	const root = el('div', 'og-chart');
	const scope = api.getContainer?.()?.dataset.ogThemeScope;
	if (scope) root.dataset.ogThemeScope = scope;
	const title = el('div', 'og-chart-title');
	const plot = el('div', 'og-chart-plot');
	const canvas = el('canvas', 'og-chart-canvas');
	canvas.setAttribute('role', 'img');
	const tooltip = el('div', 'og-chart-tooltip');
	tooltip.hidden = true;
	const empty = el('div', 'og-chart-empty');
	plot.append(canvas, tooltip, empty);
	const legend = el('div', 'og-chart-legend');
	root.append(title, plot, legend);
	container.appendChild(root);

	const hidden = new Set<string>();
	let all: ChartData = { categories: [], series: [], categoryField: null, categoryValues: [] };
	let data = all;
	let result: DrawResult = { regions: [] };
	let hover: number | null = null;
	let progress = 1;
	let animationStart = 0;
	let frame: number | null = null;
	let dataDirty = true;
	let shape = '';

	const readTheme = (): ChartTheme & { accent: string } => {
		const style = getComputedStyle(root);
		const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
		return {
			text: v('--og-text-color', '#e2e8f0'),
			line: v('--og-border-color', 'rgba(148, 163, 184, .25)'),
			background: v('--og-bg-color', '#0b0f17'),
			font: v('--og-font-family', 'system-ui, sans-serif'),
			accent: v('--og-focus-ring', '#6366f1'),
		};
	};
	const palette = (theme: { accent: string }) => spec.palette ?? [theme.accent, ...BASE_PALETTE.filter((c) => c.toLowerCase() !== theme.accent.toLowerCase())];

	/** The category a cross-filter selected (its filter is one value of the category column). */
	const selectedCategory = (): number | null => {
		if (spec.crossFilter === false || !data.categoryField) return null;
		const filter = (api.getStateSnapshot().filterModel as FilterModel | null)?.[data.categoryField];
		if (!filter || filter.type !== 'select' || filter.values.length !== 1) return null;
		const index = data.categoryValues.findIndex((v) => v !== null && String(v) === String(filter.values[0]));
		return index >= 0 ? index : null;
	};

	const recompute = () => {
		const theme = readTheme();
		const colors = palette(theme);
		all = readChartData(anyApi, spec.source, (i) => colors[i % colors.length]);
		data = { ...all, series: all.series.filter((s) => !hidden.has(s.name)) };
		const nextShape = `${spec.type}|${data.categories.length}|${data.series.length}`;
		if (nextShape !== shape) {
			shape = nextShape;
			progress = 0;
			animationStart = 0;
		}
		renderLegend();
	};

	const renderLegend = () => {
		legend.textContent = '';
		const pie = spec.type === 'pie' || spec.type === 'donut';
		legend.hidden = spec.legend === false || (pie ? all.categories.length === 0 : all.series.length <= 1);
		if (legend.hidden) return;
		const theme = readTheme();
		const colors = palette(theme);
		if (pie) {
			all.categories.slice(0, 12).forEach((category, i) => {
				const item = el('span', 'og-chart-legend-item');
				const swatch = el('i');
				swatch.style.background = colors[i % colors.length];
				item.append(swatch, el('span', undefined, category));
				legend.appendChild(item);
			});
			return;
		}
		for (const series of all.series) {
			const item = el('button', 'og-chart-legend-item');
			item.type = 'button';
			item.setAttribute('aria-pressed', String(!hidden.has(series.name)));
			const swatch = el('i');
			swatch.style.background = series.color;
			item.append(swatch, el('span', undefined, series.name));
			item.addEventListener('click', () => {
				if (hidden.has(series.name)) hidden.delete(series.name);
				else if (all.series.length - hidden.size > 1) hidden.add(series.name);
				invalidate(true);
			});
			legend.appendChild(item);
		}
	};

	const draw = () => {
		frame = null;
		if (dataDirty) {
			dataDirty = false;
			recompute();
		}
		title.textContent = spec.title ?? '';
		title.hidden = !spec.title;
		const width = plot.clientWidth;
		const height = plot.clientHeight;
		const dpr = Math.min(3, window.devicePixelRatio || 1);
		if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
			canvas.width = Math.round(width * dpr);
			canvas.height = Math.round(height * dpr);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
		}
		const ctx = canvas.getContext('2d');
		const nothing = data.categories.length === 0 || data.series.length === 0;
		empty.hidden = !nothing;
		empty.textContent = nothing ? (spec.source.kind === 'range' ? 'Select cells with numbers to chart them.' : 'No data to chart.') : '';
		canvas.setAttribute('aria-label', `${spec.title ?? 'Chart'}: ${data.series.map((s) => s.name).join(', ')} by ${data.categories.length} categories`);
		if (!ctx || width <= 0 || height <= 0) return;
		if (progress < 1) {
			const now = performance.now();
			if (!animationStart) animationStart = now;
			const t = Math.min(1, (now - animationStart) / ENTRY_MS);
			progress = 1 - (1 - t) ** 3;
			if (t < 1) frame = scheduler.raf(draw);
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const theme = readTheme();
		result = drawChart(ctx, width, height, data, { ...spec, palette: palette(theme) }, theme, { focus: hover ?? selectedCategory(), progress });
	};

	const invalidate = (withData = false) => {
		if (withData) dataDirty = true;
		if (frame === null) frame = scheduler.raf(draw);
	};

	const showTooltip = (category: number, x: number, y: number) => {
		tooltip.textContent = '';
		tooltip.appendChild(el('div', 'og-chart-tooltip-title', data.categories[category]));
		const pie = spec.type === 'pie' || spec.type === 'donut';
		const rows = pie ? [data.series[0]] : data.series;
		const total = pie ? data.series[0].values.reduce((s, v) => s + Math.max(0, v || 0), 0) : 0;
		const colors = palette(readTheme());
		for (const series of rows) {
			const row = el('div', 'og-chart-tooltip-row');
			const swatch = el('i');
			swatch.style.background = pie ? colors[category % colors.length] : series.color;
			const value = series.values[category] ?? 0;
			row.append(swatch, el('span', undefined, series.name), el('b', undefined, pie && total > 0 ? `${formatCompact(value)} · ${Math.round((value / total) * 100)}%` : formatCompact(value)));
			tooltip.appendChild(row);
		}
		if (spec.crossFilter !== false && data.categoryField && data.categoryValues[category] != null)
			tooltip.appendChild(el('div', 'og-chart-tooltip-hint', selectedCategory() === category ? 'Click to clear the filter' : 'Click to filter the grid'));
		tooltip.hidden = false;
		const box = plot.getBoundingClientRect();
		const w = tooltip.offsetWidth;
		const h = tooltip.offsetHeight;
		tooltip.style.left = `${Math.min(box.width - w - 4, Math.max(4, x + 14))}px`;
		tooltip.style.top = `${Math.min(box.height - h - 4, Math.max(4, y - h - 10))}px`;
	};

	const onMove = (event: PointerEvent) => {
		const box = canvas.getBoundingClientRect();
		const x = event.clientX - box.left;
		const y = event.clientY - box.top;
		const hit = hitTest(result, x, y);
		const next = hit?.category ?? null;
		canvas.style.cursor = next !== null && spec.crossFilter !== false && data.categoryField && data.categoryValues[next] != null ? 'pointer' : 'default';
		if (next !== hover) {
			hover = next;
			invalidate();
		}
		if (next === null) tooltip.hidden = true;
		else showTooltip(next, x, y);
	};
	const onLeave = () => {
		hover = null;
		tooltip.hidden = true;
		invalidate();
	};
	const onClick = (event: MouseEvent) => {
		if (spec.crossFilter === false || !data.categoryField) return;
		const box = canvas.getBoundingClientRect();
		const hit = hitTest(result, event.clientX - box.left, event.clientY - box.top);
		if (!hit) return;
		const value = data.categoryValues[hit.category];
		if (value == null) return;
		const model = (api.getStateSnapshot().filterModel as FilterModel | null) ?? null;
		const same = selectedCategory() === hit.category;
		api.setFilterModel(applyFilterToModel(data.categoryField, same ? null : { type: 'select', values: [value], labels: [data.categories[hit.category]] }, model));
	};
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerleave', onLeave);
	canvas.addEventListener('click', onClick);

	const unsubscribe = [
		api.subscribeDomain('rows', () => invalidate(true)),
		api.subscribeToKey('filterModel', () => invalidate(true)),
		api.subscribeToKey('columns', () => invalidate(true)),
		api.subscribeToKey('themeName', () => invalidate(true)),
		api.subscribeToKey('selection', () => {
			if (spec.source.kind === 'range') invalidate(true);
		}),
	];
	const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => invalidate()) : null;
	resize?.observe(plot);
	invalidate(true);

	const toPNG = async (): Promise<Blob> => {
		if (frame !== null) {
			scheduler.cancelRaf(frame);
			frame = null;
		}
		progress = 1;
		draw();
		const theme = readTheme();
		const dpr = canvas.width / Math.max(1, plot.clientWidth);
		const header = spec.title ? 36 : 0;
		const out = document.createElement('canvas');
		out.width = canvas.width;
		out.height = canvas.height + Math.round(header * dpr);
		const ctx = out.getContext('2d')!;
		ctx.fillStyle = theme.background;
		ctx.fillRect(0, 0, out.width, out.height);
		if (spec.title) {
			ctx.fillStyle = theme.text;
			ctx.font = `600 ${15 * dpr}px ${theme.font}`;
			ctx.textBaseline = 'middle';
			ctx.fillText(spec.title, 14 * dpr, (header / 2) * dpr);
		}
		ctx.drawImage(canvas, 0, Math.round(header * dpr));
		return new Promise((resolve, reject) => out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('[wit-grid] chart: could not draw the image'))), 'image/png'));
	};

	return {
		element: root,
		getSpec: () => spec,
		update(patch) {
			spec = { ...spec, ...patch };
			if (patch.source || patch.type) hidden.clear();
			invalidate(true);
		},
		getData: () => data,
		toPNG,
		async downloadPNG(fileName = `${(spec.title ?? 'chart').replace(/[^\w.-]+/g, '-').toLowerCase()}.png`) {
			triggerDownload(await toPNG(), fileName);
		},
		destroy() {
			unsubscribe.forEach((off) => off());
			resize?.disconnect();
			if (frame !== null) scheduler.cancelRaf(frame);
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerleave', onLeave);
			canvas.removeEventListener('click', onClick);
			root.remove();
		},
	};
}
