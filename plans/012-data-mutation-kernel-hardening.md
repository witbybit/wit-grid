# Plan 012: Harden the data mutation kernel

> **Executor instructions**: Follow this plan in order. This plan starts from a failing core test suite at commit `39c83e3`; fix the correctness failure first, then harden the architecture so the same class of bug cannot reappear. Do not add user-facing grid features in this plan.
>
> **Drift check (run first)**: `git diff --stat 39c83e3..HEAD -- packages/core/src/models/DataModel.ts packages/core/src/engine/GridEngine.ts packages/core/src/features packages/core/src/spreadsheet/fillRange.ts packages/core/src/rowModel.ts packages/core/src/calculations/dagEngine.ts packages/core/src/store.ts packages/core/src/fillRange.test.ts packages/core/src/engine/architectureGuards.test.ts`
>
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. If they do not match, stop and refresh this plan before editing.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 011 implementation at commit `39c83e3`
- **Category**: correctness, architecture, performance, test coverage
- **Planned at**: commit `39c83e3`, 2026-06-12

## Why this matters

Plan 011 moved many APIs into feature controllers, but the most dangerous path in the grid still does not have one clear owner: changing cell data. Cell writes currently cross `GridEngine`, `DataModel`, `RowModel`, `DagEngine`, `SpreadsheetFillEngine`, subscriptions, events, undo/redo, row versions, and render invalidation.

That hidden protocol is already causing a correctness failure: formula fill-range tests now store computed numbers where the raw shifted formula strings should survive. This is exactly the class of bug that appears when raw data, computed value, formula registration, and side effects are allowed to update independently.

After this plan, every cell-value mutation should go through a single mutation kernel with a clear order: read old raw/computed state, compute next raw/formula state, write row data, sync formula graph, invalidate caches/dependents, bump row versions, emit events, register undo, and request render.

## Current state

### Verification baseline is red

At commit `39c83e3`:

```sh
corepack pnpm --filter @eregister/open-grid-core test
```

fails with:

```text
src/fillRange.test.ts > should shift formula references relatively during vertical fill
expected 10 to be '=[r2:val]*2'

src/fillRange.test.ts > should shift formula references relatively during horizontal fill
expected 15 to be '=[r1:val2]*3'
```

Sequential builds are green:

```sh
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-react build
```

React tests are green:

```sh
corepack pnpm --filter @eregister/open-grid-react test
```

### Failing tests

The failing tests prove formula raw state should be preserved separately from computed display value:

```ts
// packages/core/src/fillRange.test.ts:104
store.setCellValue('r1', 'formula', '=[r1:val]*2');

// packages/core/src/fillRange.test.ts:108
store.engine.fillRange(
	{
		start: { rowId: 'r1', colField: 'formula' },
		end: { rowId: 'r1', colField: 'formula' },
	},
	{
		start: { rowId: 'r2', colField: 'formula' },
		end: { rowId: 'r4', colField: 'formula' },
	}
);

// packages/core/src/fillRange.test.ts:120
expect(store.getCellState('r2', 'formula').value).toBe('=[r2:val]*2');
expect(store.getCellValue('r2', 'formula')).toBe(20);
```

The horizontal case has the same contract:

```ts
// packages/core/src/fillRange.test.ts:221
store.setCellValue('r1', 'formula1', '=[r1:val1]*3');

// packages/core/src/fillRange.test.ts:234
expect(store.getCellState('r1', 'formula2').value).toBe('=[r1:val2]*3');
expect(store.getCellValue('r1', 'formula2')).toBe(30);
```

### The current mutation order can clear formulas accidentally

`GridEngine.setCellValue` delegates to `DataModel.setCellValue`:

```ts
// packages/core/src/engine/GridEngine.ts:332
public setCellValue(rowId: string, colField: string, value: unknown, undoable = true): void {
  const oldValue = this.data.getRawCellValue(rowId, colField);
  if (oldValue === value) return;

  const col = this.columns.getColumnDef(colField);
  const knownOldStoredValue = col?.valueGetter ? undefined : oldValue;
  const applied = this.data.setCellValue(rowId, colField, value, knownOldStoredValue);
  if (!applied) return;

  if (undoable) {
    this.commandHistory.add({
      undo: () => this.setCellValue(rowId, colField, oldValue, false),
      redo: () => this.setCellValue(rowId, colField, value, false),
    });
  }
}
```

