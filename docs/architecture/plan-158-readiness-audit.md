# Plan 158 Readiness Audit

Last audited: 2026-07-25

This document records the current evidence baseline after the Plan 158 core replacement work. The old page-oriented `server` model has been removed from live core code, and `rowModelType: 'server'` now routes to the real server-side row model (SSRM).

## Evidence sources

Primary evidence was taken from:

- `packages/core/src/infiniteRowModel.ts`
- `packages/core/src/serverSideRowModel.ts`
- `packages/core/src/serverRowModel.test.ts`
- `packages/core/src/serverSideRowModel.test.ts`
- `packages/core/src/serverRowModel.adversarial.test.ts`
- `packages/core/src/rowModel.capabilities.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- `docs/architecture/plan-158-server-page-deletion-manifest.md`

## Current state

- Infinite row-model blank-row regressions are protected in core by block validation, explicit row-count authority, deliberate loading/failed visual rows, and atomic publication after block installation.
- Infinite sort, filter, quick-filter, and query-model changes are core-owned and datasource-driven through immutable request snapshots.
- The page-oriented server implementation was deleted from live core: `packages/core/src/serverPageRowModel.ts` is gone, page datasource contracts are gone, `serverPage*` events are gone, and page navigation APIs are gone.
- `rowModelType: 'server'` now constructs `ServerSideRowModelController`, which owns root and child stores, bounded block caches, route refresh/purge operations, request generations, and store snapshots.
- SSRM integrity and selection semantics are explicit: loaded-row scopes are partial, full-dataset scopes are unsupported without a server report, and current-page semantics are not defined for SSRM.

## Verification snapshot

Latest committed core verification before the server-page demolition commit:

- `corepack pnpm --filter @eregister/open-grid-core exec tsc --noEmit`
- `corepack pnpm --filter @eregister/open-grid-core test`
- Result: `111` test files passed, `1900` tests passed

Focused Plan 158 verification also passed:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts src/serverSideRowModel.test.ts src/query/queryModel.test.ts src/rowModel.capabilities.test.ts src/features/dataIntegrity/GridDataIntegrityManager.test.ts src/store.test.ts src/renderer/renderEngine.test.ts src/boundary.test.ts src/engine/architectureGuards.test.ts`
- Result: `10` test files passed, `637` tests passed

## Remaining completion evidence

Plan 158 should only be marked complete after the broader downstream gates pass:

- `corepack pnpm --filter @eregister/open-grid-react test`
- `corepack pnpm run build`
- `plans/README.md` Plan 158 status row updated
