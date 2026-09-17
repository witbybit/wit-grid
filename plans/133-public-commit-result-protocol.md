# Plan 133: Replace Void Mutations with a Public Commit Result Protocol

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. Stop and report if any step requires reintroducing deprecated or compatibility APIs.
>
> **Drift check (run first)**: `git diff --stat 6dac6c08..HEAD -- packages/core/src/api packages/core/src/store.ts packages/core/src/engine packages/core/src/features packages/react/src`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: `plans/132-authoritative-domain-state-closure.md`
- **Category**: tech-debt
- **Planned at**: commit `6dac6c08`, 2026-06-25

## Why this matters

Advanced grid features cannot rely on void mutation APIs once validation, capabilities, collaboration, formulas, and conflict resolution all share the same engine. Today integrity has to build a local commit wrapper because `GridApi.setCellValue` is not result-aware. A serious grid needs one public mutation contract whose outcomes are explicit, typed, and reusable by every feature path.

## Current state

- `GridApi.setCellValue` is void at `packages/core/src/api/GridApi.ts:437`.
- `GridApi.batchCellValues` is also void at `packages/core/src/api/GridApi.ts:444`.
- `GridCommitKernel` already has rich internal outcomes in `packages/core/src/engine/GridChangeApplier.ts:108-117`.
- `GridDataIntegrityManager` creates an internal `commitCellValue` wrapper because no public result-aware API exists: `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.ts:87-99`.
- This duplicates policy and blocks other serious features from sharing the same honest write contract.

## Commands you will need

| Purpose           | Command                                                 | Expected on success |
| ----------------- | ------------------------------------------------------- | ------------------- |
| Architecture gate | `corepack pnpm run test:architecture`                   | exit 0              |
| Core tests        | `corepack pnpm --filter @eregister/open-grid-core test` | exit 0              |
| Workspace tests   | `corepack pnpm run test`                                | exit 0              |
| Build/typecheck   | `corepack pnpm run build`                               | exit 0              |

## Scope

**In scope**

- `packages/core/src/api/GridApi.ts`
- `packages/core/src/store.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/features/**`
- Targeted React adapter updates if types require them
- Tests and architecture guards

**Out of scope**

- New mutation feature types beyond what is necessary for result-aware commands
- Temporary deprecated aliases or compatibility wrappers

## Steps

### Step 1: Define the public commit result model

Promote a public result type sourced from the commit kernel semantics. The public API should express at least:

- `applied`
- `noop`
- `rejected`
- `capabilityDenied`
- `validationFailed`
- `failed`

Map these honestly from kernel outcomes; do not collapse them back into booleans.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Replace void write APIs on the public surface

Replace or rename the advanced mutation APIs so the serious path is result-aware:

- `setCellValue` -> result-aware commit command
- `batchCellValues` -> result-aware batch command
- any similar advanced write API that currently drops commit outcome information

Because the operator explicitly requested no deprecated compatibility layer, remove the old void contract rather than keeping both surfaces around.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 3: Route all feature callers to the public result protocol

Update integrity, editing, fill, clipboard, streaming, and other feature callers to consume the result protocol directly. Delete local wrappers that convert kernel outcomes into feature-specific pseudo-results when they are no longer needed.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts` -> all pass

### Step 4: Make failure handling explicit at call sites

Audit all public write call sites and make each handle the new result explicitly. No caller should silently assume success after this change.

**Verify**: `corepack pnpm run test` -> exit 0

### Step 5: Add guardrails against void mutation regression

Add architecture guards proving that:

- public advanced write APIs are not void
- integrity does not recreate its own commit wrapper for cell writes
- feature modules check result status instead of relying on truthy/falsy success

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Add regression tests for:
    - successful single-cell commit
    - noop commit
    - rejected commit
    - validation failure
    - capability denial
    - failed-before-commit path surfaced honestly
- Add tests proving feature paths such as diff accept, conflict resolve, and edit commit consume the same result protocol.

## Done criteria

- [ ] The public mutation surface exposes typed commit results instead of void for advanced write paths
- [ ] No integrity-specific local commit wrapper remains where a public command should be used
- [ ] Feature callers handle result status explicitly
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0

## STOP conditions

- A required public API rename would cascade into generated or published package constraints the operator wants to handle separately
- A feature path genuinely needs richer result data than the kernel currently exposes; if so, enrich the shared protocol instead of inventing a local one

## Maintenance notes

- Any future write API should start from the public commit result protocol, not from a convenience void signature.
- Reviewers should reject new feature-local success wrapper abstractions around kernel writes unless they are purely presentational.
