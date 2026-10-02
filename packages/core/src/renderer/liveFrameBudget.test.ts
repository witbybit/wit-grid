import { describe, expect, it } from 'vitest';
import { LiveFrameBudget } from './liveFrameBudget.js';

describe('LiveFrameBudget', () => {
	it('unconfigured — unlimited mounts and updates', () => {
		const budget = new LiveFrameBudget();
		for (let i = 0; i < 1000; i++) expect(budget.tryConsume('mount')).toBe(true);
	});

	it('caps mounts at maxMountsPerFrame, independent of updates', () => {
		const budget = new LiveFrameBudget();
		budget.configure({ maxMountsPerFrame: 2, maxUpdatesPerFrame: 5 });
		expect(budget.tryConsume('mount')).toBe(true);
		expect(budget.tryConsume('mount')).toBe(true);
		expect(budget.tryConsume('mount')).toBe(false);
		// Updates use a separate budget — still available.
		expect(budget.tryConsume('update')).toBe(true);
	});

	it('caps updates at maxUpdatesPerFrame, independent of mounts', () => {
		const budget = new LiveFrameBudget();
		budget.configure({ maxMountsPerFrame: 5, maxUpdatesPerFrame: 1 });
		expect(budget.tryConsume('update')).toBe(true);
		expect(budget.tryConsume('update')).toBe(false);
		expect(budget.tryConsume('mount')).toBe(true);
	});

	it('resetFrame() restores full budget for the next frame', () => {
		const budget = new LiveFrameBudget();
		budget.configure({ maxMountsPerFrame: 1 });
		expect(budget.tryConsume('mount')).toBe(true);
		expect(budget.tryConsume('mount')).toBe(false);
		budget.resetFrame();
		expect(budget.tryConsume('mount')).toBe(true);
	});
});
