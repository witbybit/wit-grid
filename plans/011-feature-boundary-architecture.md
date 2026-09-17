# Plan 011: Establish feature boundary architecture

> **Executor instructions**: Execute in phases, in order. This is an architecture hardening plan, not a feature plan. Keep behavior unchanged unless a phase explicitly says otherwise. Add characterization tests before moving code. Do not make broad rewrites outside the in-scope files.
>
> **Drift check (run first)**: `git diff --stat 53fe61f..HEAD -- packages/core/src/store.ts packages/core/src/createGrid.ts packages/core/src/engine packages/core/src/models packages/core/src/renderer packages/core/src/gridHost.ts packages/core/src/internal.ts packages/react/src/OpenGrid.tsx packages/react/src/GridPortal.tsx packages/react/src/chart`
>
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. If they do not match, stop and refresh this plan before editing.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 009 and Plan 010 implemented
- **Category**: tech-debt, architecture, maintainability, performance
- **Planned at**: commit `53fe61f`, 2026-06-12

## Why this matters

Plans 009 and 010 improved layout and core state correctness, but the next bottleneck is ownership. New features still require patching several files because feature behavior is spread across `GridApi`, `GridStore`, `GridEngine`, renderer invalidation, events, persistence, and React adapter internals.

AG Grid-level systems do not scale by making one engine method remember every side effect. They scale by giving each feature a clear owner and by routing every state mutation through an explicit change contract: state patch, derived model updates, invalidation, events, render request, persistence trigger, and undo/redo.

After this plan, adding a feature such as "column pinning policy", "range fill mode", "group selection policy", or "server-side grouping" should primarily touch one feature controller and one API facade registration, not `store.ts`, `GridEngine.ts`, renderer code, and React internals in lockstep.

## Current state

The current implementation has good building blocks, but ownership is still too centralized:

- `packages/core/src/store.ts` is 1600+ lines. It exports public types, state slices, validation helpers, `GridApi`, `InternalGridApi`, and the `GridStore` implementation from one file.
- `packages/core/src/engine/GridEngine.ts` is 1000+ lines. It owns column mutations, sorting, filtering, grouping, editing, row selection, subscriptions, formula invalidation, derived state, invalidation, event dispatch, and render requests.
- `packages/core/src/createGrid.ts` manually mirrors every public API method into a frozen facade.
- `packages/react/src/OpenGrid.tsx` and `packages/react/src/GridPortal.tsx` import `@eregister/open-grid-core/internal` for routine adapter work.

Evidence:

```ts
// packages/core/src/store.ts:373
export interface GridModelState<TRowData = unknown> {
  getRowId?: (row: TRowData) => string;
  columns: ColumnDef<TRowData>[];
  defaultRowHeight: number;
  defaultColWidth: number;
  enableColumnReorder: boolean;
  rowHeights: Record<string, number>;
  columnWidths: Record<string, number>;
  sortModel: SortModel | null;
  filterModel: FilterModel | null;
  groupBy?: string[];
  aggDefs?: AggregationDef<TRowData>[];
  ...
}

// packages/core/src/store.ts:453
export type GridState<TRowData = unknown> =
  GridModelState<TRowData> & GridRuntimeState & GridUIState;
```

The state type is sliced, but writes are still untyped partial patches against the combined state:

```ts
// packages/core/src/state/StateManager.ts:25
public setState = (updater: GridStateUpdater<TRowData>): void => {
  const nextState = typeof updater === 'function' ? updater(this.state) : updater;
  ...
  this.state = { ...prevState, ...nextState };
  const affectedKeys = Object.keys(nextState);
  this.notifyChanges(prevState, affectedKeys);
};
```

Side effects are hand-coded per feature in `GridEngine`:

```ts
// packages/core/src/engine/GridEngine.ts:299
public setGroupBy(colIds: string[]): void {
  const state = this.stateManager.getState();
  const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
  this.stateManager.setState({ groupBy: colIds, expansion: newExpansion });
  this.invalidation.invalidateGeometry('groupBy');
  this.invalidation.invalidateViewport('groupBy');
  this.invalidation.invalidateHeaders('groupBy');
  this.invalidation.invalidateOverlay('groupBy');
  this.requestRender('groupBy');
}

// packages/core/src/engine/GridEngine.ts:837
private applyColumnWidth = (colField: string, width: number): void => {
  this.stateManager.setState((state) => ({
    columnWidths: { ...state.columnWidths, [colField]: width },
  }));
  this.invalidation.invalidateGeometry('column resize');
  this.invalidation.invalidateColumn(colField, 'column resize');
  this.invalidation.invalidateHeaders('column resize');
  this.eventBus.dispatchEvent(GridEventName.columnResized, { colField, width });
  this.requestRender('column resize');
};
```

The public facade duplicates method wiring one by one:

```ts
// packages/core/src/createGrid.ts:100
export function createApiFacade<TRowData>(
  store: GridStore<TRowData>,
  destroy: () => void,
  persistenceAdapter?: GridPersistenceAdapter,
  persistenceController?: PersistenceController
): GridApi<TRowData> {
  const api = {
    getState: () => store.getState(),
    setRows: (rows: TRowData[]) => store.setRows(rows),
    ...
    setColumnWidth: (colField: string, width: number) => store.setColumnWidth(colField, width),
    ...
    applyGridState: (state: PersistedGridState) => store.applyGridState(state),
    ...
  };
```

React adapter code still relies on internal core types and store access:

```ts
// packages/react/src/OpenGrid.tsx:16
import { InternalColumnDef, GridHost, mountGridHost, getStoreFromApi } from '@eregister/open-grid-core/internal';

// packages/react/src/OpenGrid.tsx:380
const visualRow = Number.isFinite(rowIndex) ? getStoreFromApi(api).getVisualRow(rowIndex) : null;

// packages/react/src/OpenGrid.tsx:390
const access = getStoreFromApi(api).getCellAccess(pointer.rowId, pointer.colField);

// packages/react/src/GridPortal.tsx:24
import type { InternalColumnDef, InternalGridApi } from '@eregister/open-grid-core/internal';

// packages/react/src/GridPortal.tsx:132
const iCol = col as InternalColumnDef | undefined;
```

The internal boundary test proves the team wants a clean public/internal split, but the React package still has to cross that boundary because the adapter contract is not rich enough:

```ts
// packages/core/src/boundary.test.ts:97
it('does not expose store, engine, or renderer-level methods on public API', () => {
  const api = createClientGrid({ columns: [{ field: 'id' }], rows: [] }) as Record<string, unknown>;
  const internalOnlyMethods = [
    'store',
    'engine',
    'getRenderStats',
    ...
  ];
```

## Architecture target

Introduce three boundaries:

1. **Feature controllers own domain mutations**
    - `ColumnFeatureController`: columns, widths, order, visibility, pin counts, column state.
    - `GroupingFeatureController`: groupBy, group expansion invalidation, group footers, sticky group toggle, aggregation definitions.
    - `EditingFeatureController`: active edit state, validation, async value setter, rollback, edit events.
    - `RowSelectionFeatureController`: row selection gestures, select-all data rows, row selection events.
    - `UiFeatureController`: sidebar and chart panel state.

2. **A mutation/effects contract owns side effects**
    - Feature controllers should not manually call `stateManager.setState`, `invalidation.*`, `eventBus.dispatchEvent`, and `requestRender` in arbitrary order.
    - They should return or apply a single `GridChange` object through a `GridChangeApplier`.

Suggested type shape:

```ts
export interface GridChange<TRowData = unknown> {
	reason: GridInvalidationReason;
	state?: GridStateUpdater<TRowData>;
	invalidations?: GridInvalidation[];
	events?: Array<{
		type: keyof GridEventPayloadMap<TRowData>;
		payload: GridEventPayloadMap<TRowData>[keyof GridEventPayloadMap<TRowData>];
	}>;
	undo?: GridChange<TRowData>;
	redo?: GridChange<TRowData>;
	requestRender?: boolean;
}
```

