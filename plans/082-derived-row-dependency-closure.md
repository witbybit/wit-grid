# Plan 082: Derived Row Dependency Closure

> **Why this precedes further incremental optimization**: Incremental mutation classification is only safe when the grid knows which source fields affect active sort, filter, grouping, aggregation, formula, and tree-parent outputs. The current registry records target fields more reliably than their source dependencies, so a computed sort or filter can be left stale after a source-field update.

## Status

- **Priority**: P0 — incremental row-model correctness
- **Effort**: M
- **Risk**: MEDIUM — mutation classification and derived values
- **Depends on**: Plan 081
- **Category**: rows, formulas, sorting, filtering, correctness
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

A computed column can depend on source fields:

```ts
{
  field: 'total',
  valueGetter: row => row.price * row.quantity
}
```

If the active sort key is `total` and `price` changes, a registry that records only `total` can classify the mutation as `value-only`. The cell value changes but the row remains in the wrong sorted position.

Equivalent risks exist for:

- computed filter values
- computed grouping keys
- aggregation inputs
- chained formulas
- tree parent callbacks

## What to add

### 1. Declared dependency metadata

Support explicit source dependencies:

```ts
interface ColumnDef<TRowData> {
	valueGetterDependencies?: string[];
}

interface TreeDataOptions<TRowData> {
	getParentIdDependencies?: string[];
}
```

Reuse existing dependency metadata where already available.

### 2. Resolved dependency closures

Build active source-field sets:

```ts
interface ActiveRowDependencies {
	sortSourceFields: ReadonlySet<string>;
	filterSourceFields: ReadonlySet<string>;
	groupSourceFields: ReadonlySet<string>;
	aggregationSourceFields: ReadonlySet<string>;
	treeParentSourceFields: ReadonlySet<string>;
	opaqueStructuralDependency: boolean;
}
```

Resolve transitive formula dependencies and detect cycles.

### 3. Conservative opaque-getter policy

When an active structural operation uses a getter with unknown dependencies, correctness wins:

```text
unknown active sort/filter/group/tree dependency -> structural refresh
```

Do not classify it as value-only.

### 4. Dependency-aware classifier

Classify changed source fields against resolved closures, not only active target column names.

### 5. Tree dependency precision

A tree grid must not classify every field change as `tree-parent`. Only declared parent source fields should force tree restructuring. Opaque callbacks remain conservative.

## Phases

### Phase 1 — Dependency contract

- Add explicit metadata
- Normalize existing value-getter dependency APIs

### Phase 2 — Closure resolver

- Resolve transitive dependencies
- Cache by column/model versions
- Detect cycles and unknown getters

### Phase 3 — Classifier integration

- Sort
- filter
- grouping
- aggregation
- tree parentage

### Phase 4 — Correctness tests

Cover computed and transitive dependencies for every active row operation.

## STOP conditions

- Do not infer arbitrary JavaScript getter dependencies by parsing function source.
- Do not default unknown active getters to value-only.
- Do not rebuild the dependency closure per row mutation; cache it by relevant versions.
- Do not make tree data lose all value-only fast paths when dependencies are known.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests for computed sort/filter/group fields, aggregation source changes, transitive formulas, dependency cycles, opaque getters, and tree rows whose non-parent fields update without structural rebuild.
