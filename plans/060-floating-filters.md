# Plan 060: Floating Filters (Inline Filter Row)

> Floating filters are a filter input row rendered directly below the column headers, giving users an always-visible filtering surface without opening a panel or menu. AG Grid has had this since v14. Finance and analytics products commonly use them as the primary filter entry point. This plan adds an optional filter row to the header zone, with each cell showing a compact input for the column's active filter.

## Status

- **Priority**: P2 — UX improvement over sidebar filter panel
- **Effort**: M
- **Risk**: LOW — header zone already exists; this adds a second band below column headers
- **Depends on**: 059 (advanced filter types — floating filters must render all filter types)
- **Category**: feature, filtering, UX, header
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What to add

### GridApi / GridState

```ts
// GridState.ts
showFloatingFilters?: boolean; // default false

// GridApi.ts
setShowFloatingFilters(show: boolean): void;
```

### Layout change

When `showFloatingFilters` is true, the header zone height increases by one row height (default: 36px, configurable via theme token `--og-floating-filter-height`).

The floating filter row is rendered by `headerRenderer.ts` as a second band below the column header band. It is:

- Aligned to column positions (respects column widths and pinned zones)
- Virtualized on the horizontal axis in sync with the center lane column virtualization
- Sticky in the same way as the header band

### Floating filter cell content

Each floating filter cell renders a compact single-line input appropriate for the column's `filterType`:

| filterType | Floating filter widget                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| `text`     | Text input with debounce (300ms)                                                |
| `number`   | Number input with debounce                                                      |
| `date`     | Date input (`<input type="date">`)                                              |
| `set`      | Clickable badge showing active set count; click opens the full set filter popup |
| `none`     | Empty cell (no filter for this column)                                          |

The floating filter widget shows the **current filter value** from `FilterModel`. Changing it calls `api.setFilterModel(...)` with the updated condition for that column. It does not replace the full filter panel — it is a quick entry surface.

For compound filters (AND/OR with two conditions), the floating filter shows condition1's input only. A `[=]` indicator shows that a compound filter is active. Clicking it opens the full filter menu for that column.

### Floating filter renderer (new)

```ts
// packages/core/src/renderer/floatingFilterRenderer.ts

export class FloatingFilterRenderer {
	mount(container: HTMLElement): void;
	unmount(): void;
	paint(columns: InternalColumnDef[], filterModel: FilterModel, viewport: LayoutPlan): void;
}
```

The renderer is owned by `headerRenderer.ts` — it creates and delegates to `FloatingFilterRenderer` when `showFloatingFilters` is true.

In the React adapter, floating filter cells are React portal cells (similar to how the sidebar panels work) so they can contain React components (date pickers, etc.).

### Column definition additions

```ts
// columnDef.ts

/**
 * Custom floating filter component. Receives current filter value and calls
 * onChange with the new filter condition. If omitted, the built-in widget is used.
 */
floatingFilterRenderer?: React.ComponentType<FloatingFilterRendererProps>;

export interface FloatingFilterRendererProps {
  colDef: ColumnDef;
  filterModel: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter | null) => void;
}
```

## Phases

### Phase 1 — Layout height adjustment

- Add `showFloatingFilters` to `GridState` and `GridApi`
- When true, add `--og-floating-filter-height` (default 36px) to header zone height in `geometryController.ts`
- Verify header zone repaints correctly when toggled

### Phase 2 — `FloatingFilterRenderer` skeleton

- New file: `packages/core/src/renderer/floatingFilterRenderer.ts`
- Renders empty cells for each column at correct positions
- Integrated into `headerRenderer.ts` paint cycle
- Text filter input works (calls `setFilterModel` on change, debounced)

### Phase 3 — Number and date inputs

- Number floating filter input
- Date floating filter input (browser native `<input type="date">`)

### Phase 4 — Set filter compact badge

- Set filter shows: "3 selected" badge or "All" when no filter
- Click → opens the set filter popup (reuse the popup from Plan 059's filter UI)

### Phase 5 — Compound filter indicator

- When a compound filter is active, show a `[∧]` or `[∨]` indicator (AND/OR)
- Click → opens full filter menu for that column

### Phase 6 — Column virtualization alignment

- Floating filter cells respect `colStart`/`colEnd` virtual range (same as body cells)
- Pinned zone floating filters always rendered

### Phase 7 — Custom `floatingFilterRenderer` support

- React portal mounting for custom floating filter components
- `FloatingFilterRendererProps` type exported from React package

### Phase 8 — Demo + GridState toggle

- Add "Show Floating Filters" toggle to the main data grid demo toolbar
- Default off in all existing demos

## STOP conditions

- Do not implement floating filters for group columns in this plan.
- Do not implement floating filter animations (open/close row) in this plan — static height change only.
- Do not support three-condition compound filter display in floating filter cells.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Toggle `showFloatingFilters` → filter row appears below headers. Type in text input → rows filter in real time. Set filter badge shows active value count. Date filter input sets date range. Custom `floatingFilterRenderer` receives correct props.
