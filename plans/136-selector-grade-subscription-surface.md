# Plan 136: Replace Broad Store Wakeups with Selector-Grade Domain Subscriptions

> **Executor instructions**: The goal is to reduce fan-out and sharpen ownership, not just rename subscription methods. If a new API still wakes on `globalVersion` for row-local updates, it does not satisfy this plan.
>
> **Drift check (run first)**: `git diff --stat 6dac6c08..HEAD -- packages/core/src/store.ts packages/core/src/api/GridApi.ts packages/core/src/engine packages/react/src`

## Status

- **Status**: DONE (2026-07-28)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/135-streaming-and-integrity-convergence.md`
- **Category**: perf
- **Planned at**: commit `6dac6c08`, 2026-06-25

## Why this matters

Serious grids survive feature load by waking only the smallest necessary slice of the system. Open Grid already has good cell-level hooks, but broad snapshot subscriptions in `store.ts` still wake on keys like `globalVersion`, `columns`, and `sortModel` for higher-level consumers. That will become a scaling bottleneck once formulas, integrity, collaboration, charts, and devtools all subscribe concurrently.

## Current state

- `store.ts` still exposes broad subscriptions:
    - `subscribeToRow` listens to `globalVersion` and `rowHeights` at `packages/core/src/store.ts:963-975`
    - `subscribeToColumn` listens to `columns` and `columnWidths` at `packages/core/src/store.ts:977-989`
    - `subscribeToHeaders` listens to `columns`, `columnWidths`, and `sortModel` at `packages/core/src/store.ts:991-1000`
- `GridApi` exposes domain-version subscription hooks but not a strong selector-grade read model for all important domains.
- Domain versions already exist in `GridEngine`, so the architecture has the beginnings of a better wakeup model.

## Commands you will need

| Purpose           | Command                                                 | Expected on success |
| ----------------- | ------------------------------------------------------- | ------------------- |
| Architecture gate | `corepack pnpm run test:architecture`                   | exit 0              |
| Core tests        | `corepack pnpm --filter @eregister/open-grid-core test` | exit 0              |
| Workspace tests   | `corepack pnpm run test`                                | exit 0              |
| Build/typecheck   | `corepack pnpm run build`                               | exit 0              |

## Scope

**In scope**

- `packages/core/src/store.ts`
- `packages/core/src/api/GridApi.ts`
- `packages/core/src/engine/GridEngine.ts`
- Any small selector-support files required in core/react
- Tests and architecture guards

**Out of scope**

- Rewriting every React consumer in one sweep beyond what is required to prove the new API
- New end-user features

## Steps

### Step 1: Define selector-grade subscription primitives

Add precise read/subscribe primitives for key domains such as:

- row by rowId
- column by colField
- header topology
- integrity state
- viewport
- editing cell
- selection

The new API should let consumers subscribe to a narrow derived projection with an equality boundary instead of broad snapshot invalidation.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Rebuild row/column/header subscriptions on the new primitives

Replace the current broad `globalVersion` / `columns` / `sortModel` fan-out in `store.ts` with narrow selector-grade subscriptions or domain-version-backed comparators.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 3: Add an integrity selector surface

Expose a first-class selector-grade subscription path for authoritative integrity state. Devtools, sidebars, and future collaboration tooling should not need full snapshot subscriptions to watch integrity changes.

**Verify**: `corepack pnpm run test` -> exit 0

### Step 4: Remove the broad legacy subscription helpers that no longer fit

Delete or rewrite any helper whose semantics are fundamentally `wake on broad state and let the caller sort it out later`. The operator explicitly asked for no compatibility clutter, so do not keep redundant legacy helpers around.

**Verify**: `rg --line-number "globalVersion.*subscribeToRow|subscribeToHeaders|subscribeToColumn" packages/core/src/store.ts` -> only the intended new implementation remains

### Step 5: Add fan-out guardrails

Add architecture or behavioral tests proving the new subscription surface does not regress to broad-key wakeups for narrow selectors.

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Add tests proving row-local subscriptions do not fire for unrelated row updates.
- Add tests proving column-local subscriptions do not fire for unrelated columns.
- Add tests proving integrity selectors only wake on integrity-domain changes.
- If React hooks consume the new surface, add a narrow rerender-count regression test.

## Done criteria

- [x] Broad row/column/header wakeups are replaced by selector-grade or domain-scoped subscriptions
- [x] Integrity has a narrow subscription surface
- [x] Redundant legacy broad helpers are deleted or fundamentally rewritten
- [x] `corepack pnpm run test:architecture` exits 0
- [x] `corepack pnpm run test` exits 0
- [x] `corepack pnpm run build` exits 0

## Completion evidence

- Row subscriptions now combine row-local committed-cell notifications with `rows` and `geometry` domain projections; unrelated row writes do not notify them.
- Column and header subscriptions now use `columns`/`sorting` domain projections instead of broad state-key fan-out. Integrity, viewport, selection, focus, and editing retain their existing key-scoped selector projections.
- `FormulaBar` no longer calls broad `api.subscribe`: it observes `selection` and uses the public focused-cell `subscribeToCell` contract for value changes.
- Guardrails: core verifies row-local fan-out; React verifies both that a key-scoped selection selector does not rerender for an unrelated column-width mutation and that FormulaBar ignores an unrelated cell write.
- Verification (2026-07-28): `corepack pnpm run test:architecture` (316 core + 5 React), `corepack pnpm run test` (1,949 core + 100 React), `corepack pnpm run build` (core, React, demo), and `corepack pnpm run bench:long-session` (5 core + 8 React) all exited 0.

## STOP conditions

- A proposed selector API would require unsafe referential assumptions not supported by current state/projection lifecycles
- React adapter consumers depend on full snapshots in ways that need a larger deliberate migration plan

## Maintenance notes

- Future subscriptions should be reviewed in terms of wakeup granularity, not convenience alone.
- Reviewers should push back on any new API that subscribes broadly and expects the consumer to diff after the fact.
