# Plan 037: Coordinator unit tests

> **Executor instructions**: Write isolated unit tests for the six decomposed
> coordinator/binder modules in `packages/core/src/renderer`. Tests must not
> require a running DOM (jsdom header only where strictly needed). Mock only
> what is required for the logic under test. Update `plans/README.md` when done.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Category**: testing, quality
- **Planned at**: 2026-06-14

## Why this matters

Plans 019–027 decomposed `RenderEngine` into 6+ coordinator/binder modules.
Each module is narrow and individually testable, but none has a test file yet.
A regression in any of these (scroll state machine, epoch tracking, deferred
portal/focus routing) silently breaks rendering for all grid users.

## Target modules

| Module                      | Key logic to test                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `rowRendererRuntime.ts`     | `RowRendererRuntimeBridge` — dirty-cell idempotency, portal release routing (deferred vs immediate), focus deferral                  |
| `renderPaintCoordinator.ts` | `RenderPaintCoordinator.refreshRendererEpochs` — epoch increments on style/loading change; `flushPaint` — sort animation flag gating |

## Test files

- `packages/core/src/renderer/rowRendererRuntime.test.ts`
- `packages/core/src/renderer/renderPaintCoordinator.test.ts`

## Done criteria

- [ ] `rowRendererRuntime.test.ts` added with ≥ 6 tests.
- [ ] `renderPaintCoordinator.test.ts` added with ≥ 4 tests.
- [ ] All tests pass (`corepack pnpm --filter @eregister/wit-grid-core test`).
- [ ] `plans/README.md` updated.
