# Plan 056: valueFormatter Column Option

> **Why this is architecture, not a feature**: AG Grid's three-layer column model — `valueGetter` (raw value) → `valueFormatter` (display string) → `cellRenderer` (DOM) — exists because formatting is consumed in at least four places: cell rendering, CSV export, clipboard copy, and tooltips. Without the formatter layer, every consumer reimplements the same string conversion, or the raw number leaks into places it shouldn't (e.g. a CSV that exports `1234.56` instead of `$1,234.56`). Adding it now, before XLSX export (062) and before clipboard (058), avoids duplicating formatting logic in three separate places.

## Status

- **Priority**: P0 — architectural prerequisite for 058 (clipboard), 062 (XLSX export)
- **Effort**: S
- **Risk**: LOW — purely additive; does not change existing renderer paths
- **Depends on**: nothing
- **Category**: architecture, column model
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What to add

### 1. Column definition

```ts
// packages/core/src/columnDef.ts

export interface ColumnDef<TRowData = unknown> {
	// ... existing fields ...

	/**
	 * Converts the raw cell value (from valueGetter or field) into a display string.
	 * Used by: default text renderer, CSV export, XLSX export, clipboard copy, tooltip.
	 * The renderer receives the formatted string, not the raw value, unless it is a
	 * custom React/DOM renderer that opts out via `skipFormatter: true`.
	 */
	valueFormatter?: (params: ValueFormatterParams<TRowData>) => string;
}

export interface ValueFormatterParams<TRowData = unknown> {
	value: unknown;
	rowData: TRowData;
	colDef: ColumnDef<TRowData>;
	rowId: string;
}
```

### 2. Compiled column definition

`InternalColumnDef` (compiled from `ColumnDef` in `ColumnModel.ts`) gets a resolved `valueFormatter?: (params) => string` field. No schema change needed — it is just carried through.

### 3. Cell value resolution

Add a helper in `CellAccess.ts`:

```ts
export function getFormattedCellValue(rawValue: unknown, colDef: InternalColumnDef, rowData: unknown, rowId: string): string {
	if (colDef.valueFormatter) {
		return colDef.valueFormatter({ value: rawValue, rowData, colDef, rowId });
	}
	if (rawValue === null || rawValue === undefined) return '';
	return String(rawValue);
}
```

### 4. Default text renderer uses formatted value

`cellRenderer.ts` — when rendering a text/primitive cell (no custom renderer), call `getFormattedCellValue` instead of `String(rawValue)`.

### 5. Custom renderers receive formatted value

When mounting a custom React/DOM renderer, pass both `value` (raw) and `formattedValue` (string) in the renderer params. Custom renderers can choose which to display.

### 6. CSV export uses formatter

`csvExport.ts` — replace the current `String(value)` call with `getFormattedCellValue(...)`.

## Phases

### Phase 1 — Column definition + compiled type

- Add `valueFormatter` to `ColumnDef<TRowData>` with JSDoc
- Carry it through to `InternalColumnDef`
- Add `ValueFormatterParams` type
- Export from `packages/core/src/index.ts`

### Phase 2 — Cell value resolution helper

- Add `getFormattedCellValue()` to `CellAccess.ts`
- Unit test: null/undefined → empty string, primitive → String(), formatter → formatter output

### Phase 3 — Wire into default text renderer

- `cellRenderer.ts`: for `text` and `primitive` render types, call `getFormattedCellValue`
- Verify existing tests still pass (all `String(value)` tests become formatter-aware)

### Phase 4 — Wire into CSV export

- `csvExport.ts`: replace raw value stringification with `getFormattedCellValue`
- Add a test: column with `valueFormatter: v => `$${v}``→ CSV shows`$1234`

### Phase 5 — Pass `formattedValue` to custom renderers

- Update `GridCellContentMount` to include `formattedValue: string`
- Custom React renderers receive `formattedValue` alongside `value`
- Mark it optional so existing renderers don't break

## STOP conditions

- Do not gate existing cell binding on the formatter — keep the fast path fast. Only call formatter when rendering text cells or producing export/clipboard strings.
- Do not add a `valueParser` (inverse formatter for paste) in this plan — that belongs with clipboard (058).
- Do not add built-in formatters (currency, date, percentage) as named column types in this plan — that is column type registry work, separate effort.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Column with `valueFormatter` shows formatted value in cell. CSV export shows formatted value. Existing columns without `valueFormatter` behavior unchanged.
