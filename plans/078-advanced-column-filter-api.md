# Plan 078: Advanced Column Filter API

> **Summary**: Replace the anemic `filterType: 'set' | 'text' | ...` column option with a first-class `ColumnFilterDef` API that gives every column a powerful, fully-customisable filter — with five built-in types (`multi-select`, `async-multi-select`, `infinite-multi-select`, `single-select`, `async-single-select`), a `custom` escape hatch for arbitrary React UI, and a consistent theme-aware rendering surface across all three filter entry points: the header 3-dot menu, the floating filter row, and the sidebar Filters panel. No consumer should ever need to write their own filter component.

## Status

- **Priority**: P0 — foundational DX / developer experience
- **Effort**: XL
- **Risk**: HIGH — new filter condition types touch the row pipeline, FilterModel shape, and three rendering surfaces
- **Depends on**: Plans 065–074
- **Category**: feature, filter, dx, react-ui, core
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

The current filter system is capable but developer-hostile:

| Gap                                                                                                                                      | Impact                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `filterType: 'set'` uses a bare checkbox list — no search, no async, no pagination                                                       | Useless for columns with 1000+ distinct values              |
| Async data (user lookups, tag libraries, server enum tables) requires a fully custom `floatingFilterRenderer` with manual DOM management | 100+ lines of boilerplate per column                        |
| No single-select filter type; workarounds require custom code                                                                            | Missing common UX pattern                                   |
| `floatingFilterRenderer` is a raw DOM callback — React users must manage their own portal                                                | Leaks implementation details                                |
| `FiltersPanel` sidebar hard-codes specific editors — custom types render as "Unknown"                                                    | Panel is useless for non-standard columns                   |
| No per-column filter UI props — you can't pass request headers, transform fns, or item renderers to the built-in set editor              | Every slightly-non-standard case requires going full custom |
| Filter chip text for set filters shows raw values — no label mapping                                                                     | Poor UX for ID-based columns                                |

## Goals

1. **`ColumnFilterDef<TRowData>`** — a single, rich `filterDef` property on `ColumnDef` that supersedes `filterType` + `filterValues` + `floatingFilterRenderer` while remaining fully backwards-compatible with existing usage.
2. **Five built-in select filter types**: `multi-select`, `async-multi-select`, `infinite-multi-select`, `single-select`, `async-single-select` — each renders identically across all three surfaces.
3. **`custom` escape hatch** — pass a React component for complete control, zero boilerplate, with the grid managing state/commit/theme.
4. **Unified rendering surface** — the same React components render in the header menu, floating filter row (via React portal), and sidebar panel. No more DOM-only floating filter API.
5. **Full theme awareness** — all new filter UI reads `api.getTheme()` tokens exclusively.
6. **`FilterSelectOption` richness** — label, value, group, icon, description, count badge.
7. **Zero custom code required** — every real-world filter pattern covered.

---

## Core data model

### FilterSelectOption

```ts
// packages/core/src/filterModel.ts (or new packages/core/src/filters/filterTypes.ts)

export interface FilterSelectOption<TValue = unknown> {
	/** Display label shown in the filter UI. */
	label: string;
	/** The actual value stored in the filter condition. Must be serializable. */
	value: TValue;
	/** When true, the option is shown but cannot be selected. */
	disabled?: boolean;
	/** Group header label — consecutive options sharing the same group are rendered under one header. */
	group?: string;
	/** Optional description rendered as secondary text below the label. */
	description?: string;
	/** Numeric badge shown to the right (e.g., row count for this value). */
	count?: number;
	/** Optional icon — URL string, emoji, or a class name for an icon font. */
	icon?: string;
}
```

### FilterFetchParams / FilterFetchResult

