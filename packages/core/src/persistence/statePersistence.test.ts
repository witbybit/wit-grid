import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GRID_STATE_SCHEMA_VERSION,
	areRowHeightsEqual,
	createLocalStorageAdapter,
	createPersistenceSubscription,
	extractPersistedState,
	preparePersistedGridStateRestore,
	type PersistedGridState,
	type SerializedGridState,
	validateSchemaVersion,
	validatePersistedGridState,
} from './statePersistence.js';
import type { ColumnDef } from '../store.js';
import type { GridInitialState, InternalGridState } from '../state/GridState.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';

function wrapState(state: SerializedGridState): PersistedGridState {
	return { v: GRID_STATE_SCHEMA_VERSION, state };
}

const QUERY_MODEL: GridQueryModel = {
	version: 1,
	root: {
		kind: 'group',
		id: 'root',
		operator: 'and',
		children: [{ kind: 'condition', id: 'q1', columnId: 'name', filter: { type: 'text', operator: 'contains', value: 'Alice' } }],
	},
};

describe('statePersistence', () => {
	describe('schema versioning', () => {
		it('GRID_STATE_SCHEMA_VERSION is a positive integer', () => {
			expect(GRID_STATE_SCHEMA_VERSION).toBeGreaterThan(0);
			expect(Number.isInteger(GRID_STATE_SCHEMA_VERSION)).toBe(true);
		});

		it('validateSchemaVersion returns null for correct version', () => {
			expect(validateSchemaVersion({ v: GRID_STATE_SCHEMA_VERSION })).toBeNull();
		});

		it('validateSchemaVersion rejects missing version', () => {
			expect(validateSchemaVersion({})).toContain('missing required schema version');
		});

		it('validateSchemaVersion rejects wrong version', () => {
			expect(validateSchemaVersion({ v: 999 })).toContain('schema version mismatch');
		});
	});

	describe('extractPersistedState', () => {
		it('extracts the serializable subset under the versioned state envelope', () => {
			const dummyState = {
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{ field: 'name', header: 'Name', width: 100, hide: true },
					{ field: 'age', header: 'Age', width: 80 },
				] as ColumnDef<any>[],
				columnWidths: { id: 50, name: 100, age: 85 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { age: { type: 'number', operator: 'gt', value: 18 } },
				queryModel: QUERY_MODEL,
				themeName: 'light',
				grouping: { by: ['age'], totals: { groups: 'bottom' }, stickyHeaders: false },
				pinnedColumns: { left: 1, right: 0 },
				selection: null,
				selectedRowIds: ['123'],
				rowHeights: { '1': 45 },
			} as unknown as InternalGridState;

			expect(extractPersistedState(dummyState)).toEqual({
				v: GRID_STATE_SCHEMA_VERSION,
				state: {
					columnOrder: ['id', 'name', 'age'],
					columnVisibility: { name: false },
					columnWidths: { id: 50, name: 100, age: 85 },
					sortModel: [{ colId: 'id', sort: 'asc' }],
					filterModel: { age: { type: 'number', operator: 'gt', value: 18 } },
					queryModel: QUERY_MODEL,
					themeName: 'light',
					grouping: { by: ['age'], totals: { groups: 'bottom' }, stickyHeaders: false },
					pinnedColumns: { left: 1, right: 0 },
				},
			});
		});

		it('omits empty/default persisted fields', () => {
			const dummyState = {
				columns: [{ field: 'id', header: 'ID', width: 50 }] as ColumnDef<any>[],
				columnWidths: {},
				pinnedColumns: { left: 0, right: 0 },
			} as unknown as InternalGridState;

			expect(extractPersistedState(dummyState)).toEqual({
				v: GRID_STATE_SCHEMA_VERSION,
				state: {
					columnOrder: ['id'],
				},
			});
		});
	});

	describe('createLocalStorageAdapter', () => {
		const mockLocalStorage: Record<string, string> = {};

		beforeEach(() => {
			vi.stubGlobal('localStorage', {
				getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
				setItem: vi.fn((key: string, value: string) => {
					mockLocalStorage[key] = value;
				}),
				removeItem: vi.fn((key: string) => {
					delete mockLocalStorage[key];
				}),
			});
		});

		afterEach(() => {
			vi.unstubAllGlobals();
			for (const key of Object.keys(mockLocalStorage)) {
				delete mockLocalStorage[key];
			}
		});

		it('saves and loads the versioned persisted envelope', () => {
			const adapter = createLocalStorageAdapter('test-key');
			const testState = wrapState({ themeName: 'light', grouping: { by: [], totals: { groups: 'bottom' } } });

			adapter.save(testState);

			expect(localStorage.setItem).toHaveBeenCalledWith('test-key', JSON.stringify(testState));
			expect(adapter.load()).toEqual(testState);
		});

		it('clears stored state and swallows parse errors', () => {
			const adapter = createLocalStorageAdapter('test-key');
			adapter.save(wrapState({ themeName: 'dark' }));
			adapter.clear?.();

			expect(localStorage.removeItem).toHaveBeenCalledWith('test-key');
			expect(adapter.load()).toBeNull();

			mockLocalStorage['test-key'] = '{invalid-json';
			expect(adapter.load()).toBeNull();
		});
	});

	describe('createPersistenceSubscription', () => {
		let mockAdapter: {
			load: ReturnType<typeof vi.fn>;
			save: ReturnType<typeof vi.fn>;
			clear: ReturnType<typeof vi.fn>;
		};
		let subscribeMock: ReturnType<typeof vi.fn>;
		let getGridStateMock: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			vi.useFakeTimers();
			mockAdapter = {
				load: vi.fn(),
				save: vi.fn(),
				clear: vi.fn(),
			};
			subscribeMock = vi.fn((_key: string, listener: () => void) => () => {});
			getGridStateMock = vi.fn(() => wrapState({ themeName: 'light' }));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('subscribes to relevant persistence keys', () => {
			createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock);

			expect(subscribeMock).toHaveBeenCalledWith('columns', expect.any(Function));
			expect(subscribeMock).toHaveBeenCalledWith('columnWidths', expect.any(Function));
			expect(subscribeMock).toHaveBeenCalledWith('themeName', expect.any(Function));
		});

		it('debounces saves and reports saved status', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			trigger!();
			trigger!();
			expect(mockAdapter.save).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);

			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
			expect(controller.getStatus().status).toBe('saved');
		});

		it('suppresses autosave inside suspendAutoSave', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			controller.suspendAutoSave(() => {
				trigger!();
				vi.advanceTimersByTime(100);
			});

			expect(mockAdapter.save).not.toHaveBeenCalled();
		});

		it('supports disabling auto-save and saveNow', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			controller.setAutoSave(false);
			trigger!();
			vi.advanceTimersByTime(100);
			expect(mockAdapter.save).not.toHaveBeenCalled();

			controller.setAutoSave(true);
			controller.saveNow();
			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
		});

		it('updates status on async save resolve/reject', async () => {
			let resolvePromise: (() => void) | undefined;
			let rejectPromise: ((reason?: unknown) => void) | undefined;

			mockAdapter.save = vi.fn().mockImplementation(() => {
				return new Promise<void>((resolve, reject) => {
					resolvePromise = resolve;
					rejectPromise = reject;
				});
			});

			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			trigger!();
			vi.advanceTimersByTime(100);
			expect(controller.getStatus().status).toBe('saving');

			resolvePromise?.();
			await vi.runAllTimersAsync();
			expect(controller.getStatus().status).toBe('saved');

			trigger!();
			vi.advanceTimersByTime(100);
			rejectPromise?.(new Error('network error'));
			await vi.runAllTimersAsync();
			expect(controller.getStatus().status).toBe('error');
			expect(controller.getStatus().error).toBeDefined();
		});

		it('flushes pending save on destroy', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			trigger!();
			controller.destroy();

			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
		});
	});

	describe('preparePersistedGridStateRestore', () => {
		const makeCurrent = (partial?: Partial<InternalGridState>): InternalGridState =>
			({
				columns: [
					{ field: 'id', header: 'ID', width: 100 },
					{ field: 'name', header: 'Name', width: 150 },
				],
				columnWidths: {},
				sortModel: null,
				filterModel: null,
				grouping: undefined,
				pinnedColumns: { left: 0, right: 0 },
				...partial,
			}) as InternalGridState;

		it('rejects malformed payloads and returns ok: false', () => {
			const result = preparePersistedGridStateRestore({ v: GRID_STATE_SCHEMA_VERSION } as PersistedGridState, makeCurrent());
			expect(result.ok).toBe(false);
		});

		it('returns ok: true with stateMutation containing all valid persisted fields', () => {
			const saved = wrapState({
				columnOrder: ['name', 'id'],
				columnVisibility: { name: true, id: false },
				columnWidths: { id: 50 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { id: { type: 'text', operator: 'equals', value: '1' } },
				queryModel: QUERY_MODEL,
				themeName: 'light',
				grouping: { by: ['name'], totals: { groups: 'bottom' }, stickyHeaders: false },
				pinnedColumns: { left: 1, right: 0 },
			});

			const result = preparePersistedGridStateRestore(saved, makeCurrent());

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const { stateMutation } = result.restore;
			expect(stateMutation.columns?.map((c) => c.field)).toEqual(['name', 'id']);
			expect(stateMutation.columns?.find((c) => c.field === 'id')?.hide).toBe(true);
			expect(stateMutation.columnWidths?.['id']).toBe(50);
			expect(stateMutation.sortModel).toEqual([{ colId: 'id', sort: 'asc' }]);
			expect(stateMutation.queryModel).toEqual(QUERY_MODEL);
			expect(stateMutation.themeName).toBe('light');
			expect(stateMutation.grouping).toEqual({ by: ['name'], totals: { groups: 'bottom' }, stickyHeaders: false });
			expect(stateMutation.pinnedColumns).toEqual({ left: 1, right: 0 });
		});

		it('keeps a saved column order when columns were added since: new ones keep their place', () => {
			const current = makeCurrent({
				columns: [
					{ field: '__rowSelect__', header: '', width: 40 },
					{ field: 'id', header: 'ID', width: 100 },
					{ field: 'added', header: 'Added', width: 100 },
					{ field: 'name', header: 'Name', width: 150 },
				],
			});
			const result = preparePersistedGridStateRestore(wrapState({ columnOrder: ['name', 'id', 'gone'] }), current);
			expect(result.ok && result.restore.stateMutation.columns?.map((c) => c.field)).toEqual(['__rowSelect__', 'name', 'id', 'added']);
		});

		it('drops query conditions on removed columns and malformed filters', () => {
			const saved = wrapState({
				queryModel: {
					version: 1,
					root: {
						kind: 'group',
						id: 'root',
						operator: 'or',
						children: [
							{ kind: 'condition', id: 'a', columnId: 'gone', filter: { type: 'text', operator: 'contains', value: 'x' } },
							{ kind: 'condition', id: 'b', columnId: 'name', filter: { type: 'number', operator: 'gte', value: 'nope' } as never },
							{ kind: 'group', id: 'g', operator: 'and', children: [{ kind: 'condition', id: 'c', columnId: 'id', filter: null }] },
						],
					},
				},
				filterModel: {
					id: { type: 'select', values: [{}] } as never,
					name: { type: 'text', operator: 'startsWith', value: 'A' },
				},
			});
			const result = preparePersistedGridStateRestore(saved, makeCurrent());
			if (!result.ok) throw new Error(result.reason);
			expect(result.restore.stateMutation.queryModel).toEqual({
				version: 1,
				root: {
					kind: 'group',
					id: 'root',
					operator: 'or',
					children: [{ kind: 'group', id: 'g', operator: 'and', children: [{ kind: 'condition', id: 'c', columnId: 'id', filter: null }] }],
				},
			});
			expect(result.restore.stateMutation.filterModel).toEqual({ name: { type: 'text', operator: 'startsWith', value: 'A' } });
		});

		it('round-trips grouping { by, totals, stickyHeaders }, keeping configured GroupDefs and dropping removed columns', () => {
			const keyCreator = ({ value }: { value: unknown }) => String(value).toUpperCase();
			const comparator = (a: unknown, b: unknown) => String(b).localeCompare(String(a));
			const before = makeCurrent({
				columns: [
					{ field: 'id', header: 'ID', width: 100 },
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'region', header: 'Region', width: 150 },
				],
				grouping: {
					by: ['region', { colId: 'name', keyCreator, comparator }],
					totals: { groups: 'top', grand: 'bottom' },
					stickyHeaders: true,
					rowHeight: 44,
				},
			});
			const persisted = extractPersistedState(before);
			// Only the serializable part is persisted: column ids, placements, the sticky flag.
			expect(persisted.state.grouping).toEqual({ by: ['region', 'name'], totals: { groups: 'top', grand: 'bottom' }, stickyHeaders: true });

			// Restore into a grid whose 'region' column is gone and whose configured 'name' level has a keyCreator.
			const after = makeCurrent({
				grouping: { by: [{ colId: 'name', keyCreator, comparator }], defaultExpanded: 1, rowHeight: 44 },
			});
			const result = preparePersistedGridStateRestore(JSON.parse(JSON.stringify(persisted)) as PersistedGridState, after);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const grouping = result.restore.stateMutation.grouping!;
			expect(grouping.by).toHaveLength(1);
			const level = grouping.by[0];
			expect(typeof level).toBe('object');
			expect(level).toMatchObject({ colId: 'name' });
			expect((level as { keyCreator?: unknown }).keyCreator).toBe(keyCreator);
			expect((level as { comparator?: unknown }).comparator).toBe(comparator);
			expect(grouping.totals).toEqual({ groups: 'top', grand: 'bottom' });
			expect(grouping.stickyHeaders).toBe(true);
			// Configured, unpersisted settings survive.
			expect(grouping.defaultExpanded).toBe(1);
			expect(grouping.rowHeight).toBe(44);
		});

		it('round-trips stickyHeaders options and rejects malformed ones', () => {
			const before = makeCurrent({
				columns: [{ field: 'region', header: 'Region', width: 150 }],
				grouping: { by: ['region'], stickyHeaders: { levels: 1, shadow: false } },
			});
			const persisted = extractPersistedState(before);
			expect(persisted.state.grouping?.stickyHeaders).toEqual({ levels: 1, shadow: false });
			const after = makeCurrent({ columns: [{ field: 'region', header: 'Region', width: 150 }], grouping: { by: ['region'] } });
			const result = preparePersistedGridStateRestore(JSON.parse(JSON.stringify(persisted)) as PersistedGridState, after);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.restore.stateMutation.grouping?.stickyHeaders).toEqual({ levels: 1, shadow: false });

			const malformed = JSON.parse(JSON.stringify(persisted)) as PersistedGridState;
			(malformed.state.grouping as { stickyHeaders: unknown }).stickyHeaders = { levels: 'two' };
			expect(preparePersistedGridStateRestore(malformed, after).ok).toBe(false);
		});

		it('omits unknown column fields from stateMutation', () => {
			const saved = wrapState({
				columnWidths: { id: 120, unknown: 180 },
			});

			const result = preparePersistedGridStateRestore(saved, makeCurrent());

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const { stateMutation } = result.restore;
			expect(stateMutation.columnWidths?.['id']).toBe(120);
			expect(stateMutation.columnWidths?.['unknown']).toBeUndefined();
		});
	});

	describe('areRowHeightsEqual', () => {
		it('returns true for identical records', () => {
			expect(areRowHeightsEqual({ '1': 40, '2': 50 }, { '1': 40, '2': 50 })).toBe(true);
		});

		it('returns false for mismatched keys or values', () => {
			expect(areRowHeightsEqual({ '1': 40 }, { '1': 40, '2': 50 })).toBe(false);
			expect(areRowHeightsEqual({ '1': 40 }, { '1': 42 })).toBe(false);
		});
	});
});

describe('persisted views', () => {
	it('records the shown view as JSON (callbacks dropped) and restores it', () => {
		const view = { kind: 'kanban', swimlaneField: 'team', wipLimits: { doing: 3 }, color: () => 'red' };
		const state = { columns: [{ field: 'team', header: 'Team' }], columnWidths: {}, view } as unknown as InternalGridState;
		const persisted = extractPersistedState(state);
		expect(persisted.state.view).toEqual({ kind: 'kanban', swimlaneField: 'team', wipLimits: { doing: 3 } });
		const restored = preparePersistedGridStateRestore(persisted, { ...state, view: null } as unknown as InternalGridState);
		expect(restored.ok && restored.restore.stateMutation.view).toEqual({ kind: 'kanban', swimlaneField: 'team', wipLimits: { doing: 3 } });
		// Restoring the view already shown keeps the live object (and its callbacks).
		const same = preparePersistedGridStateRestore(persisted, state);
		expect(same.ok && same.restore.stateMutation.view).toBe(view);
	});

	it('rejects unknown view kinds', () => {
		expect(validatePersistedGridState({ v: GRID_STATE_SCHEMA_VERSION, state: { view: { kind: 'pivot' } } })).toMatch(/state.view/);
	});
});
