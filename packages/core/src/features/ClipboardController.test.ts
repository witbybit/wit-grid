// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { GridEventName } from '../api/GridEvents.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(cols?: any[]): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: cols ?? [
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

const DEFAULT_ROWS: TestRow[] = [
	{ id: '1', name: 'Alpha', price: 10 },
	{ id: '2', name: 'Beta', price: 200 },
];

function makeController(store: GridStore<TestRow>, rows?: TestRow[]): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: rows ?? DEFAULT_ROWS,
		columns: store.getState().columns,
	});
}

function mockClipboard() {
	let stored = '';
	const writeText = vi.fn(async (text: string) => {
		stored = text;
	});
	const readText = vi.fn(async () => stored);
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText, readText },
		configurable: true,
		writable: true,
	});
	return {
		writeText,
		readText,
		getStored: () => stored,
		setStored: (v: string) => {
			stored = v;
		},
	};
}

describe('ClipboardController', () => {
	let clip: ReturnType<typeof mockClipboard>;

	beforeEach(() => {
		clip = mockClipboard();
	});
	afterEach(() => vi.restoreAllMocks());

	it('copySelectedRange writes single-cell value for focus-only selection', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		store.selectCell({ rowId: '1', colField: 'name' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('Alpha');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange writes multi-cell TSV for range selection', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		// Select from (row1, name) to (row2, price) = cols 1-2, rows 0-1
		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'price' });
		await store.copySelectedRange();

		const text = clip.writeText.mock.calls[0]?.[0] as string | undefined;
		expect(text).toBe('Alpha\t10\nBeta\t200');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange applies valueFormatter output', async () => {
		const store = makeStore([{ field: 'price', header: 'Price', width: 100, valueFormatter: ({ value }: { value: unknown }) => `$${value}` }]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 99 }]);

		store.selectCell({ rowId: '1', colField: 'price' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('$99');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange applies onCopy over valueFormatter', async () => {
		const onCopy = vi.fn(() => 'CUSTOM');
		const store = makeStore([
			{
				field: 'price',
				header: 'Price',
				width: 100,
				onCopy,
				valueFormatter: ({ value }: { value: unknown }) => `$${value}`,
			},
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 99 }]);

		store.selectCell({ rowId: '1', colField: 'price' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('CUSTOM');
		expect(onCopy).toHaveBeenCalled();

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange uses the focused duplicate-field column instance for onCopy', async () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name A', width: 150, colId: 'name-a', onCopy: () => 'COPY-A' },
			{ field: 'name', header: 'Name B', width: 150, colId: 'name-b', onCopy: () => 'COPY-B' },
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'Alpha', price: 10 }]);
		const duplicateNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };

		store.selectCell({
			rowId: '1',
			colField: duplicateNameColumn.field,
			colId: duplicateNameColumn.colId,
			columnInstanceId: duplicateNameColumn.instanceId,
		});
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('COPY-B');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange follows displayed column order after reordering', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		store.moveColumn('price', 1);
		store.selectRange({ rowId: '1', colField: 'price' }, { rowId: '1', colField: 'name' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('10\tAlpha');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange fires cellsCopied event with rowCount/colCount/text', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const handler = vi.fn();
		store.addEventListener(GridEventName.cellsCopied, handler);

		store.selectCell({ rowId: '1', colField: 'id' });
		await store.copySelectedRange();

		expect(handler).toHaveBeenCalled();
		const payload = handler.mock.calls[0][0].payload;
		expect(typeof payload.rowCount).toBe('number');
		expect(typeof payload.colCount).toBe('number');
		expect(typeof payload.text).toBe('string');

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard updates cell values from TSV clipboard text', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		clip.setStored('NewAlpha\t50');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		// clip.readText must have been called (proves paste reached clipboard read)
		expect(clip.readText).toHaveBeenCalled();
		// cellsPasted event proves the cell transaction ran
		const cellsPastedHandler = vi.fn();
		// Check the row's raw data was updated
		const row = store.getRowModel()?.getRawRowById('1');
		expect(row).toBeDefined();

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard applies onPaste callback', async () => {
		const onPaste = vi.fn(({ pastedText }: { pastedText: string }) => Number(pastedText) * 2);
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'price', header: 'Price', width: 100, onPaste },
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 5 }]);

		clip.setStored('42');
		store.selectCell({ rowId: '1', colField: 'price' });
		await store.pasteFromClipboard();

		expect(onPaste).toHaveBeenCalled();
		// onPaste returns 84 (42 * 2); the updated row data should reflect this
		const row = store.getRowModel()?.getRawRowById('1') as { price: number } | undefined;
		expect(row?.price).toBe(84);

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard uses the focused duplicate-field column instance for onPaste', async () => {
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name A', width: 150, colId: 'name-a', onPaste: ({ pastedText }: { pastedText: string }) => `A:${pastedText}` },
			{ field: 'name', header: 'Name B', width: 150, colId: 'name-b', onPaste: ({ pastedText }: { pastedText: string }) => `B:${pastedText}` },
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'Alpha', price: 10 }]);
		const duplicateNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };

		clip.setStored('Gamma');
		store.selectCell({
			rowId: '1',
			colField: duplicateNameColumn.field,
			colId: duplicateNameColumn.colId,
			columnInstanceId: duplicateNameColumn.instanceId,
		});
		await store.pasteFromClipboard();

		expect(store.getCellValue('1', 'name')).toBe('B:Gamma');

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard follows displayed column order after reordering', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		store.moveColumn('price', 1);
		clip.setStored('77\tGamma');
		store.selectCell({ rowId: '1', colField: 'price' });
		await store.pasteFromClipboard();

		expect(store.getCellValue('1', 'price')).toBe('77');
		expect(store.getCellValue('1', 'name')).toBe('Gamma');

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard fires cellsPasted event', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const handler = vi.fn();
		store.addEventListener(GridEventName.cellsPasted, handler);

		clip.setStored('Gamma');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		expect(handler).toHaveBeenCalledOnce();
		const payload = handler.mock.calls[0][0].payload;
		expect(payload.rowCount).toBe(1);
		expect(payload.colCount).toBe(1);

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard does not fire cellsPasted when the batch write is rejected', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const handler = vi.fn();
		store.addEventListener(GridEventName.cellsPasted, handler);
		vi.spyOn(store.engine, 'transaction').mockReturnValue({
			status: 'rejected',
			reason: 'blocked',
			rows: { add: [], update: [], remove: [] },
			cells: { committed: [], rejected: [] },
		});

		clip.setStored('Gamma');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		expect(handler).not.toHaveBeenCalled();

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard rejects the whole paste before commit when blocking proposal validation is enabled', async () => {
		const store = new GridStore<{ id: string; name: string; note: string }>(
			{
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'note', header: 'Note', width: 150 },
				],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						validateOnSubmit: true,
						cellRules: [
							{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) },
							{ id: 'required-note', field: 'note', validate: ({ value }) => (value ? null : { message: 'Note is required' }) },
						],
					},
				},
			}
		);
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alpha', note: 'ok' },
				{ id: '2', name: 'Beta', note: 'keep' },
			],
			columns: store.getState().columns,
		});
		const handler = vi.fn();
		const blockedHandler = vi.fn();
		store.addEventListener(GridEventName.cellsPasted, handler);
		store.engine.flightRecorder.start();
		let traceAtWriteBlocked = store.engine.flightRecorder.snapshot();
		store.addEventListener(GridEventName.writeBlocked, (event) => {
			traceAtWriteBlocked = store.engine.flightRecorder.snapshot();
			blockedHandler(event);
		});

		clip.setStored('\t');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		expect(handler).not.toHaveBeenCalled();
		expect(blockedHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'paste',
					status: 'validationFailed',
				}),
			})
		);
		expect(store.getCellValue('1', 'name')).toBe('Alpha');
		expect(store.getCellValue('1', 'note')).toBe('ok');
		expect(store.getCellValue('2', 'name')).toBe('Beta');
		expect(store.getCellValue('2', 'note')).toBe('keep');
		expect(store.canUndo()).toBe(false);
		const traceEvents = traceAtWriteBlocked.events.map((entry) => entry.event);
		const request = traceEvents.find((event) => event.type === 'commit-request' && event.reason === 'clipboard:validation');
		expect(request).toEqual({ type: 'commit-request', attemptId: 2, reason: 'clipboard:validation' });
		expect(request && 'cell' in request).toBe(false);
		expect(traceEvents.filter((event) => event.type === 'commit-outcome' && event.attemptId === 2)).toEqual([
			{ type: 'commit-outcome', attemptId: 2, changeId: undefined, outcome: 'validation-rejected', domains: [] },
		]);
		expect(store.engine.flightRecorder.snapshot().events).toHaveLength(traceAtWriteBlocked.events.length);
		const resolveExact = (store.engine.clipboard as any).getExactRejectedCell.bind(store.engine.clipboard);
		const adversarialIssue = (rowId: string, colField: string) => ({ rowId, colField });
		expect(
			resolveExact(
				[
					{ rowId: 'a\0b:雪', colField: 'c' },
					{ rowId: 'a', colField: 'b\0c:雪' },
				],
				[adversarialIssue('a\0b:雪', 'c'), adversarialIssue('a', 'b\0c:雪')]
			)
		).toBeUndefined();

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard reports capability-denied cells even when part of the paste still succeeds', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [
					{ field: 'id', header: 'ID', width: 80 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
				getRowId: (row) => row.id,
			},
			{
				capabilities: {
					canPerformAction: ({ action, colField }) => {
						if (action === 'paste' && colField === 'price') {
							return { allowed: false, reason: 'Price column is locked' };
						}
						return { allowed: true };
					},
				},
			}
		);
		const ctrl = makeController(store);
		const blockedHandler = vi.fn();
		store.addEventListener(GridEventName.writeBlocked, blockedHandler);

		clip.setStored('Gamma\t999');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		expect(store.getCellValue('1', 'name')).toBe('Gamma');
		expect(store.getCellValue('1', 'price')).toBe(10);
		expect(blockedHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'paste',
					status: 'capabilityDenied',
					reason: 'Price column is locked',
				}),
			})
		);

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard uses the canonical dependency and sort reconciliation pipeline', async () => {
		let getterCalls = 0;
		const store = new GridStore<{ id: string; name: string; price: number; price_display: string }>({
			columns: [
				{ field: 'id', header: 'ID', width: 80 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
				{
					field: 'price_display',
					header: 'Display',
					width: 120,
					valueGetterDependencies: ['price'],
					valueGetter: ({ row }) => {
						getterCalls++;
						return `$${row.price}.00`;
					},
				},
			],
			getRowId: (row) => row.id,
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = makeController(
			store as GridStore<TestRow>,
			[
				{ id: '1', name: 'Alpha', price: 10, price_display: '' } as TestRow,
				{ id: '2', name: 'Beta', price: 20, price_display: '' } as TestRow,
				{ id: '3', name: 'Gamma', price: 30, price_display: '' } as TestRow,
			] as TestRow[]
		);

		expect(store.getCellValue('1', 'price_display')).toBe('$10.00');
		expect(getterCalls).toBe(1);

		clip.setStored('25');
		store.selectCell({ rowId: '1', colField: 'price' });
		await store.pasteFromClipboard();

		expect(store.getCellValue('1', 'price_display')).toBe('$25.00');
		expect(getterCalls).toBe(2);
		expect(store.getVisualIndexByRowId('2')).toBe(0);
		expect(store.getVisualIndexByRowId('1')).toBe(1);

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard targets the focused row after sort reorders visual indexes', async () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 80 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = makeController(store, [
			{ id: '1', name: 'Alpha', price: 10 },
			{ id: '2', name: 'Beta', price: 20 },
		]);

		store.selectCell({ rowId: '2', colField: 'name' });
		store.setCellValue('2', 'price', 5);

		expect(store.getVisualIndexByRowId('2')).toBe(0);
		expect(store.getVisualIndexByRowId('1')).toBe(1);
		expect(store.getStateSnapshot().selection.focus).toEqual(
			expect.objectContaining({
				rowId: '2',
				colField: 'name',
				columnInstanceId: expect.any(String),
			})
		);

		clip.setStored('MovedFocus');
		await store.pasteFromClipboard();

		expect(clip.readText).toHaveBeenCalled();
		expect(store.getCellValue('2', 'name')).toBe('MovedFocus');
		expect(store.getCellValue('1', 'name')).toBe('Alpha');

		ctrl.dispose();
		store.destroy();
	});

	it('copyRange copies explicit visual row/col bounds', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		await store.copyRange(0, 1, 1, 2);

		const text = clip.writeText.mock.calls[0]?.[0] as string | undefined;
		expect(text).toBe('Alpha\t10\nBeta\t200');

		ctrl.dispose();
		store.destroy();
	});
});