```ts
export interface FilterFetchParams<TRowData = unknown> {
	/** Current search query typed by the user. Empty string on initial open. */
	query: string;
	/** Values already selected (useful for exclusion or "top N unselected" hints). */
	selectedValues: unknown[];
	/** Full grid API — allows reading row data, column defs, etc. */
	api: GridApi<TRowData>;
	/** The column field this filter belongs to. */
	colField: string;
	/** Any extra payload passed via `filterDef.fetchParams`. */
	params: Record<string, unknown>;
}

export interface FilterFetchResult<TValue = unknown> {
	options: FilterSelectOption<TValue>[];
	/** Total count of matching options server-side (for "X of Y" display). */
	totalCount?: number;
}
```

### FilterPageParams / FilterPageResult (infinite scroll)

```ts
export interface FilterPageParams<TRowData = unknown> extends FilterFetchParams<TRowData> {
	page: number; // 0-based
	pageSize: number; // Controlled by filterDef.pageSize (default: 50)
}

export interface FilterPageResult<TValue = unknown> {
	options: FilterSelectOption<TValue>[];
	/** When false, no more pages to load. */
	hasMore: boolean;
	/** Optional override of the total count for display. */
	totalCount?: number;
}
```

### CustomFilterRendererParams

```ts
export interface CustomFilterRendererParams<TRowData = unknown> {
	/** Current filter value — the ColumnFilter stored in FilterModel for this column, or null. */
	value: ColumnFilter | null;
	/**
	 * Call this to update the filter value without committing (live preview while typing).
	 * The grid does NOT re-run the filter pipeline until onCommit is called.
	 */
	onChange: (filter: ColumnFilter | null) => void;
	/**
	 * Call this to commit the current filter value and re-run the row pipeline immediately.
	 * Equivalent to the user clicking "Apply" in the sidebar.
	 */
	onCommit: (filter: ColumnFilter | null) => void;
	/** Full grid API. */
	api: GridApi<TRowData>;
	/** The column field being filtered. */
	colField: string;
	/** The full ColumnDef for this column. */
	column: ColumnDef<TRowData>;
	/** Active theme tokens for styling. */
	theme: ThemeTokens;
	/** The surface this renderer is being displayed on. */
	surface: 'sidebar' | 'header-menu' | 'floating';
}
```

### ColumnFilterDef

