# Plan 002 — ColumnType Registry

**Written against commit:** `970c777`  
**Branch:** `rendering-architecture-v2-wip-2`

---

## Why it matters

Every column that uses a built-in cell type (`DateCellRenderer`, `createNumberCellRenderer`, etc.) currently requires 4–6 lines of manual wiring per column: import the factory, call it at module scope, set `renderer.kind = 'react'`, set `cellEditor`. The factories already exist in `@eregister/wit-grid-react` — they just have no registration path.

A `columnTypes` map lets users write `{ field: 'price', type: 'number' }` and get the renderer, editor, and sort comparator automatically. This is the single highest-DX change possible with almost zero engine work.

---

## Scope

**In scope:**

- `packages/react/src/renderers/CellTypes.tsx` — add `ColumnTypeDefinition` interface and `BUILTIN_COLUMN_TYPES` registry
- `packages/react/src/types.ts` — add `columnTypes` to `ClientGridOptions` and `ServerGridOptions`
- `packages/react/src/useGrid.ts` — resolve `columnTypes` when calling `createClientGrid` / `createServerGrid`
- `packages/react/src/WitGrid.tsx` — thread `columnTypes` through `WitGridManagedClient` and `WitGridInner`
- `packages/core/src/columnDef.ts` — add optional `type?: string` field to `ColumnDef`
- `demo/src/pages/NativeCellTypesDemo.tsx` — rewrite using the new `type` prop
- `demo/src/pages/RealtimeGroupingDemo.tsx` — update any numeric/boolean columns to use `type`

**Out of scope:**

- Custom `comparator` on sort model (separate plan)
- AG Grid-style `columnTypesMerge` semantics (always last-writer-wins here)
- Vue / vanilla JS adapter

---

## Current state

### `packages/core/src/columnDef.ts` — `ColumnDef` (excerpt, line ~160)

```ts
export interface ColumnDef<TRowData = unknown> {
	field: string;
	header: string;
	width?: number;
	// ... (no `type` field)
	renderer?: ColumnRendererSpec<TRowData>;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
	// ...
}
```

### `packages/react/src/types.ts` — `ClientGridOptions` (line ~72)

```ts
export interface ClientGridOptions<TRowData> extends GridRenderOptions<TRowData> {
	rows: TRowData[];
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	rowSelection?: 'single' | 'multiple';
	persistence?: GridPersistenceAdapter;
	// no columnTypes
}
```

### `demo/src/pages/NativeCellTypesDemo.tsx` — current wiring style (lines ~78–90)

```ts
// Created at module level — must be stable references
const TricksRenderer = createMultiSelectCellRenderer(TRICKS_OPTIONS, 2);
const TricksEditor   = createMultiSelectCellEditor(TRICKS_OPTIONS);
const LevelRenderer  = createDropdownCellRenderer(LEVEL_OPTIONS);
const LevelEditor    = createDropdownCellEditor(LEVEL_OPTIONS);
const YearsRenderer  = createNumberCellRenderer({ suffix: ' yrs' });
const YearsEditor    = createNumberCellEditor({ min: 0, max: 80, step: 1 });

// Used in column def:
{ field: 'yearsSkating', renderer: { kind: 'react', component: YearsRenderer }, cellEditor: YearsEditor }
```

---

## Repo conventions

- All new types go in the file where they are primarily used; re-export from `index.ts` as needed.
- Functions exported from `packages/react` use camelCase; types use PascalCase.
- No runtime imports from `@eregister/wit-grid-core/internal` in public API code.
- Columns resolved in React hooks (`useClientGrid`) — no engine changes required for this feature.

---

## Implementation steps

### Step 1 — Add `ColumnTypeDefinition` interface and built-in registry to `CellTypes.tsx`

In `packages/react/src/renderers/CellTypes.tsx`, **append** at the bottom of the file:

```ts
// ─── Column type registry ─────────────────────────────────────────────────────

import type { ColumnDef, CellRendererProps, CellEditorProps } from '../types.js';

export interface ColumnTypeDefinition<TRowData = unknown> {
	renderer?: ColumnDef<TRowData>['renderer'];
	cellEditor?: ColumnDef<TRowData>['cellEditor'];
}

// Singleton instances for the built-in types — created once, never re-created.
const _numberRenderer = createNumberCellRenderer();
const _numberEditor = createNumberCellEditor();

export const BUILTIN_COLUMN_TYPES: Record<string, ColumnTypeDefinition<any>> = {
	checkbox: {
		renderer: { kind: 'react', component: CheckboxCellRenderer },
	},
	date: {
		renderer: { kind: 'react', component: DateCellRenderer },
		cellEditor: DateCellEditor,
	},
	number: {
		renderer: { kind: 'react', component: _numberRenderer },
		cellEditor: _numberEditor,
	},
};
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — must succeed with no TS errors.

---

### Step 2 — Add `type?: string` to `ColumnDef` in core

In `packages/core/src/columnDef.ts`, add one line inside `ColumnDef`:

```diff
 export interface ColumnDef<TRowData = unknown> {
   field: string;
   header: string;
   width?: number;
+  /** Named column type registered via `columnTypes` on the grid options. */
+  type?: string;
   hide?: boolean;
```

This is purely additive — the core does not interpret `type`; resolution happens in the React layer.

**Verification:** `pnpm -F @eregister/wit-grid-core build` — no errors.

---

### Step 3 — Add `columnTypes` to `ClientGridOptions` and `ServerGridOptions`

In `packages/react/src/types.ts`, import `ColumnTypeDefinition` and add the field:

```diff
+import type { ColumnTypeDefinition } from './renderers/CellTypes.js';

 export interface ClientGridOptions<TRowData> extends GridRenderOptions<TRowData> {
   rows: TRowData[];
   columns: ColumnDef<TRowData>[];
   getRowId?: (row: TRowData) => string;
   initialState?: Partial<GridState<TRowData>>;
   rowSelection?: 'single' | 'multiple';
   persistence?: GridPersistenceAdapter;
+  /**
+   * Map of type name → ColumnTypeDefinition. Merged with built-in types;
+   * user entries override built-ins with the same name.
+   *
+   * @example
+   * columnTypes={{ currency: { renderer: { kind: 'react', component: CurrencyRenderer } } }}
+   */
+  columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
 }

 export interface ServerGridOptions<TRowData> extends GridRenderOptions<TRowData> {
   datasource: IGridDatasource;
   columns: ColumnDef<TRowData>[];
   blockSize?: number;
   getRowId?: (row: TRowData) => string;
   initialState?: Partial<GridState<TRowData>>;
   persistence?: GridPersistenceAdapter;
+  columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
 }
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 4 — Write `resolveColumnTypes` helper

Add a new file `packages/react/src/resolveColumnTypes.ts`:

```ts
import type { ColumnDef } from '@eregister/wit-grid-core';
import { BUILTIN_COLUMN_TYPES, type ColumnTypeDefinition } from './renderers/CellTypes.js';

export function resolveColumnTypes<TRowData>(
	columns: ColumnDef<TRowData>[],
	userTypes?: Record<string, ColumnTypeDefinition<TRowData>>
): ColumnDef<TRowData>[] {
	const registry = userTypes ? { ...BUILTIN_COLUMN_TYPES, ...userTypes } : BUILTIN_COLUMN_TYPES;

	return columns.map((col) => {
		if (!col.type) return col;
		const typeDef = registry[col.type];
		if (!typeDef) return col;

		// Column-level explicit values win; type provides defaults.
		return {
			renderer: typeDef.renderer,
			cellEditor: typeDef.cellEditor,
			...col,
		};
	});
}
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 5 — Call `resolveColumnTypes` in `useClientGrid` and `useServerGrid`

In `packages/react/src/useGrid.ts`:

```diff
+import { resolveColumnTypes } from './resolveColumnTypes.js';

 export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
   const initialOptionsRef = useRef(options);
   const lastColumnsRef = useRef(initialOptionsRef.current.columns);

   const api = useMemo(() => {
-    const { rows, columns, getRowId, ... } = initialOptionsRef.current;
+    const { rows, columns, columnTypes, getRowId, ... } = initialOptionsRef.current;
     return createClientGrid({
-      columns,
+      columns: resolveColumnTypes(columns, columnTypes),
       rows, getRowId, ...
     });
   }, []);

   useEffect(() => {
     if (options.columns === lastColumnsRef.current) return;
     lastColumnsRef.current = options.columns;
-    api.setColumns(options.columns);
+    api.setColumns(resolveColumnTypes(options.columns, options.columnTypes));
   }, [api, options.columns]);
```

Apply the same change pattern to `useServerGrid`.

**Escape hatch:** If `resolveColumnTypes` causes a column to lose an explicitly-set `renderer` (i.e. both `type` and `renderer` are provided), the spread order `{ renderer: typeDef.renderer, ...col }` ensures `col.renderer` wins. Verify this in the test in Step 8.

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 6 — Thread `columnTypes` through `WitGrid`

In `packages/react/src/WitGrid.tsx`:

1. Add `columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>` to `WitGridProps`.
2. In `WitGridManagedClient`, destructure `columnTypes` from props and pass it to `useClientGrid`.
3. In `WitGridInner`, no change needed — it only takes `api`.

```diff
 export interface WitGridProps<TRowData = unknown> {
   rows?: TRowData[];
   columns?: ColumnDef<TRowData>[];
+  columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
   // ...
 }

 function WitGridManagedClient<TRowData>({
-  rows, columns, getRowId, initialState, ...rest
+  rows, columns, columnTypes, getRowId, initialState, ...rest
 }: WitGridProps<TRowData> & { rows: TRowData[] }) {
   const api = useClientGrid<TRowData>({
     rows, columns: columns ?? [],
+    columnTypes,
     getRowId, initialState, ...
   });
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 7 — Export from `packages/react/src/index.ts`

```diff
+export type { ColumnTypeDefinition } from './renderers/CellTypes.js';
+export { BUILTIN_COLUMN_TYPES } from './renderers/CellTypes.js';
```

**Verification:** `pnpm -F @eregister/wit-grid-react build` — no errors.

---

### Step 8 — Write tests

Add a new test file `packages/react/src/resolveColumnTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import { CheckboxCellRenderer, DateCellRenderer } from './renderers/CellTypes.js';
import type { ColumnDef } from '@eregister/wit-grid-core';

interface Row {
	id: string;
	name: string;
	active: string;
	born: string;
	score: string;
}

describe('resolveColumnTypes', () => {
	it('passes through columns with no type unchanged', () => {
		const cols: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
		expect(resolveColumnTypes(cols)).toBe(cols[0] === resolveColumnTypes(cols)[0] ? cols : cols);
		expect(resolveColumnTypes(cols)[0]).toEqual(cols[0]);
	});

	it('applies built-in checkbox renderer when type = checkbox', () => {
		const col = resolveColumnTypes<Row>([{ field: 'active', header: 'Active', type: 'checkbox' }])[0];
		expect((col.renderer as any)?.component).toBe(CheckboxCellRenderer);
	});

	it('applies built-in date renderer and editor when type = date', () => {
		const col = resolveColumnTypes<Row>([{ field: 'born', header: 'Born', type: 'date' }])[0];
		expect((col.renderer as any)?.component).toBe(DateCellRenderer);
		expect(col.cellEditor).toBeDefined();
	});

	it('applies built-in number renderer and editor when type = number', () => {
		const col = resolveColumnTypes<Row>([{ field: 'score', header: 'Score', type: 'number' }])[0];
		expect(col.renderer).toBeDefined();
		expect(col.cellEditor).toBeDefined();
	});

	it('column-level renderer overrides the type renderer', () => {
		const customRenderer = { kind: 'text' as const };
		const col = resolveColumnTypes<Row>([{ field: 'born', header: 'Born', type: 'date', renderer: customRenderer }])[0];
		expect(col.renderer).toBe(customRenderer);
	});

	it('ignores unknown type names — returns column unchanged', () => {
		const col: ColumnDef<Row> = { field: 'name', header: 'Name', type: 'nonexistent' };
		expect(resolveColumnTypes([col])[0]).toEqual(col);
	});

	it('user-defined type overrides built-in with same name', () => {
		const myRenderer = { kind: 'text' as const };
		const col = resolveColumnTypes<Row>([{ field: 'born', header: 'Born', type: 'date' }], { date: { renderer: myRenderer } })[0];
		expect(col.renderer).toBe(myRenderer);
	});
});
```

Run: `pnpm -F @eregister/wit-grid-react test` — all pass.

---

### Step 9 — Update `NativeCellTypesDemo` in the demo

In `demo/src/pages/NativeCellTypesDemo.tsx`:

1. Remove all module-level factory calls (`createMultiSelectCellRenderer`, etc.) for the types covered by the registry (checkbox, date, number).
2. For types **not** in the registry (multi-select with options, dropdown with options), keep the factory pattern — those require runtime configuration.
3. Add `columnTypes` to the `useClientGrid` call.
4. Use `type: 'checkbox'`, `type: 'date'`, `type: 'number'` on the relevant column defs.

**Before (abbreviated):**

```ts
const YearsRenderer = createNumberCellRenderer({ suffix: ' yrs' });
const YearsEditor   = createNumberCellEditor({ min: 0, max: 80, step: 1 });
// ...
{ field: 'yearsSkating', header: 'Years Skating', renderer: { kind: 'react', component: YearsRenderer }, cellEditor: YearsEditor }
{ field: 'isPro', header: 'Is Pro', renderer: { kind: 'react', component: CheckboxCellRenderer } }
{ field: 'skatedSince', header: 'Skated Since', renderer: { kind: 'react', component: DateCellRenderer }, cellEditor: DateCellEditor }
```

**After:**

```ts
const skaterColumnTypes = {
  'years-number': {
    renderer: { kind: 'react' as const, component: createNumberCellRenderer({ suffix: ' yrs' }) },
    cellEditor: createNumberCellEditor({ min: 0, max: 80, step: 1 }),
  },
};
// ...
{ field: 'yearsSkating', header: 'Years Skating', type: 'years-number' }
{ field: 'isPro',        header: 'Is Pro',        type: 'checkbox' }
{ field: 'skatedSince',  header: 'Skated Since',  type: 'date' }
```

**Verification:** Start the demo (`pnpm dev:demo`), open NativeCellTypes page, confirm date/number/checkbox cells render and edit identically to before.

---

### Step 10 — Update `RealtimeGroupingDemo` in the demo

Open `demo/src/pages/RealtimeGroupingDemo.tsx`. Find columns with numeric or boolean fields and switch to `type: 'number'` / `type: 'checkbox'` where applicable. Follow the same pattern as Step 9.

**Verification:** Reload the demo page, confirm no visual regressions.

---

## Files in scope

| File                                            | Change type                                        |
| ----------------------------------------------- | -------------------------------------------------- |
| `packages/core/src/columnDef.ts`                | Add `type?: string` to `ColumnDef`                 |
| `packages/react/src/renderers/CellTypes.tsx`    | Add `ColumnTypeDefinition`, `BUILTIN_COLUMN_TYPES` |
| `packages/react/src/resolveColumnTypes.ts`      | **New file**                                       |
| `packages/react/src/resolveColumnTypes.test.ts` | **New file**                                       |
| `packages/react/src/types.ts`                   | Add `columnTypes` to options interfaces            |
| `packages/react/src/useGrid.ts`                 | Call `resolveColumnTypes` on column sync           |
| `packages/react/src/WitGrid.tsx`               | Thread `columnTypes` prop                          |
| `packages/react/src/index.ts`                   | Export new types                                   |
| `demo/src/pages/NativeCellTypesDemo.tsx`        | Use `type` prop for checkbox/date/number           |
| `demo/src/pages/RealtimeGroupingDemo.tsx`       | Use `type` prop where applicable                   |

**Explicitly out of scope:** `packages/core/src/**` (except `columnDef.ts`), all other demo pages, test infrastructure.

---

## Done criteria

```bash
pnpm -F @eregister/wit-grid-core build          # exits 0
pnpm -F @eregister/wit-grid-react build         # exits 0
pnpm -F @eregister/wit-grid-react test          # all tests pass including new resolveColumnTypes.test.ts
```

- `resolveColumnTypes.test.ts` contains ≥ 7 test cases covering: no-type passthrough, each built-in type, column-level override, unknown type, user override of built-in.
- `NativeCellTypesDemo` and `RealtimeGroupingDemo` use `type:` prop for checkbox/date/number columns.
- No factory calls remain at module scope in the updated demo pages for covered types.

---

## Maintenance note

When adding new built-in types, add their singleton instances and `ColumnTypeDefinition` entry in `BUILTIN_COLUMN_TYPES` in `CellTypes.tsx`. The resolution logic in `resolveColumnTypes.ts` is type-agnostic and requires no changes.
