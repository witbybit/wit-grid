import { parseCellDate } from '../../../cells/format.js';
import type { PersonOption } from '../../../cells/renderers.js';
import { fromDay, toDay, today, type Day, type DaySpan } from '../../../records/days.js';
import type { DependencyLink, DependencyType, RecordReader, RecordRow } from '../../../records/recordModel.js';
import { resourceLoad, type ResourceLoad } from '../../../records/schedule/resources.js';
import { DEPENDENCY_LABELS, ScheduleModel, type ScheduleChange, type ScheduleTask } from '../../../records/schedule/scheduleModel.js';
import { TIME_ZOOMS, TimeScale, ZOOM_DAY_WIDTH, type TimeZoom } from '../../../records/schedule/timeScale.js';
import { WorkCalendar } from '../../../records/schedule/workCalendar.js';
import type { GanttViewConfig } from '../../../views.js';
import { defaultGridScheduler } from '../../gridScheduler.js';
import { FieldValue } from '../fieldValue.js';
import { icon } from '../icons.js';
import { optionPill, personChip } from '../recordParts.js';
import { dependencyWrite, progressWrite, spanWrites } from '../recordWrites.js';
import { avatar, button, formatDay, h, hue, progressBar } from '../ui.js';
import type {
	InspectorTab,
	WorkspaceCommand,
	WorkspaceMetric,
	WorkspaceView,
	WorkspaceViewContext,
	WorkspaceViewModule,
	ViewSettingsSection,
} from '../viewTypes.js';
import { addViewStyles } from '../workspaceStyles.js';

