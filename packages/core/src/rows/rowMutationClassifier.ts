import { getFieldRoot } from '../ids.js';
import type { ColumnDef } from '../columnDef.js';
import type { FilterModel, QuickFilterModel } from '../filterModel.js';
import type { SortModel } from '../rowModel.js';
import type { AggregationDef } from './stages/aggregateStage.js';

/**
 * Describes the highest-impact consequence of mutating a set of row fields
 * given the current pipeline configuration. Used to select the cheapest
 * correct update path: full rebuild only when unavoidable, targeted cell
 * invalidation for value-only changes.
 *
 * Priority order (most to least structural):
 *   group-key > filter-key > sort-key > tree-parent > height >
 *   formula-dependent > value-only
 *
 * 'insert', 'remove', and 'full-rebuild' are caller-supplied for structural
 * mutations that bypass field-level classification entirely.
 */
export type RowMutationImpact =
	| 'value-only'
	| 'formula-dependent'
	| 'aggregation-input'
	| 'sort-key'
	| 'filter-key'
	| 'group-key'
	| 'tree-parent'
	| 'height'
	| 'insert'
	| 'remove'
	| 'full-rebuild';

export interface RowDependencyConfig<TData = unknown> {
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null | undefined;
	filterModel: FilterModel | null | undefined;
	quickFilterModel?: QuickFilterModel | null;
	groupBy: string[] | undefined;
	aggDefs: AggregationDef<TData>[] | undefined;
	/** Whether a tree-parent resolver (getParentId) is configured for this grid. */
	hasTreeParent: boolean;
	/**
	 * Source fields read by the tree-parent resolver.
	 * When provided, only changes to these fields trigger tree restructuring.
	 * When absent, any field change conservatively triggers tree-parent.
	 */
	treeParentDependencies?: string[];
}

/**
 * Tracks which colIds/fields participate in each pipeline stage.
 * Must be rebuilt whenever sort, filter, group, aggregation, or column
 * configuration changes — call `update()` from each corresponding event handler.
 *
 * For computed columns (valueGetter), the set is expanded to include declared
 * source dependencies (valueGetterDependencies). When a computed column active
 * in sort/filter/group has no declared dependencies, opaqueStructuralDependency
 * is set and any field change conservatively returns the highest structural impact.
 */
export class RowDependencyRegistry<TData = unknown> {
	/** colIds + source dependencies of the active sort model. */
	readonly sortKeys = new Set<string>();
	/** colIds + source dependencies of the active filter model. */
	readonly filterKeys = new Set<string>();
	/** colIds + source dependencies of the active groupBy array. */
	readonly groupKeys = new Set<string>();
	/** Fields that feed aggregation functions (AggregationDef.field). */
	readonly aggregationFields = new Set<string>();
	/** Fields whose columns declare a valueGetter — computed/formula cells. */
	readonly formulaFields = new Set<string>();
	/** Whether tree-parent resolution is active for this grid. */
	hasTreeParent = false;
	/**
	 * Source fields that affect tree-parent resolution, when explicitly declared.
	 * Empty means the dependency is opaque — fall back to the conservative hasTreeParent path.
	 */
	readonly treeParentSourceFields = new Set<string>();
	/**
	 * True when any active sort/filter/group column has a valueGetter without declared
	 * valueGetterDependencies. When true, an unmatched field change must be classified
	 * conservatively to avoid a stale sort/filter/group position.
	 */
	opaqueStructuralDependency = false;

	update(config: RowDependencyConfig<TData>): void {
		const { columns, sortModel, filterModel, quickFilterModel, groupBy, aggDefs, hasTreeParent, treeParentDependencies } = config;

		// Build a field→column lookup for dependency expansion.
		const colByField = new Map<string, ColumnDef<TData>>();
		for (const col of columns) colByField.set(col.field, col);

		this.opaqueStructuralDependency = false;

		this.sortKeys.clear();
		for (const s of sortModel ?? []) {
			this.sortKeys.add(s.colId);
			const col = colByField.get(s.colId);
			if (col?.valueGetterDependencies) {
				for (const dep of col.valueGetterDependencies) this.sortKeys.add(dep);
			} else if (col?.valueGetter) {
				this.opaqueStructuralDependency = true;
			}
		}

		this.filterKeys.clear();
		for (const k of Object.keys(filterModel ?? {})) {
			this.filterKeys.add(k);
			const col = colByField.get(k);
			if (col?.valueGetterDependencies) {
				for (const dep of col.valueGetterDependencies) this.filterKeys.add(dep);
			} else if (col?.valueGetter) {
				this.opaqueStructuralDependency = true;
			}
		}
		if (quickFilterModel && quickFilterModel.text.trim()) {
			// Quick filter can span every column (or an explicit subset) — a value change on any
			// targeted column could flip filter membership, so all of them are filter keys too.
			const quickFilterFields = quickFilterModel.columnIds?.length ? quickFilterModel.columnIds : columns.map((c) => c.field);
			for (const k of quickFilterFields) {
				this.filterKeys.add(k);
				const col = colByField.get(k);
				if (col?.valueGetterDependencies) {
					for (const dep of col.valueGetterDependencies) this.filterKeys.add(dep);
				} else if (col?.valueGetter) {
					this.opaqueStructuralDependency = true;
				}
			}
		}

		this.groupKeys.clear();
		for (const colId of groupBy ?? []) {
			this.groupKeys.add(colId);
			const col = colByField.get(colId);
			if (col?.valueGetterDependencies) {
				for (const dep of col.valueGetterDependencies) this.groupKeys.add(dep);
			} else if (col?.valueGetter) {
				this.opaqueStructuralDependency = true;
			}
		}

		this.aggregationFields.clear();
		for (const agg of aggDefs ?? []) this.aggregationFields.add(agg.field);

		this.formulaFields.clear();
		for (const col of columns) {
			if (col.valueGetter) this.formulaFields.add(col.field);
		}

		this.hasTreeParent = hasTreeParent;

		this.treeParentSourceFields.clear();
		for (const dep of treeParentDependencies ?? []) this.treeParentSourceFields.add(dep);
	}
}

