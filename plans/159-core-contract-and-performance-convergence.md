# Plan 159: Close the post-157/158 core audit gaps

> **Executor**: Follow phases in order, keep each phase reviewable, and run every gate. Do not improvise across STOP conditions.
>
> **Drift check**: `git diff --stat aa83bdb7..HEAD -- packages/core/src packages/core/package.json package.json scripts/pack-verify.mjs fixtures/package-consumer plans/README.md`

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plans 157 and 158
- **Planned at**: `aa83bdb7`, 2026-07-27
- **Implementation status**: DONE in the working tree, verified 2026-07-27

## Objective

Resolve every vetted finding from the deep post-157/158 core audit before another feature wave: async edit ordering, post-destroy publication, auto-height complexity, viewport planner complexity, grid-local focus navigation, row-model/renderer composition coverage, storage validation, public type/package contracts, verification tooling, and duplicated grid bootstrap.

## Evidence and current state

- `features/EditingFeatureController.ts:176-225` awaits user code and validation, then clears `activeEdit` without checking edit version/identity; `interaction/GridInteractionController.ts:423-464` fires commit-and-move without awaiting it.
- `renderer/renderEngine.ts:585-610` calls `resizeRow` once per measured row. `features/GridStateFeatureController.ts:299-305` clones `rowHeights` per call; `engine/GridProjectionPipeline.ts:73-86` rebuilds geometry; `engine/GridEngine.ts:1225-1241` walks every visual row.
- `renderer/viewportPlanner.ts:87-159` scans complete topology, allocates per-row column spreads, uses linear membership checks, and creates snapshot cell products for offscreen columns. Snapshot prewarm cells have no runtime consumer outside that planner.
- `renderer/floatingFilterRenderer.ts:525-541` uses a global document query and layout sorting for Tab; its filter ends in `|| true`.
- `createGrid.ts:170-387` triplicates bootstrap and allows persistence promises to call `applyGridState` after destroy.
- `workspace/localStorageWorkspaceAdapter.ts:7-15` casts parsed JSON directly to `GridViewDefinition[]`.
- `boundary.test.ts:63-168` protects runtime exports only; type-only API drift is unchecked.
- `scripts/pack-verify.mjs` covers only a basic client consumer, not infinite, SSRM, experimental, or React/internal integration.
- Plan 158 was followed immediately by `aa83bdb7`, a blank-row fix in `renderer/rowSlot.ts`, proving the missing cross-layer contract.

## Scope

In scope: the cited core modules and focused tests; shared row-mode composition tests; package/API reports and consumer fixtures; package-local core documentation; root/core check scripts; minimal private bootstrap extraction.

Out of scope: new features, React/demo redesign, another row-model replacement, new public engine/store/renderer APIs, unrelated dependency upgrades, and cosmetic renderer splitting.

## Phase 1 — Async correctness

1. Capture canonical edit identity plus version before awaiting value setters or validation.
2. Fence completion against current state. A stale completion must not write stale intent, close a newer editor, emit its lifecycle event, or move newer focus.
3. Add a single-flight/intent token for commit-and-move navigation.
4. Fence sync/async persistence restoration in client, infinite, and SSRM factories after destroy.
5. Add deferred-promise tests for overlapping commits, validators, rapid Tab/Enter, rejection, and destroy-before-hydration.

Verify: focused editing, interaction, persistence, lifecycle tests and core typecheck.

## Phase 2 — Bounded auto-height

1. Separate DOM reads from writes; collect changed heights into one map per delivery/frame.
2. Add one internal bulk row-height commit that clones state and rebuilds geometry at most once while preserving events, anchoring, explicit heights, teardown, and appropriate history semantics.
3. Add instrumentation tests asserting one commit and one geometry rebuild for many changed visible rows at a large logical row count.

Verify: focused geometry/renderer tests and instrumented budgets.

## Phase 3 — Bounded viewport planning

1. Delete snapshot prewarm products if still unconsumed; otherwise restrict them to rendered/pinned columns and wire the real consumer.
2. Cache renderer-mode classification by compiled-plan/topology version.
3. Construct executable column arrays and membership sets once, outside row loops; eliminate repeated spreads and `includes` checks.
4. Add a 1,000-column test proving work/output scale with visible plus pinned columns, not total columns.

