# Plan 016: Decompose GridStore and split internal runtime contracts before renderer refactors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6b3ecc5..HEAD -- packages/core/src/store.ts packages/core/src/api/GridApi.ts packages/core/src/navigation.ts packages/core/src/contextMenu.ts packages/core/src/gridPlugins.ts packages/core/src/createGrid.ts packages/core/src/engine packages/core/src/boundary.test.ts packages/core/src/engine/architectureGuards.test.ts packages/core/src/store.test.ts packages/core/src/contextMenu.test.ts packages/react/src/OpenGrid.tsx packages/react/src/GridPortal.tsx`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/015-internal-adapter-boundary.md`
- **Category**: tech-debt
- **Planned at**: commit `6b3ecc5`, 2026-06-12

## Why this matters

Plans 012-015 hardened mutation ownership, engine effects, runtime ports, and
the adapter boundary. The next weak spot is `GridStore` itself. It still acts
as a giant mixed facade over public API methods, viewport control, plugin
lifecycle, persistence fallbacks, row-model wiring, and renderer-facing runtime
access. At the same time, `InternalGridApi` still exposes a broad union of
plugin, renderer, store, and host capabilities.

That shape is survivable while core is still small, but it is exactly what
causes renderer refactors to sprawl. If plugins, renderers, tests, and store
facades all depend on the same oversized internal surface, every internal
change becomes a cross-cutting rewrite. Before touching the rendering pipeline,
the core runtime needs clear audience-specific contracts and a `GridStore` that
reads like a facade, not like the second implementation center.

After this plan, the core should have:

- a materially smaller `GridStore`,
- split internal runtime interfaces for plugins versus renderers/host code,
- no plugin downcasts from `InternalGridApi` to `GridStore`,
- stronger guardrails so these boundaries do not drift back.

## Current state

- `packages/core/src/store.ts` is still a large mixed facade that directly owns
  engine access, viewport control, and plugin registration:

```ts
// packages/core/src/store.ts:87
export class GridStore<TRowData = unknown> implements InternalGridApi<TRowData> {
	public engine: GridEngine<TRowData>;

// packages/core/src/store.ts:90
private readonly viewportController: ViewportController<TRowData>;
private plugins = new Map<string, GridPlugin<TRowData>>();

// packages/core/src/store.ts:159
public getState = (): GridState<TRowData> => this.engine.getState();

// packages/core/src/store.ts:161
public setState = (updater: GridStateUpdater<TRowData>): void => this.engine.setState(updater);

// packages/core/src/store.ts:651
public setViewportPins = (pins: { left?: number; right?: number; top?: number; bottom?: number }): void => {

// packages/core/src/store.ts:818
public registerPlugin = (plugin: GridPlugin<TRowData>): void => {
```

- `store.ts` still holds UI state and transaction orchestration that are not
  part of a minimal public facade:

```ts
// packages/core/src/store.ts:179
public setRowOverscanPx = (px: number): void => {
	this.setState({ rowOverscanPx: px });
};

// packages/core/src/store.ts:381
public openPanel = (panelId: string): void => {
	this.setState({ sidebarOpenPanel: panelId });
};

// packages/core/src/store.ts:587
public transaction = (transaction: GridTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
	let rowResult: RowNodeTransaction<TRowData> | null = null;
	this.engine.batch(() => {
```

- `packages/core/src/api/GridApi.ts` defines `GridPlugin` in terms of the
  oversized `InternalGridApi`, and `InternalGridApi` still mixes plugin hooks,
  renderer reads, fine-grained subscriptions, and store mutation knobs:

```ts
// packages/core/src/api/GridApi.ts:87
export interface GridPlugin<TRowData = unknown> {
	readonly name: string;
	onInit?(api: InternalGridApi<TRowData>): void;
}

// packages/core/src/api/GridApi.ts:397
export interface InternalGridApi<TRowData = unknown> extends GridApi<TRowData> {
	getRenderStats(): RenderStats;
	subscribeToViewport(listener: Listener<TRowData>): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	setState(updater: GridStateUpdater<TRowData>): void;
	registerPlugin(plugin: GridPlugin<TRowData>): void;
	setViewportPins(pins: { left?: number; right?: number; top?: number; bottom?: number }): void;
}
```

- Plugins still downcast the provided API back to `GridStore`, which means the
  interface boundary is not real yet:

