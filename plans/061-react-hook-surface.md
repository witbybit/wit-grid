# Plan 061: React Hook Surface

> The React package exposes one `Grid` component and one `useGrid` hook. The `useGrid` hook gives raw `GridApi` access, which is powerful but verbose — every consumer re-implements the same subscription patterns. This plan adds a set of focused, purpose-built hooks that cover the most common reactive use cases: sort state, filter state, selection, row data, column visibility, and loading state. It also adds a `useGridRef` pattern so parent components can access the API without prop drilling through `onGridReady`.

## Status

- **Priority**: P2 — DX improvement, independent of core feature work
- **Effort**: M
- **Risk**: LOW — purely additive; no changes to core or Grid component
- **Depends on**: nothing (builds on existing `GridApi` surface)
- **Category**: react, DX, hooks
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What to add

### Hook catalogue

```ts
// packages/react/src/hooks.ts (extend existing file)

/**
 * Returns a stable ref object. Pass it to the Grid's `apiRef` prop.
 * The ref is populated after the grid mounts and cleared on unmount.
 * Avoids the onGridReady callback pattern for parent components.
 *
 * @example
 * const gridRef = useGridRef<MyRow>();
 * <Grid apiRef={gridRef} ... />
 * // Later: gridRef.current?.exportCsv()
 */
export function useGridRef<TRowData = unknown>(): React.MutableRefObject<GridApi<TRowData> | null>;

/**
 * Subscribe to the current sort model. Re-renders when sort changes.
 */
export function useSortModel(api: GridApi | null): SortModel;

/**
 * Subscribe to the current filter model. Re-renders when filter changes.
 */
export function useFilterModel(api: GridApi | null): FilterModel;

/**
 * Subscribe to selected row IDs. Re-renders when row selection changes.
 */
export function useSelectedRowIds(api: GridApi | null): string[];

/**
 * Subscribe to the current row count (after filter + pagination).
 */
export function useRowCount(api: GridApi | null): number;

/**
 * Subscribe to a single grid state key. Typed via GridState keyof.
 * Re-renders only when that specific key changes.
 *
 * @example
 * const groupBy = useGridStateKey(api, 'groupBy');
 */
export function useGridStateKey<K extends keyof GridState>(api: GridApi | null, key: K): GridState[K];

/**
 * Subscribe to whether the grid is in a loading state.
 */
export function useGridLoading(api: GridApi | null): boolean;

/**
 * Subscribe to column definitions. Re-renders when columns change.
 */
export function useColumns(api: GridApi | null): ColumnDef[];

/**
 * Subscribe to open sidebar panel.
 */
export function useOpenPanel(api: GridApi | null): string | null;

/**
 * Subscribe to active validation errors.
 */
export function useValidationErrors(api: GridApi | null): Record<string, string>;
```

### `apiRef` prop on Grid component

```tsx
// packages/react/src/Grid.tsx

export interface GridProps<TRowData = unknown> {
	// ... existing props ...

	/**
	 * Ref that will be populated with the GridApi after mount.
	 * Alternative to onGridReady for imperative access.
	 */
	apiRef?: React.MutableRefObject<GridApi<TRowData> | null>;
}
```

### Implementation pattern

All subscription hooks follow the same pattern:

```ts
export function useSortModel(api: GridApi | null): SortModel {
	const [sortModel, setSortModel] = useState<SortModel>(() => (api ? (api.getState().sortModel ?? []) : []));

	useEffect(() => {
		if (!api) return;
		setSortModel(api.getState().sortModel ?? []);
		return api.subscribeToKey('sortModel', () => {
			setSortModel(api.getState().sortModel ?? []);
		});
	}, [api]);

	return sortModel;
}
```

`useGridRef` is implemented with a `useCallback` forwarded to `Grid`'s `apiRef` prop:

```ts
export function useGridRef<TRowData>() {
	return useRef<GridApi<TRowData> | null>(null);
}
```

`Grid.tsx` populates `apiRef.current` in `onGridReady` and clears it in `onGridDestroyed`.

### Column type registry additions

Add common built-in column types to `resolveColumnTypes.ts`:

```ts
// Numeric columns: right-aligned, number filter type
export const numericColumn: Partial<ColumnDef> = {
	filterType: 'number',
};

// Currency: right-aligned, number filter, default formatter
export const currencyColumn: Partial<ColumnDef> = {
	filterType: 'number',
	valueFormatter: ({ value }) =>
		value != null ? `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
};

// Date column: date filter, ISO formatter
export const dateColumn: Partial<ColumnDef> = {
	filterType: 'date',
	valueFormatter: ({ value }) => {
		if (!value) return '';
		const d = new Date(value as string | number);
		return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
	},
};

// Right-aligned text
export const rightAlignedColumn: Partial<ColumnDef> = {};
```

These are registered in the default column type registry so `type: 'numericColumn'` works out of the box (matching AG Grid's naming).

## Phases

### Phase 1 — `useGridRef` + `apiRef` prop

- Add `useGridRef<TRowData>()` hook
- Add `apiRef` prop to `Grid.tsx`
- Wire: `Grid` populates `apiRef.current` on ready, clears on destroy
- Test: `apiRef.current` is populated after mount, null after unmount

### Phase 2 — Core subscription hooks

- `useSortModel`, `useFilterModel`, `useSelectedRowIds`, `useRowCount`
- `useGridLoading`, `useColumns`, `useOpenPanel`
- Each hook re-renders only when its subscribed key changes

### Phase 3 — `useGridStateKey`

- Generic hook for any `GridState` key
- TypeScript inference must work: `useGridStateKey(api, 'groupBy')` → `string[]`
- Test all key types

### Phase 4 — `useValidationErrors`

- Subscribes to `validationErrors` state key
- Returns `Record<rowId_colField, errorMessage>` or the raw map structure

### Phase 5 — Built-in column types

- `numericColumn`, `currencyColumn`, `dateColumn`, `rightAlignedColumn`
- Add to `resolveColumnTypes.ts` default registry
- Export types from React package index

### Phase 6 — Tests

```ts
it('useSortModel re-renders when sort changes', ...);
it('useFilterModel re-renders when filter changes', ...);
it('useGridRef populates after mount', ...);
it('useGridRef is null after destroy', ...);
it('useGridStateKey infers correct return type', ...);
it('useRowCount reflects filter reduction', ...);
```

### Phase 7 — Demo

- Update `WideGridDemo` to use `useGridRef` instead of `onGridReady` + `useState<GridApi>`
- Update one other demo to demonstrate `useSortModel` / `useFilterModel` in a stats panel

## STOP conditions

- Do not add hooks that return row data arrays — subscribing to row data causes re-renders on every row change and is almost always the wrong pattern for large grids.
- Do not add `useCell` or per-cell hooks — too granular, breaks virtualization mental model.
- Do not wrap every `GridApi` method in a hook — imperative methods stay imperative.

## Verification gate

```
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

`useGridRef` populated after mount. `useSortModel` updates correctly when `api.setSortModel()` is called. `useRowCount` decreases when filter is applied. Built-in column types resolve correctly.