Verify: viewport planner, renderer runtime, performance, and benchmark tests.

## Phase 4 — Grid-local focus ownership

Replace global floating-filter traversal with owning-grid topology/DOM order. Add two-grid Tab/Shift+Tab tests covering boundaries, hidden columns, pinned lanes, and destroyed grids.

Verify: focused floating-filter and renderer suites.

## Phase 5 — Cross-mode conformance

Build a shared client/infinite/SSRM composition matrix through real runtime composition covering loading-to-data slot replacement, failure/retry, hot-unbind/rebind, eviction/reload, stale generation rejection, async row identity changes during selection/editing/focus, duplicate column identity, and destroy with pending requests/validation/persistence/paint. Encode intentional capability differences explicitly.

Verify: new conformance suite, architecture and adversarial gates, then the full core suite.

## Phase 6 — Storage boundary

Parse workspace storage as `unknown`; validate the array, each view, and nested persisted-state envelope. Malformed JSON, non-arrays, partial objects, schema mismatches, mixed entries, unavailable storage, and quota errors must not make adapter methods throw. Follow existing persistence diagnostics conventions.

Verify: new adapter tests plus persistence/controller tests.

## Phase 7 — Public and packaged contracts

1. Add a deterministic checked declaration/API report for `.`, `./experimental`, and `./internal`; classify stable, experimental, and adapter-only symbols without promoting internals.
2. Compile packed client, infinite, SSRM, experimental, and React/internal consumers; add negative deep-import assertions.
3. Add `packages/core/README.md` with all three factories, destroy rules, SSRM datasource semantics, and entrypoint stability.

Verify: API report, `pack:verify`, core/react builds, and tarball contents.

## Phase 8 — Verification and bootstrap consolidation

1. Add source/test typecheck and check-only lint. Activate the existing TypeScript ESLint toolchain with a controlled baseline or remove it; do not leave dormant tooling.
2. Add `verify:core` covering typecheck, format/lint check, core tests, architecture, adversarial, and packed consumers. Keep performance budgets separately required for renderer changes. Add CI using the same commands if repo policy allows.
3. Only after characterization is green, extract a private bootstrap for persistence, selection-column synthesis, pinned normalization, runtime composition, diagnostics, and teardown. Row-model controllers remain strategies; public semantics stay unchanged.

## Commands

- `corepack pnpm --filter @eregister/open-grid-core exec tsc --noEmit`
- `corepack pnpm --filter @eregister/open-grid-core test`
- `corepack pnpm run test:architecture`
- `corepack pnpm run test:adversarial`
- `corepack pnpm run bench`
- `corepack pnpm run pack:verify`
- `corepack pnpm run build`

Every command must exit 0. Use fake schedulers/deferred promises for concurrency and work counters—not wall-clock timing—for complexity.

## Done criteria

- [ ] Stale async work cannot affect newer edit/focus state or destroyed grids.
- [ ] Auto-height makes at most one state commit and geometry rebuild per batch.
- [ ] Wide-grid planner work is bounded by the executable window.
- [ ] Floating-filter navigation performs no global DOM query/layout sort.
- [ ] Cross-mode composition tests prove row publication through visible slot binding.
- [ ] Workspace parsing is validated and resilient.
- [ ] Runtime and type API surfaces plus all package subpaths are checked.
- [ ] Packed consumer matrix and package-local documentation exist.
- [ ] Unified verification, full test/build, architecture, adversarial, benchmark, and package gates pass.
- [ ] Bootstrap duplication is removed without public semantic change.
- [ ] `plans/README.md` records DONE and implementation commit evidence.

## STOP conditions

- A fix requires changing documented public row-model semantics.
- Auto-height batching requires an unresolved public history/event decision.
- Snapshot planner fields have a real external/contractual consumer.
- API reporting implies mass public removals rather than a mechanical baseline.
- Bootstrap extraction accidentally merges mode-specific semantics.
- Any verification gate fails twice after a focused reasonable attempt.

## Maintenance notes

The permanent renderer contract is: scroll work is proportional to visible rows × visible columns, with no whole-model walk or global DOM query. Future row models must pass the shared composition matrix. Keep `@eregister/open-grid-core/internal` adapter-only.
