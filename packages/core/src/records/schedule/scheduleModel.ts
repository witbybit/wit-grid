import type { DaySpan, Day } from '../days.js';
import type { DependencyLink, DependencyType, RecordReader, RecordRow } from '../recordModel.js';
import { WorkCalendar } from './workCalendar.js';

/** One task of the schedule: a record placed in the outline, with its span and links. */
export interface ScheduleTask<TRowData = unknown> {
	id: string;
	row: RecordRow<TRowData>;
	parent: string | null;
	children: string[];
	depth: number;
	/** Outline number: 1, 1.2, 1.2.3. */
	wbs: string;
	/** Has children: its span and progress roll up from them. */
	summary: boolean;
	milestone: boolean;
	/** Own span (leaf) or rolled-up span (summary); null when unscheduled. */
	span: DaySpan | null;
	/** Working days. */
	duration: number;
	/** 0–1. */
	progress: number;
	done: boolean;
	baseline: DaySpan | null;
	/** Incoming links (this task waits on them). */
	predecessors: DependencyLink[];
	/** Outgoing links (they wait on this task). */
	successors: DependencyLink[];
}

export interface DependencyViolation {
	link: DependencyLink;
	/** Working days the successor would have to move later. */
	days: number;
}

export interface ScheduleChange {
	id: string;
	before: DaySpan | null;
	after: DaySpan;
}

export interface AutoScheduleOptions {
	/** `push`: successors move later only when a link requires it. `tight`: they move to the earliest date their links allow. */
	mode?: 'push' | 'tight';
	/** New spans the user set (a dragged bar): fixed, and the source of the propagation. */
	anchors?: ReadonlyMap<string, DaySpan>;
}

export interface AutoScheduleResult {
	/** Every leaf task whose span changes (anchors included). */
	changes: ScheduleChange[];
	/** Links that could not be satisfied (cycles). */
	unresolved: DependencyLink[];
}

/**
 * The schedule projection shared by the outline and the timeline: one outline (parents, WBS
 * numbers, summary rollups) and one dependency graph, with the critical path, slack, violations and
 * auto-scheduling worked out over working days.
 */
export class ScheduleModel<TRowData = unknown> {
	readonly tasks = new Map<string, ScheduleTask<TRowData>>();
	/** Top-level tasks in display order. */
	readonly roots: string[] = [];
	readonly links: DependencyLink[] = [];
	private slackCache: Map<string, number> | null = null;

	constructor(
		rows: readonly RecordRow<TRowData>[],
		readonly reader: RecordReader<TRowData>,
		readonly calendar: WorkCalendar = new WorkCalendar()
	) {
		for (const row of rows) {
			const span = reader.span(row);
			const milestone = reader.isMilestone(row);
			this.tasks.set(row.id, {
				id: row.id,
				row,
				parent: reader.parent(row),
				children: [],
				depth: 0,
				wbs: '',
				summary: false,
				milestone,
				span,
				duration: span ? calendar.duration(span, milestone) : 0,
				progress: reader.isDone(row) ? 1 : (reader.progress(row) ?? 0),
				done: reader.isDone(row),
				baseline: reader.baseline(row),
				predecessors: [],
				successors: [],
			});
		}
		// Parents outside the displayed rows, or cycles, leave a task at the top level.
		for (const task of this.tasks.values()) {
			if (task.parent && task.parent !== task.id && this.tasks.has(task.parent) && !this.isAncestor(task.id, task.parent))
				this.tasks.get(task.parent)!.children.push(task.id);
			else {
				task.parent = null;
				this.roots.push(task.id);
			}
		}
		const number = (ids: string[], prefix: string, depth: number) =>
			ids.forEach((id, i) => {
				const task = this.tasks.get(id)!;
				task.depth = depth;
				task.wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
				task.summary = task.children.length > 0;
				number(task.children, task.wbs, depth + 1);
			});
		number(this.roots, '', 0);
		for (const task of this.tasks.values())
			for (const link of reader.dependencies(task.row)) {
				if (!this.tasks.has(link.from) || this.related(link.from, link.to)) continue;
				task.predecessors.push(link);
				this.tasks.get(link.from)!.successors.push(link);
				this.links.push(link);
			}
		this.rollup();
	}

