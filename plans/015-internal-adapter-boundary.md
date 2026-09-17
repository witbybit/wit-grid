# Plan 015: Seal the internal adapter boundary before renderer refactors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 0f93724..HEAD -- packages/core/src/internal.ts packages/core/src/gridHost.ts packages/core/src/boundary.test.ts packages/core/src/engine/architectureGuards.test.ts packages/core/src/api/GridApi.ts packages/core/src/columnDef.ts packages/react/src/OpenGrid.tsx packages/react/src/GridPortal.tsx packages/core/package.json packages/react/package.json`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/014-runtime-port-inversion.md`
- **Category**: tech-debt
- **Planned at**: commit `0f93724`, 2026-06-12

## Why this matters

Plans 012-014 hardened the mutation kernel, engine effects boundary, and runtime
ports. The next architectural risk is that `@eregister/open-grid-core/internal` is still a
wide barrel that exports the store, engine, models, row models, viewport
controllers, renderer classes, and context-menu internals from one place.

That means the React adapter and future renderers can depend on almost any core
implementation detail. Before decomposing `renderEngine.ts`, `rowRenderer.ts`,
or other renderer files, the adapter boundary needs to become explicit:
framework adapters should import only a small host contract and the few types
required to mount custom content. Raw engine/model/store exports should no
longer be part of the adapter-facing entrypoint.

After this plan, `@eregister/open-grid-core/internal` should read like a deliberate
adapter SDK, not like a backstage pass to the whole core.

## Current state

- `packages/core/src/internal.ts` currently exports broad internal modules at
  the top of the file:

```ts
// packages/core/src/internal.ts:1
export * from './store.js';
export * from './navigation.js';
export * from './serverRowModel.js';
export * from './rowModel.js';
export * from './ids.js';
export * from './viewportGeometry.js';
export * from './viewportController.js';

// packages/core/src/internal.ts:9
export * from './engine/GridEngine.js';
export * from './engine/GridEngineConfig.js';
export * from './state/StateManager.js';
export * from './commands/CommandHistory.js';
export * from './events/EventBus.js';
```

- The same file also exports renderer internals and raw store lookup:

```ts
// packages/core/src/internal.ts:23
export * from './renderer/scrollEngine.js';
export * from './renderer/IGridRenderer.js';
export * from './renderer/renderEngine.js';

// packages/core/src/internal.ts:36
export { CellRenderer } from './renderer/cellRenderer.js';
export { FullWidthRowRenderer } from './renderer/fullWidthRowRenderer.js';
export { GroupPanelRenderer } from './renderer/groupPanelRenderer.js';
export { HeaderRenderer } from './renderer/headerRenderer.js';
export { OverlayRenderer } from './renderer/overlayRenderer.js';
export { RowRenderer } from './renderer/rowRenderer.js';
export { ViewportRenderer } from './renderer/viewportRenderer.js';

// packages/core/src/internal.ts:58
export { getStoreFromApi } from './createGrid.js';
```

- `packages/core/src/gridHost.ts` is the current adapter bridge. It legitimately
  recovers the internal store and mounts the renderer:

```ts
// packages/core/src/gridHost.ts:75
const store = getStoreFromApi(api);
const engine = store.engine;
const internalApi = store;
const renderEngine = new RenderEngine(engine, internalApi);

// packages/core/src/gridHost.ts:88
engine.getRenderStats = () => renderEngine.getRenderStats();
engine.resetRenderStats = () => renderEngine.resetRenderStats();
```

- `gridHost.ts` exposes the small adapter handle that React actually needs:

```ts
// packages/core/src/gridHost.ts:55
export interface GridAdapterHandle<TRowData = unknown> {
	getCellPointerFromElement(element: Element): import('./store.js').GridCellPointer | null;
	getCellAccessFromElement(element: Element): import('./store.js').GridCellAccess<TRowData> | null;
	getCellAccess(rowId: string, colField: string): import('./store.js').GridCellAccess<TRowData> | null;
	getGroupVisibleDescendantRowIds(groupId: string): string[];
	isImperativeRendererColumn(column: import('./columnDef.js').ColumnDef<TRowData>): boolean;
}
```

