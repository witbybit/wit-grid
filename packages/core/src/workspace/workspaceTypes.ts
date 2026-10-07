import type { PersistedGridState } from '../persistence/statePersistence.js';

export interface GridViewDefinition {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly scope: 'personal' | 'team' | 'system';
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly version: number;
	readonly state: PersistedGridState;
	readonly metadata?: Record<string, unknown>;
}

export interface GridWorkspaceState {
	readonly views: readonly GridViewDefinition[];
	readonly activeViewId: string | null;
	readonly defaultViewId: string | null;
	/** The grid no longer matches the active view (Save changes would update it). */
	readonly dirty: boolean;
	readonly lastSavedAt: number | null;
	readonly lastError: string | null;
	readonly loading: boolean;
}

export interface SaveViewOptions {
	readonly description?: string;
	readonly scope?: 'personal' | 'team' | 'system';
	readonly makeDefault?: boolean;
}

export interface GridWorkspaceAdapter {
	listViews(): Promise<readonly GridViewDefinition[]>;
	getView(id: string): Promise<GridViewDefinition | null>;
	saveView(view: GridViewDefinition): Promise<void>;
	deleteView(id: string): Promise<void>;
	getDefaultView?(): Promise<string | null>;
	setDefaultView?(id: string | null): Promise<void>;
}
