# @eregister/open-grid-core

Framework-agnostic grid core for the Open Grid alpha. The application API is
published from `@eregister/open-grid-core`.

## Factories

Use one factory per grid instance:

```ts
import { createClientGrid, createInfiniteGrid, createServerSideGrid } from '@eregister/open-grid-core';

const client = createClientGrid({
	columns: [{ field: 'name', header: 'Name' }],
	rows: [{ id: 'ada', name: 'Ada Lovelace' }],
	getRowId: (row) => row.id,
});
```

- `createClientGrid` owns a supplied in-memory `rows` array.
- `createInfiniteGrid` loads flat blocks through an `InfiniteDatasource`.
- `createServerSideGrid` creates the server-side row model (SSRM), including
  routed/grouped stores, through a `ServerSideDatasource`.

All factories return `GridApi`. Configure the row model at creation time; do
not substitute one factory for another after a grid has been created.

## Lifecycle

Call `api.destroy()` when the owning UI, host, or integration is disposed. It
is the terminal lifecycle action: it tears down grid-owned subscriptions,
render work, persistence/workspace controllers, and pending row-model work.
Do not issue more API calls or retain host bindings after destruction. Create a
new grid instance instead of trying to revive a destroyed one.

## SSRM datasource

`ServerSideDatasource#getRows(request, context)` is asynchronous. The request
contains the requested `[startRow, endRow)` range, route/group keys, grouping
and value-column metadata, plus current sort, filter, quick-filter, and query
models. Honor the request route and range; use `context.signal` to stop work
when it is aborted.

Return `rows` and, when known, exactly one consistent row-boundary signal:
`rowCount`, `lastRow`, or `hasMore`. A short result or `hasMore: false` closes
the range; `hasMore: true` asserts another row remains after it. Returned rows
must have unique identities when `getRowId` is configured. Invalid or
contradictory count information is rejected rather than guessed.

Use `api.setServerSideDatasource(nextDatasource)` to replace a datasource, and
the SSRM refresh/purge APIs for server data invalidation. Do not mutate a
request object or assume a result remains current after the grid is destroyed
or its datasource/query changes.

## Entrypoint stability

- `@eregister/open-grid-core` is the supported alpha application surface. It remains
  pre-release and may change between alpha versions.
- `@eregister/open-grid-core/experimental` contains incubating APIs with no compatibility
  promise.
- `@eregister/open-grid-core/internal` is an adapter-only host contract used by framework
  bindings. It deliberately does not expose stores, engines, row models, or
  renderer implementation classes, and application code should not depend on
  it.

The checked `api-contract.md` records the emitted declaration surface for all
three entries. Run `pnpm --filter @eregister/open-grid-core run api:check` after changing
an exported type, and explicitly regenerate/review the contract when that
change is intentional.
