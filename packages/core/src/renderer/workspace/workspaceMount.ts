import type { GridEngine } from '../../engine/GridEngine.js';
import type { GridWorkspaceOptions } from '../../views.js';
import type { WorkspaceHost } from './workspaceHost.js';

/** Events inside an embedded workspace must not reach the hidden table's handlers on the container. */
const ISOLATED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'wheel', 'focusin'] as const;

/**
 * The always-loaded part of the workspace: decides when the workspace is needed and loads it then.
 * A grid mounted with `workspace` loads it at once (its command bar shows over the table too);
 * otherwise it loads the first time `setView` asks for a view, into the grid's view layer.
 */
export class WorkspaceMount<TRowData> {
	private host: WorkspaceHost<TRowData> | null = null;
	private loading = false;
	private disposed = false;
	private readonly unsubscribers: (() => void)[] = [];

	constructor(
		private readonly engine: GridEngine<TRowData>,
		private readonly root: HTMLElement,
		private readonly table: HTMLElement | null,
		private readonly options: GridWorkspaceOptions<TRowData>
	) {
		if (!table) {
			root.hidden = true;
			const isolate = (event: Event) => event.stopPropagation();
			for (const type of ISOLATED_EVENTS) root.addEventListener(type, isolate);
			this.unsubscribers.push(() => {
				for (const type of ISOLATED_EVENTS) root.removeEventListener(type, isolate);
			});
		}
		if (table) this.load();
		else {
			this.unsubscribers.push(engine.stateManager.subscribeToKey('view', () => this.maybeLoad()));
			this.maybeLoad();
		}
	}

	getHost(): WorkspaceHost<TRowData> | null {
		return this.host;
	}

	private maybeLoad(): void {
		if (this.engine.getState().view) this.load();
	}

	private load(): void {
		if (this.loading || this.host) return;
		this.loading = true;
		void import('./workspaceHost.js').then(({ WorkspaceHost }) => {
			if (this.disposed) return;
			this.host = new WorkspaceHost({ engine: this.engine, root: this.root, table: this.table, options: this.options });
		});
	}

	dispose(): void {
		this.disposed = true;
		for (const off of this.unsubscribers) off();
		this.unsubscribers.length = 0;
		this.host?.destroy();
		this.host = null;
	}
}