- `packages/react/src/OpenGrid.tsx` imports both the host API and
  `InternalColumnDef` from the broad internal barrel:

```ts
// packages/react/src/OpenGrid.tsx:16
import { InternalColumnDef, GridHostWithAdapter, GridAdapterHandle, mountGridHost } from '@eregister/open-grid-core/internal';

// packages/react/src/OpenGrid.tsx:226
if ((mount.col as InternalColumnDef)?.cellRendererCapabilities?.imperativeUpdate && !mount.isEditing) {
```

- `packages/react/src/GridPortal.tsx` also imports `InternalColumnDef` from the
  broad internal barrel:

```ts
// packages/react/src/GridPortal.tsx:25
import type { InternalColumnDef } from '@eregister/open-grid-core/internal';

// packages/react/src/GridPortal.tsx:911
const useImperative = !!(p.col as InternalColumnDef).cellRendererCapabilities?.imperativeUpdate;
```

- Boundary tests currently require the internal entry to export renderer
  classes:

```ts
// packages/core/src/boundary.test.ts:71
it('exports renderer classes', () => {
	const rendererClasses = [
		'GeometryController',
		'InvalidationManager',
		'PortalMountManager',
		'RenderOrchestrator',
		'RenderScheduler',
		'CellRenderer',
		'FullWidthRowRenderer',
		'HeaderRenderer',
		'OverlayRenderer',
		'RowRenderer',
		'ViewportRenderer',
	];
```

- Existing repo conventions:
    - Public API exports live in `packages/core/src/index.ts`.
    - Adapter/internal exports currently live in `packages/core/src/internal.ts`.
    - Architecture guardrails live in
      `packages/core/src/engine/architectureGuards.test.ts`.
    - Public/internal runtime boundary checks live in
      `packages/core/src/boundary.test.ts`.

## Commands you will need

| Purpose                 | Command                                                                                                  | Expected on success  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| Core build              | `corepack pnpm --filter @eregister/open-grid-core build`                                                 | exit 0               |
| React build             | `corepack pnpm --filter @eregister/open-grid-react build`                                                | exit 0               |
| Core boundary tests     | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/boundary.test.ts`                  | exit 0               |
| Core architecture tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts` | exit 0               |
| Core full tests         | `corepack pnpm --filter @eregister/open-grid-core test`                                                  | all core tests pass  |
| React full tests        | `corepack pnpm --filter @eregister/open-grid-react test`                                                 | all React tests pass |
| Demo build              | `corepack pnpm --filter demo-app build`                                                                  | exit 0               |

Run package builds sequentially. Run the demo build only after core and React
builds pass.

## Scope

**In scope**:

- `packages/core/src/internal.ts`
- `packages/core/src/gridHost.ts`
- `packages/core/src/boundary.test.ts`
- `packages/core/src/engine/architectureGuards.test.ts`
- `packages/core/src/api/GridApi.ts` only for type relocation or narrowing if
  needed by the adapter boundary
- `packages/core/src/columnDef.ts` only for exposing a narrow renderer-capability
  helper/type if needed
- `packages/react/src/OpenGrid.tsx`
- `packages/react/src/GridPortal.tsx`
- `packages/core/package.json` only if exports need a new subpath
- `packages/react/package.json` only if TypeScript/package resolution requires
  a new subpath import

**Out of scope**:

- No renderer decomposition of `renderEngine.ts`, `rowRenderer.ts`,
  `portalMountManager.ts`, or renderer slot classes.
- No behavior changes to scrolling, selection, grouping, editing, portals, or
  custom renderers.
- No public `@eregister/open-grid-core` API additions unless they are type-only exports
  already intended for application developers.
- No new grid features.
- No store/engine ownership refactor beyond what is required to hide the broad
  internal barrel.
- Do not delete `getStoreFromApi` if `gridHost.ts`, `gridPlugins.ts`, or other
  core-internal modules still need it. The goal is to stop exporting it from the
  adapter-facing barrel, not to break internal composition.

## Git workflow

