# Plan 005: Use Set membership for row selection class painting

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising.
>
> **Drift check (run first)**: `git diff --stat 66c92c2..HEAD -- packages/core/src/renderer/rowRenderer.ts packages/core/src/renderer/runtimePerformance.test.ts`
> If either in-scope file changed since this plan was written, compare the excerpts below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `66c92c2`, 2026-06-11

## Why this matters

`RowRenderer` already builds `_selectedRowIdSet` once per recycle frame, but row class painting still checks `state.selectedRowIds.includes(node.id)`. With many selected rows, that makes each visible row paint scan the selected-row array. Reusing the cached `Set` keeps row class work O(1) per row and matches the optimization already used for checkbox cells.

## Current state

- `packages/core/src/renderer/rowRenderer.ts` is the slot-based row/cell painter.
- `packages/core/src/renderer/runtimePerformance.test.ts` contains jsdom rendering performance regression tests.

```ts
// packages/core/src/renderer/rowRenderer.ts:296-298
const state = ctx?.state ?? this.engine.stateManager.getState();
this._selectedRowIdSet = state.selectedRowIds.length > 0 ? new Set(state.selectedRowIds) : null;
```

```ts
// packages/core/src/renderer/rowRenderer.ts:1595-1597
if (state.selectedRowIds.length > 0 && state.selectedRowIds.includes(node.id)) {
	rowClassName += ' og-row-node-selected';
}
```

## Commands you will need

| Purpose        | Command                                                                                                    | Expected on success          |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Core test file | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/runtimePerformance.test.ts` | exit 0, all tests pass       |
| Core tests     | `corepack pnpm --filter @eregister/open-grid-core test`                                                    | exit 0, all tests pass       |
| Core build     | `corepack pnpm --filter @eregister/open-grid-core build`                                                   | exit 0, no TypeScript errors |

## Scope

**In scope**:

- `packages/core/src/renderer/rowRenderer.ts`
- `packages/core/src/renderer/runtimePerformance.test.ts`

**Out of scope**:

- Public row-selection APIs in `packages/core/src/store.ts`.
- React wrappers in `packages/react/src`.
- Any behavior change to selected/focused row class names.

## Steps

### Step 1: Replace array membership with cached Set membership

In `updateRowClassNameSlot`, replace `state.selectedRowIds.includes(node.id)` with a lookup against `this._selectedRowIdSet`. Keep the class name behavior identical.

Target shape:

```ts
if (this._selectedRowIdSet?.has(node.id)) {
	rowClassName += ' og-row-node-selected';
}
```

Do not create a new `Set` inside `updateRowClassNameSlot`; the frame-level cache is already populated in `recycleViewport`.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Add a regression test

In `packages/core/src/renderer/runtimePerformance.test.ts`, add a test near the other runtime performance tests that creates many selected row IDs, paints/recycles the viewport, and confirms a selected visible row still receives `og-row-node-selected`. If the test can safely observe membership without broad global spies, also assert the paint path does not call `selectedRowIds.includes`.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/runtimePerformance.test.ts` -> exit 0.

## Test plan

- Add one regression test in `packages/core/src/renderer/runtimePerformance.test.ts`.
- Cover both behavior and performance shape: selected rows still get `og-row-node-selected`, and row paint avoids array membership scans.
- Run `corepack pnpm --filter @eregister/open-grid-core test`.

## Done criteria

- [ ] `rowRenderer.ts` uses `_selectedRowIdSet?.has(node.id)` for `og-row-node-selected`.
- [ ] No new `Set` allocation is added inside `updateRowClassNameSlot`.
- [ ] The new runtime performance regression test passes.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.

## STOP conditions

- `_selectedRowIdSet` no longer exists or is no longer populated before row class updates.
- The fix requires changing row-selection state shape or public APIs.
- The regression test cannot observe row class behavior without touching files outside scope.

## Maintenance notes

Future row-selection rendering should keep a single frame-level membership structure rather than reintroducing per-row array scans. Reviewers should scan for other `selectedRowIds.includes(...)` calls in renderer hot paths.
