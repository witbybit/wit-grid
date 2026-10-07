/**
 * The grid's chart window: a floating, draggable, resizable chart over the page, opened with
 * `api.openChart()` (or the context menu's Chart range). It charts the selection, or a column
 * aggregated per category, and cross-filters the grid.
 */
import type { GridApi } from '../api/GridApi.js';
import { resolveColumnFilterDef } from '../filters/filterDef.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import { sidebarIconSvg } from '../sidebar/sidebarIcons.js';
import { createGridChart, type GridChartHandle } from './gridChart.js';
import type { ChartAggregate, ChartSource, ChartSpec, ChartType } from './chartTypes.js';

const TYPE_ICONS: Record<ChartType, string> = {
	column: '<path d="M3 3v18h18"/><path d="M8 17V9M13 17V5M18 17v-6"/>',
	bar: '<path d="M3 3v18h18"/><path d="M7 7h8M7 12h12M7 17h5"/>',
	line: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
	area: '<path d="M3 3v18h18"/><path d="M7 17V12l4-4 3 3 5-5v11Z"/>',
	pie: '<path d="M21 12A9 9 0 1 1 12 3v9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
	donut: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5"/>',
	scatter: '<path d="M3 3v18h18"/><circle cx="8" cy="15" r="1.2"/><circle cx="12" cy="9" r="1.2"/><circle cx="16" cy="13" r="1.2"/><circle cx="18" cy="6" r="1.2"/>',
};
const TYPE_LABELS: Record<ChartType, string> = { column: 'Columns', bar: 'Bars', line: 'Line', area: 'Area', pie: 'Pie', donut: 'Donut', scatter: 'Scatter' };
const AGGREGATES: { value: ChartAggregate; label: string }[] = [
	{ value: 'sum', label: 'Sum' },
	{ value: 'avg', label: 'Average' },
	{ value: 'min', label: 'Min' },
	{ value: 'max', label: 'Max' },
	{ value: 'count', label: 'Count' },
];

const svg = (paths: string, size = 16) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
	const b = el('button', 'og-cw-btn');
	b.type = 'button';
	b.title = label;
	b.setAttribute('aria-label', label);
	b.innerHTML = icon;
	b.addEventListener('click', onClick);
	return b;
}

function select(label: string, options: { value: string; label: string }[], value: string, onChange: (value: string) => void): HTMLLabelElement {
	const wrap = el('label', 'og-cw-field');
	wrap.appendChild(el('span', 'og-cw-field-label', label));
	const input = el('select', 'og-cw-select');
	for (const option of options) input.appendChild(new Option(option.label, option.value));
	input.value = value;
	input.addEventListener('change', () => onChange(input.value));
	wrap.appendChild(input);
	return wrap;
}

export class GridChartWindow<TRowData = unknown> {
	private root: HTMLDivElement | null = null;
	private chart: GridChartHandle | null = null;
	private spec: ChartSpec | null = null;
	private position = { x: 0, y: 0, w: 720, h: 460 };
	private readonly off: () => void;

	constructor(private readonly api: GridApi<TRowData>) {
		this.off = api.subscribeToKey('chartOpen', () => this.sync());
		this.sync();
	}

	destroy(): void {
		this.off();
		this.close();
	}

	private sync(): void {
		const open = !!this.api.getStateSnapshot().chartOpen;
		if (open && !this.root) this.open();
		else if (!open && this.root) this.close();
	}

	/** A first spec: the selection when it spans cells, else a count per category column. */
	private defaultSpec(): ChartSpec {
		const bounds = this.api.getStateSnapshot().selection?.bounds;
		const spansCells = !!bounds && (bounds.maxRow > bounds.minRow || bounds.maxCol > bounds.minCol);
		if (spansCells) return { type: 'column', source: { kind: 'range' }, title: 'Selection' };
		const category = this.categoryColumns()[0]?.value;
		const measure = this.measureColumns()[0]?.value;
		return {
			type: 'column',
			source: category ? { kind: 'aggregate', category, measures: [measure ? { field: measure, aggregate: 'sum' } : { aggregate: 'count' }] } : { kind: 'range' },
			title: category ? undefined : 'Selection',
		};
	}

	private columns() {
		return this.api.getDisplayedColumns().filter((c) => !isHierarchyColumn(c) && !c.field.startsWith('__'));
	}

