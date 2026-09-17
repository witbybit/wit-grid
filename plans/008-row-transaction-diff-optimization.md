# Plan 008: Reduce row transaction diff allocations for wide rows

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising.
>
> **Drift check (run first)**: `git diff --stat 66c92c2..HEAD -- packages/core/src/rows/RowDataStore.ts packages/core/src/rows/RowDataStore.test.ts packages/core/src/performance.test.ts packages/core/src/rowModel.ts`
> If any in-scope file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `66c92c2`, 2026-06-11

## Why this matters

`RowDataStore.updateRows` and `applyTransaction(update)` diff changed row objects by allocating `Object.keys` arrays, spreading them into a new `Set`, and then scanning all keys. This is correct, but expensive when a wide-row dataset updates many row objects with only one or two changed fields.

## Current state

- `packages/core/src/rows/RowDataStore.ts` owns source row storage and row-level transaction diffs.
- `packages/core/src/rowModel.ts` consumes `changedFieldsByRow` to invalidate cells, valueGetter dependents, formulas, and sort/filter refreshes.

```ts
// packages/core/src/rows/RowDataStore.ts:101-107
const changedFields = new Set<string>();
const changedValues = new Map<string, { oldValue: unknown; newValue: unknown }>();
const prevKeys = Object.keys(prevRow as object);
const nextKeys = Object.keys(nextRow as object);
const allKeys = new Set([...prevKeys, ...nextKeys]);

for (const key of allKeys) {
```

```ts
// packages/core/src/rows/RowDataStore.ts:164-168
const changedFields = new Set<string>();
const changedValues = new Map<string, { oldValue: unknown; newValue: unknown }>();
const allKeys = new Set([...Object.keys(prevRow as object), ...Object.keys(row as object)]);
```

## Commands you will need

| Purpose         | Command                                                                                          | Expected on success          |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------- |
| Row store tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/RowDataStore.test.ts` | exit 0, all tests pass       |
| Core perf tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/performance.test.ts`       | exit 0, all tests pass       |
| Core build      | `corepack pnpm --filter @eregister/open-grid-core build`                                         | exit 0, no TypeScript errors |

## Scope

**In scope**:

- `packages/core/src/rows/RowDataStore.ts`
- `packages/core/src/rows/RowDataStore.test.ts`
- `packages/core/src/performance.test.ts`
- `packages/core/src/rowModel.ts` only if a tiny consumer optimization is needed

**Out of scope**:

- Public `RowDataTransaction` API changes.
- Formula invalidation behavior.
- Renderer updates.

## Steps

### Step 1: Add tests for asymmetric row keys and unchanged new objects

Extend `RowDataStore.test.ts` so any diff refactor is pinned down:

- A new object with identical fields produces no changed nodes.
- Added fields are reported as changed.
- Removed fields are reported as changed with `newValue: undefined`.
- Existing field changes still populate `changedFieldsByRow` and `changedValuesByRow`.

Cover both `updateRows` and `applyTransaction({ update })` if practical.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/RowDataStore.test.ts` -> exit 0.

### Step 2: Replace Set-of-keys diff with a shared two-pass helper

In `RowDataStore.ts`, add a private helper function that:

- Iterates `Object.keys(prevRow)` once and compares against `nextRow`.
- Iterates `Object.keys(nextRow)` once and handles keys not present in `prevRow`.
- Allocates `changedFields` and `changedValues` lazily only after the first detected difference, or returns `null` when no fields changed.
- Preserves the exact `Map<string, { oldValue; newValue }>` values expected by existing consumers.

Use this helper in both `updateRows` and `applyTransaction`.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/RowDataStore.test.ts` -> exit 0.

### Step 3: Add a wide-row regression check

Add a performance-oriented test in `performance.test.ts` or `RowDataStore.test.ts` that updates many wide rows where each changed row mutates one field. Assert exactly the expected changed nodes and one changed field per changed row.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/performance.test.ts src/rows/RowDataStore.test.ts` -> exit 0.

## Test plan

- Existing row store tests must pass.
- New tests must cover added/removed field detection, unchanged object references, and wide-row update behavior.
- Run the full core test suite.

## Done criteria

- [ ] The duplicated `new Set([...Object.keys(...), ...Object.keys(...)])` patterns are removed from `RowDataStore.ts`.
- [ ] Changed field/value reporting is unchanged for existing consumers.
- [ ] Wide-row update regression coverage exists.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.

## STOP conditions

- The optimized helper cannot preserve added/removed key semantics.
- Existing row model tests fail because consumers rely on a subtle ordering behavior not captured here.
- The fix requires changing transaction result public types.

## Maintenance notes

If future APIs let callers supply explicit changed fields, that should bypass object-key scanning entirely. Until then, keep row diffing centralized in one helper so correctness and performance tests protect both update paths.
