# Plan 166: Delete obsolete row-model capability artifacts

> **Executor instructions**: This is a dead-code deletion, not a capability redesign. Re-run every search against the live tree before editing. Delete only artifacts with zero production consumers and preserve the implemented infinite-row loading method and every public row-model behavior.
>
> **Drift check (run first)**: `git diff --stat -- packages/core/src/rowModel.ts packages/core/src/infiniteRowModel.ts packages/core/src/engine/architectureGuards.test.ts packages/core/src/rowModel.capabilities.test.ts`

## Status

- **State**: DONE in working tree on 2026-07-29
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plans 164 and 165
- **Category**: tech-debt
- **Planned in**: working tree, 2026-07-29

## Why this matters

Earlier write-path and viewport-loading migrations removed every production implementation or consumer of three row-model capability artifacts but left their declarations behind. They increase the vocabulary required to understand `rowModel.ts` and imply supported extension seams that no longer exist.

This slice deletes only proven dead artifacts:

- `CellValueWritableRowModel`: no production implementation and no production consumer.
- `asCellValueWritableRowModel`: no production caller.
- `asVisibleBlockLoadCapableRowModel`: no production caller after renderer loading migrated to `RowModelViewportAccess.ensureRange`.

`VisibleBlockLoadCapableRowModel` itself remains because `InfiniteRowModelController` still implements `loadVisibleBlocks` and focused capability tests exercise that behavior directly.

## Evidence to revalidate

Run repository-wide production and test searches before editing:

```powershell
rg -n "CellValueWritableRowModel|asCellValueWritableRowModel|asVisibleBlockLoadCapableRowModel|VisibleBlockLoadCapableRowModel|loadVisibleBlocks" . --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**'
```

At planning time:

- `CellValueWritableRowModel` and `asCellValueWritableRowModel` occur only at their definitions plus historical plan/guard references.
- `asVisibleBlockLoadCapableRowModel` occurs only at its definition plus negative architecture checks.
- `VisibleBlockLoadCapableRowModel` is referenced by `InfiniteRowModelController`; `loadVisibleBlocks` has direct capability/server-model tests.
- None of the three deletion targets is exported by the stable, experimental, or adapter-only package entrypoint.

## Scope

**In scope**:

- Delete `CellValueWritableRowModel` from `packages/core/src/rowModel.ts`.
- Delete `asCellValueWritableRowModel` from `packages/core/src/rowModel.ts`.
- Delete `asVisibleBlockLoadCapableRowModel` from `packages/core/src/rowModel.ts`.
- Remove or correct architecture assertions that mention only those deleted artifacts.

**Out of scope**:

- `VisibleBlockLoadCapableRowModel` and `InfiniteRowModelController.loadVisibleBlocks`.
- `AnyModelCellWritable`, `writeCellValueStructurally`, or canonical mutation execution.
- Adding, merging, renaming, or generalizing any row-model capability.
- Public API, runtime composition, renderer, diagnostics, React, or demo changes.
- Updating API baselines to absorb unrelated experimental declaration drift.

## Steps

### Step 1: Prove the targets are dead

Run the evidence search and classify every match as definition, production implementation, production consumer, test, guard, or historical documentation.

**STOP** if any supported production consumer or implementation exists outside the definitions.

### Step 2: Delete only the obsolete artifacts

Remove the dead interface and two dead adapter functions from `rowModel.ts`. Do not create replacements and do not alter implemented row-model methods.

**Verify**:

```powershell
rg -n "CellValueWritableRowModel|asCellValueWritableRowModel|asVisibleBlockLoadCapableRowModel" packages/core/src --glob '!*.test.ts'
rg -n "VisibleBlockLoadCapableRowModel|loadVisibleBlocks" packages/core/src/infiniteRowModel.ts packages/core/src/rowModel.ts
```

The first search must return no matches; the second must continue proving the live infinite capability.

### Step 3: Keep guards semantic and narrow

Delete stale assertions whose only purpose was to mention a removed adapter. Preserve guards proving renderer viewport loading uses `ensureRange` and does not call `loadVisibleBlocks` directly. Do not add source snapshots or line-count rules.

### Step 4: Verify behavior and packaging

Run:

```powershell
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.capabilities.test.ts src/serverRowModel.test.ts src/engine/architectureGuards.test.ts
corepack pnpm --filter @eregister/open-grid-core exec vitest run
corepack pnpm run build:packages
corepack pnpm run bench
corepack pnpm run bench:long-session
corepack pnpm run pack:verify
corepack pnpm run format:check
git diff --check
```

Confirm stable and internal declaration hashes remain unchanged. Record the already-known experimental replay contract mismatch separately; do not update it in this slice.

## Done criteria

- [x] The three deletion targets have zero live production definitions or references.
- [x] `VisibleBlockLoadCapableRowModel` and `loadVisibleBlocks` behavior remain intact.
- [x] No replacement type, adapter, abstraction, or public API is added.
- [x] Production concepts and LOC decrease.
- [x] Focused capability, server-model, architecture, full-core, build, performance, long-session, package, formatting, and diff gates pass.
- [x] No unrelated user or Plan 164/165 changes are modified.

## STOP conditions

Stop instead of broadening scope if:

- A production consumer or implementation of a deletion target is found.
- Type-checking requires changing a supported row-model implementation.
- Deletion changes a stable, experimental, or adapter-only exported symbol.
- A behavior gate requires removing or changing `loadVisibleBlocks`.
- Any fix would require a new capability abstraction.
