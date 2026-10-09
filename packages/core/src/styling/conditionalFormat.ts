import type { GridStyleRule, ValueScaleRule } from '../columnDef.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';

/**
 * Conditional formatting: colour scales, data bars and icon sets. Unlike class rules, a cell's look
 * depends on where its value sits in its column's range, so the painter keeps a range per formatted
 * column (over the displayed rows) and repaints the visible cells when a range moves.
 *
 * Everything is drawn as background layers on the cell element itself (no extra DOM), written only
 * when the cell's computed look changes.
 */

export interface ConditionalFormatSource {
	getRules(): readonly GridStyleRule<any>[] | undefined;
	getValue(rowId: string, field: string): unknown;
	/** Changes whenever the displayed row set may have changed (new data, filter, sort, group). */
	getVersion(): number;
	/** Visits every displayed data row; returns false when the row model cannot enumerate them. */
	forEachDisplayedRowId(visit: (rowId: string) => void): boolean;
}

interface Range {
	min: number;
	max: number;
}

interface FormattedCell extends HTMLElement {
	__ogCf?: string;
	__ogCfRow?: string;
	__ogCfValue?: number;
}

const RANGE_THROTTLE_MS = 200;
const DEFAULT_SCALE = ['#ef4444', '#f59e0b', '#22c55e'] as const;
const DEFAULT_BAR = 'var(--og-focus-ring)';
const DEFAULT_NEGATIVE_BAR = '#ef4444';
const ICON_SIZE = 14;
const ICON_INSET = 9;
const ICON_PADDING = '28px';

const PAINTERS = new WeakMap<Element, ConditionalFormatPainter>();

export function registerConditionalFormatPainter(root: Element, painter: ConditionalFormatPainter): void {
	PAINTERS.set(root, painter);
}

export function unregisterConditionalFormatPainter(root: Element): void {
	PAINTERS.get(root)?.dispose();
	PAINTERS.delete(root);
}

/** The painter of the grid a cell element belongs to (null while the element is detached). */
export function findConditionalFormatPainter(cell: Element): ConditionalFormatPainter | null {
	const root = cell.closest('.og-grid-container');
	return root ? (PAINTERS.get(root) ?? null) : null;
}

export function isValueScaleRule(rule: GridStyleRule<any>): rule is ValueScaleRule {
	return rule.kind === 'colorScale' || rule.kind === 'dataBar' || rule.kind === 'iconSet';
}

export class ConditionalFormatPainter {
	private rulesRef: readonly GridStyleRule<any>[] | undefined = undefined;
	private rulesVersion = 0;
	private readonly rulesByField = new Map<string, ValueScaleRule[]>();
	private readonly ranges = new Map<string, Range>();
	private rangeVersion = Number.NaN;
	private rangesDirty = true;
	private lastRangeAt = Number.NEGATIVE_INFINITY;
	private rangeTimer: ReturnType<GridScheduler['timeout']> | null = null;
	private repaintQueued = false;
	private disposed = false;

	constructor(
		private readonly source: ConditionalFormatSource,
		private readonly root: HTMLElement,
		private readonly now: () => number = () => performance.now(),
		private readonly scheduler: GridScheduler = defaultGridScheduler
	) {}

	public dispose(): void {
		this.disposed = true;
		if (this.rangeTimer !== null) this.scheduler.clearTimeout(this.rangeTimer);
		this.rangeTimer = null;
	}

	/** The fields that have value-scale rules. */
	public get formattedFields(): ReadonlySet<string> {
		this.syncRules();
		return new Set(this.rulesByField.keys());
	}

	/** Called after every cell bind: paints, repaints or clears the cell's formatting. */
	public paintCell(element: HTMLElement, rowId: string, field: string): void {
		this.syncRules();
		const cell = element as FormattedCell;
		const rules = this.rulesByField.get(field);
		const value = rules ? toNumber(this.source.getValue(rowId, field)) : null;
		if (rules === undefined || value === null) {
			if (cell.__ogCf !== undefined) clearCell(cell);
			return;
		}
		// The same cell showing a new value means the data moved: the column's range may have too.
		if (cell.__ogCfRow === rowId && cell.__ogCfValue !== value) this.rangesDirty = true;
		cell.__ogCfRow = rowId;
		cell.__ogCfValue = value;
		this.syncRanges();

		const range = this.rangeFor(field, value);
		const look = buildLook(rules, value, range);
		const key = `${this.rulesVersion}|${look.image}|${look.padding}`;
		if (cell.__ogCf === key) return;
		cell.__ogCf = key;
		const style = cell.style;
		style.backgroundImage = look.image;
		style.backgroundSize = look.size;
		style.backgroundPosition = look.position;
		style.backgroundRepeat = 'no-repeat';
		style.paddingLeft = look.padding;
	}

