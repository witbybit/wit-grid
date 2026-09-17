# Plan 156: Row Model Completion + Public RowNode Facade

> **Executor instructions**: This plan must be executed in phases. Do not jump straight to a public `GridRowNode` convenience API without first making row-model load state, async request ownership, and mutation semantics explicit. The goal is not to mimic AG Grid loosely; it is to provide AG Grid-class ergonomics without leaking internal mutable row-model state or bypassing Open Grid's commit, freshness, invalidation, validation, and integrity contracts.
>
> **Drift check (run first)**: `git diff --stat HEAD -- packages/core/src/rowModel.ts packages/core/src/rowNode.ts packages/core/src/infiniteRowModel.ts packages/core/src/serverPageRowModel.ts packages/core/src/api packages/core/src/state packages/core/src/renderer packages/core/src/features/dataIntegrity`
> If any in-scope seam changes materially while this plan is in progress, compare the checklist below against the live code before continuing. Any mismatch in public API, renderer expectations, or row-model semantics is a STOP condition until reconciled.

## Status

- **Status**: SUPERSEDED by Plan 158 (reconciled 2026-07-28)
- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: `plans/131-commit-kernel-write-path-unification.md`, `plans/138-canonical-data-write-pipeline.md`, `plans/140-row-model-integrity-parity.md`, `plans/153-feather-scroll-snapshot-program.md`
- **Category**: architecture
- **Planned at**: working tree, 2026-07-07

## Why this matters

Plans 154 and 155 made the renderer much more controller-first and semantically honest. The next architectural pressure point is the row-model layer: today the renderer still relies on row-model-specific seams, row load state is not first-class enough, and the public API still exposes `RowNode` as though it were safe to hand to consumers directly.

Open Grid should absolutely adopt RowNode-style ergonomics. Serious grid consumers expect it. But the exposed object must be a public facade that routes through the same row-model and commit contracts as the rest of the grid. Otherwise consumers can mutate row-model state directly and silently bypass versioning, invalidation, validation, integrity, and render-refresh ownership.

This plan completes the row-model contract across `client`, `infinite`, and `server-page`, then introduces a safe `GridRowNode` facade on top of that contract.

## North star

Final architecture must obey:

```txt
Renderer asks for visual rows and row/range load state.
Row model owns visual row projection.
Client row model owns full local dataset.
Infinite row model owns sparse block cache.
Server-page row model owns current page cache only.
Async requests are query-version/request-token guarded.
Loading/failed/placeholder rows are first-class visual rows.
Public GridRowNode is a facade, not an internal mutable node.
Unsupported operations fail explicitly and consistently.
Validation/integrity row operations route through existing authoritative feature owners.
Capabilities are truthful.
```

## Current state summary

- [packages/core/src/rowNode.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/rowNode.ts) is a mutable internal row wrapper with `id`, `data`, and a cell-value cache.
- [packages/core/src/rowModel.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/rowModel.ts) currently exposes that `RowNode` through `VisualRowModel.getRowNodeById`.
- [packages/core/src/api/GridApiSurfaces.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/api/GridApiSurfaces.ts) publicly exposes `getRowNodeById(rowId): RowNode | null`.
- [packages/core/src/state/GridState.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/state/GridState.ts) still uses `RowModelType = 'client' | 'infinite' | 'server'`, even though the implementation is really `server-page`.
- Infinite/server-page loading semantics are present but not unified behind one renderer-facing row/range load-state contract.
- Validation/integrity row operations already exist elsewhere in the system, but there is no safe row-node facade that routes into them.

## Scope

**In scope**

- `packages/core/src/rowModel.ts`
- `packages/core/src/rowNode.ts`
- `packages/core/src/infiniteRowModel.ts`
- `packages/core/src/serverPageRowModel.ts`
- `packages/core/src/api/**`
- `packages/core/src/state/**`
- `packages/core/src/renderer/**` where renderer contracts need updating
- `packages/core/src/features/dataIntegrity/**` only where row-node validation/integrity delegation must hook into existing owners
- `packages/core/src/engine/**` where row-model registration, invalidation, or request-token guards need updating
- `plans/README.md`

**Out of scope**

- Full SSRM implementation
- New grouping, pivot, AI, DevTools, or unrelated integrity product features
- New server commit protocols beyond honest capability expression and loaded-row/page patch semantics

