# Plan 013: Make GridEngine a thin orchestration kernel

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 94c9453..HEAD -- packages/core/src/engine packages/core/src/features packages/core/src/state packages/core/src/store.ts packages/core/src/viewportController.ts packages/react/src/chart`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/012-data-mutation-kernel-hardening.md`
- **Category**: tech-debt
- **Planned at**: commit `94c9453`, 2026-06-12

## Why this matters

Plan 012 fixed the highest-risk data mutation path: core tests are now green,
formula fill routes through `DataMutationController`, and fill no longer writes
directly through `DataModel`. The next blocker to AG Grid-level maintainability
is that `GridEngine` is still too much of the system: it constructs every
subsystem, owns feature forwarding, owns subscription batching, reacts to all
state changes, emits many events, manages render transactions, and still hosts
some feature mutations directly.

That central gravity is why new features keep needing cross-file protocol
patches. This plan makes the engine a thin composition kernel and makes
side-effect ownership explicit enough to enforce with tests.

## Current state

- `packages/core/src/engine/GridEngine.ts` is 988 lines. It is under the new
  intermediate guard but still above the real 800-line target.
- `packages/core/src/engine/architectureGuards.test.ts` has an active
  `< 1000` guard and a skipped `< 800` guard:

```ts
// packages/core/src/engine/architectureGuards.test.ts:46
it('GridEngine.ts is below 1000 lines (intermediate budget, target 800)', () => {
	const lines = countLines('engine/GridEngine.ts');
	expect(lines, `GridEngine.ts has ${lines} lines — intermediate budget is 1000, target is 800`).toBeLessThan(1000);
});

// packages/core/src/engine/architectureGuards.test.ts:54
it.skip('GridEngine.ts is below 800 lines', () => {
	const lines = countLines('engine/GridEngine.ts');
	expect(lines, `GridEngine.ts has ${lines} lines — must be below 800`).toBeLessThan(800);
});
```

- `GridFeatureContext` still exposes raw side-effect primitives to every
  feature controller:

```ts
// packages/core/src/features/GridFeatureContext.ts:8
export interface GridFeatureContext<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	columns: ColumnModel<TRowData>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	changeApplier: GridChangeApplier<TRowData>;
	commandHistory: CommandHistory;
	requestRender: (reason: string) => void;
}
```

- `GridChangeApplier` exists, but its `reason` is still a free-form string and
  some features bypass it:

```ts
// packages/core/src/engine/GridChangeApplier.ts:7
export interface GridChange<TRowData = unknown> {
	reason: string;
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

- `GroupingFeatureController` mixes the new change applier with direct
  state/render/event calls:

```ts
// packages/core/src/features/GroupingFeatureController.ts:86
public setShowGroupFooter(enabled: boolean): void {
	this.ctx.stateManager.setState({ showGroupFooter: enabled });
	this.ctx.invalidation.invalidateGeometry('showGroupFooter');
	this.ctx.invalidation.invalidateViewport('showGroupFooter');
	this.ctx.invalidation.invalidateOverlay('showGroupFooter');
	this.ctx.requestRender('showGroupFooter');
}

// packages/core/src/features/GroupingFeatureController.ts:100
public setShowGroupPanel(enabled: boolean): void {
	this.ctx.stateManager.setState({ showGroupPanel: enabled });
	this.ctx.requestRender('showGroupPanel');
}
```

- `RowSelectionFeatureController` is still a direct side-effect owner:

```ts
// packages/core/src/features/RowSelectionFeatureController.ts:92
public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
	const result = this.reduceRowSelection(gesture);
	if (!result) return null;

	this.ctx.stateManager.setState({ selectedRowIds: result.selectedRowIds });
	for (const rowId of result.changedRowIds) {
		this.ctx.invalidation.invalidateRow(rowId, 'selection');
	}
	this.ctx.invalidation.invalidateHeaders('selection');
	this.ctx.eventBus.dispatchEvent(GridEventName.rowSelectionChanged, result);
	this.ctx.requestRender('selection');
	return result;
}
```

- `GridEngine` still owns subscription batching and notifications:

```ts
// packages/core/src/engine/GridEngine.ts:451
public scheduleBatchFlush(): void {
	if (!this.batchFlushScheduled) {
		this.batchFlushScheduled = true;
		defaultGridScheduler.microtask(() => this.flushCellUpdates());
	}
}

