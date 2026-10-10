import type { Day } from '../days.js';
import type { ScheduleModel } from './scheduleModel.js';

export interface ResourceLoad {
	/** The person's value (option value). */
	resource: string;
	/** Concurrent open tasks per working day. */
	daily: Map<Day, number>;
	/** Tasks assigned (open and done). */
	tasks: string[];
	peak: number;
	/** Working days above capacity. */
	overDays: Day[];
}

/**
 * Workload per person: how many unfinished tasks each has on each working day, and the days above
 * their capacity (default one task at a time).
 */
export function resourceLoad<T>(
	model: ScheduleModel<T>,
	field: string | undefined,
	capacity: (resource: string) => number = () => 1
): Map<string, ResourceLoad> {
	const loads = new Map<string, ResourceLoad>();
	if (!field) return loads;
	for (const task of model.tasks.values()) {
		if (task.summary) continue;
		for (const resource of model.reader.values(task.row, field)) {
			let load = loads.get(resource);
			if (!load) {
				load = { resource, daily: new Map(), tasks: [], peak: 0, overDays: [] };
				loads.set(resource, load);
			}
			load.tasks.push(task.id);
			if (!task.span || task.done) continue;
			for (let day = task.span.start; day <= task.span.end; day++) {
				if (!model.calendar.isWorking(day)) continue;
				load.daily.set(day, (load.daily.get(day) ?? 0) + 1);
			}
		}
	}
	for (const load of loads.values()) {
		const limit = capacity(load.resource);
		for (const [day, count] of load.daily) {
			load.peak = Math.max(load.peak, count);
			if (count > limit) load.overDays.push(day);
		}
		load.overDays.sort((a, b) => a - b);
	}
	return loads;
}
