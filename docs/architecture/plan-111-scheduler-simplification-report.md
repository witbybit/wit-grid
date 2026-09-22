# Plan 111: Measured Scheduler and Hot-Path Simplification Report

Date: 2026-06-18

## Summary

Plan 111 is complete.

The scheduler and instrumentation simplifications landed with measured verification from the existing Plan 091 baseline harness and focused runtime suites. The main outcomes are:

- the paint microtask hop before RAF was removed;
- direct `requestAnimationFrame` usage is now limited to `gridScheduler` plus documented interaction-only exceptions;
- duplicate `GridInstrumentation` counters that mirrored `RenderStats` were removed;
- production noop instrumentation is described as minimal overhead rather than zero overhead.

## Code Changes

### Scheduler

- `packages/core/src/renderer/frameCoordinator.ts`
    - `requestPaintFrame()` now schedules directly on the shared RAF arbiter.
- `packages/core/src/renderer/gridScheduler.test.ts`
    - updated to assert coalescing before RAF flush rather than via a microtask drain.
- `packages/core/src/contextMenu.ts`
    - direct RAF documented as interaction-only animation staging.
- `packages/core/src/features/RowDragController.ts`
    - direct RAF usage documented as interaction-only row animation / drag auto-scroll behavior.

### Instrumentation

- `packages/core/src/diagnostics/GridInstrumentation.ts`
    - removed counters duplicated by `RenderStats`.
    - retained only instrumentation-owned counters:
        - `STATE_READS`
        - `LEGACY_INFERRED_INVALIDATIONS`
        - `ROW_MUTATION_INCREMENTAL`
        - `ROW_MUTATION_FULL_REBUILD`
        - `SLOT_REBINDS`
- `packages/core/src/diagnostics/GridInstrumentation.test.ts`
    - updated to validate only the surviving instrumentation-owned metrics.

### Guardrails

- `packages/core/src/engine/architectureGuards.test.ts`
    - guards direct RAF allowlist.
    - guards removal of duplicated instrumentation counters.
    - guards honest noop instrumentation wording.

## Measured Verification

The following suites were used as the Plan 111 evidence set:

```powershell
corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/perf/instrumentedBudgets.test.ts src/renderer/runtimePerformance.test.ts src/renderer/serverRuntimePerformance.test.ts src/renderer/frameCoordinator.test.ts src/renderer/gridScheduler.test.ts
corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/diagnostics/GridInstrumentation.test.ts src/engine/architectureGuards.test.ts
corepack pnpm --filter @eregister/wit-grid-core build
```

Observed results on 2026-06-18:

- `instrumentedBudgets`, `runtimePerformance`, `serverRuntimePerformance`, `frameCoordinator`, and `gridScheduler` all passed: 75 tests green.
- `GridInstrumentation` and architecture guard suites passed: 175 tests green.
- `@eregister/wit-grid-core` build passed.

## Baseline Comparison Statement

Plan 091 established:

- `docs/architecture/baseline.json`
- `docs/architecture/benchmark-scenarios.json`
- `packages/core/src/perf/instrumentedBudgets.test.ts`

Plan 111 changes were validated against that harness rather than replacing it with ad hoc timing claims. No benchmark or correctness-budget regression was observed in the focused scheduler and runtime performance suites listed above.

## Allowed Direct RAF Exceptions

Direct `requestAnimationFrame` usage is intentionally limited to:

- `packages/core/src/renderer/gridScheduler.ts`
- `packages/core/src/contextMenu.ts`
- `packages/core/src/features/RowDragController.ts`

The latter two are interaction-only exceptions, not render scheduling authorities.

## Completion Gate Check

- Paint microtask removed unless proven beneficial: yes.
- Direct render RAF exceptions zero or explicitly allowlisted: yes.
- Instrumentation has one source of truth: yes for paint/scroll/portal counters, which now live only in `RenderStats`.
- Production noop instrumentation described honestly: yes.
- Code and timing state count decreased without benchmark regression: yes, within the focused Plan 091/111 evidence suite.

## Notes

A broader `renderEngine.test.ts` run still contains two exact-count failures unrelated to the removed `GridMetric` duplicates. Those failures were not introduced by the Plan 111 instrumentation cleanup and were left out of scope for this plan closeout.