If the event typing becomes awkward, prefer a small helper method per event over weakening the whole contract to `any`.

3. **Framework adapters use a stable host adapter contract**
    - Keep `@eregister/open-grid-core/internal` for renderer mounting, but stop requiring React to recover `GridStore` for common interactions.
    - Add adapter-facing methods to `GridHost` or a new `GridAdapterHandle`, not to the public `GridApi`.
    - Examples: `getCellPointerFromElement`, `getCellAccessFromElement`, `getGroupVisibleDescendantRowIds`, `isImperativeRendererColumn`.

## Commands you will need

| Purpose      | Command                                                                                                               | Expected |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Core build   | `corepack pnpm --filter @eregister/open-grid-core build`                                                              | exit 0   |
| Core tests   | `corepack pnpm --filter @eregister/open-grid-core test`                                                               | exit 0   |
| React build  | `corepack pnpm --filter @eregister/open-grid-react build`                                                             | exit 0   |
| React tests  | `corepack pnpm --filter @eregister/open-grid-react test`                                                              | exit 0   |
| Demo build   | `corepack pnpm --filter demo-app build`                                                                               | exit 0   |
| Format check | `corepack pnpm exec prettier --check packages/core/src packages/react/src plans/011-feature-boundary-architecture.md` | exit 0   |

## Scope

In scope:

- `packages/core/src/store.ts`
- `packages/core/src/createGrid.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/engine/*`
- `packages/core/src/features/*` (new)
- `packages/core/src/state/*`
- `packages/core/src/models/*`
- `packages/core/src/gridHost.ts`
- `packages/core/src/internal.ts`
- `packages/core/src/boundary.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/engine/*.test.ts` (create if needed)
- `packages/react/src/OpenGrid.tsx`
- `packages/react/src/GridPortal.tsx`
- `packages/react/src/chart/GridChartOverlay.tsx`
- `packages/react/src/index.test.tsx`

Out of scope:

- No new grid features.
- No renderer DOM rewrite.
- No server row model pipeline redesign.
- No accessibility role model changes.
- No public breaking API rename.
- No change to visual styling or demo page behavior except where tests need a small fixture.

## Git workflow

- Branch: `codex/011-feature-boundary-architecture`
- Commit style in recent history is short descriptive messages, often WIP. Use a clearer commit message such as `refactor: introduce grid feature boundaries`.
- Do not push or open a PR unless the operator asks.

## Execution phases

### Phase 0: Characterize current mutation behavior

Before moving code, add tests that lock down the side effects of representative mutations.

Add or extend tests in:

- `packages/core/src/store.test.ts`
- `packages/core/src/boundary.test.ts`
- Create `packages/core/src/engine/gridFeatureEffects.test.ts` if there is no better existing home.
- `packages/react/src/index.test.tsx` for adapter behavior.

Required test coverage:

- `setColumnWidth` changes `columnWidths`, dispatches `columnResized`, invalidates geometry/headers/column, and triggers one render invalidation.
- `setGroupBy` clears group expansion, invalidates geometry/viewport/headers/overlay, and emits `groupByChanged`.
- `setAggDefs` updates `aggDefs`, invalidates viewport/overlay, emits `aggDefsChanged`.
- `startEditing` and `commitEdit` preserve current async validator/valueSetter behavior.
- `applyRowSelectionGesture` updates `selectedRowIds`, invalidates changed rows and headers, emits `rowSelectionChanged`.
- React still resolves click params for a data cell without exposing store/engine on public `GridApi`.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

Expected: exit 0. Tests may initially exercise the current implementation, not the future one.

### Phase 1: Add `GridChangeApplier`

Create a small internal mutation/effects module.

Suggested files:

- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/engine/GridChangeApplier.test.ts`

Responsibilities:

- Apply the optional state patch via `StateManager`.
- Apply each invalidation through `InvalidationManager.invalidate`.
- Dispatch events after state/invalidation has been applied.
- Add undo/redo commands when provided.
- Request render once per change when `requestRender !== false`.

Rules:

- Do not move feature behavior in this phase.
- Wire `GridEngine` to own one `changeApplier` instance.
- Keep `GridEngine.requestRender` private if possible; pass a callback into `GridChangeApplier`.

Done criteria:

- `GridChangeApplier` is unit-tested independently.
- It can apply state-only, invalidation-only, event-only, and combined changes.
- No feature method behavior changes yet.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/GridChangeApplier.test.ts
corepack pnpm --filter @eregister/open-grid-core build
```

Expected: exit 0.

### Phase 2: Extract `ColumnFeatureController`

Create:

- `packages/core/src/features/ColumnFeatureController.ts`
- `packages/core/src/features/ColumnFeatureController.test.ts`

Move ownership for:

- `resizeColumn`
- `moveColumn`
- `setColumnOrderByFields`
- `setColumnReorderEnabled`
- `setColumns`
- private helpers `applyColumnWidth`, `applyColumnOrder`, `moveColumnInList`
- column state methods currently on `GridStore`: `getColumnState`, `applyColumnState`

Target shape:

```ts
export class ColumnFeatureController<TRowData = unknown> {
	constructor(private readonly ctx: GridFeatureContext<TRowData>) {}
	resizeColumn(colField: string, width: number, undoable = true): void;
	moveColumn(colField: string, toIndex: number): void;
	setColumnOrderByFields(colFields: string[]): void;
	setColumns(columns: ColumnDef<TRowData>[], undoable?: boolean): void;
	getColumnState(): ColumnState[];
	applyColumnState(states: ColumnState[]): void;
}
```

`GridFeatureContext` should expose only the dependencies a controller needs: `stateManager`, `columns`, `invalidation`, `eventBus`, `changeApplier`, and `commandHistory` if still needed directly.

Migration rules:

- `GridEngine` keeps thin delegating methods for compatibility during this plan.
- `GridStore` keeps public API methods, but they delegate through `engine.columnsFeature` or equivalent.
- No React changes in this phase.

Done criteria:

- Column mutation logic no longer lives directly in `GridEngine.ts`.
- Existing column resize/order/reorder tests pass.
- `GridEngine.ts` loses the extracted column helper methods.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/boundary.test.ts src/engine/GridChangeApplier.test.ts
corepack pnpm --filter @eregister/open-grid-core build
```

Expected: exit 0.

### Phase 3: Extract grouping and aggregation feature ownership

Create:

- `packages/core/src/features/GroupingFeatureController.ts`
- `packages/core/src/features/GroupingFeatureController.test.ts`

Move ownership for:

- `setGroupBy`
- `addGroupBy`
- `removeGroupBy`
- `moveGroupBy`
- `setAggDefs`
- `setShowGroupFooter`
- `setStickyGroupRows`
- group expansion invalidation currently coordinated by `GridStore.applyRowModelRefreshInvalidation`
- `expandAllGroups`, `collapseAllGroups`, `toggleGroupExpanded`

Rules:

- The row model may still execute the actual expand/collapse operation. The controller owns the API command and the invalidation/event contract.
- Do not change `RowPipeline` or group metadata in this phase.
- Use `GridChangeApplier` for the state/event/render side effects.

Done criteria:

- Grouping-related mutation methods in `GridEngine` and `GridStore` are delegators only.
- No code outside the grouping controller manually coordinates groupBy state, expansion reset, group invalidation, and render request.
- Existing group, sticky group, aggregation, and layout tests pass.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/rows/stages/groupStage.test.ts src/rows/stages/flattenStage.test.ts src/renderer/layoutPlan.test.ts
corepack pnpm --filter @eregister/open-grid-core test
```

Expected: exit 0.

### Phase 4: Extract editing and row-selection controllers

Create:

- `packages/core/src/features/EditingFeatureController.ts`
- `packages/core/src/features/RowSelectionFeatureController.ts`
- Tests beside each controller.

Move ownership for:

- `startEdit`, `stopEdit`
- async `commitEdit` currently implemented in `GridStore`
- `applyRowSelectionGesture`, `selectRowIds`, `deselectRowIds`, `toggleRowId`, `selectAllDataRows`, `clearRowSelection`
- private helpers `reduceRowSelection`, `getAllSelectableDataRowIds`, `canEditCell`, `isDataCellSelectable` if they only support these features.

Important editing rule:

- `commitEdit` must remain async and must keep the current flow: validate, optimistic update, await `valueSetter`, rollback on failure, set `activeEdit.validationError`, close editor on success.
- If rapid edits can overlap, preserve current behavior first. Do not introduce a queue unless an existing test fails because of the refactor.

Done criteria:

- `GridStore.commitEdit` is a delegator, not the owner of async edit behavior.
- `GridEngine.ts` no longer owns row selection reduction logic.
- Existing edit and selection tests pass.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/models/SelectionModel.test.ts
corepack pnpm --filter @eregister/open-grid-react test
```

Expected: exit 0.

### Phase 5: Introduce an adapter-facing host contract

React currently reaches into `@eregister/open-grid-core/internal` for common tasks. Replace common store reach-throughs with a stable host/adapter handle.

Add to `packages/core/src/gridHost.ts` or a new adjacent module:

```ts
export interface GridAdapterHandle<TRowData = unknown> {
	getCellPointerFromElement(element: Element): GridCellPointer | null;
	getCellAccessFromElement(element: Element): GridCellAccess<TRowData> | null;
	getGroupVisibleDescendantRowIds(groupId: string): string[];
	isImperativeRendererColumn(column: ColumnDef<TRowData>): boolean;
}
```

Then expose the handle from `mountGridHost` return value or through a clearly named helper. Prefer extending `GridHost` if it already owns the mounted DOM container.

Migrate:

- `packages/react/src/OpenGrid.tsx` cell click pointer/access resolution.
- `packages/react/src/GridPortal.tsx` group descendant lookup.
- `packages/react/src/GridPortal.tsx` imperative renderer capability checks.
- `packages/react/src/chart/GridChartOverlay.tsx` store access if it only needs read-only row/cell state that can be represented by the adapter/public API.

Do not remove `@eregister/open-grid-core/internal` entirely in this phase; React may still need `mountGridHost`, `GridHost`, and internal column type imports until the host contract is complete.

Done criteria:

- `OpenGrid.tsx` no longer calls `getStoreFromApi(api)`.
- `GridPortal.tsx` no longer casts the public api to `InternalGridApi`.
- Any remaining `@eregister/open-grid-core/internal` imports in React are limited to renderer mounting or documented adapter-only types.
- Boundary tests assert public `GridApi` still has no hidden store/engine methods.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter @eregister/open-grid-react build
```

Expected: exit 0.

### Phase 6: Shrink `store.ts` into API/types modules

After feature controllers exist, split `store.ts` without changing exports.

Suggested files:

```text
packages/core/src/api/
  GridApi.ts
  GridApiFacade.ts
  GridEvents.ts
  GridSelectionTypes.ts
packages/core/src/state/
  GridState.ts
packages/core/src/store.ts
```

Target responsibilities:

- `api/GridApi.ts`: public `GridApi`, `InternalGridApi`, API helper types.
- `api/GridEvents.ts`: `GridEventName`, event payload map, listener types.
- `state/GridState.ts`: `GridModelState`, `GridRuntimeState`, `GridUIState`, `GridState`, `GridStateUpdater`, `Listener`.
- `store.ts`: `GridStore` implementation and compatibility re-exports only.

Rules:

- Keep import paths working by re-exporting from `store.ts` during this phase.
- Do not update every internal import unless needed. The goal is to create the boundary, not churn the whole repo.
- `packages/core/src/index.ts` and `packages/core/src/internal.ts` must continue to export the same public/runtime values.

