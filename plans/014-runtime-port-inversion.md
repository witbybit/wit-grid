# Plan 014: Break the GridStore-engine-model cycle with narrow runtime ports

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 94c9453..HEAD -- packages/core/src/store.ts packages/core/src/rowModel.ts packages/core/src/serverRowModel.ts packages/core/src/models packages/core/src/engine packages/core/src/features packages/core/src/renderer/geometryController.ts`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. This plan assumes Plan 013 has been
> completed first; if `GridEngine.ts` is still carrying the state-reaction work
> from Plan 013, finish that before starting here.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/013-thin-engine-effects-boundary.md`
- **Category**: tech-debt
- **Planned at**: commit `94c9453`, 2026-06-12

## Why this matters

Plan 012 gave cell mutation one owner. Plan 013 makes `GridEngine` much thinner.
But the grid still has a deeper structural coupling: core models depend on the
whole engine object, row models reach back through `store.engine`, and
`GridStore` still acts as a giant mixed facade over state, events, viewport,
mutation, and persistence.

That cycle is exactly why new features still require cross-file patches. A
feature that should be local to row refresh, formula invalidation, or cell
access still forces coordinated edits across `store.ts`, `GridEngine.ts`,
`rowModel.ts`, and one or more models because those modules do not depend on
stable ports; they depend on each other concretely.

After this plan, models and row models should depend on small runtime ports with
explicit responsibilities. `GridStore` should become a thin public facade over a
smaller set of domain-oriented surfaces instead of reaching directly into raw
engine internals everywhere.

## Current state

- `packages/core/src/models/DataModel.ts` owns data reads, formula interaction,
  cache management, and event-triggered mutation helpers, but it still holds the
  entire engine:

```ts
// packages/core/src/models/DataModel.ts:5
private engine!: GridEngine<TRowData>;

// packages/core/src/models/DataModel.ts:11
public init(engine: GridEngine<TRowData>): void {
	this.engine = engine;
}

// packages/core/src/models/DataModel.ts:222
this.engine.syncFormulaForCell(rowId, colField, rawVal);
```

- `packages/core/src/models/ColumnModel.ts` is supposed to be a column
  structure/cache model, but it directly manipulates geometry and data-model
  behavior via the engine:

```ts
// packages/core/src/models/ColumnModel.ts:13
private engine!: GridEngine<TRowData>;

// packages/core/src/models/ColumnModel.ts:64
this.engine.geometry.updateColumns(widths, this.defaultColWidth);

// packages/core/src/models/ColumnModel.ts:65
this.engine.data.updateCompiledGetters(normalizedColumns);
```

- `packages/core/src/models/CellAccess.ts` is a read-model helper, but it also
  depends on the whole engine for state, selection, row model, columns, and
  data access:

```ts
// packages/core/src/models/CellAccess.ts:5
private engine!: GridEngine<TRowData>;

// packages/core/src/models/CellAccess.ts:35
const value = this.engine.data.getCellValue(rowId, column.field);

// packages/core/src/models/CellAccess.ts:48
const isRowSelected = this.engine.selection.isRowSelected(rowIndex);
```

- `packages/core/src/rowModel.ts` still reaches back through `store.engine` for
  formula synchronization, dependent invalidation, and notifications:

```ts
// packages/core/src/rowModel.ts:489
this.store.engine.syncFormulaForCell(rowId, field, nextVal);

// packages/core/src/rowModel.ts:492
const invalidated = this.store.engine.invalidateFormulaCell(rowId, field);

// packages/core/src/rowModel.ts:558
this.store.engine.notifyBulkCellChange(notifyCells);
```

- `packages/core/src/store.ts` is still a large mixed facade at 893 lines. It
  reaches directly into raw engine sub-systems for state, event bus, viewport,
  columns, and data:

```ts
// packages/core/src/store.ts:155
this.engine.stateManager.setState(val);

// packages/core/src/store.ts:486
return this.engine.eventBus.addEventListener(type, callback);

// packages/core/src/store.ts:307
left: this.engine.viewport.pinLeftColumns,
right: this.engine.viewport.pinRightColumns,
```

- The new extracted controllers already show the preferred direction for this
  codebase: narrow constructor ports instead of ambient engine access. Match the
  dependency style used by `packages/core/src/features/DataMutationController.ts`
  and `packages/core/src/engine/CellNotificationController.ts`.

## Commands you will need

| Purpose                       | Command                                                                                                                                        | Expected on success |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Core build                    | `corepack pnpm --filter @eregister/open-grid-core build`                                                                                       | exit 0              |
| Core tests                    | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                        | all core tests pass |
| Focused store/row-model tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/rowModel.test.ts src/serverRowModel.test.ts`           | exit 0              |
| Focused architecture tests    | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts src/engine/gridFeatureEffects.test.ts` | exit 0              |
| React build                   | `corepack pnpm --filter @eregister/open-grid-react build`                                                                                      | exit 0              |
| React tests                   | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                       | exit 0              |
| Demo build                    | `corepack pnpm --filter demo-app build`                                                                                                        | exit 0              |