```ts
// packages/core/src/navigation.ts:1
import { GridStore, GridEventName, GridCellPointer, GridPlugin, InternalGridApi } from './store.js';

// packages/core/src/navigation.ts:11
private store!: GridStore<TRowData>;

// packages/core/src/navigation.ts:21
public onInit(api: InternalGridApi<TRowData>): void {
	this.store = api as GridStore<TRowData>;
}
```

```ts
// packages/core/src/contextMenu.ts:1
import { GridStore, GridCellPointer, GridPlugin, GridApi, InternalGridApi, GridSelectionState } from './store.js';

// packages/core/src/contextMenu.ts:32
private store!: GridStore<TRowData>;

// packages/core/src/contextMenu.ts:45
public onInit(api: InternalGridApi<TRowData>): void {
	this.store = api as GridStore<TRowData>;
}
```

- The public plugin registration helpers also reach straight through to the
  store and store-owned plugin registry:

```ts
// packages/core/src/gridPlugins.ts:23
const internalApi = getStoreFromApi(api);
const controller = new GridNavigationController<TRowData>(options);
internalApi.registerPlugin(controller);

// packages/core/src/gridPlugins.ts:45
const internalApi = getStoreFromApi(api);
const plugin = new GridContextMenuPlugin<TRowData>(options);
internalApi.registerPlugin(plugin);
```

- Existing repo conventions to preserve:
    - Runtime ports live in `packages/core/src/engine/runtimePorts.ts`.
    - Structural regressions are guarded in
      `packages/core/src/engine/architectureGuards.test.ts`.
    - Public/internal surface regressions are checked in
      `packages/core/src/boundary.test.ts`.
    - Recent core hardening favors narrow constructor/runtime ports instead of
      concrete cross-object reach-through. Follow the style introduced in
      `packages/core/src/features/DataMutationController.ts` and
      `packages/core/src/engine/GridStateReactionController.ts`.
    - Plan 015 already narrowed `@eregister/open-grid-core/internal` to an adapter-facing
      host contract. This plan should preserve that sealed adapter boundary.

## Commands you will need

| Purpose                      | Command                                                                                                                                                                 | Expected on success  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Core build                   | `corepack pnpm --filter @eregister/open-grid-core build`                                                                                                                | exit 0               |
| Core full tests              | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                 | all core tests pass  |
| Focused core runtime tests   | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/contextMenu.test.ts src/boundary.test.ts src/engine/architectureGuards.test.ts` | exit 0               |
| Focused effect/runtime tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/GridChangeApplier.test.ts src/engine/gridFeatureEffects.test.ts`                           | exit 0               |
| React build                  | `corepack pnpm --filter @eregister/open-grid-react build`                                                                                                               | exit 0               |
| React tests                  | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                                                | all React tests pass |
| Demo build                   | `corepack pnpm --filter demo-app build`                                                                                                                                 | exit 0               |

Run package builds sequentially. Run the demo build only after core and React
build/test commands pass.

## Scope

**In scope**:

- `packages/core/src/store.ts`
- `packages/core/src/api/GridApi.ts`
- `packages/core/src/navigation.ts`
- `packages/core/src/contextMenu.ts`
- `packages/core/src/gridPlugins.ts`
- `packages/core/src/createGrid.ts` only if runtime wiring or helper narrowing
  requires it
- `packages/core/src/engine/runtimePorts.ts` or a nearby internal runtime-types
  file if new internal interfaces need a shared home
- `packages/core/src/engine/*.ts` only for composition-root wiring and narrow
  delegators
- `packages/core/src/boundary.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/contextMenu.test.ts`
- `packages/core/src/engine/GridChangeApplier.test.ts`
- `packages/core/src/engine/gridFeatureEffects.test.ts`
- `packages/core/src/gridHost.ts` only if a split runtime contract needs a thin
  adaptation there

**Out of scope**:

- No renderer decomposition of `renderEngine.ts`, `rowRenderer.ts`,
  `renderWindow.ts`, or renderer slot classes.
- No public `@eregister/open-grid-core` application API redesign.
- No new grid features.
- No formula language changes.
- No persistence feature expansion beyond moving existing no-op/default wiring
  behind a cleaner facade.
- Do not widen `@eregister/open-grid-core/internal` again. Plan 015's sealed adapter
  surface must survive this refactor.

## Git workflow

