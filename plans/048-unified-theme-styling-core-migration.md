# Plan 048: Unified theme styling core migration

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Planned at**: 2026-06-14
- **Commit baseline**: `05f929b`
- **Status**: COMPLETE

## Completion note

This migration is now landed:

- `setStyleSlots`, `styleSlots`, `beforeCellRender`, and `afterCellRender` are removed from runtime code.
- `styleRules` remains as the single declarative conditional styling model.
- public `api.setStyleRules` is available again as a thin entrypoint into the same core-owned `styleRules` state.
- built-in theme selection stays core-owned and persistence-owned.

## Goal

Make styling a first-class core capability with one owned path:

1. `theme` becomes the single persisted visual system for built-in grid styling.
2. `setStyleSlots` and the entire `styleSlots` model are removed completely from public API, core runtime, React bindings, and demos.
3. Data-driven row/cell/header decoration, if retained, moves onto a single declarative styling pipeline that is compatible with the theme system and does not rely on imperative render hooks.
4. Theme selection is owned by persistence, exposed in the sidebar, and applied consistently with no parallel local-storage or React-only implementation.

## Why this plan exists

The current implementation is close, but styling still has two overlapping systems:

- `theme` already owns token-driven built-in visuals and persistence (`packages/core/src/renderer/themes.ts`, `packages/core/src/persistence/statePersistence.ts`, `packages/core/src/renderer/viewportRenderer.ts`).
- `styleSlots` still exists as a second styling channel across public API, engine/store/runtime wiring, render hot paths, React adapters, tests, and demo pages.

That split creates exactly the long-term risks you called out:

- double implementation of styling
- unclear source of truth
- theme work that feels bolted on instead of core-owned
- hot-path branches for legacy style callbacks
- migration drag because demo pages and React helpers keep teaching the deprecated path

## Current findings

### Deprecated styling still crosses the full stack

- Public API still exposes `setStyleSlots` and `GridTransaction.styleSlots` in [packages/core/src/api/GridApi.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\api\GridApi.ts).
- Core still stores and propagates `styleSlots` through [packages/core/src/store.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\store.ts), [packages/core/src/engine/GridEngine.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\engine\GridEngine.ts), [packages/core/src/features/GridStateFeatureController.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\features\GridStateFeatureController.ts), and [packages/core/src/state/GridState.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\state\GridState.ts).
- Render hot paths still branch on style hooks in [packages/core/src/renderer/rowRenderer.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\rowRenderer.ts), [packages/core/src/renderer/rowCellBinder.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\rowCellBinder.ts), [packages/core/src/renderer/headerRenderer.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\headerRenderer.ts), [packages/core/src/renderer/renderScrollCoordinator.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\renderScrollCoordinator.ts), and [packages/core/src/renderer/renderPaintCoordinator.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\renderPaintCoordinator.ts).

### React still reintroduces the old model

- [packages/react/src/Grid.tsx](C:\Users\rishi\witbybit\wit-grid\packages\react\src\Grid.tsx) compiles `styleRules` back into `styleSlots`.
- [packages/react/src/styleRules.ts](C:\Users\rishi\witbybit\wit-grid\packages\react\src\styleRules.ts) is effectively a legacy compatibility bridge instead of a first-class styling API.
- React tests currently validate the old translation path instead of the desired end state.

### Demo pages still teach the deprecated surface

- [demo/src/pages/CalculationsArena.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\CalculationsArena.tsx)
- [demo/src/pages/GanttSchedulingWorkspace.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\GanttSchedulingWorkspace.tsx)
- [demo/src/pages/RealtimeDashboard.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\RealtimeDashboard.tsx)
- [demo/src/pages/NestedTablesGrouping.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\NestedTablesGrouping.tsx)

### The theme system is already the strongest foundation

- Built-in tokens, theme metadata, and CSS variable generation already live in [packages/core/src/renderer/themes.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\themes.ts).
- Theme application is already scoped and grid-owned in [packages/core/src/renderer/viewportRenderer.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\viewportRenderer.ts).
- Theme persistence is already in the right place in [packages/core/src/persistence/statePersistence.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\persistence\statePersistence.ts).
- Sidebar theme controls already exist and should become the canonical UX in [packages/react/src/sidebar/panels/ThemesPanel.tsx](C:\Users\rishi\witbybit\wit-grid\packages\react\src\sidebar\panels\ThemesPanel.tsx).

## Architecture decision

### Single source of truth

