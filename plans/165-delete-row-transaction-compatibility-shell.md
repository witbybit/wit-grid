# Plan 165: Delete the duplicate row-transaction compatibility shell

> **Executor instructions**: Follow this plan exactly in an isolated worktree. This is a deletion and convergence change, not a row-model feature. Preserve the stable `GridApi.applyTransaction()` behavior while removing the internal transaction path that duplicates structural-write lifecycle ownership. Run every gate and stop at the stated conditions.
>
> **Drift check (run first)**: `git diff --stat faf29558..HEAD -- packages/core/src/rowModel.ts packages/core/src/engine/GridDomainMutation.ts packages/core/src/engine/architectureGuards.test.ts packages/core/src/rowModel.test.ts packages/core/src/engine/GridChangeApplier.test.ts`
> If the cited interfaces, client compatibility shell, or row-transaction executor changed, stop and re-audit before editing.

## Status

- **State**: DONE in working tree on 2026-07-29
- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/164-core-simplicity-ownership-and-deletion-baseline.md`
- **Category**: tech-debt
- **Planned at**: commit `faf29558`, 2026-07-28

## Why this matters

Client row transactions currently have two internal lifecycle paths. The canonical commit-owned path calls `applyTransactionStructurally()`, applies formula/value-getter effects through `DataMutationController`, classifies visual impact, reconciles the projection, publishes events, and records history in `GridDomainMutation`. A second `ClientRowModelController.applyTransaction()` compatibility shell independently performs formula invalidation, notifications, impact classification, projection refresh, and row-event dispatch.

Only the client row model implements the transaction snapshot contract, and the production row-transaction executor already detects and uses the structural client path. Keeping the fallback shell means two places can decide transaction side effects and forces `TransactionalRowModel` and `ClientStructuralRowModel` to describe overlapping capabilities. Delete the shell and make the structural client contract the sole internal transaction authority while preserving the public API.

## Current state

### Overlapping internal contracts

`packages/core/src/rowModel.ts:313-327` defines `ClientStructuralRowModel` with:

- `applyTransactionStructurally()`
- `reconcileAfterDataWrite()`
- `classifyFieldMutation()`
- other structural writes

`packages/core/src/rowModel.ts:396-407` separately defines `RowModelTransactionSnapshot` and `TransactionalRowModel`, whose methods are:

- `captureTransactionSnapshot()`
- `applyTransaction()`
- `restoreTransactionSnapshot()`

`packages/core/src/rowModel.ts:478-481` duck-types `asTransactionalRowModel()` using that second protocol.

Only `ClientRowModelController` implements `captureTransactionSnapshot()` and `restoreTransactionSnapshot()` in production. Infinite and server-side row models do not implement this protocol and public transactions are already rejected for them.

### Duplicate lifecycle implementation

`packages/core/src/rowModel.ts:1396-1424` implements `collectCommittedCellChanges()`. It independently:

- synchronizes formulas,
- finds value-getter dependents,
- invalidates formula dependents,
- and builds the notification map.

`packages/core/src/rowModel.ts:1601-1635` labels `applyTransaction()` a “Compatibility shell only” and then independently:

- calls the structural write,
- invokes `collectCommittedCellChanges()`,
- notifies bulk cell subscribers,
- classifies the mutation,
- reconciles the row projection,
- dispatches row-update events,
- and returns the transaction result.

The canonical path already performs these responsibilities in `packages/core/src/engine/GridDomainMutation.ts:901-966`, using `applyTransactionStructurally()`, `context.applyStructuralWriteEffects`, `classifyFieldMutation()`, `reconcileAfterDataWrite()`, `createRowsUpdatedEvents()`, history commands, cell changes, and invalidations.

### Reachable fallback branch

`packages/core/src/engine/GridDomainMutation.ts:867-1001` first validates `TransactionalRowModel`, then separately checks `asClientStructuralRowModel()`. Lines 916-966 execute the canonical structural client path. Lines 968 onward call the compatibility `transactionalRowModel.applyTransaction()` fallback.

Repository-wide production search at the planned commit shows:

- `GridDomainMutation.ts:968` is the only production caller of a row model's `applyTransaction()`.
- `ClientRowModelController` is the only production implementation of transaction capture/restore.
- Public `GridApi.applyTransaction()` flows through runtime composition -> `GridStore` -> `GridEngine` -> `GridChangeApplier` -> `GridDomainMutation`; that public surface remains untouched.

## Target state

- `ClientStructuralRowModel` is the one internal client transaction capability.
- It includes transaction snapshot capture/restore alongside structural mutation and reconciliation.
- `TransactionalRowModel`, `asTransactionalRowModel()`, `getTransactionalRowModel()`, `ClientRowModelController.applyTransaction()`, and `collectCommittedCellChanges()` no longer exist.
- `GridDomainMutation` has one row-transaction branch: validate the structural client capability, capture/restore through it, apply structurally, run commit-owned effects, reconcile once, publish once.
- Infinite and server-side row models continue returning the same public unsupported/null behavior.
- No public or experimental export changes.

## Commands you will need

| Purpose           | Command                                                                                                                      | Expected on success                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Focused row model | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/engine/GridChangeApplier.test.ts` | exit 0                                                                   |
| Architecture      | `corepack pnpm run test:architecture`                                                                                        | exit 0, or only the recorded Plan 164 replay-scheduler baseline mismatch |
| Adversarial       | `corepack pnpm run test:adversarial`                                                                                         | exit 0                                                                   |
| Core test         | `corepack pnpm --filter @eregister/open-grid-core test`                                                                      | exit 0, except no accepted baseline weakening                            |
| Build             | `corepack pnpm run build:packages`                                                                                           | exit 0                                                                   |
| API               | `corepack pnpm run api:check`                                                                                                | exit 0, no contract drift                                                |
| Performance       | `corepack pnpm run bench`                                                                                                    | exit 0                                                                   |
| Long session      | `corepack pnpm run bench:long-session`                                                                                       | exit 0                                                                   |
| Package           | `corepack pnpm run pack:verify`                                                                                              | exit 0                                                                   |
| Formatting        | `corepack pnpm exec prettier --check packages/core/src/rowModel.ts packages/core/src/engine/GridDomainMutation.ts`           | exit 0                                                                   |
| Diff hygiene      | `git diff --check`                                                                                                           | no output, exit 0                                                        |

