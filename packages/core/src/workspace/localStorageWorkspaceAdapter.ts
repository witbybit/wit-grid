import { validatePersistedGridState } from '../persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceAdapter } from './workspaceTypes.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseViewDefinition(raw: unknown): GridViewDefinition | null {
	try {
		if (!isRecord(raw)) return null;

		const allowedKeys = new Set(['id', 'name', 'description', 'scope', 'createdAt', 'updatedAt', 'version', 'state', 'metadata']);
		if (Object.keys(raw).some((key) => !allowedKeys.has(key))) return null;
		if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
		if (raw.description !== undefined && typeof raw.description !== 'string') return null;
		if (raw.scope !== 'personal' && raw.scope !== 'team' && raw.scope !== 'system') return null;
		if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
		if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;
		if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return null;
		if (raw.metadata !== undefined && !isRecord(raw.metadata)) return null;
		if (validatePersistedGridState(raw.state) !== null) return null;

		return raw as unknown as GridViewDefinition;
	} catch {
		return null;
	}
}

/**
 * Views in localStorage. Entries it cannot read are kept as they are (never erased by a later
 * write); failed writes (quota, private mode) reject, so the workspace reports them.
 */
export function createLocalStorageWorkspaceAdapter(options: { storageKey: string }): GridWorkspaceAdapter {
	const { storageKey } = options;
	const defaultKey = `${storageKey}__default`;

	function getStorage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	/** Every stored entry, readable or not. */
	function readRaw(): unknown[] {
		try {
			const raw = getStorage()?.getItem(storageKey);
			if (typeof raw !== 'string') return [];
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	function writeRaw(entries: unknown[]): void {
		const storage = getStorage();
		if (!storage) throw new Error('[wit-grid] workspace: localStorage is unavailable');
		storage.setItem(storageKey, JSON.stringify(entries));
	}

	const idOf = (entry: unknown) => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : null);
	const readViews = () =>
		readRaw()
			.map(parseViewDefinition)
			.filter((view): view is GridViewDefinition => view !== null);

	return {
		async listViews() {
			return readViews();
		},
		async getView(id) {
			return readViews().find((v) => v.id === id) ?? null;
		},
		async saveView(view) {
			const parsed = parseViewDefinition(view);
			if (!parsed) throw new Error(`[wit-grid] workspace: view "${view.id}" is not a valid view definition`);
			const entries = readRaw();
			const index = entries.findIndex((entry) => idOf(entry) === parsed.id);
			if (index >= 0) entries[index] = parsed;
			else entries.push(parsed);
			writeRaw(entries);
		},
		async deleteView(id) {
			writeRaw(readRaw().filter((entry) => idOf(entry) !== id));
		},
		async getDefaultView() {
			try {
				const value = getStorage()?.getItem(defaultKey);
				return typeof value === 'string' ? value : null;
			} catch {
				return null;
			}
		},
		async setDefaultView(id) {
			const storage = getStorage();
			if (!storage) throw new Error('[wit-grid] workspace: localStorage is unavailable');
			if (id === null) storage.removeItem(defaultKey);
			else storage.setItem(defaultKey, id);
		},
	};
}
