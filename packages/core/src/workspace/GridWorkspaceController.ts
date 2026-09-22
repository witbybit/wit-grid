import type { PersistedGridState } from '../persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceAdapter, GridWorkspaceState, SaveViewOptions } from './workspaceTypes.js';

function generateId(): string {
	return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
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
	setActiveViewId(id: string | null): void;
	/** Returns the active view id only when it exists and has a writable scope (personal/team). */
	getActiveWritableViewId(): string | null;
	setDefaultView(id: string | null): Promise<void>;
	destroy(): void;
}

export function createWorkspaceController(adapter: GridWorkspaceAdapter): GridWorkspaceController {
	let state: GridWorkspaceState = {
		views: [],
		activeViewId: null,
		defaultViewId: null,
		autoSaveEnabled: true,
		dirty: false,
		lastSavedAt: null,
		lastError: null,
		loading: false,
	};

	const listeners = new Set<(state: GridWorkspaceState) => void>();

	function notify(): void {
		listeners.forEach((l) => l(state));
	}

	function patch(changes: Partial<GridWorkspaceState>): void {
		state = { ...state, ...changes };
		notify();
	}

	return {
		async init() {
			patch({ loading: true });
			try {
				const [views, defaultViewId] = await Promise.all([adapter.listViews(), adapter.getDefaultView?.() ?? Promise.resolve(null)]);
				patch({ views, defaultViewId, loading: false });
			} catch (err) {
				patch({ loading: false, lastError: String(err) });
			}
		},

		getState() {
			return state;
		},

		onStateChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async saveView(name, currentState, options) {
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
			const views = [...state.views, view];
			let defaultViewId = state.defaultViewId;
			if (options?.makeDefault) {
				await adapter.setDefaultView?.(view.id);
				defaultViewId = view.id;
			}
			patch({ views, activeViewId: view.id, defaultViewId, lastSavedAt: now, lastError: null });
			return view;
		},

		async updateView(id, currentState) {
			const existing = state.views.find((v) => v.id === id);
			if (!existing) return;
			const now = Date.now();
			const updated: GridViewDefinition = { ...existing, state: currentState, updatedAt: now, version: existing.version + 1 };
			await adapter.saveView(updated);
			patch({ views: state.views.map((v) => (v.id === id ? updated : v)), lastSavedAt: now, lastError: null });
		},

		async getView(id) {
			return state.views.find((v) => v.id === id) ?? null;
		},

		async deleteView(id) {
			await adapter.deleteView(id);
			const views = state.views.filter((v) => v.id !== id);
			const activeViewId = state.activeViewId === id ? null : state.activeViewId;
			const defaultViewId = state.defaultViewId === id ? null : state.defaultViewId;
			if (state.defaultViewId === id) {
				await adapter.setDefaultView?.(null);
			}
			patch({ views, activeViewId, defaultViewId });
		},

		async duplicateView(id, name) {
			const source = state.views.find((v) => v.id === id);
			if (!source) throw new Error(`[wit-grid] workspace: view "${id}" not found`);
			const now = Date.now();
			const view: GridViewDefinition = { ...source, id: generateId(), name, createdAt: now, updatedAt: now, version: 1 };
			await adapter.saveView(view);
			patch({ views: [...state.views, view] });
			return view;
		},

		async renameView(id, name) {
			const existing = state.views.find((v) => v.id === id);
			if (!existing) return;
			const updated: GridViewDefinition = { ...existing, name, updatedAt: Date.now() };
			await adapter.saveView(updated);
			patch({ views: state.views.map((v) => (v.id === id ? updated : v)) });
		},

		setActiveViewId(id) {
			patch({ activeViewId: id });
		},

		getActiveWritableViewId() {
			if (!state.activeViewId) return null;
			const view = state.views.find((v) => v.id === state.activeViewId);
			if (!view || view.scope === 'system') return null;
			return state.activeViewId;
		},

		async setDefaultView(id) {
			await adapter.setDefaultView?.(id);
			patch({ defaultViewId: id });
		},

		destroy() {
			listeners.clear();
		},
	};
}
