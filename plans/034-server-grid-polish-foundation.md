# Plan 034: Native server-grid pagination and server event hardening

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If any
> STOP condition fires, stop and report rather than improvising an alternative.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/core/src/serverRowModel.ts packages/core/src/api/GridEvents.ts packages/core/src/api/GridApi.ts packages/core/src/state/GridState.ts packages/core/src/engine/runtimePorts.ts packages/react/src/Grid.tsx packages/react/src/pagination.js demo/src/pages/InfiniteServerScroll.tsx`
> If any in-scope file has changed since this plan was written, compare the
> "Current state" section against the live code before proceeding.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/032-single-grid-entrypoint-lockdown.md`
- **Category**: core, server-grid, pagination, product
- **Planned at**: working tree, 2026-06-13

## Why this matters

Pagination for server grids is currently a React-layer datasource wrapper in
`packages/react/src/Grid.tsx:111-137`. That wrapper translates page-relative
`startRow`/`endRow` into absolute offsets and caps `totalCount` to `pageSize`
before forwarding the call to the real datasource.

This causes an infinite loading loop:

1. `pagedServerDatasource` useMemo has `clampedPage` in its dependency array.
2. `clampedPage` depends on `pageCount`, which depends on `serverTotalRows`
   (React state).
3. `serverTotalRows` is updated by the `serverBlockLoaded` event listener.
4. So every block load → `setServerTotalRows` fires → `clampedPage` may
   change → `pagedServerDatasource` memo re-creates → the `setServerDatasource`
   effect fires → `purgeCache()` → new block load → back to step 3. The grid
   never becomes idle.

The right fix is to move pagination entirely into the server row model so that
page state is owned by core and not by React. Pagination page changes become an
explicit imperative operation (`api.goToPage(n)`) rather than a memo/effect
cascade. The React layer's only job is to render the pagination UI and call that
API — no datasource wrapping, no React state tracking total rows.

This plan also hardens the other two items originally in the plan sketch:
server block load failures as a first-class event (already implemented via
`serverBlockLoadFailed` — verify and lock in) and unloaded-block selection
legibility in the demo.

## Current state

- `packages/react/src/Grid.tsx:111-137` — `pagedServerDatasource` wrapper that
  translates page offsets and caps `totalCount`. This is the root of the loop.
- `packages/react/src/Grid.tsx:97-103` — React state: `page`, `serverTotalRows`,
  `pageCount`, `clampedPage`. All four should move to core.
- `packages/react/src/Grid.tsx:206-212` — `serverBlockLoaded` listener that
  calls `setServerTotalRows`, completing the loop cycle.
- `packages/core/src/serverRowModel.ts:15-24` — `GetRowsParams` has only
  `startRow`, `endRow`, `sortModel`, `filterModel`. No page semantics.
- `packages/core/src/serverRowModel.ts:26-31` — `ServerRowModelOptions` has no
  `pagination` field.
- `packages/core/src/api/GridApi.ts:283-284` — `purgeCache()` and
  `setServerDatasource()` exist. No `goToPage()`.
- `packages/core/src/state/GridState.ts:80` — `loading?: boolean` exists.
  No `serverPagination` key.
- `packages/core/src/api/GridEvents.ts:40-44` — `serverBlockLoaded` and
  `serverBlockLoadFailed` exist. No `paginationChanged` event.
- `packages/core/src/engine/runtimePorts.ts:75-83` — `ServerRowModelRuntime`
  has `dispatchServerBlockLoaded` and `dispatchServerBlockLoadFailed`. No
  pagination dispatch.
- `demo/src/pages/InfiniteServerScroll.tsx:210-219` — pagination config
  commented out because enabling it triggers the infinite loop.

## Commands you will need