	/** Repaints every visible cell of the formatted columns (after a range moved). */
	public repaintVisible(): void {
		this.repaintQueued = false;
		if (this.disposed) return;
		this.syncRules();
		if (this.rulesByField.size === 0) return;
		const cells = this.root.querySelectorAll<HTMLElement>('.og-cell[data-col-field][data-row-id]');
		for (const cell of cells) {
			const field = cell.dataset.colField!;
			if (this.rulesByField.has(field)) this.paintCell(cell, cell.dataset.rowId!, field);
		}
	}

	private syncRules(): void {
		const rules = this.source.getRules();
		if (rules === this.rulesRef) return;
		this.rulesRef = rules;
		this.rulesVersion++;
		this.rulesByField.clear();
		for (const rule of rules ?? []) {
			if (!isValueScaleRule(rule)) continue;
			const list = this.rulesByField.get(rule.field);
			if (list) list.push(rule);
			else this.rulesByField.set(rule.field, [rule]);
		}
		this.ranges.clear();
		this.rangesDirty = true;
	}

	private syncRanges(): void {
		const version = this.source.getVersion();
		if (version === this.rangeVersion && !this.rangesDirty) return;
		const elapsed = this.now() - this.lastRangeAt;
		if (elapsed < RANGE_THROTTLE_MS) {
			// Streaming data: recompute at most every RANGE_THROTTLE_MS, with a trailing pass.
			if (this.rangeTimer === null && !this.disposed) {
				this.rangeTimer = this.scheduler.timeout(() => {
					this.rangeTimer = null;
					this.syncRanges();
				}, RANGE_THROTTLE_MS - elapsed);
			}
			return;
		}
		this.rangeVersion = version;
		this.rangesDirty = false;
		this.lastRangeAt = this.now();
		if (this.computeRanges()) this.queueRepaint();
	}

	/** Recomputes the range of every formatted column; true when any changed. */
	private computeRanges(): boolean {
		const fields = [...this.rulesByField.keys()];
		const next = fields.map(() => ({ min: Infinity, max: -Infinity }));
		const enumerable = this.source.forEachDisplayedRowId((rowId) => {
			for (let i = 0; i < fields.length; i++) {
				const value = toNumber(this.source.getValue(rowId, fields[i]));
				if (value === null) continue;
				const range = next[i];
				if (value < range.min) range.min = value;
				if (value > range.max) range.max = value;
			}
		});
		// Row models that load on demand keep the running range of values seen (see rangeFor).
		if (!enumerable) return false;
		let changed = false;
		fields.forEach((field, i) => {
			const prev = this.ranges.get(field);
			const range = next[i];
			if (!prev || prev.min !== range.min || prev.max !== range.max) changed = true;
			if (range.min <= range.max) this.ranges.set(field, range);
			else this.ranges.delete(field);
		});
		return changed;
	}

	private rangeFor(field: string, value: number): Range {
		let range = this.ranges.get(field);
		if (!range) {
			range = { min: value, max: value };
			this.ranges.set(field, range);
		} else if (value < range.min || value > range.max) {
			range.min = Math.min(range.min, value);
			range.max = Math.max(range.max, value);
			this.queueRepaint();
		}
		return range;
	}

	private queueRepaint(): void {
		if (this.repaintQueued || this.disposed) return;
		this.repaintQueued = true;
		this.scheduler.raf(() => this.repaintVisible());
	}
}

