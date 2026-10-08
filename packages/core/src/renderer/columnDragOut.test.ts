// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnInteractionController } from './columnInteractionController.js';

/** A grid container at (100, 100)–(500, 400) with a scroll viewport inside. */
function setup(options: { hidden?: string[]; dragOutHides?: boolean } = {}) {
	const columns = ['a', 'b', 'c'].map((field) => ({ field, header: field.toUpperCase(), hide: options.hidden?.includes(field) }));
	const engine = {
		stateManager: { getState: () => ({ enableColumnReorder: true, columns, sortModel: null }) },
		capabilityManager: { can: () => ({ allowed: true }) },
		moveColumn: vi.fn(),
		setSortModel: vi.fn(),
	};
	const container = document.createElement('div');
	container.className = 'og-grid-container';
	container.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100, toJSON: () => ({}) });
	const viewport = container.appendChild(document.createElement('div'));
	viewport.getBoundingClientRect = container.getBoundingClientRect;
	document.body.appendChild(container);
	const hideColumn = vi.fn();
	const controller = new ColumnInteractionController<unknown>({
		engine: engine as never,
		getOverlayLayer: () => null,
		getScrollViewport: () => viewport,
		getLayoutPlan: () => null,
		schedulePaint: () => {},
		gridScheduler: { raf: () => 0, cancelRaf: () => {}, timeout: () => 0, clearTimeout: () => {} } as never,
		dragOutHides: () => options.dragOutHides ?? true,
		hideColumn,
	});
	const header = document.createElement('div');
	header.dataset.colField = 'b';
	header.dataset.colIndex = '1';
	// currentTarget is read-only on real events: hand the controller a plain object.
	const pressAt = (x: number, y: number) =>
		controller.onHeaderCellMouseDown({ button: 0, clientX: x, clientY: y, target: header, currentTarget: header } as unknown as MouseEvent);
	const move = (x: number, y: number) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
	const release = () => window.dispatchEvent(new MouseEvent('mouseup'));
	const ghost = () => document.querySelector('.og-column-drag-ghost');
	return { engine, hideColumn, pressAt, move, release, ghost, controller };
}

afterEach(() => {
	document.body.textContent = '';
});

describe('dragging a column out of the grid', () => {
	it('hides it: the ghost says so before letting go', () => {
		const { pressAt, move, release, ghost, hideColumn, engine } = setup();
		pressAt(200, 110);
		move(220, 112);
		expect(ghost()?.hasAttribute('data-hide')).toBe(false);
		move(220, 40); // well above the grid
		expect(ghost()?.hasAttribute('data-hide')).toBe(true);
		release();
		expect(hideColumn).toHaveBeenCalledWith('b');
		expect(engine.moveColumn).not.toHaveBeenCalled();
		expect(ghost()).toBeNull();
	});

	it('just past the edge, or back inside, it does not hide', () => {
		const { pressAt, move, release, ghost, hideColumn } = setup();
		pressAt(200, 110);
		move(220, 112);
		move(220, 80); // 20px above: within the margin
		expect(ghost()?.hasAttribute('data-hide')).toBe(false);
		move(220, 40);
		move(220, 120); // back in
		expect(ghost()?.hasAttribute('data-hide')).toBe(false);
		release();
		expect(hideColumn).not.toHaveBeenCalled();
	});

	it('Escape cancels the drag, and so does the window losing focus', () => {
		const { pressAt, move, release, ghost, hideColumn } = setup();
		pressAt(200, 110);
		move(220, 112);
		move(220, 40);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(ghost()).toBeNull();
		release();
		expect(hideColumn).not.toHaveBeenCalled();

		pressAt(200, 110);
		move(220, 112);
		move(220, 40);
		window.dispatchEvent(new Event('blur'));
		expect(hideColumn).not.toHaveBeenCalled();
	});

	it('never the last visible column, and not when turned off', () => {
		const last = setup({ hidden: ['a', 'c'] });
		last.pressAt(200, 110);
		last.move(220, 112);
		last.move(220, 40);
		last.release();
		expect(last.hideColumn).not.toHaveBeenCalled();
		document.body.textContent = '';

		const off = setup({ dragOutHides: false });
		off.pressAt(200, 110);
		off.move(220, 112);
		off.move(220, 40);
		expect(off.ghost()?.hasAttribute('data-hide')).toBe(false);
		off.release();
		expect(off.hideColumn).not.toHaveBeenCalled();
	});
});