## Scope

**In scope**:

- `packages/core/src/rowModel.ts`
- `packages/core/src/engine/GridDomainMutation.ts`
- Existing focused tests directly covering row transactions, commit rollback, formula invalidation, notifications, capability rejection, and architecture boundaries
- `packages/core/src/engine/architectureGuards.test.ts` only to delete or replace assertions tied to removed symbols

**Out of scope**:

- Public `GridApi.applyTransaction()` or its result shape
- `GridStore`, runtime composition, React, demo, renderer, Flight Recorder, or replay changes
- New row-model capabilities
- Incremental grouping/filtering/sorting work
- Renaming unrelated row-model interfaces
- General `rowModel.ts` decomposition
- Broad architecture-guard cleanup

## Git workflow

- Branch: `codex/165-delete-row-transaction-compatibility-shell`
- Commit message: `Delete duplicate row transaction path`
- Do not push or open a PR unless instructed.
- Do not commit Plan 164 evidence artifacts or unrelated user changes.

## Steps

### Step 1: Strengthen characterization around the one canonical path

Before deleting code, ensure existing tests prove all externally observable transaction behavior through `GridApi`/`GridEngine`, not by calling `ClientRowModelController.applyTransaction()` directly.

Required cases:

- Mixed add/update/remove returns the same node transaction.
- Updates feeding formulas and declared value getters notify each affected cell exactly once.
- Aggregate/sort/filter/group-key impact still produces the expected refresh and invalidations.
- Undo and redo restore row data, formulas, projection order, events, and domain versions.
- A failed commit restores the captured snapshot and emits no committed side effects.
- Infinite and server-side modes reject or return `null` exactly as before.
- Flight Recorder correlation remains on the public commit path; no duplicate row event is recorded.

If a test calls the compatibility shell directly, rewrite it through the canonical public/engine boundary unless it is specifically characterizing structural storage mutation.

**Verify**: focused row-model and `GridChangeApplier` tests pass before production deletion.

### Step 2: Make the structural client capability complete

In `rowModel.ts`:

1. Move `captureTransactionSnapshot()` and `restoreTransactionSnapshot()` into `ClientStructuralRowModel`.
2. Retain `RowModelTransactionSnapshot`; it remains the rollback value contract.
3. Remove `TransactionalRowModel`.
4. Extend the `asClientStructuralRowModel()` duck-type check with capture and restore methods.
5. Remove `asTransactionalRowModel()`.

Do not add a replacement interface with a new name. The goal is one fewer overlapping capability.

**Verify**: TypeScript build reaches only expected `GridDomainMutation` call-site errors before Step 3; no public API file changes.

### Step 3: Collapse the row-transaction executor to one branch

In `GridDomainMutation.ts`:

1. Remove imports and helpers for `TransactionalRowModel`/`asTransactionalRowModel`.
2. Validate row transactions with `asClientStructuralRowModel()`.
3. Capture and restore snapshots through that same validated structural model.
4. Keep the existing structural apply/effects/classification/reconciliation/event/history branch.
5. Delete the fallback call to `transactionalRowModel.applyTransaction()` and its duplicate invalidation/event/history result construction.
6. Preserve rejection wording if it is public/tested unless changing it to “client structural row model” materially improves accuracy and all public behavior remains stable.