	private isAncestor(ancestor: string, id: string): boolean {
		// Walks the raw parent values (before the outline is built), stopping at cycles.
		const seen = new Set<string>();
		let current: string | null = id;
		while (current && !seen.has(current)) {
			seen.add(current);
			if (current === ancestor) return true;
			current = this.tasks.get(current)?.parent ?? null;
		}
		return false;
	}

	/** One task contains the other: links between them are meaningless. */
	related(a: string, b: string): boolean {
		const contains = (outer: string, inner: string) => {
			for (let current = this.tasks.get(inner)?.parent; current; current = this.tasks.get(current)?.parent) if (current === outer) return true;
			return false;
		};
		return a === b || contains(a, b) || contains(b, a);
	}

	/** Summary spans and progress from their children (post-order). */
	private rollup(): void {
		const visit = (id: string): void => {
			const task = this.tasks.get(id)!;
			if (!task.summary) return;
			let start = Infinity;
			let end = -Infinity;
			let weighted = 0;
			let weight = 0;
			let baseStart = Infinity;
			let baseEnd = -Infinity;
			for (const child of task.children) {
				visit(child);
				const c = this.tasks.get(child)!;
				if (c.span) {
					start = Math.min(start, c.span.start);
					end = Math.max(end, c.span.end);
				}
				if (c.baseline) {
					baseStart = Math.min(baseStart, c.baseline.start);
					baseEnd = Math.max(baseEnd, c.baseline.end);
				}
				const w = Math.max(1, c.duration);
				weighted += c.progress * w;
				weight += w;
			}
			task.span = Number.isFinite(start) ? { start, end } : task.span;
			task.baseline = Number.isFinite(baseStart) ? { start: baseStart, end: baseEnd } : task.baseline;
			task.duration = task.span ? this.calendar.duration(task.span) : 0;
			task.progress = weight ? weighted / weight : task.progress;
			task.done = task.children.every((child) => this.tasks.get(child)!.done);
		};
		this.roots.forEach(visit);
	}

	/** Tasks in outline order, skipping the children of collapsed tasks. */
	visible(collapsed: ReadonlySet<string> = new Set()): ScheduleTask<TRowData>[] {
		const out: ScheduleTask<TRowData>[] = [];
		const walk = (ids: string[]) => {
			for (const id of ids) {
				const task = this.tasks.get(id)!;
				out.push(task);
				if (!collapsed.has(id)) walk(task.children);
			}
		};
		walk(this.roots);
		return out;
	}

	/** Leaf tasks beneath a task (itself when it is a leaf). */
	leaves(id: string): string[] {
		const task = this.tasks.get(id);
		if (!task) return [];
		if (!task.summary) return [id];
		return task.children.flatMap((child) => this.leaves(child));
	}

	/** The extent of every scheduled task. */
	extent(): DaySpan | null {
		let start = Infinity;
		let end = -Infinity;
		for (const task of this.tasks.values()) {
			if (!task.span) continue;
			start = Math.min(start, task.span.start, task.baseline?.start ?? Infinity);
			end = Math.max(end, task.span.end, task.baseline?.end ?? -Infinity);
		}
		return Number.isFinite(start) ? { start, end } : null;
	}

	/**
	 * The earliest the successor's start may be, given one link and the predecessor's span: FS waits
	 * for the end, SS for the start; FF and SF bound the successor's end, converted with its duration.
	 */
	earliestStart(link: DependencyLink, predecessor: DaySpan, successorDuration: number): Day {
		const cal = this.calendar;
		const finishBound = (bound: Day) => (successorDuration <= 1 ? bound : cal.add(bound, -(successorDuration - 1)));
		switch (link.type) {
			case 'FS':
				return cal.add(predecessor.end, 1 + link.lag);
			case 'SS':
				return cal.add(predecessor.start, link.lag);
			case 'FF':
				return finishBound(cal.add(predecessor.end, link.lag));
			case 'SF':
				return finishBound(cal.add(predecessor.start, link.lag));
		}
	}