- Branch: `codex/016-store-runtime-decomposition`
- Commit style: match recent plan-scoped architecture work, for example
  `015-internal-adapter-boundary.md` or `fix: harden data mutation pipeline`.
- Keep commits logical: one for runtime interface split, one for plugin/store
  migration, one for guards/tests if reviewability benefits.
- Do not push unless explicitly instructed.

## Steps

### Step 1: Lock the baseline after Plan 015

Before editing, confirm the current post-015 baseline is green. This plan
assumes:

- the adapter boundary is already sealed,
- `GridEngine.ts` is below the active `< 800` guard,
- `store.ts` still sits near the temporary `< 900` guard,
- core and React builds/tests currently pass.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/boundary.test.ts src/engine/architectureGuards.test.ts --reporter=verbose` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Split `InternalGridApi` into audience-specific runtime contracts

Refactor `packages/core/src/api/GridApi.ts` so plugins no longer receive the
same oversized interface that renderers and host adapters use.

Introduce explicit internal contracts for at least these audiences:

- **Plugin runtime**:
  enough for navigation/context-menu lifecycle, selection, editing, visual row
  reads, event subscription, and plugin-specific operations.
- **Renderer runtime**:
  fine-grained subscriptions, render diagnostics, display-value access, and
  visual-row access needed by the render pipeline.
- **Host/runtime mutation surface**:
  viewport size, viewport pins, visible range updates, and other host-driven
  integration calls.

The names can differ, but do not leave a single god-interface that still mixes
all three audiences.

Requirements:

- `GridPlugin.onInit` must accept the new plugin-specific runtime contract, not
  `InternalGridApi`.
- Keep `GridApi` public surface unchanged.
- Avoid circular type imports while splitting these contracts.
- Update comments/docstrings so they no longer reference the old
  `getInternalApiFromApi` wording or the pre-015 internal entrypoint.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/boundary.test.ts src/engine/architectureGuards.test.ts` -> exit 0.

### Step 3: Extract plugin runtime ownership out of the mixed store surface

Move plugin registry behavior and plugin-facing lifecycle plumbing out of the
current raw `GridStore` grab-bag shape.

Target outcome:

- `GridStore` no longer directly owns an unstructured `plugins` map plus all
  register/unregister/destroy behavior inline.
- Plugin lifecycle lives behind a dedicated runtime/registry helper or narrow
  store-owned collaborator.
- `gridPlugins.ts` registers plugins through a dedicated plugin runtime surface,
  not through a wide store facade that also exposes unrelated renderer/store
  methods.

It is acceptable for `GridStore` to compose a plugin registry object. It is not
acceptable to just move the same broad methods into another god-object without
shrinking what plugin code can see.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/contextMenu.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 4: Remove `GridStore` downcasts from plugins

Refactor `packages/core/src/navigation.ts` and `packages/core/src/contextMenu.ts`
so they no longer store `GridStore` and no longer cast `api as GridStore`.

Target shape:

- plugins depend on a new `GridPluginRuntime`-style interface,
- all methods they call are explicit on that runtime,
- plugin code has no knowledge of the concrete store class.

Be strict here. A plugin runtime is allowed to include:

- state reads,
- visual row reads,
- selection/editing commands,
- event subscriptions,
- export helpers only if the context-menu plugin genuinely needs them.

A plugin runtime is not allowed to become a renamed `GridStore`.

If context-menu export behavior needs a dedicated helper rather than a raw store
reference, add one. If navigation needs selection/editing/visual-row utilities,
add those explicitly to the plugin runtime rather than reintroducing concrete
coupling.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/contextMenu.test.ts src/store.test.ts` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 5: Thin `GridStore` into coherent public/internal facades

After the runtime split, reduce `GridStore`'s direct inline ownership over
unrelated areas.

Focus on these seams:

- state facade methods such as `getState`, `setState`, panel/chart state, and
  overscan/runtime-limit setters,
- viewport host methods such as `setViewportPins`, `setViewportSize`, and
  `updateVisibleRanges`,
- plugin/runtime registration,
- transaction orchestration,
- renderer-facing subscription helpers.

Do not chase line count blindly, but do push `store.ts` below the aspirational
`< 850` target if it can be done without smuggling responsibility into random
files.

A good result looks like:

- `GridStore` remains the public facade implementation,
- but delegations are grouped around coherent collaborators instead of a single
  891-line mixed surface.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/store.test.ts src/engine/GridChangeApplier.test.ts src/engine/gridFeatureEffects.test.ts` -> exit 0.

