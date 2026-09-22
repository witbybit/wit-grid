# Plan 075: Formula Bar + Cross-Cell Formulas

> **Summary**: Surface the existing `DagEngine` through the public API and add a Formula Bar UI component to the React package, enabling spreadsheet-style cross-cell formulas (`=SUM`, `=[rowId:field]` references) with live dependency tracking, circular-reference detection, and formula-aware cell rendering.

## Status

- **Priority**: P1 — feature, high user value
- **Effort**: L
- **Risk**: MEDIUM — touches GridApi surface, PersistedGridState, cell rendering pipeline
- **Depends on**: Plans 065–074
- **Category**: feature, formula, dag, react-ui
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

`DagEngine` already provides a complete formula evaluation engine with:

- A1-style cell references (`[rowId:colField]`)
- Built-in functions: `SUM`, `AVERAGE`, `MIN`, `MAX`
- Arithmetic with correct precedence
- Circular-reference detection and cache invalidation

None of this is reachable from application code. There is no GridApi surface to read or write formulas, no `=` prefix detection in the cell editor flow, no Formula Bar UI, and no formula-aware value display in cells.

## Goals

1. Expose `DagEngine` through `GridApi` methods (`getFormula`, `setFormula`, `clearFormula`, `hasFormula`).
2. Hook `getCellValue` so formula cells return evaluated (not raw) values throughout the grid.
3. Add `=` prefix detection in the edit lifecycle so typing `=SUM(...)` registers a formula instead of storing literal text.
4. Persist formula definitions as part of `PersistedGridState` (schema v3).
5. Implement a `FormulaBar` React component — a header-docked input that shows and edits the active cell's formula or raw value.
6. Add formula-specific column-def options: `enableFormula?: boolean` (opt-in per column).
7. Add architecture guard: formula engine must not import renderer files.

## What to add

### 1. GridApi methods (packages/core/src/api/GridApi.ts)

```ts
/** Returns the formula string for a cell, or undefined if none. */
getFormula(rowId: string, colField: string): string | undefined;

/** Register a formula on a cell. Must start with '='. Throws if circular. */
setFormula(rowId: string, colField: string, formula: string): void;

/** Remove the formula from a cell (raw value is retained). */
clearFormula(rowId: string, colField: string): void;

/** Returns true if the cell currently has a registered formula. */
hasFormula(rowId: string, colField: string): boolean;
```

### 2. GridStore wiring (packages/core/src/store.ts)

- Add `private readonly dagEngine = new DagEngine()` as a store field.
- Implement the four GridApi methods by delegating to `dagEngine`.
- Override `getCellValue` to check `dagEngine.hasFormula(rowId, colField)` first; if true, call `dagEngine.getCellValue(rowId, colField, (r, c) => this._getRawCellValue(r, c))` instead of the raw path.
- After `updateRows` / `setCellValue` / `batchCellValues`, call `dagEngine.invalidateCell(rowId, colField)` for every mutated cell so dependents re-evaluate on next read.

### 3. Edit lifecycle — formula commit (packages/core/src/features/EditingFeatureController.ts)

When `commitEdit(rowId, colField, value)` is called:

- If `value` is a string starting with `=`, call `store.setFormula(rowId, colField, value)` instead of `setCellValue`. Trigger a re-render for the cell and all dependents.
- If there was a previous formula but the new value does not start with `=`, call `store.clearFormula(rowId, colField)` then `setCellValue` normally.

### 4. PersistedGridState — formula persistence (packages/core/src/persistence/statePersistence.ts)

```ts
// Schema v3 addition
formulaMap?: Record<string, string>; // "rowId\x00colField" -> formula string
```

- `extractPersistedState` serializes `dagEngine.getAllFormulas()` (new DagEngine method returning `Map<cellKey, formula>`).
- `applyPersistedState` calls `setFormula` for each entry after initial state is applied.
- Bump `GRID_STATE_SCHEMA_VERSION` to 3.

### 5. DagEngine — getAllFormulas (packages/core/src/calculations/dagEngine.ts)

Add one method:

```ts
getAllFormulas(): Map<string, string>; // cellKey -> formula string
```

### 6. FormulaBar React component (packages/react/src/FormulaBar/FormulaBar.tsx)

```tsx
interface FormulaBarProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	className?: string;
}
```

- Subscribes to `api.subscribeToKey('selection', ...)` to track focus cell.
- On focus change: reads `api.getFormula(rowId, colField)` if present, else `api.getCellValue(rowId, colField)`.
- Renders an `<input>` showing the formula/value. Editing the input on Enter/Tab calls `api.startEditing` then immediately `api.commitEdit` with the new value (so the formula commit path fires).
- Styled via `api.getTheme()` tokens — background, border, text, focus ring.
- Exported from `@eregister/wit-grid-react`.

### 7. ColumnDef option (packages/core/src/columnDef.ts)

```ts
enableFormula?: boolean; // Default: false. When true, cells in this column participate in DAG evaluation.
```

- `getCellValue` only routes through `dagEngine` if `columnDef.enableFormula === true` OR if the cell already has a registered formula (for backwards compat with explicit `setFormula` calls).

### 8. Architecture guard (packages/core/src/engine/architectureGuards.test.ts)

Add test: `calculations/dagEngine.ts does not import renderer files` — scans `dagEngine.ts` imports for any path containing `/renderer/`.

## Phases

### Phase 1 — DagEngine API extension and store wiring

1. Add `getAllFormulas()` to `DagEngine`.
2. Add `dagEngine` field to `GridStore`.
3. Implement `getFormula`, `setFormula`, `clearFormula`, `hasFormula` on `GridStore` and `GridApi`.
4. Override `getCellValue` in store to route through DAG when formula exists.
5. Wire invalidation after `updateRows` / `setCellValue` / `batchCellValues`.
6. Update `createGridPluginRuntime.ts` with all four methods.
7. Export types/methods from `packages/core/src/index.ts`.

### Phase 2 — Edit lifecycle integration

1. Detect `=` prefix in `EditingFeatureController.commitEdit`.
2. Call `setFormula` / `clearFormula` as appropriate.
3. Trigger dependent cell re-renders after formula registration (invalidate + `globalVersion++`).
4. Unit tests: commit `=42+1` stores formula, display shows `43`; clear via non-`=` value.

### Phase 3 — Persistence

1. Add `formulaMap` to `PersistedGridState`.
2. Add `extractPersistedState` / `applyPersistedState` handling.
3. Bump schema version to 3.
4. Tests: round-trip a formula through serialize → deserialize → evaluate.

### Phase 4 — FormulaBar React component

1. Implement `FormulaBar` component with selection subscription and commit wiring.
2. Style via theme tokens.
3. Export from `@eregister/wit-grid-react`.
4. Add to demo: `AdvancedFeatures` demo page shows formula bar above the grid.

### Phase 5 — ColumnDef option and architecture guard

1. Add `enableFormula` to `ColumnDef`.
2. Narrow the DAG routing in `getCellValue` to formula-enabled columns.
3. Add architecture guard test.
4. Update demo to show formulas on a `price` column where totals reference other cells.

## Out of scope

- Formula autocomplete / intellisense in the editor
- Range references (`[A1:A5]` style spanning multiple row IDs)
- Named ranges
- VLOOKUP / INDEX / MATCH style cross-column lookups
- Formula error display types (`#DIV/0!`, `#REF!`) — errors render as `"ERR"`
