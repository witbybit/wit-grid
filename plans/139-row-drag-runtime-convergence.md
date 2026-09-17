# Plan 139: Converge Managed Row Drag Into the Canonical Runtime Instead of a DOM Side Channel

> **Executor instructions**: This plan is about runtime convergence, not cosmetic polish. The success condition is that managed row drag stops being a special-case island with its own scheduling, sort policy, and lifecycle behavior.
>
> **Drift check (run first)**: `git diff --stat 6a519297..HEAD -- packages/core/src/features/RowDragController.ts packages/core/src/engine packages/core/src/renderer packages/core/src/store.ts packages/core/src/api packages/core/src/state`
> If any in-scope file changed since this plan was written, compare the Current state excerpts below against the live code before proceeding. Any material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: `plans/138-canonical-data-write-pipeline.md`
- **Category**: tech-debt
- **Planned at**: commit `6a519297`, 2026-06-26

## Why this matters

Managed row drag currently behaves like an interaction add-on rather than a first-class grid runtime feature. It reaches into DOM state, owns its own `requestAnimationFrame` loops, and clears sort state during commit to make reordering “work.” That is acceptable in a demo, but not in a grid aiming at AG Grid / Airtable / Sheets-grade composability under real feature overlap.

The grid needs one explicit runtime story for drag: when it is allowed, how it interacts with sort/filter/group/pagination/server models, how auto-scroll is scheduled, and how reorder commits enter the same canonical mutation pipeline as every other structural write.

## Current state

- `packages/core/src/features/RowDragController.ts` owns the interaction directly against DOM/runtime state:
    - `RowDragController.ts:57-125` binds document pointer listeners and queries the row model/DOM directly
    - `RowDragController.ts:249-279` commits reorder in managed mode
    - `RowDragController.ts:255-256` explicitly clears `sortModel` before reordering
    - `RowDragController.ts:323-324` uses double `requestAnimationFrame` for FLIP animation staging
    - `RowDragController.ts:417-422` uses an interaction-owned auto-scroll `requestAnimationFrame` loop
- Existing architecture guards only prove narrow things:
    - `packages/core/src/engine/architectureGuards.test.ts:351-356` proves the controller does not call `rowModel.setRowOrder(...)` directly
    - `packages/core/src/engine/architectureGuards.test.ts:1043-1058` only documents direct `requestAnimationFrame` usage as an exception
- I did not find a dedicated behavioral `RowDragController` test file in `packages/core/src`; drag currently has guard coverage, not full runtime regression coverage
- The current row-model capability surface already says reorder is not universally available:
    - `packages/core/src/store.ts:141-144` marks `rowOrder` true only for the client row model fallback capability matrix

### Relevant repo conventions

- Structural writes should enter through typed domain mutations, not by feature-local state surgery. Match `row-order` handling in `packages/core/src/engine/GridDomainMutation.ts`.
- Scheduling ownership is supposed to live under frame coordination unless there is a clearly documented interaction-only exception. If you keep any drag-local scheduler logic, it must be minimal, explicit, and tested.
- The repo’s preferred test style for runtime correctness is a focused regression suite plus architecture guards; use both.

## Commands you will need

| Purpose            | Command                                                                                                                                                                                                   | Expected on success |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Architecture gate  | `corepack pnpm run test:architecture`                                                                                                                                                                     | exit 0              |
| Core tests         | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                                                   | exit 0              |
| Workspace tests    | `corepack pnpm run test`                                                                                                                                                                                  | exit 0              |
| Build/typecheck    | `corepack pnpm run build`                                                                                                                                                                                 | exit 0              |
| Focused drag tests | `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/features/RowDragController.test.ts packages/core/src/store.test.ts packages/core/src/renderer/renderEngine.test.ts` | all pass            |

## Scope

**In scope**