/**
 * Returns true when any field in `changedFields` could affect a pipeline key.
 * Handles both exact matches and dotted-path roots (e.g. 'address.city' matches 'address').
 */
function fieldMatchesKey(changedField: string, key: string): boolean {
	if (changedField === key) return true;
	const changedRoot = getFieldRoot(changedField);
	const keyRoot = getFieldRoot(key);
	return changedRoot === key || changedField === keyRoot || changedRoot === keyRoot;
}

function anyFieldMatchesSet(changedFields: ReadonlySet<string>, keys: ReadonlySet<string>): boolean {
	for (const field of changedFields) {
		for (const key of keys) {
			if (fieldMatchesKey(field, key)) return true;
		}
	}
	return false;
}

/**
 * True when the changed fields could move a row within the active sort order. The
 * single-impact classification reports 'filter-key' ahead of 'sort-key', so a caller that
 * handles 'filter-key' must consult this to avoid dropping a needed re-sort.
 */
export function mutationAffectsSortKeys(
	changedFields: ReadonlySet<string>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	registry: RowDependencyRegistry<any>
): boolean {
	if (registry.sortKeys.size === 0 || changedFields.size === 0) return false;
	return registry.opaqueStructuralDependency || anyFieldMatchesSet(changedFields, registry.sortKeys);
}

/**
 * Classify the highest-impact consequence of mutating the given set of fields.
 * Callers should supply 'insert' or 'remove' directly for structural row
 * additions/removals; those cases are not handled here.
 *
 * Source-field expansion: sortKeys/filterKeys/groupKeys already include declared
 * valueGetterDependencies from the registry's update(). When a computed active
 * column has unknown dependencies (opaqueStructuralDependency), an unmatched
 * change conservatively returns the highest active structural impact.
 */
export function classifyMutation(
	changedFields: ReadonlySet<string>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	registry: RowDependencyRegistry<any>
): Exclude<RowMutationImpact, 'insert' | 'remove' | 'full-rebuild'> {
	if (changedFields.size === 0) return 'value-only';

	if (registry.groupKeys.size > 0 && anyFieldMatchesSet(changedFields, registry.groupKeys)) return 'group-key';
	if (registry.filterKeys.size > 0 && anyFieldMatchesSet(changedFields, registry.filterKeys)) return 'filter-key';
	if (registry.sortKeys.size > 0 && anyFieldMatchesSet(changedFields, registry.sortKeys)) return 'sort-key';

	// Tree-parent: precise when source fields declared, conservative otherwise.
	if (registry.treeParentSourceFields.size > 0) {
		if (anyFieldMatchesSet(changedFields, registry.treeParentSourceFields)) return 'tree-parent';
	} else if (registry.hasTreeParent) {
		return 'tree-parent';
	}

	if (registry.formulaFields.size > 0 && anyFieldMatchesSet(changedFields, registry.formulaFields)) return 'formula-dependent';

	// Aggregation input: a leaf field that feeds a group aggregate. Requires full
	// grouped-model refresh so ancestor group totals stay consistent with leaf data.
	if (registry.aggregationFields.size > 0 && anyFieldMatchesSet(changedFields, registry.aggregationFields)) return 'aggregation-input';

	// Opaque active operation: an undeclared computed sort/filter/group column means
	// this change might affect it — return the conservative structural impact.
	if (registry.opaqueStructuralDependency) {
		if (registry.groupKeys.size > 0) return 'group-key';
		if (registry.filterKeys.size > 0) return 'filter-key';
		if (registry.sortKeys.size > 0) return 'sort-key';
	}

	return 'value-only';
}
