/**
 * Views: the grid's displayed records (filters, sort and search applied) projected as a gallery,
 * a Kanban board, a Gantt schedule or a calendar. Every view reads the same record roles (title,
 * status, owner, schedule…), writes through the same transaction pipeline (validation, capabilities,
 * one undo step per gesture) and shares the selection, focused record and inspector, so switching
 * views keeps the user's working context. `api.setView(config)` switches; `null` returns to the table.
 */
import type { RecordAggregate } from './records/recordGroups.js';
import type { RecordRolesConfig, RecordRow } from './records/recordModel.js';
import type { TimeZoom } from './records/schedule/timeScale.js';
import type { WorkCalendarConfig } from './records/schedule/workCalendar.js';
import type { GridWorkspaceAdapter } from './workspace/workspaceTypes.js';

export type { RecordRolesConfig, RecordRow, RecordAggregate, TimeZoom, WorkCalendarConfig };

interface ViewConfigBase<TRowData> {
	/** Roles for this view only, over the workspace's `records` roles (e.g. a different date field). */
	records?: RecordRolesConfig;
	/** Extra fields drawn on each record with their columns' renderers, in this order. */
	fields?: string[];
	/** The record's accent colour (any CSS colour or palette name). Default: its status option's colour. */
	color?: (row: TRowData) => string | undefined;
	/** Records can be moved, rescheduled and edited from the view. Default true. */
	editable?: boolean;
	/** Shown when filters or search leave nothing to show. */
	emptyText?: string;
}

export interface ViewAggregate {
	fn: RecordAggregate;
	/** The field summed / averaged (sum, avg, min, max, filled). */
	field?: string;
}

export interface GalleryViewConfig<TRowData = unknown> extends ViewConfigBase<TRowData> {
	kind: 'gallery';
	/** Card size. `compact` lays cards out horizontally (cover beside the text). Default `medium`. */
	layout?: 'small' | 'medium' | 'large' | 'compact';
	/** Card cover: the `records.cover` image, a generated preview, or none. Default `image` when a cover field exists. */
	cover?: 'image' | 'generated' | 'none';
	coverFit?: 'cover' | 'contain';
	/** Sections by this field (collapsible, with counts and an aggregate). Default: the status role; `null` for none. */
	groupBy?: string | null;
	/** The number in each section header. Default: the value role summed, with average completion. */
	aggregate?: ViewAggregate;
	/** The narrowest a card gets; the gallery fits as many columns as it can. */
	cardWidth?: number;
}

export interface KanbanViewConfig<TRowData = unknown> extends ViewConfigBase<TRowData> {
	kind: 'kanban';
	/** Board columns. Default: the status role. */
	columnField?: string;
	/** Swimlanes inside every column. Default: none; `records.team` is a natural choice. */
	swimlaneField?: string | null;
	/** Column order and labels; values not listed follow, in option order. */
	columns?: readonly (string | { value: string; label?: string; color?: string })[];
	/** Work-in-progress limits per column value. */
	wipLimits?: Readonly<Record<string, number>>;
	/** `warn` marks an over-limit column; `block` refuses the drop. Default `warn`. */
	wipPolicy?: 'warn' | 'block';
	/** The number in column headers. Default: the value role summed. */
	aggregate?: ViewAggregate;
	/** Card density. Default `comfortable`. */
	density?: 'compact' | 'comfortable';
	/** Columns collapsed at first. */
	collapsedColumns?: readonly string[];
	/** The board column width. Default 280. */
	columnWidth?: number;
}

export interface GanttViewConfig<TRowData = unknown> extends ViewConfigBase<TRowData> {
	kind: 'gantt';
	/** Day, week, month, quarter or year scale. Default `week`. */
	zoom?: TimeZoom;
	/** Working days and holidays: durations, lags and moves count working days. */
	calendar?: WorkCalendarConfig;
	/** Draw dependency connectors. Default true. */
	dependencies?: boolean;
	/** Draw the baseline beneath each bar. Default true when a baseline field exists. */
	baseline?: boolean;
	/** Highlight the critical path. Default false. */
	criticalPath?: boolean;
	/**
	 * After a move: `push` moves successors later when a link requires it, `tight` keeps them as early
	 * as their links allow, `off` leaves them (violations are flagged). Default `push`.
	 */
	autoSchedule?: 'off' | 'push' | 'tight';
	/** Show the impact of a move that reschedules other tasks before writing it. Default true. */
	confirmReschedule?: boolean;
	/** Initial outline width in pixels; resizable and kept across view switches. */
	taskPaneWidth?: number;
	/** Height of one task row. Default 36. */
	rowHeight?: number;
	/** The day shown first. Default: the project start (or today). */
	initialDate?: string | Date;
}