## Phases

### Phase 1 - Honest naming and contract scaffolding

- [x] Add explicit internal row-model kind naming (`server-page` internally, compatibility alias only if required publicly)
- [x] Introduce `InternalRowModelKind`
- [x] Introduce `RowNodeKind` and `RowLoadState`
- [x] Split internal/public node concepts in types:
    - [x] internal mutable row node contract boundary identified and kept separate from new facade types
    - [x] public `GridRowNode` facade contract
- [x] Add `RowModelViewportAccess` interface skeleton
- [x] Add initial architecture guards preventing new full-SSRM naming drift

### Phase 2 - Internal row-node ownership split

- [x] Keep existing mutable row wrapper internal-only
- [x] Stop using the internal node type as a public API surface
    - [x] `DomCellRendererParams.node` narrowed to public row ref
    - [x] `ValueGetterParams.node` narrowed to public row ref
    - [x] Custom aggregation callbacks narrowed to public row refs
    - [x] `RowNodeTransaction` now returns public `GridRowNode` facades
- [x] Add a public-row-node factory/facade layer
- [x] Ensure facade properties are readonly snapshots/getters only
- [x] Ensure no facade method can mutate row arrays or row data directly

### Phase 3 - Public GridRowNode API surface

- [x] Add `api.getRowNode(rowId)`
- [x] Add `api.getDisplayedRowAtIndex(index)`
- [x] Add `api.getRowIndexById(rowId)`
- [x] Add `api.forEachNode(callback)`
- [x] Add `api.forEachDisplayedNode(callback)`
- [x] Add `api.getRowLoadState(index)`
- [x] Remove public `getRowNodeById` if blast radius is acceptably small

### Phase 4 - Row-model viewport/load contract

- [x] Implement `RowModelViewportAccess` on client row model
- [x] Implement `RowModelViewportAccess` on infinite row model
- [x] Implement `RowModelViewportAccess` on server-page row model
- [x] Add:
    - [x] `getKnownRowCount`
    - [x] `getEstimatedRowCount`
    - [x] `getRowCountKind`
    - [x] `getRowLoadState`
    - [x] `isRowLoaded`
    - [x] `isRowLoading`
    - [x] `isRowFailed`
    - [x] `isRangeLoaded`
    - [x] `getRangeLoadState`
    - [x] `ensureRange`

### Phase 5 - Visual row normalization

- [x] Normalize minimum visual row kinds:
    - [x] `data`
    - [x] `loading`
    - [x] `failed`
    - [x] `placeholder`
- [x] Ensure renderer can render loading/failed/placeholder rows without inferring from null data
- [x] Ensure server/infinite missing rows are represented honestly

### Phase 6 - Infinite block cache and request-token authority

- [x] Introduce `InfiniteBlockCache`
- [x] Replace ad hoc infinite loading state as source of truth
- [x] Add `RowModelQueryState`
- [x] Add `RowModelRequestToken`
- [x] Guard async result application on datasource generation, queryVersion, requestId, and block/page identity
- [x] Add stale-result tests

### Phase 7 - Sort/filter/query ownership hardening

- [x] Client sort/filter/query remains local pipeline-owned
- [x] Infinite sort/filter/query bumps queryVersion and resets/stales cache
- [x] Server-page sort/filter/query bumps queryVersion and resets to page 0
- [x] Add tests proving stale previous-query results are ignored

### Phase 8 - Honest mutation semantics per row model

- [x] Client row-node writes are fully local committed writes
- [x] Infinite row-node writes patch loaded cache rows only
- [x] Server-page row-node writes patch current loaded page rows only
- [x] Loading/failed/placeholder row nodes reject unsupported writes safely
- [x] Unsupported operations fail consistently through the existing result/error policy

### Phase 9 - Row selection scope honesty

- [x] Define explicit selection-scope behavior per row model
- [x] Reject `all` where the model cannot honestly provide it
- [x] Add scope tests for client, infinite, and server-page

### Phase 10 - Renderer integration migration

- [x] Renderer depends on `RowModelViewportAccess`, not model-specific APIs
- [x] Renderer uses `getRowLoadState` and `ensureRange`
- [x] Renderer does not inspect infinite block internals
- [x] Renderer does not infer loading from `getVisualRow(index) === null`

