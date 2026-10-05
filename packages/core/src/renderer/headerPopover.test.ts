// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { RenderEngine } from './renderEngine.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

// Render invalidation is scheduled microtask → requestAnimationFrame (see frameCoordinator.ts),
// so DOM repaints from state changes (e.g. setFilterModel) never happen synchronously — tests
// that assert on the resulting DOM must flush both stages first.
async function flushPendingPaint(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('HeaderPopoverMenu', () => {
	let store: GridStore<TestRow>;
	let rowController: ClientRowModelController<TestRow>;
	let engine: RenderEngine<TestRow>;
	let container: HTMLDivElement;

	beforeEach(() => {
		container = document.createElement('div');
		container.style.width = '800px';
		container.style.height = '600px';
		document.body.appendChild(container);

		store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID' },
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price', filterType: 'number' },
			],
		});

		rowController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', name: 'Product C', price: 300 },
				{ id: 'r2', name: 'Product A', price: 100 },
				{ id: 'r3', name: 'Product B', price: 200 },
			],
			columns: store.getState().columns,
		});

		engine = new RenderEngine<TestRow>(store.engine, store);
		engine.mount(container);
	});

	afterEach(() => {
		engine.unmount();
		rowController.dispose();
		container.remove();
		// Clean up any remaining popovers
		document.querySelectorAll('.og-header-popover').forEach((el) => el.remove());
	});

	it('should append a menu button to each header cell', () => {
		const headerCells = container.querySelectorAll('.og-header-cell');
		expect(headerCells.length).toBe(3);

		headerCells.forEach((cell) => {
			const menuBtn = cell.querySelector('.og-header-menu-button');
			expect(menuBtn).not.toBeNull();
		});
	});

	it('should toggle popover on menu button clicks', () => {
		const menuBtn = container.querySelector('.og-header-menu-button') as HTMLDivElement;
		expect(menuBtn).not.toBeNull();

		// Open popover
		menuBtn.click();
		let popover = document.querySelector('.og-header-popover');
		expect(popover).not.toBeNull();
		expect((engine as any).headerMenu.activePopover).toBe(popover);

		// Click again to close (toggle)
		menuBtn.click();
		popover = document.querySelector('.og-header-popover');
		// Closed asynchronously due to fading out timeout
		expect((engine as any).headerMenu.activePopover).toBeNull();
	});

	it('should sort ascending and descending when sort options are clicked', () => {
		const nameCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'name'
		) as HTMLElement;
		const menuBtn = nameCell.querySelector('.og-header-menu-button') as HTMLDivElement;

		// Open popover
		menuBtn.click();
		const popover = document.querySelector('.og-header-popover') as HTMLDivElement;
		expect(popover).not.toBeNull();

		// Click sort ascending
		const sortAscBtn = Array.from(popover.querySelectorAll('.og-popover-item')).find((el) =>
			el.textContent?.includes('Sort Ascending')
		) as HTMLDivElement;
		expect(sortAscBtn).not.toBeNull();
		sortAscBtn.click();

		// Check rows are sorted by name asc (A, B, C)
		expect(store.getDataRowAtVisualIndex(0)?.name).toBe('Product A');
		expect(store.getDataRowAtVisualIndex(1)?.name).toBe('Product B');
		expect(store.getDataRowAtVisualIndex(2)?.name).toBe('Product C');

		// Open popover again
		menuBtn.click();
		const nextPopover = document.querySelector('.og-header-popover') as HTMLDivElement;

		// Click sort descending
		const sortDescBtn = Array.from(nextPopover.querySelectorAll('.og-popover-item')).find((el) =>
			el.textContent?.includes('Sort Descending')
		) as HTMLDivElement;
		expect(sortDescBtn).not.toBeNull();
		sortDescBtn.click();

		// Check rows are sorted by name desc (C, B, A)
		expect(store.getDataRowAtVisualIndex(0)?.name).toBe('Product C');
		expect(store.getDataRowAtVisualIndex(1)?.name).toBe('Product B');
		expect(store.getDataRowAtVisualIndex(2)?.name).toBe('Product A');
	});

	it('should apply and clear column filters', async () => {
		const priceCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'price'
		) as HTMLElement;
		const menuBtn = priceCell.querySelector('.og-header-menu-button') as HTMLDivElement;

		// Open popover
		menuBtn.click();
		const popover = document.querySelector('.og-header-popover') as HTMLDivElement;

		const select = popover.querySelector('.og-popover-select') as HTMLSelectElement;
		const input = popover.querySelector('.og-popover-input') as HTMLInputElement;
		const applyBtn = Array.from(popover.querySelectorAll('.og-popover-btn')).find((el) => el.textContent === 'Apply') as HTMLButtonElement;

		expect(select).not.toBeNull();
		expect(input).not.toBeNull();
		expect(applyBtn).not.toBeNull();

		// Filter for price > 150
		select.value = 'gt';
		input.value = '150';
		applyBtn.click();
		await flushPendingPaint();

		// Rows should be filtered: only C (300) and B (200) match
		expect(store.getVisualRowCount()).toBe(2);
		expect(store.getDataRowAtVisualIndex(0)?.price).toBe(300);
		expect(store.getDataRowAtVisualIndex(1)?.price).toBe(200);

		// The header's active-filter indicator must reflect the new filter as soon as the render
		// pipeline's own paint scheduling flushes — no unrelated event (a later click, a focus
		// change) should be required to nudge a repaint.
		const filterIndicator = priceCell.querySelector('.og-header-filter-indicator') as HTMLDivElement;
		expect(filterIndicator).not.toBeNull();
		expect(filterIndicator.style.display).toBe('flex');

		// Open popover again and verify existing query is populated
		menuBtn.click();
		const nextPopover = document.querySelector('.og-header-popover') as HTMLDivElement;
		const nextSelect = nextPopover.querySelector('.og-popover-select') as HTMLSelectElement;
		const nextInput = nextPopover.querySelector('.og-popover-input') as HTMLInputElement;
		expect(nextSelect.value).toBe('gt');
		expect(nextInput.value).toBe('150');

		// Click clear filter
		const clearBtn = Array.from(nextPopover.querySelectorAll('.og-popover-btn')).find((el) => el.textContent === 'Clear') as HTMLButtonElement;
		expect(clearBtn).not.toBeNull();
		clearBtn.click();
		await flushPendingPaint();

		// Rows should be restored
		expect(store.getVisualRowCount()).toBe(3);
		// Indicator must clear as soon as the paint pipeline flushes — same requirement as above.
		expect(filterIndicator.style.display).toBe('none');
	});

	it('should support custom headerMenuRenderer in ColumnDef', () => {
		const customRenderer = vi.fn().mockImplementation(({ container }) => {
			const label = document.createElement('div');
			label.textContent = 'Custom Filter Title';
			container.appendChild(label);
		});

		store.setColumns([
			{ field: 'id', header: 'ID' },
			{ field: 'name', header: 'Name', headerMenuRenderer: customRenderer },
			{ field: 'price', header: 'Price' },
		]);

		// Remount/repaint headers
		engine.unmount();
		engine.mount(container);

		const nameCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'name'
		) as HTMLElement;
		const menuBtn = nameCell.querySelector('.og-header-menu-button') as HTMLDivElement;

		// Trigger menu open
		menuBtn.click();

		// Custom renderer should be called
		expect(customRenderer).toHaveBeenCalled();
		const params = customRenderer.mock.calls[0][0];
		expect(params.colField).toBe('name');
		expect(params.column.field).toBe('name');
		expect(params.container.textContent).toContain('Custom Filter Title');
	});

	it('should cycle sorting when clicking the header cell itself (excluding buttons)', async () => {
		const nameCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'name'
		) as HTMLElement;

		expect(store.getState().sortModel).toBeNull();

		// Simulate simple click (mousedown followed by mouseup without move)
		const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, button: 0 });
		const mouseupEvent = new MouseEvent('mouseup', { bubbles: true });
		const click = () => {
			nameCell.dispatchEvent(mousedownEvent);
			window.dispatchEvent(mouseupEvent);
		};

		// The header shows the new sort at once; the sort itself runs after the next paint.
		click();
		expect(nameCell.getAttribute('aria-sort')).toBe('ascending');
		await vi.waitFor(() => expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]));

		click();
		expect(nameCell.getAttribute('aria-sort')).toBe('descending');
		await vi.waitFor(() => expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'desc' }]));

		click();
		await vi.waitFor(() => expect(store.getState().sortModel).toBeNull());
	});

	it('should hide the menu button when suppressHeaderMenu is true', () => {
		store.setColumns([
			{ field: 'id', header: 'ID', suppressHeaderMenu: true },
			{ field: 'name', header: 'Name' },
			{ field: 'price', header: 'Price' },
		]);

		engine.unmount();
		engine.mount(container);

		const idCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'id'
		) as HTMLElement;
		const idMenuBtn = idCell.querySelector('.og-header-menu-button') as HTMLDivElement;
		expect(idMenuBtn.style.display).toBe('none');

		const nameCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'name'
		) as HTMLElement;
		const nameMenuBtn = nameCell.querySelector('.og-header-menu-button') as HTMLDivElement;
		expect(nameMenuBtn.style.display).toBe('');
	});

	it('should respect ColumnDef options to conditionally hide menu sections and render dividers correctly', () => {
		store.setColumns([
			{ field: 'id', header: 'ID', canPin: () => false, canFilter: () => false, enableRowGroup: false },
			{ field: 'name', header: 'Name', sortable: false, enableRowGroup: false },
			{ field: 'price', header: 'Price' },
		]);

		engine.unmount();
		engine.mount(container);

		// 1. Click menu button on "id" cell (only sort is visible, pin/group and filter sections hidden)
		const idCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'id'
		) as HTMLElement;
		const idMenuBtn = idCell.querySelector('.og-header-menu-button') as HTMLDivElement;
		idMenuBtn.click();

		let popover = document.querySelector('.og-header-popover') as HTMLDivElement;
		expect(popover).not.toBeNull();

		expect(popover.querySelector('.og-popover-sort-section')).not.toBeNull();
		expect(popover.querySelector('.og-popover-filter-section')).toBeNull();
		expect(popover.querySelectorAll('.og-popover-divider').length).toBe(0);

		// Dismiss
		idMenuBtn.click();
		document.querySelectorAll('.og-header-popover').forEach((el) => el.remove());

		// 2. Click menu button on "name" cell (sort is hidden, pin/group and filter sections visible)
		const nameCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'name'
		) as HTMLElement;
		const nameMenuBtn = nameCell.querySelector('.og-header-menu-button') as HTMLDivElement;
		nameMenuBtn.click();

		popover = document.querySelector('.og-header-popover') as HTMLDivElement;
		expect(popover).not.toBeNull();

		const sortItems = Array.from(popover.querySelectorAll('.og-popover-item')).filter((el) => el.textContent?.includes('Sort Ascending'));
		expect(sortItems.length).toBe(0);
		// pin/group is present (because pinnable is true) and filter section is present
		expect(popover.querySelector('.og-popover-filter-section')).not.toBeNull();
		expect(popover.querySelectorAll('.og-popover-divider').length).toBe(1);

		nameMenuBtn.click();
	});

	it('hides "Group by Column" when canGroup returns false, even though enableRowGroup is not set', () => {
		store.setColumns([
			{ field: 'id', header: 'ID', canGroup: () => false },
			{ field: 'name', header: 'Name' },
			{ field: 'price', header: 'Price' },
		]);

		engine.unmount();
		engine.mount(container);

		// "id" is groupable by enableRowGroup's default, but explicitly denied via canGroup.
		const idCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'id'
		) as HTMLElement;
		const idMenuBtn = idCell.querySelector('.og-header-menu-button') as HTMLDivElement;
		idMenuBtn.click();

		let popover = document.querySelector('.og-header-popover') as HTMLDivElement;
		expect(popover).not.toBeNull();
		const idGroupItems = Array.from(popover.querySelectorAll('.og-popover-item')).filter((el) => el.textContent?.includes('Group by Column'));
		expect(idGroupItems.length).toBe(0);

		idMenuBtn.click();
		document.querySelectorAll('.og-header-popover').forEach((el) => el.remove());

		// "name" has no canGroup restriction — the item should still be present for comparison.
		const nameCell = Array.from(container.querySelectorAll('.og-header-cell')).find(
			(el) => (el as HTMLElement).dataset.colField === 'name'
		) as HTMLElement;
		const nameMenuBtn = nameCell.querySelector('.og-header-menu-button') as HTMLDivElement;
		nameMenuBtn.click();

		popover = document.querySelector('.og-header-popover') as HTMLDivElement;
		const nameGroupItems = Array.from(popover.querySelectorAll('.og-popover-item')).filter((el) => el.textContent?.includes('Group by Column'));
		expect(nameGroupItems.length).toBe(1);

		nameMenuBtn.click();
	});
});
