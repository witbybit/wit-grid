# Plan 158 Server-Page Deletion Manifest

Last audited: 2026-07-25

This document is the deletion evidence record for the page-oriented `rowModelType: 'server'` implementation. The old server-page model must not survive as a compatibility mode, legacy alias, nested fallback, or deprecated public API.

## Deletion outcome

The Stage C server-page demolition has landed in core:

- `packages/core/src/serverPageRowModel.ts` is deleted.
- `createServerPageGrid` and `ServerPageGridOptions` are removed from public exports.
- `ServerDatasource`, `ServerPageState`, and page-oriented datasource contracts are removed from the public surface.
- `goToServerPage(...)` and related page navigation APIs are removed.
- `GridEventName.serverPageLoadingStarted`, `serverPageLoaded`, `serverPageLoadFailed`, and `serverPageChanged` are removed.
- `GridUIState.serverPage` is removed.
- Server runtime forwarding now targets SSRM operations: `setServerSideDatasource(...)`, `refreshServerSide(...)`, `purgeServerSide(...)`, and `getServerSideStoreState()`.
- Core retry routing uses the row-model viewport/load contract instead of page-specific retry hooks.

## Replacement outcome

The public `server` row model now maps to SSRM:

- `createServerSideGrid(...)` constructs `ServerSideRowModelController`.
- `rowModelType: 'server'` routes through `ServerSideRowModelController` in React/core entrypoints.
- SSRM exposes route-aware refresh and purge operations.
- SSRM publishes immutable store snapshots through `getServerSideStoreState()`.
- SSRM forwards sort, filter, quick-filter, and query-model snapshots to `getRows(...)`.
- SSRM owns loaded-row mutation, loaded-row selection, and partial loaded-row integrity semantics.

## Search expectation

The live implementation search should no longer find server-page symbols in `packages/core/src`, `packages/react/src`, or `demo` except for historical plan/documentation references:

```txt
rg -n "ServerPageRowModelController|serverPage|goToServerPage|getCurrentServerPage|serverPageLoaded|serverPageChanged|pageNumber" packages/core/src packages/react/src demo docs -g '!**/node_modules/**'
```

Allowed remaining hits are historical migration notes in `docs/architecture/*` or old plans that explicitly describe removal history. Live code must not contain page-oriented server implementation seams.

## Verification snapshot

The core demolition/replacement slice was committed only after:

- `corepack pnpm --filter @eregister/open-grid-core exec tsc --noEmit`
- `corepack pnpm --filter @eregister/open-grid-core test`
- Result: `111` test files passed, `1900` tests passed

Plan 158 is complete only after React tests, root build, and the plan index update also pass.
