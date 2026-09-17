# Plan 132: Close Authoritative Domain State Under the Commit Kernel

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report rather than improvising.
>
> **Drift check (run first)**: `git diff --stat 6dac6c08..HEAD -- packages/core/src/features/dataIntegrity packages/core/src/state packages/core/src/api packages/core/src/engine packages/core/src/insights packages/react/src`
> If any in-scope file changed since this plan was written, compare the "Current state" section against the live code before proceeding. If the architectural role of any cited module has changed, stop and report.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/131-commit-kernel-write-path-unification.md`
- **Category**: tech-debt
- **Planned at**: commit `6dac6c08`, 2026-06-25

## Why this matters

Open Grid cannot claim a single source of truth while integrity-critical state still lives in feature-local `Map` and array fields outside `InternalGridState`. Conflicts, diff state, validation issues, live-stream diagnostics, and integrity summaries are user-visible, queryable, and renderer-visible, so they must participate in one owned snapshot model. This plan moves that state under the kernel so undo/redo, diagnostics, subscriptions, persistence policy, and future collaboration features all observe the same authority.

## Current state

- `packages/core/src/state/GridState.ts` defines the authoritative internal state slices and does not include any data-integrity domain state.
- `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.ts` owns mutable authoritative state in local fields:
    - `publishedIssues` map at `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.ts:67`
    - `serverReport` field at `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.ts:70`
    - `_summary` field at `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.ts:72`
- Integrity submodules also own durable state locally instead of in the kernel:
    - `ConflictIntegrityModule.conflicts` / `cellIndex` at `packages/core/src/features/dataIntegrity/modules/ConflictIntegrityModule.ts:31-32`
    - `DiffIntegrityModule.model` / `result` / `cellDiffMap` at `packages/core/src/features/dataIntegrity/modules/DiffIntegrityModule.ts:28-36`
    - `ValidationIntegrityModule.issues` / `cellErrorIndex` at `packages/core/src/features/dataIntegrity/modules/ValidationIntegrityModule.ts:36-40`
    - `LiveStreamIntegrityModule.streamIssues`, `flashCells`, and `activeStream` at `packages/core/src/features/dataIntegrity/modules/LiveStreamIntegrityModule.ts:39-43`
- `GridDataIntegrityManager` is currently an owner plus orchestrator plus API builder, which is too much authority for one feature shell.
- The repo constitution says mutable concerns must have one owner in core state and all other layers read projections from that owner: `docs/architecture/core-target.md`.
- Existing architectural enforcement style lives in `packages/core/src/engine/architectureGuards.test.ts`; match that style for any new guardrails.

## Commands you will need

| Purpose           | Command                                                 | Expected on success |
| ----------------- | ------------------------------------------------------- | ------------------- |
| Architecture gate | `corepack pnpm run test:architecture`                   | exit 0              |
| Core tests        | `corepack pnpm --filter @eregister/open-grid-core test` | exit 0              |
| Workspace tests   | `corepack pnpm run test`                                | exit 0              |
| Build/typecheck   | `corepack pnpm run build`                               | exit 0              |

## Scope

**In scope**

- `packages/core/src/state/GridState.ts`
- `packages/core/src/api/GridApi.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/features/dataIntegrity/**`
- `packages/core/src/insights/**`
- `packages/core/src/engine/architectureGuards.test.ts`
- Targeted tests in `packages/core/src/**/*.test.ts`

**Out of scope**

- New end-user integrity features
- Persistence to disk/server for integrity state
- React panel redesigns beyond what is required to consume the new authoritative state
- Any compatibility shim preserving the old module-local state shape

## Git workflow

- Work on the current branch unless the operator asks otherwise.
- Keep commits aligned to logical steps.
- Do not add compatibility layers, dual-write bridges, or deprecated aliases. Replace the old ownership model directly.

## Steps

### Step 1: Define a first-class integrity domain state slice

Add a dedicated integrity slice to `InternalGridState` in `packages/core/src/state/GridState.ts`. Include only authoritative, user-visible, kernel-owned state:

- validation issues/index
- diff model/result/indexes
- conflict registry/indexes
- live-stream session state and diagnostics
- published issues
- server report
- integrity summary

Do not store renderer-only flash timing handles or DOM-related state in `GridState`; keep physical concerns renderer-local.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Move integrity mutations onto typed commit-kernel changes

Introduce explicit integrity mutation types and commit reasons for every authoritative integrity state transition, such as:

- publish/clear issues
- set/clear diff model
- add/resolve/clear conflicts
- update validation results
- create/update/destroy live stream state
- publish server report
- recompute integrity summary

The rule is: if integrity state changes, it must happen through `GridCommitKernel`, not direct field mutation on managers or modules.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 3: Reduce managers/modules to pure domain services and projections

Refactor `GridDataIntegrityManager` and its modules so they no longer own authoritative state in local mutable collections. They should instead:

- read integrity domain state from the kernel
- compute pure results/projections
- dispatch typed integrity commits
- expose decorations derived from authoritative state

Delete the old local owner fields rather than mirroring them.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts` -> all pass

### Step 4: Rebuild the integrity summary from authoritative state

Make the summary a deterministic projection from integrity domain state, not a manager-maintained mutable cache. If caching is required, cache as derived state with explicit ownership and invalidation rules.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 5: Lock the boundary with architecture guards

Add guards proving that integrity modules no longer own authoritative mutable state outside `GridState`, for example:

- no `new Map()` / array-owned issue registries in integrity owner modules for durable state
- no direct stateful ownership fields like `publishedIssues`, `conflicts`, `cellDiffMap`, `issues`, `serverReport`, `_summary`
- integrity writes route through typed commit/kernel paths

Match the repository’s existing content-inspection guard style.

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Add focused tests proving integrity state can be observed from one canonical state snapshot after:
    - validation run
    - diff model set/clear
    - conflict add/resolve
    - live-stream state updates
    - server report publish/clear
- Add regression tests proving decorations and diagnostics are reconstructed from authoritative state after manager recreation.
- Add at least one architecture guard that fails if durable integrity state ownership returns to feature-local fields.

## Done criteria

- [ ] No durable integrity state is owned by mutable fields in `GridDataIntegrityManager` or integrity modules
- [ ] `InternalGridState` contains the authoritative integrity domain slice
- [ ] All integrity state transitions route through typed commit-kernel changes
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0

## STOP conditions

- Integrity state turns out to require persistence semantics that conflict with the current `GridModelState` vs `GridUIState` split
- A clean cut would require dual-writing old and new integrity owners for more than one short intermediate commit
- The React package depends on direct reads from deleted module-local structures in ways not captured by current tests

## Maintenance notes

- Future collaboration, devtools, and persistence work should extend the new integrity domain slice instead of reintroducing feature-local stores.
- Reviewers should scrutinize any remaining mutable collection in integrity modules and ask whether it is authoritative or merely ephemeral scratch state.
- This plan intentionally favors deletion over transitional compatibility; if a caller breaks, update the caller to the new authority instead of reviving the old one.
