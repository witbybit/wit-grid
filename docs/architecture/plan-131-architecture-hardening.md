# Plan 131 — Wit Grid Final Architecture Hardening

> **Status**: In progress. Plans 122-130 implemented the Data Integrity pipeline core.
> Plans 131+ lock in the remaining non-negotiables.

---

## Completed in this session (pre-131)

- ✅ `GridIntegrityRowProvider`: removed visual-row fallback for `allRows`/`filteredRows`/`loadedRows`/`currentPage` — now returns `unsupported` when `getAllDataNodes()` not available
- ✅ `rowCellBinder`: removed `state.validationErrors` read, `og-cell-invalid` class, `og-cell-error-badge` DOM creation — decorations flow exclusively through `deps.engine.insights.getCellDecorations()`
- ✅ `ValidationIntegrityModule`: removed `_buildValidationErrors()` dead writes to `state.validationErrors` — cell decorations go through `getCellError()` → insight layer

---

## Plan 131 — Pillar 1: Slot-based rendering lockdown (remaining)

**Goal**: `rowCellBinder` is a pure slot renderer. No feature logic, no validation state reads.

### Remaining work

| Task                                                                                                                                     | File                            | Status  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------- |
| Remove `state.validationErrors` field from `InternalGridState`                                                                           | `state/GridState.ts:116`        | Pending |
| Remove legacy `ValidationManager.ts` (`api.validateCell`, `api.validateGrid`, `api.clearValidationErrors`, `api.getAllValidationErrors`) | `features/ValidationManager.ts` | Pending |
| Remove `validationKey` export from `ValidationManager.ts` (now unused)                                                                   | `features/ValidationManager.ts` | Pending |
| Remove `columnDef.valueValidator` prop                                                                                                   | `columnDef.ts`                  | Pending |
| Remove `rowValidator` grid prop                                                                                                          | `engine/GridEngine.ts`          | Pending |

### Guard to add

```ts
// architectureGuards.test.ts
it('rowCellBinder must not read state.validationErrors', () => {
	const content = readFileSync(rowCellBinderPath, 'utf-8');
	expect(content).not.toContain('validationErrors');
	expect(content).not.toContain('og-cell-invalid');
	expect(content).not.toContain('og-cell-error-badge');
});
```

---

## Plan 132 — Pillar 2: Result-aware commits

**Goal**: No feature module may assume a cell write succeeded. All edits go through a `commitCellValue` that returns `GridCommitResult`.

### API change

```ts
// Before (void — no way to know if commit succeeded)
setCellValue(rowId: string, colField: string, value: unknown): void

// After (result-aware)
commitCellValue(params: { rowId: string; colField: string; value: unknown }): Promise<GridCommitResult>

interface GridCommitResult {
  success: boolean;
  rowId: string;
  colField: string;
  committedValue?: unknown;
  error?: string;
}
```

### Remaining work

| Task                                                                                                      | File                                       | Status  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------- |
| Add `GridCommitResult` type to `integrityTypes.ts`                                                        | `features/dataIntegrity/integrityTypes.ts` | Pending |
| Add `commitCellValue` to `GridApi`                                                                        | `api/GridApi.ts`                           | Pending |
| Update `DiffIntegrityModule.acceptChange()` to use `commitCellValue` and only clear diff state on success | `modules/DiffIntegrityModule.ts`           | Pending |
| Update `ConflictIntegrityModule.resolveConflict()` same pattern                                           | `modules/ConflictIntegrityModule.ts`       | Pending |
| Deprecate `setCellValue` in integrity module deps                                                         | Internal only                              | Pending |

---

## Plan 133 — Pillar 3: One Data Integrity pipeline (legacy removal)

**Goal**: Delete the separate `dataQuality/` folder. All quality, diff, conflicts go through `GridDataIntegrityManager`.

### Remaining work

| Task                                                                                                                   | File           | Status       |
| ---------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ |
| Delete `features/dataQuality/DataQualityManager.ts`                                                                    | Legacy         | Pending      |
| Delete `features/dataQuality/DataQualityManager.test.ts`                                                               | Legacy         | Pending      |
| Delete `features/dataQuality/builtInRules.ts`                                                                          | Legacy         | Pending      |
| Delete `insights/dataQuality.ts` re-export shim                                                                        | Legacy         | Pending      |
| Remove `GridDataQualityRule` from `core/index.ts` (or keep as re-export of `GridDataQualityRule` from integrity types) | `src/index.ts` | Pending      |
| Confirm `DataQualityManager` is not wired into engine (already confirmed — not referenced in engine/)                  | —              | ✅ Confirmed |

---

## Plan 134 — Pillar 4: Honest row model scopes

**Goal**: `allRows` means ALL rows. `filteredRows` means all filtered rows (not just visual). No scope silently degrades.

### Remaining work

| Task                                                                                          | File                                 | Status  |
| --------------------------------------------------------------------------------------------- | ------------------------------------ | ------- |
| ✅ Remove visual-row fallback from `ClientGridIntegrityRowProvider._scanAllDataNodes`         | `GridIntegrityRowProvider.ts`        | ✅ Done |
| Add `getFilteredDataNodes(): RowNode<TRowData>[]` to `ClientRowModelController`               | `rowModel.ts`                        | Pending |
| Wire `filteredRows` scope in `ClientGridIntegrityRowProvider` to use `getFilteredDataNodes()` | `GridIntegrityRowProvider.ts`        | Pending |
| Add `FilteredDataNodesCapableRowModel` interface (duck-typed)                                 | `rowModel.ts` or `integrityTypes.ts` | Pending |
| Add `currentPage` scope support via `getCurrentPageDataNodes()` when pagination present       | `rowModel.ts`                        | Pending |