```ts
export type ColumnFilterType =
	// ── Existing (kept for backwards compat) ────────────────────────────────────
	| 'text'
	| 'number'
	| 'date'
	// ── New select types ─────────────────────────────────────────────────────────
	| 'multi-select' // Static options, multiple selection
	| 'single-select' // Static options, one selection at a time
	| 'async-multi-select' // Async fetch on query change, multiple selection
	| 'async-single-select' // Async fetch on query change, single selection
	| 'infinite-multi-select' // Server-paginated infinite scroll, multiple selection
	// ── Escape hatch ─────────────────────────────────────────────────────────────
	| 'custom'
	| 'none';

export interface ColumnFilterDef<TRowData = unknown, TValue = unknown> {
	// ── Type discriminant ────────────────────────────────────────────────────────
	type: ColumnFilterType;

	// ── Static options (multi-select, single-select) ──────────────────────────
	/**
	 * Static option list OR a sync factory called once at mount.
	 * For async options use fetchOptions / fetchPage instead.
	 */
	options?: FilterSelectOption<TValue>[] | ((api: GridApi<TRowData>) => FilterSelectOption<TValue>[]);

	// ── Async options (async-multi-select, async-single-select) ──────────────
	/**
	 * Called on mount (with empty query) and on each debounced query change.
	 * The grid manages AbortSignal cancellation — if a newer call fires before
	 * a prior promise resolves, the prior result is discarded.
	 */
	fetchOptions?: (params: FilterFetchParams<TRowData>, signal: AbortSignal) => Promise<FilterFetchResult<TValue>>;

	// ── Paginated options (infinite-multi-select) ─────────────────────────────
	/**
	 * Called for each page load. The grid calls page 0 on mount/query change
	 * and subsequent pages as the user scrolls to the bottom of the list.
	 */
	fetchPage?: (params: FilterPageParams<TRowData>, signal: AbortSignal) => Promise<FilterPageResult<TValue>>;

	// ── Custom filter renderer ────────────────────────────────────────────────
	/**
	 * Fully custom React filter component. The grid manages value state, theme,
	 * and all three rendering surfaces (sidebar, header menu, floating row).
	 * `surface` prop lets you render differently per context if needed.
	 */
	renderFilter?: (params: CustomFilterRendererParams<TRowData>) => React.ReactNode;

	/**
	 * Compact custom React component for the floating filter row only.
	 * When omitted and `renderFilter` is provided, `renderFilter` is used
	 * with `surface='floating'`.
	 */
	renderFloatingFilter?: (params: CustomFilterRendererParams<TRowData>) => React.ReactNode;

	// ── Shared UX options ─────────────────────────────────────────────────────
	/** Debounce ms for query input before firing fetchOptions (default: 250). */
	debounceMs?: number;
	/** Minimum query length before fetchOptions fires (default: 0). */
	minQueryLength?: number;
	/** Maximum height of the dropdown/list in px (default: 280). */
	maxHeight?: number;
	/** Page size for infinite scroll (default: 50). */
	pageSize?: number;
	/** Placeholder text in the search input. */
	placeholder?: string;
	/** Label shown when no options are found (default: "No options"). */
	emptyLabel?: string;
	/** Label shown while fetching (default: "Loading…"). */
	loadingLabel?: string;
	/** When true, always show the search input even for static option lists. Default: auto (show when > 8 options). */
	searchable?: boolean;
	/** When true, an "All / None" toggle is shown at the top of multi-select lists. Default: true. */
	showSelectAll?: boolean;
	/** When true, show the count of matching rows next to each option (requires client-side row model). Default: false. */
	showOptionCounts?: boolean;

	// ── Value mapping ─────────────────────────────────────────────────────────
	/**
	 * How to derive the display label for a selected value when only the value
	 * (not the full option object) is stored in FilterModel.
	 * Used by filter chips and floating filter badges.
	 * Default: String(value).
	 */
	getOptionLabel?: (value: TValue) => string;
	/**
	 * How to extract the serializable key from an option value.
	 * Must return a string or number for FilterModel serialization.
	 * Default: uses value directly if primitive, JSON.stringify otherwise.
	 */
	getOptionValue?: (value: TValue) => string | number;

	// ── Request enrichment ────────────────────────────────────────────────────
	/**
	 * Static extra payload merged into every FilterFetchParams.params call.
	 * Use for request headers, tenant IDs, context flags, etc.
	 */
	fetchParams?: Record<string, unknown>;

	// ── Filter chip text ──────────────────────────────────────────────────────
	/**
	 * Custom chip label for the filter chip bar and floating filter.
	 * When omitted, defaults to the standard chip text logic (e.g., "is one of 3 values").
	 */
	getChipLabel?: (filter: ColumnFilter) => string;
}
```

### FilterModel extension — new condition types

The existing `SetFilterCondition` covers multi-select sufficiently for client-side matching. Add a `SelectFilterCondition` that cleanly models single and multi-select with value+label pairs for display:

```ts
// Replaces SetFilterCondition for new select filter types.
// SetFilterCondition is kept for backwards compat.
export interface SelectFilterCondition {
	type: 'select';
	/** Selected option values. Length 1 for single-select, N for multi. */
	values: (string | number | null)[];
	/** Display labels parallel to values — used by chip bar without re-fetching. */
	labels?: string[];
	/** Whether the condition uses AND (all match) or OR (any match, the default). */
	operator?: 'any' | 'all';
}

// Updated union:
export type FilterCondition =
	| TextFilterCondition
	| NumberFilterCondition
	| DateFilterCondition
	| SetFilterCondition // Legacy — kept for backwards compat
	| SelectFilterCondition; // New — used by all select filter types
```

The row pipeline filter stage matches `SelectFilterCondition` identically to `SetFilterCondition` (OR membership test by default). The `'all'` operator (all values must match — unusual but valid) is supported via AND.

---

## ColumnDef integration

### Backwards compatibility