### Phase 11 - GridRowNode validation and integrity ergonomics

- [x] Add row-node validation/integrity helpers only if they route into existing authoritative owners
- [x] Capability-gate unsupported row-node validation/integrity actions
- [x] Keep them scoped to row-level operations, not new product features
- [x] Add tests proving they do not bypass the commit/invalidation/integrity pipeline

### Phase 12 - Verification and guardrails

- [x] Contract tests for all row models
- [x] Public row-node facade tests
- [x] Infinite cache tests
- [x] Query token tests
- [x] Renderer integration tests
- [x] Mutation semantics tests
- [x] Selection scope tests
- [x] Architecture guards for public facade and viewport access usage

## Initial execution checklist

- [x] Create this plan and keep it updated as phases land
- [x] Land Phase 1 scaffolding with the smallest safe public/internal type split
- [x] Build after Phase 1
- [x] Add/update tests with each phase instead of backfilling at the end

## Progress notes

- 2026-07-07: Plan created. Phase 1 execution started.
- 2026-07-07: Phase 1 scaffolding landed. Added `InternalRowModelKind`, `RowNodeKind`, `RowLoadState`, `RowRangeLoadState`, `RowCountKind`, `RowModelViewportAccess`, and a new public `GridRowNode` facade contract. Public compatibility type `RowModelType = 'client' | 'infinite' | 'server'` remains unchanged for now, but `GridState` now documents that `'server'` maps to the server-page model rather than full SSRM. `corepack pnpm --filter @eregister/open-grid-core build` passed.
- 2026-07-07: First compatibility bridge landed for the public facade. `GridApiSurfaces` now includes `getRowNode`, `getDisplayedRowAtIndex`, `getRowIndexById`, `forEachNode`, `forEachDisplayedNode`, and `getRowLoadState`. `GridStore` now creates `GridRowNode` facades through `createGridRowNodeFacade(...)`, and plugin runtime passthroughs were updated. This is still an intermediate bridge: `getRowNodeById` remains public compatibility, and row-model-aware load/failure/placeholder semantics are not complete yet. `corepack pnpm --filter @eregister/open-grid-core build` and `corepack pnpm --filter @eregister/open-grid-core test` passed.
- 2026-07-07: Public `getRowNodeById` removal and Phase 2 surface shrink are in progress. `GridApiSurfaces`, plugin/runtime composition, and `rows().getNodeById(...)` now point at `GridRowNode` facades instead of the internal mutable node. `GridCellAccess.node` and `GridCellClickParams.node` now also return `GridRowNode` facades, and `getDataRowNodeAtVisualIndex(...)` has been removed from the public API facade. Renderer/portal internals still intentionally use `RowNode` for now. Verification passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Continued Phase 2 shrink in `@eregister/open-grid-react`. The portal layer no longer imports the exported internal `RowNode` type from `@eregister/open-grid-core`; it now uses a local minimal `PortalRowNodeLike` contract (`id` + `data`) while preserving the same runtime object identity and behavior. Verification again passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: `GridEventName.rowsUpdated` now exposes public `GridRowNode` facades instead of raw internal `RowNode[]`. Row-model and mutation internals still emit raw nodes through a dedicated internal dispatch payload, and `GridEngine` converts them at the dispatch boundary via `publicRowNodeDispatch.ts`. Added a regression proving event listeners receive facades, and kept the architecture guard green by extracting the bridge out of `GridEngine.ts`. Verification passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Removed the direct public `RowNode` runtime export from `@eregister/open-grid-core`. The public export snapshot in `boundary.test.ts` was updated accordingly, and React-side tests that previously imported the internal class now use local row-shaped helpers instead. Verification again passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Narrowed `DomCellRendererParams.node` to a public `DomCellRendererRowRef` (`id` + `data`) instead of the internal mutable `RowNode` type. Internal renderer managers still pass the same runtime object via structural compatibility, so behavior did not change. Verification again passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Closed the next larger public RowNode leaks coherently. Added `GridRowDataRef` for callback-style row references, switched `ValueGetterParams.node` and custom aggregation callbacks to that public ref, and split transaction ownership so row models still return internal `RowNode[]` internally while `GridEngine.applyTransaction(...)` maps them to public `GridRowNode` facades before the API boundary. Added regressions proving `valueGetter`, aggregation callbacks, `rowsUpdated`, and `applyTransaction` do not leak mutable internal row nodes. Verification passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, `corepack pnpm --filter @eregister/open-grid-react build`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Phase 2 can now be treated as complete from the public-boundary standpoint. The remaining raw `RowNode` seams are internal row-model/query/storage contracts rather than consumer-facing leaks. Started landing Phase 4 for real by making `RowModel` extend `RowModelViewportAccess` and implementing `getKnownRowCount`, `getEstimatedRowCount`, `getRowCountKind`, `getRowLoadState`, `isRowLoaded`, `isRowLoading`, `isRowFailed`, `isRangeLoaded`, `getRangeLoadState`, and `ensureRange` across client, infinite, and server-page row models. Added failure-state tracking for infinite block loads, server-page viewport/load-state regressions, a minimal-row-model test helper update, and an architecture guard asserting the stronger viewport/load contract. Verification passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, `corepack pnpm --filter @eregister/open-grid-react build`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Began Phase 5 visual-row normalization. Added first-class `FailedVisualRow` and `PlaceholderVisualRow` types to the shared visual-row vocabulary, taught row slots / portal identity / row presentation / store facades about them, and made infinite + server-page row models emit explicit failed visual rows instead of only reporting failure through load-state side channels. React row portals now have default failed/placeholder renderers, and focused regressions prove the renderer/store/public node surface sees failed rows directly. Verification passed with `corepack pnpm --filter @eregister/open-grid-core build`, `corepack pnpm --filter @eregister/open-grid-core test`, `corepack pnpm --filter @eregister/open-grid-react build`, and `corepack pnpm --filter @eregister/open-grid-react test`.
- 2026-07-07: Landed the first coherent Phase 6/7 hardening slice. Added shared `RowModelQueryState` and `RowModelRequestToken` types, replaced the old single `requestGeneration` guards in infinite and server-page row models with explicit datasource-generation/query-version request authority, and wired `queryModelChanged` into both async models so stale previous-query results are dropped the same way as stale sort/filter results. Extended the adversarial stale-response suite to churn `queryModel` as well. Focused verification passed with `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.adversarial.test.ts src/query/queryModel.test.ts` and `corepack pnpm --filter @eregister/open-grid-core build`.
- 2026-07-07: Completed the remaining Phase 6 infinite-cache slice. `InfiniteRowModelController` now owns block loading/failure/known-row-count state through a dedicated internal `InfiniteBlockCache` instead of scattered `loadingBlocks` / `failedBlocks` / `hasKnownTotalCount` flags. Added a regression proving `purgeCache()` clears failed-block and known-count authority before refetching. Focused verification passed with `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts` and `corepack pnpm --filter @eregister/open-grid-core build`.
- 2026-07-07: Completed Phase 9 selection-scope honesty. Client row selection kept its richer `page` / `filtered` / `all` behavior, while infinite now explicitly exposes only loaded-cache selection (`page` aliases to loaded, `all`/`filtered` return empty) and server-page now explicitly exposes only current-page selection (`loaded` aliases to page, `all`/`filtered` return empty). Added direct scope regressions for infinite and server-page selection. Focused verification passed with `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.capabilities.test.ts src/features/RowSelectionFeatureController.test.ts` and `corepack pnpm --filter @eregister/open-grid-core build`.
- 2026-07-08: Completed the next coherent Phase 8/11 row-node facade slice. Public `GridRowNode` row writes now route through canonical cell-write batching instead of pretending row transactions exist on every row model, so client writes remain local commits while infinite/server-page writes honestly patch only loaded/current-page rows. Added row-node validation/integrity helpers (`getValidationState`, `getIntegrityIssues`, `validate`, `refreshIntegrity`) that delegate to the existing integrity API, made group/detail expansion delegate to the existing grouping owner, and made failed-row `retryLoad()` re-enter the current row model's authoritative load path. Added focused regressions for async row-node writes, row-node validation/integrity helpers, and failed-row retry. Focused verification passed with `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts` and `corepack pnpm --filter @eregister/open-grid-core build`.
- 2026-07-08: Completed the main Phase 10 renderer migration seam. `rowRenderer.ts` no longer narrows to `VisibleBlockLoadCapableRowModel` or calls `loadVisibleBlocks(...)`; it now drives viewport loading through `RowModelViewportAccess.ensureRange(...)` and continues to read rows through `getVisualRowModel()`. Removed the last synthetic `loading:${r}` fallback so renderer loading rows come from the row model instead of being inferred from `getVisualRow(...) === null`. Added a focused renderer regression proving active scroll calls `ensureRange(...)`, and updated the architecture guard to lock in the new contract. Focused verification passed with `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts src/renderer/runtimePerformance.test.ts` and `corepack pnpm --filter @eregister/open-grid-core build`.
- 2026-07-08: Reconciled the remaining Plan 156 checklist against the actual test suite and closed the stale documentation gaps. Added an architecture guard that locks in explicit `server-page` internal naming while preserving the public `'server'` compatibility alias without implying full SSRM support. Marked the already-landed test buckets as complete: row-model contract coverage (`rowModel.test.ts`, `serverRowModel.test.ts`, `rowModel.capabilities.test.ts`), public row-node facade coverage (`store.test.ts`), infinite cache and query-token churn coverage (`serverRowModel.test.ts`, `serverRowModel.adversarial.test.ts`), client query pipeline ownership (`query/queryModel.test.ts`), mutation semantics, selection-scope honesty, and visual-row normalization coverage.
- 2026-07-08: Hardened the remaining async row-model correctness blockers. Replaced the old infinite status map with a real `InfiniteBlockCache` that owns per-block rows/status/request identity, made infinite request-currentness validate the block's active `requestId`, added server-page `activePageRequestId` validation, stopped `GridStore.getRowLoadState(...)` from re-deriving state from `getVisualRow(...)`, and made server-page `ensureRange(...)` no-op for already represented current-page ranges so renderer checks cannot trigger reload loops. Added focused regressions for same-block/same-page request ordering, partial block honesty, server-page `ensureRange` loop prevention, and store load-state delegation. Full verification passed with `corepack pnpm --filter @eregister/open-grid-core test`, `corepack pnpm --filter @eregister/open-grid-react build`, and `corepack pnpm --filter @eregister/open-grid-react test`.