Done criteria:

- `store.ts` is below 900 lines.
- `GridApi` and state slice definitions no longer live in `store.ts`.
- Public package exports remain compatible.
- `boundary.test.ts` passes unchanged or with stricter assertions.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter @eregister/open-grid-react test
```

Expected: exit 0.

### Phase 7: Add architecture guardrails

Add lightweight tests or checks that prevent regression into the old pattern.

Required guardrails:

- A test that fails if `packages/core/src/engine/GridEngine.ts` grows above 800 lines.
- A test that fails if `packages/core/src/store.ts` grows above 900 lines after Phase 6.
- A boundary test that lists the allowed `@eregister/open-grid-core/internal` imports from React and fails on new `getStoreFromApi` usage outside approved files.
- A test or lint-like script that forbids new direct `stateManager.setState` calls in feature-adjacent files except inside feature controllers, `StateManager`, and a short allowlist.

Do not add a new lint dependency. Implement these as Vitest tests using Node `fs` reads if needed.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

Expected: exit 0.

## Test plan

Add tests before extraction and keep them green through each phase:

- `GridChangeApplier.test.ts`: state patch, invalidation application, event dispatch, render request coalescing, undo/redo registration.
- `ColumnFeatureController.test.ts`: width, order, visibility, get/apply column state.
- `GroupingFeatureController.test.ts`: set groupBy clears stale group expansion, group toggle invalidation uses row model refresh result, aggregation definitions emit expected event.
- `EditingFeatureController.test.ts`: sync validator failure, async validator failure, valueSetter rollback, success closes editor.
- `RowSelectionFeatureController.test.ts`: replace/select/deselect/toggle/selectAll/clear gestures and event payloads.
- `boundary.test.ts`: public API remains frozen and does not expose store/engine/renderer; React no longer depends on `getStoreFromApi` for click/access paths.

Use existing tests as patterns:

- `packages/core/src/store.test.ts`
- `packages/core/src/boundary.test.ts`
- `packages/core/src/renderer/invalidationManager.test.ts`
- `packages/react/src/index.test.tsx`

## Done criteria

All must hold:

- [ ] `GridChangeApplier` exists and owns mutation side-effect ordering.
- [ ] Column, grouping, editing, and row-selection mutations are owned by feature controllers.
- [ ] `GridEngine.ts` is below 800 lines.
- [ ] `store.ts` is below 900 lines.
- [ ] `OpenGrid.tsx` no longer calls `getStoreFromApi(api)`.
- [ ] `GridPortal.tsx` no longer casts public `api` to `InternalGridApi`.
- [ ] Public `GridApi` remains frozen and does not expose store/engine/renderer internals.
- [ ] Core build/test, React build/test, and demo build exit 0.
- [ ] `plans/README.md` status for Plan 011 is updated.

## STOP conditions

Stop and report back if:

- The current code no longer matches the excerpts above.
- Extracting a controller requires changing public `GridApi` semantics.
- A feature controller needs renderer DOM access. Feature controllers may request invalidation; they must not manipulate DOM.
- `GridChangeApplier` requires weakening event payloads to broad `any` across the system.
- React cannot stop using `getStoreFromApi` without adding store/engine methods to public `GridApi`.
- A phase causes broad test failures outside the feature being extracted.

## Maintenance notes

After this plan lands, review new feature PRs by asking: "Which feature controller owns this?" If the answer is "GridEngine" or "GridStore", reject the design unless it is infrastructure.

New state fields must still be assigned to `GridModelState`, `GridRuntimeState`, or `GridUIState`, but this plan adds the missing second rule: new writes to those fields must go through the owning feature controller and `GridChangeApplier`.

Future plans that build naturally on this:

- Server/client row model pipeline unification.
- Public plugin/module API, similar to AG Grid modules.
- Accessibility role model and keyboard interaction contracts.
- Renderer capability registry so React no longer imports `InternalColumnDef`.
