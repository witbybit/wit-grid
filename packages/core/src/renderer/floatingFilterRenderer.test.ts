// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InternalColumnDef } from '../columnDef.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { FloatingFilterRenderer } from './floatingFilterRenderer.js';

type TestRow = { id: string };

interface TestColumn {
	field: string;
	lane: 'left' | 'center' | 'right';
	hidden?: boolean;
}

function makeGrid(columns: TestColumn[]) {
	const visibleColumns = columns.filter((column) => !column.hidden);
	const displayedColumns = visibleColumns.map(
		({ field }) =>
			({
				field,
				instanceId: field,
				filterType: 'text',
			}) as InternalColumnDef<TestRow>
	);
	const topology: any = {
		version: 1,
		placements: visibleColumns.map(({ field, lane }, index) => ({
			columnId: field,
			field,
			lane,
			laneIndex: visibleColumns.filter((column, candidate) => candidate < index && column.lane === lane).length,
			absoluteIndex: index,
			absoluteLeft: index * 100,
			laneOffset: index * 100,
			width: 100,
		})),
		byColumnId: new Map(),
		left: [],
		center: [],
		right: [],
		groupSegments: [],
		pinLeftWidth: 100,
		pinRightWidth: 100,
		pinRightBaseLeft: 200,
		totalContentWidth: visibleColumns.length * 100,
	};
	for (const placement of topology.placements) {
		topology.byColumnId.set(placement.columnId, placement);
		topology[placement.lane].push(placement);
	}

	const engine = {
		stateManager: {
			getState: () => ({ filterModel: null, defaultColWidth: 100 }),
			subscribeToKey: () => () => {},
		},
		columns: {
			getCompiledPlan: () => ({ displayedColumns, colWidths: visibleColumns.map(() => 100) }),
		},
		instrumentation: { increment: vi.fn() },
		setFilterModel: vi.fn(),
	};
	const renderer = new FloatingFilterRenderer(engine as never);
	const grid = document.createElement('div');
	const wrapper = document.createElement('div');
	wrapper.className = 'og-layer-floating-filter-wrapper';
	const left = document.createElement('div');
	const center = document.createElement('div');
	const right = document.createElement('div');
	wrapper.append(left, center, right);
	grid.appendChild(wrapper);
	document.body.appendChild(grid);
	renderer.mount(center, left, right);
	renderer.repaint({
		chrome: { floatingFilterHeight: 36 },
		columns: { colStart: 0, colEnd: visibleColumns.length - 1, pinLeftCount: 1, pinRightCount: 1 },
		columnTopology: topology,
	} as unknown as GridLayoutPlan);

	return { renderer, grid };
}

function input(grid: HTMLElement, field: string): HTMLInputElement {
	return grid.querySelector(`[data-col-field="${field}"] input`) as HTMLInputElement;
}

function tab(target: HTMLInputElement, shiftKey = false): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
	target.dispatchEvent(event);
	return event;
}

describe('FloatingFilterRenderer Tab navigation', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
	});

	it('uses its owning grid topology/DOM order across pinned lanes and skips hidden columns', () => {
		// `hidden` is absent from the compiled/displayed topology, so it creates no
		// focus stop between the two visible center-lane neighbours.
		const first = makeGrid([
			{ field: 'left', lane: 'left' },
			{ field: 'center', lane: 'center' },
			{ field: 'hidden', lane: 'center', hidden: true },
			{ field: 'right', lane: 'right' },
		]);
		const second = makeGrid([{ field: 'other', lane: 'center' }]);

		const left = input(first.grid, 'left');
		const center = input(first.grid, 'center');
		const right = input(first.grid, 'right');
		const other = input(second.grid, 'other');
		expect(first.grid.querySelector('[data-col-field="hidden"]')).toBeNull();

		const globalQuery = vi.spyOn(document, 'querySelectorAll');
		const layoutRead = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
		left.focus();
		expect(tab(left).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(center);
		expect(globalQuery).not.toHaveBeenCalled();
		expect(layoutRead).not.toHaveBeenCalled();
		expect(tab(center).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(right);
		expect(tab(right, true).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(center);

		// At either grid boundary, normal browser Tab behaviour is allowed rather
		// than the renderer jumping into the other grid.
		right.focus();
		expect(tab(right).defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(right);
		expect(document.activeElement).not.toBe(other);
		left.focus();
		expect(tab(left, true).defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(left);

		first.renderer.unmount();
		second.renderer.unmount();
	});

	it("keeps each grid's operator menu its own: another grid's scroll or menu never closes it", () => {
		const a = makeGrid([{ field: 'name', lane: 'center' }]);
		const b = makeGrid([{ field: 'name', lane: 'center' }]);
		const openMenu = (grid: HTMLElement) => grid.querySelector<HTMLButtonElement>('.og-floating-filter-op-btn')!.click();
		const menus = () => document.querySelectorAll('#og-floating-op-menu');

		openMenu(a.grid);
		expect(menus()).toHaveLength(1);
		b.renderer.syncScrollLeft({} as GridLayoutPlan);
		expect(menus()).toHaveLength(1);
		openMenu(b.grid);
		expect(menus()).toHaveLength(2);

		a.renderer.syncScrollLeft({} as GridLayoutPlan);
		expect(menus()).toHaveLength(1);
		b.renderer.unmount();
		expect(menus()).toHaveLength(0);
		a.renderer.unmount();
	});

	it('does not retain a destroyed grid as a Tab target', () => {
		const destroyed = makeGrid([{ field: 'destroyed', lane: 'center' }]);
		const live = makeGrid([{ field: 'live', lane: 'center' }]);
		const liveInput = input(live.grid, 'live');

		destroyed.renderer.unmount();
		destroyed.grid.remove();
		liveInput.focus();

		expect(tab(liveInput, true).defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(liveInput);

		live.renderer.unmount();
	});
});
