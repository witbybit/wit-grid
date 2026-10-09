import type { PersistedGridState } from '../persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceAdapter, GridWorkspaceState, SaveViewOptions } from './workspaceTypes.js';

function generateId(): string {
	const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The state of a grid without a workspace. */
export const EMPTY_WORKSPACE_STATE: GridWorkspaceState = Object.freeze({
	views: [],
	activeViewId: null,
	defaultViewId: null,
	dirty: false,
	lastSavedAt: null,
	lastError: null,
	loading: false,
});

/** Two persisted states hold the same grid setup. */
function sameState(a: PersistedGridState, b: PersistedGridState): boolean {
	return JSON.stringify(a.state) === JSON.stringify(b.state);
}

export interface GridWorkspaceController {
	init(): Promise<void>;
	getState(): GridWorkspaceState;
	onStateChange(listener: (state: GridWorkspaceState) => void): () => void;
	saveView(name: string, currentState: PersistedGridState, options?: SaveViewOptions): Promise<GridViewDefinition>;
	updateView(id: string, currentState: PersistedGridState): Promise<void>;
	getView(id: string): Promise<GridViewDefinition | null>;
	deleteView(id: string): Promise<void>;
	duplicateView(id: string, name: string): Promise<GridViewDefinition>;
	renameView(id: string, name: string): Promise<void>;
	/** The view now on the grid (applied or just saved); `current` is the grid's state. */
	setActiveView(id: string | null, current: PersistedGridState): void;
	/** The grid's state when the active view was applied, saved or updated. */
	getBaseline(): PersistedGridState | null;
	/** The grid's state changed: `dirty` tells whether it still matches the active view. */
	syncCurrentState(current: PersistedGridState): void;
	setDefaultView(id: string | null): Promise<void>;
	/** Records a failure of a workspace operation run elsewhere (lastError, the error callback). */
	fail(operation: string, error: unknown): void;
	destroy(): void;
}

export function createWorkspaceController(
	adapter: GridWorkspaceAdapter,
	onError?: (operation: string, error: unknown) => void
): GridWorkspaceController {
	let state: GridWorkspaceState = EMPTY_WORKSPACE_STATE;
	/** The grid's state when the active view was applied, saved or updated (a view may hold only part of it). */
	let baseline: PersistedGridState | null = null;
	let current: PersistedGridState | null = null;
	const listeners = new Set<(state: GridWorkspaceState) => void>();

	function patch(changes: Partial<GridWorkspaceState>): void {
		state = { ...state, ...changes };
		listeners.forEach((listener) => listener(state));
	}

	function isDirty(activeViewId = state.activeViewId): boolean {
		return !!activeViewId && !!baseline && !!current && !sameState(baseline, current);
	}

	/** Runs an adapter call; a failure is recorded in `lastError`, reported, and rethrown. */
	async function run<T>(operation: string, work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			patch({ lastError: error instanceof Error ? error.message : String(error), loading: false });
			onError?.(operation, error);
			throw error;
		}
	}

	function find(id: string): GridViewDefinition {
		const view = state.views.find((v) => v.id === id);
		if (!view) throw new Error(`[wit-grid] workspace: view "${id}" not found`);
		return view;
	}

	return {
		async init() {
			patch({ loading: true });
			await run('load views', async () => {
				const [views, defaultViewId] = await Promise.all([adapter.listViews(), adapter.getDefaultView?.() ?? Promise.resolve(null)]);
				patch({ views, defaultViewId, loading: false, lastError: null });
			});
		},

		getState() {
			return state;
		},

		onStateChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async saveView(name, currentState, options) {
			return run('save view', async () => {
				const now = Date.now();
				const view: GridViewDefinition = {
					id: generateId(),
					name,
					description: options?.description,
					scope: options?.scope ?? 'personal',
					createdAt: now,
					updatedAt: now,
					version: 1,
					state: currentState,
				};
				await adapter.saveView(view);
				let defaultViewId = state.defaultViewId;
				if (options?.makeDefault) {
					await adapter.setDefaultView?.(view.id);
					defaultViewId = view.id;
				}
				baseline = current = currentState;
				patch({ views: [...state.views, view], activeViewId: view.id, defaultViewId, dirty: false, lastSavedAt: now, lastError: null });
				return view;
			});
		},

		async updateView(id, currentState) {
			await run('update view', async () => {
				const existing = find(id);
				const now = Date.now();
				const updated: GridViewDefinition = { ...existing, state: currentState, updatedAt: now, version: existing.version + 1 };
				await adapter.saveView(updated);
				if (id === state.activeViewId) baseline = currentState;
				patch({ views: state.views.map((v) => (v.id === id ? updated : v)), dirty: isDirty(), lastSavedAt: now, lastError: null });
			});
		},

		async getView(id) {
			return state.views.find((v) => v.id === id) ?? null;
		},

		async deleteView(id) {
			await run('delete view', async () => {
				await adapter.deleteView(id);
				if (state.defaultViewId === id) await adapter.setDefaultView?.(null);
				const views = state.views.filter((v) => v.id !== id);
				const activeViewId = state.activeViewId === id ? null : state.activeViewId;
				patch({
					views,
					activeViewId,
					defaultViewId: state.defaultViewId === id ? null : state.defaultViewId,
					dirty: isDirty(activeViewId),
					lastError: null,
				});
			});
		},

		async duplicateView(id, name) {
			return run('duplicate view', async () => {
				const source = find(id);
				const now = Date.now();
				// A copy is the user's own, whatever the source's scope.
				const view: GridViewDefinition = { ...source, id: generateId(), name, scope: 'personal', createdAt: now, updatedAt: now, version: 1 };
				await adapter.saveView(view);
				patch({ views: [...state.views, view], lastError: null });
				return view;
			});
		},

		async renameView(id, name) {
			await run('rename view', async () => {
				const updated: GridViewDefinition = { ...find(id), name, updatedAt: Date.now() };
				await adapter.saveView(updated);
				patch({ views: state.views.map((v) => (v.id === id ? updated : v)), lastError: null });
			});
		},

		setActiveView(id, currentState) {
			baseline = current = currentState;
			patch({ activeViewId: id, dirty: false });
		},

		getBaseline() {
			return state.activeViewId ? baseline : null;
		},

		syncCurrentState(currentState) {
			current = currentState;
			const dirty = isDirty();
			if (dirty !== state.dirty) patch({ dirty });
		},

		async setDefaultView(id) {
			await run('set default view', async () => {
				await adapter.setDefaultView?.(id);
				patch({ defaultViewId: id, lastError: null });
			});
		},

		fail(operation, error) {
			patch({ lastError: error instanceof Error ? error.message : String(error) });
			onError?.(operation, error);
		},

		destroy() {
			listeners.clear();
		},
	};
}
