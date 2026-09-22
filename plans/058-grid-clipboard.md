# Plan 058: Grid-Level Clipboard (Range Copy / Paste)

> The grid has a cell selection model with focus, anchor, and range. It has `onCopy`/`onPaste` column hooks. It has a `cellsCopied` event. But there is no grid-coordinated clipboard manager — no Ctrl+C that copies the selected range as TSV, no Ctrl+V that pastes TSV into the selection. This plan wires clipboard at the grid level, using the browser Clipboard API, with TSV as the interchange format.

## Status

- **Priority**: P1 — high-demand feature, builds on existing selection model
- **Effort**: M
- **Risk**: MEDIUM — clipboard API requires user gesture; async paste handling needs care with the edit lifecycle
- **Depends on**: 056 (valueFormatter — copy must use formatted value, not raw)
- **Category**: feature, clipboard, UX
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What to add

### GridApi methods

```ts
// GridApi.ts

/**
 * Copy the currently selected range to the clipboard as TSV.
 * Respects column `onCopy` callbacks and `valueFormatter` for display values.
 */
copySelectedRange(): Promise<void>;

/**
 * Paste from clipboard into the grid starting at the current focus cell.
 * Parses TSV. Respects column `onPaste` callbacks and `valueSetter`.
 * Returns the number of cells modified.
 */
pasteFromClipboard(): Promise<number>;

/**
 * Copy a specific range of cells to the clipboard.
 */
copyRange(range: { startRow: number; endRow: number; startCol: number; endCol: number }): Promise<void>;
```

### ClipboardController (new)

```ts
// packages/core/src/features/ClipboardController.ts

export class ClipboardController {
  // Reads the current selection range from SelectionModel
  // Iterates rows × cols in order
  // Calls column.onCopy(value) if present, else getFormattedCellValue()
  // Joins with \t (columns) and \n (rows)
  // Writes to navigator.clipboard.writeText()

  async copyRange(range: CellRange): Promise<string> { ... }

  // Reads navigator.clipboard.readText()
  // Splits by \n and \t
  // Starting at focus cell, maps TSV columns to grid columns in display order
  // Calls column.onPaste(text) → value, else uses raw text
  // Calls store.batchCellValues() for all changed cells
  // Returns number of cells written
  async pasteText(text: string, focusCell: CellPointer): Promise<number> { ... }
}
```

### Keyboard binding

Wire `Ctrl+C` / `Cmd+C` to `copySelectedRange()` and `Ctrl+V` / `Cmd+V` to `pasteFromClipboard()` in the grid's keyboard event handler (`navigation.ts` or a new `keyboardShortcutController.ts`).

These shortcuts must only fire when the grid has focus and is not in an active cell edit.

### Paste modes

```ts
export interface PasteOptions {
	/**
	 * 'replace': paste cells overwrite existing values (default)
	 * 'insert': paste rows shift existing rows down (not in this plan)
	 */
	mode?: 'replace';

	/**
	 * If the paste range is smaller than the selection, whether to tile the
	 * paste content to fill the selection. Default: false.
	 */
	fillSelection?: boolean;
}
```

### Events

```ts
// GridEvents.ts
'cellsCopied': {
  rowCount: number;
  colCount: number;
  text: string; // the TSV string written to clipboard
}

'cellsPasted': {
  cellsModified: number;
  errors: Array<{ rowId: string; colField: string; reason: string }>;
}
```

(`cellsCopied` already exists — verify its payload and extend if needed.)

## Phases

### Phase 1 — `ClipboardController` + copy

- New file: `packages/core/src/features/ClipboardController.ts`
- `copyRange()` implementation using `getFormattedCellValue` + `column.onCopy`
- TSV serialization
- Write to `navigator.clipboard.writeText()`
- Unit tests (mock clipboard API): single cell, range, multi-column, with formatter, with onCopy hook

### Phase 2 — Paste

- `pasteText()` implementation
- TSV parsing with \r\n and \n normalization
- Column mapping: paste columns map left-to-right from focus cell in display order
- Call `batchCellValues()` for atomic commit
- Emit `cellsPasted` event
- Unit tests: single cell, range, overflows grid edge (clip to valid range), with onPaste hook, with valueSetter

### Phase 3 — Keyboard shortcuts

- Wire Ctrl+C / Cmd+C → `copySelectedRange()`
- Wire Ctrl+V / Cmd+V → `pasteFromClipboard()`
- Guard: only fire when grid has focus AND not in active edit (`state.activeEdit === null`)
- Document that browser clipboard API requires a secure context (HTTPS or localhost)

### Phase 4 — GridApi surface

- Add `copySelectedRange()`, `pasteFromClipboard()`, `copyRange()` to `GridApi.ts`
- Wire through `store.ts`, `createGrid.ts`, `createGridPluginRuntime.ts`

### Phase 5 — Demo

- Add a demo page `ClipboardDemo.tsx` with instructions showing copy/paste between grid sections
- Show `cellsCopied` and `cellsPasted` event log below the grid

## STOP conditions

- Do not implement paste-as-insert (shifting rows) — that is a separate, complex operation.
- Do not read the clipboard without a user gesture — browsers block `readText()` without a gesture; paste must be keyboard-triggered, not programmatic.
- Do not implement cross-grid paste in this plan.
- Do not add Excel `.xls` clipboard format — TSV is sufficient and universally supported.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Ctrl+C on a selected range copies TSV. Ctrl+V pastes TSV starting at focus cell. `cellsCopied` event fires with correct row/col count. Formatted values (via `valueFormatter`) appear in copied text.
