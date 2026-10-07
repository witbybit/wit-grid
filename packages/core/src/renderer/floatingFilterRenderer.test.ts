// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InternalColumnDef } from '../columnDef.js';
import type { ColumnFilter, FilterModel } from '../filterModel.js';
import type { ColumnFilterDef } from '../filters/filterDef.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { FilterPopoverController } from './filterPopoverController.js';
import { FloatingFilterRenderer } from './floatingFilterRenderer.js';

type TestRow = { id: string };

interface TestColumn {
	field: string;
	lane: 'left' | 'center' | 'right';
	hidden?: boolean;
	filterDef?: ColumnFilterDef;
}

function makeGrid(columns: TestColumn[]) {
	const visibleColumns = columns.filter((column) => !column.hidden);
	const displayedColumns = visibleColumns.map(
		({ field, filterDef }) => ({ field, header: field, instanceId: field, filterDef }) as unknown as InternalColumnDef<TestRow>
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
	};
	for (const placement of topology.placements) topology.byColumnId.set(placement.columnId, placement);

	let filterModel: FilterModel | null = null;
	const listeners: (() => void)[] = [];
	const engine = {
		stateManager: {
			getState: () => ({ filterModel, defaultColWidth: 100 }),
			subscribeToKey: (key: string, fn: () => void) => {
				if (key === 'filterModel') listeners.push(fn);
				return () => {};
			},
		},
		columns: {
			getCompiledPlan: () => ({ displayedColumns, colWidths: visibleColumns.map(() => 100) }),
			getColumnDef: (field: string) => displayedColumns.find((c) => c.field === field),
		},
		instrumentation: { increment: vi.fn() },
		getColumnDistinctValueSummary: () => ({ values: ['Active', 'Paused'], counts: [3, 1], truncated: false, limit: null }),
		setFilterModel: vi.fn((next: FilterModel | null) => {
			filterModel = next;
			listeners.forEach((fn) => fn());
		}),
	};
	const filters = new FilterPopoverController(engine as never);
	const renderer = new FloatingFilterRenderer(engine as never, filters);
	const grid = document.createElement('div');
	const wrapper = document.createElement('div');
	const left = document.createElement('div');
	const center = document.createElement('div');
	const right = document.createElement('div');
	wrapper.append(left, center, right);
	grid.appendChild(wrapper);
	document.body.appendChild(grid);
	const plan = {
		chrome: { floatingFilterHeight: 36 },
		columns: { colStart: 0, colEnd: visibleColumns.length - 1, pinLeftCount: 1, pinRightCount: 1 },
		columnTopology: topology,
	} as unknown as GridLayoutPlan;
	renderer.mount(center, left, right);
	renderer.repaint(plan);
	// Filter model listeners repaint with the default plan; tests repaint with theirs.
	listeners.length = 0;
	listeners.push(() => renderer.repaint(plan));
	const setExternal = (field: string, filter: ColumnFilter | null) => {
		filterModel = filter ? { ...(filterModel ?? {}), [field]: filter } : null;
		renderer.repaint(plan);
	};
	return { renderer, grid, engine, setExternal };
}

function input(grid: HTMLElement, field: string): HTMLInputElement {
	return grid.querySelector(`[data-col-field="${field}"] input`) as HTMLInputElement;
}

afterEach(() => {
	document.body.textContent = '';
	vi.useRealTimers();
});

describe('FloatingFilterRenderer', () => {
	it('shows each column’s compact editor in visual order across lanes, so Tab follows the columns', () => {
		const { grid } = makeGrid([
			{ field: 'right', lane: 'right' },
			{ field: 'centerA', lane: 'center' },
			{ field: 'hidden', lane: 'center', hidden: true },
			{ field: 'left', lane: 'left' },
			{ field: 'centerB', lane: 'center' },
		]);
		const fields = [...grid.querySelectorAll('input')].map((el) => el.closest<HTMLElement>('[data-col-field]')!.dataset.colField);
		expect(fields).toEqual(['left', 'centerA', 'centerB', 'right']);
		expect(grid.querySelector('[data-col-field="hidden"]')).toBeNull();
		// Compact editors: the operator shows as its symbol.
		expect(grid.querySelector('[data-col-field="left"] .og-flt-op')!.textContent).toBe('~');
	});

	it('applies typing after a pause (through the grid scheduler) and Enter at once, keeping the field', async () => {
		vi.useFakeTimers();
		const { grid, engine } = makeGrid([{ field: 'name', lane: 'center' }]);
		const field = input(grid, 'name');
		field.value = 'ali';
		field.dispatchEvent(new Event('input'));
		expect(engine.setFilterModel).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(320);
		expect(engine.setFilterModel).toHaveBeenLastCalledWith({ name: { type: 'text', operator: 'contains', value: 'ali' } });
		field.value = 'alice';
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(engine.setFilterModel).toHaveBeenLastCalledWith({ name: { type: 'text', operator: 'contains', value: 'alice' } });
		// Its own change does not rebuild the editor (the user keeps typing in the same field).
		expect(input(grid, 'name')).toBe(field);
	});

	it('shows a filter set elsewhere, and lists as a summary chip opening the full editor', () => {
		const { grid, setExternal } = makeGrid([
			{ field: 'price', lane: 'center', filterDef: { type: 'number' } },
			{ field: 'status', lane: 'center', filterDef: { type: 'select' } },
		]);
		setExternal('price', { type: 'number', operator: 'gte', value: 100 });
		expect(input(grid, 'price').value).toBe('100');
		expect(grid.querySelector('[data-col-field="price"] .og-flt-op')!.textContent).toBe('≥');

		const chip = grid.querySelector<HTMLButtonElement>('[data-col-field="status"] .og-flt-chip')!;
		expect(chip.textContent).toBe('All');
		chip.click();
		const options = [...document.querySelectorAll('.og-ct-popover .og-ct-option')];
		expect(options.map((el) => el.querySelector('.og-ct-option-label')!.textContent)).toEqual(['Active', 'Paused']);
		expect(options[0].querySelector('.og-ct-option-count')!.textContent).toBe('3');
		(options[0] as HTMLElement).click();
		expect(chip.textContent).toBe('Active');
		expect(chip.hasAttribute('data-active')).toBe(true);
	});
});
