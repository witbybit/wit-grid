# Plan 017: Remove concrete GridStore coupling from client and server row models

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat eecb571..HEAD -- packages/core/src/rowModel.ts packages/core/src/serverRowModel.ts packages/core/src/store.ts packages/core/src/createGrid.ts packages/core/src/engine/runtimePorts.ts packages/core/src/store.test.ts packages/core/src/rowModel.test.ts packages/core/src/serverRowModel.test.ts packages/core/src/engine/architectureGuards.test.ts`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/016-store-runtime-decomposition.md`
- **Category**: tech-debt
- **Planned at**: commit `eecb571`, 2026-06-12

## Why this matters

Plans 014-016 broke the largest engine/store cycles, narrowed the adapter
boundary, and split plugin runtime contracts away from `GridStore`. The next
core seam still lagging behind that direction is the row-model layer itself.
Both `ClientRowModelController` and `ServerRowModelController` still keep a
concrete `GridStore` field and reach through it for state mutation, event
subscription, column reads, row-model registration, and server-load lifecycle.

That means the visual-row producers sitting directly under the renderer still
depend on the same broad facade we are trying to quiet. Before touching
`renderEngine.ts`, `rowRenderer.ts`, or render-window policy, the row models
need the same treatment the plugins just got: narrow runtime contracts, a real
composition root, and no knowledge of the concrete store class.

After this plan, the row-model layer should:

- depend on explicit row-model runtime ports instead of `GridStore`,
- stop owning store subscription/state/event wiring inline,
- preserve current visual-row, grouping, transaction, and server-loading
  behavior,
- make future renderer refactors depend on stable row-model contracts instead of
  store implementation details.

## Current state

- `packages/core/src/rowModel.ts` still stores the concrete store and mutates
  store state directly for grouping/detail expansion:

```ts
// packages/core/src/rowModel.ts:343
export class ClientRowModelController<TData = unknown> implements RowModel<TData> {
	private store: GridStore<TData>;

// packages/core/src/rowModel.ts:375
	this.store.setState({ expansion: { ...expansion, groups } });

// packages/core/src/rowModel.ts:430
	constructor(store: GridStore<TData>, options: ClientRowModelOptions<TData>) {
		this.store = store;
		this.runtime = store.getRowModelMutationRuntime();
```

- The same file still uses the store as an event bus and registration owner:

```ts
// packages/core/src/rowModel.ts:440
this.store.registerRowModel(this);

// packages/core/src/rowModel.ts:443
this.store.addEventListener(GridEventName.sortChanged, () => this.refresh());
this.store.addEventListener(GridEventName.filterChanged, () => this.refresh());
this.store.addEventListener(GridEventName.groupByChanged, () => this.refresh());
```

- `packages/core/src/serverRowModel.ts` has the same concrete-store shape, plus
  ad hoc server-load lifecycle writes:

```ts
// packages/core/src/serverRowModel.ts:33
export class ServerRowModelController<TData = unknown> implements RowModel<TData> {
	private store: GridStore<TData>;

// packages/core/src/serverRowModel.ts:49
	constructor(store: GridStore<TData>, options: ServerRowModelOptions<TData>) {
		this.store = store;
		this.runtime = store.getServerRowModelRuntime();
```

```ts
// packages/core/src/serverRowModel.ts:228
	this.store.setState((s) => ({
		loading: true,
		globalVersion: s.globalVersion + 1,
	}));

// packages/core/src/serverRowModel.ts:314
	this.store.dispatchEvent(GridEventName.serverBlockLoaded, {
		blockIndex,
		loadedBlockStart: startRow,
		loadedBlockEnd: startRow + response.rows.length - 1,
```

- Server failures are still handled as local `console.error` plus state pokes,
  not through an explicit row-model runtime policy:

```ts
// packages/core/src/serverRowModel.ts:325
console.error(`GridEngine: Failed to fetch row block ${blockIndex}`, error);

// packages/core/src/serverRowModel.ts:329
this.store.setState({
	loading: hasActiveFetches,
	globalVersion: this.store.getState().globalVersion + 1,
});
```

- `packages/core/src/engine/runtimePorts.ts` currently exposes only partial
  row-model helpers, not a full row-model runtime contract:

```ts
// packages/core/src/engine/runtimePorts.ts:45
export interface RowModelMutationRuntime<TRowData = unknown> {
	clearFormulas: () => void;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	notifyBulkCellChange: (changes: Map<string, Set<string>>) => void;
}

// packages/core/src/engine/runtimePorts.ts:55
export interface ServerRowModelRuntime {
	clearFormulas: () => void;
	isScrollingFast: () => boolean;
	getScrollVelocity: () => { vx: number; vy: number };
}
```

- `packages/core/src/createGrid.ts` still wires both row models by handing them
  the whole store:

```ts
// packages/core/src/createGrid.ts:277
const controller = new ClientRowModelController<TRowData>(store, { ...options, columns: resolvedColumns });

// packages/core/src/createGrid.ts:327
const controller = new ServerRowModelController<TRowData>(store, options);
```