- Branch: `codex/015-internal-adapter-boundary`
- Commit style: match recent plan-scoped architecture commits, for example
  `015-internal-adapter-boundary.md` or `fix: harden data mutation pipeline`.
- Keep commits logical: one for export surface/type moves, one for import
  migration and tests.
- Do not push unless explicitly instructed.

## Steps

### Step 1: Lock the current boundary baseline

Run the focused boundary and architecture tests before editing. Confirm the
current tests pass so failures after this point are attributable to this plan.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/boundary.test.ts src/engine/architectureGuards.test.ts` -> exit 0.

### Step 2: Define the intended adapter-facing internal surface

Rewrite `packages/core/src/internal.ts` so it exports only the adapter contract
that framework bindings need today.

The target internal entry should include:

- `mountGridHost`
- `GridHost`
- `GridHostOptions`
- `GridHostWithAdapter`
- `GridAdapterHandle`
- `GridCellContentAdapter`
- `GridRowContentAdapter`
- `GridHeaderMenuAdapter`
- renderer mount/unmount types required by those adapter interfaces, if they
  are not already re-exported through `gridHost.ts`
- `InternalColumnDef` or a narrower replacement type/helper only if React still
  needs to inspect `cellRendererCapabilities`

The target internal entry should not export:

- `GridStore`
- `GridEngine`
- `StateManager`
- `CommandHistory`
- `EventBus`
- core models such as `DataModel`, `ColumnModel`, `ViewportModel`, or
  `CellAccessModel`
- row model controllers
- renderer classes such as `RenderEngine`, `RowRenderer`, `CellRenderer`,
  `HeaderRenderer`, `ViewportRenderer`, or `PortalMountManager`
- `getStoreFromApi`
- broad `export *` barrels

Prefer explicit named exports. Do not replace broad exports with another broad
barrel.

If TypeScript needs the renderer mount/unmount types from
`renderer/IGridRenderer.ts`, re-export only those types from `gridHost.ts` or
`internal.ts`; do not re-export the whole renderer interface module.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 3: Move React imports to the narrowed contract

Update React adapter imports so they use only the narrowed internal contract.

Required changes:

- `packages/react/src/OpenGrid.tsx` should still import `mountGridHost`,
  `GridHostWithAdapter`, and `GridAdapterHandle` from
  `@eregister/open-grid-core/internal`, but those names must now come from the narrowed
  export list.
- `packages/react/src/OpenGrid.tsx` should avoid direct dependency on a broad
  `InternalColumnDef` if a narrower helper can express the check. Preferred
  options:
    - export a type-only `ColumnRendererCapabilitiesCarrier` or similar from the
      adapter boundary, or
    - export a tiny helper such as `hasImperativeRendererCapability(column)` from
      core if it belongs near `columnDef.ts`.
- `packages/react/src/GridPortal.tsx` should use the same narrow type/helper for
  `cellRendererCapabilities`.

Do not change portal behavior. The imperative renderer fast path must still
work when `cellRendererCapabilities.imperativeUpdate === true`.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-react build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-react test` -> exit 0.

### Step 4: Update boundary tests to enforce the sealed entry

Update `packages/core/src/boundary.test.ts` so it no longer expects renderer
classes to be exported from `@eregister/open-grid-core/internal`.

Add explicit tests that the internal entry:

- exports `mountGridHost`;
- exports `GridHost`/adapter types only as type-only exports where applicable
  (runtime check should not expect type names to exist);
- does not export `GridStore`;
- does not export `GridEngine`;
- does not export `RenderEngine`;
- does not export `RowRenderer`;
- does not export `PortalMountManager`;
- does not export `StateManager`;
- does not export `CommandHistory`;
- does not export `EventBus`;
- does not export `getStoreFromApi`.

