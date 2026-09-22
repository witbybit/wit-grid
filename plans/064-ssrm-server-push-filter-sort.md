# Plan 064: SSRM Server-Push Filter/Sort

> The current server row model loads pages but does not push sort and filter changes back to the server — it only fetches a fixed page window. This means server-side grids silently client-filter already-loaded data, giving wrong results when the server has data the current page window doesn't include. This plan upgrades the server datasource contract to include sort and filter parameters, makes the server row model re-fetch from page 0 when sort/filter changes, and updates the demo to show correct server-side behavior.

## Status

- **Priority**: P2 — correctness issue for server-side data use cases
- **Effort**: L
- **Risk**: MEDIUM — changes `IGridDatasource` contract (breaking change for existing server datasource implementations); must be carefully documented
- **Depends on**: 059 (advanced filter types — server receives the new filter model shape)
- **Category**: architecture, server-side, correctness
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## Current server datasource contract

```ts
// Current — only page-based
export interface IGridDatasource {
	getRows(params: IGetRowsParams): void;
}

export interface IGetRowsParams {
	startRow: number;
	endRow: number;
	successCallback(rows: unknown[], totalRowCount?: number): void;
	failCallback(): void;
}
```

## New server datasource contract

```ts
export interface IGridDatasource {
	getRows(params: IGetRowsParams): void;

	/**
	 * Called when the datasource is destroyed (grid unmount or datasource replaced).
	 * Use to cancel in-flight requests.
	 */
	destroy?(): void;
}

export interface IGetRowsParams {
	startRow: number;
	endRow: number;

	/** Current sort model. Empty array = no sort. */
	sortModel: SortModel;

	/** Current filter model. Empty object = no filter. */
	filterModel: FilterModel;

	/**
	 * Current group-by fields, if any.
	 * For grouped server data: return one GroupResult[] or flat RowData[].
	 */
	groupBy: string[];

	successCallback(rows: unknown[], totalRowCount?: number): void;
	failCallback(reason?: string): void;
}
```

### Migration guide

Existing datasource implementations that ignore extra params continue to work — the new fields are additive. The only breaking change is that `failCallback` gains an optional `reason` string. Document with a JSDoc `@since` comment.

## Behavior changes in `ServerRowModelController`

### Sort/filter change triggers refetch from page 0

```ts
// In ServerRowModelController

private onSortChanged() {
  this._resetAndRefetch();
}

private onFilterChanged() {
  this._resetAndRefetch();
}

private _resetAndRefetch() {
  this._blockCache.clear();
  this._goToPage(0); // re-fetch first block
}
```

Currently: sort/filter changes are applied client-side on already-loaded data.
After this plan: sort/filter changes reset to page 0 and fetch fresh from server.

### Client-side filter disabled in server mode

When a server datasource is active, the client-side filter pipeline stage must be bypassed — the server owns filtering. The server model sets a flag that the row pipeline checks.

Similarly, client-side sort is bypassed — the server handles it. The sort model is still tracked in state (for UI display) but is sent to the server rather than applied locally.

### Block cache invalidation

The block cache stores loaded pages. When sort or filter changes, all cached blocks are invalid. `_blockCache.clear()` purges them and the overlay shows loading state until page 0 is received.

### Loading state during refetch

When `_resetAndRefetch()` is called, set `state.loading = true`. This shows the loading overlay until the first successful page response.

## Phases

### Phase 1 — Extend `IGetRowsParams`

- Add `sortModel`, `filterModel`, `groupBy` to `IGetRowsParams`
- Add `destroy?()` to `IGridDatasource`
- Add optional `reason` to `failCallback`
- Update `serverRowModel.ts` to pass current state values when calling datasource
- All existing tests must still pass (new fields are additive)

### Phase 2 — Reset on sort/filter change

- Subscribe to `sortChanged` and `filterChanged` events in `ServerRowModelController`
- On change: `_blockCache.clear()`, reset to page 0, set loading, refetch
- Unit tests: sort change triggers new getRows call with updated sortModel

### Phase 3 — Bypass client-side filter/sort in server mode

- Add `isServerMode: boolean` flag to row pipeline context
- Filter stage: if `isServerMode`, pass all rows through unchanged
- Sort stage: if `isServerMode`, pass all rows through unchanged
- Tests: verify client filter does not apply when server datasource is active

### Phase 4 — `destroy()` lifecycle

- Call `datasource.destroy?.()` when grid is destroyed or when a new datasource is set
- Cancel pending `getRows` callbacks that arrive after destroy (ignore stale callbacks)

### Phase 5 — Grouped server data

When `groupBy` is non-empty and the datasource is server-mode:

- Pass `groupBy` fields in `IGetRowsParams`
- Define `GroupResult` shape for server to return pre-grouped data
- The server can return either flat rows (grid groups client-side by the groupBy fields) or `GroupResult[]` (server sends pre-computed groups)
- Default: flat rows; grid groups client-side if the server sends flat data

```ts
export interface GroupResult {
	groupKey: string;
	groupValue: unknown;
	childCount?: number;
	// If children are provided, they are pre-loaded group members
	children?: unknown[];
}
```

This is a large extension — only implement flat-row mode in this plan. Document server-side grouping as a future extension.

### Phase 6 — Tests

```ts
it('getRows receives current sortModel', ...);
it('getRows receives current filterModel', ...);
it('sort change resets to page 0 and clears block cache', ...);
it('filter change resets to page 0 and clears block cache', ...);
it('stale callbacks after reset are ignored', ...);
it('client-side filter is bypassed in server mode', ...);
it('client-side sort is bypassed in server mode', ...);
it('datasource.destroy is called on grid destroy', ...);
```

### Phase 7 — Demo

- Update `InfiniteServerScrollDemo` (or create `ServerSideDataDemo`) to simulate a server that accepts `sortModel` and `filterModel`
- Show a "Server Params" panel displaying the last request sent to the server
- Demonstrate that filtering via the filter panel sends a new request and replaces data correctly

### Phase 8 — Documentation comment

Add JSDoc `@breaking` comment to `IGetRowsParams` noting the new fields. Existing implementations that ignore extra params are unaffected — only implementations that use positional destructuring are at risk (unlikely in TypeScript).

## STOP conditions

- Do not implement server-side grouping in this plan — only flat row mode.
- Do not implement infinite scroll during group expansion in this plan.
- Do not implement server-side aggregation in this plan.
- Do not implement request deduplication (multiple filter changes before response arrives) beyond the stale-callback guard already described.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build
```

Applying a sort model on a server grid fires a new `getRows` call with the updated `sortModel`. Applying a filter fires a new `getRows` call with `filterModel`. Client-side sort and filter do not alter already-loaded server data. Stale callbacks (from abandoned requests) are silently ignored.