- Existing repo conventions to preserve:
    - Shared internal runtime contracts live in
      `packages/core/src/engine/runtimePorts.ts`.
    - Recent plans prefer narrow constructor/runtime ports over concrete
      cross-object ownership. Match the style introduced in
      `packages/core/src/models/DataModel.ts`,
      `packages/core/src/models/CellAccess.ts`, and
      `packages/core/src/plugins/GridPluginRegistry.ts`.
    - `packages/core/src/engine/architectureGuards.test.ts` is the right place
      for structural guardrails.
    - Plan 015 already sealed `@eregister/open-grid-core/internal`, and Plan 016 split
      plugin runtime away from `GridStore`. This plan must keep both intact.

## Commands you will need

| Purpose                       | Command                                                                                                                                                                    | Expected on success  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Core build                    | `corepack pnpm --filter @eregister/open-grid-core build`                                                                                                                   | exit 0               |
| Core full tests               | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                    | all core tests pass  |
| Focused row-model tests       | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/serverRowModel.test.ts src/store.test.ts src/engine/architectureGuards.test.ts` | exit 0               |
| Focused runtime/effects tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/GridChangeApplier.test.ts src/engine/gridFeatureEffects.test.ts`                              | exit 0               |
| React build                   | `corepack pnpm --filter @eregister/open-grid-react build`                                                                                                                  | exit 0               |
| React tests                   | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                                                   | all React tests pass |
| Demo build                    | `corepack pnpm --filter demo-app build`                                                                                                                                    | exit 0               |

Run builds/tests sequentially. Do not run `@eregister/open-grid-react` or `demo-app`
commands in parallel with a core build; those packages resolve core artifacts.

## Scope

**In scope**:

- `packages/core/src/rowModel.ts`
- `packages/core/src/serverRowModel.ts`
- `packages/core/src/engine/runtimePorts.ts`
- `packages/core/src/store.ts`
- `packages/core/src/createGrid.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/rowModel.test.ts`
- `packages/core/src/serverRowModel.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- `packages/core/src/engine/GridChangeApplier.test.ts`
- `packages/core/src/engine/gridFeatureEffects.test.ts`

**Out of scope**:

- No renderer decomposition in `packages/core/src/renderer/**`.
- No public `GridApi` redesign.
- No change to user-visible grouping, sorting, filtering, transaction, or
  server-loading semantics beyond internal wiring.
- No new retry/backoff/error-surface design for server fetch failures; if that
  becomes necessary, stop and spin it into the next plan.
- Do not reopen the sealed `@eregister/open-grid-core/internal` boundary from Plan 015.

## Git workflow

- Branch: `codex/017-row-model-runtime-boundary`
- Commit style: match recent architecture-hardening work such as
  `015-internal-adapter-boundary.md` or `fix: harden data mutation pipeline`.
- Keep commits reviewable: one for runtime contract extraction, one for
  row-model migration, one for guardrails/tests if that improves readability.
- Do not push unless explicitly instructed.

## Steps

### Step 1: Lock the post-016 baseline

Before editing, verify the current baseline assumed by this plan:

- plugin/runtime split from Plan 016 is green,
- `store.ts` is below the active `< 875` guard,
- row models still depend on `GridStore`,
- core and React verification commands pass.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts src/store.test.ts --reporter=verbose` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Define explicit row-model runtime contracts

Extend `packages/core/src/engine/runtimePorts.ts` with explicit runtime
contracts for the row-model audience.

Target shape:

- a shared base row-model runtime for state reads, event subscription,
  row-model registration, and store-owned reads such as `getRowId`,
  `getColumnDef`, and `getCellValue`,
- a client-row-model runtime that includes expansion/grouping state mutation and
  row-model refresh hooks,
- a server-row-model runtime that includes loading-state/event hooks in addition
  to scroll/formula helpers.

Requirements:

- Do not expose the whole store under a renamed interface.
- Keep the existing `RowModelMutationRuntime` helpers if still useful, but fold
  them under a cleaner row-model runtime story instead of leaving them as the
  only row-model-specific port.
- Avoid circular imports; this file is the intended home for cross-module
  runtime contracts.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 3: Migrate `ClientRowModelController` off `GridStore`

Refactor `packages/core/src/rowModel.ts` so `ClientRowModelController` no
longer stores `GridStore<TData>` and no longer receives a concrete store in its
constructor.

Target outcome:

- constructor takes a narrow client-row-model runtime plus the current options,
- grouping/detail expansion writes go through explicit runtime methods instead
  of `store.setState(...)`,
- sort/filter/group listeners come from runtime subscription helpers instead of
  `store.addEventListener(...)`,
- column and cell reads needed by `setCellValue` go through explicit runtime
  methods, not a concrete store field.

Keep the current observable behavior:

- grouping/detail expansion semantics,
- transaction behavior,
- `rowsUpdated` dispatch behavior,
- visual-row identity/diff behavior.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rowModel.test.ts src/store.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 4: Migrate `ServerRowModelController` off `GridStore`

Refactor `packages/core/src/serverRowModel.ts` so `ServerRowModelController`
also depends on a narrow server-row-model runtime rather than `GridStore`.

Target outcome:

- no `private store: GridStore<TData>`,
- constructor/runtime wiring owns loading/globalVersion/event updates via
  explicit runtime methods,
- server block lifecycle uses runtime hooks instead of raw `store.setState` and
  `store.dispatchEvent`,
- current predictive prefetch, purge, inline edit, and `serverBlockLoaded`
  behavior remains intact.

Do not redesign error UX in this plan. Keep failure semantics stable, but route
their state/event consequences through runtime methods instead of concrete store
reach-through.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/store.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 5: Move row-model composition into the factory/store boundary

Update `packages/core/src/store.ts` and `packages/core/src/createGrid.ts` so
the composition root builds row-model runtimes explicitly.

Target shape:

- `GridStore` owns narrow helpers like `getClientRowModelRuntime()` /
  `getServerRowModelRuntime()` or equivalent composition-root factories,
- `createClientGrid()` / `createServerGrid()` stop instantiating row models with
  the whole store object,
- row-model registration and lifecycle remain store-owned, but behind explicit
  runtime contracts.

It is acceptable for `GridStore` to compose these runtime objects the same way
Plan 016 introduced plugin runtime composition. It is not acceptable to re-hide
the whole store behind an `as unknown as ClientRowModelRuntime` cast that still
contains unrelated methods.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/rowModel.test.ts src/serverRowModel.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 6: Add guardrails for the row-model boundary

Extend `packages/core/src/engine/architectureGuards.test.ts` so this boundary
does not drift back.

Add checks such as:

- `rowModel.ts` does not reference `GridStore`,
- `serverRowModel.ts` does not reference `GridStore`,
- neither file contains `private store:` or constructors typed as
  `constructor(store: GridStore...)`,
- row-model runtime contracts exist in `engine/runtimePorts.ts`,
- factory wiring no longer instantiates row models with the whole store object.

If useful, add one intermediate size guard for `rowModel.ts` and/or
`serverRowModel.ts`, but only if the threshold reflects a real decomposition
goal rather than arbitrary churn.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts --reporter=verbose` -> exit 0.

### Step 7: Run full sequential verification

Run these commands in order:

1. `corepack pnpm --filter @eregister/open-grid-core build`
2. `corepack pnpm --filter @eregister/open-grid-react build`
3. `corepack pnpm --filter @eregister/open-grid-core test`
4. `corepack pnpm --filter @eregister/open-grid-react test`
5. `corepack pnpm --filter demo-app build`

Expected: all exit 0.

## Test plan

- Extend `packages/core/src/engine/architectureGuards.test.ts` with row-model
  boundary assertions.
- Preserve and rerun:
    - `packages/core/src/rowModel.test.ts`
    - `packages/core/src/serverRowModel.test.ts`
    - `packages/core/src/store.test.ts`
    - `packages/core/src/engine/GridChangeApplier.test.ts`
    - `packages/core/src/engine/gridFeatureEffects.test.ts`
- Add focused tests only where observable behavior or wiring changed:
    - row-model runtime subscription/refresh behavior,
    - server block lifecycle through runtime hooks,
    - grouping/detail expansion state updates through the narrowed runtime.
- Use existing dependency-injected subsystem tests as the structural pattern.
  Do not add tests that lock the implementation back to `GridStore`.

## Done criteria

All must hold:

- [ ] `ClientRowModelController` no longer stores or accepts `GridStore`.
- [ ] `ServerRowModelController` no longer stores or accepts `GridStore`.
- [ ] Row-model composition depends on explicit runtime contracts in
      `engine/runtimePorts.ts`.
- [ ] `createClientGrid()` and `createServerGrid()` no longer instantiate row
      models with the whole store object.
- [ ] Row-model behavior for grouping, detail expansion, transactions, and
      server block loading remains covered by passing tests.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `plans/README.md` status for Plan 017 is updated.

## STOP conditions

Stop and report back if:

- Removing `GridStore` from the row-model constructors would require widening
  the public `GridApi` surface.
- The new row-model runtime contracts start accreting renderer-only or
  plugin-only concerns and effectively recreate `GridStore` under a new name.
- Preserving current server-loading behavior requires designing a new public
  error/status API rather than just narrowing internal wiring.
- The work appears to require touching `packages/core/src/renderer/**`.
- Any step appears to require reopening the sealed `@eregister/open-grid-core/internal`
  barrel from Plan 015.

## Maintenance notes

- Reviewers should scrutinize any new row-model runtime interface the same way
  they now scrutinize plugin runtime interfaces: if it mixes multiple audiences,
  it is too wide.
- This plan should leave one major pre-renderer hardening step after it:
  normalize runtime fault/diagnostic policy so async/server/listener failures
  stop scattering `console.error` behavior across the core.
- Once both this plan and the follow-on fault-policy plan land, the codebase
  should be close enough to start renderer decomposition against a much quieter,
  more explicit core.