### Implementation sketch: `getFilteredDataNodes`

`ClientRowModelController.visualRows` is the sorted+filtered result array. For `filteredRows`, we want ALL rows that pass the current filter, not just those in the viewport. `visualRows` IS that set — it's the full post-filter, post-sort array.

```ts
// In ClientRowModelController
public getFilteredDataNodes = (): RowNode<TRowData>[] => {
  // visualRows is the full sorted+filtered result, not a viewport window
  return this.visualRows
    .filter(vr => vr.kind === 'data' && vr.node.data != null)
    .map(vr => (vr as DataVisualRow<TRowData>).node);
};
```

Then in `ClientGridIntegrityRowProvider`:

```ts
case 'filteredRows':
  return this._scanFilteredNodes(rowModel, state);
```

---

## Plan 135 — Pillar 5: Targeted invalidation

**Goal**: Cell-level events must invalidate only the affected cell, not trigger full repaints.

### Remaining work

| Task                                                                                                                       | File                                   | Status            |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------- |
| Audit `GridDataIntegrityManager.requestInsightRepaint()` — ensure it triggers targeted repaint (cell-level) not full paint | `GridDataIntegrityManager.ts`          | Pending           |
| Add `repaintCell(rowId, colField)` to repaint coordinator if not present                                                   | `renderPaintCoordinator.ts`            | Pending           |
| Update `ValidationIntegrityModule.validateCell()` to use cell-targeted repaint                                             | `modules/ValidationIntegrityModule.ts` | Pending           |
| Architecture guard: `RenderInvalidationCoordinator` must not subscribe to `validationErrors` key                           | `architectureGuards.test.ts:1911`      | ✅ Already tested |

---

## Plan 136 — Pillar 6: DevTools and architecture guardrails

**Goal**: Machine-enforced rules so regressions can't land silently.

### Guards to add to `architectureGuards.test.ts`

```ts
describe('Data Integrity Architecture Guards', () => {
  it('rowCellBinder must not import from ValidationManager', () => { ... });
  it('rowCellBinder must not read validationErrors state', () => { ... });
  it('rowCellBinder must not produce og-cell-invalid or og-cell-error-badge', () => { ... });
  it('GridIntegrityRowProvider must not fall back to getVisualRowCount for allRows scope', () => { ... });
  it('No direct import of DataQualityManager in engine/', () => { ... });
  it('integrity modules must not import from features/dataQuality/', () => { ... });
});
```

### Fix pre-existing guard failures

| Failure                                  | Current | Budget                               | Fix                                                               |
| ---------------------------------------- | ------- | ------------------------------------ | ----------------------------------------------------------------- |
| `store.ts` line count                    | 1206    | 1150                                 | Extract `TransactionCoordinator` (~60 lines) to separate file     |
| `GridEngine.ts` line count               | 1162    | 1150                                 | Extract `_buildSidebarConfig` helper (~15 lines) to separate file |
| `core/index.ts` imports from `features/` | Flagged | Must import from public API boundary | Fix import paths                                                  |

---

## Plan 137 — Pillar 7: No compatibility clutter — unified sidebar panel

**Goal**: One `dataIntegrity` panel with tabs (Overview, Validation, Quality, Diff, Live Stream, Conflicts). Remove separate `dataQuality`, `diff`, `conflicts` sidebar panels.

### Remaining work

| Task                                                                                       | File                                  | Status  |
| ------------------------------------------------------------------------------------------ | ------------------------------------- | ------- |
| Create `packages/react/src/sidebar/panels/DataIntegrityPanel.tsx` with tab navigation      | New file                              | Pending |
| Tabs: Overview, Validation, Quality, Diff, Live Stream, Conflicts — only show enabled ones | `DataIntegrityPanel.tsx`              | Pending |
| Register as `'dataIntegrity'` built-in panel                                               | `sidebar/SidebarPanel.ts`             | Pending |
| Deprecate `'dataQuality'` panel (keep for one release)                                     | `sidebar/panels/DataQualityPanel.tsx` | Pending |
| Deprecate `'diff'`, `'conflicts'` panels same                                              | —                                     | Pending |
| Remove root-level `api.validateGrid()`, `api.getAllValidationErrors()`                     | `api/GridApi.ts`                      | Pending |
| Remove root-level `api.setDiffModel()`, `api.clearDiffModel()`                             | `api/GridApi.ts`                      | Pending |
| Remove root-level `api.createTransactionStream()`, `api.getConflicts()`, etc.              | `api/GridApi.ts`                      | Pending |
| All of the above now live exclusively under `api.integrity.*`                              | —                                     | Pending |

---

## Execution order

```
131 (Pillar 1 remaining) → 133 (legacy removal, unblocks 131 fully) → 136 (guards, catch regressions)
132 (commits) — parallel with 131-133
134 (filteredRows) — parallel with 131-133
135 (targeted invalidation) — after 134
137 (sidebar panel) — after 133
```

---

## Non-negotiables (permanent rules)

1. `rowCellBinder` reads ONLY from `deps.engine.insights.getCellDecorations()` for overlays — never from `state.*`
2. `allRows` scope NEVER degrades to visual rows — return `unsupported` instead
3. No feature module calls `setCellValue` assuming success — only `commitCellValue` with result check
4. Decoration pipeline is ONE-WAY: issues → `GridDataIntegrityManager.getCellDecorations()` → insight registry → binder
5. `api.integrity.*` is the single public namespace for all data integrity operations