`DataModel.setCellValue` registers a formula before writing the raw value into the row model:

```ts
// packages/core/src/models/DataModel.ts:252
const hadFormula = this.engine.hasFormula(rowId, colField);
const previousFormula = this.engine.getFormula(rowId, colField);

this.engine.syncFormulaForCell(rowId, colField, value);

const applied = rowModel.setCellValue(rowId, colField, value);
```

But `ClientRowModelController.setCellValue` immediately calls back into `store.getCellValue` before writing the new value:

```ts
// packages/core/src/rowModel.ts:656
public setCellValue = (rowId: string, colField: string, value: unknown): boolean => {
  const node = this.getRowNodeById(rowId);
  if (!node) return false;

  const col = this.store.getColumnDef(colField);
  const oldValue = this.store.getCellValue(rowId, colField);
  const updatedRow = col?.valueSetter ? { ...node.data } : node.data;
  ...
  setValueByPath(updatedRow, colField, value);
```

That callback can observe a formula registered against the old raw row value. `DataModel.getCellValue` then clears the just-registered formula when the raw row value is still not a formula string:

```ts
// packages/core/src/models/DataModel.ts:220
const rawVal = this.getRawCellValue(rowId, colField);
if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
	if (!this.engine.hasFormula(rowId, colField) || this.engine.getFormula(rowId, colField) !== rawVal) {
		this.engine.syncFormulaForCell(rowId, colField, rawVal);
	}
} else {
	if (this.engine.hasFormula(rowId, colField)) {
		this.engine.syncFormulaForCell(rowId, colField, rawVal);
	}
}
```

This is the immediate cause of the failed fill-range assertions.

### Fill range bypasses the public mutation path

`SpreadsheetFillEngine` writes directly through `engine.data.setCellValue`:

```ts
// packages/core/src/spreadsheet/fillRange.ts:219
const applied = this.engine.data.setCellValue(rowId, colField, nextValue);
if (!applied) return;
```

Undo/redo also writes directly:

```ts
// packages/core/src/spreadsheet/fillRange.ts:131
private restoreRecords(records: FillRecord[]): void {
  for (const item of records) {
    if (item.hasFormula && item.formula) {
      this.engine.data.setCellValue(item.rowId, item.colField, item.formula);
    } else {
      this.engine.syncFormulaForCell(item.rowId, item.colField, item.value);
      this.engine.data.setCellValue(item.rowId, item.colField, item.value);
    }
  }
}
```

This means range fill can drift from public `setCellValue` behavior around undo, event dispatch, row versions, formula dependencies, and render invalidation.

### Plan 011 mutation boundary exists but is not used by controllers

`GridChangeApplier` exists:

```ts
// packages/core/src/engine/GridChangeApplier.ts:31
apply(change: GridChange<TRowData>): void {
  if (change.state !== undefined) {
    this.deps.stateManager.setState(change.state);
  }
  if (change.invalidations) {
    for (const inv of change.invalidations) {
      this.deps.invalidation.invalidate(inv);
    }
  }
  ...
  if (change.requestRender !== false) {
    this.deps.requestRender(change.reason);
  }
}
```

But feature controllers still manually orchestrate state, invalidation, events, and render requests:

```ts
// packages/core/src/features/ColumnFeatureController.ts:9
private applyColumnWidth(colField: string, width: number): void {
  this.ctx.stateManager.setState((state) => ({
    columnWidths: { ...state.columnWidths, [colField]: width },
  }));
  this.ctx.invalidation.invalidateGeometry('column resize');
  this.ctx.invalidation.invalidateColumn(colField, 'column resize');
  this.ctx.invalidation.invalidateHeaders('column resize');
  this.ctx.eventBus.dispatchEvent(GridEventName.columnResized, { colField, width });
  this.ctx.requestRender('column resize');
}
```

The grouping controller does the same:

```ts
// packages/core/src/features/GroupingFeatureController.ts:32
public setGroupBy(colIds: string[]): void {
  const state = this.ctx.stateManager.getState();
  const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
  this.ctx.stateManager.setState({ groupBy: colIds, expansion: newExpansion });
  this.ctx.invalidation.invalidateGeometry('groupBy');
  this.ctx.invalidation.invalidateViewport('groupBy');
  this.ctx.invalidation.invalidateHeaders('groupBy');
  this.ctx.invalidation.invalidateOverlay('groupBy');
  this.ctx.requestRender('groupBy');
}
```

### Guardrail is skipped

Plan 011 required `GridEngine.ts` below 800 lines, but the guard is skipped:

```ts
// packages/core/src/engine/architectureGuards.test.ts:41
it.skip('GridEngine.ts is below 800 lines', () => {
	const lines = countLines('engine/GridEngine.ts');
	expect(lines, `GridEngine.ts has ${lines} lines — must be below 800`).toBeLessThan(800);
});
```

At commit `39c83e3`, `GridEngine.ts` is 859 lines.

## Architecture target

Create a single data mutation kernel:

```text
GridApi / controllers / fill range
  -> DataMutationController.applyCellValueChange(...)
    -> read old raw/computed/formula state
    -> ask row model to write raw value without callback re-entry
    -> sync formula graph after raw write succeeds
    -> invalidate formula/valueGetter dependents
    -> clear value caches
    -> enqueue or flush cell notifications
    -> apply GridChange for render invalidation/events
    -> register undo/redo through the same path
```

Key rules:

- Raw stored value and computed value are separate concepts.
- Formula registration must reflect the raw stored value, not a transient proposed value.
- No code outside the mutation kernel should call `engine.data.setCellValue` for user-visible mutations.
- Fill range, edit commit, row model transactions, paste/fill, undo/redo, and programmatic `api.setCellValue` should share the same cell-write path unless there is a documented reason not to.
- Feature controllers must use `GridChangeApplier` for state/effects once the data mutation path is stable.

## Commands you will need