Run package builds sequentially. `demo-app build` should run only after core and
React package builds complete.

## Scope

**In scope**:

- `packages/core/src/store.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/serverRowModel.ts`
- `packages/core/src/models/DataModel.ts`
- `packages/core/src/models/ColumnModel.ts`
- `packages/core/src/models/CellAccess.ts`
- `packages/core/src/models/ViewportModel.ts` only if it needs the same runtime-port treatment
- `packages/core/src/engine/*.ts` only for composition-root wiring and narrow delegators
- `packages/core/src/features/*.ts` only if a new port needs to be injected there
- `packages/core/src/renderer/geometryController.ts` only if a model/geometry dependency move requires it
- `packages/core/src/engine/architectureGuards.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/rowModel.test.ts`
- `packages/core/src/serverRowModel.test.ts`

**Out of scope**:

- No renderer decomposition of `renderEngine.ts` or `rowRenderer.ts`.
- No public API redesign beyond adding thin internal delegates needed to remove
  direct subsystem reach-through.
- No formula language changes.
- No new grid features.
- No persistence feature expansion.

## Git workflow

- Branch: `codex/014-runtime-port-inversion`
- Commit style: match recent history, e.g. `fix: harden data mutation pipeline`
  and other plan-scoped architecture commits.
- Keep commits logical: one for port definitions/composition wiring, one for
  model and row-model migration, one for guardrails/tests if that makes review
  easier.
- Do not push unless explicitly instructed.

## Steps

### Step 1: Lock the post-013 baseline

Before editing, confirm Plan 013 is actually done in the live tree. This plan
assumes:

- `GridEngine.ts` is below the active 800-line guard.
- `GridFeatureContext` is already narrowed.
- state-reaction logic and cell-notification batching are already extracted.

Run the focused architecture tests and the full core test suite first. If the
baseline is not green, stop and finish or refresh Plan 013 before proceeding.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts --reporter=verbose` -> exit 0, no skipped guard tests.
- `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0.

### Step 2: Define explicit runtime ports

Introduce narrow internal interfaces for the dependencies that models and row
models actually need. Good examples:

```ts
export interface GridFormulaRuntime {
	hasFormula(rowId: string, colField: string): boolean;
	getFormula(rowId: string, colField: string): string | undefined;
	getCachedFormulaValue(rowId: string, colField: string): { hasCached: boolean; value: unknown };
	evaluateFormulaCell(rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown): unknown;
	syncFormulaForCell(rowId: string, colField: string, value: unknown): void;
	invalidateFormulaCell(rowId: string, colField: string): GridCellPointer[];
}

export interface GridDataReadRuntime<TRowData> {
	getState(): GridState<TRowData>;
	getRowModel(): RowModel<TRowData> | null;
	getColumnDef(colField: string): ColumnDef<TRowData> | undefined;
}

export interface RowModelMutationRuntime<TRowData> {
	clearFormulas(): void;
	syncFormulaForCell(rowId: string, colField: string, value: unknown): void;
	invalidateFormulaCell(rowId: string, colField: string): GridCellPointer[];
	getValueGetterDependents(colField: string): string[];
	notifyBulkCellChange(changes: Map<string, Set<string>>): void;
	dispatchRowsUpdated(payload: ...): void;
}
```

The exact interface names can differ, but the rule is strict: each port should
encode one responsibility cluster, not recreate `GridEngine` under a new name.

Put the port types in a stable internal location such as
`packages/core/src/engine/runtimePorts.ts` or `packages/core/src/internal/runtimePorts.ts`.
Do not scatter one-off local interfaces across many files.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 3: Refactor models off `GridEngine`

Migrate `DataModel`, `ColumnModel`, and `CellAccessModel` so they no longer
store `private engine!: GridEngine<TRowData>` or expose `init(engine)`.

Target shape:

- `DataModel` receives only the read/formula/metrics ports it actually needs.
- `ColumnModel` receives geometry/data-update and pin/geometry-read ports, not
  the whole engine.
- `CellAccessModel` receives a read-only access port for state, selection,
  columns, data, and row model lookup.

Keep composition-root wiring in `GridEngine` or a nearby internal factory. The
goal is not to make models construct themselves; the goal is to make them
depend only on explicit contracts.

Do not widen the ports just to avoid thinking. If a model needs one extra read,
add that read to the relevant port instead of passing the whole engine.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/engine/gridFeatureEffects.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 4: Refactor row models off `store.engine`

Migrate `ClientRowModelController` and `serverRowModel.ts` so they do not reach
through `store.engine.*`.

Requirements:

- Replace `this.store.engine.syncFormulaForCell`, `invalidateFormulaCell`,
  `notifyBulkCellChange`, `columns.getValueGetterDependents`, and similar calls
  with a dedicated row-model runtime port.
- Keep the row model responsible for row-pipeline refresh policy and local row
  data structures.