`filterType` and `filterValues` on `ColumnDef` continue to work — they are internally normalized to a `ColumnFilterDef` on mount:

```
filterType: 'set'  + filterValues: ['A', 'B']
  → filterDef: { type: 'multi-select', options: [{label:'A',value:'A'},{label:'B',value:'B'}] }

filterType: 'text'
  → filterDef: { type: 'text' }
```

The new `filterDef` property takes precedence over `filterType` / `filterValues` when both are present.

```ts
// packages/core/src/columnDef.ts (additions)

export interface ColumnDef<TRowData = unknown> {
	// ... existing fields ...

	/**
	 * Rich filter definition for this column. Supersedes `filterType` and `filterValues`.
	 * Backwards-compatible — existing filterType/filterValues still work and are
	 * normalized to filterDef internally.
	 */
	filterDef?: ColumnFilterDef<TRowData>;
}
```

---

## React component architecture

### File structure

```
packages/react/src/
  filters/
    components/
      MultiSelectFilter.tsx          ← static multi-select + search
      SingleSelectFilter.tsx         ← static single-select + search
      AsyncMultiSelectFilter.tsx     ← async + debounce + multi
      AsyncSingleSelectFilter.tsx    ← async + debounce + single
      InfiniteMultiSelectFilter.tsx  ← paginated infinite scroll + multi
      CustomFilterRenderer.tsx       ← wrapper for renderFilter prop
    compact/
      MultiSelectFilterCompact.tsx   ← floating-row compact version
      SingleSelectFilterCompact.tsx
      AsyncMultiSelectFilterCompact.tsx
      AsyncSingleSelectFilterCompact.tsx
      InfiniteMultiSelectFilterCompact.tsx
    shared/
      FilterOptionList.tsx           ← shared option list with checkboxes/radios
      FilterSearch.tsx               ← shared search input
      FilterSelectAll.tsx            ← shared "Select All / None" header
      FilterGroupHeader.tsx          ← shared group dividers
      FilterCountBadge.tsx           ← count badge chip
      useFilterFetch.ts              ← shared async fetch + cancel + debounce hook
      useFilterPage.ts               ← shared paginated fetch hook
      useClickOutside.ts             ← shared click-outside detection
    ColumnFilterRenderer.tsx         ← dispatcher: reads filterDef.type → mounts correct component
    index.ts                         ← exports all public filter components + types
```

### ColumnFilterRenderer (dispatcher)

This is the single component mounted by all three surfaces. It reads `filterDef.type` and mounts the correct sub-component:

```ts
// packages/react/src/filters/ColumnFilterRenderer.tsx

interface ColumnFilterRendererProps<TRowData = unknown> {
  api: GridApi<TRowData>;
  colField: string;
  surface: 'sidebar' | 'header-menu' | 'floating';
}

export function ColumnFilterRenderer<TRowData>({ api, colField, surface }: ColumnFilterRendererProps<TRowData>) {
  const colDef = api.getColumnDef(colField);
  const filterDef = resolveFilterDef(colDef); // Normalize filterType → filterDef
  const theme = api.getTheme();
  const [pendingFilter, setPendingFilter] = useState<ColumnFilter | null>(
    () => api.getState().filterModel?.[colField] ?? null
  );

  const commit = useCallback((filter: ColumnFilter | null) => {
    api.setFilterModel(applyFilterToModel(colField, filter, api.getState().filterModel ?? null));
  }, [api, colField]);

  const params: CustomFilterRendererParams<TRowData> = {
    value: pendingFilter,
    onChange: setPendingFilter,
    onCommit: commit,
    api,
    colField,
    column: colDef,
    theme,
    surface,
  };

  switch (filterDef.type) {
    case 'multi-select': return <MultiSelectFilter filterDef={filterDef} {...params} />;
    case 'single-select': return <SingleSelectFilter filterDef={filterDef} {...params} />;
    case 'async-multi-select': return <AsyncMultiSelectFilter filterDef={filterDef} {...params} />;
    case 'async-single-select': return <AsyncSingleSelectFilter filterDef={filterDef} {...params} />;
    case 'infinite-multi-select': return <InfiniteMultiSelectFilter filterDef={filterDef} {...params} />;
    case 'custom': return filterDef.renderFilter ? filterDef.renderFilter(params) : null;
    case 'text':
    case 'number':
    case 'date': return <LegacyFilterEditor filterDef={filterDef} {...params} />;
    default: return null;
  }
}
```

