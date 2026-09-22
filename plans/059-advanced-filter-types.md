# Plan 059: Advanced Filter Types (Set Filter + Date Filter)

> The current filter model supports a single flat operator per column (`contains`, `equals`, `gt`, etc.) — no compound logic, no set membership, no date range. This is the single biggest feature gap vs AG Grid Community. This plan adds three things: (1) a `SetFilter` type that shows a checkbox list of distinct values, (2) a `DateFilter` type with date range operators, and (3) compound conditions (AND/OR) within a single column filter. It also bumps the state schema version (from Plan 055) because the filter model shape changes.

## Status

- **Priority**: P1 — biggest user-visible filter gap
- **Effort**: L
- **Risk**: MEDIUM — filter model shape change requires schema version bump (Plan 055 must be done first)
- **Depends on**: 055 (schema versioning), 056 (valueFormatter — set filter uses formatted values for display)
- **Category**: feature, filtering, UX
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## Current filter model (to change)

```ts
// Current — flat, one operator per column
type FilterModelItem = {
	operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte';
	value: string | number;
};
type FilterModel = Record<string, FilterModelItem | unknown>;
```

## New filter model (v2 schema)

```ts
// New — discriminated union, supports compound conditions

type TextFilterCondition = {
	type: 'text';
	operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'blank' | 'notBlank';
	value: string;
};

type NumberFilterCondition = {
	type: 'number';
	operator: 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'inRange' | 'blank' | 'notBlank';
	value: number;
	valueTo?: number; // for inRange
};

type DateFilterCondition = {
	type: 'date';
	operator: 'equals' | 'before' | 'after' | 'inRange' | 'blank' | 'notBlank';
	dateFrom: string; // ISO 8601 date string
	dateTo?: string; // for inRange
};

type SetFilterCondition = {
	type: 'set';
	values: (string | number | null)[]; // null = include blanks
};

type FilterCondition = TextFilterCondition | NumberFilterCondition | DateFilterCondition | SetFilterCondition;

type CompoundFilterCondition = {
	type: 'compound';
	operator: 'AND' | 'OR';
	conditions: [FilterCondition, FilterCondition]; // exactly two for now
};

type ColumnFilter = FilterCondition | CompoundFilterCondition;

type FilterModel = Record<string, ColumnFilter>;
```

## Column definition additions

```ts
// columnDef.ts

export interface ColumnDef<TRowData = unknown> {
	// ...

	/**
	 * Type of filter UI to show for this column.
	 * 'text' (default) | 'number' | 'date' | 'set' | 'none'
	 */
	filterType?: 'text' | 'number' | 'date' | 'set' | 'none';

	/**
	 * For set filter: custom list of values to show.
	 * If omitted, values are derived from current row data.
	 */
	filterValues?: (string | number | null)[];
}
```

## Phases

### Phase 1 — Core filter model types + migration

- Rewrite filter model types in `GridState.ts`
- Bump `GRID_STATE_SCHEMA_VERSION` to 2 (Plan 055 infrastructure)
- Add migration function `migrateV1toV2(old)` that converts flat `FilterModelItem` → `TextFilterCondition` or `NumberFilterCondition` based on operator
- Update row pipeline filter stage (`groupStage.ts` / filter allocation) to evaluate new condition types

### Phase 2 — Set filter pipeline logic

- `SetFilter` evaluation: cell value (formatted) must be in `values` set
- Derive distinct values from current row data when `filterValues` is not specified
- Handle `null` in values set (matches blank cells)
- Performance: pre-compute Set from values array, not linear scan

### Phase 3 — Date filter pipeline logic

- Parse `dateFrom`/`dateTo` as `Date` objects once at filter application
- `before`: `cellDate < dateFrom`
- `after`: `cellDate > dateFrom`
- `inRange`: `dateFrom <= cellDate <= dateTo`
- `equals`: same calendar day (strip time component)
- Detect date values: number (Unix ms), ISO string, JS Date in rowData

### Phase 4 — Compound filter pipeline logic

- Evaluate both conditions and combine with AND/OR
- Unit test every operator combination

### Phase 5 — Filter UI (sidebar + header menu)

The filter UI (`FiltersPanel.tsx` in React sidebar and the header column menu) needs new components:

**Text filter UI**: Operator dropdown + text input. Two-condition mode (condition1 AND/OR condition2).

**Number filter UI**: Operator dropdown + number input(s). `inRange` shows two inputs.

**Date filter UI**: Operator dropdown + date picker input(s). Use browser native `<input type="date">` initially.

**Set filter UI**: Scrollable checkbox list of distinct values. Search box at top. "Select All" / "Clear" buttons. Values use `valueFormatter` output for display.

All filter UIs live in `packages/react/src/sidebar/panels/FiltersPanel.tsx` and are also shown in the column header menu when filter icon is clicked.

### Phase 6 — Filter chip bar

Extend `filterChipBarRenderer.ts` to display human-readable labels for new filter types:

- Set filter: "Status: Active, Inactive" (join first 3, then "+N more")
- Date filter: "Date: Jan 1 – Dec 31"
- Compound: "Price: > 100 AND < 500"

### Phase 7 — GridApi additions

```ts
getFilterModel(): FilterModel;
setFilterModel(model: FilterModel): void;

// New: get distinct values for a column (used by set filter UI)
getColumnDistinctValues(colId: string): (string | number | null)[];
```

### Phase 8 — Tests

```ts
describe('set filter', () => {
  it('includes only rows with matching values', ...);
  it('null value matches blank cells', ...);
  it('empty set values = show all rows', ...);
});

describe('date filter', () => {
  it('before operator excludes date and after', ...);
  it('inRange is inclusive on both ends', ...);
});

describe('compound filter', () => {
  it('AND: both conditions must pass', ...);
  it('OR: either condition passes', ...);
});

describe('schema migration', () => {
  it('v1 flat filter migrates to v2 TextFilterCondition', ...);
  it('v1 number operator migrates to v2 NumberFilterCondition', ...);
});
```

## STOP conditions

- Do not support more than two conditions per compound filter in this plan — three-condition expressions are rare and add significant UI complexity.
- Do not implement server-side filter push in this plan — that is Plan 064.
- Do not implement custom filter components in this plan — built-in types first.
- Do not implement "blank" / "not blank" operators for set filter — set filter already handles null in its values list.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Set filter with 3 checked values shows only matching rows. Date `inRange` filter correctly excludes boundary rows. Compound AND filter requires both conditions. Schema version is 2. V1 state migrates cleanly to V2.