### Step 6: Strengthen guardrails around store/runtime boundaries

Extend `packages/core/src/engine/architectureGuards.test.ts` with active
guards that make these boundaries hard to regress.

Add checks such as:

- `store.ts` is below `850` lines; if this cannot be reached honestly, use a
  visible intermediate guard and record the follow-up in `plans/README.md`.
- `navigation.ts` does not reference `GridStore`.
- `contextMenu.ts` does not reference `GridStore`.
- neither file contains `api as GridStore`.
- `GridPlugin` does not accept `InternalGridApi` anymore.
- `InternalGridApi` no longer includes plugin registration and unrelated
  audience methods if those have been split into narrower contracts.

Also update `boundary.test.ts` if any runtime-surface assumptions changed as a
result of moving plugin or host responsibilities.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts src/boundary.test.ts --reporter=verbose` -> exit 0.

### Step 7: Run full sequential verification

Run these commands in order:

1. `corepack pnpm --filter @eregister/open-grid-core build`
2. `corepack pnpm --filter @eregister/open-grid-react build`
3. `corepack pnpm --filter @eregister/open-grid-core test`
4. `corepack pnpm --filter @eregister/open-grid-react test`
5. `corepack pnpm --filter demo-app build`

Expected: all exit 0.

## Test plan

- Extend `packages/core/src/engine/architectureGuards.test.ts` with store/plugin
  boundary assertions.
- Update `packages/core/src/boundary.test.ts` only if the new runtime contracts
  alter which symbols are intentionally exposed or hidden.
- Preserve and rerun:
    - `packages/core/src/store.test.ts`
    - `packages/core/src/contextMenu.test.ts`
    - `packages/core/src/engine/GridChangeApplier.test.ts`
    - `packages/core/src/engine/gridFeatureEffects.test.ts`
- Add focused tests only where observable behavior changes:
    - plugin registration/disposal lifecycle through the new runtime surface,
    - context-menu export/copy/paste behavior if export helpers move behind a
      new contract,
    - navigation behavior if plugin-runtime selection/editing hooks are
      rethreaded.
- Use existing dependency-injected controller tests as the structural pattern.
  Do not create new tests that lock the implementation back to `GridStore`.

## Done criteria

All must hold:

- [ ] `GridPlugin.onInit` no longer depends on a god-interface that mixes
      renderer, host, store, and plugin concerns.
- [ ] `navigation.ts` and `contextMenu.ts` do not reference `GridStore` and do
      not cast `api as GridStore`.
- [ ] Plugin registration/lifecycle is owned by a dedicated runtime or registry
      collaborator rather than raw mixed inline store logic.
- [ ] `GridStore` is materially thinner and no longer serves as the main
      internal nexus for unrelated runtime responsibilities.
- [ ] `store.ts` is below `850` lines, or `plans/README.md` explicitly records
      the intermediate guard and why.
- [ ] `@eregister/open-grid-core/internal` remains sealed; this plan must not widen the
      adapter-facing internal entrypoint.
- [ ] Architecture guards enforce the new store/plugin/runtime boundaries.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `plans/README.md` status for Plan 016 is updated.

## STOP conditions

Stop and report back if:

- Splitting `InternalGridApi` would require widening the public `GridApi`
  surface.
- A proposed plugin runtime contract starts accreting renderer-only or
  host-only concerns and effectively recreates `InternalGridApi` under a new
  name.
- Removing `GridStore` downcasts from plugins requires changing user-facing
  navigation or context-menu semantics rather than just runtime wiring.
- Hitting the `store.ts < 850` target would require unrelated renderer work or
  arbitrary file shuffling with no real ownership improvement.
- Any step appears to require reopening the sealed `@eregister/open-grid-core/internal`
  barrel from Plan 015.

## Maintenance notes

- Reviewers should scrutinize any new interface added in `GridApi.ts` or a
  runtime-ports file: if it serves more than one audience, it is probably too
  wide.
- Future plugin work should extend a plugin-specific runtime contract, not rely
  on `GridStore` or renderer-facing methods leaking through a shared internal
  surface.
- This plan intentionally stops before renderer decomposition. The next plans
  after this should target runtime policy normalization, diagnostics/failure
  hardening, and then the rendering pipeline itself against a much quieter core.
