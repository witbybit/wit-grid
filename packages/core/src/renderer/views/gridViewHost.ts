import type { GridEngine } from '../../engine/GridEngine.js';
import { GridEventName } from '../../api/GridEvents.js';
import type { GridViewConfig } from '../../views.js';
import type { GridLayoutPlan } from '../layoutPlan.js';
import { defaultGridScheduler } from '../gridScheduler.js';
import { createCalendarView } from './calendarView.js';
import { createGalleryView } from './galleryView.js';
import type { GridViewContext, GridViewInstance, ViewRow } from './viewContext.js';

const ISOLATED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'wheel'] as const;

/**
 * Shows the configured view (gallery, calendar) over the table's area, below the group panel and
 * filter chips, and redraws it when the displayed rows or their values change. The table keeps its
 * state underneath, hidden, so switching back is instant.
 */
export class GridViewHost<TRowData> {
	private config: GridViewConfig<TRowData> | null = null;
	private view: GridViewInstance | null = null;
	private frame = 0;
	private size = '';
	private readonly unsubscribers: (() => void)[] = [];

	constructor(
		private readonly element: HTMLDivElement,
		private readonly container: HTMLElement,
		private readonly engine: GridEngine<TRowData>
	) {
		element.hidden = true;
		// The view is its own surface: its clicks, drags and keys must not reach the hidden table's
		// selection and focus handling on the container.
		const isolate = (event: Event) => event.stopPropagation();
		for (const type of ISOLATED_EVENTS) element.addEventListener(type, isolate);
		this.unsubscribers.push(() => {
			for (const type of ISOLATED_EVENTS) element.removeEventListener(type, isolate);
		});
		const redraw = () => this.scheduleRender();
		this.unsubscribers.push(
			engine.stateManager.subscribeToKey('view', () => this.apply()),
			engine.subscribeDomain('rows', redraw),
			engine.subscribeDomain('columns', () => this.rebuild()),
			engine.addEventListener(GridEventName.cellValueChanged, redraw),
			engine.addEventListener(GridEventName.rowsUpdated, redraw)
		);
		this.apply();
	}

	public dispose(): void {
		for (const off of this.unsubscribers) off();
		this.unsubscribers.length = 0;
		if (this.frame) defaultGridScheduler.cancelRaf(this.frame);
		this.view?.destroy();
		this.view = null;
		this.container.classList.remove('og-view-active');
	}

	/** Each layout pass: the area below the top chrome is the view's. */
	public sync(plan: GridLayoutPlan): void {
		const top = plan.chrome.groupPanelHeight + plan.chrome.filterChipBarHeight;
		const height = Math.max(0, plan.origins.bottomChromeTop - top);
		const size = `${top}|${height}|${plan.viewport.width}`;
		if (size === this.size) return;
		this.size = size;
		this.element.style.top = `${top}px`;
		this.element.style.height = `${height}px`;
		this.scheduleRender();
	}

	private apply(): void {
		const next = (this.engine.getState().view ?? null) as GridViewConfig<TRowData> | null;
		if (next === this.config) return;
		this.config = next;
		this.rebuild();
	}

	private rebuild(): void {
		this.view?.destroy();
		this.view = null;
		const config = this.config;
		this.element.hidden = !config;
		this.container.classList.toggle('og-view-active', !!config);
		if (!config) return;
		const context = this.context();
		this.view = config.kind === 'gallery' ? createGalleryView(this.element, context, config) : createCalendarView(this.element, context, config);
		this.view.render();
	}

	private scheduleRender(): void {
		if (!this.view || this.frame) return;
		this.frame = defaultGridScheduler.raf(() => {
			this.frame = 0;
			this.view?.render();
		});
	}

	private context(): GridViewContext<TRowData> {
		const engine = this.engine;
		return {
			api: engine.getApiRef(),
			rows: () => {
				const model = engine.getRowModel();
				const rows: ViewRow<TRowData>[] = [];
				if (!model) return rows;
				const count = model.getVisualRowCount();
				for (let i = 0; i < count; i++) {
					const row = model.getVisualRow(i);
					if (row?.kind === 'data' && row.node.data != null) rows.push({ id: row.rowId, data: row.node.data });
				}
				return rows;
			},
			columns: () => engine.getDisplayedColumns(),
			openInTable: (rowId) => {
				engine.setView(null);
				engine.getApiRef().scrollToRow(rowId, { select: true });
			},
		};
	}
}
