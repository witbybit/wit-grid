# Plan 004 — Declarative Style Rules

**Written against commit:** `970c777`  
**Branch:** `rendering-architecture-v2-wip-2`

---

## Why it matters

`api.setStyleSlots()` is powerful but fully imperative — every demo page that uses conditional cell/row coloring wires up multi-line callback functions. The typical pattern (if `value > 0` → green, if `value < 0` → red, if field = X → bold) repeats identically across `RealtimeDashboard`, `CalculationsArena`, `GanttSchedulingWorkspace`, and `NestedTablesGrouping`.

A declarative `styleRules` prop on `<WitGrid>` / `useClientGrid` lets users describe those rules as data. The runtime compiles them into a single `setStyleSlots` callback — zero new engine code, same performance, dramatically less boilerplate.

---

## Scope

**In scope:**

- `packages/react/src/styleRules.ts` — new file: `StyleRule` type + `compileStyleRules` function
- `packages/react/src/styleRules.test.ts` — new file: unit tests
- `packages/react/src/types.ts` — add `styleRules` to `ClientGridOptions` and `ServerGridOptions`
- `packages/react/src/useGrid.ts` — apply `styleRules` when `columns` or `styleRules` change
- `packages/react/src/WitGrid.tsx` — thread `styleRules` prop
- `packages/react/src/index.ts` — export `StyleRule` type
- `demo/src/pages/RealtimeDashboard.tsx` — replace imperative `setStyleSlots` with `styleRules`
- `demo/src/pages/CalculationsArena.tsx` — replace imperative `setStyleSlots` with `styleRules`

**Out of scope:**

- `packages/core` — no engine changes
- Other demo pages that don't use `setStyleSlots`
- Animated transitions or CSS-in-JS beyond class names
- `headerCellClass` rules (only `rowClass` and `cellClass` in this plan)

---

## Current state

### `packages/core/src/columnDef.ts` — `GridStyleSlots` (line ~202)

```ts
export interface GridStyleSlots<TRowData = unknown> {
  rowClass?: (row: TRowData, params: GridRowClassParams<TRowData>) => string;
  cellClass?: (col: ColumnDef<TRowData>, row: TRowData, params: GridCellClassParams<TRowData>) => string;
  headerCellClass?: (col: ColumnDef<TRowData>) => string;
  beforeCellRender?: ...;
  afterCellRender?: ...;
  groupRowClass?: ...;
  detailRowClass?: ...;
}
```

### `demo/src/pages/RealtimeDashboard.tsx` — imperative pattern (lines ~40–80)

```ts
useEffect(() => {
	api.setStyleSlots({
		rowClass: (row) => {
			const changeVal = parseFloat(row.change) || 0;
			if (changeVal > 0) return 'border-l-2 border-emerald-500/60 bg-emerald-950/5 ...';
			if (changeVal < 0) return 'border-l-2 border-rose-500/60 bg-rose-950/5 ...';
			return 'border-l-2 border-slate-800 ...';
		},
		cellClass: (col, row) => {
			if (col.field === 'change') {
				const changeVal = parseFloat(row.change) || 0;
				if (changeVal > 0) return 'text-emerald-400 font-extrabold font-mono';
				if (changeVal < 0) return 'text-rose-400 font-extrabold font-mono';
			}
			if (col.field === 'price') return 'font-mono font-bold text-slate-200';
			return '';
		},
	});
}, [api]);
```

### `demo/src/pages/CalculationsArena.tsx` — uses `setStyleSlots` at line ~35

---

## Repo conventions

- New types in `packages/react/src/` use PascalCase interfaces, camelCase functions.
- No `@eregister/wit-grid-core/internal` imports in new public API files.
- Helper functions are pure and co-located with their type in the same file.
- Tests use `vitest` `describe`/`it`/`expect` — no mocks needed for pure functions.

---

## Implementation steps

### Step 1 — Design and write `StyleRule` type + `compileStyleRules`

Create `packages/react/src/styleRules.ts`:

