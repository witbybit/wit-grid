/**
 * Minimap marks the app adds (search hits, bookmarks, anything row-shaped), drawn on the minimap
 * strip beside the vertical scrollbar next to the grid's own marks (selection, edits, errors).
 */

export interface GridMinimapMark {
	rowId: string;
	/** Any CSS colour. Default: the theme accent. */
	color?: string;
}

export class MinimapMarksStore {
	private marksList: readonly GridMinimapMark[] = [];
	private revision = 0;
	private readonly listeners = new Set<() => void>();

	public get marks(): readonly GridMinimapMark[] {
		return this.marksList;
	}

	/** Bumps on every change, so a renderer can tell whether to redraw. */
	public get version(): number {
		return this.revision;
	}

	public set(marks: readonly GridMinimapMark[]): void {
		this.marksList = marks.slice();
		this.revision++;
		for (const listener of this.listeners) listener();
	}

	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