function clearCell(cell: FormattedCell): void {
	cell.__ogCf = undefined;
	cell.__ogCfRow = undefined;
	cell.__ogCfValue = undefined;
	const style = cell.style;
	style.backgroundImage = '';
	style.backgroundSize = '';
	style.backgroundPosition = '';
	style.backgroundRepeat = '';
	style.paddingLeft = '';
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Where `value` sits in [min, max], 0..1 (0.5 when the range is a single value). */
function position(value: number, min: number, max: number): number {
	return max > min ? clamp01((value - min) / (max - min)) : 0.5;
}

interface Look {
	image: string;
	size: string;
	position: string;
	padding: string;
}

/** One background layer per rule, the first rule on top (icons, then bars, then fills read best). */
export function buildLook(rules: readonly ValueScaleRule[], value: number, range: Range): Look {
	const images: string[] = [];
	const sizes: string[] = [];
	const positions: string[] = [];
	let padding = '';
	const ordered = [...rules].sort((a, b) => LAYER_ORDER[a.kind] - LAYER_ORDER[b.kind]);
	for (const rule of ordered) {
		const min = rule.min ?? range.min;
		const max = rule.max ?? range.max;
		if (rule.kind === 'colorScale') {
			const colour = scaleColour(rule.colors ?? DEFAULT_SCALE, value, min, max, rule.mid);
			const tint = `color-mix(in srgb, ${colour} ${Math.round((rule.opacity ?? 0.24) * 100)}%, transparent)`;
			images.push(`linear-gradient(${tint}, ${tint})`);
			sizes.push('100% 100%');
			positions.push('0 0');
		} else if (rule.kind === 'dataBar') {
			// Bars grow from zero, so a column of gains and losses reads both ways.
			const lo = Math.min(0, min);
			const hi = Math.max(0, max);
			const zero = position(0, lo, hi);
			const at = position(value, lo, hi);
			const start = pct(Math.min(zero, at));
			const end = pct(Math.max(zero, at));
			const colour = value < 0 ? (rule.negativeColor ?? DEFAULT_NEGATIVE_BAR) : (rule.color ?? DEFAULT_BAR);
			const soft = `color-mix(in srgb, ${colour} 22%, transparent)`;
			const strong = `color-mix(in srgb, ${colour} 55%, transparent)`;
			const [from, to] = value < 0 ? [strong, soft] : [soft, strong];
			images.push(`linear-gradient(90deg, transparent ${start}, ${from} ${start}, ${to} ${end}, transparent ${end})`);
			sizes.push('calc(100% - 8px) 62%');
			positions.push('4px 50%');
		} else {
			const [low, high] = rule.thresholds ?? [1 / 3, 2 / 3];
			const t = position(value, min, max);
			let band = t < low ? 0 : t < high ? 1 : 2;
			if (rule.reverse) band = 2 - band;
			images.push(`url("${ICON_SETS[rule.icons ?? 'arrows'][band]}")`);
			sizes.push(`${ICON_SIZE}px ${ICON_SIZE}px`);
			positions.push(`${ICON_INSET}px 50%`);
			padding = ICON_PADDING;
		}
	}
	return { image: images.join(', '), size: sizes.join(', '), position: positions.join(', '), padding };
}

const LAYER_ORDER: Record<ValueScaleRule['kind'], number> = { iconSet: 0, dataBar: 1, colorScale: 2 };

const pct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/** The scale colour at `value`, mixed by the browser so any CSS colour (or variable) works. */
function scaleColour(colors: readonly string[], value: number, min: number, max: number, mid?: number): string {
	if (colors.length === 2) return mix(colors[0], colors[1], position(value, min, max));
	const centre = mid ?? (min + max) / 2;
	return value <= centre ? mix(colors[0], colors[1], position(value, min, centre)) : mix(colors[1], colors[2], position(value, centre, max));
}

function mix(from: string, to: string, t: number): string {
	const share = Math.round(t * 100);
	return share <= 0 ? from : share >= 100 ? to : `color-mix(in oklab, ${to} ${share}%, ${from})`;
}

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>${body}</svg>`)}`;

/** [low, middle, high] icons. */
const ICON_SETS: Record<NonNullable<Extract<ValueScaleRule, { kind: 'iconSet' }>['icons']>, [string, string, string]> = {
	arrows: [
		svg(`<path d='M8 13 2.5 6h11z' fill='#ef4444'/>`),
		svg(`<path d='M13 8 6 2.5v11z' fill='#f59e0b'/>`),
		svg(`<path d='M8 3l5.5 7h-11z' fill='#22c55e'/>`),
	],
	dots: [
		svg(`<circle cx='8' cy='8' r='5' fill='#ef4444'/>`),
		svg(`<circle cx='8' cy='8' r='5' fill='#f59e0b'/>`),
		svg(`<circle cx='8' cy='8' r='5' fill='#22c55e'/>`),
	],
	signal: [
		svg(
			`<rect x='2' y='10' width='3' height='4' rx='1' fill='#94a3b8'/><rect x='6.5' y='6' width='3' height='8' rx='1' fill='#94a3b8' opacity='.35'/><rect x='11' y='2' width='3' height='12' rx='1' fill='#94a3b8' opacity='.35'/>`
		),
		svg(
			`<rect x='2' y='10' width='3' height='4' rx='1' fill='#94a3b8'/><rect x='6.5' y='6' width='3' height='8' rx='1' fill='#94a3b8'/><rect x='11' y='2' width='3' height='12' rx='1' fill='#94a3b8' opacity='.35'/>`
		),
		svg(
			`<rect x='2' y='10' width='3' height='4' rx='1' fill='#94a3b8'/><rect x='6.5' y='6' width='3' height='8' rx='1' fill='#94a3b8'/><rect x='11' y='2' width='3' height='12' rx='1' fill='#94a3b8'/>`
		),
	],
};