## Done criteria

- [x] Row model kinds are honest and architecture/docs stop implying full SSRM where it does not exist
- [x] Public `GridRowNode` facade exists
- [x] Public `GridRowNode` does not expose internal mutable row-model objects
- [x] All row models implement one renderer-facing viewport/load-state contract
- [x] Loading/failed/placeholder rows are first-class visual rows
- [x] Infinite model uses a real block cache with explicit status
- [x] Async results are query-version/request-token guarded
- [x] Row-node writes are honest per row model
- [x] Validation/integrity row-node operations route through existing authoritative owners
- [x] Selection scopes are honest per row model
- [x] Renderer no longer relies on row-model-specific loading seams
- [x] Unsupported operations fail consistently
- [x] Core tests and build pass

## Post-Plan-158 reconciliation

- 2026-07-28: **SUPERSEDED, not reopened.** Direct current-state audit confirmed that the client and infinite portions of this plan remain live through `RowModelViewportAccess`, `GridRowNode`, explicit visual loading/failed/placeholder vocabulary, block/request ownership, and public facade tests. The server-page portion is intentionally no longer executable: `packages/core/src/serverPageRowModel.ts` was deleted, and Plan 158's deletion manifest confirms that public `rowModelType: 'server'` now maps only to `ServerSideRowModelController` (real SSRM), with page APIs and page datasource contracts removed. The equivalent SSRM contract is covered by `serverSideRowModel.test.ts`, including load state, visual loading rows, request ordering, query churn, loaded-row mutation, and selection scope. Focused current-model verification passed: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/rowModel.capabilities.test.ts src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts src/serverSideRowModel.test.ts src/store.test.ts src/renderer/runtimePerformance.test.ts src/engine/architectureGuards.test.ts` (8 files, 591 tests). Plan 158 is the authoritative completion record for the deleted server-page architecture; no compatibility model was restored.

## STOP conditions

- The public API must preserve `'server'` and a deeper compatibility decision is needed before internal/public type split can proceed cleanly
- Existing validation/integrity owners cannot support row-scoped facade delegation without a separate product/architecture decision
- Renderer migration uncovers an undocumented dependency on row-model-specific internals that needs explicit design before proceeding