The grid should have one styling subsystem with two clearly separated layers:

1. **Theme tokens** for built-in visuals, spacing, borders, typography, selection chrome, menus, panels, overlays, and other component-level look-and-feel.
2. **Declarative decoration rules** for data-driven row/cell/header emphasis when users need conditional visual treatment.

Those are not two competing systems. They are two layers of one styling model:

- theme defines the stable visual language
- decoration rules choose when semantic theme-aware states apply

CSS classes in that system are for styling only. They must not be used as behavioral selectors, feature flags, state transport, or runtime coordination signals. Any non-visual meaning must move to a stable core-owned contract such as typed state, explicit DOM properties, or bounded `data-*`/attribute markers where DOM signaling is genuinely required.

What must disappear is the current third thing: ad hoc imperative `styleSlots` hooks.

### Keep vs remove

- **Keep** conditional decoration for rows/cells/headers, but redesign it as a declarative, core-owned styling rule pipeline.
- **Remove** `beforeCellRender` and `afterCellRender`. They are imperative render hooks, they complicate the hottest path, and they are not compatible with a clean first-class theming architecture.
- **Remove** direct class callback APIs that bypass semantic ownership. If custom classes remain, they should be emitted by the new declarative styling pipeline from a bounded semantic contract, not injected by per-bind imperative hooks.

### Performance stance

The new styling system must preserve these invariants:

- no arbitrary user callback execution on scroll-frame paint hot paths
- no per-cell imperative DOM mutation hooks during bind
- theme application remains CSS-variable driven
- decoration evaluation is cacheable, diffable, and only recomputed when its true inputs change
- renderer telemetry remains able to prove no regressions

## Target end state

### Core contract

Core owns one `styling` model that includes:

- persisted `themeName`
- theme resolution and switching
- optional declarative decoration definitions for rows, cells, and headers
- semantic output that the renderer can apply without imperative lifecycle hooks

`styleSlots` no longer exists anywhere.

### Renderer contract

Renderers consume only:

- resolved theme variables
- semantic styling state already normalized by core

Examples of acceptable renderer outputs:

- stable classes
- stable `data-*` attributes for semantic/state signaling when DOM metadata is required
- bounded inline CSS variables generated by core-owned styling state

Examples that should not survive:

- user callbacks called during bind
- arbitrary DOM mutation hooks
- public APIs that mutate styling through engine/store reach-through
- CSS classes that other subsystems rely on for logic, event routing, lifecycle detection, or feature coordination

### React contract

React exposes:

- theme API and theme panel wiring
- the new declarative styling API, if present

React does not:

- compile back into `styleSlots`
- maintain separate theme persistence
- own styling semantics outside core

## Scope

### In scope

- remove `setStyleSlots` from every package
- remove `GridStyleSlots` and all dependent runtime code
- replace React `styleRules` bridge with the new styling API
- migrate demos to theme + new styling API
- make theme controls first-class in sidebar and demos
- ensure persistence manager remains the only persistence path for theme choice
- update tests across core, React, and demos
- remove stale comments/docs that mention `styleSlots`

### Out of scope

- broad visual redesign of built-in themes
- unrelated renderer refactors not required by styling removal
- introducing user-authored arbitrary CSS execution hooks

## Execution plan

### Phase 0: Lock the migration contract before code deletion

Decide and document the new styling public surface before removing the old one.

Deliverables:

- final API shape for theme + declarative decoration
- explicit deprecation-removal list
- acceptance criteria for performance and compatibility

Required design choices:

1. Confirm `theme` is the only persisted visual state.
2. Confirm imperative render hooks are deleted, not replaced.
3. Confirm conditional decoration survives only as declarative rule input, not as imperative class hooks.
4. Confirm semantic output format:
    - preferred: classes for styling only; `data-*` attributes or typed state for non-style semantics
    - avoid arbitrary uncontrolled class composition in hot paths
    - do not let runtime logic depend on presentational class names

Exit criteria:

- no unresolved ambiguity about what replaces `styleRules`/`styleSlots`
- team aligns on what mild breakage is acceptable for a major cleanup

### Phase 1: Introduce the new core styling model alongside internal adapters only

Add the new core-owned styling model without exposing any compatibility bridge publicly.

Deliverables:

- a new style-state model in core that sits beside theme state
- a normalization layer that turns declarative decoration rules into renderer-friendly semantic outputs
- typed events/invalidation semantics for styling changes

Implementation direction:

- create a dedicated styling feature/controller rather than spreading logic across store/engine/renderer
- keep theme and decoration normalization close together so styling remains one subsystem
- ensure persistence only stores `themeName`, not transient decoration outputs

Tests:

- unit tests for rule normalization
- state change tests for styling updates
- invalidation tests proving the right repaint behavior

### Phase 2: Migrate renderers off `styleSlots`

Replace every renderer consumer of `styleSlots` with the new semantic styling runtime.

Targets:

- [packages/core/src/renderer/rowRenderer.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\rowRenderer.ts)
- [packages/core/src/renderer/rowCellBinder.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\rowCellBinder.ts)
- [packages/core/src/renderer/headerRenderer.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\headerRenderer.ts)
- [packages/core/src/renderer/selectionPaintManager.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\selectionPaintManager.ts)
- [packages/core/src/renderer/renderScrollCoordinator.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\renderScrollCoordinator.ts)
- [packages/core/src/renderer/renderPaintCoordinator.ts](C:\Users\rishi\witbybit\wit-grid\packages\core\src\renderer\renderPaintCoordinator.ts)

Requirements:

- remove style-hook branches entirely
- preserve scroll-frame safety
- preserve row selection/focus styling correctness
- preserve group/detail/full-width styling via semantic state, not ad hoc callbacks
- replace any behavior coupled to CSS class presence with stable renderer/core-owned state

Tests:

- renderer tests proving semantic styling still appears correctly
- regression tests proving no removed lifecycle hooks are still referenced
- performance tests updated to the new semantics instead of old callback behavior

### Phase 3: Remove `styleSlots` from public and internal API surfaces

After renderers no longer depend on it, delete the legacy model end-to-end.

Delete from:

- `GridApi`
- `GridTransaction`
- `createGrid` facade
- plugin runtime surfaces
- store/engine config/state wiring
- React exports and helper utilities
- TypeScript types and docs

Guardrails:

- architecture tests should fail if `styleSlots` or `setStyleSlots` reappear
- grep-based assertions are acceptable if the repo already uses this style of guard
- add focused guard coverage for presentational classes being used as behavior contracts in the migrated styling path

Tests:

- API surface compile checks
- architecture guard coverage
- package build verification

### Phase 4: Replace React `styleRules` with the new styling API

React must stop translating into the removed model and instead speak the new styling language directly.

Targets:

- [packages/react/src/Grid.tsx](C:\Users\rishi\witbybit\wit-grid\packages\react\src\Grid.tsx)
- [packages/react/src/styleRules.ts](C:\Users\rishi\witbybit\wit-grid\packages\react\src\styleRules.ts)
- [packages/react/src/styleRules.test.ts](C:\Users\rishi\witbybit\wit-grid\packages\react\src\styleRules.test.ts)
- [packages/react/src/index.ts](C:\Users\rishi\witbybit\wit-grid\packages\react\src\index.ts)
- [packages/react/src/types.ts](C:\Users\rishi\witbybit\wit-grid\packages\react\src\types.ts)

Decision rule:

- if `styleRules` can be cleanly reinterpreted as the new declarative styling model, keep the name temporarily and remap its semantics
- if the name itself encodes the deprecated bridge, replace it with a clearer API and migrate demo callers in the same change

Success criteria:

- React no longer compiles anything into `styleSlots`
- React tests validate the new styling model directly
- React remains a thin adapter, not the owner of styling semantics

### Phase 5: Make theme UX fully first-class

Theme controls should feel like a core feature, not a side panel add-on.

Targets:

- [packages/react/src/sidebar/GridSidebar.tsx](C:\Users\rishi\witbybit\wit-grid\packages\react\src\sidebar\GridSidebar.tsx)
- [packages/react/src/sidebar/panels/ThemesPanel.tsx](C:\Users\rishi\witbybit\wit-grid\packages\react\src\sidebar\panels\ThemesPanel.tsx)
- demo pages that should expose built-in theme toggles or showcase theme-aware styling

Requirements:

- built-in themes are discoverable from the sidebar
- switching themes updates immediately through core API
- persistence manager remains the only persistence path
- no duplicate localStorage writes anywhere in React or demo code

Tests:

- persistence round-trip tests for `themeName`
- React/sidebar interaction tests
- demo smoke verification

### Phase 6: Migrate demo pages and documentation to the final model

Every demo that currently teaches `styleSlots` or the old React bridge must be updated.

Priority targets:

- [demo/src/pages/NestedTablesGrouping.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\NestedTablesGrouping.tsx)
- [demo/src/pages/CalculationsArena.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\CalculationsArena.tsx)
- [demo/src/pages/GanttSchedulingWorkspace.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\GanttSchedulingWorkspace.tsx)
- [demo/src/pages/RealtimeDashboard.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\RealtimeDashboard.tsx)

Reference exemplar:

- [demo/src/pages/HeadlessSkinsPlayground.tsx](C:\Users\rishi\witbybit\wit-grid\demo\src\pages\HeadlessSkinsPlayground.tsx) already reflects the intended theme-first direction.

Requirements:

- no demo imports or config mention `styleSlots` or `setStyleSlots`
- demo styling examples show the new recommended API
- docs/comments that still reference style-slot CSS overrides are rewritten

### Phase 7: Deep verification and migration hardening

This migration is only done when the repo proves the old path is gone and the new one is stable.

Required test coverage:

- unit tests for core styling normalization
- renderer regressions for row/cell/header semantic styling
- persistence tests for theme retention
- React adapter tests for the new styling API
- architecture guards to prevent legacy API reintroduction
- targeted tests proving behavior no longer depends on CSS class names
- demo build verification

Additional verification:

- search the repo for `setStyleSlots`, `styleSlots`, `beforeCellRender`, and `afterCellRender`
- review the migrated styling path for logic keyed off class presence and replace it with stable state/attributes
- verify no stale docs/comments/tutorial strings remain

## Risks and mitigations

### Risk: breakage for consumers that still depend on `styleRules` or `setStyleSlots`

Mitigation:

- land the new declarative styling API first
- migrate in-repo consumers in the same sequence
- make deletion a single intentional breaking change instead of leaving half-migrated compatibility code

### Risk: styling regressions in row selection, grouped rows, detail rows, or headers

Mitigation:

- add focused renderer tests for each semantic state
- validate theme + conditional decoration combinations explicitly

### Risk: performance regression from naive rule evaluation

Mitigation:

- normalize rules once
- diff styling inputs by reference/version
- keep renderer application bounded to stable semantic outputs
- update performance tests to reflect the new execution model

### Risk: theme and decoration become two disconnected systems again

Mitigation:

- place both under one core styling subsystem
- define one public mental model in docs and demos
- reject React-only or demo-only styling shortcuts

### Risk: class-name coupling causes flaky behavior or hidden regressions

Mitigation:

- classes remain presentational only
- move behavior/state signaling onto typed runtime state or explicit DOM metadata
- add tests that assert behavior survives class-name changes when styling remains equivalent

## Acceptance criteria

The migration is complete when all of the following are true:

1. `setStyleSlots` is deleted from the repository.
2. `GridStyleSlots` is deleted from the repository.
3. `beforeCellRender` and `afterCellRender` are deleted from the repository.
4. Theme selection persists only through the persistence manager.
5. Sidebar theme controls use the same core theme API as the rest of the product.
6. React no longer compiles styling input into a legacy compatibility layer.
7. Demos no longer teach deprecated styling.
8. Renderer and performance tests are green on the new model.
9. Architecture guards prevent the legacy API from returning.
10. The migrated styling path does not depend on CSS class names for non-styling behavior.

## Recommended implementation order

1. Finalize the target styling API and semantic output contract.
2. Add the new core styling subsystem and tests.
3. Migrate renderers and performance-sensitive paths.
4. Remove legacy public/internal `styleSlots` plumbing.
5. Migrate React bindings.
6. Migrate sidebar/demo UX.
7. Audit the migrated path for class-name coupling and replace it with stable state/attributes.
8. Run full verification, then add anti-regression architecture guards.

## Verification commands

Run at minimum:

```bash
corepack pnpm --filter @eregister/wit-grid-core test
corepack pnpm --filter @eregister/wit-grid-react test
corepack pnpm --filter @eregister/wit-grid-core build
corepack pnpm --filter @eregister/wit-grid-react build
corepack pnpm --filter demo-app build
corepack pnpm run test
corepack pnpm run build
corepack pnpm exec prettier --check plans/048-unified-theme-styling-core-migration.md plans/README.md
```

## Notes for execution

- Treat this as a deliberate breaking-change migration, not a compatibility shim exercise.
- Prefer deleting the old system completely over preserving two public styling stories.
- If a styling use case cannot fit the new declarative model without imperative hooks, that is a design review trigger rather than a reason to keep legacy render callbacks.
