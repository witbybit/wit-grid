# Plan 136 — Pillar 6: DevTools and Architecture Guardrails

> **Status**: Mostly complete (session 2026-06-22)

## Completed (2026-06-22)

### Pre-existing guard failures fixed

| Guard                                    | Before                                              | After                                |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| `store.ts` line count                    | 1205 lines (over 1150 budget)                       | 1107 lines ✅                        |
| `GridEngine.ts` line count               | 1161 lines (over 1150 budget)                       | 1148 lines ✅                        |
| `core/index.ts` imports from `features/` | 3 direct `./features/dataIntegrity/` imports        | Routed through `./integrity.js` ✅   |
| Demo `@eregister/open-grid-core` import  | `RealtimeDashboard.tsx` imported from core directly | Uses `@eregister/open-grid-react` ✅ |

### New guards added (Plan 131/134)

```ts
// Plan 131 Pillar 1 — rowCellBinder decoration pipeline lockdown
it('rowCellBinder must not read state.validationErrors');
it('rowCellBinder must not import from ValidationManager');
it('rowCellBinder must not produce og-cell-invalid class');
it('rowCellBinder must not create og-cell-error-badge DOM elements');

// Plan 134 Pillar 4 — honest row scopes
it('ClientGridIntegrityRowProvider must not fall back to getVisualRowCount for allRows');
it('ClientRowModelController must implement getFilteredDataNodes');
```

## Remaining

### Guards to add (after Plans 132-133 complete)

```ts
// Plan 133 — legacy removal
it('features/dataQuality/ folder must not exist');
it('integrity modules must not import from features/dataQuality/');
it('core/index.ts must not export GridDataQualityManager');

// Plan 132 — result-aware commits
it('DiffIntegrityModule must not call setCellValue directly');
it('ConflictIntegrityModule must not call setCellValue directly');

// Plan 137 — unified sidebar
it('GridApi must not expose validateGrid/getAllValidationErrors at root level');
it('GridApi must not expose setDiffModel/clearDiffModel at root level');
```

### Long-term line count targets

| File            | Current | Intermediate Budget | End Target |
| --------------- | ------- | ------------------- | ---------- |
| `store.ts`      | 1107    | 1150 ✅             | 900        |
| `GridEngine.ts` | 1148    | 1150 ✅             | 800        |
| `rowModel.ts`   | ~1400   | —                   | 1000       |

`rowModel.ts` is growing (added `getFilteredDataNodes`, previously `getAllDataNodes`). Plan 134 remainder adds `getFilteredDataNodes` interface + `getCurrentPageDataNodes`. Monitor line count.