### Shared hooks

#### `useFilterFetch`

```ts
// packages/react/src/filters/shared/useFilterFetch.ts

export function useFilterFetch<TValue>(
	fetchOptions: FilterDef['fetchOptions'],
	params: FilterFetchParams,
	debounceMs: number
): {
	options: FilterSelectOption<TValue>[];
	loading: boolean;
	error: Error | null;
	totalCount: number | undefined;
};
```

- Debounces the query change.
- Creates a new `AbortController` on each call, aborts the prior one.
- Returns `loading: true` during fetch, `error` on rejection.
- Returns stale options during loading (no flash of empty list).

#### `useFilterPage`

```ts
// packages/react/src/filters/shared/useFilterPage.ts

export function useFilterPage<TValue>(
	fetchPage: FilterDef['fetchPage'],
	query: string,
	pageSize: number,
	params: FilterFetchParams
): {
	options: FilterSelectOption<TValue>[];
	loading: boolean;
	hasMore: boolean;
	loadMore: () => void;
	totalCount: number | undefined;
};
```

- Resets to page 0 on query change.
- Accumulates pages into a flat `options` array.
- Exposes `loadMore()` — called by `IntersectionObserver` at the bottom of the list.

---

## Built-in filter component specs

### MultiSelectFilter

**Sidebar (full height):**

```
┌──────────────────────────────────────────────┐
│ 🔍 [Search options…]                        │  ← FilterSearch (shown when searchable)
├──────────────────────────────────────────────┤
│ ☑ Select All (42)     ☐ None                │  ← FilterSelectAll
├──────────────────────────────────────────────┤
│ Group: Status                               │  ← FilterGroupHeader (if group present)
│   ☑ Active                           (12)   │  ← FilterOptionRow (count badge optional)
│   ☐ Inactive                          (8)   │
│   ☑ Pending                           (3)   │
├──────────────────────────────────────────────┤
│               [Apply] [Clear]                │  ← Action bar (sidebar only)
└──────────────────────────────────────────────┘
```

**Floating (compact):**

```
[Active ×] [Pending ×] [+2 more ▾]  ← selected chips with overflow
```

- Chips for selected values; click chip to deselect.
- `+N more` overflow chip opens the full multi-select dropdown anchored to the floating cell.

**Header menu:**

- Same layout as sidebar but in a fixed-width popover (300px).
- "Apply" commits immediately; no separate commit step.

### SingleSelectFilter

Same as `MultiSelectFilter` but uses radio inputs instead of checkboxes. No "Select All" header. Selecting an option immediately commits in floating/header contexts; in sidebar a separate Apply button is shown.

### AsyncMultiSelectFilter

Same layout as `MultiSelectFilter` but:

- Search input is always shown (required for async).
- On mount: fetches with empty query (unless `minQueryLength > 0`).
- Loading state: skeleton rows or spinner inside the list.
- Error state: inline error message with retry button.
- Empty state: `filterDef.emptyLabel` text.
- Previously-selected values are always shown at the top, even if not returned by the current query (they were loaded on a prior query).

### AsyncSingleSelectFilter

Same as `AsyncMultiSelectFilter` with radio selection and immediate commit.

### InfiniteMultiSelectFilter

Same as `AsyncMultiSelectFilter` but:

- Uses `fetchPage` instead of `fetchOptions`.
- An `IntersectionObserver` sentinel at the bottom of the list triggers `loadMore()`.
- Incremental loading indicator at the bottom when `hasMore`.
- Query change resets to page 0 and clears accumulated results.

---

## Surface integration

### 1. Sidebar FiltersPanel