| Purpose            | Command                                                                                                                                                                             | Expected |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Focused fill tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts`                                                                                            | exit 0   |
| Data/model tests   | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts src/rowModel.test.ts src/store.test.ts src/calculations/dagEngine.test.ts`                  | exit 0   |
| Architecture tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts src/engine/GridChangeApplier.test.ts src/engine/gridFeatureEffects.test.ts` | exit 0   |
| Core build         | `corepack pnpm --filter @eregister/open-grid-core build`                                                                                                                            | exit 0   |
| Core tests         | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                             | exit 0   |
| React build        | `corepack pnpm --filter @eregister/open-grid-react build`                                                                                                                           | exit 0   |
| React tests        | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                                                            | exit 0   |
| Demo build         | `corepack pnpm --filter demo-app build`                                                                                                                                             | exit 0   |

Run core build before React build when building separately. Running them in parallel can race because React resolves `@eregister/open-grid-core/dist`.

## Scope

In scope:

- `packages/core/src/models/DataModel.ts`
- `packages/core/src/features/DataMutationController.ts` (new)
- `packages/core/src/features/GridFeatureContext.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/features/*FeatureController.ts`
- `packages/core/src/spreadsheet/fillRange.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/calculations/dagEngine.ts`
- `packages/core/src/store.ts`
- `packages/core/src/fillRange.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/rowModel.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- `packages/core/src/engine/gridFeatureEffects.test.ts`
- `packages/core/src/features/*.test.ts`

Out of scope:

- No renderer rewrite.
- No server row model redesign beyond preserving its existing `setCellValue` semantics.
- No formula language expansion.
- No new spreadsheet functions.
- No public API rename.
- No React visual changes.

## Git workflow

- Branch: `codex/012-data-mutation-kernel-hardening`
- Commit message suggestion: `fix: harden data mutation pipeline`
- Do not push or open a PR unless the operator asks.

## Steps

### Phase 0: Lock the failing behavior in place

Run the focused failing test command:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts
```

Expected at plan start: exit 1 with the two formula fill failures listed above.

Then add one more characterization test in `packages/core/src/store.test.ts` that proves direct `api.setCellValue(rowId, colField, '=...')` preserves:

- `getCellState(...).value` as the raw formula string.
- `getCellValue(...)` as the computed value.
- a subsequent update to the referenced cell recomputes the formula.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts src/store.test.ts
```

Expected during this phase: the new test should fail if it exposes the same bug. Keep it as a failing characterization until Phase 1 fixes the mutation order.

### Phase 1: Fix formula write ordering

Fix the immediate bug before refactoring broadly.

The safest target behavior:

1. Read old raw/computed state before registering the new formula.
2. Write the raw value to the row model.
3. Only after the raw write succeeds, sync the formula graph to the raw stored value.
4. Invalidate formula dependents.

Likely implementation choices:

- Move `this.engine.syncFormulaForCell(rowId, colField, value)` in `DataModel.setCellValue` to after `rowModel.setCellValue(...)` succeeds.
- Avoid calling `store.getCellValue` from `ClientRowModelController.setCellValue` when the caller already has the old computed value or does not need it.
- If `valueSetter` needs `oldValue`, compute it before changing formula registration.

Do not simply change the tests to expect computed values. `getCellState().value` is the raw/editor value contract and must preserve formula strings.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts src/store.test.ts src/calculations/dagEngine.test.ts
```

Expected: exit 0.

### Phase 2: Introduce `DataMutationController`

Create `packages/core/src/features/DataMutationController.ts`.

Target public internal methods:

```ts
export interface CellValueChangeOptions {
	undoable?: boolean;
	emitEvent?: boolean;
	notify?: boolean;
	source?: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction';
}

export interface CellValueChangeResult {
	applied: boolean;
	rowId: string;
	colField: string;
	oldRawValue: unknown;
	oldComputedValue: unknown;
	newRawValue: unknown;
	newComputedValue?: unknown;
	invalidatedCells: GridCellPointer[];
}
```

The controller should own the logic currently split across:

- `GridEngine.setCellValue`
- `DataModel.setCellValue`
- formula invalidation in `DataModel`
- row version bumps and cell notifications in `GridEngine.notifyCellChange` / `notifyBulkCellChange`
- undo/redo registration for cell changes

Migration rule:

- Keep `DataModel` as the low-level raw row/value access helper.
- Move user-visible mutation orchestration into `DataMutationController`.
- `GridEngine.setCellValue` becomes a delegator to `dataMutationFeature.applyCellValueChange(...)`.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts src/store.test.ts src/rowModel.test.ts
corepack pnpm --filter @eregister/open-grid-core build
```

Expected: exit 0.

### Phase 3: Route fill range through the mutation kernel

Update `SpreadsheetFillEngine` so it no longer calls `engine.data.setCellValue` for user-visible writes.

Requirements:

- `applyFillValue` calls the new data mutation controller with `source: 'fill'` and `undoable: false`.
- `restoreRecords` also uses the mutation controller with `source: 'undo'` / `source: 'redo'` or `undoable: false`, not direct `engine.data.setCellValue`.
- Fill range still registers one undo command for the whole fill operation, not one undo command per cell.
- Formula strings in fill records stay raw strings.
- Formula dependents and valueGetter dependents are invalidated exactly once per affected cell where practical.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/fillRange.test.ts src/renderer/runtimePerformance.test.ts
```

Expected: exit 0.

### Phase 4: Make formula raw/computed state explicit

Clarify the formula contract in code and tests.

Add or update tests for:

- `getCellState(rowId, colField).value` returns raw formula string for formula cells.
- `getCellState(rowId, colField).computedValue` returns computed value for formula cells.
- `getCellValue(rowId, colField)` returns computed value for formula cells.
- Updating a referenced raw cell invalidates and recomputes dependents.
- Replacing a formula cell with a non-formula raw value clears formula registration.
- Failed row-model writes do not leave stale formula registrations behind.

Implementation options:

- Add a `FormulaState` helper around `DagEngine`, or add clearer `DataModel` methods such as `getStoredCellValue`, `getRawCellStateValue`, and `syncFormulaFromStoredValue`.
- Keep `DagEngine` focused on dependency graph and evaluation; do not make it know about row models.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/calculations/dagEngine.test.ts src/fillRange.test.ts
```

Expected: exit 0.

### Phase 5: Complete the Plan 011 mutation/effects boundary

Once data mutations are safe, finish the part of Plan 011 that was only partially implemented.

Requirements:

- Feature controllers use `ctx.changeApplier.apply(...)` for state/effects where practical.
- `ColumnFeatureController`, `GroupingFeatureController`, `EditingFeatureController`, and `RowSelectionFeatureController` should not manually call all of `stateManager.setState`, `invalidation.*`, `eventBus.dispatchEvent`, and `requestRender` in the same method.
- `GridChange.reason` should be typed as `GridInvalidationReason`, not plain `string`, unless a reason is intentionally external.
- Avoid weakening event payloads to `any`. If event typing is awkward, add small event helper methods.

Do not force pure `GridChangeApplier` usage for low-level render-engine subscriptions or `StateManager` internals.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/GridChangeApplier.test.ts src/engine/gridFeatureEffects.test.ts src/features/ColumnFeatureController.test.ts src/features/GroupingFeatureController.test.ts src/features/EditingFeatureController.test.ts src/features/RowSelectionFeatureController.test.ts
```

Expected: exit 0.

### Phase 6: Reinstate architecture guardrails

Update `packages/core/src/engine/architectureGuards.test.ts`.

Requirements:

- Unskip the `GridEngine.ts is below 800 lines` test only after `GridEngine.ts` actually falls below 800 lines.
- Add a guard that feature controllers do not contain direct `requestRender(` calls except through `changeApplier` or an explicit short allowlist with a comment.
- Add a guard that `SpreadsheetFillEngine` does not call `engine.data.setCellValue`.
- Add a guard that `DataModel.setCellValue` is not used outside the mutation kernel and low-level tests.

If `GridEngine.ts` cannot be brought below 800 lines without broad unrelated work, set a tighter intermediate budget than 859 and create a follow-up TODO in this plan's maintenance notes. Do not leave the guard skipped without a failing/visible alternative.

Verify:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts
```

Expected: exit 0 with no skipped guard for a criterion claimed as done.

### Phase 7: Full verification

Run:

```sh
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

Expected: all commands exit 0.

## Test plan

Add or preserve tests covering:

- Formula raw/computed distinction for direct `setCellValue`.
- Formula raw/computed distinction for vertical fill.
- Formula raw/computed distinction for horizontal fill.
- Formula replacement with a non-formula raw value.
- Formula dependent invalidation after referenced-cell update.
- Fill-range undo/redo with formulas.
- `DataMutationController` result payload: old raw, old computed, new raw, invalidated cells.
- Feature controllers use `GridChangeApplier` for state/effects.
- Architecture guards for mutation kernel ownership.

Existing tests to use as patterns:

- `packages/core/src/fillRange.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/calculations/dagEngine.test.ts`
- `packages/core/src/engine/GridChangeApplier.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`

## Done criteria

All must hold:

- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `SpreadsheetFillEngine` does not call `engine.data.setCellValue` directly for user-visible writes.
- [ ] `getCellState().value` preserves formula strings; `getCellValue()` returns computed values.
- [ ] Cell mutations have one owner: `DataMutationController` or a clearly named equivalent.
- [ ] Feature controllers use `GridChangeApplier` for combined state/effect mutations.
- [ ] Architecture guard tests are active for all criteria claimed as done.
- [ ] `plans/README.md` status for Plan 012 is updated.

## STOP conditions

Stop and report back if:

- The initial focused fill-range tests no longer fail as described; refresh this plan before proceeding.
- Fixing formula write ordering requires changing public `getCellValue` or `getCellState` semantics.
- Server row model cannot support the mutation result contract without a separate reduced path.
- `valueSetter` semantics conflict with raw formula preservation.
- Moving notification/version logic into `DataMutationController` creates duplicate renders or duplicate `cellValueChanged` events that cannot be resolved locally.
- Unskipping the `GridEngine.ts < 800` guard requires unrelated renderer or row-model work.

## Maintenance notes

After this plan lands, review any code that changes cell data by asking: "Does this go through the mutation kernel?" Direct writes to `engine.data.setCellValue`, `rowModel.setCellValue`, or `syncFormulaForCell` should be rare and justified.

Future features that depend on this hardening:

- Paste/copy transformations.
- Fill handle modes.
- Formula editing UX.
- Server-confirmed edits.
- Undo/redo batches.
- Aggregation and grouping updates driven by edited values.
