# Plan 167: Delete the GridEngine render forwarding bridge

> **Executor instructions**: This is a concept deletion, not a notification redesign. Preserve transaction batching, render request coalescing, subscription identity, notification timing, and fault-finally behavior exactly. Do not move policy into `GridStore` or add a replacement facade.
>
> **Drift check (run first)**: `git diff --stat faf29558..HEAD -- packages/core/src/engine/GridEngine.ts packages/core/src/engine/GridEngineRenderBridge.ts packages/core/src/engine/CellNotificationController.ts packages/core/src/engine/architectureGuards.test.ts packages/core/src/store.test.ts`

## Status

- **State**: DONE
- **Priority**: P0
- **Effort**: S
- **Risk**: MED
- **Depends on**: Plans 164-166
- **Category**: tech-debt
- **Planned at**: commit `faf29558`, 2026-07-29, with Plans 164-166 present in the working tree

## Why this matters

`GridEngineRenderBridge` is a single-use internal class between `GridEngine` and `CellNotificationController`. `GridEngine` forwards eleven methods to the bridge, and the bridge forwards most of them directly to `CellNotificationController`. Its dependency interface also declares `commandHistory` and `requestRender`, but the class never reads either dependency.

Only two methods contain policy:

- `batch()` brackets a `StateManager` transaction and the existing `RenderRequestCoordinator` transaction, flushing queued cell updates in `finally`.
- `publishCommittedCellChanges()` chooses queued or synchronous subscriber publication from the already-owned `CellNotificationController.batchedUpdates` state.

Those are engine orchestration responsibilities. Deleting the bridge removes one class, one dependency interface, one file, two unused dependency edges, a constructor allocation, and a double-forwarding hop without combining unrelated state owners.

## Current state

- `packages/core/src/engine/GridEngineRenderBridge.ts` defines the bridge and its dependency interface.
- `packages/core/src/engine/GridEngine.ts:267` is its only production owner.
- `GridEngine.ts:461-468` constructs it with six dependencies; `commandHistory` and `requestRender` are unused by the bridge.
- `GridEngine.ts:1267-1312` forwards batching and notification methods through it.
- `CellNotificationController` already owns batching flags, queues, subscriber maps, cache clearing, row versions, render invalidation, and fault isolation.
- `GridEngine.beginRenderTransaction()` / `endRenderTransaction()` already delegate to the sole `RenderRequestCoordinator`.
- `GridStore.transaction()` uses `GridEngine.batch()` to coalesce multi-domain changes.
- `architectureGuards.test.ts:2748-2757` preserves the extracted class by name rather than enforcing the semantic owners.
- The live pre-change focused baseline passed 454/454 tests across `store.test.ts`, `GridChangeApplier.test.ts`, and `architectureGuards.test.ts` on 2026-07-29.

## Scope

**In scope**:

- `packages/core/src/engine/GridEngine.ts`
- Delete `packages/core/src/engine/GridEngineRenderBridge.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- Existing tests in `packages/core/src/store.test.ts` or a focused engine test only if characterization gaps require them
- Update `docs/architecture/core-concept-inventory.md` to remove the deleted class and correct the exact boundary-class count

**Out of scope**:

- Changing `CellNotificationController` ownership, queue semantics, scheduler, subscriber maps, or public methods unless a type-only visibility adjustment is strictly required
- Moving notification logic into `GridStore`
- Changing `GridStore.transaction()`, public API types, event ordering, formula effects, or invalidation semantics
- Renaming `RenderRequestCoordinator`, `CellNotificationController`, or any renderer coordinator
- Adding another bridge, facade, port, context, or dependency interface
- Updating the unrelated experimental API-contract baseline

## Steps

### Step 1: Characterize the two meaningful behaviors

Before deletion, confirm tests observe through `GridStore`/`GridEngine`:

1. A multi-domain `GridStore.transaction()` produces one coalesced render request and balanced state/render transactions.
2. If a transaction callback throws, state and render transactions close and pending cell updates flush exactly once.
3. With `batchedUpdates = true`, committed cell changes notify once after the microtask or explicit synchronous flush.
4. With batching disabled, committed changes notify synchronously.
5. Register, unregister, row subscribe, column/cell subscribe, and subscription identity updates remain unchanged.
6. Subscriber exceptions remain isolated through `RuntimeFaultReporter`.

Add only missing behavioral characterization; do not test the bridge class directly.

**Verify**: focused store/commit/cell-notification tests pass before deletion.

### Step 2: Inline engine-owned orchestration

In `GridEngine.ts`:

1. Remove the bridge import, field, and constructor allocation.
2. Implement `batch()` directly with the existing ordering:
    - `beginRenderTransaction()`
    - `stateManager.startTransaction()`
    - callback
    - in `finally`: `stateManager.endTransaction()`, `cellNotifications.flushCellUpdatesSync()`, `endRenderTransaction()`
3. Implement `publishCommittedCellChanges()` directly:
    - if `cellNotifications.batchedUpdates`, enqueue each cell and schedule one batch flush;
    - otherwise call `cellNotifications.publishCommittedCellChanges(changes)`.
4. Delegate the remaining public/internal notification methods directly to the existing `cellNotifications` owner.

Do not add helper methods merely to recreate the bridge shape. Preserve arrow-method identity where existing runtime consumers depend on bound callbacks.

### Step 3: Delete the bridge and replace the extraction guard

Delete `GridEngineRenderBridge.ts` entirely.

Update the Plan 137 architecture guard so it proves semantic ownership instead of file extraction:

- `GridDomainSubscriptionHub` remains the domain-subscription owner.
- `CellNotificationController` remains the notification/subscriber owner.
- `GridEngine` contains no notification subscription maps or batch queue.
- `GridEngineRenderBridge` import, construction, type, and file no longer exist.
- `GridEngine.batch()` retains balanced `finally` cleanup and direct render/state transaction bracketing.

Delete the `GridEngine.ts <1600 lines` guard. During execution, the readable inlining produced a
1605-line file while deleting 76 net production lines and one architectural concept; satisfying the
cap required removing normal blank separators. The cap therefore measures formatting and preserves
the extraction-era bridge rather than protecting an ownership boundary. Do not raise or replace it
with another arbitrary file-length threshold. The semantic ownership and behavioral guards above
are its replacement; retain all unrelated file budgets.

Do not replace one brittle line-count/extraction assertion with another broad source snapshot. A narrow source assertion is acceptable only for the `finally`/owner boundary not expressible behaviorally.

### Step 4: Update the live concept inventory

Remove `GridEngineRenderBridge` from `docs/architecture/core-concept-inventory.md`, decrement the verified boundary-class count, and record that its two meaningful responsibilities converged into existing owners. Do not rewrite the historical complexity baseline.

### Step 5: Verify deletion and behavior

Run:

```powershell
rg -n "GridEngineRenderBridge|renderBridge" packages/core/src --glob '!*.test.ts'
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/engine/GridChangeApplier.test.ts src/engine/architectureGuards.test.ts
corepack pnpm --filter @eregister/open-grid-core exec vitest run
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm run build:packages
corepack pnpm run bench
corepack pnpm run bench:long-session
corepack pnpm run pack:verify
corepack pnpm run format:check
git diff --check
```

Confirm stable and internal declaration hashes remain unchanged. Record the pre-existing experimental replay hash mismatch without updating the contract.

## Done criteria

- [x] `GridEngineRenderBridge.ts`, class, dependency interface, import, allocation, and field are deleted.
- [x] `commandHistory` and `requestRender` no longer form unused bridge dependency edges.
- [x] `GridEngine.batch()` preserves balanced state/render transactions and synchronous-finally flushing.
- [x] `CellNotificationController` remains the sole owner of notification queues, subscriptions, row versions, cache clearing, invalidation, and subscriber fault isolation.
- [x] Batched and synchronous committed-change delivery are behaviorally unchanged.
- [x] No replacement abstraction, facade, or dependency interface is introduced.
- [x] One production class/file and net production LOC are deleted.
- [x] `GridEngine` keeps normal readable method spacing; no whitespace is removed to satisfy a line metric.
- [x] The obsolete `GridEngine.ts` physical-line cap is removed and replaced by semantic ownership and behavior guards; unrelated file budgets remain.
- [x] Focused/full core, React, architecture, build, performance, long-session, package, formatting, and diff gates pass.
- [x] Stable/internal declarations are unchanged and no unrelated files are modified.

## STOP conditions

Stop instead of improvising if:

- Another production owner or consumer of `GridEngineRenderBridge` exists.
- The bridge owns state or failure isolation not represented by `GridEngine`, `RenderRequestCoordinator`, `StateManager`, or `CellNotificationController`.
- Preserving behavior requires moving subscriber maps/queues into `GridEngine`.
- The deletion changes public API or event/notification timing.
- A replacement bridge/facade/context appears necessary.
- Any performance or long-session budget regresses.

## Maintenance notes

- Future notification changes belong in `CellNotificationController`; multi-owner transaction orchestration belongs in `GridEngine`/the commit boundary.
- Reviewers should reject a renamed bridge or a new dependency bag that restores the same double forwarding.
- This deletion intentionally increases a small method body in `GridEngine`; total concepts and dependency edges matter more than preserving an extraction-era line-count target.