**Current:** `ColumnFilterRow` renders a local `ConditionEditor` that hard-codes text/number/date/set.

**New:** `ColumnFilterRow` renders `<ColumnFilterRenderer api={api} colField={colField} surface="sidebar" />` for columns whose `filterDef.type` is a new select type or `custom`. For legacy `text`/`number`/`date` columns, the existing `ConditionEditor` logic is preserved unchanged.

The sidebar panel already uses React, so `ColumnFilterRenderer` mounts directly — no portal needed.

### 2. Header 3-dot menu

**Current:** `headerMenuController.ts` builds a DOM-based filter section with a raw text/operator input.

**New:** The header menu creates a dedicated `<div class="og-header-filter-panel">` mount point inside the popover and uses `ReactDOM.createRoot` to mount `<ColumnFilterRenderer surface="header-menu" />` into it. On popover close, the root is unmounted.

The filter section in `headerMenuController.ts` becomes a thin shell that delegates to the React component.

For legacy text/number/date columns the existing DOM-based approach is preserved and the React mount is skipped.

### 3. Floating filter row

**Current:** `floatingFilterRenderer.ts` calls `column.floatingFilterRenderer(params)` (DOM callback) or renders a default text input in DOM.

**New approach:**

Add a `FloatingFilterReactBridge` class that:

1. Creates a React root per floating cell element.
2. Mounts `<ColumnFilterRenderer surface="floating" />` into it.
3. Unmounts when the cell is recycled or the column scrolls out of view.

The `floatingFilterRenderer.ts` checks `filterDef.type` for each column:

- If it's a new select type or `custom` with `renderFloatingFilter` → mount via React bridge.
- If it's legacy text/number/date → use existing DOM approach unchanged.

The compact floating versions live in `filters/compact/` and are automatically used when `surface === 'floating'` inside `ColumnFilterRenderer`.

---

## Filter chip bar enhancements

The filter chip bar (`filterChipBarRenderer.ts`) currently generates chip text via `getFilterChipText(filter)`. For `SelectFilterCondition`:

- Use `filterDef.getChipLabel(filter)` if provided.
- Otherwise: `"is {label1}"` (single), `"is one of {label1}, {label2}"` (2 values), `"is one of {N} values"` (3+).
- Labels come from `SelectFilterCondition.labels[]` (stored alongside values for display without re-fetching).

---

## FilterModel serialization

`SelectFilterCondition` stores `values` (primitive keys) and `labels` (display strings). Both are serializable. The persistence adapter saves/loads them transparently — no special handling needed.