| Purpose            | Command                                                                                       | Expected on success |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------- |
| Build core         | `corepack pnpm --filter @eregister/open-grid-core build`                                      | exit 0              |
| Core tests         | `corepack pnpm --filter @eregister/open-grid-core test`                                       | exit 0, all pass    |
| Server model tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts` | exit 0              |
| Build react        | `corepack pnpm --filter @eregister/open-grid-react build`                                     | exit 0              |
| React tests        | `corepack pnpm --filter @eregister/open-grid-react test`                                      | exit 0, all pass    |
| Demo build         | `corepack pnpm --filter demo-app build`                                                       | exit 0              |

## Scope

**In scope**:

- `packages/core/src/serverRowModel.ts`
- `packages/core/src/serverRowModel.test.ts`
- `packages/core/src/api/GridEvents.ts`
- `packages/core/src/api/GridApi.ts`
- `packages/core/src/state/GridState.ts`
- `packages/core/src/engine/runtimePorts.ts`
- `packages/core/src/engine/createRowModelRuntimes.ts` (wire `dispatchPaginationChanged`)
- `packages/core/src/store.ts` (expose `goToPage` through the API facade)
- `packages/react/src/Grid.tsx`
- `packages/react/src/index.test.tsx`
- `demo/src/pages/InfiniteServerScroll.tsx`
- `plans/README.md`

**Out of scope**:

- Cache eviction strategy (LRU block eviction, page prefetch)
- Server-side selection semantics redesign
- Client grid pagination (it already works; the wrapper for client rows is a
  safe slice operation with no feedback cycle)
- Retry/backoff policy for block load failures

## Design

### Pagination mode vs infinite scroll mode

The server row model operates in one of two modes determined at construction:

- **Infinite scroll** (default, `pagination` omitted): unchanged behavior.
  `totalCount` from the datasource sets the sparse array size globally.
  `loadVisibleBlocks` prefetches around the viewport with no page concept.

- **Page mode** (`pagination: { pageSize, initialPage? }` passed to
  `createServerGrid`): the model owns `currentPage`, `pageCount`, and
  `totalRows`. Each page shows at most `pageSize` rows. Blocks are indexed
  within the page window; their absolute `startRow` is
  `currentPage * pageSize + blockIdx * blockSize`. `goToPage(n)` is the only
  public way to change the page; it purges and reloads.

### How `totalCount` is handled in page mode

The datasource still returns the **global** `totalCount` (total records across
all pages). The server row model interprets it as follows:

```
pageCount   = ceil(totalCount / pageSize)
currentRows = min(pageSize, max(0, totalCount - currentPage * pageSize))
```

The sparse visual row array is sized to `currentRows` (not `totalCount`), so
the render engine sees only the current page's row window. When `goToPage(n)`
is called, the array is replaced entirely.

### `GetRowsParams` extension (additive, non-breaking)

```typescript
export interface GetRowsParams {
	startRow: number; // absolute global start row
	endRow: number; // absolute global end row (exclusive)
	sortModel: unknown;
	filterModel: unknown;
	pageNumber?: number; // 0-based; set when in page mode
	pageSize?: number; // set when in page mode
}
```

Existing datasources that ignore `pageNumber`/`pageSize` continue to work
because `startRow`/`endRow` still carry the absolute positions they have always
carried. Datasources that prefer explicit page semantics can switch to
`pageNumber` + `pageSize` and derive start/end themselves.

### New `paginationChanged` event

Emitted whenever `currentPage`, `pageCount`, or `totalRows` changes inside the
server row model. Payload:

```typescript
{
	page: number;
	pageCount: number;
	totalRows: number;
	pageSize: number;
}
```

This is the signal React uses to re-render the pagination UI — no React state
tracking needed.

### `GridState.serverPagination`

```typescript
serverPagination?: {
  page: number;
  pageCount: number;
  totalRows: number;
  pageSize: number;
};
```

Updated atomically by the store in response to `paginationChanged`. The React
`GridPagination` component subscribes to this key via
`api.subscribeToKey('serverPagination', ...)`.

### `GridApi.goToPage`

```typescript
goToPage(page: number): void;
```

No-op when the grid is in infinite scroll mode. Clamps to
`[0, pageCount - 1]` in page mode.

## Steps

### Step 1: Add pagination types and the new event

**`packages/core/src/api/GridEvents.ts`**

Add `paginationChanged = 'paginationChanged'` to `GridEventName`.

Add to `GridEventPayloadMap`:

```typescript
[GridEventName.paginationChanged]: {
  page: number;
  pageCount: number;
  totalRows: number;
  pageSize: number;
};
```

**`packages/core/src/state/GridState.ts`**

Add to the `GridState` interface:

```typescript
serverPagination?: {
  page: number;
  pageCount: number;
  totalRows: number;
  pageSize: number;
};
```

**`packages/core/src/serverRowModel.ts`**

Extend `GetRowsParams` with the two optional fields described in the Design
section. Extend `ServerRowModelOptions` with:

```typescript
pagination?: { pageSize: number; initialPage?: number };
```

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` → exit 0.

### Step 2: Implement native pagination in `ServerRowModelController`

Add private page fields:

```typescript
private readonly paginationPageSize: number | null;  // null = infinite scroll
private currentPage = 0;
private pageCount = 1;
private totalRowsKnown = 0;
```

Initialize from `options.pagination` in the constructor. When `paginationPageSize`
is set, call `this.fetchBlock(0)` immediately as before (the initial block 0
fetch still provides the first `totalCount`).

**Modify `fetchBlock`** when in page mode:

- `absoluteStartRow = this.currentPage * this.paginationPageSize + blockIdx * this.blockSize`
- `absoluteEndRow = absoluteStartRow + this.blockSize`
- Pass to datasource: `{ startRow: absoluteStartRow, endRow: absoluteEndRow, sortModel, filterModel, pageNumber: this.currentPage, pageSize: this.paginationPageSize }`
- On success, patch rows into `this.activeNodes` / `this.visualRows` at
  **page-local** index `blockIdx * this.blockSize` (not the absolute index).