```ts
import type { ColumnDef, GridStyleSlots, GridRowClassParams, GridCellClassParams } from '@eregister/wit-grid-core';

// ─── Rule types ───────────────────────────────────────────────────────────────

/** A rule that applies classes to an entire row when `when` returns true. */
export interface RowStyleRule<TRowData = unknown> {
	kind: 'row';
	when: (row: TRowData, params: GridRowClassParams<TRowData>) => boolean;
	rowClass: string;
}

/** A rule that applies classes to a specific cell when `when` returns true. */
export interface CellStyleRule<TRowData = unknown> {
	kind: 'cell';
	field?: string; // If set, only applied to cells in this column.
	when: (row: TRowData, col: ColumnDef<TRowData>, params: GridCellClassParams<TRowData>) => boolean;
	cellClass: string;
}

export type StyleRule<TRowData = unknown> = RowStyleRule<TRowData> | CellStyleRule<TRowData>;

// ─── Compiler ─────────────────────────────────────────────────────────────────

export function compileStyleRules<TRowData>(rules: StyleRule<TRowData>[]): GridStyleSlots<TRowData> {
	if (rules.length === 0) return {};

	const rowRules = rules.filter((r): r is RowStyleRule<TRowData> => r.kind === 'row');
	const cellRules = rules.filter((r): r is CellStyleRule<TRowData> => r.kind === 'cell');

	const styleSlots: GridStyleSlots<TRowData> = {};

	if (rowRules.length > 0) {
		styleSlots.rowClass = (row, params) => {
			const classes: string[] = [];
			for (const rule of rowRules) {
				if (rule.when(row, params)) classes.push(rule.rowClass);
			}
			return classes.join(' ');
		};
	}

	if (cellRules.length > 0) {
		styleSlots.cellClass = (col, row, params) => {
			const classes: string[] = [];
			for (const rule of cellRules) {
				if (rule.field !== undefined && rule.field !== col.field) continue;
				if (rule.when(row, col, params)) classes.push(rule.cellClass);
			}
			return classes.join(' ');
		};
	}

	return styleSlots;
}
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no TS errors.

---

### Step 2 — Write tests for `compileStyleRules`

Create `packages/react/src/styleRules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileStyleRules } from './styleRules.js';
import type { StyleRule } from './styleRules.js';

interface Row {
	id: string;
	change: string;
	price: number;
	risk: string;
}

const makeRowParams = (overrides = {}) => ({
	rowId: 'r1',
	rowIndex: 0,
	isFocused: false,
	isSelected: false,
	isLoading: false,
	selection: { focus: null, range: null, selectedRowIds: new Set<string>() } as any,
	...overrides,
});

const makeCellParams = (field: string, value: unknown, overrides = {}) => ({
	rowId: 'r1',
	rowIndex: 0,
	col: { field, header: field } as any,
	colField: field,
	colIndex: 0,
	isFocused: false,
	isRowFocused: false,
	isRowSelected: false,
	isSelected: false,
	isEditing: false,
	value,
	rawValue: value,
	isLoading: false,
	selection: { focus: null, range: null, selectedRowIds: new Set<string>() } as any,
	...overrides,
});
```

**Tests to write (≥ 10):**

1. **Empty rules array → empty `{}` styleSlots**.
2. **Row rule returns class when `when` is true**.
3. **Row rule returns empty string when `when` is false**.
4. **Multiple row rules — all matching rules are joined with space**.
5. **Cell rule without `field` applies to any column when `when` is true**.
6. **Cell rule with `field` applies only to that column**.
7. **Cell rule with `field` does NOT apply to other columns**.
8. **Multiple cell rules — matched classes are joined**.
9. **Mixed row + cell rules compile to `styleSlots` with both `rowClass` and `cellClass`**.
10. **Row-only rules produce no `cellClass` in output**.
11. **Cell-only rules produce no `rowClass` in output**.
12. **`compileStyleRules` is a pure function — calling it twice with same input produces equivalent output**.

**Verification:** `pnpm -F @eregister/wit-grid-react test -- styleRules` — all pass.

---

### Step 3 — Add `styleRules` to options types

In `packages/react/src/types.ts`:

```diff
+import type { StyleRule } from './styleRules.js';

 export interface ClientGridOptions<TRowData> extends GridRenderOptions<TRowData> {
   rows: TRowData[];
   columns: ColumnDef<TRowData>[];
   getRowId?: (row: TRowData) => string;
   initialState?: Partial<GridState<TRowData>>;
   rowSelection?: 'single' | 'multiple';
   persistence?: GridPersistenceAdapter;
   columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
+  /**
+   * Declarative array of row/cell styling rules. Compiled into a single `setStyleSlots`
+   * call — same performance as the imperative API, less boilerplate for common patterns.
+   *
+   * Rules are evaluated in order; all matching rules contribute classes (space-joined).
+   *
+   * @example
+   * styleRules={[
+   *   { kind: 'row',  when: (row) => row.pnl < 0, rowClass: 'text-rose-400' },
+   *   { kind: 'cell', field: 'price', when: (row) => row.price > 100, cellClass: 'font-bold' },
+   * ]}
+   */
+  styleRules?: StyleRule<TRowData>[];
 }

 export interface ServerGridOptions<TRowData> extends GridRenderOptions<TRowData> {
   // ... existing fields ...
+  styleRules?: StyleRule<TRowData>[];
 }
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 4 — Apply `styleRules` in `useClientGrid`

