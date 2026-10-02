import { describe, expect, it } from 'vitest';
import { LiveFrameBudget } from './liveFrameBudget.js';

/** A clock that advances `stepMs` per read and counts reads. */
function steppingClock(stepMs: number) {
	let t = 0;
	const clock = { reads: 0, now: () => (clock.reads++, (t += stepMs)) };
	return clock;
}

describe('LiveFrameBudget DOM update timing', () => {
	it('times the first updates of a frame, charges the rest the running average, and still stops at the budget', () => {
		const clock = steppingClock(0.1); // every timed update measures 0.1 ms
		const budget = new LiveFrameBudget(clock.now);
		budget.configure(undefined, { maxMsPerFrame: 2 });
		budget.resetFrame();
		let admitted = 0;
		while (budget.beginDomUpdate()) {
			budget.endDomUpdate();
			admitted++;
			if (admitted > 1000) break;
		}
		// 2 ms at ~0.1 ms each: about 20 admitted, enforced although most were not timed.
		expect(admitted).toBeGreaterThanOrEqual(19);
		expect(admitted).toBeLessThanOrEqual(21);
		// Two reads per timed update only: the first 8 plus every 8th.
		expect(clock.reads).toBeLessThan(admitted * 2);
		expect(clock.reads).toBe(2 * (8 + Math.floor(admitted / 8) - 1));
	});

	it('starts each frame with exact timing again', () => {
		const clock = steppingClock(0.5);
		const budget = new LiveFrameBudget(clock.now);
		budget.configure(undefined, { maxMsPerFrame: 4 });
		budget.resetFrame();
		while (budget.beginDomUpdate()) budget.endDomUpdate();
		const readsFirstFrame = clock.reads;
		budget.resetFrame();
		expect(budget.beginDomUpdate()).toBe(true);
		budget.endDomUpdate();
		expect(clock.reads).toBe(readsFirstFrame + 2);
	});
});
