# Plan 135: Delete Duplicate Streaming and Converge Integrity Runtime Paths

> **Executor instructions**: This plan is about deletion and convergence. Do not preserve both streaming implementations behind flags, aliases, or legacy exports. Pick the canonical engine, migrate callers, and remove the other one.
>
> **Drift check (run first)**: `git diff --stat 6dac6c08..HEAD -- packages/core/src/features/liveStream packages/core/src/features/dataIntegrity packages/core/src/insights packages/core/src/index.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/134-derived-projection-pipeline-reset.md`
- **Category**: tech-debt
- **Planned at**: commit `6dac6c08`, 2026-06-25

## Why this matters

Two live-stream engines with nearly identical batching, flashing, and patch-application logic are a direct violation of single ownership on a hot path. This is exactly the kind of duplication that causes subtle drift under production feature growth. The grid needs one streaming implementation, one decoration path, and one integrity runtime that every caller shares.

## Current state

- `GridTransactionStreamImpl` exists in `packages/core/src/features/liveStream/GridTransactionStream.ts:37-253`.
- `LiveStreamIntegrityModule` embeds a second stream engine in `packages/core/src/features/dataIntegrity/modules/LiveStreamIntegrityModule.ts:210-388`.
- Both own batching, pending cell maps, pending row maps, dirty-cell policy, flashing, timing, and diagnostics.
- Public exports still expose the old stream types via `packages/core/src/insights/liveStream.ts` and package barrels.

## Commands you will need

| Purpose           | Command                                                 | Expected on success |
| ----------------- | ------------------------------------------------------- | ------------------- |
| Architecture gate | `corepack pnpm run test:architecture`                   | exit 0              |
| Core tests        | `corepack pnpm --filter @eregister/open-grid-core test` | exit 0              |
| Workspace tests   | `corepack pnpm run test`                                | exit 0              |
| Build/typecheck   | `corepack pnpm run build`                               | exit 0              |

## Scope

**In scope**

- `packages/core/src/features/liveStream/**`
- `packages/core/src/features/dataIntegrity/modules/LiveStreamIntegrityModule.ts`
- `packages/core/src/features/dataIntegrity/GridDataIntegrityManager.ts`
- `packages/core/src/insights/liveStream.ts`
- `packages/core/src/index.ts`
- Related tests and architecture guards

**Out of scope**

- New streaming product features
- Temporary compatibility re-exports of the deleted implementation

## Steps

### Step 1: Choose the canonical streaming owner

Pick one implementation as the keeper based on architectural fit with the new authoritative integrity state. The likely winner is the integrity-owned stream path, but confirm against the live code before cutting.

Document the decision in the implementation with a short code comment or ADR-style note if the choice is non-obvious.

**Verify**: `corepack pnpm run build` -> exit 0

### Step 2: Move every caller to the canonical streaming engine

Migrate stream creation, diagnostics, flashing, dirty-cell handling, and row patch application to the canonical implementation. Any code that still imports the deleted implementation is a failure.

**Verify**: `rg --line-number "GridTransactionStreamImpl|features/liveStream/GridTransactionStream" packages/core/src` -> no production matches

### Step 3: Delete the duplicate implementation and dead exports

Remove the losing implementation, its tests, its re-export barrel, and any transitional wrappers. Update package exports to expose only the canonical streaming surface.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0

### Step 4: Unify stream decorations and diagnostics

Ensure flash decorations, skipped/conflict reporting, and stream diagnostics all flow through the same integrity-owned domain state and decoration pipeline. There should not be a second flash/stream decoration authority left behind.

**Verify**: `corepack pnpm run test` -> exit 0

### Step 5: Add guards against reintroducing a second stream engine

Add architecture guards preventing:

- a new `features/liveStream/` owner implementation from returning
- duplicate batching/stream state ownership in both integrity and non-integrity modules
- package barrels re-exporting deleted legacy stream owners

**Verify**: `corepack pnpm run test:architecture` -> exit 0

## Test plan

- Keep or rewrite the strongest batching/backpressure/flash tests around the canonical implementation.
- Add regression tests covering:
    - dirty cell skip
    - conflict creation
    - remote-wins commit
    - row patch apply
    - flash decoration lifecycle
- Confirm no behavior loss relative to the kept implementation.

## Done criteria

- [ ] Only one streaming engine exists in production code
- [ ] Streaming state and decorations flow through the canonical integrity path
- [ ] No legacy stream exports or shims remain
- [ ] `corepack pnpm run test:architecture` exits 0
- [ ] `corepack pnpm run test` exits 0
- [ ] `corepack pnpm run build` exits 0

## STOP conditions

- The two current implementations have materially different product semantics that need an operator decision before convergence
- External consumers rely on a deleted export surface in a way the operator wants handled as a separate breaking-release task

## Maintenance notes

- Any future stream enhancement must extend the canonical engine rather than spawning a specialized second one.
- Reviewers should treat any new pending-cell/pending-row batcher outside the canonical streaming owner as likely duplication.
