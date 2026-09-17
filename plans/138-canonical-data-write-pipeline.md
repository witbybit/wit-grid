# Plan 138: Make Every Data Mutation Flow Through One Canonical Write Pipeline

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report rather than improvising. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6a519297..HEAD -- packages/core/src/store.ts packages/core/src/engine packages/core/src/features packages/core/src/spreadsheet packages/core/src/rowModel.ts packages/core/src/api packages/core/src/state packages/core/src/renderer`
> If any in-scope file changed since this plan was written, compare the Current state excerpts below against the live code before proceeding. Any material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/131-commit-kernel-write-path-unification.md`
- **Category**: bug
- **Planned at**: commit `6a519297`, 2026-06-26

## Why this matters

The grid already moved much closer to a commit-kernel architecture, but it still does not have one truly canonical write lifecycle. `setCellValue`, `batchCellValues`, `applyTransaction`, `setRows`, `updateRows`, fill, paste, and integrity-driven patches are close cousins rather than one owned mutation pipeline. That leaves formulas, validation, value-getter invalidation, history, sort/filter reconciliation, and render invalidation vulnerable to drift whenever a new write source appears.

The operator explicitly wants either one pipeline for all writes or, if that is genuinely impossible, one shared post-write contract that keeps every write source behaviorally identical. This plan implements that rule as architecture, not convention.

## Current state

- `packages/core/src/store.ts` is the public write facade:
    - `store.ts:357` exposes `setCellValue`
    - `store.ts:365-368` exposes `batchCellValues`
    - `store.ts:825-839` exposes `setRows`, `updateRows`, and `applyTransaction`
- Paste and fill already route through `batchCellValues`, but only at the entrypoint level:
    - `packages/core/src/features/ClipboardController.ts:108` calls `this.c.batchCellValues(updates, 'paste')`
    - `packages/core/src/spreadsheet/fillRange.ts:52` calls `this.engine.batchCellValues(updates, 'fill')`
- Integrity row patches still compose their own write shape in the engine:
    - `packages/core/src/engine/GridEngine.ts:484-490` converts `applyRowPatch` into `this.applyTransaction({ update: [updated] })`
- The intended shared reconcile path exists:
    - `packages/core/src/rowModel.ts:1170-1240` defines `writeCellValueStructurally(...)` and `reconcileAfterDataWrite(...)`
- But a legacy competing path still remains in the client row model:
    - `packages/core/src/rowModel.ts:1416-1476` still contains `public applyTransaction = (...) => { ... }`
    - that method still owns notification, incremental/full rebuild decisions, and row-updated dispatch independently of the structural write contract
- Current regression coverage proves only part of the convergence:
    - `packages/core/src/store.test.ts:1436-1466` covers `setCellValue` sort-key reorder
    - `packages/core/src/store.test.ts:1470-1500` covers `applyTransaction({ update })` sort-key reorder
    - there is no equivalent gauntlet proving clipboard paste, fill, replaceRows/updateRows, and integrity row patches all share the same downstream lifecycle

### Relevant repo conventions

- The preferred architecture direction is “typed domain mutation -> commit kernel -> projection/invalidation”, not direct feature-local writes. Match the shape used in `packages/core/src/engine/GridDomainMutation.ts` and `packages/core/src/engine/GridChangeApplier.ts`.
- Architecture drift is enforced with source-based guards in `packages/core/src/engine/architectureGuards.test.ts`; when you establish a new ownership boundary, add a guard for it in the same style.
- Behavioral write regressions live in focused tests under `packages/core/src/store.test.ts`, `packages/core/src/fillRange.test.ts`, `packages/core/src/features/ClipboardController.test.ts`, and integrity tests under `packages/core/src/features/dataIntegrity/`.

## Commands you will need

| Purpose                   | Command                                                                                                                                                                                                                                                                   | Expected on success |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Architecture gate         | `corepack pnpm run test:architecture`                                                                                                                                                                                                                                     | exit 0              |
| Core tests                | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                                                                                                                   | exit 0              |
| Workspace tests           | `corepack pnpm run test`                                                                                                                                                                                                                                                  | exit 0              |
| Build/typecheck           | `corepack pnpm run build`                                                                                                                                                                                                                                                 | exit 0              |
| Focused write regressions | `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/store.test.ts packages/core/src/fillRange.test.ts packages/core/src/features/ClipboardController.test.ts packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts` | all pass            |

## Scope

**In scope**

- `packages/core/src/store.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/engine/GridDomainMutation.ts`
- `packages/core/src/features/DataMutationController.ts`
- `packages/core/src/features/ClipboardController.ts`
- `packages/core/src/spreadsheet/fillRange.ts`
- `packages/core/src/features/dataIntegrity/**`
- `packages/core/src/rowModel.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/fillRange.test.ts`
- `packages/core/src/features/ClipboardController.test.ts`
- `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`

**Out of scope**

- New product features on top of the write pipeline
- Server/infinite full-dataset parity work beyond what is needed to keep write lifecycle semantics honest
- Public API expansion unrelated to mutation ownership

## Git workflow

- Branch: `advisor/138-canonical-data-write-pipeline`
- Match the repo’s recent commit style from `git log`, e.g. `Plan 137 — ...`, `Harden ...`, `Mark plan ... complete`
- Do not push or open a PR unless the operator explicitly asks

## Steps

### Step 1: Publish the canonical write-entrypoint inventory and choose the ownership model

Create a small internal inventory of every production write source and the mutation primitive it is allowed to use. At minimum include:

- `setCellValue`
- `batchCellValues`
- `setRows`
- `updateRows`
- `applyTransaction`
- fill (`SpreadsheetFillEngine`)
- paste (`ClipboardController`)
- integrity `commitCellValue`
- integrity `applyRowPatch`
- undo/redo replay

Then choose one of two allowed end states and implement it consistently:

1. a single mutation primitive under the commit kernel for every source, or
2. multiple mutation primitives with one required shared post-write reconcile/publish contract

The preferred answer is (1). Only keep (2) if the code proves a single primitive would break legitimate row-model differences.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Delete the remaining legacy row-model-owned transaction lifecycle

Remove `ClientRowModelController.applyTransaction(...)` as an independent behavior owner, or reduce it to a narrowly documented compatibility shell that cannot diverge from the structural write contract.

After this step, incremental/full rebuild decisions, cell-change publication, value-getter-dependent invalidation, and row-updated dispatch must come from one shared reconcile/publish pipeline, not from one path for transactions and another for direct cell/batch writes.

If rollback support still needs snapshot restore methods on the row model, keep those; but do not keep a second “normal write” lifecycle just because rollback exists.

**Verify**: `rg --line-number "public applyTransaction =|notifyBulkCellChange\\(|dispatchRowsUpdated\\(" packages/core/src/rowModel.ts` -> only the intentionally retained, documented ownership sites remain

### Step 3: Centralize post-write side effects behind one shared reconcile contract

Make sure every write source reaches the same downstream stages, in the same order:

1. structural write
2. shared impact classification
3. shared row-model reconciliation
4. formula/value-getter invalidation
5. validation/integrity-visible state updates
6. event publication
7. history registration
8. render invalidation

This is the heart of the plan. The important outcome is that `paste`, `fill`, integrity writes, bulk row updates, and API writes stop being able to differ on any of those stages.

Do not let feature-local helpers secretly own one of these stages after the refactor.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 4: Route every production write source through the chosen canonical path

Update each write source to use only the approved mutation primitive(s):

- `ClipboardController` stays a thin collector and cannot own write-side semantics
- `SpreadsheetFillEngine` stays a thin collector and cannot own write-side semantics
- integrity `commitCellValue` and `applyRowPatch` must not reassemble bespoke write behavior
- `setRows`, `updateRows`, and `applyTransaction` must all prove they reach the same shared reconcile contract

If some source truly cannot use the single primitive, make it call the shared post-write contract directly and document why in code.

**Verify**: `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/store.test.ts packages/core/src/fillRange.test.ts packages/core/src/features/ClipboardController.test.ts packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts` -> all pass

### Step 5: Add a mutation-gauntlet regression suite

Add focused regression coverage that proves equivalent downstream behavior across different write sources. At minimum cover:

- sort-key field change via `setCellValue`
- sort-key field change via `applyTransaction({ update })`
- same logical change via paste batch
- same logical change via fill batch
- same logical change via integrity row patch or integrity cell commit
- formula dependency update after each path
- validation/integrity-visible outcome after each path
- one undo entry for each intended batched command shape

The test style should assert both user-visible state and lifecycle evidence where practical, not just final cell values.

**Verify**: `corepack pnpm run test` -> exit 0

### Step 6: Add architecture guards that prevent write-path drift from returning

Add guards that make the intended ownership mechanically enforceable. Examples:

- no feature module may call a legacy row-model public transaction writer directly
- no new production write source may bypass the canonical engine mutation path
- row-model files may expose structural write helpers and rollback helpers, but not a second normal public write lifecycle
- paste/fill/integrity modules may collect updates, but not publish bespoke write-side invalidation/event/history behavior

Prefer narrow, explanatory guards over broad line-budget assertions.

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Extend `packages/core/src/store.test.ts` with a write-parity section that compares lifecycle outcomes across `setCellValue`, `applyTransaction`, `updateRows`, and `setRows` where applicable.
- Extend `packages/core/src/fillRange.test.ts` to prove fill uses the same formula/sort/filter behavior as API edits.
- Extend `packages/core/src/features/ClipboardController.test.ts` to prove paste uses the same write result protocol and downstream behavior as API edits.
- Extend `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts` to prove integrity commits/patches produce the same downstream write semantics as first-party API writes.
- Use the existing regression structure in `packages/core/src/store.test.ts:1436-1500` as the pattern for sort/filter reconciliation assertions.

## Done criteria

- [ ] Every production data-write source is explicitly inventoried and routed through the canonical mutation path or the documented shared post-write contract
- [ ] `ClientRowModelController.applyTransaction(...)` no longer owns an independent normal-write lifecycle
- [ ] Formulas, validation/integrity state, event publication, history, and render invalidation are consistent across API write sources, paste, fill, and integrity-driven writes
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0
- [ ] No files outside the in-scope list are modified

## STOP conditions

- The live code already removed `ClientRowModelController.applyTransaction(...)` or moved its ownership elsewhere in a way that materially changes this plan’s assumptions
- A truly single primitive for every write source would break required row-model differences and the shared post-write contract cannot be made equivalent without a larger row-model redesign
- Validation or integrity currently depends on hidden side effects not expressible through the canonical write lifecycle; if so, stop and report those hidden dependencies before continuing

## Maintenance notes

- Any future feature that mutates cells or rows must declare which canonical mutation path it uses before implementation starts.
- Reviewers should treat any new feature-local invalidation/history/event logic after a write as a likely architecture violation.
- If a later feature introduces another data-write source, add it to the write-entrypoint inventory and mutation-gauntlet suite in the same change.
