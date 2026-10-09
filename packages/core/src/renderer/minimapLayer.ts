import type { GridMinimapMark } from '../minimap.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { defaultGridScheduler, type GridScheduler } from './gridScheduler.js';

/** What the minimap reads from the grid each time it draws. */
export interface MinimapSource {
	enabled(): boolean;
	/** Displayed rows. */
	rowCount(): number;
	indexOf(rowId: string): number;
	/** Content-space top of a displayed row (rows can differ in height). */
	rowTop(index: number): number;
	/** Selected display-index ranges (cell range and selected rows), inclusive. */
	selection(): readonly { start: number; end: number }[];
	/** Rows with validation issues. */
	issues(): readonly { rowId: string; severity: string }[];
	marks(): readonly GridMinimapMark[];
	/** Changes whenever selection, issues or marks change. */
	version(): string;
	/** Scroll so `fraction` (0..1 of all rows) is centred in view. */
	scrollToFraction(fraction: number): void;
}

const WIDTH = 16;
/** Three lanes: selection on the left, app marks in the middle, recent edits on the right. Issues span all three. */
const LANE = 4;
const LANES = { selection: 1, marks: 6, edits: 11 } as const;
const CHANGE_FADE_MS = 5000;
const FADE_STEP_MS = 400;

/**
 * A strip beside the vertical scrollbar that stands for every displayed row: the view window,
 * selected rows, recent edits (fading), validation issues and app marks. Click or drag to scroll.
 * Drawn on one canvas, only when something it shows changed.
 */
export class MinimapLayer {
	private readonly canvas: HTMLCanvasElement;
	private readonly changes = new Map<string, number>();
	private lastKey = '';
	private plan: GridLayoutPlan | null = null;
	private height = 0;
	private fadeTimer: ReturnType<GridScheduler['timeout']> | null = null;
	private dragging = false;

	constructor(
		private readonly element: HTMLDivElement,
		private readonly source: MinimapSource,
		private readonly now: () => number = () => Date.now(),
		private readonly scheduler: GridScheduler = defaultGridScheduler
	) {
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'og-minimap-canvas';
		element.appendChild(this.canvas);
		element.setAttribute('aria-hidden', 'true');
		element.addEventListener('pointerdown', this.onPointerDown);
		element.addEventListener('pointermove', this.onPointerMove);
		element.addEventListener('pointerup', this.onPointerUp);
		element.addEventListener('pointercancel', this.onPointerUp);
	}

	public dispose(): void {
		if (this.fadeTimer !== null) this.scheduler.clearTimeout(this.fadeTimer);
		this.element.removeEventListener('pointerdown', this.onPointerDown);
		this.element.removeEventListener('pointermove', this.onPointerMove);
		this.element.removeEventListener('pointerup', this.onPointerUp);
		this.element.removeEventListener('pointercancel', this.onPointerUp);
		this.element.replaceChildren();
	}

	/** A cell changed: its row gets an edit mark that fades out. */
	public noteChange(rowId: string): void {
		this.changes.set(rowId, this.now());
		this.redraw();
	}

	/** Each layout pass (scrolling moves the view window). */
	public sync(plan: GridLayoutPlan): void {
		this.plan = plan;
		this.redraw();
	}

	public redraw(): void {
		const plan = this.plan;
		if (!plan) return;
		const enabled = this.source.enabled();
		this.element.hidden = !enabled;
		if (!enabled) {
			this.lastKey = '';
			return;
		}
		const top = plan.origins.rowLayerTop + plan.rows.pinnedTopHeight;
		const bottom = plan.origins.bottomChromeTop - plan.rows.pinnedBottomHeight;
		const height = Math.max(0, Math.floor(bottom - top));
		const rowCount = this.source.rowCount();
		this.pruneChanges();
		const key = `${top}|${height}|${plan.viewport.width - plan.viewport.clientWidth}|${rowCount}|${plan.dimensions.totalRowsHeight}|${plan.viewport.scrollTop}|${this.source.version()}|${this.changesKey()}`;
		if (key === this.lastKey) return;
		this.lastKey = key;
		const style = this.element.style;
		style.top = `${top}px`;
		style.height = `${height}px`;
		style.right = `${Math.max(0, plan.viewport.width - plan.viewport.clientWidth)}px`;
		this.height = height;
		this.draw(rowCount, plan);
	}

	private draw(rowCount: number, plan: GridLayoutPlan): void {
		const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
		const width = WIDTH;
		const height = this.height;
		if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
			this.canvas.width = Math.round(width * dpr);
			this.canvas.height = Math.round(height * dpr);
			this.canvas.style.width = `${width}px`;
			this.canvas.style.height = `${height}px`;
		}
		const ctx = this.canvas.getContext('2d');
		if (!ctx || height === 0) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (rowCount === 0) return;

