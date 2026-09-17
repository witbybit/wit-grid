# Plan 006: Stream built-in aggregations without descendant value arrays

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising.
>
> **Drift check (run first)**: `git diff --stat 66c92c2..HEAD -- packages/core/src/rows/stages/aggregateStage.ts packages/core/src/rows/stages/aggregateStage.test.ts packages/core/src/performance.test.ts`
> If any in-scope file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `66c92c2`, 2026-06-11

## Why this matters

Grouped aggregations currently allocate a descendant leaf array for every group node, then allocate a numeric `values` array per aggregate field. In large grouped grids, this duplicates leaf references across parent groups and creates GC pressure during every row-pipeline refresh. Built-in aggregations can be computed in a single recursive pass while preserving the custom aggregation callback behavior that needs leaf nodes.

## Current state

- `packages/core/src/rows/stages/aggregateStage.ts` calculates group aggregate values.
- `packages/core/src/rows/stages/aggregateStage.test.ts` covers aggregation behavior.

```ts
// packages/core/src/rows/stages/aggregateStage.ts:26-33
const descendantLeafNodes: RowNode<TData>[] = [];
if (node.kind === 'data') {
	descendantLeafNodes.push(node.node);
}
for (const child of node.children ?? []) {
	const childLeaves = aggregateNodeRecursively(child, aggDefs, context);
	descendantLeafNodes.push(...childLeaves);
}
```

```ts
// packages/core/src/rows/stages/aggregateStage.ts:44-59
if (typeof aggFunc === 'function') {
	aggregateValues[field] = aggFunc(descendantLeafNodes);
	continue;
}
const values = descendantLeafNodes.map((n) => context.getValue(n, field)).filter((v) => typeof v === 'number' && !isNaN(v)) as number[];
```

## Commands you will need

| Purpose         | Command                                                                                                   | Expected on success          |
| --------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Aggregate tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/stages/aggregateStage.test.ts` | exit 0, all tests pass       |
| Core perf tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/performance.test.ts`                | exit 0, all tests pass       |
| Core build      | `corepack pnpm --filter @eregister/open-grid-core build`                                                  | exit 0, no TypeScript errors |

## Scope

**In scope**:

- `packages/core/src/rows/stages/aggregateStage.ts`
- `packages/core/src/rows/stages/aggregateStage.test.ts`
- `packages/core/src/performance.test.ts` only if adding a narrowly scoped regression benchmark

**Out of scope**:

- Group ID generation in `visualRowIds.ts`.
- Group construction in `groupStage.ts`.
- Public `AggregationDef` type changes unless strictly backward-compatible.

## Steps

### Step 1: Preserve behavior with tests before refactoring

Add tests in `aggregateStage.test.ts` that cover multiple aggregate fields, nested parent aggregates, and custom aggregation callbacks receiving the full `RowNode[]` leaf list in source order.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/stages/aggregateStage.test.ts` -> exit 0.

### Step 2: Introduce streaming accumulators for built-ins

Refactor `aggregateNodeRecursively` so built-in `sum`, `avg`, `min`, `max`, and `count` are accumulated while visiting leaves, without creating a per-field `values` array. Keep custom functions working by collecting descendant leaves only when at least one `aggDef.aggFunc` is a function.

Do not change how `undefined` is produced when no numeric values exist for `sum`/`avg`/`min`/`max`.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/stages/aggregateStage.test.ts` -> exit 0.

### Step 3: Add a large grouped aggregation regression check

Add a deterministic test that builds a large grouped tree and verifies aggregate correctness. If adding a timing budget, keep it loose enough for CI variance and local Windows runs.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/performance.test.ts src/rows/stages/aggregateStage.test.ts` -> exit 0.

## Test plan

- Existing aggregate tests must continue to pass.
- New tests must cover built-in and custom aggregation paths.
- Run `corepack pnpm --filter @eregister/open-grid-core test` before completion.

## Done criteria

- [ ] Built-in aggregations no longer allocate a numeric `values` array per field per group.
- [ ] Custom aggregation functions still receive descendant `RowNode[]`.
- [ ] Nested group aggregate behavior is unchanged.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.

## STOP conditions

- Preserving custom aggregation callbacks requires changing their public signature.
- Existing tests reveal ambiguous behavior for non-numeric `sum` or `avg`.
- A no-allocation implementation would require changing `RowTreeNode` public shape.

## Maintenance notes

If future aggregation functions need all leaf values, keep that path explicit and isolated so built-in aggregations stay streaming. Reviewers should look closely at nested group totals and custom callback compatibility.
