import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../../columnDef.js';
import { checkboxColumnType, dateRangeColumnType, personColumnType, progressColumnType } from '../../cells/cellTypes.js';
import { isoDay, toDay } from '../days.js';
import { RecordReader, resolveRecordRoles, type RecordRow } from '../recordModel.js';
import { resourceLoad } from './resources.js';
import { ScheduleModel } from './scheduleModel.js';
import { isoWeek, TimeScale } from './timeScale.js';
import { WorkCalendar } from './workCalendar.js';

const d = (iso: string) => toDay(new Date(`${iso}T00:00:00`));

describe('work calendar', () => {
	const cal = new WorkCalendar({ holidays: ['2026-10-14'] });

	it('skips weekends and holidays', () => {
		expect(cal.isWorking(d('2026-10-10'))).toBe(false); // Saturday
		expect(cal.isWorking(d('2026-10-14'))).toBe(false); // holiday
		expect(isoDay(cal.forward(d('2026-10-10')))).toBe('2026-10-12');
		expect(isoDay(cal.backward(d('2026-10-11')))).toBe('2026-10-09');
	});

	it('adds and counts working days', () => {
		expect(isoDay(cal.add(d('2026-10-09'), 1))).toBe('2026-10-12');
		expect(isoDay(cal.add(d('2026-10-12'), 3))).toBe('2026-10-16'); // skips the holiday
		expect(isoDay(cal.add(d('2026-10-12'), -1))).toBe('2026-10-09');
		expect(cal.between(d('2026-10-12'), d('2026-10-16'))).toBe(4);
		expect(cal.distance(d('2026-10-16'), d('2026-10-12'))).toBe(-3);
		expect(cal.spanFrom(d('2026-10-10'), 3)).toEqual({ start: d('2026-10-12'), end: d('2026-10-15') });
	});

	it('agrees with day-by-day counting over long spans', () => {
		const plain = new WorkCalendar();
		const start = d('2026-01-01');
		let count = 0;
		for (let day = start; day <= start + 400; day++) if (plain.isWorking(day)) count++;
		expect(plain.between(start, start + 400)).toBe(count);
		let day = start;
		for (let i = 0; i < 77; i++) day = plain.add(day, 1);
		expect(plain.add(start, 77)).toBe(day);
		expect(plain.add(plain.add(start, 77), -77)).toBe(plain.forward(start));
	});
});

interface Task {
	name: string;
	parent?: string;
	plan?: { start: string; end: string };
	baseline?: { start: string; end: string };
	deps?: string;
	progress?: number;
	milestone?: boolean;
	owner?: string;
}

const columns: ColumnDef<Task>[] = [
	{ field: 'name', header: 'Task' },
	{ field: 'parent', header: 'Parent' },
	{ field: 'plan', header: 'Schedule', ...dateRangeColumnType() },
	{ field: 'baseline', header: 'Baseline', ...dateRangeColumnType() },
	{ field: 'deps', header: 'Dependencies' },
	{ field: 'progress', header: 'Progress', ...progressColumnType() },
	{ field: 'milestone', header: 'Milestone', ...checkboxColumnType() },
	{ field: 'owner', header: 'Owner', ...personColumnType({ people: [{ value: 'ava' }, { value: 'leo' }] }) },
];
const reader = new RecordReader(columns, resolveRecordRoles(columns));
const span = (start: string, end: string) => ({ start, end });

// 1 Project
//   1.1 Design   Oct 5–9      (Mon–Fri)
//   1.2 Build    Oct 12–23    FS on Design
//   1.3 Docs     Oct 13–15    SS on Build +1
// 2 Launch       Oct 26       milestone, FS on Build
function project(overrides: Partial<Record<string, Partial<Task>>> = {}): RecordRow<Task>[] {
	const base: Record<string, Task> = {
		p: { name: 'Project' },
		design: {
			name: 'Design',
			parent: 'p',
			plan: span('2026-10-05', '2026-10-09'),
			progress: 100,
			owner: 'ava',
			baseline: span('2026-10-05', '2026-10-08'),
		},
		build: { name: 'Build', parent: 'p', plan: span('2026-10-12', '2026-10-23'), deps: 'design', progress: 50, owner: 'ava' },
		docs: { name: 'Docs', parent: 'p', plan: span('2026-10-13', '2026-10-15'), deps: 'buildSS+1', owner: 'ava' },
		launch: { name: 'Launch', plan: span('2026-10-26', '2026-10-26'), deps: 'build', milestone: true },
	};
	return Object.entries(base).map(([id, data]) => ({ id, data: { ...data, ...overrides[id] } }));
}

