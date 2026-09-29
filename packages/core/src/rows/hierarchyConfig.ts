import type { GridRowDataRef } from '../publicRowRef.js';
import type { TotalPlacement } from '../visualRow.js';
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

export interface GroupingConfig<TData = unknown> {
	/** Grouping levels, outermost first. Empty keeps the configuration without grouping. */
	by: ReadonlyArray<string | GroupDef<TData>>;
	/** Which groups start open. Explicit expansion (`setExpanded`, `expandAll`) overrides it. Default: false. */
	defaultExpanded?: DefaultExpanded<GroupInfo>;
	totals?: TotalsConfig;
	/** Expanded group headers stick to the top of the viewport while their rows scroll past. */
	stickyHeaders?: boolean;
	/** Height of group and total rows. Default: the grid's row height. */
	rowHeight?: number;
}

export interface TreeDataConfig<TData = unknown> {
	getParentId: (row: TData) => string | null | undefined;
	/** Source fields read by `getParentId`. When declared, only changes to them rebuild the tree. */
	getParentIdDependencies?: string[];
	defaultExpanded?: DefaultExpanded<TreeRowInfo<TData>>;
	/** Which rows a filter keeps: matches only, matches and their ancestors, or matches and their subtrees. Default: 'includeAncestors'. */
	filterMode?: 'strict' | 'includeAncestors' | 'includeDescendants';
	/** Tree parents carry the aggregate of their descendants. Default: true when aggregation is configured. */
	aggregateParents?: boolean;
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

export interface DetailConfig<TData = unknown> {
	/** Which rows can open a detail. Default: every row. */
	isMaster?: (row: TData, rowId: string) => boolean;
	/** Detail row height. Default: 200. */
	height?: number | ((params: { row: TData; rowId: string }) => number);
	renderer?: unknown;
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