- When `response.totalCount` is a number: update `totalRowsKnown`, recompute
  `pageCount = ceil(totalCount / paginationPageSize)`, compute
  `currentPageRows = min(paginationPageSize, max(0, totalCount - currentPage * paginationPageSize))`,
  resize `activeNodes` and `visualRows` to `currentPageRows`, and call
  `this.runtime.dispatchPaginationChanged({ page: currentPage, pageCount, totalRows: totalRowsKnown, pageSize: paginationPageSize })`.

**Modify `purgeCache`** when in page mode:

- Reset `activeNodes`, `visualRows`, `nodeMap`, `visualRowIdToIndex`, `rowIdToVisualIndex`.
- Do NOT reset `currentPage`, `pageCount`, or `totalRowsKnown` (those persist across
  cache purges triggered by sort/filter).

**Add `goToPage(page: number)`**:

```typescript
public goToPage(page: number): void {
  if (this.paginationPageSize === null) return;
  const clamped = Math.max(0, Math.min(page, this.pageCount - 1));
  if (clamped === this.currentPage) return;
  this.currentPage = clamped;
  this.purgeCache();
}
```

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts` → exit 0.

### Step 3: Wire the new port and expose through `GridApi`

**`packages/core/src/engine/runtimePorts.ts`**

Add to `ServerRowModelRuntime`:

```typescript
dispatchPaginationChanged: (payload: GridEventPayloadMap<TRowData>[GridEventName.paginationChanged]) => void;
```

**`packages/core/src/engine/createRowModelRuntimes.ts`**

Implement `dispatchPaginationChanged` similarly to `dispatchServerBlockLoaded`:
emit the event and update `GridState.serverPagination` atomically.

**`packages/core/src/api/GridApi.ts`**

Add `goToPage(page: number): void;` to the `GridApi` interface.

**`packages/core/src/store.ts`**

Implement `goToPage(page)` on the store facade: delegate to the server row
model's `goToPage` if in server mode, otherwise no-op.

**Verify**:

```
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
```

Both → exit 0.

### Step 4: Remove the React datasource wrapper and rewire `Grid.tsx`

This step removes all four sources of the infinite loop.

**Remove from `Grid.tsx`**:

- `const [serverTotalRows, setServerTotalRows] = useState(0)` (line ~98)
- `const [page, setPage] = useState(...)` (line ~97)
- `const totalRows = ...`, `const pageCount = ...`, `const clampedPage = ...` (lines ~99-102)
- The `pagedServerDatasource` useMemo entirely (lines ~111-137)
- The `serverBlockLoaded` listener that called `setServerTotalRows` (lines ~206-212)
- `effectiveServerBlockSize` calculation that referenced `paginationConfig` (line ~139) — replace with plain `blockSize` passthrough

**Add to `Grid.tsx`**:

- When creating the server grid, pass `pagination` config when present:

    ```typescript
    createServerGrid({
    	datasource: datasource as GridDatasource<TRowData>,
    	columns: resolveColumnTypes(columns, columnTypes),
    	blockSize,
    	getRowId,
    	persistence,
    	initialState: initial,
    	pagination: paginationConfig
    		? { pageSize: paginationConfig.pageSize ?? DEFAULT_PAGE_SIZE, initialPage: paginationConfig.initialPage }
    		: undefined,
    });
    ```

    No datasource wrapping. No page offset arithmetic. The datasource the caller
    provided goes straight through.

- Replace the React `page`/`pageCount` state with a state slice subscribed from
  the API:

    ```typescript
    const [paginationState, setPaginationState] = useState(() => api.getState().serverPagination ?? null);
    useEffect(() => {
    	if (!paginationConfig) return;
    	return api.subscribeToKey('serverPagination', () => {
    		setPaginationState(api.getState().serverPagination ?? null);
    	});
    }, [api, paginationConfig]);
    ```

- Wire `GridPagination` to the new state:
    ```tsx
    {paginationConfig && paginationState ? (
      <GridPagination
        page={paginationState.page}
        pageCount={paginationState.pageCount}
        onPageChange={(n) => api.goToPage(n)}
        totalRows={paginationState.totalRows}
        pageSize={paginationState.pageSize}
        ...
      />
    ) : null}
    ```

**Verify**:

```
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter @eregister/open-grid-react test
```

Both → exit 0.

### Step 5: Update the server demo

**`demo/src/pages/InfiniteServerScroll.tsx`**

Uncomment the `pagination` prop (lines 210-219). The grid should now use the
native pagination path. Set the `pageSize` to a value that makes the demo
demonstrably paged (e.g. `1000` rows per page for the 100K dataset).

Remove the `SERVER_PAGE_SIZE` constant if it was only used to drive the old
`pagination.pageSize`.

The block-load stats sidebar (`loadedBlockStart`, `loadedBlockEnd`) already
listens to `serverBlockLoaded` and can stay as-is. Confirm the demo:

- loads page 0 on mount without looping,
- responds to page navigation by purging and reloading,
- shows the correct `loadedBlockStart`/`loadedBlockEnd` range after page
  change settles.

**Verify**: `corepack pnpm --filter demo-app build` → exit 0.

### Step 6: Add focused tests and lock the boundary

**`packages/core/src/serverRowModel.test.ts`**

Add a test suite `'pagination mode'` covering:

1. **Initial load**: constructing `ServerRowModelController` with `pagination: { pageSize: 200, initialPage: 0 }` fetches block 0 with `pageNumber: 0, pageSize: 200` in `GetRowsParams`.
2. **totalCount drives pageCount**: datasource returns `totalCount: 1000` → `pageCount` becomes `5`; `paginationChanged` is dispatched with `{ page: 0, pageCount: 5, totalRows: 1000, pageSize: 200 }`.
3. **goToPage**: calling `goToPage(2)` resets the row array and fetches block 0 with `pageNumber: 2, pageSize: 200, startRow: 400, endRow: 600`.
4. **No double-fetch loop**: setting a new datasource via `setDatasource` in page mode calls `purgeCache` exactly once and does not trigger a second purge from a state cascade.
5. **Last page rows**: `totalCount: 950`, `pageSize: 200`, `goToPage(4)` → visual row count is `150` (not `200`).
6. **Infinite scroll is unaffected**: constructing without `pagination` behaves identically to the current behavior.

**`packages/core/src/engine/architectureGuards.test.ts`**

Add an assertion that `packages/react/src/Grid.tsx` does **not** contain the
string `pagedServerDatasource`. This prevents the wrapper from being
reintroduced silently.

**`plans/README.md`**

Update this plan's status row to `DONE` and add a note describing the
pagination architecture change.

**Final verification**:

```
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