Keep existing public-entry tests that verify `@eregister/open-grid-core` does not expose
internal renderer/store symbols.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/boundary.test.ts --reporter=verbose` -> exit 0.

### Step 5: Add source-level guardrails against broad internal barrels

Extend `packages/core/src/engine/architectureGuards.test.ts` with file-content
guards that make the new boundary difficult to regress.

Recommended checks:

- `packages/core/src/internal.ts` does not contain `export * from`.
- `packages/core/src/internal.ts` does not contain exports from
  `./engine/GridEngine.js`, `./store.js`, `./renderer/renderEngine.js`, or
  `./renderer/rowRenderer.js`.
- `packages/react/src/OpenGrid.tsx` and `packages/react/src/GridPortal.tsx` do
  not import any renderer classes, `GridStore`, `GridEngine`, or
  `getStoreFromApi`.

Avoid brittle checks that forbid all use of `@eregister/open-grid-core/internal` in React;
React is allowed to import the adapter host contract from that entry. The guard
should forbid raw implementation imports, not the adapter bridge itself.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts --reporter=verbose` -> exit 0.

### Step 6: Keep core-internal composition working

After sealing `internal.ts`, check modules that legitimately use raw internals
inside the core package:

- `packages/core/src/gridHost.ts`
- `packages/core/src/gridPlugins.ts`
- `packages/core/src/contextMenu.ts`
- `packages/core/src/navigation.ts`

They may continue to import `getStoreFromApi`, `GridStore`, or
`InternalGridApi` through relative paths because they are inside core. Do not
force these internal implementation files through the adapter-facing barrel.

If a test import used `@eregister/open-grid-core/internal` only because it was convenient,
migrate the test to a relative core import or adjust the runtime boundary test
to match the new intended export surface.

**Verify**:

- `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.
- `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0.

### Step 7: Run full sequential verification

Run these commands in order:

1. `corepack pnpm --filter @eregister/open-grid-core build`
2. `corepack pnpm --filter @eregister/open-grid-react build`
3. `corepack pnpm --filter @eregister/open-grid-core test`
4. `corepack pnpm --filter @eregister/open-grid-react test`
5. `corepack pnpm --filter demo-app build`

Expected: all exit 0.

## Test plan

- Update `packages/core/src/boundary.test.ts` to define the new intended
  runtime export contract for `@eregister/open-grid-core/internal`.
- Extend `packages/core/src/engine/architectureGuards.test.ts` with static
  guardrails against broad `export *` barrels and raw implementation exports.
- Run existing React tests to confirm `OpenGrid` and portal behavior still
  compile and pass after import changes.
- Do not add renderer behavior tests unless an import/type move accidentally
  changes observable behavior; this plan is about boundaries, not rendering
  semantics.

## Done criteria

All must hold:

- [ ] `packages/core/src/internal.ts` has no broad `export * from` lines.
- [ ] `@eregister/open-grid-core/internal` exports the adapter host contract and does not
      export raw store, engine, model, or renderer classes.
- [ ] React imports from `@eregister/open-grid-core/internal` are limited to the adapter
      host contract and the narrow renderer-capability type/helper.
- [ ] `getStoreFromApi` remains available to core-internal implementation files
      through relative imports, but is no longer exported by
      `@eregister/open-grid-core/internal`.
- [ ] Boundary tests assert the new internal export surface.
- [ ] Architecture guards prevent the broad barrel from returning.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `plans/README.md` status for Plan 015 is updated.

## STOP conditions

Stop and report back if:

- React cannot compile without importing a raw renderer class or `GridStore`
  from `@eregister/open-grid-core/internal`.
- Sealing `internal.ts` appears to require changing public `@eregister/open-grid-core`
  application APIs.
- The imperative renderer fast path would need behavior changes instead of a
  type/helper move.
- TypeScript package exports require a new subpath and the package manager/build
  setup rejects it in a way that affects published package compatibility.
- Any renderer behavior test fails after import-only changes and the failure is
  not clearly caused by a mechanical import/type issue.

## Maintenance notes

- Reviewers should treat `@eregister/open-grid-core/internal` as the adapter SDK. New
  exports should be justified by a framework adapter need, not by convenience
  for implementation files.
- Core-internal implementation modules can still use relative imports for raw
  internals; the important boundary is what package consumers and adapters can
  import from the internal subpath.
- This plan intentionally does not decompose renderer classes. It makes that
  later work safer by shrinking the set of external-ish symbols that renderer
  refactors must preserve.
