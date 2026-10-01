// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyCellTitlesAndValidation } from './binderShared.js';
import { CellSlot } from '../cellSlot.js';

describe('applyCellTitlesAndValidation', () => {
	it('writes title and validation once, then touches the DOM only when they change', async () => {
		const slot = new CellSlot(document.createElement('div'));
		const mutations: string[] = [];
		const observer = new MutationObserver((records) => records.forEach((r) => mutations.push(r.attributeName ?? '')));
		observer.observe(slot.element, { attributes: true });

		applyCellTitlesAndValidation(slot, 'Tip', '', 'Bad');
		applyCellTitlesAndValidation(slot, 'Tip', '', 'Bad');
		await Promise.resolve();
		expect(slot.element.title).toBe('Tip');
		expect(slot.element.dataset.validationError).toBe('Bad');
		expect(mutations.sort()).toEqual(['data-validation-error', 'title']);

		applyCellTitlesAndValidation(slot, null, '', undefined);
		await Promise.resolve();
		expect(slot.element.hasAttribute('title')).toBe(false);
		expect(slot.element.dataset.validationError).toBeUndefined();
		observer.disconnect();
	});

	it('starts from what an adopted element already carries', () => {
		const element = document.createElement('div');
		element.title = 'Existing';
		const slot = new CellSlot(element);
		applyCellTitlesAndValidation(slot, null, '', undefined);
		expect(element.hasAttribute('title')).toBe(false);
	});
});