		const css = getComputedStyle(this.element);
		const colour = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
		// Everything maps content pixels onto the strip, so marks line up with the view window.
		const total = Math.max(1, plan.dimensions.totalRowsHeight);
		const scale = height / total;
		const markH = Math.max(3, height / rowCount);
		const y = (index: number) => Math.min(height - markH, this.source.rowTop(index) * scale);
		const span = (start: number, end: number) => Math.max(markH, (this.source.rowTop(end + 1) - this.source.rowTop(start)) * scale);
		const accent = colour('--og-minimap-selection', colour('--og-focus-ring', '#6d7cff'));

		// The view window: a tinted, outlined thumb, so where you are reads at a glance; the outline goes on
		// top of the marks so it never disappears under them.
		// --og-minimap-* inherit, so they can be set on the grid or any ancestor; unset, the theme decides.
		const windowColour = colour('--og-minimap-window', accent);
		const windowTop = plan.rows.visibleTop * scale;
		const windowH = Math.max(10, (plan.rows.visibleBottom - plan.rows.visibleTop) * scale);
		ctx.fillStyle = windowColour;
		ctx.globalAlpha = 0.22;
		ctx.fillRect(0, windowTop, width, windowH);
		ctx.globalAlpha = 1;

		ctx.fillStyle = accent;
		for (const range of this.source.selection()) {
			const start = Math.max(0, range.start);
			const end = Math.min(rowCount - 1, range.end);
			if (end < start) continue;
			ctx.fillRect(LANES.selection, y(start), LANE, span(start, end));
		}

		for (const mark of this.source.marks()) {
			const index = this.source.indexOf(mark.rowId);
			if (index < 0) continue;
			ctx.fillStyle = mark.color ?? accent;
			ctx.fillRect(LANES.marks, y(index), LANE, markH);
		}

		// Recent edits fade as they age.
		const changeColour = colour('--og-minimap-change', '#f59e0b');
		const now = this.now();
		for (const [rowId, at] of this.changes) {
			const index = this.source.indexOf(rowId);
			if (index < 0) continue;
			ctx.globalAlpha = Math.max(0.3, 1 - (now - at) / CHANGE_FADE_MS);
			ctx.fillStyle = changeColour;
			ctx.fillRect(LANES.edits, y(index), LANE, markH);
		}
		ctx.globalAlpha = 1;

		const error = colour('--og-minimap-error', '#ef4444');
		const warning = colour('--og-minimap-warning', '#f59e0b');
		for (const issue of this.source.issues()) {
			const index = this.source.indexOf(issue.rowId);
			if (index < 0) continue;
			ctx.fillStyle = issue.severity === 'error' ? error : warning;
			ctx.fillRect(0, y(index), width, markH);
		}

		ctx.fillStyle = windowColour;
		ctx.fillRect(0, windowTop, width, 1.5);
		ctx.fillRect(0, windowTop + windowH - 1.5, width, 1.5);
		ctx.fillRect(0, windowTop, 1.5, windowH);
		ctx.fillRect(width - 1.5, windowTop, 1.5, windowH);
	}

	private pruneChanges(): void {
		if (this.changes.size === 0) return;
		const now = this.now();
		for (const [rowId, at] of this.changes) if (now - at > CHANGE_FADE_MS) this.changes.delete(rowId);
		// Keep fading without waiting for another layout pass.
		if (this.changes.size > 0 && this.fadeTimer === null) {
			this.fadeTimer = this.scheduler.timeout(() => {
				this.fadeTimer = null;
				this.redraw();
			}, FADE_STEP_MS);
		}
	}

	/** Edit marks change appearance as they age: quantised so a fade step redraws, nothing else does. */
	private changesKey(): string {
		if (this.changes.size === 0) return '';
		const now = this.now();
		let key = '';
		for (const [rowId, at] of this.changes) key += `${rowId}:${Math.floor((now - at) / FADE_STEP_MS)},`;
		return key;
	}

	private scrollTo(event: PointerEvent): void {
		const rect = this.element.getBoundingClientRect();
		if (rect.height <= 0) return;
		this.source.scrollToFraction(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
	}

	private readonly onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		this.dragging = true;
		this.element.setPointerCapture?.(event.pointerId);
		this.scrollTo(event);
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		if (this.dragging) this.scrollTo(event);
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		if (!this.dragging) return;
		this.dragging = false;
		this.element.releasePointerCapture?.(event.pointerId);
	};
}