	/** What the first rows hold, per column: numbers, and how many distinct values. */
	private profile() {
		const sample = this.api.rows().getAll().slice(0, 200);
		const out = new Map<string, { numeric: boolean; distinct: number }>();
		for (const col of this.columns()) {
			const values = sample.map((row) => this.api.getCellValue(this.api.getRowId(row), col.field)).filter((v) => v != null && v !== '');
			const numeric = values.length > 0 && values.every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))));
			out.set(col.field, { numeric, distinct: new Set(values.map(String)).size });
		}
		return out;
	}

	/** Columns to group by: not numbers or dates; the fewest distinct values first. */
	private categoryColumns() {
		const profile = this.profile();
		return this.columns()
			.filter((c) => {
				const type = resolveColumnFilterDef(c)?.type;
				return type !== 'number' && type !== 'date' && type !== 'dateRange' && !(type === undefined || type === 'text' ? profile.get(c.field)?.numeric : false);
			})
			.map((c) => ({ value: c.field, label: String(c.header || c.field), distinct: profile.get(c.field)?.distinct ?? 0 }))
			.sort((a, b) => (a.distinct > 1 ? a.distinct : Infinity) - (b.distinct > 1 ? b.distinct : Infinity));
	}

	/** Columns to measure: number columns, or columns whose values are numbers. */
	private measureColumns() {
		const profile = this.profile();
		return this.columns()
			.filter((c) => {
				const type = resolveColumnFilterDef(c)?.type;
				return type === 'number' || ((type === undefined || type === 'text') && !!profile.get(c.field)?.numeric);
			})
			.map((c) => ({ value: c.field, label: String(c.header || c.field) }));
	}

	private open(): void {
		const grid = this.api.getContainer?.();
		const box = grid?.getBoundingClientRect();
		const vw = document.documentElement.clientWidth || window.innerWidth;
		const vh = document.documentElement.clientHeight || window.innerHeight;
		const w = Math.min(this.position.w, vw - 24);
		const h = Math.min(this.position.h, vh - 24);
		this.position = { w, h, x: box ? Math.max(12, Math.min(vw - w - 12, box.right - w - 24)) : 24, y: box ? Math.max(12, Math.min(vh - h - 12, box.top + 56)) : 24 };

		const root = el('div', 'og-cw');
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-label', 'Chart');
		const scope = grid?.dataset.ogThemeScope;
		if (scope) root.dataset.ogThemeScope = scope;
		this.root = root;
		this.place();

		const head = el('div', 'og-cw-head');
		const title = el('input', 'og-cw-title');
		title.setAttribute('aria-label', 'Chart title');
		title.placeholder = 'Untitled chart';
		const types = el('div', 'og-cw-types');
		types.setAttribute('role', 'radiogroup');
		types.setAttribute('aria-label', 'Chart type');
		const tools = el('div', 'og-cw-tools');
		head.append(title, types, tools);
		const bar = el('div', 'og-cw-bar');
		const body = el('div', 'og-cw-body');
		const grip = el('div', 'og-cw-resize');
		grip.setAttribute('aria-hidden', 'true');
		root.append(head, bar, body, grip);
		document.body.appendChild(root);

		this.spec = this.defaultSpec();
		title.value = this.spec.title ?? '';
		title.addEventListener('input', () => this.update({ title: title.value || undefined }));
		this.chart = createGridChart(this.api, body, this.spec);

		const renderTypes = () => {
			types.textContent = '';
			for (const type of Object.keys(TYPE_ICONS) as ChartType[]) {
				const b = iconButton(svg(TYPE_ICONS[type]), TYPE_LABELS[type], () => {
					this.update({ type });
					renderTypes();
					renderBar();
				});
				b.setAttribute('role', 'radio');
				b.setAttribute('aria-checked', String(this.spec!.type === type));
				types.appendChild(b);
			}
		};

		const toggle = (label: string, key: 'stacked' | 'smooth' | 'labels' | 'legend' | 'crossFilter', on: boolean) => {
			const b = el('button', 'og-cw-chip', label);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(on));
			b.addEventListener('click', () => {
				this.update({ [key]: !on } as Partial<ChartSpec>);
				renderBar();
			});
			return b;
		};

		const renderBar = () => {
			const spec = this.spec!;
			bar.textContent = '';
			const source = el('div', 'og-cw-seg');
			source.setAttribute('role', 'radiogroup');
			source.setAttribute('aria-label', 'Data');
			for (const [kind, label] of [
				['range', 'Selection'],
				['aggregate', 'By column'],
			] as const) {
				const b = el('button', 'og-cw-seg-btn', label);
				b.type = 'button';
				b.setAttribute('role', 'radio');
				b.setAttribute('aria-checked', String(spec.source.kind === kind));
				b.addEventListener('click', () => {
					if (spec.source.kind === kind) return;
					const category = this.categoryColumns()[0]?.value;
					const measure = this.measureColumns()[0]?.value;
					const next: ChartSource =
						kind === 'range' ? { kind: 'range' } : { kind: 'aggregate', category: category ?? '', measures: [measure ? { field: measure, aggregate: 'sum' } : { aggregate: 'count' }] };
					this.update({ source: next, title: kind === 'range' ? 'Selection' : undefined });
					title.value = this.spec?.title ?? '';
					renderBar();
				});
				source.appendChild(b);
			}
			bar.appendChild(source);
			if (spec.source.kind === 'aggregate') {
				const agg = spec.source;
				const measure = agg.measures[0] ?? { aggregate: 'count' as ChartAggregate };
				bar.appendChild(select('By', this.categoryColumns(), agg.category, (category) => this.update({ source: { ...agg, category } })));
				const measures = [{ value: '', label: 'Rows' }, ...this.measureColumns()];
				bar.appendChild(
					select('Of', measures, measure.aggregate === 'count' ? '' : (measure.field ?? ''), (field) => {
						this.update({ source: { ...agg, measures: [field ? { field, aggregate: measure.aggregate === 'count' ? 'sum' : measure.aggregate } : { aggregate: 'count' }] } });
						renderBar();
					})
				);
				if (measure.aggregate !== 'count')
					bar.appendChild(
						select('As', AGGREGATES.filter((a) => a.value !== 'count'), measure.aggregate, (aggregate) =>
							this.update({ source: { ...agg, measures: [{ field: measure.field, aggregate: aggregate as ChartAggregate }] } })
						)
					);
			} else {
				const b = el('button', 'og-cw-chip', 'Swap rows and columns');
				b.type = 'button';
				b.setAttribute('aria-pressed', String(!!spec.source.transposed));
				const range = spec.source;
				b.addEventListener('click', () => {
					this.update({ source: { kind: 'range', transposed: !range.transposed } });
					renderBar();
				});
				bar.appendChild(b);
			}
			const options = el('div', 'og-cw-options');
			const cartesian = spec.type !== 'pie' && spec.type !== 'donut';
			if (spec.type === 'column' || spec.type === 'bar' || spec.type === 'area') options.appendChild(toggle('Stacked', 'stacked', !!spec.stacked));
			if (spec.type === 'line' || spec.type === 'area') options.appendChild(toggle('Smooth', 'smooth', !!spec.smooth));
			options.appendChild(toggle('Values', 'labels', !!spec.labels));
			if (cartesian) options.appendChild(toggle('Legend', 'legend', spec.legend !== false));
			options.appendChild(toggle('Filter on click', 'crossFilter', spec.crossFilter !== false));
			bar.appendChild(options);
		};

		tools.append(
			iconButton(svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>'), 'Download PNG', () => void this.chart?.downloadPNG().catch(() => {})),
			iconButton(sidebarIconSvg('x', 16), 'Close chart', () => this.api.closeChart())
		);
		renderTypes();
		renderBar();

		// Drag by the header (not its controls); resize from the corner.
		head.addEventListener('pointerdown', (event) => {
			if ((event.target as HTMLElement).closest('button, input, select')) return;
			this.track(event, (dx, dy, start) => {
				this.position.x = start.x + dx;
				this.position.y = start.y + dy;
			});
		});
		grip.addEventListener('pointerdown', (event) =>
			this.track(event, (dx, dy, start) => {
				this.position.w = Math.max(380, start.w + dx);
				this.position.h = Math.max(280, start.h + dy);
			})
		);
		root.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || event.defaultPrevented) return;
			event.preventDefault();
			this.api.closeChart();
		});
		root.addEventListener('mousedown', (event) => event.stopPropagation());
	}

	private track(event: PointerEvent, move: (dx: number, dy: number, start: { x: number; y: number; w: number; h: number }) => void): void {
		event.preventDefault();
		const start = { ...this.position };
		const sx = event.clientX;
		const sy = event.clientY;
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture?.(event.pointerId);
		const onMove = (e: PointerEvent) => {
			move(e.clientX - sx, e.clientY - sy, start);
			this.place();
		};
		const onUp = () => {
			target.removeEventListener('pointermove', onMove);
			target.removeEventListener('pointerup', onUp);
			target.removeEventListener('pointercancel', onUp);
		};
		target.addEventListener('pointermove', onMove);
		target.addEventListener('pointerup', onUp);
		target.addEventListener('pointercancel', onUp);
	}

	private place(): void {
		if (!this.root) return;
		const vw = document.documentElement.clientWidth || window.innerWidth;
		const vh = document.documentElement.clientHeight || window.innerHeight;
		const p = this.position;
		p.x = Math.max(8 - p.w + 120, Math.min(vw - 120, p.x));
		p.y = Math.max(8, Math.min(vh - 48, p.y));
		Object.assign(this.root.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
	}

	private update(patch: Partial<ChartSpec>): void {
		if (!this.spec) return;
		this.spec = { ...this.spec, ...patch };
		this.chart?.update(patch);
	}

	private close(): void {
		this.chart?.destroy();
		this.chart = null;
		this.root?.remove();
		this.root = null;
	}
}