const HEAD_H = 54;
const OVERSCAN_ROWS = 8;
const PAD_DAYS: Record<TimeZoom, number> = { day: 7, week: 21, month: 60, quarter: 120, year: 240 };
const ZOOM_LABEL: Record<TimeZoom, string> = { day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years' };
/** Toolbar toggle keys to their configuration fields. */
const CONFIG_KEY = { deps: 'dependencies', baseline: 'baseline', critical: 'criticalPath', workload: 'workload' } as const;
const SVG = 'http://www.w3.org/2000/svg';

type DragMode = 'move' | 'start' | 'end' | 'progress' | 'link';
interface Drag {
	mode: DragMode;
	task: ScheduleTask<unknown>;
	pointerId: number;
	x: number;
	y: number;
	moved: boolean;
	delta: number;
	progress: number;
	bar: HTMLElement;
	tip: HTMLElement;
	line?: SVGPathElement;
}

function create<T>(host: HTMLElement, context: WorkspaceViewContext<T>, initial: GanttViewConfig<T>): WorkspaceView {
	addViewStyles(host.ownerDocument, 'gantt', GANTT_STYLES);
	let config = initial;
	const motion = context.motion;
	let rowH = Math.max(28, Math.floor(config.rowHeight ?? 36));
	let calendar = new WorkCalendar(config.calendar);
	let zoom: TimeZoom = config.zoom ?? 'week';
	let painted = false;
	/** A day to centre on once the next render has laid out the new scale (zoom, fit). */
	let pendingCenter: Day | null = null;
	/** Layers, zoom, scheduling: the view's configuration (saved with it, changed in place). */
	const configure = (patch: Partial<GanttViewConfig<T>>) => context.updateView(patch);
	// The outline's width: the user's (kept across switches), else the config's, else a share of the view.
	let paneWidth: number =
		context.memory<number | null>('paneWidth', null) ??
		Math.round(Math.min(config.taskPaneWidth ?? 470, Math.max(260, (host.clientWidth || 1200) * 0.42)));
	let showDeps = config.dependencies ?? true;
	let showBaseline = config.baseline ?? true;
	let showCritical = config.criticalPath ?? false;
	let showWorkload = config.workload ?? false;
	let mode: 'off' | 'push' | 'tight' = config.autoSchedule ?? 'push';
	const collapsed = new Set<string>(context.memory<string[]>('collapsed', []));

	const root = h('div', 'og-ws-gantt');
	const scroller = h('div', 'og-ws-gantt-scroll', { role: 'treegrid', 'aria-label': 'Schedule' });
	const head = h('div', 'og-ws-gantt-head');
	const corner = h('div', 'og-ws-gantt-corner', { role: 'row' });
	const scale = h('div', 'og-ws-gantt-scale', { 'aria-hidden': 'true' });
	const majors = h('div', 'og-ws-gantt-major');
	const minors = h('div', 'og-ws-gantt-minor');
	const todayChip = h('div', 'og-ws-gantt-today-chip', null, 'Today');
	scale.append(majors, minors, todayChip);
	head.append(corner, scale);
	const body = h('div', 'og-ws-gantt-body');
	const outline = h('div', 'og-ws-gantt-outline', { role: 'rowgroup' });
	const chart = h('div', 'og-ws-gantt-chart');
	const shade = h('div', 'og-ws-gantt-shade');
	const grid = h('div', 'og-ws-gantt-gridlines');
	const bands = h('div', 'og-ws-gantt-bands');
	const links = document.createElementNS(SVG, 'svg');
	links.setAttribute('class', 'og-ws-gantt-links');
	links.innerHTML = `<defs><marker id="og-ws-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" fill="context-stroke"/></marker></defs>`;
	const bars = h('div', 'og-ws-gantt-bars');
	const todayLine = h('div', 'og-ws-gantt-today');
	chart.append(shade, grid, bands, links, bars, todayLine);
	body.append(outline, chart);
	// Workload: each person's concurrent open tasks along the same timeline, docked under the rows.
	const workload = h('div', 'og-ws-gantt-workload', { hidden: true, 'aria-label': 'Workload' });
	const workloadNames = h('div', 'og-ws-gantt-wl-names');
	const workloadChart = h('div', 'og-ws-gantt-wl-chart');
	workload.append(workloadNames, workloadChart);
	scroller.append(head, body, workload);
	const resize = h('div', 'og-ws-gantt-resize', {
		role: 'separator',
		'aria-orientation': 'vertical',
		'aria-label': 'Resize task outline',
		tabindex: 0,
	});
	const minimap = h('div', 'og-ws-gantt-minimap', { title: 'Overview: drag to navigate' });
	const miniCanvas = h('canvas', 'og-ws-gantt-minimap-canvas');
	const miniWindow = h('div', 'og-ws-gantt-minimap-window');
	minimap.append(miniCanvas, miniWindow);
	const legend = h(
		'div',
		'og-ws-gantt-legend',
		null,
		h('span', null, null, h('i', 'og-ws-lg-summary'), 'Summary'),
		h('span', null, null, h('i', 'og-ws-lg-task'), 'Task'),
		h('span', null, null, h('i', 'og-ws-lg-milestone'), 'Milestone'),
		h('span', null, null, h('i', 'og-ws-lg-baseline'), 'Baseline'),
		h('span', null, null, h('i', 'og-ws-lg-dep'), 'Dependency'),
		h('span', null, null, h('i', 'og-ws-lg-critical'), 'Critical path')
	);
	const empty = h('div', 'og-ws-empty', { hidden: true });
	root.append(scroller, resize, minimap, legend, empty);
	host.append(root);

	let reader: RecordReader<T> = context.reader();
	let model = new ScheduleModel<T>([], reader, calendar);
	let tasks: ScheduleTask<T>[] = [];
	let indexById = new Map<string, number>();
	let critical = new Set<string>();
	let loads: ResourceLoad[] = [];
	let violations = new Set<DependencyLink>();
	let timeScale = new TimeScale(today(), zoom);
	let range: DaySpan = { start: today() - 30, end: today() + 60 };
	let frame = 0;
	let drag: Drag | null = null;
	const outlineRows = new Map<string, { element: HTMLElement; fields: FieldValue<T>[]; version: unknown }>();
	const barEls = new Map<string, { element: HTMLElement; version: unknown }>();
	let hoverIndex = -1;
	const hover = h('div', 'og-ws-gantt-hover');
	bands.append(hover);

	const extraColumns = () => (config.fields ?? []).map((field) => reader.column(field)).filter((col): col is NonNullable<typeof col> => !!col);

	const outlineColumns = () => {
		const roles = reader.roles;
		const cols: { key: string; label: string; width: number }[] = [
			{ key: 'select', label: '', width: 30 },
			{ key: 'wbs', label: '#', width: 42 },
			{ key: 'title', label: reader.column(roles.title)?.header ?? 'Task', width: 0 },
		];
		const optional: { key: string; label: string; width: number }[] = [];
		if (roles.owner) optional.push({ key: 'owner', label: reader.column(roles.owner)?.header ?? 'Owner', width: 52 });
		if (roles.status) optional.push({ key: 'status', label: reader.column(roles.status)?.header ?? 'Status', width: 96 });
		if (roles.progress) optional.push({ key: 'progress', label: 'Progress', width: 92 });
		for (const col of extraColumns()) optional.push({ key: `field:${col.field}`, label: col.header ?? col.field, width: 110 });
		// The title keeps at least 150px: columns drop from the end as the outline narrows.
		let room = paneWidth - 72 - 150;
		for (const col of optional) {
			if (col.width > room) break;
			cols.push(col);
			room -= col.width;
		}
		return cols;
	};

	// ─── Projection ──────────────────────────────────────────────────────

	const project = () => {
		reader = context.reader();
		model = new ScheduleModel(context.rows() as RecordRow<T>[], reader, calendar);
		tasks = model.visible(collapsed);
		indexById = new Map(tasks.map((task, i) => [task.id, i]));
		critical = showCritical ? model.critical() : new Set();
		loads = showWorkload
			? [...resourceLoad(model, reader.roles.owner).values()].sort((a, b) => b.overDays.length - a.overDays.length || b.peak - a.peak)
			: [];
		violations = new Set(model.violations().map((violation) => violation.link));
		const extent = model.extent();
		const pad = PAD_DAYS[zoom];
		const start = (extent?.start ?? today()) - pad;
		const monday = start - ((((start + 3) % 7) + 7) % 7); // align to Monday
		const viewportDays = Math.ceil((scroller.clientWidth || 1200) / ZOOM_DAY_WIDTH[zoom]);
		range = { start: monday, end: Math.max((extent?.end ?? today()) + pad, monday + viewportDays) };
		timeScale = new TimeScale(range.start, zoom);
	};

	const chartWidth = () => (range.end - range.start + 1) * timeScale.dayWidth;

	// ─── Frame: header, shading, grid ───────────────────────────────────

	const layoutFrame = () => {
		const width = chartWidth();
		const height = Math.max(tasks.length * rowH, 1);
		root.style.setProperty('--og-ws-pane', `${paneWidth}px`);
		root.style.setProperty('--og-ws-row', `${rowH}px`);
		head.style.width = body.style.width = `${paneWidth + width}px`;
		scale.style.width = chart.style.width = `${width}px`;
		outline.style.height = chart.style.height = `${height}px`;
		links.setAttribute('width', String(width));
		links.setAttribute('height', String(height));
		// Weekends: one repeating gradient aligned to the range's Monday (any length, no elements).
		const dw = timeScale.dayWidth;
		if (zoom === 'day' || zoom === 'week') {
			shade.style.display = '';
			shade.style.backgroundImage = `linear-gradient(90deg, transparent ${5 * dw}px, var(--og-ws-weekend) ${5 * dw}px, var(--og-ws-weekend) ${7 * dw}px)`;
			shade.style.backgroundSize = `${7 * dw}px 100%`;
		} else shade.style.display = 'none';
		const now = today();
		todayLine.hidden = todayChip.hidden = now < range.start || now > range.end;
		todayLine.style.transform = todayChip.style.transform = `translateX(${timeScale.x(now) + dw / 2}px)`;
		// Outline header.
		corner.replaceChildren(
			...outlineColumns().map((col) =>
				col.key === 'select'
					? h('span', 'og-ws-gantt-cell og-ws-gantt-c-select', { role: 'columnheader' })
					: h(
							'span',
							`og-ws-gantt-cell og-ws-gantt-c-${col.key.replace(':', '-')}`,
							{ role: 'columnheader', style: col.width ? `flex: 0 0 ${col.width}px` : undefined },
							col.label
						)
			)
		);
	};

	const paintScale = () => {
		const left = scroller.scrollLeft - paneWidth;
		const from = Math.max(range.start, timeScale.dayAt(Math.max(0, left)) - 7);
		const to = Math.min(range.end + 1, timeScale.dayAt(left + scroller.clientWidth) + 8);
		const ticks = timeScale.ticks(from, to);
		majors.replaceChildren(
			...ticks.major.map((tick) => {
				const el = h(
					'div',
					'og-ws-gantt-tick',
					null,
					h('strong', null, null, tick.label),
					tick.detail && zoom !== 'day' ? h('span', null, null, tick.detail) : null
				);
				el.style.transform = `translateX(${tick.x}px)`;
				el.style.width = `${tick.width}px`;
				// The period under the left edge keeps its label in view (it slides out with the period).
				const hidden = scroller.scrollLeft - tick.x;
				if (hidden > 0) el.style.paddingLeft = `${8 + Math.min(hidden, Math.max(0, tick.width - 130))}px`;
				return el;
			})
		);
		minors.replaceChildren(
			...ticks.minor.map((tick) => {
				const el = h(
					'div',
					`og-ws-gantt-tick${tick.quiet ? ' og-ws-quiet' : ''}${tick.start <= today() && today() < tick.end ? ' og-ws-now' : ''}`,
					{ title: tick.detail },
					tick.width > 22 ? tick.label : ''
				);
				el.style.transform = `translateX(${tick.x}px)`;
				el.style.width = `${tick.width}px`;
				return el;
			})
		);
		grid.style.backgroundImage = `linear-gradient(90deg, var(--og-ws-gridline) 1px, transparent 1px)`;
		const minorWidth = ticks.minor[0]?.width ?? 7 * timeScale.dayWidth;
		grid.style.backgroundSize = `${zoom === 'day' ? timeScale.dayWidth : minorWidth}px 100%`;
		grid.style.backgroundPosition = `${ticks.minor[0] ? ticks.minor[0].x % (zoom === 'day' ? timeScale.dayWidth : minorWidth) : 0}px 0`;
	};

	// ─── Rows (one virtualization plan for outline and chart) ───────────

	const visibleRange = () => {
		const top = scroller.scrollTop;
		const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN_ROWS);
		const last = Math.min(tasks.length - 1, Math.ceil((top + (scroller.clientHeight || 800)) / rowH) + OVERSCAN_ROWS);
		return { first, last };
	};

	const buildOutlineRow = (task: ScheduleTask<T>, fields: FieldValue<T>[]) => {
		const row = task.row;
		const element = h('div', 'og-ws-gantt-row', { role: 'row', 'data-record-id': row.id, 'aria-level': task.depth + 1, tabindex: -1 });
		fillOutlineRow(element, task, fields);
		return element;
	};

	const fillOutlineRow = (element: HTMLElement, task: ScheduleTask<T>, fields: FieldValue<T>[]) => {
		for (const field of fields) field.destroy();
		fields.length = 0;
		const row = task.row;
		const roles = reader.roles;
		element.toggleAttribute('data-summary', task.summary);
		element.toggleAttribute('data-critical', critical.has(task.id));
		if (task.summary) element.setAttribute('aria-expanded', String(!collapsed.has(task.id)));
		else element.removeAttribute('aria-expanded');
		const select = h('input', 'og-ws-gantt-check', { type: 'checkbox', 'aria-label': `Select ${reader.title(row)}`, 'data-no-select': '' });
		select.checked = context.selected().has(row.id);
		select.addEventListener('click', (event) => {
			event.stopPropagation();
			context.select(
				row.id,
				event.shiftKey ? 'range' : 'toggle',
				tasks.map((t) => t.id)
			);
		});
		const title = h('span', 'og-ws-gantt-cell og-ws-gantt-c-title');
		title.style.paddingLeft = `${6 + task.depth * 18}px`;
		if (task.summary) {
			const toggle = h(
				'button',
				'og-ws-gantt-toggle',
				{ type: 'button', 'aria-label': collapsed.has(task.id) ? 'Expand' : 'Collapse', 'data-no-select': '' },
				icon(collapsed.has(task.id) ? 'chevronRight' : 'chevronDown', 14)
			);
			toggle.addEventListener('click', (event) => {
				event.stopPropagation();
				toggleTask(task.id);
			});
			title.append(toggle, h('span', 'og-ws-gantt-folder', null, icon('layout', 14)));
		} else
			title.append(
				h('span', `og-ws-gantt-kind${task.milestone ? ' og-ws-gantt-kind-milestone' : ''}`, null, task.milestone ? icon('diamond', 12) : '')
			);
		title.append(h('span', 'og-ws-gantt-title-text', { title: reader.title(row) }, reader.title(row)));
		const cells: HTMLElement[] = [
			h('span', 'og-ws-gantt-cell og-ws-gantt-c-select', null, select),
			h('span', 'og-ws-gantt-cell og-ws-gantt-c-wbs', null, task.wbs),
			title,
		];
		for (const col of outlineColumns().slice(3)) {
			const cell = h('span', `og-ws-gantt-cell og-ws-gantt-c-${col.key.replace(':', '-')}`, { style: `flex: 0 0 ${col.width}px` });
			if (col.key === 'owner') cell.append(personChip(reader, row, roles.owner, false) ?? '');
			else if (col.key === 'status') cell.append(task.summary ? '' : (optionPill(reader, row, roles.status) ?? ''));
			else if (col.key === 'progress') cell.append(progressBar(task.progress, { label: true }));
			else {
				const field = new FieldValue(reader.column(col.key.slice(6))!, context.api);
				field.show(row);
				fields.push(field);
				cell.append(field.element);
			}
			cells.push(cell);
		}
		element.replaceChildren(...cells);
	};

	const barGeometry = (span: DaySpan) => {
		const x = timeScale.x(span.start);
		return { x, width: Math.max(timeScale.dayWidth, timeScale.x(span.end + 1) - x) };
	};

	const buildBar = (task: ScheduleTask<T>): HTMLElement => {
		const element = h('div', 'og-ws-gantt-bar', { 'data-record-id': task.id, role: 'presentation' });
		fillBar(element, task);
		return element;
	};

	const fillBar = (element: HTMLElement, task: ScheduleTask<T>) => {
		const row = task.row;
		const editable = config.editable !== false && !task.summary && canSchedule(row);
		element.className = `og-ws-gantt-bar${task.summary ? ' og-ws-gantt-summary' : ''}${task.milestone ? ' og-ws-gantt-milestone' : ''}${critical.has(task.id) ? ' og-ws-gantt-critical' : ''}${task.done ? ' og-ws-done' : ''}`;
		element.toggleAttribute('data-editable', editable || (task.summary && config.editable !== false));
		element.replaceChildren();
		if (!task.span) return;
		const accent = task.summary ? 'var(--og-ws-summary)' : (context.accent(row) ?? 'var(--og-focus-ring)');
		element.style.setProperty('--og-ws-bar', critical.has(task.id) && !task.summary ? 'var(--og-ws-critical)' : accent);
		const { x, width } = barGeometry(task.span);
		const label = `${reader.title(row)} · ${formatDay(fromDay(task.span.start))} – ${formatDay(fromDay(task.span.end))}`;
		element.setAttribute('aria-label', label);
		element.title = label;
		if (task.milestone) {
			element.style.width = '18px';
			element.append(
				h('span', 'og-ws-gantt-diamond'),
				h(
					'span',
					'og-ws-gantt-label og-ws-gantt-label-out',
					null,
					h('strong', null, null, reader.title(row)),
					h('span', null, null, formatDay(fromDay(task.span.start)))
				)
			);
			if (editable)
				element.append(h('span', 'og-ws-gantt-handle og-ws-gantt-link-handle', { 'data-handle': 'link', title: 'Drag to link a successor' }));
			return;
		}
		element.style.width = `${width}px`;
		const fill = h('span', 'og-ws-gantt-fill');
		fill.style.width = `${task.progress * 100}%`;
		element.append(fill);
		const percent = `${Math.round(task.progress * 100)}%`;
		if (task.summary) {
			element.append(
				h(
					'span',
					'og-ws-gantt-label og-ws-gantt-label-out',
					null,
					`${percent} · ${formatDay(fromDay(task.span.start))} – ${formatDay(fromDay(task.span.end))}`
				)
			);
			return;
		}
		if (width > 46) element.append(h('span', 'og-ws-gantt-label og-ws-gantt-label-in', null, percent));
		else element.append(h('span', 'og-ws-gantt-label og-ws-gantt-label-out', null, percent));
		if (editable) {
			element.append(
				h('span', 'og-ws-gantt-handle og-ws-gantt-resize-start', { 'data-handle': 'start', title: 'Drag to change the start' }),
				h('span', 'og-ws-gantt-handle og-ws-gantt-resize-end', { 'data-handle': 'end', title: 'Drag to change the end' }),
				h('span', 'og-ws-gantt-handle og-ws-gantt-link-handle', { 'data-handle': 'link', title: 'Drag to link a successor' })
			);
			if (reader.roles.progress && context.canEdit(row.id, reader.roles.progress)) {
				const knob = h('span', 'og-ws-gantt-handle og-ws-gantt-progress-handle', {
					'data-handle': 'progress',
					title: 'Drag to set progress',
				});
				knob.style.left = `${task.progress * 100}%`;
				element.append(knob);
			}
		}
	};

	const baselineEls = new Map<string, HTMLElement>();
	/** Where a task's bar starts (milestones centre their diamond on the day). */
	const barX = (task: ScheduleTask<T>) =>
		task.span ? (task.milestone ? timeScale.x(task.span.start) + timeScale.dayWidth / 2 - 9 : timeScale.x(task.span.start)) : 0;
	/**
	 * Draws the rows in view. `glide` (data, collapse, settings — not scroll or zoom): rows slide to their
	 * new place in the outline and bars to their new dates, so a reschedule is seen happening.
	 */
	const paintRows = (glide = false) => {
		frame = 0;
		let entering = 0;
		const { first, last } = visibleRange();
		const selected = context.selected();
		const focused = context.focused();
		const wanted = new Set<string>();
		for (let i = first; i <= last; i++) {
			const task = tasks[i];
			if (!task) continue;
			wanted.add(task.id);
			const top = i * rowH;
			let outlineRow = outlineRows.get(task.id);
			const fresh = !outlineRow;
			if (!outlineRow) {
				const fields: FieldValue<T>[] = [];
				outlineRow = { element: buildOutlineRow(task, fields), fields, version: task.row.data };
				outlineRows.set(task.id, outlineRow);
				outline.append(outlineRow.element);
			} else if (outlineRow.version !== task.row.data || outlineRow.element.dataset.stale) {
				fillOutlineRow(outlineRow.element, task, outlineRow.fields);
				outlineRow.version = task.row.data;
				delete outlineRow.element.dataset.stale;
			}
			motion.place(outlineRow.element, 0, top, glide);
			if (fresh && glide && painted) motion.enter(outlineRow.element, Math.min(entering++, 12) * 16);
			outlineRow.element.toggleAttribute('data-selected', selected.has(task.id));
			outlineRow.element.toggleAttribute('data-focused', focused === task.id);
			outlineRow.element.tabIndex = focused === task.id ? 0 : -1;
			const check = outlineRow.element.querySelector<HTMLInputElement>('.og-ws-gantt-check');
			if (check) check.checked = selected.has(task.id);
			let bar = barEls.get(task.id);
			if (!bar) {
				bar = { element: buildBar(task), version: task.row.data };
				barEls.set(task.id, bar);
				bars.append(bar.element);
			} else if (bar.version !== task.row.data || bar.element.dataset.stale) {
				fillBar(bar.element, task);
				bar.version = task.row.data;
				delete bar.element.dataset.stale;
			}
			bar.element.dataset.top = String(top);
			motion.place(bar.element, barX(task), top, glide);
			if (fresh && glide && painted) motion.enter(bar.element, Math.min(entering, 12) * 16);
			bar.element.toggleAttribute('data-selected', selected.has(task.id));
			// Baseline beneath the bar.
			const baseline = showBaseline && task.baseline && task.span ? task.baseline : null;
			let baseEl = baselineEls.get(task.id);
			if (baseline) {
				if (!baseEl) {
					baseEl = h('div', 'og-ws-gantt-baseline');
					baselineEls.set(task.id, baseEl);
					bars.prepend(baseEl);
				}
				const { x, width } = barGeometry(baseline);
				baseEl.style.width = `${width}px`;
				motion.place(baseEl, x, top + rowH - 9, glide);
				const variance = model.variance(task.id) ?? 0;
				baseEl.toggleAttribute('data-late', variance > 0);
				baseEl.title = `Baseline ${formatDay(fromDay(baseline.start))} – ${formatDay(fromDay(baseline.end))}${variance ? ` · ${variance > 0 ? '+' : ''}${variance}d` : ''}`;
			} else if (baseEl) {
				baseEl.remove();
				baselineEls.delete(task.id);
			}
		}
		for (const [id, entry] of outlineRows)
			if (!wanted.has(id) && !entry.element.contains(document.activeElement)) {
				entry.fields.forEach((field) => field.destroy());
				outlineRows.delete(id);
				// Collapsed away or filtered out: fade. Scrolled away: just go.
				if (glide && !indexById.has(id)) motion.leave(entry.element);
				else {
					motion.forget(entry.element);
					entry.element.remove();
				}
			}
		for (const [id, entry] of barEls)
			if (!wanted.has(id) && drag?.task.id !== id) {
				barEls.delete(id);
				if (glide && !indexById.has(id)) motion.leave(entry.element);
				else {
					motion.forget(entry.element);
					entry.element.remove();
				}
			}
		for (const [id, element] of baselineEls)
			if (!wanted.has(id)) {
				element.remove();
				baselineEls.delete(id);
			}
		// Selection bands across the chart.
		for (const band of bands.querySelectorAll('.og-ws-gantt-band')) band.remove();
		for (const id of selected) {
			const index = indexById.get(id);
			if (index === undefined || index < first || index > last) continue;
			const band = h('div', 'og-ws-gantt-band');
			band.style.transform = `translateY(${index * rowH}px)`;
			bands.append(band);
		}
		paintLinks(first, last);
		paintScale();
		paintWorkload();
		paintMinimapWindow();
		painted = true;
	};

	const WL_ROW = 30;
	const WL_ROWS = 6;
	const paintWorkload = () => {
		workload.hidden = !showWorkload || !reader.roles.owner;
		// The minimap floats above the workload panel.
		minimap.style.bottom = `${(workload.hidden ? 0 : Math.min(6, loads.length) * 30 + 24) + 40}px`;
		if (workload.hidden) return;
		const shown = loads.slice(0, WL_ROWS);
		workload.style.width = `${paneWidth + chartWidth()}px`;
		workloadChart.style.width = `${chartWidth()}px`;
		workloadChart.style.height = workloadNames.style.height = `${Math.max(1, shown.length) * WL_ROW + 24}px`;
		workloadNames.replaceChildren(
			h(
				'div',
				'og-ws-gantt-wl-title',
				null,
				icon('resource', 14),
				`Workload · ${loads.length} ${loads.length === 1 ? 'person' : 'people'}`,
				loads.length > WL_ROWS ? h('span', 'og-ws-hint', null, ` (top ${WL_ROWS})`) : null
			),
			...shown.map((load) => {
				const option = reader.option(reader.roles.owner, load.resource) as PersonOption | undefined;
				const row = h(
					'div',
					'og-ws-gantt-wl-person',
					{ title: `${option?.label ?? load.resource}: ${load.tasks.length} tasks, peak ${load.peak} at once` },
					avatar(option, load.resource),
					h('span', 'og-ws-person-name', null, option?.label ?? load.resource)
				);
				if (load.overDays.length) row.append(h('span', 'og-ws-gantt-wl-over', null, `${load.overDays.length}d over`));
				return row;
			})
		);
		if (!shown.length) workloadNames.append(h('div', 'og-ws-hint', null, 'Nobody is assigned.'));
		// Bars only for the days in view; buckets of a week when days get thin.
		const left = scroller.scrollLeft - paneWidth;
		const from = Math.max(range.start, timeScale.dayAt(Math.max(0, left)) - 7);
		const to = Math.min(range.end, timeScale.dayAt(left + scroller.clientWidth) + 7);
		const bucket = timeScale.dayWidth >= 6 ? 1 : 7;
		const start = bucket === 7 ? from - ((((from + 3) % 7) + 7) % 7) : from;
		const fragment = document.createDocumentFragment();
		shown.forEach((load, i) => {
			for (let day = start; day <= to; day += bucket) {
				let peak = 0;
				for (let d = day; d < day + bucket; d++) peak = Math.max(peak, load.daily.get(d) ?? 0);
				if (!peak) continue;
				const bar = h('span', `og-ws-gantt-wl-bar${peak > 1 ? ' og-ws-gantt-wl-bar-over' : ''}`, {
					title: `${formatDay(fromDay(day))}${bucket > 1 ? ' week' : ''}: ${peak} open task${peak === 1 ? '' : 's'}`,
				});
				const height = Math.min(1, peak / 3) * (WL_ROW - 8);
				bar.style.transform = `translate(${timeScale.x(day) + 1}px, ${24 + i * WL_ROW + (WL_ROW - 4 - height)}px)`;
				bar.style.width = `${Math.max(1, bucket * timeScale.dayWidth - 2)}px`;
				bar.style.height = `${height}px`;
				if (peak > 1) bar.textContent = timeScale.dayWidth * bucket > 16 ? String(peak) : '';
				fragment.append(bar);
			}
		});
		workloadChart.replaceChildren(fragment);
	};

	const paintLinks = (first: number, last: number) => {
		for (const path of links.querySelectorAll('path.og-ws-gantt-link')) path.remove();
		if (!showDeps) return;
		const fragment = document.createDocumentFragment();
		for (const link of model.links) {
			const a = indexById.get(link.from);
			const b = indexById.get(link.to);
			if (a === undefined || b === undefined) continue;
			if ((a < first && b < first) || (a > last && b > last)) continue;
			const from = tasks[a].span;
			const to = tasks[b].span;
			if (!from || !to) continue;
			const startSide = link.type === 'SS' || link.type === 'SF';
			const endSide = link.type === 'FS' || link.type === 'SS';
			const x1 = startSide ? timeScale.x(from.start) : timeScale.x(from.end + 1);
			const x2 = endSide ? timeScale.x(to.start) : timeScale.x(to.end + 1);
			const y1 = a * rowH + rowH / 2;
			const y2 = b * rowH + rowH / 2;
			const out = startSide ? -10 : 10;
			const into = endSide ? -10 : 10;
			const midY = b > a ? b * rowH + 2 : b * rowH + rowH - 2;
			let d: string;
			if ((endSide && x1 + out <= x2 + into) || (!endSide && x1 + out >= x2 + into)) {
				// Room for a simple elbow: out, down, in.
				const turn = endSide ? Math.max(x1 + out, x2 + into) : Math.min(x1 + out, x2 + into);
				d = `M${x1} ${y1}H${turn}V${y2}H${x2}`;
			} else d = `M${x1} ${y1}H${x1 + out}V${midY}H${x2 + into}V${y2}H${x2}`;
			const path = document.createElementNS(SVG, 'path');
			path.setAttribute('d', d);
			const isCritical = showCritical && critical.has(link.from) && critical.has(link.to);
			path.setAttribute('class', `og-ws-gantt-link${violations.has(link) ? ' og-ws-violated' : ''}${isCritical ? ' og-ws-critical' : ''}`);
			path.setAttribute('marker-end', 'url(#og-ws-arrow)');
			const title = document.createElementNS(SVG, 'title');
			title.textContent = `${DEPENDENCY_LABELS[link.type]}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''}${violations.has(link) ? ' — not satisfied' : ''}`;
			path.append(title);
			fragment.append(path);
		}
		links.append(fragment);
	};

	// ─── Minimap ─────────────────────────────────────────────────────────

	const paintMinimap = () => {
		const width = 240;
		const height = 56;
		const ratio = window.devicePixelRatio || 1;
		miniCanvas.width = width * ratio;
		miniCanvas.height = height * ratio;
		miniCanvas.style.width = `${width}px`;
		miniCanvas.style.height = `${height}px`;
		const ctx = miniCanvas.getContext?.('2d');
		if (!ctx) return;
		ctx.scale(ratio, ratio);
		ctx.clearRect(0, 0, width, height);
		const days = range.end - range.start + 1;
		const sx = width / days;
		const sy = Math.min(3, height / Math.max(1, tasks.length));
		const styles = getComputedStyle(root);
		for (const [i, task] of tasks.entries()) {
			if (!task.span) continue;
			ctx.fillStyle = task.summary
				? styles.getPropertyValue('--og-ws-summary').trim() || '#3b82f6'
				: critical.has(task.id)
					? '#f43f5e'
					: (context.accent(task.row) ?? '#60a5fa');
			ctx.globalAlpha = task.summary ? 0.9 : 0.75;
			ctx.fillRect(
				(task.span.start - range.start) * sx,
				i * sy,
				Math.max(1, (task.span.end - task.span.start + 1) * sx),
				Math.max(1, sy - 0.5)
			);
		}
		ctx.globalAlpha = 1;
		const now = today();
		ctx.fillStyle = '#ef4444';
		ctx.fillRect((now - range.start) * sx, 0, 1, height);
	};

	const paintMinimapWindow = () => {
		const width = 240;
		const total = chartWidth();
		const visible = Math.max(0, scroller.clientWidth - paneWidth);
		miniWindow.style.left = `${Math.max(0, (scroller.scrollLeft / total) * width)}px`;
		miniWindow.style.width = `${Math.max(8, Math.min(width, (visible / total) * width))}px`;
		const fullHeight = Math.max(1, tasks.length * rowH);
		const top = (scroller.scrollTop / fullHeight) * 56;
		miniWindow.style.top = `${Math.min(52, top)}px`;
		miniWindow.style.height = `${Math.max(6, Math.min(56, ((scroller.clientHeight - HEAD_H) / fullHeight) * 56))}px`;
	};

	const onMinimap = (event: PointerEvent) => {
		const rect = miniCanvas.getBoundingClientRect();
		const move = (e: PointerEvent) => {
			const fx = (e.clientX - rect.left) / rect.width;
			const fy = (e.clientY - rect.top) / rect.height;
			scroller.scrollLeft = fx * chartWidth() - (scroller.clientWidth - paneWidth) / 2;
			scroller.scrollTop = fy * tasks.length * rowH - scroller.clientHeight / 2;
		};
		move(event);
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	};
	minimap.addEventListener('pointerdown', onMinimap);

	// ─── Render ──────────────────────────────────────────────────────────

	const schedulePaint = () => {
		if (!frame) frame = defaultGridScheduler.raf(paintRows);
	};

	const render = (glide = false) => {
		if (drag) return;
		project();
		const scheduled = reader.roles.schedule || reader.roles.start || reader.roles.due;
		empty.hidden = !!scheduled && tasks.length > 0;
		if (!scheduled)
			empty.replaceChildren(
				h('div', 'og-ws-empty-title', null, 'This schedule needs dates'),
				h('p', 'og-ws-hint', null, 'Add a date range column (or start and end dates), or set `records.schedule`.')
			);
		else if (!tasks.length)
			empty.replaceChildren(
				h('div', 'og-ws-empty-title', null, 'No tasks'),
				h('p', 'og-ws-hint', null, config.emptyText ?? 'No records match the current filters or search.')
			);
		for (const entry of outlineRows.values()) entry.element.dataset.stale = '1';
		for (const entry of barEls.values()) entry.element.dataset.stale = '1';
		layoutFrame();
		paintMinimap();
		paintRows(glide && painted);
	};

	const toggleTask = (id: string) => {
		if (collapsed.has(id)) collapsed.delete(id);
		else collapsed.add(id);
		context.remember('collapsed', [...collapsed]);
		render(true);
	};

	const canSchedule = (row: RecordRow<T>) => {
		const fields = [reader.roles.schedule, reader.roles.start, reader.roles.end].filter(Boolean) as string[];
		const targets = fields.length ? fields : reader.roles.due ? [reader.roles.due] : [];
		return targets.length > 0 && targets.every((field) => context.canEdit(row.id, field));
	};

	// ─── Navigation ──────────────────────────────────────────────────────

	const scrollToDay = (day: Day, align: 'start' | 'center' = 'center') => {
		const x = timeScale.x(day);
		const visible = scroller.clientWidth - paneWidth;
		scroller.scrollLeft = align === 'center' ? x - visible / 2 : x - 24;
	};

	const centerDay = () => timeScale.dayAt(scroller.scrollLeft + (scroller.clientWidth - paneWidth) / 2);

	const setZoom = (next: TimeZoom) => {
		if (next === zoom) return;
		pendingCenter = centerDay();
		configure({ zoom: next });
	};

	const fit = () => {
		const extent = model.extent();
		if (!extent) return;
		const visible = Math.max(200, scroller.clientWidth - paneWidth - 40);
		const days = extent.end - extent.start + 1;
		const best = TIME_ZOOMS.find((candidate) => days * ZOOM_DAY_WIDTH[candidate] <= visible) ?? 'year';
		pendingCenter = Math.round((extent.start + extent.end) / 2);
		if (best === zoom) {
			scrollToDay(pendingCenter);
			pendingCenter = null;
		} else configure({ zoom: best });
	};

	// ─── Writes: moves with auto-scheduling and an impact preview ───────

	const describeShift = (change: ScheduleChange) => {
		const shift = change.before ? calendar.distance(change.before.start, change.after.start) : 0;
		return shift === 0 ? 'resized' : `${shift > 0 ? '+' : ''}${shift}d`;
	};

	const applySchedule = async (anchor: ScheduleTask<T>, span: DaySpan) => {
		const anchors = new Map([[anchor.id, span]]);
		const changes =
			mode === 'off'
				? model.leaves(anchor.id).length > 1 || anchor.summary
					? model.autoSchedule({ anchors, mode: 'push' }).changes.filter((change) => model.leaves(anchor.id).includes(change.id))
					: [{ id: anchor.id, before: anchor.span, after: span }]
				: model.autoSchedule({ anchors, mode }).changes;
		if (!changes.length) return;
		const own = new Set(model.leaves(anchor.id));
		const knockOn = changes.filter((change) => !own.has(change.id));
		let chosen = changes;
		if (knockOn.length && config.confirmReschedule !== false) {
			const table = h('table', 'og-ws-impact');
			table.append(
				h(
					'thead',
					null,
					null,
					h(
						'tr',
						null,
						null,
						h('th', null, null, 'Task'),
						h('th', null, null, 'Start'),
						h('th', null, null, 'End'),
						h('th', null, null, 'Shift')
					)
				)
			);
			const tbody = h('tbody');
			for (const change of changes.slice(0, 40)) {
				const row = model.tasks.get(change.id)!.row;
				const shift = describeShift(change);
				tbody.append(
					h(
						'tr',
						null,
						null,
						h('td', null, null, h('span', 'og-ws-key', null, reader.key(row)), ' ', reader.title(row)),
						h(
							'td',
							null,
							null,
							`${change.before ? formatDay(fromDay(change.before.start)) + ' → ' : ''}${formatDay(fromDay(change.after.start))}`
						),
						h(
							'td',
							null,
							null,
							`${change.before ? formatDay(fromDay(change.before.end)) + ' → ' : ''}${formatDay(fromDay(change.after.end))}`
						),
						h('td', `og-ws-shift${shift.startsWith('-') ? ' og-ws-shift-early' : ''}`, null, shift)
					)
				);
			}
			table.append(tbody);
			const body = h(
				'div',
				null,
				null,
				h(
					'p',
					'og-ws-hint',
					null,
					`Moving “${reader.title(anchor.row)}” ${mode === 'tight' ? 'reflows' : 'pushes'} ${knockOn.length} dependent ${knockOn.length === 1 ? 'task' : 'tasks'} to keep every link satisfied (working days, ${mode === 'tight' ? 'as early as allowed' : 'later only when required'}).`
				),
				table,
				changes.length > 40 ? h('p', 'og-ws-hint', null, `…and ${changes.length - 40} more.`) : null
			);
			const answer = await context.confirm({
				title: `Reschedule ${changes.length} tasks?`,
				body,
				confirm: `Reschedule ${changes.length}`,
				alternate: 'Move only this task',
			});
			if (answer === 'cancel') return;
			if (answer === 'alternate') chosen = changes.filter((change) => own.has(change.id));
		}
		const writes = chosen.flatMap((change) => {
			const row = model.tasks.get(change.id)?.row;
			return row ? spanWrites(reader, row, change.after) : [];
		});
		context.write(
			writes,
			chosen.length > 1 ? `Rescheduled ${chosen.length} tasks` : `Moved “${reader.title(anchor.row)}” to ${formatDay(fromDay(span.start))}`
		);
	};

	const addLink = (from: string, to: string, type: DependencyType = 'FS') => {
		if (model.wouldCreateCycle(from, to)) {
			context.toast('That link would make a task wait on itself.', 'warn');
			return;
		}
		const target = model.tasks.get(to);
		if (!target || !reader.roles.dependencies) return;
		if (!context.canEdit(to, reader.roles.dependencies)) {
			context.toast('You can’t change this task’s dependencies.', 'warn');
			return;
		}
		const existing = reader.dependencies(target.row);
		if (existing.some((link) => link.from === from)) return;
		const write = dependencyWrite(reader, target.row, [...existing, { from, to, type, lag: 0 }]);
		if (write) context.write([write], `Linked ${reader.key(model.tasks.get(from)!.row)} → ${reader.key(target.row)}`);
	};

	const removeLink = (link: DependencyLink) => {
		const target = model.tasks.get(link.to);
		if (!target) return;
		const write = dependencyWrite(
			reader,
			target.row,
			reader.dependencies(target.row).filter((other) => other.from !== link.from)
		);
		if (write) context.write([write], 'Dependency removed');
	};

	// ─── Pointer: move, resize, progress, link ──────────────────────────

	const tip = h('div', 'og-ws-gantt-tip', { hidden: true });
	chart.append(tip);

	const previewSpan = (state: Drag): DaySpan | null => {
		const span = state.task.span;
		if (!span) return null;
		const d = state.delta;
		if (state.mode === 'move') return { start: span.start + d, end: span.end + d };
		if (state.mode === 'start') return { start: Math.min(span.end, span.start + d), end: span.end };
		if (state.mode === 'end') return { start: span.start, end: Math.max(span.start, span.end + d) };
		return span;
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || config.editable === false) return;
		const barEl = (event.target as Element).closest<HTMLElement>('.og-ws-gantt-bar[data-editable]');
		if (!barEl) return;
		const task = model.tasks.get(barEl.dataset.recordId!);
		if (!task?.span) return;
		const handle = (event.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle as DragMode | undefined;
		const dragMode: DragMode = task.summary ? 'move' : (handle ?? 'move');
		if (task.milestone && dragMode !== 'link') {
			drag = {
				mode: 'move',
				task: task as ScheduleTask<unknown>,
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				moved: false,
				delta: 0,
				progress: task.progress,
				bar: barEl,
				tip,
			};
			return;
		}
		drag = {
			mode: dragMode,
			task: task as ScheduleTask<unknown>,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			moved: false,
			delta: 0,
			progress: task.progress,
			bar: barEl,
			tip,
		};
		if (handle) event.stopPropagation();
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) {
			const index = Math.floor((event.clientY - chart.getBoundingClientRect().top) / rowH);
			if (
				index !== hoverIndex &&
				index >= 0 &&
				index < tasks.length &&
				(event.target as Element).closest?.('.og-ws-gantt-chart, .og-ws-gantt-outline')
			) {
				hoverIndex = index;
				hover.style.transform = `translateY(${index * rowH}px)`;
				hover.hidden = false;
			}
			return;
		}
		const dx = event.clientX - drag.x;
		if (!drag.moved) {
			if (Math.hypot(dx, event.clientY - drag.y) < 4) return;
			drag.moved = true;
			try {
				scroller.setPointerCapture(event.pointerId);
			} catch {
				/* synthetic pointer */
			}
			root.setAttribute('data-dragging', drag.mode);
			drag.bar.setAttribute('data-dragging', '');
			if (drag.mode === 'link') {
				drag.line = document.createElementNS(SVG, 'path');
				drag.line.setAttribute('class', 'og-ws-gantt-link og-ws-gantt-link-draft');
				drag.line.setAttribute('marker-end', 'url(#og-ws-arrow)');
				links.append(drag.line);
			}
		}
		const rect = chart.getBoundingClientRect();
		const span = drag.task.span!;
		const { x, width } = barGeometry(span);
		if (drag.mode === 'link') {
			const index = indexById.get(drag.task.id)!;
			const x1 = timeScale.x(span.end + 1);
			const y1 = index * rowH + rowH / 2;
			drag.line!.setAttribute('d', `M${x1} ${y1}L${event.clientX - rect.left} ${event.clientY - rect.top}`);
			const over = (document.elementFromPoint(event.clientX, event.clientY) as Element | null)?.closest<HTMLElement>('.og-ws-gantt-bar');
			bars.querySelectorAll('[data-link-target]').forEach((el) => el.removeAttribute('data-link-target'));
			if (over && over !== drag.bar)
				over.setAttribute('data-link-target', model.wouldCreateCycle(drag.task.id, over.dataset.recordId!) ? 'invalid' : 'valid');
			return;
		}
		if (drag.mode === 'progress') {
			drag.progress = Math.max(0, Math.min(1, Math.round(((event.clientX - rect.left - x) / width) * 20) / 20));
			const fill = drag.bar.querySelector<HTMLElement>('.og-ws-gantt-fill');
			if (fill) fill.style.width = `${drag.progress * 100}%`;
			const knob = drag.bar.querySelector<HTMLElement>('.og-ws-gantt-progress-handle');
			if (knob) knob.style.left = `${drag.progress * 100}%`;
			showTip(`${Math.round(drag.progress * 100)}%`, event.clientX - rect.left, drag.bar);
			return;
		}
		drag.delta = Math.round(dx / timeScale.dayWidth);
		const next = previewSpan(drag)!;
		const geometry = barGeometry(next);
		drag.bar.style.transform = `translate(${drag.task.milestone ? geometry.x + timeScale.dayWidth / 2 - 9 : geometry.x}px, ${drag.bar.dataset.top ?? 0}px)`;
		if (!drag.task.milestone) drag.bar.style.width = `${geometry.width}px`;
		const days = calendar.duration(next, drag.task.milestone);
		showTip(`${formatDay(fromDay(next.start))} – ${formatDay(fromDay(next.end))} · ${days}d`, geometry.x, drag.bar);
	};

	const showTip = (text: string, x: number, bar: HTMLElement) => {
		tip.hidden = false;
		tip.textContent = text;
		tip.style.transform = `translate(${Math.max(0, x)}px, ${Number(bar.dataset.top ?? 0) - 30}px)`;
	};

	const endDrag = () => {
		if (!drag) return;
		drag.line?.remove();
		bars.querySelectorAll('[data-link-target]').forEach((el) => el.removeAttribute('data-link-target'));
		drag.bar.removeAttribute('data-dragging');
		root.removeAttribute('data-dragging');
		tip.hidden = true;
		if (scroller.hasPointerCapture?.(drag.pointerId)) scroller.releasePointerCapture(drag.pointerId);
		drag = null;
	};

	const onPointerUp = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const state = drag;
		if (state.moved) state.bar.setAttribute('data-drag-suppress-click', '');
		endDrag();
		if (!state.moved) return;
		const task = state.task as ScheduleTask<T>;
		if (state.mode === 'link') {
			const over = (document.elementFromPoint(event.clientX, event.clientY) as Element | null)?.closest<HTMLElement>('.og-ws-gantt-bar');
			if (over && over.dataset.recordId && over.dataset.recordId !== task.id) addLink(task.id, over.dataset.recordId);
			render();
			return;
		}
		if (state.mode === 'progress') {
			const write = progressWrite(reader, task.row, state.progress);
			if (write) context.write([write], `Progress ${Math.round(state.progress * 100)}%`);
			render();
			return;
		}
		const next = previewSpan(state);
		if (!next || state.delta === 0) {
			render();
			return;
		}
		// Moves keep the working-day duration; resizes snap their moved end to a working day.
		let span: DaySpan;
		if (state.mode === 'move')
			span = task.milestone
				? { start: calendar.forward(next.start), end: calendar.forward(next.start) }
				: calendar.spanFrom(next.start, calendar.duration(task.span!));
		else if (state.mode === 'start') span = { start: calendar.forward(next.start), end: next.end };
		else span = { start: next.start, end: Math.max(next.start, calendar.backward(next.end)) };
		render();
		void applySchedule(task, span);
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && drag) {
			event.stopPropagation();
			endDrag();
			render();
		}
	};

	// ─── Pane resizing ───────────────────────────────────────────────────

	resize.addEventListener('pointerdown', (event) => {
		const startX = event.clientX;
		const startWidth = paneWidth;
		resize.setPointerCapture?.(event.pointerId);
		const move = (e: PointerEvent) => {
			paneWidth = Math.max(220, Math.min(host.clientWidth - 160, startWidth + e.clientX - startX));
			root.style.setProperty('--og-ws-pane', `${paneWidth}px`);
			head.style.width = body.style.width = `${paneWidth + chartWidth()}px`;
		};
		const up = () => {
			resize.removeEventListener('pointermove', move);
			resize.removeEventListener('pointerup', up);
			context.remember('paneWidth', paneWidth);
			render();
		};
		resize.addEventListener('pointermove', move);
		resize.addEventListener('pointerup', up);
	});
	resize.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		paneWidth = Math.max(220, paneWidth + (event.key === 'ArrowRight' ? 24 : -24));
		context.remember('paneWidth', paneWidth);
		render();
	});

	scroller.addEventListener('pointerdown', onPointerDown);
	scroller.addEventListener('pointermove', onPointerMove);
	scroller.addEventListener('pointerup', onPointerUp);
	scroller.addEventListener('pointercancel', () => {
		endDrag();
		render();
	});
	scroller.addEventListener('pointerleave', () => {
		hover.hidden = true;
		hoverIndex = -1;
	});
	scroller.addEventListener(
		'scroll',
		() => {
			context.remember('scroll', [scroller.scrollLeft, scroller.scrollTop]);
			schedulePaint();
		},
		{ passive: true }
	);
	scroller.addEventListener('dblclick', (event) => {
		const target = event.target as Element;
		if (target.closest('.og-ws-gantt-chart') && !target.closest('.og-ws-gantt-bar')) {
			// Double-click empty timeline: centre on that day.
			const day = timeScale.dayAt(event.clientX - chart.getBoundingClientRect().left);
			scrollToDay(day);
		}
	});
	host.ownerDocument.addEventListener('keydown', onKey, true);

	// ─── Toolbar ─────────────────────────────────────────────────────────

	let zoomButton: HTMLButtonElement | null = null;
	const toggles: { key: string; el: HTMLButtonElement; get: () => boolean }[] = [];
	let autoButton: HTMLButtonElement | null = null;
	const toolbarRefresh = () => {
		if (autoButton)
			autoButton.querySelector('.og-ws-btn-label')!.textContent = mode === 'off' ? 'Manual' : mode === 'tight' ? 'Auto: tight' : 'Auto: push';
		if (zoomButton) zoomButton.querySelector('.og-ws-btn-label')!.textContent = ZOOM_LABEL[zoom];
		for (const toggle of toggles) toggle.el.setAttribute('aria-pressed', String(toggle.get()));
	};
	const toolbar = () => {
		const todayButton = button({ icon: 'today', label: 'Today' }, () => scrollToDay(today()));
		const prev = button({ icon: 'chevronLeft', title: 'Earlier' }, () => (scroller.scrollLeft -= (scroller.clientWidth - paneWidth) * 0.8));
		const next = button({ icon: 'chevronRight', title: 'Later' }, () => (scroller.scrollLeft += (scroller.clientWidth - paneWidth) * 0.8));
		zoomButton = button({ label: ZOOM_LABEL[zoom], title: 'Time scale' }, () =>
			context.menu(
				zoomButton!,
				TIME_ZOOMS.map((candidate) => ({ label: ZOOM_LABEL[candidate], checked: candidate === zoom, run: () => setZoom(candidate) }))
			)
		);
		zoomButton.append(icon('chevronDown', 14));
		const zoomIn = button({ icon: 'zoomIn', title: 'Zoom in' }, () => setZoom(TIME_ZOOMS[Math.max(0, TIME_ZOOMS.indexOf(zoom) - 1)]));
		const zoomOut = button({ icon: 'zoomOut', title: 'Zoom out' }, () =>
			setZoom(TIME_ZOOMS[Math.min(TIME_ZOOMS.length - 1, TIME_ZOOMS.indexOf(zoom) + 1)])
		);
		const fitButton = button({ icon: 'fit', label: 'Fit', title: 'Fit the project' }, fit);
		const toggle = (
			key: keyof typeof CONFIG_KEY,
			label: string,
			iconName: 'dependency' | 'baseline' | 'critical' | 'resource',
			get: () => boolean
		) => {
			const el = button({ icon: iconName, label, pressed: get() }, () => configure({ [CONFIG_KEY[key]]: !get() }));
			el.classList.add('og-ws-toggle');
			toggles.push({ key, el, get });
			return el;
		};
		const auto = button(
			{ icon: 'sparkle', label: mode === 'off' ? 'Manual' : mode === 'tight' ? 'Auto: tight' : 'Auto: push', title: 'Auto-schedule' },
			() =>
				context.menu(auto, [
					{ label: 'Push successors when needed', checked: mode === 'push', run: () => setMode('push') },
					{ label: 'Keep successors tight', checked: mode === 'tight', run: () => setMode('tight') },
					{ label: 'Manual (flag broken links)', checked: mode === 'off', run: () => setMode('off') },
					'separator',
					{ label: 'Reschedule everything now', icon: 'sparkle', run: () => void rescheduleAll() },
				])
		);
		const setMode = (next: typeof mode) => configure({ autoSchedule: next });
		autoButton = auto;
		return h(
			'div',
			'og-ws-group og-ws-gantt-tools',
			null,
			todayButton,
			prev,
			next,
			zoomButton,
			zoomOut,
			zoomIn,
			fitButton,
			h('span', 'og-ws-sep'),
			toggle('deps', 'Dependencies', 'dependency', () => showDeps),
			toggle('baseline', 'Baseline', 'baseline', () => showBaseline),
			toggle('critical', 'Critical path', 'critical', () => showCritical),
			toggle('workload', 'Workload', 'resource', () => showWorkload),
			auto
		);
	};

	const settings = (): ViewSettingsSection[] => [
		{
			title: 'Timeline',
			settings: [
				{
					kind: 'segmented',
					id: 'zoom',
					label: 'Time scale',
					value: zoom,
					options: TIME_ZOOMS.map((value) => ({ value, label: ZOOM_LABEL[value] })),
					onChange: (value) => setZoom(value as TimeZoom),
				},
				{
					kind: 'segmented',
					id: 'rowHeight',
					label: 'Row height',
					value: String(rowH <= 30 ? 28 : rowH >= 44 ? 46 : 36),
					options: [
						{ value: '28', label: 'Compact' },
						{ value: '36', label: 'Default' },
						{ value: '46', label: 'Roomy' },
					],
					onChange: (value) => configure({ rowHeight: Number(value) }),
				},
				{ kind: 'toggle', id: 'deps', label: 'Dependencies', value: showDeps, onChange: (value) => configure({ dependencies: value }) },
				{
					kind: 'toggle',
					id: 'baseline',
					label: 'Baselines',
					hint: 'Amber when a task finishes later than planned.',
					value: showBaseline,
					onChange: (value) => configure({ baseline: value }),
				},
				{
					kind: 'toggle',
					id: 'critical',
					label: 'Critical path',
					value: showCritical,
					onChange: (value) => configure({ criticalPath: value }),
				},
				{
					kind: 'toggle',
					id: 'workload',
					label: 'People’s workload',
					value: showWorkload,
					onChange: (value) => configure({ workload: value }),
				},
			],
		},
		{
			title: 'Scheduling',
			settings: [
				{
					kind: 'segmented',
					id: 'autoSchedule',
					label: 'When a task moves',
					value: mode,
					options: [
						{ value: 'push', label: 'Push' },
						{ value: 'tight', label: 'Keep tight' },
						{ value: 'off', label: 'Manual' },
					],
					onChange: (value) => configure({ autoSchedule: value as 'push' }),
				},
				{
					kind: 'toggle',
					id: 'confirm',
					label: 'Preview the impact first',
					value: config.confirmReschedule !== false,
					onChange: (value) => configure({ confirmReschedule: value }),
				},
				{
					kind: 'weekdays',
					id: 'workingDays',
					label: 'Working days',
					value: config.calendar?.workingDays ?? [1, 2, 3, 4, 5],
					onChange: (value) => configure({ calendar: { ...config.calendar, workingDays: value } }),
				},
			],
		},
		{
			title: 'Outline',
			settings: [
				{
					kind: 'fields',
					id: 'fields',
					label: 'Extra columns',
					hint: 'Shown after owner, status and progress while the outline is wide enough.',
					value: config.fields ?? [],
					options: context
						.columns()
						.filter((col) => !Object.values(reader.roles).includes(col.field))
						.map((col) => ({ value: col.field, label: col.header ?? col.field })),
					onChange: (value) => configure({ fields: value }),
				},
			],
		},
	];

	const rescheduleAll = async () => {
		const { changes } = model.autoSchedule({ mode: mode === 'off' ? 'push' : mode });
		if (!changes.length) {
			context.toast('Every link is already satisfied.', 'success');
			return;
		}
		const list = h(
			'ul',
			'og-ws-hint',
			null,
			...changes
				.slice(0, 12)
				.map((change) =>
					h(
						'li',
						null,
						null,
						`${reader.key(model.tasks.get(change.id)!.row)} ${reader.title(model.tasks.get(change.id)!.row)} — ${describeShift(change)}`
					)
				)
		);
		const answer = await context.confirm({
			title: `Reschedule ${changes.length} tasks?`,
			body: h(
				'div',
				null,
				null,
				h('p', 'og-ws-hint', null, 'These tasks move so every dependency holds, keeping their working-day durations.'),
				list
			),
			confirm: `Reschedule ${changes.length}`,
		});
		if (answer !== 'confirm') return;
		context.write(
			changes.flatMap((change) => spanWrites(reader, model.tasks.get(change.id)!.row, change.after)),
			`Rescheduled ${changes.length} tasks`
		);
	};

	// ─── Summary, commands, inspector tabs ──────────────────────────────

	const summary = (): WorkspaceMetric[] => {
		const extent = model.extent();
		if (!extent || !tasks.length) return [];
		const leaves = [...model.tasks.values()].filter((task) => !task.summary && task.span);
		const weight = leaves.reduce((sum, task) => sum + Math.max(1, task.duration), 0);
		const done = leaves.reduce((sum, task) => sum + task.progress * Math.max(1, task.duration), 0);
		const late = leaves.filter((task) => (model.variance(task.id) ?? 0) > 0).length;
		const loads = resourceLoad(model, reader.roles.owner);
		const over = [...loads.values()].filter((load) => load.overDays.length > 0).length;
		const crit = showCritical ? critical.size : model.critical().size;
		return [
			{
				label: 'Project span',
				value: `${formatDay(fromDay(extent.start))} – ${formatDay(fromDay(extent.end), true)}`,
				title: `${calendar.between(extent.start, extent.end)} working days`,
			},
			{ label: 'Complete', value: `${Math.round((done / Math.max(1, weight)) * 100)}%`, meter: done / Math.max(1, weight) },
			{ label: 'Critical tasks', value: String(crit), tone: '#f43f5e' },
			{ label: 'Behind baseline', value: String(late), tone: late ? '#f59e0b' : '#22c55e' },
			{ label: 'Broken links', value: String(violations.size), tone: violations.size ? '#ef4444' : '#22c55e' },
			{ label: 'Over-allocated', value: `${over} ${over === 1 ? 'person' : 'people'}`, tone: over ? '#f59e0b' : '#22c55e' },
		];
	};

	const commands = (): WorkspaceCommand[] => [
		...TIME_ZOOMS.map((candidate) => ({
			id: `gantt:zoom:${candidate}`,
			label: `Zoom to ${ZOOM_LABEL[candidate].toLowerCase()}`,
			group: 'Schedule',
			icon: 'zoomIn' as const,
			run: () => setZoom(candidate),
		})),
		{ id: 'gantt:today', label: 'Scroll to today', group: 'Schedule', icon: 'today', hint: 'T', run: () => scrollToDay(today()) },
		{ id: 'gantt:fit', label: 'Fit the whole project', group: 'Schedule', icon: 'fit', run: fit },
		{
			id: 'gantt:critical',
			label: `${showCritical ? 'Hide' : 'Show'} the critical path`,
			group: 'Schedule',
			icon: 'critical',
			run: () => configure({ criticalPath: !showCritical }),
		},
		{
			id: 'gantt:deps',
			label: `${showDeps ? 'Hide' : 'Show'} dependencies`,
			group: 'Schedule',
			icon: 'dependency',
			run: () => configure({ dependencies: !showDeps }),
		},
		{
			id: 'gantt:baseline',
			label: `${showBaseline ? 'Hide' : 'Show'} baselines`,
			group: 'Schedule',
			icon: 'baseline',
			run: () => configure({ baseline: !showBaseline }),
		},
		{
			id: 'gantt:workload',
			label: `${showWorkload ? 'Hide' : 'Show'} people’s workload`,
			group: 'Schedule',
			icon: 'resource',
			run: () => configure({ workload: !showWorkload }),
		},
		{
			id: 'gantt:reschedule',
			label: 'Reschedule everything to satisfy links',
			group: 'Schedule',
			icon: 'sparkle',
			run: () => void rescheduleAll(),
		},
		{
			id: 'gantt:collapse',
			label: 'Collapse all summary tasks',
			group: 'Schedule',
			icon: 'collapse',
			run: () => {
				for (const task of model.tasks.values()) if (task.summary) collapsed.add(task.id);
				context.remember('collapsed', [...collapsed]);
				render();
			},
		},
		{
			id: 'gantt:expand',
			label: 'Expand all summary tasks',
			group: 'Schedule',
			icon: 'expand',
			run: () => {
				collapsed.clear();
				context.remember('collapsed', []);
				render();
			},
		},
	];

	const inspectorTabs = (id: string): InspectorTab[] => {
		const task = model.tasks.get(id);
		if (!task) return [];
		const tabs: InspectorTab[] = [];
		tabs.push({
			id: 'schedule',
			label: 'Schedule',
			render: (panel) => {
				const slack = model.slack().get(id);
				const variance = model.variance(id);
				const line = (label: string, value: string | Node) =>
					h('div', 'og-ws-prop', null, h('span', 'og-ws-prop-label', null, label), h('div', 'og-ws-prop-value', null, value));
				const span = task.span;
				panel.append(
					line('Start', span ? formatDay(fromDay(span.start), true) : '—'),
					line('End', span ? formatDay(fromDay(span.end), true) : '—'),
					line('Duration', task.milestone ? 'Milestone' : `${task.duration} working days`),
					line(
						'Slack',
						slack == null ? '—' : slack <= 0 ? h('span', 'og-ws-critical-text', null, 'Critical — no slack') : `${slack} working days`
					),
					line('Baseline', task.baseline ? `${formatDay(fromDay(task.baseline.start))} – ${formatDay(fromDay(task.baseline.end))}` : '—'),
					line(
						'Variance',
						variance == null
							? '—'
							: variance === 0
								? 'On baseline'
								: h(
										'span',
										variance > 0 ? 'og-ws-shift' : 'og-ws-shift og-ws-shift-early',
										null,
										`${variance > 0 ? '+' : ''}${variance} working days`
									)
					),
					line('Outline', task.wbs)
				);
				if (task.span && !task.summary && config.editable !== false && canSchedule(task.row)) {
					const shifts = h('div', 'og-ws-group');
					for (const days of [-5, -1, 1, 5])
						shifts.append(
							button(
								{ label: `${days > 0 ? '+' : ''}${days}d` },
								() =>
									void applySchedule(task, { start: calendar.add(task.span!.start, days), end: calendar.add(task.span!.end, days) })
							)
						);
					panel.append(h('div', 'og-ws-prop', null, h('span', 'og-ws-prop-label', null, 'Shift'), shifts));
				}
			},
		});
		if (reader.roles.dependencies) {
			const predecessors = task.predecessors;
			const successors = task.successors;
			tabs.push({
				id: 'dependencies',
				label: 'Dependencies',
				count: predecessors.length + successors.length,
				render: (panel) => {
					const item = (link: DependencyLink, other: string, direction: 'pred' | 'succ') => {
						const row = model.tasks.get(other)?.row ?? context.lookup(other);
						const type = h('select', 'og-ws-input og-ws-dep-type', {
							'aria-label': 'Link type',
							disabled: direction === 'succ' || !context.canEdit(link.to, reader.roles.dependencies!),
						});
						for (const value of ['FS', 'SS', 'FF', 'SF'] as const) {
							const option = h('option', null, { value }, `${value} · ${DEPENDENCY_LABELS[value]}`);
							option.selected = value === link.type;
							type.append(option);
						}
						type.addEventListener('change', () => {
							const target = model.tasks.get(link.to)!;
							const write = dependencyWrite(
								reader,
								target.row,
								reader
									.dependencies(target.row)
									.map((other) => (other.from === link.from ? { ...other, type: type.value as DependencyType } : other))
							);
							if (write) context.write([write], 'Link type changed');
						});
						const open = h(
							'button',
							'og-ws-dep-chip',
							{ type: 'button' },
							h('span', `og-ws-dep-arrow og-ws-dep-${direction === 'pred' ? 'up' : 'down'}`, null, direction === 'pred' ? '↑' : '↓'),
							row ? `${reader.key(row)} ${reader.title(row)}` : other
						);
						open.addEventListener('click', () => context.focus(other, { inspect: true }));
						const remove = button({ icon: 'close', title: 'Remove link' }, () => removeLink(link));
						if (!context.canEdit(link.to, reader.roles.dependencies!)) remove.disabled = true;
						return h('div', 'og-ws-dep-row', null, open, type, remove);
					};
					panel.append(h('h3', 'og-ws-subhead', null, `Waits on (${predecessors.length})`));
					for (const link of predecessors) panel.append(item(link, link.from, 'pred'));
					panel.append(h('h3', 'og-ws-subhead', null, `Blocks (${successors.length})`));
					for (const link of successors) panel.append(item(link, link.to, 'succ'));
					// Add a predecessor: any task that would not create a cycle.
					const add = h('select', 'og-ws-input', { 'aria-label': 'Add a predecessor' });
					add.append(h('option', null, { value: '' }, 'Add a predecessor…'));
					for (const other of tasks)
						if (other.id !== id && !predecessors.some((link) => link.from === other.id) && !model.wouldCreateCycle(other.id, id))
							add.append(h('option', null, { value: other.id }, `${other.wbs} ${reader.title(other.row)}`));
					add.addEventListener('change', () => add.value && addLink(add.value, id));
					panel.append(add);
				},
			});
		}
		if (reader.roles.owner) {
			tabs.push({
				id: 'resources',
				label: 'Resources',
				render: (panel) => {
					const loads = resourceLoad(model, reader.roles.owner);
					const people = reader.values(task.row, reader.roles.owner);
					if (!people.length) panel.append(h('p', 'og-ws-hint', null, 'Nobody is assigned.'));
					for (const person of people) {
						const load = loads.get(person);
						const option = reader.option(reader.roles.owner, person) as PersonOption | undefined;
						const span = task.span;
						const over = span && load ? load.overDays.filter((day) => day >= span.start && day <= span.end) : [];
						const card = h(
							'div',
							'og-ws-resource',
							null,
							h(
								'div',
								'og-ws-resource-head',
								null,
								avatar(option, person, 'md'),
								h('strong', null, null, option?.label ?? person),
								h('span', 'og-ws-hint', null, `${load?.tasks.length ?? 0} tasks · peak ${load?.peak ?? 0} at once`)
							)
						);
						if (span && load) {
							const strip = h('div', 'og-ws-load-strip', { title: 'Concurrent open tasks per working day during this task' });
							for (let day = span.start; day <= span.end; day++) {
								if (!calendar.isWorking(day)) continue;
								const n = load.daily.get(day) ?? 0;
								const cell = h('span', `og-ws-load${n > 1 ? ' og-ws-load-over' : ''}`, {
									title: `${formatDay(fromDay(day))}: ${n} task${n === 1 ? '' : 's'}`,
								});
								cell.style.height = `${Math.min(100, n * 34)}%`;
								strip.append(cell);
							}
							card.append(strip);
						}
						card.append(
							h(
								'p',
								over.length ? 'og-ws-warn-text' : 'og-ws-hint',
								null,
								over.length
									? `Over-allocated on ${over.length} working day${over.length === 1 ? '' : 's'} of this task.`
									: 'Within capacity for this task.'
							)
						);
						panel.append(card);
					}
				},
			});
		}
		return tabs;
	};

	let restored = false;
	const [savedLeft, savedTop] = context.memory<[number, number] | null>('scroll', null) ?? [NaN, NaN];
	return {
		render() {
			render(restored);
			if (!restored) {
				restored = true;
				if (Number.isFinite(savedLeft)) {
					scroller.scrollLeft = savedLeft;
					scroller.scrollTop = savedTop;
				} else if (config.initialDate) {
					const date = parseCellDate(config.initialDate);
					if (date) scrollToDay(toDay(date), 'start');
				} else scrollToDay(today());
				paintRows(false);
			}
		},
		update(next) {
			const before = config;
			config = next as GanttViewConfig<T>;
			const rescale = (config.zoom ?? 'week') !== zoom || Math.max(28, Math.floor(config.rowHeight ?? 36)) !== rowH;
			const center = pendingCenter ?? centerDay();
			pendingCenter = null;
			zoom = config.zoom ?? 'week';
			rowH = Math.max(28, Math.floor(config.rowHeight ?? 36));
			if (JSON.stringify(before.calendar) !== JSON.stringify(config.calendar)) calendar = new WorkCalendar(config.calendar);
			showDeps = config.dependencies ?? true;
			showBaseline = config.baseline ?? true;
			showCritical = config.criticalPath ?? false;
			showWorkload = config.workload ?? false;
			mode = config.autoSchedule ?? 'push';
			if (rescale) {
				// A new scale is a new picture: it cross-fades in, centred where you were looking.
				render(false);
				scrollToDay(center);
				paintRows(false);
				motion.slideIn(chart, 0, 0);
			} else render(true);
			toolbarRefresh();
		},
		settings,
		order: () => tasks.map((task) => task.id),
		reveal(id) {
			let index = indexById.get(id);
			if (index === undefined) {
				// Expand collapsed ancestors.
				let parent = model.tasks.get(id)?.parent;
				let opened = false;
				while (parent) {
					opened = collapsed.delete(parent) || opened;
					parent = model.tasks.get(parent)?.parent;
				}
				if (!opened) return null;
				context.remember('collapsed', [...collapsed]);
				render();
				index = indexById.get(id);
				if (index === undefined) return null;
			}
			const top = index * rowH;
			const viewTop = scroller.scrollTop;
			const viewBottom = viewTop + scroller.clientHeight - HEAD_H;
			if (top < viewTop) scroller.scrollTop = top;
			else if (top + rowH > viewBottom) scroller.scrollTop = top + rowH - (scroller.clientHeight - HEAD_H);
			const span = model.tasks.get(id)?.span;
			if (span) {
				const x = timeScale.x(span.start);
				const left = scroller.scrollLeft;
				const visible = scroller.clientWidth - paneWidth;
				if (x < left || x > left + visible - 60) scroller.scrollLeft = x - 60;
			}
			paintRows();
			return outlineRows.get(id)?.element ?? null;
		},
		onKey(event, id) {
			const task = model.tasks.get(id);
			if (!task) return false;
			if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && task.summary && !event.altKey && !event.shiftKey) {
				const open = event.key === 'ArrowRight';
				if (open === collapsed.has(id)) {
					toggleTask(id);
					return true;
				}
			}
			if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft') && task.span && !task.summary && canSchedule(task.row)) {
				const days = event.key === 'ArrowRight' ? 1 : -1;
				void applySchedule(task, { start: calendar.add(task.span.start, days), end: calendar.add(task.span.end, days) });
				return true;
			}
			if (event.key.toLowerCase() === 't' && !event.ctrlKey && !event.metaKey) {
				scrollToDay(today());
				return true;
			}
			return false;
		},
		toolbar,
		summary,
		commands,
		inspectorTabs,
		destroy() {
			endDrag();
			if (frame) defaultGridScheduler.cancelRaf(frame);
			host.ownerDocument.removeEventListener('keydown', onKey, true);
			for (const entry of outlineRows.values()) entry.fields.forEach((field) => field.destroy());
			root.remove();
		},
	};
}

