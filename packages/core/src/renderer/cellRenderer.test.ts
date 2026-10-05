// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellRenderer } from './cellRenderer.js';

describe('CellRenderer portal display', () => {
	it('does not rewrite the content-mode attribute for an already visible portal', () => {
		const cell = document.createElement('div');
		const renderer = new CellRenderer(() => {});
		renderer.showPortalContent(cell);
		const write = vi.spyOn(cell, 'setAttribute');
		renderer.showPortalContent(cell);
		expect(cell.dataset.contentMode).toBe('portal');
		expect(write).not.toHaveBeenCalled();
	});
});
