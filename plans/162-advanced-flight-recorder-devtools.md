# Plan 162: Ship an advanced interactive Flight Recorder DevTools panel

> **Executor instructions**: Start only after Plan 161 is DONE. Run all gates and stop on STOP conditions.
>
> **Drift check**: `git diff --stat a743eebe..HEAD -- packages/react/src packages/core/src/diagnostics packages/core/src/experimental.ts demo`

## Status

- **State**: DONE at `a942762bcccae0c0a41b8f4a81110e65faf02278`
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/161-causal-grid-flight-recorder.md`
- **Category**: direction
- **Planned at**: commit `a743eebe`, 2026-07-28

## Why this matters

The recorder differentiates Open Grid only when its evidence is understandable. Build a polished, keyboard-accessible inspector for causal stories, frame cost, timeline exploration, and redacted trace export. This supersedes the narrower unfinished Plan 122 rather than creating two DevTools products.

## Current state

- `plans/122-grid-devtools-runtime-inspector.md` proposed a generic static inspector but is unimplemented.
- `packages/react/src/sidebar/GridSidebar.tsx` owns built-in panels.
- `packages/react/src/hooks.ts` contains granular subscription patterns; do not poll or broadly subscribe.
- `packages/react/src/FormulaBar.tsx:33-60` demonstrates focused-cell synchronization.
- Consume only Plan 161's immutable experimental API. Never recover `GridStore` or import core internals.

## Commands

| Gate         | Command                                                                          | Expected |
| ------------ | -------------------------------------------------------------------------------- | -------- |
| Focused      | `corepack pnpm --filter @eregister/open-grid-react exec vitest run src/devtools` | exit 0   |
| React        | `corepack pnpm --filter @eregister/open-grid-react test`                         | exit 0   |
| Architecture | `corepack pnpm run test:architecture`                                            | exit 0   |
| Packages     | `corepack pnpm run build:packages`                                               | exit 0   |
| Demo         | `corepack pnpm --filter demo-app build`                                          | exit 0   |

## Scope

**In scope**: new `packages/react/src/devtools/` and tests; narrow sidebar/Grid/types/experimental registration; existing theme tokens; dedicated real diagnostic demo.

**Out of scope**: browser extension/TanStack integration; changing recorder semantics; replay execution; stable/default bundle inclusion; internal/store imports; new UI/chart dependencies or renderer portal systems.

## Git workflow

- Branch: `codex/162-advanced-flight-recorder-devtools`
- Do not push/open a PR unless instructed.

## Product shape

Four deep workspaces, not eleven shallow tabs:

1. **Why this cell?** — raw/display provenance, last change, formula/aggregate contributors, integrity, invalidation, frame, and explicit unknowns.
2. **Timeline** — virtualized/filterable events grouped by interaction/change ID; pause, search, type/severity chips, details.
3. **Performance** — frame distribution, slow frames, cells written, rows visited, topology churn, fallbacks, causal attribution. SVG/CSS only.
4. **Faults & Trace** — faults, privacy/capacity/drop state, copy/download redacted trace, replay handoff.

Support resizable docked and floating modes using existing sidebar/overlay primitives.

## Steps

### 1. Create pure DevTools view models

Transform snapshots/explanations into timeline groups, cards, frame distributions, and search results outside React rendering. Test empty, unknown, wrapped/dropped, faulted, and large traces.

### 2. Build “Why this cell?”

Track exact focused cell through granular subscriptions. Render an accessible causal story, expandable evidence, unknown/redacted states, and correlated timeline jumps. Never infer causality from timestamp proximity.

### 3. Build virtual timeline and performance panels

Timeline DOM must be virtualized/bounded and stable on unrelated grid state. Performance panels show real metrics, never synthetic scores. UI pause may freeze its snapshot but must have explicit recorder behavior.

### 4. Add polished controls and experimental integration

Explicitly enable recording/DevTools. Add privacy/capacity, clear, copy/download, dock/floating, theme awareness, responsive layouts, empty/error states, and reduced motion. No autoplay or silent production recording.

### 5. Add a real adversarial demo

Combine edit, batch/paste, formula dependency, live-stream conflict, rejected validation, fault, fallback, and deliberately expensive custom value work. Do not fake static diagnostics.

**Verify each step** with focused tests; finish with all listed gates.

## Test plan

- Pure selector grouping/filter/correlation tests.
- Keyboard, focus restoration, Escape, roles/names, long text, narrow width, light/dark, reduced motion.
- 10,000-event fixture with bounded rendered nodes.
- Multiple grids, remount, destroy while open, stopped recorder, stale/deleted focused row.
- Stable-entry absence and no internal/store imports.

## Done criteria

- [ ] Plan 122 marked SUPERSEDED by 161-163.
- [ ] Four coherent experimental workspaces ship.
- [ ] Causality uses IDs and unknowns are honest.
- [ ] Timeline is virtualized and subscriptions are granular.
- [ ] UI is attractive, accessible, responsive, dockable, theme-aware.
- [ ] Recording is opt-in and exports are redacted by default.
- [ ] All listed gates pass.

## STOP conditions

- Plan 161 is not DONE/contract is unstable.
- UI needs mutable buffers, `GridStore`, or core internals.
- A new scheduler/portal system or heavyweight dependency is needed.
- Timeline speed would require weakening causal correctness.

## Maintenance notes

Keep causal transformation in pure view models so other adapters can build UIs. Every visualization must define empty, unknown, redacted, dropped-data, and multi-grid behavior. Verify experimental code is excluded unless imported/enabled.