In `packages/react/src/useGrid.ts`:

```diff
+import { compileStyleRules } from './styleRules.js';

 export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
   // ...existing hook body...

+  useEffect(() => {
+    if (!options.styleRules || options.styleRules.length === 0) {
+      api.setStyleSlots(undefined);
+      return;
+    }
+    api.setStyleSlots(compileStyleRules(options.styleRules));
+  }, [api, options.styleRules]);

   return api;
 }
```

Apply the same pattern to `useServerGrid`.

**Note on referential stability:** `styleRules` is an array and will trigger the effect on every render if defined inline. Document in JSDoc on `StyleRule` (Step 3) that users should memoize the array with `useMemo`. This matches the existing convention for `columns`.

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 5 — Thread `styleRules` through `WitGrid`

In `packages/react/src/WitGrid.tsx`:

1. Add `styleRules?: StyleRule<TRowData>[]` to `WitGridProps`.
2. In `WitGridManagedClient`, destructure `styleRules` and pass it to `useClientGrid`.
3. `WitGridInner` does not need `styleRules` — it only receives `api`.

```diff
 export interface WitGridProps<TRowData = unknown> {
   // ...
   columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
+  styleRules?: StyleRule<TRowData>[];
 }

 function WitGridManagedClient<TRowData>({
-  rows, columns, columnTypes, getRowId, initialState, ...rest
+  rows, columns, columnTypes, styleRules, getRowId, initialState, ...rest
 }: WitGridProps<TRowData> & { rows: TRowData[] }) {
   const api = useClientGrid<TRowData>({
-    rows, columns: columns ?? [], columnTypes, getRowId, initialState, ...
+    rows, columns: columns ?? [], columnTypes, styleRules, getRowId, initialState, ...
   });
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 6 — Export from `packages/react/src/index.ts`

```diff
+export type { StyleRule, RowStyleRule, CellStyleRule } from './styleRules.js';
+export { compileStyleRules } from './styleRules.js';
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 7 — Update `RealtimeDashboard` demo

In `demo/src/pages/RealtimeDashboard.tsx`:

1. Remove the `useEffect` block that calls `api.setStyleSlots(...)`.
2. Import `StyleRule` from `@eregister/wit-grid-react`.
3. Define `styleRules` as a `useMemo`-stabilized array and pass it to `useClientGrid` (or `<WitGrid>` if in inline mode).

**Before (abbreviated):**

```ts
useEffect(() => {
  api.setStyleSlots({
    rowClass: (row) => {
      const changeVal = parseFloat(row.change) || 0;
      if (changeVal > 0) return 'border-l-2 border-emerald-500/60 bg-emerald-950/5 ...';
      if (changeVal < 0) return 'border-l-2 border-rose-500/60 bg-rose-950/5 ...';
      return 'border-l-2 border-slate-800 ...';
    },
    cellClass: (col, row) => { ... },
    headerCellClass: (col) => { ... },
  });
}, [api]);
```

**After:**