	/** Links the current dates break, with how far the successor would have to move. */
	violations(spans?: ReadonlyMap<string, DaySpan>): DependencyViolation[] {
		const spanOf = (id: string) => spans?.get(id) ?? this.tasks.get(id)?.span ?? null;
		const out: DependencyViolation[] = [];
		for (const link of this.links) {
			const from = spanOf(link.from);
			const to = spanOf(link.to);
			const task = this.tasks.get(link.to)!;
			if (!from || !to) continue;
			const earliest = this.earliestStart(link, from, task.milestone ? 0 : this.calendar.duration(to));
			if (to.start < earliest) out.push({ link, days: this.calendar.distance(to.start, earliest) });
		}
		return out;
	}

	/** Adding `from → to` would make a task wait on itself (directly or through its outline). */
	wouldCreateCycle(from: string, to: string): boolean {
		if (from === to || this.related(from, to)) return true;
		// Successors of a task include the successors of its ancestors' links and its descendants.
		const seen = new Set<string>();
		const stack = [to];
		while (stack.length) {
			const id = stack.pop()!;
			if (id === from) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			const task = this.tasks.get(id);
			if (!task) continue;
			for (const link of task.successors) stack.push(link.to);
			stack.push(...task.children);
			if (task.parent) stack.push(...this.tasks.get(task.parent)!.successors.map((link) => link.to));
		}
		return false;
	}

	/** Working days each task can slip before it delays the project's finish. */
	slack(): Map<string, number> {
		if (this.slackCache) return this.slackCache;
		const cal = this.calendar;
		const extent = this.extent();
		const lateFinish = new Map<string, Day>();
		const result = new Map<string, number>();
		if (!extent) return (this.slackCache = result);
		const projectEnd = Math.max(...[...this.tasks.values()].flatMap((task) => (task.span && !task.summary ? [task.span.end] : [])));
		const visiting = new Set<string>();
		const latest = (id: string): Day => {
			const known = lateFinish.get(id);
			if (known !== undefined) return known;
			const task = this.tasks.get(id)!;
			if (!task.span || visiting.has(id)) return projectEnd;
			visiting.add(id);
			const duration = task.milestone ? 1 : Math.max(1, task.duration);
			let finish = projectEnd;
			const successors = [...task.successors];
			for (let parent = task.parent; parent; parent = this.tasks.get(parent)!.parent) successors.push(...this.tasks.get(parent)!.successors);
			for (const link of successors) {
				const next = this.tasks.get(link.to)!;
				for (const leaf of this.leaves(next.id)) {
					const s = this.tasks.get(leaf)!;
					if (!s.span) continue;
					const sDuration = s.milestone ? 1 : Math.max(1, s.duration);
					const sFinish = latest(leaf);
					const sStart = sDuration <= 1 ? sFinish : cal.add(sFinish, -(sDuration - 1));
					let bound: Day;
					switch (link.type) {
						case 'FS':
							bound = cal.add(sStart, -(1 + link.lag));
							break;
						case 'SS':
							bound = cal.add(cal.add(sStart, -link.lag), duration - 1);
							break;
						case 'FF':
							bound = cal.add(sFinish, -link.lag);
							break;
						case 'SF':
							bound = cal.add(cal.add(sFinish, -link.lag), duration - 1);
							break;
					}
					finish = Math.min(finish, bound);
				}
			}
			visiting.delete(id);
			lateFinish.set(id, finish);
			return finish;
		};
		for (const task of this.tasks.values()) {
			if (!task.span || task.summary) continue;
			result.set(task.id, cal.distance(task.span.end, latest(task.id)));
		}
		for (const task of this.tasks.values()) {
			if (!task.summary) continue;
			const values = this.leaves(task.id).flatMap((leaf) => (result.has(leaf) ? [result.get(leaf)!] : []));
			if (values.length) result.set(task.id, Math.min(...values));
		}
		return (this.slackCache = result);
	}

	/** Tasks on the critical path: no slack (unfinished work that delays the finish if it slips). */
	critical(): Set<string> {
		const out = new Set<string>();
		for (const [id, slack] of this.slack()) if (slack <= 0 && !this.tasks.get(id)!.done) out.add(id);
		return out;
	}

	/** Working-day schedule variance against the baseline: positive = finishing late. */
	variance(id: string): number | null {
		const task = this.tasks.get(id);
		if (!task?.span || !task.baseline) return null;
		return this.calendar.distance(task.baseline.end, task.span.end);
	}