export const ganttView: WorkspaceViewModule<GanttViewConfig<any>> = { kind: 'gantt', label: 'Gantt', icon: 'gantt', create };

const GANTT_STYLES = `
.og-ws-gantt { --og-ws-summary: color-mix(in srgb, #60a5fa 85%, var(--og-text-color)); --og-ws-critical: #f43f5e; --og-ws-weekend: color-mix(in srgb, var(--og-text-color) 3.5%, transparent); --og-ws-gridline: color-mix(in srgb, var(--og-text-color) 6%, transparent);
  position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.og-ws-gantt-scroll { position: relative; flex: 1 1 auto; overflow: auto; min-height: 0; overscroll-behavior: contain; }
.og-ws-gantt-head { position: sticky; top: 0; z-index: 6; display: flex; height: ${HEAD_H}px; background: var(--og-glass-header-bg, var(--og-ws-bg)); border-bottom: 1px solid var(--og-ws-line); }
.og-ws-gantt-corner { position: sticky; left: 0; z-index: 2; flex: 0 0 var(--og-ws-pane); width: var(--og-ws-pane); display: flex; align-items: flex-end; padding-bottom: 8px; background: inherit; border-right: 1px solid var(--og-ws-line-strong); color: var(--og-ws-muted); font-size: 11.5px; font-weight: 600; }
.og-ws-gantt-scale { position: relative; flex: none; height: 100%; overflow: hidden; }
.og-ws-gantt-major, .og-ws-gantt-minor { position: absolute; left: 0; right: 0; }
.og-ws-gantt-major { top: 0; height: 30px; }
.og-ws-gantt-minor { top: 30px; height: 24px; }
.og-ws-gantt-tick { position: absolute; top: 0; height: 100%; display: flex; align-items: center; gap: 6px; padding: 0 8px; box-sizing: border-box; border-left: 1px solid var(--og-ws-line); white-space: nowrap; overflow: hidden; font-size: 11.5px; color: var(--og-ws-muted); }
.og-ws-gantt-major .og-ws-gantt-tick strong { color: var(--og-ws-text); font-weight: 600; }
.og-ws-gantt-major .og-ws-gantt-tick span { font-size: 11px; }
.og-ws-gantt-minor .og-ws-gantt-tick { justify-content: center; padding: 0 2px; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.og-ws-gantt-tick.og-ws-quiet { color: var(--og-ws-faint); }
.og-ws-gantt-tick.og-ws-now { color: #f87171; font-weight: 700; }
.og-ws-gantt-body { position: relative; display: flex; }
.og-ws-gantt-outline { position: sticky; left: 0; z-index: 4; flex: 0 0 var(--og-ws-pane); width: var(--og-ws-pane); background: var(--og-ws-bg); border-right: 1px solid var(--og-ws-line-strong); box-shadow: 6px 0 12px -10px rgb(0 0 0 / .5); }
.og-ws-gantt-row { position: absolute; left: 0; top: 0; width: 100%; height: var(--og-ws-row); display: flex; align-items: center; border-bottom: 1px solid color-mix(in srgb, var(--og-text-color) 5%, transparent); cursor: pointer; outline: none; font-size: 12.5px; }
.og-ws-gantt-row:hover { background: var(--og-ws-hover); }
.og-ws-gantt-row[data-selected] { background: color-mix(in srgb, var(--og-focus-ring) 12%, transparent); box-shadow: inset 2px 0 0 var(--og-focus-ring); }
.og-ws-gantt-row[data-focused]:focus-visible { box-shadow: inset 0 0 0 2px var(--og-focus-ring); }
.og-ws-gantt-row[data-summary] .og-ws-gantt-title-text { font-weight: 650; }
.og-ws-gantt-cell { min-width: 0; padding: 0 6px; display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; }
.og-ws-gantt-c-select { flex: 0 0 30px; justify-content: center; padding: 0; }
.og-ws-gantt-c-wbs { flex: 0 0 42px; color: var(--og-ws-muted); font-variant-numeric: tabular-nums; font-size: 11.5px; }
.og-ws-gantt-c-title { flex: 1 1 auto; }
.og-ws-gantt-c-owner { justify-content: center; }
.og-ws-gantt-c-progress .og-ws-progress-label { min-width: 30px; font-size: 11px; }
.og-ws-gantt-title-text { overflow: hidden; text-overflow: ellipsis; }
.og-ws-gantt-check { accent-color: var(--og-focus-ring); margin: 0; width: 14px; height: 14px; }
.og-ws-gantt-toggle { width: 18px; height: 18px; display: grid; place-items: center; border: 0; padding: 0; border-radius: 4px; background: none; color: var(--og-ws-muted); cursor: pointer; flex: none; }
.og-ws-gantt-toggle:hover { background: var(--og-ws-hover); color: var(--og-ws-text); }
.og-ws-gantt-folder { color: #60a5fa; display: inline-grid; }
.og-ws-gantt-kind { width: 18px; flex: none; display: inline-grid; place-items: center; }
.og-ws-gantt-kind-milestone { color: #f59e0b; }
.og-ws-gantt-chart { position: relative; flex: none; }
.og-ws-gantt-shade, .og-ws-gantt-gridlines { position: absolute; inset: 0; pointer-events: none; }
.og-ws-gantt-bands { position: absolute; inset: 0; pointer-events: none; }
.og-ws-gantt-band, .og-ws-gantt-hover { position: absolute; left: 0; right: 0; top: 0; height: var(--og-ws-row); }
.og-ws-gantt-band { background: color-mix(in srgb, var(--og-focus-ring) 9%, transparent); }
.og-ws-gantt-hover { background: var(--og-ws-hover); }
.og-ws-gantt-links { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 1; }
.og-ws-gantt-link { fill: none; stroke: color-mix(in srgb, var(--og-text-color) 45%, transparent); stroke-width: 1.4; pointer-events: stroke; }
.og-ws-gantt-link.og-ws-violated { stroke: #ef4444; stroke-dasharray: 4 3; }
.og-ws-gantt-link.og-ws-critical { stroke: var(--og-ws-critical); stroke-width: 1.8; }
.og-ws-gantt-link-draft { stroke: var(--og-focus-ring); stroke-dasharray: 5 4; stroke-width: 1.8; }
.og-ws-gantt-bars { position: absolute; inset: 0; z-index: 2; }
.og-ws-gantt-bar { position: absolute; left: 0; height: 20px; margin-top: calc((var(--og-ws-row) - 20px) / 2 - 3px); border-radius: 5px; background: color-mix(in srgb, var(--og-ws-bar) 30%, var(--og-ws-bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ws-bar) 70%, transparent); cursor: pointer; user-select: none; }
.og-ws-gantt-bar[data-editable] { cursor: grab; }
.og-ws-gantt-bar[data-dragging] { cursor: grabbing; z-index: 3; box-shadow: inset 0 0 0 1px var(--og-ws-bar), 0 6px 18px -6px rgb(0 0 0 / .6); }
.og-ws-gantt-bar[data-selected] { box-shadow: inset 0 0 0 1px var(--og-ws-bar), 0 0 0 2px var(--og-focus-ring); }
.og-ws-gantt-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; background: var(--og-ws-bar); max-width: 100%; }
.og-ws-gantt-bar.og-ws-done .og-ws-gantt-fill { opacity: .85; }
.og-ws-gantt-label { position: absolute; top: 50%; transform: translateY(-50%); font-size: 11px; font-weight: 600; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
.og-ws-gantt-label-in { right: 6px; color: color-mix(in srgb, var(--og-text-color) 92%, transparent); text-shadow: 0 1px 2px rgb(0 0 0 / .45); }
.og-ws-gantt-label-out { left: calc(100% + 8px); color: var(--og-ws-muted); font-weight: 500; display: flex; flex-direction: column; line-height: 1.15; }
.og-ws-gantt-summary { height: 10px; margin-top: calc((var(--og-ws-row) - 10px) / 2 - 3px); border-radius: 3px; background: color-mix(in srgb, var(--og-ws-summary) 30%, var(--og-ws-bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ws-summary) 75%, transparent); }
.og-ws-gantt-summary::before, .og-ws-gantt-summary::after { content: ''; position: absolute; bottom: -5px; width: 0; height: 0; border-top: 6px solid var(--og-ws-summary); }
.og-ws-gantt-summary::before { left: 0; border-right: 6px solid transparent; }
.og-ws-gantt-summary::after { right: 0; border-left: 6px solid transparent; }
.og-ws-gantt-summary .og-ws-gantt-fill { background: var(--og-ws-summary); }
.og-ws-gantt-critical:not(.og-ws-gantt-summary) { box-shadow: inset 0 0 0 1.5px var(--og-ws-critical), 0 0 0 1px color-mix(in srgb, var(--og-ws-critical) 25%, transparent); }
.og-ws-gantt-milestone { background: none; box-shadow: none; height: 18px; margin-top: calc((var(--og-ws-row) - 18px) / 2 - 3px); }
.og-ws-gantt-diamond { position: absolute; inset: 2px; transform: rotate(45deg); background: #f59e0b; border-radius: 2px; box-shadow: 0 0 0 2px var(--og-ws-bg); }
.og-ws-gantt-milestone.og-ws-gantt-critical .og-ws-gantt-diamond { background: var(--og-ws-critical); }
.og-ws-gantt-handle { position: absolute; top: 0; bottom: 0; opacity: 0; transition: opacity .12s ease; }
.og-ws-gantt-bar:hover .og-ws-gantt-handle, .og-ws-gantt-bar[data-dragging] .og-ws-gantt-handle { opacity: 1; }
.og-ws-gantt-resize-start, .og-ws-gantt-resize-end { width: 8px; cursor: ew-resize; }
.og-ws-gantt-resize-start { left: -2px; } .og-ws-gantt-resize-end { right: -2px; }
.og-ws-gantt-resize-start::after, .og-ws-gantt-resize-end::after { content: ''; position: absolute; top: 4px; bottom: 4px; left: 3px; width: 2px; border-radius: 2px; background: color-mix(in srgb, var(--og-text-color) 80%, transparent); }
.og-ws-gantt-link-handle { right: -16px; left: auto; top: 50%; bottom: auto; width: 10px; height: 10px; margin-top: -5px; border-radius: 99px; background: var(--og-ws-bg); box-shadow: inset 0 0 0 2px var(--og-ws-bar); cursor: crosshair; }
.og-ws-gantt-milestone .og-ws-gantt-link-handle { right: -14px; }
.og-ws-gantt-progress-handle { top: auto; bottom: -7px; width: 0; height: 0; margin-left: -5px; border: 5px solid transparent; border-bottom-color: var(--og-text-color); cursor: ew-resize; }
.og-ws-gantt-bar[data-link-target='valid'] { box-shadow: inset 0 0 0 1px var(--og-ws-bar), 0 0 0 2px #22c55e; }
.og-ws-gantt-bar[data-link-target='invalid'] { box-shadow: inset 0 0 0 1px var(--og-ws-bar), 0 0 0 2px #ef4444; cursor: not-allowed; }
.og-ws-gantt-baseline { position: absolute; left: 0; top: 0; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--og-text-color) 30%, transparent); pointer-events: auto; }
.og-ws-gantt-baseline[data-late] { background: color-mix(in srgb, #f59e0b 55%, transparent); }
.og-ws-gantt-today { position: absolute; top: 0; bottom: 0; left: 0; width: 0; border-left: 1.5px dashed #ef4444; z-index: 3; pointer-events: none; }
.og-ws-gantt-today-chip { position: absolute; left: 0; bottom: 3px; z-index: 2; margin-left: -22px; width: 44px; text-align: center; padding: 2px 0; border-radius: 5px; background: #ef4444; color: #fff; font-size: 10.5px; font-weight: 600; pointer-events: none; }
.og-ws-gantt-tip { position: absolute; left: 0; top: 0; z-index: 7; padding: 4px 8px; border-radius: 6px; background: var(--og-text-color); color: var(--og-bg-color); font-size: 11.5px; font-weight: 600; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
.og-ws-gantt-resize { position: absolute; top: 0; bottom: 28px; left: calc(var(--og-ws-pane) - 3px); width: 6px; cursor: col-resize; z-index: 8; }
.og-ws-gantt-resize:hover, .og-ws-gantt-resize:focus-visible { background: color-mix(in srgb, var(--og-focus-ring) 50%, transparent); outline: none; }
.og-ws-gantt-minimap { position: absolute; right: 18px; bottom: 40px; z-index: 9; width: 240px; height: 56px; padding: 0; border: 1px solid var(--og-ws-line-strong); border-radius: 8px; background: color-mix(in srgb, var(--og-ws-bg) 88%, transparent); backdrop-filter: blur(6px); box-shadow: var(--og-ws-shadow); overflow: hidden; cursor: pointer; }
.og-ws-gantt-minimap-canvas { display: block; }
.og-ws-gantt-minimap-window { position: absolute; border: 1.5px solid var(--og-text-color); border-radius: 4px; background: color-mix(in srgb, var(--og-text-color) 8%, transparent); pointer-events: none; }
.og-ws-gantt-legend { flex: none; display: flex; justify-content: center; flex-wrap: wrap; gap: 18px; padding: 7px 12px; border-top: 1px solid var(--og-ws-line); color: var(--og-ws-muted); font-size: 11.5px; }
.og-ws-gantt-legend span { display: inline-flex; align-items: center; gap: 6px; }
.og-ws-gantt-legend i { display: inline-block; }
.og-ws-lg-summary { width: 16px; height: 6px; border-radius: 2px; background: var(--og-ws-summary); }
.og-ws-lg-task { width: 16px; height: 10px; border-radius: 3px; background: #3b82f6; }
.og-ws-lg-milestone { width: 9px; height: 9px; transform: rotate(45deg); background: #f59e0b; }
.og-ws-lg-baseline { width: 16px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--og-text-color) 30%, transparent); }
.og-ws-lg-dep { width: 16px; height: 0; border-top: 1.5px solid color-mix(in srgb, var(--og-text-color) 55%, transparent); }
.og-ws-lg-critical { width: 16px; height: 10px; border-radius: 3px; box-shadow: inset 0 0 0 1.5px var(--og-ws-critical); }
.og-ws-gantt-tools .og-ws-sep { width: 1px; height: 20px; background: var(--og-ws-line-strong); margin: 0 4px; }
.og-ws-toggle[aria-pressed='true'] .og-ws-icon { color: var(--og-ws-accent); }
.og-ws-gantt[data-dragging] .og-ws-gantt-scroll { cursor: grabbing; }
.og-ws-gantt[data-dragging='link'] .og-ws-gantt-scroll { cursor: crosshair; }
.og-ws-gantt-workload { position: sticky; bottom: 0; z-index: 5; display: flex; border-top: 1px solid var(--og-ws-line-strong); background: var(--og-glass-header-bg, var(--og-ws-bg)); box-shadow: 0 -8px 16px -12px rgb(0 0 0 / .6); }
.og-ws-gantt-wl-names { position: sticky; left: 0; z-index: 1; flex: 0 0 var(--og-ws-pane); width: var(--og-ws-pane); background: inherit; border-right: 1px solid var(--og-ws-line-strong); }
.og-ws-gantt-wl-title { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 11.5px; font-weight: 600; color: var(--og-ws-muted); }
.og-ws-gantt-wl-person { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px; }
.og-ws-gantt-wl-over { margin-left: auto; padding: 1px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600; color: #f59e0b; background: color-mix(in srgb, #f59e0b 15%, transparent); white-space: nowrap; }
.og-ws-gantt-wl-chart { position: relative; flex: none; }
.og-ws-gantt-wl-bar { position: absolute; left: 0; top: 0; border-radius: 3px 3px 1px 1px; background: color-mix(in srgb, #60a5fa 70%, transparent); color: #fff; font-size: 9.5px; font-weight: 700; display: flex; justify-content: center; line-height: 12px; overflow: hidden; }
.og-ws-gantt-wl-bar-over { background: color-mix(in srgb, #f59e0b 85%, transparent); }
.og-ws-subhead { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--og-ws-muted); }
.og-ws-dep-row { display: flex; align-items: center; gap: 6px; }
.og-ws-dep-row .og-ws-dep-chip { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; justify-content: flex-start; }
.og-ws-dep-type { width: auto; min-height: 26px; padding: 2px 6px; font-size: 11.5px; }
.og-ws-critical-text { color: var(--og-ws-critical, #f43f5e); font-weight: 600; }
.og-ws-warn-text { color: #f59e0b; font-size: 12px; }
.og-ws-resource { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--og-ws-line); border-radius: 10px; background: var(--og-ws-surface); }
.og-ws-resource-head { display: flex; align-items: center; gap: 8px; }
.og-ws-load-strip { display: flex; align-items: flex-end; gap: 2px; height: 36px; padding: 2px; border-radius: 6px; background: var(--og-ws-surface-2); }
.og-ws-load { flex: 1; min-width: 2px; border-radius: 2px; background: #60a5fa; }
.og-ws-load-over { background: #f59e0b; }
`;