```ts
import { type StyleRule } from '@eregister/wit-grid-react';
// ...

const styleRules = useMemo<StyleRule<DashboardStockRow>[]>(
	() => [
		{
			kind: 'row',
			when: (row) => (parseFloat(row.change) || 0) > 0,
			rowClass: 'border-l-2 border-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-100/90 transition-all duration-200',
		},
		{
			kind: 'row',
			when: (row) => (parseFloat(row.change) || 0) < 0,
			rowClass: 'border-l-2 border-rose-500/60 bg-rose-950/5 hover:bg-rose-900/10 text-rose-100/90 transition-all duration-200',
		},
		{
			kind: 'row',
			when: (row) => (parseFloat(row.change) || 0) === 0,
			rowClass: 'border-l-2 border-slate-800 bg-slate-900/5 hover:bg-slate-800/10 transition-all duration-200',
		},
		{
			kind: 'cell',
			field: 'change',
			when: (row) => (parseFloat(row.change) || 0) > 0,
			cellClass: 'text-emerald-400 font-extrabold font-mono',
		},
		{
			kind: 'cell',
			field: 'change',
			when: (row) => (parseFloat(row.change) || 0) < 0,
			cellClass: 'text-rose-400 font-extrabold font-mono',
		},
		{
			kind: 'cell',
			field: 'price',
			when: () => true,
			cellClass: 'font-mono font-bold text-slate-200',
		},
		// Risk field — three variants
		{ kind: 'cell', field: 'risk', when: (row) => row.risk === 'High', cellClass: 'text-rose-450 font-bold' },
		{ kind: 'cell', field: 'risk', when: (row) => row.risk === 'Medium', cellClass: 'text-amber-450 font-bold' },
		{ kind: 'cell', field: 'risk', when: (row) => row.risk === 'Low', cellClass: 'text-emerald-450 font-bold' },
	],
	[]
);

const api = useClientGrid({ rows, columns, styleRules /* ... */ });
```

**Note:** `headerCellClass` in the original uses a function not covered by `StyleRule` (it applies to the header, not data rows). Keep that as a one-off `setStyleSlots({ headerCellClass: ... })` call in a separate `useEffect`, or just remove it if it's non-essential for the demo.

**Verification:** Start demo (`pnpm dev:demo`), open RealtimeDashboard, confirm row/cell coloring is identical to before.

---

### Step 8 — Update `CalculationsArena` demo

Open `demo/src/pages/CalculationsArena.tsx`. Find the `setStyleSlots` call (line ~35). Apply the same migration pattern as Step 7: replace the imperative callback with a `useMemo`-stabilized `styleRules` array and pass it to `useClientGrid`.

**Verification:** Open CalculationsArena page in the demo, confirm styling is unchanged.

---

## Files in scope

| File                                    | Change type                               |
| --------------------------------------- | ----------------------------------------- |
| `packages/react/src/styleRules.ts`      | **New file**                              |
| `packages/react/src/styleRules.test.ts` | **New file**                              |
| `packages/react/src/types.ts`           | Add `styleRules` to options types         |
| `packages/react/src/useGrid.ts`         | Apply `styleRules` in effect              |
| `packages/react/src/WitGrid.tsx`       | Thread `styleRules` prop                  |
| `packages/react/src/index.ts`           | Export new types + function               |
| `demo/src/pages/RealtimeDashboard.tsx`  | Replace `setStyleSlots` with `styleRules` |
| `demo/src/pages/CalculationsArena.tsx`  | Replace `setStyleSlots` with `styleRules` |

**Explicitly out of scope:** `packages/core`, all other demo pages, `headerCellClass` / `groupRowClass` / `detailRowClass` rule kinds.

---

## Done criteria

```bash
pnpm -F @eregister/wit-grid-react build         # exits 0
pnpm -F @eregister/wit-grid-react test          # all tests pass including new styleRules.test.ts
pnpm dev:demo                          # RealtimeDashboard and CalculationsArena styling unchanged
```

- `styleRules.test.ts` has ≥ 12 test cases.
- `api.setStyleSlots` is no longer called in `RealtimeDashboard.tsx` or `CalculationsArena.tsx`.
- Both demo pages pass `styleRules` via `useMemo`.
- `StyleRule`, `RowStyleRule`, `CellStyleRule`, `compileStyleRules` are all exported from `@eregister/wit-grid-react`.

---

## Escape hatches

- If `setStyleSlots` is called in a place that also sets `headerCellClass`, `groupRowClass`, or `detailRowClass` — keep a separate `useEffect` for those and only migrate the `rowClass`/`cellClass` portion to `styleRules`.
- If `options.styleRules` changes identity every render (inline array literal) during local dev, the effect will spam `setStyleSlots`. This is expected — document it, and add a `useMemo` in the demo. Do not attempt to deep-compare the array inside the hook.
- **STOP and report back** if `GridStyleSlots` in core has changed its `rowClass` or `cellClass` signature — the `compileStyleRules` function will need updated parameter types.

---

## Maintenance note

To add new rule kinds (e.g., `headerCellClass`, `groupRowClass`), add a new discriminated union member to `StyleRule` in `styleRules.ts` and a corresponding branch in `compileStyleRules`. Existing rule kinds are unaffected.
