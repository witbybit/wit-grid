// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore, GridEventName, type GridCellPointer } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { GridContextMenuPlugin, type ContextMenuParams } from './contextMenu.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

type ContextMenuTestPlugin = {
	copySelectedRange(params: ContextMenuParams<TestRow>): void;
	clearSelection(params: ContextMenuParams<TestRow>): void;
	cutSelectedRange(params: ContextMenuParams<TestRow>): void;
	pasteSelectedRange(params: ContextMenuParams<TestRow>): Promise<void>;
	selectAll(params: ContextMenuParams<TestRow>): void;
	activePointer: GridCellPointer | null;
	renderMenu(clientX: number, clientY: number): void;
	menuElement: HTMLDivElement | null;
};

describe('GridContextMenuPlugin', () => {
	let store: GridStore<TestRow>;
	let rowController: ClientRowModelController<TestRow>;
	let plugin: GridContextMenuPlugin<TestRow>;
	let testPlugin: ContextMenuTestPlugin;

	beforeEach(() => {
		// Mock navigator clipboard
		Object.defineProperty(globalThis, 'navigator', {
			value: {
				clipboard: {
					writeText: vi.fn().mockResolvedValue(undefined),
					readText: vi.fn().mockResolvedValue(''),
				},
			},
			configurable: true,
			writable: true,
		});

		store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID' },
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});

		rowController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', name: 'Product A', price: 100 },
				{ id: 'r2', name: 'Product B', price: 200 },
				{ id: 'r3', name: 'Product C', price: 300 },
			],
			columns: store.getState().columns,
		});

		plugin = new GridContextMenuPlugin<TestRow>();
		store.registerPlugin(plugin);
		testPlugin = plugin as unknown as ContextMenuTestPlugin;
	});

	afterEach(() => {
		rowController.dispose();
		plugin.onDestroy();
	});

	it('should register successfully without injecting API methods', () => {
		const contextMenuPlugin = store.getPlugin<GridContextMenuPlugin<TestRow>>('contextMenu');
		expect(contextMenuPlugin).not.toBeNull();
		expect((store as unknown as Record<string, unknown>).showContextMenu).toBeUndefined();
		expect((store as unknown as Record<string, unknown>).hideContextMenu).toBeUndefined();
	});

	it('should focus and select cell on right click if not already selected', () => {
		plugin.show('r2', 'name', 100, 100);

		const state = store.getState();
		expect(state.selection.focus).toEqual(expect.objectContaining({ rowId: 'r2', colField: 'name' }));
		expect(state.selection.range).toEqual({
			start: expect.objectContaining({ rowId: 'r2', colField: 'name' }),
			end: expect.objectContaining({ rowId: 'r2', colField: 'name' }),
		});
	});

	it('should maintain existing multi-cell selection when right-clicking within it', () => {
		// Programmatically set multi-cell selection: r1:name to r2:price
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		// Right click on r2:name which is inside the bounds
		plugin.show('r2', 'name', 100, 100);

		const state = store.getState();
		expect(state.selection.range).toEqual({
			start: expect.objectContaining({ rowId: 'r1', colField: 'name' }),
			end: expect.objectContaining({ rowId: 'r2', colField: 'price' }),
		});
	});

	it('should preserve a duplicate-field single-cell selection when showPointer targets the selected column instance', () => {
		rowController.dispose();
		plugin.onDestroy();

		store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID' },
				{ field: 'name', header: 'Name A', colId: 'name-a' },
				{ field: 'name', header: 'Name B', colId: 'name-b' },
				{ field: 'price', header: 'Price' },
			],
		});
		rowController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', name: 'Product A', price: 100 },
				{ id: 'r2', name: 'Product B', price: 200 },
			],
			columns: store.getState().columns,
		});
		plugin = new GridContextMenuPlugin<TestRow>();
		store.registerPlugin(plugin);
		testPlugin = plugin as unknown as ContextMenuTestPlugin;

		const secondNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };
		const selectedPointer = {
			rowId: 'r1',
			colField: secondNameColumn.field,
			colId: secondNameColumn.colId,
			columnInstanceId: secondNameColumn.instanceId,
		};

		store.selectCell(selectedPointer, 'api');
		plugin.showPointer(selectedPointer, 100, 100);

		expect(store.getState().selection.focus).toMatchObject(selectedPointer);
		expect(store.getState().selection.range).toEqual({
			start: expect.objectContaining(selectedPointer),
			end: expect.objectContaining(selectedPointer),
		});
	});

	it('should preserve a duplicate-field single-cell selection when showPointer only has duplicate colId metadata', () => {
		rowController.dispose();
		plugin.onDestroy();

		store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID' },
				{ field: 'name', header: 'Name A', colId: 'name-a' },
				{ field: 'name', header: 'Name B', colId: 'name-b' },
				{ field: 'price', header: 'Price' },
			],
		});
		rowController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', name: 'Product A', price: 100 },
				{ id: 'r2', name: 'Product B', price: 200 },
			],
			columns: store.getState().columns,
		});
		plugin = new GridContextMenuPlugin<TestRow>();
		store.registerPlugin(plugin);
		testPlugin = plugin as unknown as ContextMenuTestPlugin;

		store.selectCell({ rowId: 'r1', colField: 'name', colId: 'name-b' }, 'api');
		plugin.showPointer({ rowId: 'r1', colField: 'name', colId: 'name-b' }, 100, 100);

		expect(store.getState().selection.focus).toEqual(
			expect.objectContaining({
				rowId: 'r1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: expect.any(String),
			})
		);
		expect(store.getState().selection.range).toEqual({
			start: expect.objectContaining({ rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: expect.any(String) }),
			end: expect.objectContaining({ rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: expect.any(String) }),
		});
	});

	it('should copy selected range to clipboard in Excel-compatible TSV format', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			api: store,
			selection: state.selection,
		};

		// Call internal copy selected range directly or simulate it
		testPlugin.copySelectedRange(params);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Product A\t100\nProduct B\t200');
	});

	it('should clear selection values atomically', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			api: store,
			selection: state.selection,
		};

		testPlugin.clearSelection(params);

		expect(store.getCellValue('r1', 'name')).toBe('');
		expect(store.getCellValue('r1', 'price')).toBe('');
		expect(store.getCellValue('r2', 'name')).toBe('');
		expect(store.getCellValue('r2', 'price')).toBe('');
	});

	it('should cut selection values, copying them first then clearing them', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			api: store,
			selection: state.selection,
		};

		testPlugin.cutSelectedRange(params);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Product A\t100\nProduct B\t200');
		expect(store.getCellValue('r1', 'name')).toBe('');
		expect(store.getCellValue('r1', 'price')).toBe('');
	});

	it('should paste clipboard tab-separated values into range', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: vi.fn().mockResolvedValue('Copied Name\t999\nAnother Name\t888'),
				writeText: vi.fn(),
			},
			writable: true,
			configurable: true,
		});

		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			api: store,
			selection: state.selection,
		};

		await testPlugin.pasteSelectedRange(params);

		expect(store.getCellValue('r1', 'name')).toBe('Copied Name');
		expect(store.getCellValue('r1', 'price')).toBe('999');
		expect(store.getCellValue('r2', 'name')).toBe('Another Name');
		expect(store.getCellValue('r2', 'price')).toBe('888');
	});

	it('should silently ignore clipboard permission errors (no runtime faults)', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				readText: vi.fn().mockRejectedValue(new Error('paste denied')),
				writeText: vi.fn().mockRejectedValue(new Error('copy denied')),
			},
			writable: true,
			configurable: true,
		});

		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r1', colField: 'price' });
		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			api: store,
			selection: state.selection,
		};

		// Copy and paste should not throw even when clipboard access is denied
		testPlugin.copySelectedRange(params);
		await Promise.resolve();
		await testPlugin.pasteSelectedRange(params);

		// ClipboardController silently ignores clipboard errors (consistent with navigation plugin behavior)
		expect(store.getRuntimeFaults()).toHaveLength(0);
	});

	it('should select all cells in the grid', () => {
		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			api: store,
			selection: state.selection,
		};

		testPlugin.selectAll(params);

		const updatedState = store.getState();
		expect(updatedState.selection.range).toEqual({
			start: expect.objectContaining({ rowId: 'r1', colField: 'id' }),
			end: expect.objectContaining({ rowId: 'r3', colField: 'price' }),
		});
	});

	it('should not show menu if disabled in options', () => {
		plugin.setOptions({ disabled: true });
		plugin.show('r1', 'name', 100, 100);
		expect(testPlugin.menuElement).toBeNull();
	});

	it('should allow excluding default menu items', () => {
		plugin.setOptions({
			excludeDefaults: ['copy', 'clear'],
		});
		testPlugin.activePointer = { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' };
		testPlugin.renderMenu(100, 100);

		const menuEl = testPlugin.menuElement as HTMLDivElement;
		expect(menuEl).toBeDefined();
		const items = Array.from(menuEl.querySelectorAll('.og-context-menu-item'));
		const texts = items.map((el) => el.querySelector('.og-context-menu-item-label')?.textContent ?? el.textContent);

		expect(texts).not.toContain('Copy Selected Range');
		expect(texts).not.toContain('Clear Selection');
		expect(texts).toContain('Cut Selection');
		expect(texts).toContain('Paste Clipboard');
		expect(texts).toContain('Select All');
	});

	it('should support conditional disabled and hidden states', () => {
		plugin.setOptions({
			customItems: [
				{ label: 'Disabled Item', disabled: true, action: vi.fn() },
				{ label: 'Hidden Item', hidden: true, action: vi.fn() },
				{ label: 'Fn Disabled Item', disabled: () => true, action: vi.fn() },
				{ label: 'Fn Hidden Item', hidden: () => true, action: vi.fn() },
			],
		});

		testPlugin.activePointer = { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' };
		testPlugin.renderMenu(100, 100);

		const menuEl = testPlugin.menuElement as HTMLDivElement;
		const items = Array.from(menuEl.querySelectorAll('.og-context-menu-item'));
		const texts = items.map((el) => el.textContent);

		expect(texts).toContain('Disabled Item');
		expect(texts).toContain('Fn Disabled Item');
		expect(texts).not.toContain('Hidden Item');
		expect(texts).not.toContain('Fn Hidden Item');

		const disabledEl = items.find((el) => el.textContent === 'Disabled Item') as HTMLDivElement;
		expect(disabledEl.classList.contains('og-disabled')).toBe(true);
	});

	it('should support custom items and pass rich parameters to action callbacks', () => {
		const customAction = vi.fn();
		plugin.setOptions({
			customItems: [{ label: 'My Custom Action', action: customAction }],
		});

		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		testPlugin.activePointer = { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' };
		testPlugin.renderMenu(100, 100);

		const menuEl = testPlugin.menuElement as HTMLDivElement;
		const customItemEl = Array.from(menuEl.querySelectorAll('.og-context-menu-item')).find(
			(el) => el.textContent === 'My Custom Action'
		) as HTMLDivElement;

		expect(customItemEl).toBeDefined();
		customItemEl.click();

		expect(customAction).toHaveBeenCalled();
		const params = customAction.mock.calls[0][0];
		expect(params.rowId).toBe('r1');
		expect(params.colField).toBe('name');
		expect(params.pointer).toEqual(expect.objectContaining({ rowId: 'r1', colField: 'name' }));
		expect(params.api).not.toBe(store);
		expect(params.api.getStateSnapshot()).toEqual(store.getStateSnapshot());
		expect(params.selection.range).toEqual({
			start: expect.objectContaining({ rowId: 'r1', colField: 'name' }),
			end: expect.objectContaining({ rowId: 'r2', colField: 'price' }),
		});
		expect(params.selection.bounds).toEqual({
			minRow: 0,
			maxRow: 1,
			minCol: 1,
			maxCol: 2,
		});
	});

	it('custom items receive duplicate-field pointer identity through context menu params', () => {
		rowController.dispose();
		plugin.onDestroy();

		store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID' },
				{ field: 'name', header: 'Name A', colId: 'name-a' },
				{ field: 'name', header: 'Name B', colId: 'name-b' },
			],
		});
		rowController = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', name: 'Product A', price: 100 }],
			columns: store.getState().columns,
		});
		const customAction = vi.fn();
		plugin = new GridContextMenuPlugin<TestRow>({
			disableDefaults: true,
			customItems: [{ label: 'Inspect Pointer', action: customAction }],
		});
		store.registerPlugin(plugin);
		testPlugin = plugin as unknown as ContextMenuTestPlugin;
		const secondNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };
		const pointer = {
			rowId: 'r1',
			colField: secondNameColumn.field,
			colId: secondNameColumn.colId,
			columnInstanceId: secondNameColumn.instanceId,
		};

		plugin.showPointer(pointer, 100, 100);

		const customItemEl = Array.from(document.querySelectorAll('.og-context-menu-item')).find(
			(el) => el.textContent === 'Inspect Pointer'
		) as HTMLDivElement;
		customItemEl.click();

		expect(customAction).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: 'r1',
				colField: 'name',
				pointer: expect.objectContaining({
					rowId: 'r1',
					colField: 'name',
					colId: 'name-b',
					columnInstanceId: expect.any(String),
				}),
			})
		);
	});

	it('should dispatch cellValueChanged event when setting a cell value', () => {
		const spy = vi.fn();
		store.addEventListener(GridEventName.cellValueChanged, spy);
		store.setCellValue('r1', 'price', 999);
		expect(spy).toHaveBeenCalled();
		const event = spy.mock.calls[0][0];
		expect(event.payload).toEqual({
			rowId: 'r1',
			colField: 'price',
			oldValue: 100,
			newValue: 999,
		});
	});
});