export interface CalendarViewConfig<TRowData = unknown> extends ViewConfigBase<TRowData> {
	kind: 'calendar';
	/** The month shown first. Default: today's. */
	initialDate?: string | Date;
	/** First day of the week, 0 = Sunday. Default 1 (Monday). */
	weekStartsOn?: number;
}

export type GridViewConfig<TRowData = unknown> =
	| GalleryViewConfig<TRowData>
	| CalendarViewConfig<TRowData>
	| KanbanViewConfig<TRowData>
	| GanttViewConfig<TRowData>;

export type GridViewKind = GridViewConfig['kind'];

/** One tab of the view switcher. `view: null` is the table. */
export interface GridWorkspaceTab<TRowData = unknown> {
	id: string;
	name: string;
	view: GridViewConfig<TRowData> | null;
}

export interface RecordPerson {
	id: string;
	name: string;
	color?: string;
	avatarUrl?: string;
}

export interface RecordComment {
	id: string;
	author: RecordPerson;
	body: string;
	/** Epoch ms. */
	createdAt: number;
	reactions?: readonly { emoji: string; count: number; mine?: boolean }[];
}

export interface RecordFile {
	id: string;
	name: string;
	url?: string;
	size?: number;
	type?: string;
}

export interface RecordLink {
	id: string;
	label: string;
	url?: string;
	/** Another record of this grid: opens it in the inspector. */
	recordId?: string;
	status?: string;
}

export interface RecordActivityEntry {
	id: string;
	at: number;
	actor?: RecordPerson;
	/** `edit` entries name the field and both values. */
	kind: 'edit' | 'comment' | 'create' | 'note';
	field?: string;
	from?: unknown;
	to?: unknown;
	text?: string;
}

export interface RecordCounts {
	comments?: number;
	files?: number;
	links?: number;
}

/**
 * Discussion and files around records, from the app's own backend. Every member is optional:
 * the inspector shows the tabs it can fill. Edits made in the grid are recorded as activity by the
 * workspace itself; `listActivity` adds history from elsewhere (other sessions, the server).
 */
export interface RecordCollaboration {
	/** The current user: their comments and edits are attributed to them. */
	me?: RecordPerson;
	/** Counts drawn on cards (comments, files, links). Called often: answer from memory. */
	counts?(recordId: string): RecordCounts | undefined;
	listComments?(recordId: string): Promise<readonly RecordComment[]> | readonly RecordComment[];
	addComment?(recordId: string, body: string): Promise<RecordComment | void> | RecordComment | void;
	listFiles?(recordId: string): Promise<readonly RecordFile[]> | readonly RecordFile[];
	listLinks?(recordId: string): Promise<readonly RecordLink[]> | readonly RecordLink[];
	listActivity?(recordId: string): Promise<readonly RecordActivityEntry[]> | readonly RecordActivityEntry[];
	/** Something changed for a record (a comment arrived): the inspector and cards refresh. */
	subscribe?(listener: (recordId: string) => void): () => void;
}

/**
 * The workspace: the command bar (view switcher, search, filter / sort / group / fields, undo,
 * presence), the record inspector, bulk actions and the command palette, around the table and
 * every view. Opt-in: a grid without it loads none of this code.
 */
export interface GridWorkspaceOptions<TRowData = unknown> {
	/** The title in the command bar. */
	title?: string;
	/** What the records' fields mean, for every view. Anything left out is inferred from the columns. */
	records?: RecordRolesConfig;
	/** The view switcher's tabs. Default: Table, plus each built-in view the records support. */
	views?: readonly GridWorkspaceTab<TRowData>[];
	/** Comments, files, links and activity from the app's backend. */
	collaboration?: RecordCollaboration;
	/**
	 * Builds a new record for quick-add (a column's +, an empty day), given the values its place
	 * implies (that column's status, that lane's team, that day). Without it quick-add is hidden.
	 */
	createRecord?: (values: Record<string, unknown>) => TRowData | Promise<TRowData>;
	/** The inspector's fields, in order. Default: every displayed column. `false` hides the inspector. */
	inspector?: { fields?: readonly string[]; width?: number } | false;
	/** Where saved views live (the same adapter `createGrid({ workspace })` takes). */
	savedViews?: GridWorkspaceAdapter;
}

/** `workspace` takes either a saved-views adapter alone (no workspace UI) or the workspace options. */
export function isWorkspaceAdapter(value: unknown): value is GridWorkspaceAdapter {
	return !!value && typeof value === 'object' && typeof (value as GridWorkspaceAdapter).listViews === 'function';
}