For async filter types, the stored `values` are the raw keys returned by `getOptionValue(option)`. On restore, the filter is applied immediately with the stored keys (the row pipeline doesn't need labels). Labels are only needed for display in chips/badges — they're in `SelectFilterCondition.labels`.

---

## Row pipeline changes

In `packages/core/src/rowModel.ts`, add `matchSelectFilter()` alongside the existing matchers:

```ts
function matchSelectFilter(rawValue: unknown, condition: SelectFilterCondition): boolean {
	if (condition.values.length === 0) return true;
	const str = rawValue == null ? null : String(rawValue);
	if (condition.operator === 'all') {
		// All values must match (unusual case)
		return condition.values.every((v) => (v === null ? rawValue == null : String(v) === str));
	}
	// Default: OR — any value matches
	return condition.values.some((v) => (v === null ? rawValue == null : String(v) === str));
}
```

Add `SelectFilterCondition` handling in `prepareCondition()` and `matchPreparedFilter()`.

---

## Export surface

All public types exported from `@eregister/wit-grid-core`:

- `FilterSelectOption`, `FilterFetchParams`, `FilterFetchResult`, `FilterPageParams`, `FilterPageResult`
- `CustomFilterRendererParams`, `ColumnFilterDef`, `ColumnFilterType`, `SelectFilterCondition`

All public components and factories exported from `@eregister/wit-grid-react`:

- `ColumnFilterRenderer`
- (No need to export individual filter sub-components — they're composed internally)

---

## Developer experience examples

### 1. Static multi-select — the simplest case

```ts
// ColumnDef
{
  field: 'status',
  header: 'Status',
  filterDef: {
    type: 'multi-select',
    options: [
      { label: 'Active',   value: 'active',   count: 12 },
      { label: 'Inactive', value: 'inactive', count: 8  },
      { label: 'Pending',  value: 'pending',  count: 3  },
    ],
  },
}
```

### 2. Auto-populated from data

```ts
filterDef: {
  type: 'multi-select',
  options: (api) =>
    api.getColumnDistinctValues('category').map(v => ({ label: String(v ?? '(blank)'), value: v })),
  showOptionCounts: true,  // Grid auto-computes matching row counts
}
```

### 3. Async search (server user lookup)

```ts
filterDef: {
  type: 'async-multi-select',
  placeholder: 'Search users…',
  debounceMs: 300,
  fetchOptions: async ({ query, params }, signal) => {
    const res = await fetch(`/api/users?q=${encodeURIComponent(query)}&tenantId=${params.tenantId}`, { signal });
    const { users } = await res.json();
    return {
      options: users.map(u => ({ label: u.name, value: u.id, description: u.email })),
      totalCount: users.totalCount,
    };
  },
  fetchParams: { tenantId: 'acme-corp' },
  getOptionLabel: (value) => userCache.get(value)?.name ?? String(value),
}
```

### 4. Infinite scroll tag library

```ts
filterDef: {
  type: 'infinite-multi-select',
  placeholder: 'Search tags…',
  pageSize: 30,
  fetchPage: async ({ query, page, pageSize }, signal) => {
    const res = await fetch(`/api/tags?q=${query}&page=${page}&size=${pageSize}`, { signal });
    const { items, hasMore } = await res.json();
    return {
      options: items.map(t => ({ label: t.name, value: t.id, group: t.category })),
      hasMore,
    };
  },
}
```

### 5. Single-select enum

```ts
filterDef: {
  type: 'single-select',
  options: [
    { label: 'High',   value: 'high',   icon: '🔴' },
    { label: 'Medium', value: 'medium', icon: '🟡' },
    { label: 'Low',    value: 'low',    icon: '🟢' },
  ],
}
```

### 6. Fully custom filter (date range picker, slider, etc.)

```ts
filterDef: {
  type: 'custom',
  renderFilter: ({ value, onCommit, theme }) => (
    <ProbabilityRangeSlider
      value={value as NumberFilterCondition ?? { type: 'number', operator: 'inRange', value: 0, valueTo: 100 }}
      onChange={(min, max) => onCommit({ type: 'number', operator: 'inRange', value: min, valueTo: max })}
      style={{ color: theme.textColor, accentColor: theme.focusRing }}
    />
  ),
  renderFloatingFilter: ({ value, onCommit, theme }) => (
    <CompactSlider value={value} onCommit={onCommit} theme={theme} />
  ),
  getChipLabel: (filter) => {
    const f = filter as NumberFilterCondition;
    return `${f.value}% – ${f.valueTo}%`;
  },
}
```

---

## Phases

### Phase 1 — Core data model and row pipeline (packages/core)

1. Create `packages/core/src/filters/filterTypes.ts` with:
    - `FilterSelectOption`, `FilterFetchParams`, `FilterFetchResult`, `FilterPageParams`, `FilterPageResult`
    - `CustomFilterRendererParams`, `ColumnFilterDef`, `ColumnFilterType`
    - `SelectFilterCondition`
2. Add `filterDef?: ColumnFilterDef` to `ColumnDef` in `columnDef.ts`.
3. Add `SelectFilterCondition` to the `FilterCondition` union in `filterModel.ts`.
4. Add `matchSelectFilter()` to `rowModel.ts` and wire into `matchPreparedFilter()`.
5. Add normalization function `resolveFilterDef(colDef)` that converts legacy `filterType`/`filterValues` → `ColumnFilterDef`.
6. Update `getFilterChipText()` in `filterOperations.ts` to handle `SelectFilterCondition`.
7. Export all new types from `packages/core/src/index.ts`.
8. Unit tests: `matchSelectFilter` with single/multi values, `null` values, `'all'` operator.

### Phase 2 — Shared React hooks and primitives (packages/react)

1. Implement `useFilterFetch` — debounced async fetch with AbortController cancel.
2. Implement `useFilterPage` — paginated fetch with IntersectionObserver `loadMore`.
3. Implement shared components: `FilterOptionList`, `FilterSearch`, `FilterSelectAll`, `FilterGroupHeader`, `FilterCountBadge`.
4. Implement `ColumnFilterRenderer` dispatcher.
5. Unit tests for `useFilterFetch`: debounce timing, abort cancellation, stale result discard.

### Phase 3 — Built-in filter components (packages/react)

1. `MultiSelectFilter` — static options + search + select all + groups + count badges.
2. `SingleSelectFilter` — static options + search + radio.
3. `AsyncMultiSelectFilter` — useFilterFetch + loading/error/empty states + preserved selections.
4. `AsyncSingleSelectFilter` — useFilterFetch + radio + immediate commit.
5. `InfiniteMultiSelectFilter` — useFilterPage + IntersectionObserver + incremental loading.
6. Compact variants for floating filter row (`surface === 'floating'`).
7. Demo: Add new filter type examples to `FloatingFiltersDemo` and `SidebarPanelsDemo`.

### Phase 4 — Sidebar FiltersPanel integration (packages/react)

1. Update `ColumnFilterRow` to mount `<ColumnFilterRenderer surface="sidebar" />` for new filter types.
2. Preserve existing `ConditionEditor` for legacy text/number/date.
3. Update `FiltersPanel` active-filter count badge to handle `SelectFilterCondition`.
4. Update `FiltersPanel` clear logic for new condition types.
5. Test: All five new filter types render correctly in the sidebar panel.

### Phase 5 — Header menu integration (packages/core + packages/react)

1. Add `FilterReactBridge` utility in `packages/react/src/filters/FilterReactBridge.ts`:
    - `mount(container: HTMLElement, api, colField, surface)` → creates React root
    - `unmount()` → destroys React root
2. In `headerMenuController.ts`: for columns with new `filterDef` types, create mount point and call `FilterReactBridge.mount()`. For legacy types, keep existing DOM approach.
3. On popover `hide()`, call `FilterReactBridge.unmount()`.
4. Export `FilterReactBridge` from react package for consumer use.
5. Test: Opening header menu for async-multi-select column shows searchable list.

### Phase 6 — Floating filter row integration (packages/core + packages/react)

1. Extend `FloatingFilterRendererParams` with `filterDef: ColumnFilterDef` (resolved).
2. In `floatingFilterRenderer.ts`: for new `filterDef` types, delegate cell content to `FilterReactBridge.mount(cell, ...)` with `surface='floating'`.
3. On column scroll out of view / unmount: call `FilterReactBridge.unmount()`.
4. Compact variants auto-activate when `surface === 'floating'` inside `ColumnFilterRenderer`.
5. Test: Async-multi-select floating filter shows compact chip display + opens full dropdown on click.

### Phase 7 — Architecture guards and exports

1. Add guard: `filter component files must not import renderer files`.
2. Add guard: `SelectFilterCondition is exported from index.ts`.
3. Export all public types from `@eregister/wit-grid-react`: `ColumnFilterDef`, `FilterSelectOption`, `FilterFetchParams`, etc.
4. Update `plans/README.md`.

---

## Out of scope

- Server-side filtering API integration (SSRM filter model is already sent to the server as-is)
- Filter presets / saved filter states (covered by Plan 076 Views)
- Filter validation (e.g., "value must be positive") — use `ColumnDef.valueSetter` validation instead
- Filter history / undo for filter changes
- Cross-column filter dependencies (e.g., "Region options depend on selected Country")
- Filter tooltip / help text per column
- Filter locking (prevent users from modifying specific column filters)
