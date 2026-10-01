// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { RenderEngine } from './renderEngine.js';

interface Row {
	id: string;
	a: string;
	b: string;
}

afterEach(() => {
	document.body.textContent = '';
	vi.restoreAllMocks();
});

function mount() {
	const store = new GridStore<Row>({
		columns: [
			{ field: 'a', header: 'A', width: 100 },
			{ field: 'b', header: 'B', width: 100 },
		],
		defaultRowHeight: 40,
		getRowId: (row) => row.id,
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, a: `a${i}`, b: `b${i}` })),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 400,
		bottom: 400,
		width: 400,
		height: 400,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	renderer.fullPaint();
	const cellAt = (row: number, field: string) =>
		container.querySelector<HTMLElement>(`.og-row[data-row-index="${row}"] [data-col-field="${field}"]`)!;
	const press = (key: string) =>
		store.interactionController.handleKeyDown({
			key,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			preventDefault: () => {},
		} as KeyboardEvent);
	return { store, renderer, cellAt, press, destroy: () => (renderer.unmount(), controller.dispose(), store.destroy()) };
}

describe('keyboard navigation keeps DOM focus on the focused cell', () => {
	it('moves the browser focus with every arrow key (a lost focus lets the next key scroll the page)', () => {
		const grid = mount();
		grid.store.selectCell({ rowId: 'r2', colField: 'a' });
		grid.renderer.fullPaint();
		grid.cellAt(2, 'a').focus();
		expect(document.activeElement).toBe(grid.cellAt(2, 'a'));

		for (const [key, row, field] of [
			['ArrowDown', 3, 'a'],
			['ArrowDown', 4, 'a'],
			['ArrowRight', 4, 'b'],
			['ArrowUp', 3, 'b'],
			['ArrowLeft', 3, 'a'],
		] as const) {
			grid.press(key);
			grid.renderer.fullPaint();
			expect(document.activeElement, `after ${key}`).toBe(grid.cellAt(row, field));
		}
		grid.destroy();
	});

	it('does not steal focus when it is outside the grid', () => {
		const grid = mount();
		const outside = document.createElement('input');
		document.body.appendChild(outside);
		outside.focus();
		grid.store.selectCell({ rowId: 'r2', colField: 'a' });
		grid.renderer.fullPaint();
		expect(document.activeElement).toBe(outside);
		grid.destroy();
	});
});
