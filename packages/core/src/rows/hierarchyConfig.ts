import type { GridRowDataRef } from '../publicRowRef.js';
import type { GridApi } from '../api/GridApiSurfaces.js';
import type { TotalPlacement, VisualRow } from '../visualRow.js';
import type { GroupPathItem } from './visualRowIds.js';

/** One grouping level. `colId` names the column whose value is the group key. */
export interface GroupDef<TData = unknown> {
	colId: string;
	keyCreator?: (params: { value: unknown; row: TData; rowId: string }) => string;
	comparator?: (a: unknown, b: unknown) => number;
}

/** What a `defaultExpanded` predicate knows about a group. */
export interface GroupInfo {
	/** Visual row id (`group:…`). */
	id: string;
	level: number;
	field: string;
	key: unknown;
	keyString: string;
	path: readonly GroupPathItem[];
	leafCount: number;
}

/** What a `defaultExpanded` predicate knows about a tree row with children. */
export interface TreeRowInfo<TData = unknown> {
	/** Visual row id (`row:…`). */
	id: string;
	rowId: string;
	row: TData;
	level: number;
	childCount: number;
}

/** `true`/`false` for every row, a number for "this many levels open", or a predicate. */
export type DefaultExpanded<TInfo> = boolean | number | ((info: TInfo) => boolean);

export interface TotalsConfig {
	/** Per-group total rows, for every level or chosen per level (0 = outermost). */
	groups?: TotalPlacement | false | ((level: number) => TotalPlacement | false);
	/** One total row over every row. */
	grand?: TotalPlacement | false;
}

export interface StickyHeadersOptions {
	/** How many grouping levels stick, outermost first (1 = only top-level groups). Default: every level. */
	levels?: number;
	/** A shadow under the stuck stack. Default: true. */
	shadow?: boolean;
}

/** `stickyHeaders` normalised once: null when headers do not stick. */
export interface ResolvedStickyHeaders {
	levels: number;
	shadow: boolean;
}

const STICKY_ALL_LEVELS: ResolvedStickyHeaders = Object.freeze({ levels: Infinity, shadow: true });
const resolvedStickyOptions = new WeakMap<StickyHeadersOptions, ResolvedStickyHeaders>();

/** Cached per config object, so reading it every frame allocates nothing. */
export function resolveStickyHeaders(stickyHeaders: boolean | StickyHeadersOptions | undefined): ResolvedStickyHeaders | null {
	if (!stickyHeaders) return null;
	if (stickyHeaders === true) return STICKY_ALL_LEVELS;
	let resolved = resolvedStickyOptions.get(stickyHeaders);
	if (!resolved) {
		const levels = stickyHeaders.levels;
		resolved = Object.freeze({
			levels: levels === undefined ? Infinity : Math.max(0, Math.floor(levels)),
			shadow: stickyHeaders.shadow !== false,
		});
		resolvedStickyOptions.set(stickyHeaders, resolved);
	}
	return resolved;
}

export interface GroupingConfig<TData = unknown> {
	/** Grouping levels, outermost first. Empty keeps the configuration without grouping. */
	by: ReadonlyArray<string | GroupDef<TData>>;
	/** Which groups start open. Explicit expansion (`setExpanded`, `expandAll`) overrides it. Default: false. */
	defaultExpanded?: DefaultExpanded<GroupInfo>;
	totals?: TotalsConfig;
	/**
	 * Expanded group headers stick to the top of the viewport while their rows scroll past. `true` sticks
	 * every level with a shadow; pass options to cap the levels or drop the shadow.
	 */
	stickyHeaders?: boolean | StickyHeadersOptions;
	/** Height of group and total rows. Default: the grid's row height. */
	rowHeight?: number;
	/**
	 * How group rows render. `'column'` (default): group and total rows are cell rows — one hierarchy
	 * column shows every level, other columns show the aggregates. `'columns'`: one hierarchy column
	 * per grouping level, each showing its own level. `'row'`: one full-width row per group.
	 */
	display?: 'column' | 'columns' | 'row';
	/** `display: 'row'`: draws each group row. Without one, the adapter's group row renderer is used. */
	rowRenderer?: RowRendererSpec<TData>;
}

