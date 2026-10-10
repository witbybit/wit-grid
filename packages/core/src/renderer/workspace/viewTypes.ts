import type { GridCellWrite } from '../../api/GridApi.js';
import type { GridApi as PublicGridApi } from '../../api/GridApiSurfaces.js';
import type { ColumnDef } from '../../columnDef.js';
import type { GridPresencePeer } from '../../presence.js';
import type { RecordReader, RecordRow } from '../../records/recordModel.js';
import type { GridViewConfig, GridWorkspaceOptions, RecordCounts } from '../../views.js';
import type { WorkspaceIconName } from './icons.js';
import type { MenuItem } from './ui.js';

export interface WriteOutcome {
	/** Every write was applied. */
	ok: boolean;
	/** Writes refused (validation, capabilities), with their reasons. */
	rejected: { cell: GridCellWrite; reason: string }[];
}

/** A command for the palette (and the view's own menus). */
export interface WorkspaceCommand {
	id: string;
	label: string;
	/** Palette section. */
	group: string;
	icon?: WorkspaceIconName;
	/** Shortcut shown beside it. */
	hint?: string;
	keywords?: string;
	enabled?: () => boolean;
	run(): void;
}

export interface WorkspaceDialog {
	title: string;
	body: HTMLElement;
	confirm: string;
	cancel?: string;
	alternate?: string;
}

/** A number in the summary strip above the view. */
export interface WorkspaceMetric {
	label: string;
	value: string;
	/** 0–1: drawn as a bar under the value. */
	meter?: number;
	/** Dot colour (active, blocked). */
	tone?: string;
	title?: string;
}

/** An extra inspector tab a view offers (Schedule, Dependencies, Resources). */
export interface InspectorTab {
	id: string;
	label: string;
	count?: number;
	render(container: HTMLElement): (() => void) | void;
}

/** Everything a view reads and does, provided by the workspace host. Views own no record state. */
export interface WorkspaceViewContext<TRowData = unknown> {
	readonly api: PublicGridApi<TRowData>;
	readonly options: GridWorkspaceOptions<TRowData>;
	/** Field meanings and typed reads, for this view (workspace roles + the view's own). */
	reader(): RecordReader<TRowData>;
	/** The displayed records: filters, sort and search applied. */
	rows(): readonly RecordRow<TRowData>[];
	/** Any record by id, displayed or not (predecessors filtered out of view). */
	lookup(id: string): RecordRow<TRowData> | undefined;
	/** Displayed columns, in order. */
	columns(): readonly ColumnDef<TRowData>[];
	canEdit(id: string, field: string): boolean;
	/** Writes cells in one transaction (one undo step); refused writes are reported to the user. */
	write(writes: readonly GridCellWrite[], label?: string): WriteOutcome;
	/** Adds a record (quick-add) through `options.createRecord`; resolves to its id. */
	create?(values: Record<string, unknown>): Promise<string | null>;

	/** Selected record ids (the grid's row selection). */
	selected(): ReadonlySet<string>;
	/** Click semantics: plain replaces, toggle adds/removes, range extends from the anchor in `order`. */
	select(id: string, mode: 'replace' | 'toggle' | 'range', order: readonly string[]): void;
	/** The focused record: keyboard focus, the inspector, kept across view switches. */
	focused(): string | null;
	focus(id: string | null, options?: { inspect?: boolean }): void;
	/** Open (or close) the inspector on a record. */
	inspect(id: string | null): void;
	/** Back to the table, at this record. */
	openInTable(id: string, field?: string): void;

	/** Peers whose cursor is on a record. */
	presence(id: string): readonly GridPresencePeer[];
	counts(id: string): RecordCounts | undefined;
	/** A record's accent colour (view `color`, else its status colour). */
	accent(row: RecordRow<TRowData>): string | undefined;

	/** Changes this view's configuration (density, swimlanes, zoom); the view tab keeps it. */
	updateView(patch: Partial<GridViewConfig<TRowData>>): void;
	/** Per-view navigation memory (scroll, zoom, collapsed groups), kept across view switches. */
	memory<T>(key: string, initial: T): T;
	remember(key: string, value: unknown): void;
	requestRender(): void;
	toast(message: string, tone?: 'info' | 'warn' | 'error' | 'success', action?: { label: string; run: () => void }): void;
	menu(anchor: HTMLElement, items: readonly (MenuItem | 'separator')[]): void;
	/** Asks the user to confirm (impact previews); `alternate` adds a third choice. */
	confirm(dialog: WorkspaceDialog): Promise<'confirm' | 'alternate' | 'cancel'>;
}

export interface WorkspaceView {
	/** Redraw from the current records (data, filter, sort, selection or size changed). */
	render(): void;
	destroy(): void;
	/** Record ids in this view's visual order (keyboard navigation, range selection, select all). */
	order(): readonly string[];
	/** Scroll a record into view and return its element (keyboard focus moves to it). */
	reveal(id: string): HTMLElement | null;
	/** Contextual controls for the command bar. */
	toolbar?(): HTMLElement | null;
	/** The summary strip. */
	summary?(): WorkspaceMetric[];
	/** Palette commands. */
	commands?(): WorkspaceCommand[];
	inspectorTabs?(id: string): InspectorTab[];
	/** Keyboard on a focused record the host does not handle (Alt+arrows to move cards). */
	onKey?(event: KeyboardEvent, id: string): boolean;
}

export interface WorkspaceViewModule<TConfig extends GridViewConfig<any> = GridViewConfig<any>> {
	kind: TConfig['kind'];
	label: string;
	icon: WorkspaceIconName;
	create<TRowData>(host: HTMLElement, context: WorkspaceViewContext<TRowData>, config: TConfig): WorkspaceView;
}