All → exit 0.

## Test plan

- `serverRowModel.test.ts` 'pagination mode' suite covers initial load, page
  navigation, last-page sizing, and no-loop guarantee.
- Architecture guard asserts no `pagedServerDatasource` in `Grid.tsx`.
- `index.test.tsx` should confirm `Grid` in server mode with `pagination` prop
  mounts cleanly and the `api.goToPage` method exists.
- Demo build is the integration smoke test.

## Done criteria

- [ ] `GetRowsParams` has optional `pageNumber` and `pageSize` fields.
- [ ] `ServerRowModelOptions` accepts `pagination?: { pageSize, initialPage? }`.
- [ ] `ServerRowModelController` owns `currentPage`, `pageCount`, `totalRows`
      internally in page mode; does nothing new in infinite scroll mode.
- [ ] `GridEventName.paginationChanged` exists with the correct payload type.
- [ ] `GridState.serverPagination` is updated by the store when
      `paginationChanged` fires.
- [ ] `GridApi.goToPage` is implemented and no-ops in infinite scroll mode.
- [ ] `pagedServerDatasource` wrapper is deleted from `Grid.tsx`.
- [ ] `serverTotalRows` React state is removed from `Grid.tsx`.
- [ ] `GridPagination` in server mode drives off `api.subscribeToKey('serverPagination', ...)`.
- [ ] `InfiniteServerScroll.tsx` pagination config is uncommented and the demo
      does not loop.
- [ ] Architecture guard blocks reintroduction of the wrapper.
- [ ] All verification commands exit 0.

## STOP conditions

Stop and report if:

- `createServerGrid` cannot accept a `pagination` option without touching the
  `GridEngine` constructor in a way that risks breaking existing behavior.
- The `dispatchPaginationChanged` path in `createRowModelRuntimes.ts` would
  need to update `GridState` in a way that is inconsistent with how other state
  keys are updated (check how `setLoadingState` works as precedent).
- The `InfiniteServerScroll` demo still loops after the React wrapper is removed
  and pagination is native.
- Any verification command fails after two reasonable fix attempts.

## Maintenance notes

- Do not reintroduce a datasource wrapper in the React layer for any pagination
  variant. Page state belongs in core.
- `goToPage` is the only public API for page navigation. Do not add a
  `setPage` React state bypass.
- `GetRowsParams.pageNumber`/`pageSize` are informational. Datasources that
  prefer offset arithmetic can ignore them; datasources that prefer explicit
  page numbers can use them. Both styles work because `startRow`/`endRow` are
  always set correctly.
- If a second pagination style is ever needed (cursor-based, keyset), add a
  separate `cursorPage?: string` field to `GetRowsParams` and a new mode flag
  to `ServerRowModelOptions`. Do not overload the existing `pageNumber` field.