export interface TreeDataConfig<TData = unknown> {
	getParentId: (row: TData) => string | null | undefined;
	/** Field whose value the hierarchy column shows for each tree row (through that column's formatter). */
	column?: string;
	/** Source fields read by `getParentId`. When declared, only changes to them rebuild the tree. */
	getParentIdDependencies?: string[];
	defaultExpanded?: DefaultExpanded<TreeRowInfo<TData>>;
	/** Which rows a filter keeps: matches only, matches and their ancestors, or matches and their subtrees. Default: 'includeAncestors'. */
	filterMode?: 'strict' | 'includeAncestors' | 'includeDescendants';
	/** Tree parents carry the aggregate of their descendants. Default: true when aggregation is configured. */
	aggregateParents?: boolean;
	/** Selecting (deselecting) a tree parent selects (deselects) every row beneath it. Default: false. */
	selectDescendants?: boolean;
}

/** What the hierarchy cell knows about the row it is drawn for. */
export interface HierarchyCellContext<TData = unknown> {
	kind: 'group' | 'total' | 'data';
	/** Visual row id. */
	id: string;
	level: number;
	hasChildren: boolean;
	expanded: boolean;
	leafCount: number;
	/** Group rows: the group key; tree rows: the `treeData.column` value; totals: the group key or null. */
	value: unknown;
	/** `value` through the grouped (or tree) column's formatter. */
	formattedValue: string;
	/** Group rows: the grouped column; tree rows: `treeData.column`. */
	field: string | null;
	/** Tree and leaf rows: the row data. */
	data?: TData;
	aggregates?: Record<string, unknown>;
}

/**
 * The auto column that shows the hierarchy: indent, expand toggle, optional checkbox, label, count.
 * It is added while rows are grouped (display `'column'`) or tree-shaped, pinned left by default.
 */
export interface HierarchyColumnConfig<TData = unknown> {
	header?: string;
	width?: number;
	minWidth?: number;
	/** Default: true (pinned left). */
	pinned?: boolean;
	/** Indent per level in px. Default: 16. */
	indentPerLevel?: number;
	/** Parts to show. Defaults: toggle and count on, checkbox off. */
	show?: { toggle?: boolean; checkbox?: boolean; count?: boolean };
	/** Replaces the label. Default: `formattedValue`; totals read "Total" / "Grand total". */
	label?: (ctx: HierarchyCellContext<TData>) => string;
	/** Replaces the count. Default: group rows show their leaf count, others nothing. */
	count?: (ctx: HierarchyCellContext<TData>) => string | null;
	/** Extra class names for the cell. */
	cellClass?: string | ((ctx: HierarchyCellContext<TData>) => string | undefined);
}

export type BuiltInAggFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinctCount' | 'first' | 'last';

/** What a custom aggregate function receives: the values beneath one group, tree parent or the grand total. */
export interface AggregateContext<TData = unknown> {
	colId: string;
	/** Column values of the leaf rows, in row order, read through the column's value getter. */
	values: unknown[];
	rows: GridRowDataRef<TData>[];
	scope: 'group' | 'tree' | 'grand';
	/** Level of the row that shows the aggregate; -1 for the grand total. */
	level: number;
	/** The group key, for group scope. */
	key?: unknown;
}

export interface AggregationDef<TData = unknown> {
	colId: string;
	aggFunc: BuiltInAggFunc | ((ctx: AggregateContext<TData>) => unknown);
}

export interface AggregationConfig<TData = unknown> {
	defs: AggregationDef<TData>[];
}

/** What a full-width row renderer receives. */
export interface RowRendererParams<TData = unknown> {
	/** The detail, group or total row being drawn. */
	row: VisualRow<TData>;
	/** Detail rows: the master row's data. */
	masterData?: TData;
	api: GridApi<TData>;
}

export interface DomRowRendererHandle<TData = unknown> {
	/** Called when the same row is drawn again with new content (aggregates, expansion, data). */
	update?(params: RowRendererParams<TData>): void;
	destroy?(): void;
}

/** A framework-free full-width row renderer: mounted by core, synchronously, even mid-scroll. */
export interface DomRowRenderer<TData = unknown> {
	mount(container: HTMLElement, params: RowRendererParams<TData>): DomRowRendererHandle<TData> | void;
}

/**
 * How a full-width row is drawn: a DOM renderer core mounts itself, or a component the adapter
 * mounts (React: `{ kind: 'react', component }`, rendered with `{ visualRow, api }`).
 */