	/**
	 * Moves successors so every link holds, starting from the anchors (or from every task), keeping
	 * each task's working-day duration. Returns the changes to review before writing them.
	 */
	autoSchedule(options: AutoScheduleOptions = {}): AutoScheduleResult {
		const mode = options.mode ?? 'push';
		const cal = this.calendar;
		const spans = new Map<string, DaySpan>();
		for (const task of this.tasks.values()) if (task.span && !task.summary) spans.set(task.id, task.span);
		const anchors = options.anchors ?? new Map();
		for (const [id, span] of anchors)
			for (const leaf of this.leaves(id)) {
				if (leaf === id) spans.set(id, span);
				else {
					// A moved summary moves its leaves by the same working-day offset.
					const summary = this.tasks.get(id)!.span;
					const own = spans.get(leaf);
					if (summary && own) {
						const shift = cal.distance(summary.start, span.start);
						spans.set(leaf, cal.spanFrom(cal.add(own.start, shift), this.tasks.get(leaf)!.milestone ? 1 : cal.duration(own)));
					}
				}
			}
		const fixed = new Set<string>([...anchors.keys()].flatMap((id) => this.leaves(id)));
		const spanOf = (id: string): DaySpan | null => {
			const task = this.tasks.get(id)!;
			if (!task.summary) return spans.get(id) ?? null;
			let start = Infinity;
			let end = -Infinity;
			for (const leaf of this.leaves(id)) {
				const span = spans.get(leaf);
				if (span) {
					start = Math.min(start, span.start);
					end = Math.max(end, span.end);
				}
			}
			return Number.isFinite(start) ? { start, end } : null;
		};
		const incoming = (id: string): DependencyLink[] => {
			const links = [...this.tasks.get(id)!.predecessors];
			for (let parent = this.tasks.get(id)!.parent; parent; parent = this.tasks.get(parent)!.parent)
				links.push(...this.tasks.get(parent)!.predecessors);
			return links;
		};
		const queue: string[] = anchors.size ? [...fixed] : [...spans.keys()];
		const queued = new Set(queue);
		const unresolved = new Set<DependencyLink>();
		let budget = Math.max(1000, spans.size * 50);
		const enqueueSuccessors = (id: string) => {
			const sources = [id];
			for (let parent = this.tasks.get(id)!.parent; parent; parent = this.tasks.get(parent)!.parent) sources.push(parent);
			for (const source of sources)
				for (const link of this.tasks.get(source)!.successors)
					for (const leaf of this.leaves(link.to))
						if (!queued.has(leaf)) {
							queued.add(leaf);
							queue.push(leaf);
						}
		};
		while (queue.length) {
			const id = queue.shift()!;
			queued.delete(id);
			if (--budget < 0) {
				for (const link of this.links) unresolved.add(link);
				break;
			}
			const span = spans.get(id);
			const task = this.tasks.get(id)!;
			if (!span) continue;
			if (!fixed.has(id)) {
				const links = incoming(id);
				const duration = task.milestone ? 1 : cal.duration(span);
				let earliest = -Infinity;
				for (const link of links) {
					const from = spanOf(link.from);
					if (from) earliest = Math.max(earliest, this.earliestStart(link, from, duration));
				}
				if (Number.isFinite(earliest)) {
					const start = mode === 'tight' ? earliest : Math.max(span.start, earliest);
					if (start !== span.start) {
						const next = task.milestone ? { start: cal.forward(start), end: cal.forward(start) } : cal.spanFrom(start, duration);
						if (next.start !== span.start || next.end !== span.end) spans.set(id, next);
					}
				}
			}
			enqueueSuccessors(id);
		}
		const changes: ScheduleChange[] = [];
		for (const [id, after] of spans) {
			const before = this.tasks.get(id)!.span;
			if (!before || before.start !== after.start || before.end !== after.end) changes.push({ id, before, after });
		}
		return { changes, unresolved: [...unresolved] };
	}
}

export const DEPENDENCY_LABELS: Record<DependencyType, string> = {
	FS: 'Finish to start',
	SS: 'Start to start',
	FF: 'Finish to finish',
	SF: 'Start to finish',
};
