# Plan 140: Make Data Integrity Honest and Authoritative Across All Row Models

> **Executor instructions**: This plan is not asking you to fake full parity where the underlying row model cannot provide it. The goal is to replace partial, surprising behavior with an explicit authoritative contract: support the scope honestly, or fail early and clearly.
>
> **Drift check (run first)**: `git diff --stat 6a519297..HEAD -- packages/core/src/features/dataIntegrity packages/core/src/engine/GridEngine.ts packages/core/src/rowModel.ts packages/core/src/store.ts packages/core/src/state docs/architecture`
> If any in-scope file changed since this plan was written, compare the Current state excerpts below against the live code before proceeding. Any material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/138-canonical-data-write-pipeline.md`, `plans/135-streaming-and-integrity-convergence.md`
- **Category**: tech-debt
- **Planned at**: commit `6a519297`, 2026-06-26

## Why this matters

Integrity is now much more authoritative inside the client row model, but it is still only partially converged across infinite and server-page models. Today the runtime swaps in different providers by row-model type and many scopes return `unsupported` or `complete: false` after the feature is already active. That means advanced features can appear to work while silently degrading on the exact large-data/server scenarios where integrity matters most.

The grid does not need dishonest fake parity. It does need one explicit integrity capability contract that every row model satisfies, so the product either behaves authoritatively or rejects the unsupported combination up front.

## Current state

- `packages/core/src/engine/GridEngine.ts:453-483` selects one of three integrity row providers based on `rowModelConfig.type`
- `packages/core/src/features/dataIntegrity/GridIntegrityRowProvider.ts` contains three separate provider implementations:
    - `ClientGridIntegrityRowProvider`
    - `InfiniteGridIntegrityRowProvider`
    - `ServerPageGridIntegrityRowProvider`
- Non-client providers still degrade or reject common scopes:
    - `GridIntegrityRowProvider.ts:195-203` infinite `allRows` is unsupported and `loadedRows` is `complete: false`
    - `GridIntegrityRowProvider.ts:207-214` infinite `filteredRows` returns loaded blocks only and `complete: false`
    - `GridIntegrityRowProvider.ts:287-295` server-page `allRows` is unsupported and `currentPage` is `complete: false`
    - `GridIntegrityRowProvider.ts:298-305` server-page `filteredRows` returns only current page and `complete: false`
- The integrity manager tests currently exercise the client provider shape:
    - `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts:55-58` constructs `ClientGridIntegrityRowProvider`
- The engine’s integrity row patch path is also row-model-relative:
    - `packages/core/src/engine/GridEngine.ts:484-490` reads the current row and converts the patch into `applyTransaction({ update: [...] })`
- The architecture constitution is stale on validation ownership:
    - `docs/architecture/core-target.md:90` and `docs/architecture/core-target.md:310` still reference `ValidationManager`, which no longer exists

### Relevant repo conventions

- Recent integrity work moved authority into `GridState.integrity` and typed integrity domain mutations; continue that direction rather than reintroducing module-local shadow state.
- Row-model feature differences are already expressed as explicit capability splits in `packages/core/src/store.ts:141-144`; integrity needs the same honesty.
- Architecture docs in `docs/architecture/core-target.md` are treated as normative and should not remain stale once ownership changes.

## Commands you will need

| Purpose                 | Command                                                                                                                                                                                                                        | Expected on success |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Architecture gate       | `corepack pnpm run test:architecture`                                                                                                                                                                                          | exit 0              |
| Core tests              | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                                                                        | exit 0              |
| Workspace tests         | `corepack pnpm run test`                                                                                                                                                                                                       | exit 0              |
| Build/typecheck         | `corepack pnpm run build`                                                                                                                                                                                                      | exit 0              |
| Focused integrity tests | `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts packages/core/src/store.test.ts packages/core/src/rowModel.capabilities.test.ts` | all pass            |

## Scope

**In scope**

- `packages/core/src/features/dataIntegrity/**`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/store.ts`
- `packages/core/src/state/**` only where needed for explicit integrity capability/state expression
- `packages/core/src/store.test.ts`
- `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts`
- `packages/core/src/rowModel.capabilities.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- `docs/architecture/core-target.md`

**Out of scope**

- Building a brand-new server-side integrity service/protocol beyond what is necessary to express honest capability boundaries
- Pretending that infinite/server-page models can provide full-dataset guarantees they do not have
- New integrity product features unrelated to parity/authority

## Git workflow

- Branch: `advisor/140-row-model-integrity-parity`
- Match the repo’s recent commit style from `git log`
- Do not push or open a PR unless the operator explicitly asks

## Steps

### Step 1: Define the authoritative integrity capability matrix

Introduce an explicit capability contract for integrity scopes across row models. At minimum cover:

- `allRows`
- `loadedRows`
- `filteredRows`
- `visibleRows`
- `currentPage`
- `selectedRows`
- `serverProvided`

For each row model, encode whether the scope is:

- authoritative and complete
- authoritative but intentionally partial with explicit semantics
- unsupported and must be rejected up front

Do not leave this knowledge hidden in provider branch behavior alone.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Replace provider branching with one explicit capability-driven contract

Refactor the provider setup so integrity no longer depends on three ad hoc provider classes with overlapping logic and silent semantic drift. The likely target is one integrity row-access contract driven by row-model capabilities and/or row-model adapters.

It is acceptable to keep multiple implementations internally if the public/runtime contract becomes single, explicit, and testable. It is not acceptable to keep three behaviorally drifting providers with no shared authority model.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 3: Fail early for unsupported integrity/row-model combinations

Unsupported combinations should be surfaced before the user relies on them, not only when a specific scope is queried deep inside the feature. Add explicit gating for impossible combinations such as:

- full-dataset integrity scan on infinite/server-page without authoritative server-provided backing
- integrity operations that require absent row data

Use existing capability/result patterns rather than console warnings or best-effort silent fallbacks.

If partial semantics are kept for some scopes, make the partiality explicit in diagnostics and API results so consumers cannot confuse them with complete scans.

**Verify**: `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts packages/core/src/rowModel.capabilities.test.ts` -> all pass

### Step 4: Align live-stream row patching and integrity writes with the honest capability contract

Review integrity write paths such as `commitCellValue` and `applyRowPatch` against the new matrix. Ensure they do not assume row-model capabilities that the current model cannot honestly provide.

If a write path is only valid when the row is currently loaded/current-page, encode that as part of the contract and tests. If a row patch path is unsupported for a model/scope, reject it explicitly rather than pretending it applied authoritatively.

**Verify**: `corepack pnpm run test` -> exit 0

### Step 5: Expand integrity regression coverage to non-client row models

Add focused tests for infinite and server-page integrity behavior. At minimum cover:

- supported scope success cases
- unsupported scope rejection cases
- partial/complete reporting correctness
- integrity diagnostics surfacing the contract honestly
- integrity write/patch behavior on loaded vs unavailable rows

The current suite is too client-centered; parity and honest failure behavior must be test-backed.

**Verify**: `C:\Users\rishi\witbybit\open-grid\node_modules\.bin\vitest.cmd run packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts packages/core/src/store.test.ts packages/core/src/rowModel.capabilities.test.ts` -> all pass

### Step 6: Update the normative architecture docs and guards

Bring `docs/architecture/core-target.md` back in sync with the live integrity/validation ownership model. Remove stale `ValidationManager` references and document the real owner(s) for validation/integrity state.

Add architecture guards proving:

- docs no longer reference the deleted validation owner
- integrity setup uses the explicit capability contract
- non-client integrity behavior is not silently widened back into best-effort fake completeness

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Extend `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.test.ts` beyond the client-provider fixture to cover infinite and server-page cases.
- Add capability/contract tests in `packages/core/src/rowModel.capabilities.test.ts` for integrity scope support and rejection behavior.
- Add one or two higher-level `store.test.ts` regressions that prove unsupported integrity/row-model combinations fail early and clearly.
- Keep the existing client-authority tests green while broadening coverage.

## Done criteria

- [ ] Integrity scope support is expressed as one explicit capability contract across row models
- [ ] Unsupported integrity/row-model combinations fail early instead of silently degrading late
- [ ] Partial results remain only where explicitly documented and surfaced as partial
- [ ] Non-client row models have dedicated integrity regression coverage
- [ ] `docs/architecture/core-target.md` no longer references the deleted `ValidationManager` owner and reflects the live integrity/validation architecture
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0

## STOP conditions

- The correct product expectation for infinite/server-page integrity is fundamentally under-specified and the operator wants a product decision before encoding the capability matrix
- Achieving honest parity would require a new server protocol or datasource contract not currently present in the repo
- A supposedly “partial but authoritative” scope cannot actually be made unambiguous to API consumers; if so, reject it rather than shipping a misleading contract

## Maintenance notes

- Any future integrity feature should declare which row-model capability levels it requires before implementation starts.
- Reviewers should be suspicious of any new integrity scope that defaults to visual-row scanning for convenience.
- If full-dataset integrity on server/infinite is added later, it should arrive as a deliberate capability expansion with explicit server/data-source contracts and tests.