export type RowRendererSpec<TData = unknown> = { kind: 'dom'; renderer: DomRowRenderer<TData> } | { kind: 'react'; component: unknown };

export interface DetailConfig<TData = unknown> {
	/** Which rows can open a detail. Default: every row. */
	isMaster?: (row: TData, rowId: string) => boolean;
	/**
	 * Detail row height: a number, a function of the master row, or `'auto'` — the rendered content
	 * is measured and the row follows it (starting from `estimatedHeight`). Default: 200.
	 */
	height?: number | 'auto' | ((params: { row: TData; rowId: string }) => number);
	/** `height: 'auto'`: the height used until the content has been measured. Default: 200. */
	estimatedHeight?: number;
	/** Draws the detail row. Without one, the adapter's detail row renderer is used. */
	renderer?: RowRendererSpec<TData>;
}

/**
 * Expansion state: explicit per-row choices over a default. `rows` holds overrides keyed by visual
 * row id (groups and tree rows alike); a missing id uses `base` when set (written by `expandAll` /
 * `collapseAll`), otherwise the configured `defaultExpanded`. `details` holds the rows whose
 * detail is open, keyed by row id.
 */
export interface ExpansionState {
	base?: boolean | number;
	rows: Record<string, boolean>;
	details: Record<string, true>;
}

export const EMPTY_EXPANSION: ExpansionState = Object.freeze({ rows: Object.freeze({}), details: Object.freeze({}) }) as ExpansionState;

export function normalizeGroupDefs<TData>(by: GroupingConfig<TData>['by'] | undefined): GroupDef<TData>[] {
	if (!by || by.length === 0) return [];
	return by.map((entry) => (typeof entry === 'string' ? { colId: entry } : entry));
}

export function groupByColIds<TData>(grouping: GroupingConfig<TData> | undefined): string[] {
	return grouping ? grouping.by.map((entry) => (typeof entry === 'string' ? entry : entry.colId)) : [];
}

/** True when rows are actually grouped (a config with no levels groups nothing). */
export function isGroupingActive<TData>(grouping: GroupingConfig<TData> | undefined): grouping is GroupingConfig<TData> {
	return !!grouping && grouping.by.length > 0;
}

/** Whether rows form a hierarchy (grouped or tree-shaped): the grid is then a treegrid. */
export function isHierarchyActive(state: { grouping?: { by: readonly unknown[] }; treeData?: unknown }): boolean {
	return (state.grouping?.by.length ?? 0) > 0 || !!state.treeData;
}

/** Resolves a default with no override: booleans as-is, a number as "levels below it are open". */
export function resolveDefaultExpanded<TInfo>(value: DefaultExpanded<TInfo> | undefined, level: number, getInfo: () => TInfo): boolean {
	if (value === undefined || value === false) return false;
	if (value === true) return true;
	if (typeof value === 'number') return level < value;
	return value(getInfo());
}

// Configs enter grid state as frozen copies: the state snapshot can then share them by reference
// (stable for selectors) without handing out anything that writes through to the grid.

export function freezeGroupingConfig<TData>(grouping: GroupingConfig<TData> | undefined): GroupingConfig<TData> | undefined {
	if (!grouping) return undefined;
	return Object.freeze({
		...grouping,
		by: Object.freeze(grouping.by.map((entry) => (typeof entry === 'string' ? entry : Object.freeze({ ...entry })))),
		...(grouping.totals ? { totals: Object.freeze({ ...grouping.totals }) } : {}),
	});
}

export function freezeTreeDataConfig<TData>(treeData: TreeDataConfig<TData> | undefined): TreeDataConfig<TData> | undefined {
	if (!treeData) return undefined;
	return Object.freeze({
		...treeData,
		...(treeData.getParentIdDependencies ? { getParentIdDependencies: Object.freeze([...treeData.getParentIdDependencies]) as string[] } : {}),
	});
}

export function freezeAggregationConfig<TData>(aggregation: AggregationConfig<TData> | undefined): AggregationConfig<TData> | undefined {
	if (!aggregation) return undefined;
	return Object.freeze({ defs: Object.freeze(aggregation.defs.map((def) => Object.freeze({ ...def }))) as AggregationDef<TData>[] });
}

export function freezeDetailConfig<TData>(detail: DetailConfig<TData> | undefined): DetailConfig<TData> | undefined {
	return detail ? Object.freeze({ ...detail }) : undefined;
}