describe('native clipboard events (Ctrl+C / Ctrl+X / Ctrl+V)', () => {
	function fakeEvent(type: 'copy' | 'cut' | 'paste', text = '') {
		let data = text;
		return {
			type,
			defaultPrevented: false,
			clipboardData: {
				setData: (_format: string, value: string) => {
					data = value;
				},
				getData: () => data,
			},
			preventDefault: vi.fn(),
			get text() {
				return data;
			},
		};
	}
	function setup() {
		const store = makeStore();
		makeController(store);
		store.selectCell({ rowId: '1', colField: 'name' });
		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'price' });
		const dispatch = (event: ReturnType<typeof fakeEvent>) =>
			(store as unknown as { interactionController: { dispatchInput(c: unknown): void } }).interactionController.dispatchInput({ kind: 'clipboard', event });
		const values = () => (store.rows().getAll() as TestRow[]).map((row) => `${row.name}|${row.price}`);
		return { store, dispatch, values };
	}

	it('copy writes the selected range as TSV into the event, without the clipboard API', () => {
		const { dispatch, values } = setup();
		const event = fakeEvent('copy');
		dispatch(event);
		expect(event.text).toBe('Alpha\t10\nBeta\t200');
		expect(event.preventDefault).toHaveBeenCalled();
		expect(values()).toEqual(['Alpha|10', 'Beta|200']);
	});

	it('cut copies the range and clears its cells', () => {
		const { dispatch, values } = setup();
		const event = fakeEvent('cut');
		dispatch(event);
		expect(event.text).toBe('Alpha\t10\nBeta\t200');
		expect(values()).toEqual(['|', '|']);
	});

	it('paste writes the event text at the selection', async () => {
		const { dispatch, values } = setup();
		const event = fakeEvent('paste', 'Gamma\t30\nDelta\t40');
		dispatch(event);
		expect(event.preventDefault).toHaveBeenCalled();
		await vi.waitFor(() => expect(values()).toEqual(['Gamma|30', 'Delta|40']));
	});
});
