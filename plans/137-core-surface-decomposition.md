# Plan 137: Decompose the Core Control Surfaces So Features Stop Accreting in GridEngine and GridStore

> **Executor instructions**: This is the final hardening slice after the ownership work above. The success condition is not `smaller files` by itself; it is that new features stop needing cross-cut edits to the same giant hubs.
>
> **Drift check (run first)**: `git diff --stat 6dac6c08..HEAD -- packages/core/src/store.ts packages/core/src/engine/GridEngine.ts packages/core/src/api/GridApi.ts packages/core/src/createGrid.ts packages/react/src`

## Status

- **Status**: DONE (reconciled 2026-07-28)
- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/136-selector-grade-subscription-surface.md`
- **Category**: tech-debt
- **Planned at**: commit `6dac6c08`, 2026-06-25

## Why this matters

Even with better ownership, the core will drift again if `GridEngine`, `GridStore`, and `GridApi` remain the default landing zone for every new feature. Right now those files are still oversized central surfaces, so the architecture still depends too much on discipline and too little on structure. This plan decomposes the control surfaces so the next major feature wave does not reopen the same ownership wounds.

## Current state

- `GridEngine.ts` is 1045 lines and owns a wide span of concerns from construction to subscriptions to mutation entrypoints.
- `store.ts` is 956 lines and still mixes facade, host/runtime binding, subscriptions, workspace helpers, and feature access.
- `GridApi.ts` is 735 lines and carries a very large mixed public surface.
- Existing architecture work has already proven decomposition is the repo’s preferred direction; follow that pattern instead of adding another monolith.

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
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/api/GridApi.ts`
- `packages/core/src/createGrid.ts`
- Supporting extracted modules
- Tests and architecture guards

**Out of scope**

- Public product feature additions
- Keeping duplicate legacy facade modules after extraction

## Steps

### Step 1: Split `GridStore` into explicit roles

Extract at least the following responsibilities out of `store.ts` into named modules:

- runtime/host binding
- subscription facade
- workspace/persistence helpers if still co-located
- feature command facade where appropriate

`GridStore` should remain a thin composition root/facade, not the universal implementation bucket.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Split `GridEngine` into narrower orchestration surfaces

Extract stable sub-owners for:

- command entrypoints
- domain subscription publishing
- feature registry/composition
- projection/render bridge if still mixed in

Avoid helper files that still depend on the full `GridEngine` object for everything; extract real ownership boundaries.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 3: Separate the public API into conceptual surfaces

Reduce `GridApi.ts` by splitting types and contracts into coherent surfaces such as:

- data mutation/read API
- structure/column API
- selection/editing API
- integrity API
- runtime diagnostics/subscription API

The top-level `GridApi` may still compose them, but the definitions should stop living as one giant contract file.

**Verify**: `corepack pnpm run test` -> exit 0

### Step 4: Add structural guardrails

Add guards preventing the extracted responsibilities from silently flowing back into `store.ts`, `GridEngine.ts`, or `GridApi.ts`. File budgets are not enough on their own; guard the ownership boundaries too.

**Verify**: `corepack pnpm run test:architecture` -> exit 0

### Step 5: Delete dead compatibility clutter

Remove any adapter, helper, or barrel that exists only to preserve the pre-decomposition layout. The operator explicitly asked to remove smells rather than preserving them under new names.

**Verify**: `corepack pnpm run build` -> exit 0

## Test plan

- Keep the full architecture gate green.
- Add tests or guards proving the old oversized files no longer own the extracted responsibilities.
- Ensure public API exports remain intentional and deep imports do not reappear.

## Done criteria

- [x] `GridStore`, `GridEngine`, and `GridApi` are materially decomposed by responsibility
- [x] Extracted responsibilities do not depend on broad backreferences to the old monoliths
- [x] Compatibility clutter created solely to preserve the old layout is deleted
- [x] `corepack pnpm run test:architecture` exits 0
- [x] `corepack pnpm run test` exits 0
- [x] `corepack pnpm run build` exits 0

## Reconciliation evidence

- 2026-07-28: Reconciled against the post-136/153/158/160 architecture. `GridApi.ts` is now a type/value utility boundary while conceptual public contracts compose in `api/GridApiSurfaces.ts`. `GridStore` delegates targeted subscriptions and host binding to `store/GridStoreSubscriptions.ts` and `store/GridStoreHostFacade.ts`, and now delegates the complete public row-model / `GridRowNode` / rows-accessor surface to `store/GridStoreRowFacade.ts`; the store composition root fell from 1,333 to 1,220 lines. Each facade receives a narrow dependency port and has architecture guards preventing `GridStore` backreferences. `GridEngine` delegates formal domain publication to `engine/GridDomainSubscriptionHub.ts`, render/cell notification batching to `engine/GridEngineRenderBridge.ts`, projection to `engine/GridProjectionPipeline.ts`, and feature commands to the feature controllers. No further extraction was made because a wrapper retaining unrestricted `GridEngine` access would be fake decomposition under this plan's STOP condition. Architecture verification passed (316 core + 5 React tests), full suites passed (1,949 core + 101 React tests), root build passed, packed-package consumer verification passed, and `bench:long-session` passed (5 core + 8 React tests).

## STOP conditions

- An extraction would require a new package boundary or public-package contract change that the operator wants handled as a separate release decision
- A candidate extraction turns out to be fake decomposition because the new module still needs unrestricted access to almost all of the old owner

## Maintenance notes

- After this plan, new features should declare the owner they extend instead of defaulting to `GridEngine` or `GridStore`.
- Reviewers should treat `just add one more method to GridStore/GridEngine/GridApi` as a smell that needs explicit justification.