- Keep formula mutation orchestration out of `store.ts`.
- Preserve existing behavior for:
    - row updates that invalidate formula dependents,
    - grouped/sorted/filtered refresh decisions,
    - `rowsUpdated` event dispatch,
    - server row-model cache clears and formula resets.

Do not solve this by passing `GridStore` deeper into more places. The direction
must be toward explicit ports.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/serverRowModel.test.ts src/store.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 5: Thin `GridStore` into a public facade

After the port extraction, reduce `GridStore`'s direct raw subsystem reach. The
store should mostly forward to a smaller set of stable engine/domain methods.

Good candidates to move behind thin delegates if they still reach directly into
raw internals:

- direct `stateManager.setState/getState` write paths used for public API
  methods,
- direct `eventBus` calls,
- direct `viewport` reads for pins and scrolling where a higher-level delegate
  already exists,
- direct `columns`/`data` reads where a public engine/store helper can own the
  contract.

Do not create a new god-object facade. Prefer a few coherent engine/store
delegates such as:

- public state facade methods,
- public viewport facade methods,
- public read-model helpers,
- public event facade methods.

The point is to make `store.ts` read like an API surface, not like the second
composition root.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0.

### Step 6: Add architecture guardrails for port ownership

Extend `packages/core/src/engine/architectureGuards.test.ts` with active guards
that make this architecture hard to regress.

Add narrow, explicit checks such as:

- `packages/core/src/models/DataModel.ts` does not contain `GridEngine<`.
- `packages/core/src/models/ColumnModel.ts` does not contain `GridEngine<`.
- `packages/core/src/models/CellAccess.ts` does not contain `GridEngine<`.
- `packages/core/src/rowModel.ts` does not contain `store.engine.`.
- `packages/core/src/serverRowModel.ts` does not contain `store.engine.`.
- `store.ts` stays below a tighter budget than 900 after this refactor. Target
  `< 850`; if that cannot be reached without unrelated public API churn, set a
  visible intermediate guard and record the follow-up in `plans/README.md`.

Do not add brittle guards that fail on comments or tests. Guard against the
actual structural regressions.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts --reporter=verbose` -> exit 0.

### Step 7: Run full sequential verification

Run these commands in order:

1. `corepack pnpm --filter @eregister/open-grid-core build`
2. `corepack pnpm --filter @eregister/open-grid-react build`
3. `corepack pnpm --filter @eregister/open-grid-core test`
4. `corepack pnpm --filter @eregister/open-grid-react test`
5. `corepack pnpm --filter demo-app build`

Expected: all exit 0.

## Test plan

- Extend `packages/core/src/engine/architectureGuards.test.ts` with the new
  port/boundary checks.
- Preserve and rerun the existing behavior-focused tests in:
    - `packages/core/src/store.test.ts`
    - `packages/core/src/rowModel.test.ts`
    - `packages/core/src/serverRowModel.test.ts`
- Add focused tests only where a new port changes observable behavior or
  composition:
    - a store-level test that formula-dependent row updates still invalidate and
      notify correctly,
    - a row-model test that transaction/update paths still notify dependent
      cells,
    - a server-row-model test that formula/cache clears still happen on datasource
      resets or row replacement paths.
- Use the new extracted controller tests from Plans 012-013 as the structural
  example for dependency-injected unit tests instead of building everything
  through `GridStore`.

## Done criteria

All must hold:

- [ ] `DataModel`, `ColumnModel`, and `CellAccessModel` do not depend on the
      concrete `GridEngine` type.
- [ ] `ClientRowModelController` and `serverRowModel.ts` do not call
      `store.engine.*`.
- [ ] Stable internal runtime-port interfaces exist in one shared location.
- [ ] `GridStore` is thinner and no longer acts as a raw subsystem grab-bag.
- [ ] Architecture guards enforce the model/row-model port boundaries.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `plans/README.md` status for Plan 014 is updated.

## STOP conditions

Stop and report back if:

- Plan 013 is not actually complete in the live codebase.
- Removing concrete `GridEngine` dependencies from models requires a renderer
  rewrite or public API redesign.
- A proposed port starts accreting unrelated responsibilities and effectively
  recreates `GridEngine` or `GridStore` under a different name.
- Tightening the `store.ts` size guard requires moving persistence, plugin, or
  adapter behavior into unrelated files just to satisfy the metric.
- Server row-model behavior depends on engine internals that cannot be expressed
  as a narrow port without also changing public semantics.

## Maintenance notes

- Reviewers should be suspicious of any new `private engine!: GridEngine` field
  outside the composition root and renderer-specific orchestration code.
- Future features that touch formulas, row refresh, or cell access should plug
  into the relevant runtime port instead of threading new one-off engine
  reach-throughs.
- This plan intentionally does not decompose `renderEngine.ts` or
  `rowRenderer.ts`; that should be a separate rendering-core plan after the
  store/model/runtime boundaries are stable.
