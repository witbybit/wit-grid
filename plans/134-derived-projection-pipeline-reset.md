# Plan 134: Reset the Derived Projection Pipeline Around the Commit Kernel

> **Executor instructions**: Follow this plan exactly. The goal is to remove secondary mutation authority, not just move code around. If a step ends with both the old reactive path and the new pipeline active, finish the cut or stop and report.
>
> **Drift check (run first)**: `git diff --stat 6dac6c08..HEAD -- packages/core/src/engine packages/core/src/models packages/core/src/renderer packages/core/src/state`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/133-public-commit-result-protocol.md`
- **Category**: tech-debt
- **Planned at**: commit `6dac6c08`, 2026-06-25

## Why this matters

The commit kernel is only truly authoritative if derived state, domain version bumps, and render invalidation are downstream of it in one deterministic pipeline. Right now `GridStateReactionController` still writes derived state reactively, and `RenderInvalidationCoordinator` still owns a separate event/state invalidation bridge. That leaves multiple places where the runtime can decide what changed, which is exactly the kind of architecture drift that turns a grid engine unstable under feature load.

## Current state

- `GridStateReactionController.handleStateChanges` mutates derived state and triggers targeted notifications after observing changed keys: `packages/core/src/engine/GridStateReactionController.ts:41-215`.
- `RenderInvalidationCoordinator.bind` subscribes to events and state keys and emits invalidation side effects: `packages/core/src/renderer/RenderInvalidationCoordinator.ts:29-87`.
- `gridDirectWriteAllowlist.ts` explicitly documents remaining non-kernel write authorities: `packages/core/src/engine/gridDirectWriteAllowlist.ts:1-34`.
- `GridCommitKernel` already has the right conceptual insertion point for `commit -> apply derived projections -> publish domains -> events -> render`.

## Commands you will need

| Purpose           | Command                                                 | Expected on success |
| ----------------- | ------------------------------------------------------- | ------------------- |
| Architecture gate | `corepack pnpm run test:architecture`                   | exit 0              |
| Core tests        | `corepack pnpm --filter @eregister/open-grid-core test` | exit 0              |
| Workspace tests   | `corepack pnpm run test`                                | exit 0              |
| Build/typecheck   | `corepack pnpm run build`                               | exit 0              |

## Scope

**In scope**

- `packages/core/src/engine/GridStateReactionController.ts`
- `packages/core/src/renderer/RenderInvalidationCoordinator.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/engine/GridEngine.ts`
- Related model/runtime files that are required to express the new projection pipeline
- Architecture guards and regression tests

**Out of scope**

- Renderer DOM topology refactors unrelated to ownership
- New features
- A compatibility phase where both projection systems remain active long term

## Steps

### Step 1: Define the post-commit projection pipeline

Design an explicit projection phase owned by the kernel. It must state, in code, the ordered steps from committed logical mutation to:

- derived model refresh/projection
- domain version publish
- cell/row targeted notifications
- render invalidation

This should replace inference-by-key-observation as the primary authority.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Move derived runtime updates out of reactive key observation

Reduce `GridStateReactionController` from owner to helper or delete it outright if the new pipeline fully absorbs its responsibilities. Derived state updates like selection bounds and visible ranges should be explicitly recomputed by the projection pipeline, not opportunistically by `updated key` inspection.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 3: Collapse render invalidation into projection outputs

Make render invalidation an explicit output of the projection pipeline rather than an additional authority listening to state/events and deciding what to invalidate after the fact. `RenderInvalidationCoordinator` may remain as a renderer-facing shell if needed, but it must not be the business-logic owner of change interpretation.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts` -> all pass

### Step 4: Shrink or delete the direct-write allowlist entries

Update `gridDirectWriteAllowlist.ts` to reflect the new reality. The expected direction is that:

- `GridStateReactionController` leaves the allowlist
- `RenderInvalidationCoordinator` leaves the allowlist or is reclassified as a renderer-only consumer
- `GridEngine` loses remaining temporary bootstrap-derived write authority where practical

**Verify**: `corepack pnpm run test:architecture` -> exit 0

### Step 5: Add determinism regression coverage

Add tests proving that the same committed logical mutation produces:

- one deterministic projection update
- one deterministic domain publish set
- one deterministic invalidation plan

The test should fail if a second reactive side-path reintroduces extra invalidation or projection writes.

**Verify**: `corepack pnpm run test` -> exit 0

## Test plan

- Add regression tests around selection, sort, filter, expansion, and row-height changes to prove the new pipeline still computes:
    - bounds
    - visible ranges
    - geometry updates
    - targeted invalidations
- Add at least one adversarial test proving duplicate render invalidations are not emitted for a single logical mutation.

## Done criteria

- [ ] `commit -> projection -> publish -> render` is an explicit owned pipeline
- [ ] `GridStateReactionController` no longer acts as a secondary mutation authority
- [ ] `RenderInvalidationCoordinator` no longer interprets business-domain changes as an additional owner
- [ ] `gridDirectWriteAllowlist.ts` shrinks accordingly
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0

## STOP conditions

- Deleting reactive key observation exposes missing domain-change metadata that the commit kernel does not currently produce
- A renderer-critical timing constraint requires a clearly documented renderer-only post-processing phase; if so, keep it renderer-only and explicitly non-authoritative

## Maintenance notes

- Future features should declare their projection outputs at commit time instead of adding new watchers.
- Reviewers should treat any new `subscribeToKey(...)->mutate/invalidate` path as a likely architecture violation unless it is clearly renderer-local and non-authoritative.
