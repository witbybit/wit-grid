import { describe, expect, it, vi } from 'vitest';
import { createClientGrid } from '../createGrid.js';
import { GridEventName } from '../api/GridEvents.js';
import type { GridPersistenceAdapter, PersistedGridState } from '../persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceAdapter } from './workspaceTypes.js';

interface Row {
	id: string;
	name: string;
}

function memoryAdapter(views: GridViewDefinition[] = [], defaultId: string | null = null) {
	const store = new Map(views.map((v) => [v.id, v]));
	let defaultViewId = defaultId;
	const adapter: GridWorkspaceAdapter = {
		listViews: async () => [...store.values()],
		getView: async (id) => store.get(id) ?? null,
		saveView: vi.fn(async (view: GridViewDefinition) => void store.set(view.id, view)),
		deleteView: async (id) => void store.delete(id),
		getDefaultView: async () => defaultViewId,
		setDefaultView: async (id) => void (defaultViewId = id),
	};
	return adapter;
}

function grid(workspace: GridWorkspaceAdapter, persistence?: GridPersistenceAdapter) {
	return createClientGrid<Row>({
		rows: [
			{ id: '1', name: 'Ava' },
			{ id: '2', name: 'Liam' },
		],
		columns: [{ field: 'name', header: 'Name' }],
		workspace,
		persistence,
	});
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

function view(id: string, state: PersistedGridState['state']): GridViewDefinition {
	return { id, name: id, scope: 'personal', createdAt: 1, updatedAt: 1, version: 1, state: { v: 3, state } };
}

describe('workspace', () => {
	it('dirty: the grid drifting from the active view, cleared by saving changes', async () => {
		const api = grid(memoryAdapter());
		await settle();
		await api.saveView('Mine');
		expect(api.getWorkspaceState().dirty).toBe(false);
		api.setSortModel([{ colId: 'name', sort: 'desc' }]);
		await settle();
		expect(api.getWorkspaceState().dirty).toBe(true);
		await api.updateView(api.getWorkspaceState().activeViewId!);
		expect(api.getWorkspaceState().dirty).toBe(false);
		api.destroy();
	});

	it('a view holding part of the state: applying it is not an edit, and revert restores the grid exactly', async () => {
		const filtered = view('filtered', { filterModel: { name: { type: 'text', operator: 'contains', value: 'a' } } });
		const api = grid(memoryAdapter([filtered]));
		await settle();
		await api.applyView('filtered');
		await settle();
		expect(api.getWorkspaceState().dirty).toBe(false);
		api.setSortModel([{ colId: 'name', sort: 'desc' }]);
		await settle();
		expect(api.getWorkspaceState().dirty).toBe(true);
		await api.revertView();
		expect(api.getStateSnapshot().sortModel ?? null).toBeNull();
		expect(api.getStateSnapshot().filterModel).toEqual(filtered.state.state.filterModel);
		expect(api.getWorkspaceState().dirty).toBe(false);
		api.destroy();
	});

	it('a view of another schema version is not applied, not made active, and says why', async () => {
		const old = { ...view('old', { sortModel: [{ colId: 'name', sort: 'desc' }] }), state: { v: 2, state: {} } as PersistedGridState };
		const api = grid(memoryAdapter([old]));
		await settle();
		await expect(api.applyView('old')).rejects.toThrow('could not be applied');
		expect(api.getWorkspaceState().activeViewId).toBeNull();
		expect(api.getWorkspaceState().lastError).toContain('could not be applied');
		api.destroy();
	});

	it('a restored filter, query and sort change the rows, not only the state', async () => {
		const api = grid(memoryAdapter());
		await settle();
		api.applyGridState({
			v: 3,
			state: {
				filterModel: { name: { type: 'text', operator: 'contains', value: 'a' } },
				sortModel: [{ colId: 'name', sort: 'desc' }],
			},
		});
		expect(
			api
				.rows()
				.getAll()
				.map((r) => r.name)
		).toEqual(['Liam', 'Ava']);
		api.applyGridState({
			v: 3,
			state: {
				filterModel: null,
				queryModel: {
					version: 1,
					root: {
						kind: 'group',
						id: 'root',
						operator: 'and',
						children: [{ kind: 'condition', id: 'c', columnId: 'name', filter: { type: 'text', operator: 'equals', value: 'Ava' } }],
					},
				},
			},
		});
		expect(
			api
				.rows()
				.getAll()
				.map((r) => r.name)
		).toEqual(['Ava']);
		api.destroy();
	});

	it('a default view with a query filters the rows when the grid opens', async () => {
		const query = view('ava', {
			queryModel: {
				version: 1,
				root: {
					kind: 'group',
					id: 'root',
					operator: 'and',
					children: [{ kind: 'condition', id: 'c', columnId: 'name', filter: { type: 'text', operator: 'equals', value: 'Ava' } }],
				},
			},
		});
		const api = grid(memoryAdapter([query], 'ava'));
		await settle();
		expect(api.getWorkspaceState().activeViewId).toBe('ava');
		expect(
			api
				.rows()
				.getAll()
				.map((r) => r.name)
		).toEqual(['Ava']);
		api.destroy();
	});

	it('opens the default view when there is no saved session', async () => {
		const sorted = view('sorted', { sortModel: [{ colId: 'name', sort: 'desc' }] });
		const api = grid(memoryAdapter([sorted], 'sorted'));
		await settle();
		expect(api.getStateSnapshot().sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
		expect(api.getWorkspaceState().activeViewId).toBe('sorted');
		api.destroy();
	});

	it('a saved session wins over the default view', async () => {
		const sorted = view('sorted', { sortModel: [{ colId: 'name', sort: 'desc' }] });
		const session: GridPersistenceAdapter = { load: () => ({ v: 3, state: { sortModel: [{ colId: 'name', sort: 'asc' }] } }), save: () => {} };
		const api = grid(memoryAdapter([sorted], 'sorted'), session);
		await settle();
		expect(api.getStateSnapshot().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
		expect(api.getWorkspaceState().activeViewId).toBeNull();
		api.destroy();
	});

	it('failures are kept in lastError and reported as runtime faults', async () => {
		const adapter = memoryAdapter();
		adapter.saveView = async () => {
			throw new Error('quota exceeded');
		};
		const api = grid(adapter);
		const faults: string[] = [];
		api.addEventListener(GridEventName.runtimeFault, ({ payload }) => faults.push(payload.operation));
		await settle();
		await expect(api.saveView('Mine')).rejects.toThrow('quota exceeded');
		expect(api.getWorkspaceState().lastError).toBe('quota exceeded');
		expect(faults).toContain('workspace: save view');
		api.destroy();
	});

	it('a failed async session load is reported and the grid keeps its defaults', async () => {
		const session: GridPersistenceAdapter = { load: () => Promise.reject(new Error('offline')), save: () => {} };
		const api = createClientGrid<Row>({ rows: [], columns: [{ field: 'name' }], persistence: session });
		const faults: string[] = [];
		api.addEventListener(GridEventName.runtimeFault, ({ payload }) => faults.push(payload.operation));
		await settle();
		expect(faults).toContain('load saved state');
		api.destroy();
	});

	it('duplicating a view makes a personal copy', async () => {
		const shared = { ...view('team', {}), scope: 'team' as const };
		const api = grid(memoryAdapter([shared]));
		await settle();
		const copy = await api.duplicateView('team', 'My copy');
		expect(copy.scope).toBe('personal');
		expect(api.getWorkspaceState().views.map((v) => v.name)).toEqual(['team', 'My copy']);
		api.destroy();
	});
});