// packages/core/src/engine/GridEngine.ts:484
public notifyBulkCellChange(changes: Map<string, Set<string>>): void {
	for (const rowId of changes.keys()) {
		this.rowVersions.set(rowId, (this.rowVersions.get(rowId) ?? 0) + 1);
	}
	// clears caches, notifies subscriptions, invalidates cells/rows, requests render
}
```

- `GridEngine` still owns the state-change reactor and event propagation:

```ts
// packages/core/src/engine/GridEngine.ts:688
private handleStateChanges = (prevState: GridState<TRowData>, updatedKeys: string[]): void => {
	let currState = this.stateManager.getState();
	const updatedSet = new Set(updatedKeys);
	// synchronizes models, derives selection bounds, updates visible ranges,
	// notifies cells, invalidates overlays, emits state-derived events
};
```

- `packages/react/src/chart/GridChartOverlay.tsx` still crosses into
  `@eregister/open-grid-core/internal`:

```ts
// packages/react/src/chart/GridChartOverlay.tsx:5
import { getStoreFromApi } from '@eregister/open-grid-core/internal';

// packages/react/src/chart/GridChartOverlay.tsx:90
const internalApi = getStoreFromApi(api);
```

## Commands you will need

| Purpose         | Command                                                   | Expected on success                             |
| --------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Core build      | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0                                          |
| Core tests      | `corepack pnpm --filter @eregister/open-grid-core test`   | 40 files passed, 467+ tests passed, no failures |
| React build     | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0                                          |
| React tests     | `corepack pnpm --filter @eregister/open-grid-react test`  | 4 files passed, 101+ tests passed, no failures  |
| Demo build      | `corepack pnpm --filter demo-app build`                   | exit 0; chunk-size warning is acceptable        |
| Full repo check | `corepack pnpm run build && corepack pnpm run test`       | exit 0                                          |

Run package builds sequentially before `demo-app build`. Parallel demo builds
can race workspace package `dist` output and produce a false module-resolution
failure.

## Scope

**In scope**:

- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- New files under `packages/core/src/engine/` or `packages/core/src/features/`
  that extract engine-owned responsibilities.
- `packages/core/src/features/GridFeatureContext.ts`
- `packages/core/src/features/*FeatureController.ts`
- `packages/core/src/features/*FeatureController.test.ts`
- `packages/core/src/store.ts` only for narrow forwarding changes caused by the
  new engine surface.
- `packages/core/src/viewportController.ts` only if viewport state mutation is
  moved behind the same effect boundary.
- `packages/react/src/chart/GridChartOverlay.tsx` only for removing
  `getStoreFromApi`.

**Out of scope**:

- Renderer decomposition of `packages/core/src/renderer/rowRenderer.ts` and
  `packages/core/src/renderer/renderEngine.ts`. Those are still large, but
  they need their own rendering-specific plan.
- New grid features, public API expansion, styling changes, or demo UX changes.
- Rewriting the row model, formula solver, or data mutation kernel from Plan 012.

## Git workflow

- Branch: `codex/013-thin-engine-effects-boundary`
- Commit style: match recent history, e.g. `fix: harden data mutation pipeline (Plan 012)`.
- Keep commits logical: one commit for extraction/typing, one for migration,
  one for guard/tests if that makes review easier.
- Do not push unless explicitly instructed.

## Steps

### Step 1: Lock the 012 baseline before moving code

Run the verification commands below before editing. If any fail, stop and
report. This plan assumes Plan 012 is green.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core test` -> all tests pass except the
  known skipped architecture guard.
- `corepack pnpm --filter @eregister/open-grid-react build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-react test` -> exit 0.
- `corepack pnpm --filter demo-app build` -> exit 0.

### Step 2: Make `GridChange` reasons typed, not free-form strings

Create a typed reason surface for effectful changes. A good shape is:

```ts
export type GridChangeReason =
	| 'columns:resize'
	| 'columns:move'
	| 'columns:set'
	| 'grouping:set-group-by'
	| 'grouping:set-agg-defs'
	| 'grouping:set-footer'
	| 'grouping:set-sticky-rows'
	| 'grouping:set-panel'
	| 'selection:rows'
	| 'selection:cells'
	| 'editing:start'
	| 'editing:stop'
	| 'editing:validation'
	| 'layout:row-height'
	| 'layout:overscan'
	| 'layout:col-buffer'
	| 'data:set'
	| 'row-model:register'
	| 'style:set-slots'
	| 'sort:set-model'
	| 'filter:set-model';
```

Use the exact union members only if they match the final migrated call sites;
do not leave a broad `string` escape hatch. Update `GridInvalidation.reason`
inputs only where type compatibility requires it. Avoid a broad repo-wide
rename if a local typed alias is enough.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 3: Narrow `GridFeatureContext` to an effect port

Replace the raw `stateManager`, `invalidation`, `eventBus`, `commandHistory`,
and `requestRender` exposure with a smaller feature-facing port. The preferred
shape is:

```ts
export interface GridFeatureContext<TRowData = unknown> {
	columns: ColumnModel<TRowData>;
	applyChange: (change: GridChange<TRowData>) => void;
	getState: () => GridState<TRowData>;
}
```

If a controller needs a specialized service, pass it as a narrow constructor
dependency instead of widening the shared context. For example, row selection
may need `getRowModel`, and editing may need `data` plus a cell mutation
function.

Do not keep both `changeApplier` and raw primitives on the context. The point
is to make bypassing the effect boundary harder than using it.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 4: Finish migrating feature controllers to the effect boundary

Migrate these methods to `applyChange`:

- `GroupingFeatureController.setShowGroupFooter`
- `GroupingFeatureController.setStickyGroupRows`
- `GroupingFeatureController.setShowGroupPanel`
- `RowSelectionFeatureController.applyRowSelectionGesture`
- `EditingFeatureController.startEdit`
- `EditingFeatureController.stopEdit`
- `EditingFeatureController` validation-error state updates

Keep controller reducers pure where possible. For example,
`RowSelectionFeatureController.reduceRowSelection` should remain the place that
computes the selected-row delta, while `applyRowSelectionGesture` should submit
a single `GridChange` containing:

- state patch,
- invalidations,
- events,
- render request.

Add architecture guard tests that fail if any feature controller contains:

- `this.ctx.stateManager.setState`
- `this.ctx.invalidation.`
- `this.ctx.eventBus.dispatchEvent`
- `this.ctx.requestRender(`
- `this.ctx.commandHistory`

Allow `GridChangeApplier.ts`, tests, and the engine composition root to use raw
primitives.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core test` -> all tests pass.

### Step 5: Extract subscription batching from `GridEngine`

Move these responsibilities out of `GridEngine.ts` into a focused class, for
example `CellSubscriptionController` or `CellNotificationController`:

- `cellSubscriptions`
- `colSubscriptions`
- `cellUpdateBatch`
- `batchFlushScheduled`
- `_batchedUpdates`
- `registerCellSubscription`
- `unregisterCellSubscription`
- `updateCellSubscription`
- `enqueueCellUpdate`
- `scheduleBatchFlush`
- `flushCellUpdates`
- `flushCellUpdatesSync`
- `notifyBulkCellChange`
- `notifyCellChange`
- row-version bumps associated with cell notifications

The extracted controller may depend on:

- `DataModel`
- `EventBus`
- `InvalidationManager`
- `defaultGridScheduler` or a scheduler dependency
- `requestRender`
- the shared `rowVersions` map

Keep the public `GridEngine` methods as thin forwarders if existing callers
need them. The important outcome is that the logic and state no longer live in
`GridEngine.ts`.

Add focused tests for the new controller by extracting expectations from
existing store/batching tests where useful. Do not duplicate the whole store
suite.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core test -- src/store.test.ts` -> related
  store batching tests pass.
- `corepack pnpm --filter @eregister/open-grid-core test` -> all tests pass.

### Step 6: Extract the state-change reaction bridge from `GridEngine`

Move `handleStateChanges` into a focused class or factory, for example
`GridStateReactionController`. It should own the policy that maps state keys to:

- sub-model synchronization,
- geometry and row-model version bumps,
- derived selection bounds,
- visible-range derived state,
- cell subscription notifications,
- invalidations,
- state-derived events.

`GridEngine` should pass dependencies into this controller and install its
callback when constructing `StateManager`. Because `StateManager` is currently
constructed before some models are linked, use either:

- a callback factory that closes over dependency getters, or
- a controller instance created before `StateManager` with a later `attach`
  call.

Keep behavior equivalent. This is an extraction, not a rewrite.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core test -- src/engine` -> engine tests pass.
- `corepack pnpm --filter @eregister/open-grid-core test` -> all tests pass.

### Step 7: Move remaining non-kernel feature mutations out of `GridEngine`

After Steps 5 and 6, reduce remaining direct feature mutation methods in
`GridEngine` to forwarders or move them into small controllers:

- `setRowOverscanPx`
- `setColBuffer`
- `setStyleSlots`
- `setSortModel`
- `setFilterModel`
- `resizeRow` / `applyRowHeight`
- `selectRange` / `applySelectionRange`
- `registerRowModel`

Do not create a broad "misc controller". Prefer domain names:

- `GridLayoutFeatureController` for row heights, overscan, column buffer, and
  viewport-affecting layout state.
- `SortFilterFeatureController` for sort and filter state.
- `CellSelectionFeatureController` for cell range selection if row selection is
  already separate.
- `RowModelRegistrationController` only if register-row-model remains bulky
  after the state reaction extraction.

Every moved mutation should use the same typed `GridChange` pathway unless it
is truly model-registration bootstrapping. If an exception is needed, add it to
the architecture guard allowlist with a comment explaining why.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core test` -> all tests pass.

### Step 8: Close the remaining React internal-api chart seam

Remove the `getStoreFromApi` import from `GridChartOverlay.tsx`. Prefer public
API methods already available:

- `api.getState().columns`
- `api.getVisualRow(index)` if public and sufficient
- `api.getDataRowAtVisualIndex(index)`
- `api.getCellValue(rowId, field)`

If the chart needs a read-only method that does not exist publicly, add a
minimal public or adapter-level read method rather than importing
`@eregister/open-grid-core/internal` from React.

Add or extend an architecture guard so no React source file imports
`@eregister/open-grid-core/internal`, unless there is an explicitly documented exception.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-react build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-react test` -> all tests pass.

### Step 9: Make the architecture guardrails active

Update `architectureGuards.test.ts` so:

- the skipped `< 800` `GridEngine.ts` test is active,
- the intermediate `< 1000` guard is removed or kept only as a comment-free
  weaker duplicate if the stronger guard remains active,
- `GridFeatureContext.ts` no longer contains raw side-effect fields,
- feature controllers do not use raw `ctx` effect primitives,
- React source does not import `@eregister/open-grid-core/internal`,
- `GridChange.reason` is not typed as `string`.

Also add a guard for source size if useful:

- `GridEngine.ts < 800`
- `store.ts < 900`

Do not add brittle guards that fail on comments or test fixtures unless the
allowlist is explicit and narrow.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts --reporter=verbose` -> all guard tests pass, zero skipped tests in that file.
- `corepack pnpm --filter @eregister/open-grid-core test` -> all tests pass.

### Step 10: Run full sequential verification

Run all commands in this order:

1. `corepack pnpm --filter @eregister/open-grid-core build`
2. `corepack pnpm --filter @eregister/open-grid-react build`
3. `corepack pnpm --filter @eregister/open-grid-core test`
4. `corepack pnpm --filter @eregister/open-grid-react test`
5. `corepack pnpm --filter demo-app build`
6. `corepack pnpm run build`
7. `corepack pnpm run test`

Expected: all exit 0. The demo chunk-size warning is acceptable.

## Test plan

- Extend `packages/core/src/engine/architectureGuards.test.ts` with the new
  enforceable boundary checks.
- Add focused tests for any extracted `CellSubscriptionController` or equivalent
  using the existing batching expectations in `packages/core/src/store.test.ts`
  as behavioral reference.
- Add or update feature controller tests for grouping, editing, and row
  selection so each confirms the emitted `GridChange` outcome indirectly:
  resulting state, emitted event, invalidation, and render request.
- Add a React architecture guard or unit test that prevents
  `@eregister/open-grid-core/internal` imports from React source.

## Done criteria

All must be true:

- [ ] `GridEngine.ts` is below 800 lines.
- [ ] `architectureGuards.test.ts` has no skipped tests.
- [ ] `GridChange.reason` is typed by a closed union, not `string`.
- [ ] `GridFeatureContext` does not expose `stateManager`, `invalidation`,
      `eventBus`, `commandHistory`, or `requestRender`.
- [ ] Feature controllers do not call raw context side-effect primitives.
- [ ] Subscription batching logic is extracted from `GridEngine.ts`.
- [ ] State-change reaction logic is extracted from `GridEngine.ts`.
- [ ] React source does not import `@eregister/open-grid-core/internal`.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `corepack pnpm run build` exits 0.
- [ ] `corepack pnpm run test` exits 0.
- [ ] `plans/README.md` marks this plan `DONE` after implementation.

## STOP conditions

Stop and report if:

- The Plan 012 baseline is not green before editing.
- `DataMutationController` needs behavioral changes to complete this plan. That
  would mean Plan 012 drifted and should be reviewed separately.
- The `GridEngine.ts < 800` target requires moving renderer code or row-model
  algorithms; those are explicitly out of scope.
- Closing `GridChartOverlay`'s internal import requires a broad public API
  redesign. In that case, leave the import in place and propose a separate
  public read-model plan.
- A guard becomes noisy enough that it needs a broad allowlist. Prefer a smaller
  guard over a broad allowlist.

## Maintenance notes

- After this lands, new features should generally add a reducer/calculator plus
  one typed `GridChange`, not direct state/event/render plumbing.
- Reviewers should scrutinize any new dependency passed into
  `GridFeatureContext`; broad shared context is how this architecture regresses.
- The rendering files are still large. Do not treat this plan as the final
  rendering hardening pass; it only removes core engine gravity and closes
  side-effect seams.
- Keep the guardrails boring and explicit. The goal is to make architectural
  drift visible in CI before the next feature wave.