- `packages/core/src/features/RowDragController.ts`
- Supporting drag runtime/state files you need to extract or introduce
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/engine/GridDomainMutation.ts`
- `packages/core/src/store.ts`
- `packages/core/src/api/GridApiSurfaces.ts`
- `packages/core/src/renderer/**` only where needed for scheduler/runtime ownership
- `packages/core/src/state/**` only where needed for explicit drag policy/state
- New drag regression tests
- `packages/core/src/engine/architectureGuards.test.ts`

**Out of scope**

- New drag product features beyond convergence/hardening
- Reordering support for row models that cannot honestly support it
- Visual redesign of drag ghosts/indicators unrelated to ownership

## Git workflow

- Branch: `advisor/139-row-drag-runtime-convergence`
- Match the repo’s recent commit style from `git log`
- Do not push or open a PR unless the operator explicitly asks

## Steps

### Step 1: Define the allowed managed-row-drag contract

Write the runtime rules in code first, then implement to them. At minimum define:

- which row models may use managed row drag
- whether sorted, filtered, grouped, tree, paginated, or server/infinite grids may use managed reorder
- what the runtime does when drag is not allowed: block, downgrade, or require unmanaged mode

Do not keep “clear sort state and continue” as an implicit policy. If the product wants reorder-under-sort later, that must be an explicit architecture decision, not a side effect.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Route drag commit through the canonical structural write pipeline

Make managed drag commit enter the same authoritative mutation path used by other structural writes. The controller may still collect pointer interaction details, but the commit of row reordering must not be a bespoke feature-local lifecycle.

If needed, introduce a dedicated engine command or domain mutation for managed drag reorder that reuses the row-order mutation internally while preserving drag-specific metadata for events/tests.

**Verify**: `rg --line-number "setSortModel\\(null|rowModel\\.getRowOrder\\(|rowModel\\.setRowOrder\\(" packages/core/src/features/RowDragController.ts` -> no production match for the legacy policy paths

### Step 3: Remove the hidden sort-clearing behavior and replace it with explicit capability/policy checks

Replace the current “sort overrides source order, clear first” behavior with one explicit runtime policy:

- either managed drag is disallowed while sort is active, or
- managed drag uses a documented reorder policy that remains correct under sort

Given the current architecture, the likely correct answer is to disallow managed reorder under active sort/filter/group/tree/pagination/server-mode combinations unless you can prove correctness with tests.

If you disallow, surface it through the existing capability/runtime fault patterns rather than silently doing nothing.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 4: Reduce drag-local scheduling to the narrowest interaction shell possible

Move any schedule-worthy behavior you can into shared runtime primitives. If some drag-local `requestAnimationFrame` behavior must remain for pointer interaction or animation staging, keep it as a tiny shell with explicit comments and tests proving it is not a second render scheduler.

The key outcome is that drag no longer owns an open-ended side-channel timing model.

**Verify**: `corepack pnpm run test:architecture` -> exit 0

### Step 5: Add a real drag regression suite

Create dedicated drag behavior tests instead of relying mostly on architecture guards. Cover at minimum:

- drag activation threshold
- cancel via pointer cancel / Escape
- managed reorder on a flat client grid
- blocked or rejected managed drag when sort is active
- blocked or rejected managed drag on unsupported row models
- auto-scroll lifecycle cleanup on cancel/destroy
- no duplicate drag-end / drag-cancel event emission

If render/DOM integration matters for one or two cases, add a higher-level runtime test in addition to unit tests.

**Verify**: `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/features/RowDragController.test.ts packages/core/src/store.test.ts packages/core/src/renderer/renderEngine.test.ts` -> all pass

### Step 6: Add guardrails so row drag cannot drift back into a feature island

Add architecture guards that enforce the new contract, for example:

- no silent `setSortModel(null, ...)` in drag commit paths
- no direct row-model reorder ownership in `RowDragController`
- if direct `requestAnimationFrame` remains, it must stay limited to the documented interaction shell
- drag policy checks must exist for unsupported row-model / sort-state combinations

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Create `packages/core/src/features/RowDragController.test.ts` as the dedicated behavioral suite.
- Add at least one `store.test.ts` integration regression for the allowed managed reorder path.
- Add at least one integration assertion that managed drag under active sort is explicitly rejected or blocked, not converted into a sort reset.
- Keep existing architecture guards, but use them as backstops, not the only proof.

## Done criteria

- [ ] Managed row drag has an explicit capability/policy contract for sort/filter/group/pagination/server/infinite combinations
- [ ] Row drag commit uses the canonical structural write pipeline instead of a bespoke side path
- [ ] Silent sort clearing is removed
- [ ] Drag-local scheduling is reduced to the narrowest documented interaction shell possible
- [ ] A dedicated drag regression suite exists and passes
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0

## STOP conditions

- The correct product behavior for managed drag under active sort/filter/group/pagination is ambiguous and the operator wants a product decision before enforcing a policy
- Converging drag commit into the canonical write pipeline reveals missing row-order metadata or missing engine command vocabulary that would need a larger mutation redesign
- Shared scheduler integration would require destabilizing unrelated render timing; if so, keep a narrow interaction shell and document why

## Maintenance notes

- Future drag features should extend the explicit drag policy contract instead of adding ad hoc checks in `RowDragController`.
- Reviewers should treat any new hidden state rewrite during drag commit as a likely architecture regression.
- If reorder-under-sort is ever added later, it should come with a dedicated architecture amendment and test matrix, not a silent behavior tweak.