Avoid repeated duck-typing inside one prepared transaction: resolve the capability at validation/prepare time if lifecycle safety permits, or use one small typed helper. Do not introduce a new context or controller.

**Verify**: focused row-model and commit tests pass; `rg "TransactionalRowModel|asTransactionalRowModel|transactionalRowModel\.applyTransaction" packages/core/src` returns no production matches.

### Step 4: Delete the compatibility shell and duplicate effects

In `ClientRowModelController`:

1. Delete `collectCommittedCellChanges()`.
2. Delete public/internal `applyTransaction()` from the controller.
3. Retain `applyTransactionStructurally()`, snapshot capture/restore, and reconciliation.
4. Remove imports/runtime-port methods used only by the deleted shell if repository-wide search proves they have no other production caller. Do not broaden this into runtime-port cleanup.

The controller must no longer dispatch transaction events, notify bulk cells, or perform formula side effects outside the commit-owned path.

**Verify**: search proves only `GridDomainMutation` owns transaction lifecycle calls; focused tests and architecture tests pass.

### Step 5: Replace brittle guards with the semantic invariant

Delete architecture assertions that require the compatibility symbol or fallback branch. Add or retain one semantic guard proving:

- `ClientRowModelController` exposes structural transaction write + capture/restore but no lifecycle-owning `applyTransaction()` method.
- `GridDomainMutation` does not call `.applyTransaction(mutation.transaction)` on a row model.
- Public `GridEngine.applyTransaction()` still commits a `row-transaction` domain mutation.

Prefer an import/type/behavior test. If the existing architecture suite uses source checks for this exact boundary, a narrow negative check is acceptable; do not add broad snapshots or line-count assertions.

**Verify**: `test:architecture` passes.

### Step 6: Prove behavior, performance, and deletion

Run all listed gates. Compare against the planned baseline:

- Production LOC and symbols must decrease.
- No new production file, interface, controller, bridge, or compatibility path may be added.
- Package/API output must not change.
- Recorder and replay tests that cover row transactions must pass.
- Mutation and long-session budgets must not regress.

Record the exact deleted production symbols and net production line change in the completion report.

## Test plan

- Use `rowModel.test.ts` transaction tests for storage/projection behavior.
- Use `GridChangeApplier.test.ts` for commit ordering, rollback, event isolation, history, and failure cases.
- Use existing architecture guards for canonical mutation ownership.
- Add a focused integration test only if no existing test observes formula dependents plus cell notifications through public `applyTransaction()`.
- Do not preserve direct tests of the deleted compatibility method.

## Done criteria

- [x] Public `GridApi.applyTransaction()` behavior and types are unchanged.
- [x] `TransactionalRowModel` and `asTransactionalRowModel()` are deleted.
- [x] `ClientRowModelController.applyTransaction()` compatibility shell is deleted.
- [x] `collectCommittedCellChanges()` duplicate effect path is deleted.
- [x] `GridDomainMutation` contains one structural client transaction path and no fallback lifecycle path.
- [x] Formula/value-getter effects, cell notifications, row events, invalidations, history, rollback, domain versions, and recorder evidence occur exactly once.
- [x] Infinite/server transaction behavior is unchanged.
- [x] Net production LOC and internal protocol count decrease; no new production abstraction is introduced.
- [x] All listed correctness, architecture, performance, package, and build gates pass; stable/internal declarations are unchanged and the unrelated experimental contract drift is documented.
- [x] `git diff --check` passes and no out-of-scope production files changed.

## STOP conditions

Stop and report instead of improvising if:

- Any non-client production row model implements or requires transaction snapshot/apply behavior.
- A supported internal consumer calls `ClientRowModelController.applyTransaction()` outside `GridDomainMutation`.
- Removing the fallback changes the stable public API or requires edits to React/demo/renderer code.
- The structural path does not preserve a behavior that the compatibility path uniquely provides.
- Correctness requires adding another transaction interface, controller, event path, or mirrored state owner.
- Any performance or long-session budget regresses.
- More than the bounded in-scope vertical path must change.

## Maintenance notes

- Future row models must not gain transactions by implementing an all-in-one lifecycle method. They should expose structural mutation facts while the commit boundary owns effects, events, invalidation, history, rollback, and diagnostics.
- Reviewers should verify deletion rather than accepting a renamed compatibility abstraction.
- This plan does not claim the whole mutation architecture is simple. It removes one proven duplicate authority and provides evidence for whether further convergence is justified.