describe('schedule model', () => {
	it('builds the outline with WBS numbers and rolls up summaries', () => {
		const model = new ScheduleModel(project(), reader);
		expect(model.visible().map((task) => `${task.wbs} ${task.id}`)).toEqual(['1 p', '1.1 design', '1.2 build', '1.3 docs', '2 launch']);
		const summary = model.tasks.get('p')!;
		expect(summary.summary).toBe(true);
		expect(summary.span).toEqual({ start: d('2026-10-05'), end: d('2026-10-23') });
		// Duration-weighted: design 5d × 1 + build 10d × 0.5 + docs 3d × 0 = 10 / 18.
		expect(summary.progress).toBeCloseTo(10 / 18);
		expect(model.visible(new Set(['p'])).map((task) => task.id)).toEqual(['p', 'launch']);
		expect(model.tasks.get('launch')!.milestone).toBe(true);
	});

	it('keeps records whose parents are missing or cyclic at the top level', () => {
		const rows: RecordRow<Task>[] = [
			{ id: 'x', data: { name: 'x', parent: 'y' } },
			{ id: 'y', data: { name: 'y', parent: 'x' } },
			{ id: 'z', data: { name: 'z', parent: 'gone' } },
		];
		const model = new ScheduleModel(rows, reader);
		expect(
			model
				.visible()
				.map((task) => task.id)
				.sort()
		).toEqual(['x', 'y', 'z']);
	});

	it('finds violations, slack and the critical path', () => {
		const model = new ScheduleModel(project(), reader);
		expect(model.violations()).toEqual([]);
		const slack = model.slack();
		expect(slack.get('build')).toBe(0);
		expect(slack.get('launch')).toBe(0);
		// Docs (Oct 13–15) can slip until the project's last working day (Oct 26).
		expect(slack.get('docs')).toBe(7);
		expect([...model.critical()].sort()).toEqual(['build', 'launch', 'p']); // design is done; p holds critical work
		expect(model.variance('design')).toBe(1);

		const late = new ScheduleModel(project({ build: { plan: span('2026-10-08', '2026-10-21') } }), reader);
		expect(late.violations()).toEqual([{ link: { from: 'design', to: 'build', type: 'FS', lag: 0 }, days: 2 }]);
	});

	it('refuses links that would make a task wait on itself', () => {
		const model = new ScheduleModel(project(), reader);
		expect(model.wouldCreateCycle('launch', 'design')).toBe(true);
		expect(model.wouldCreateCycle('docs', 'design')).toBe(true); // docs ← build ← design
		expect(model.wouldCreateCycle('p', 'build')).toBe(true); // parent and child
		expect(model.wouldCreateCycle('design', 'docs')).toBe(false);
	});

	it('auto-schedules successors after a move, keeping working-day durations', () => {
		const model = new ScheduleModel(project(), reader);
		const { changes, unresolved } = model.autoSchedule({ anchors: new Map([['design', { start: d('2026-10-07'), end: d('2026-10-13') }]]) });
		expect(unresolved).toEqual([]);
		const byId = Object.fromEntries(changes.map((change) => [change.id, `${isoDay(change.after.start)}…${isoDay(change.after.end)}`]));
		expect(byId).toEqual({
			design: '2026-10-07…2026-10-13',
			build: '2026-10-14…2026-10-27', // 10 working days
			docs: '2026-10-15…2026-10-19', // SS +1, 3 working days
			launch: '2026-10-28…2026-10-28',
		});
	});

	it('pulls successors back to their earliest dates in tight mode', () => {
		const model = new ScheduleModel(
			project({ docs: { plan: span('2026-10-20', '2026-10-22') }, launch: { plan: span('2026-11-09', '2026-11-09') } }),
			reader
		);
		const { changes } = model.autoSchedule({ mode: 'tight' });
		expect(changes.map((change) => [change.id, isoDay(change.after.start)])).toEqual([
			['docs', '2026-10-13'],
			['launch', '2026-10-26'],
		]);
	});

	it('honours FF and SF links', () => {
		const rows: RecordRow<Task>[] = [
			{ id: 'a', data: { name: 'a', plan: span('2026-10-05', '2026-10-16') } },
			{ id: 'b', data: { name: 'b', plan: span('2026-10-05', '2026-10-07'), deps: 'aFF' } },
			{ id: 'c', data: { name: 'c', plan: span('2026-10-01', '2026-10-02'), deps: 'aSF+2' } },
		];
		const { changes } = new ScheduleModel(rows, reader).autoSchedule();
		const after = Object.fromEntries(changes.map((change) => [change.id, `${isoDay(change.after.start)}…${isoDay(change.after.end)}`]));
		expect(after.b).toBe('2026-10-14…2026-10-16');
		expect(after.c).toBe('2026-10-06…2026-10-07');
	});

	it('measures each person’s load and their over-allocated days', () => {
		const model = new ScheduleModel(project({ design: { progress: 0, plan: span('2026-10-05', '2026-10-13') } }), reader);
		const ava = resourceLoad(model, 'owner').get('ava')!;
		expect(ava.tasks.sort()).toEqual(['build', 'design', 'docs']);
		expect(ava.peak).toBe(3); // Oct 13: design, build and docs
		expect(ava.overDays.map(isoDay)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
	});
});

describe('time scale', () => {
	it('maps days to pixels and back', () => {
		const scale = new TimeScale(d('2026-10-01'), 'week');
		expect(scale.x(d('2026-10-03'))).toBe(40);
		expect(scale.dayAt(41)).toBe(d('2026-10-03'));
	});

	it('labels ISO weeks and the tiers of each zoom', () => {
		expect(isoWeek(d('2026-01-01'))).toBe(1);
		expect(isoWeek(d('2026-10-10'))).toBe(41);
		const days = new TimeScale(d('2026-10-05'), 'day').ticks(d('2026-10-05'), d('2026-10-12'));
		expect(days.major[0].label).toBe('W41');
		expect(days.minor).toHaveLength(7);
		expect(days.minor.filter((tick) => tick.quiet)).toHaveLength(2);
		const months = new TimeScale(d('2026-01-01'), 'month').ticks(d('2026-01-01'), d('2026-07-01'));
		expect(months.major.map((tick) => tick.label)).toEqual(['Q1 2026', 'Q2 2026']);
		expect(months.minor).toHaveLength(6);
		const years = new TimeScale(d('2026-01-01'), 'year').ticks(d('2026-01-01'), d('2028-01-01'));
		expect(years.major.map((tick) => tick.label)).toEqual(['2026', '2027']);
		expect(years.minor).toHaveLength(8);
	});
});
