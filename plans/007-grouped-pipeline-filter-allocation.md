# Plan 007: Avoid wrapper-to-node array churn before grouped pipeline stages

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising.
>
> **Drift check (run first)**: `git diff --stat 66c92c2..HEAD -- packages/core/src/rowModel.ts packages/core/src/rows/RowPipeline.ts packages/core/src/rowModel.test.ts packages/core/src/performance.test.ts`
> If any in-scope file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `66c92c2`, 2026-06-11

## Why this matters

`applyClientSortAndFilter` returns wrapper objects so plain sorted grids can preserve stable source-order tie breaks. Grouped paths call it and immediately throw away the wrappers with `.map((w) => w.node)`. For large grouped grids, filtering allocates one wrapper per surviving node plus a second node array before grouping even begins.

## Current state

- `packages/core/src/rowModel.ts` owns `applyClientSortAndFilter`.
- `packages/core/src/rows/RowPipeline.ts` uses that helper before grouping and flat rows.

```ts
// packages/core/src/rowModel.ts:123-130
): Array<{ node: RowNode<TData>; sourceIndex: number }> {
	const columnById = new Map<string, ColumnDef<TData>>();
	let result = nodes.map((node, sourceIndex) => ({ node, sourceIndex }));
```

```ts
// packages/core/src/rows/RowPipeline.ts:126-129
if (groupDefs.length > 0) {
	const filteredWrappers = applyClientSortAndFilter(nodes, columns, null, filterModel);
	const filteredNodes = filteredWrappers.map((w) => w.node);
	roots = groupStage(filteredNodes, groupDefs, context);
}
```

## Commands you will need

| Purpose         | Command                                                                                    | Expected on success          |
| --------------- | ------------------------------------------------------------------------------------------ | ---------------------------- |
| Row model tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts`    | exit 0, all tests pass       |
| Core perf tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/performance.test.ts` | exit 0, all tests pass       |
| Core build      | `corepack pnpm --filter @eregister/open-grid-core build`                                   | exit 0, no TypeScript errors |

## Scope

**In scope**:

- `packages/core/src/rowModel.ts`
- `packages/core/src/rows/RowPipeline.ts`
- `packages/core/src/rowModel.test.ts`
- `packages/core/src/performance.test.ts`

**Out of scope**:

- Rewriting sort semantics.
- Changing `groupStage` signatures unless necessary.
- Renderer changes.

## Steps

### Step 1: Extract prepared filtering so it can return nodes directly

In `rowModel.ts`, split filter preparation and matching into shared helpers. Add a new exported helper such as `applyClientFilterOnly<TData>(nodes, columns, filterModel): RowNode<TData>[]`.

Requirements:

- It shares the same prepared filter semantics as `applyClientSortAndFilter`.
- It returns the original `nodes` array when there are no active filters, or a filtered `RowNode[]` when filters exist.
- It does not allocate `{ node, sourceIndex }` wrappers.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Use the node-only filter path in grouped pipeline branches

In `RowPipeline.run`, replace grouped branch wrapper creation and unwrapping with the new node-only filter helper. Keep the flat sorted branch using `applyClientSortAndFilter(...).map((w) => w.node)` because it needs sorting and stable source-index tie breaks.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts` -> exit 0.

### Step 3: Add grouped filter regression coverage

Add or extend a test to verify grouped filtering still excludes nonmatching rows, includes matching rows in the correct group, and keeps group labels/counts correct.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/performance.test.ts` -> exit 0.

## Test plan

- Row model grouping/filtering tests should prove behavior did not change.
- The flat sorted path should still be covered by existing sort tests.
- Run the full core test suite.

## Done criteria

- [ ] Grouped filter paths no longer create wrapper objects only to unwrap them.
- [ ] Flat sort/filter behavior is unchanged.
- [ ] Grouped filtering tests pass and cover group count/label behavior.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.

## STOP conditions

- The extracted filter helper would duplicate substantial logic instead of sharing it.
- Stable sorted ordering changes in any existing test.
- Fixing grouped filtering requires changing public row model APIs.

## Maintenance notes

Keep sort-specific wrapper allocation contained to paths that actually sort. Reviewers should confirm grouped filtering does not accidentally bypass valueGetter or path getter semantics.
