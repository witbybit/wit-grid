# Plan 066: Unified Frame Coordinator and Invalidation Flow

> **Why this follows Plan 065**: Once render phase has one owner, scheduling can be reduced to one coordinator. Today render work may be requested through invalidation, paint scheduling, scroll scheduling, direct flushes, portal flushes, post-scroll RAFs, and timers. The grid needs one path from “state changed” to “work executed”.

## Status

- **Priority**: P0 — hot-path simplification and lifecycle correctness
- **Effort**: L
- **Risk**: MEDIUM-HIGH — scheduler behavior changes can expose timing assumptions
- **Depends on**: Plan 065
- **Category**: architecture, rendering, performance
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

The current renderer has multiple schedulers and request paths:

- `RenderScheduler`
- `ScrollFrameScheduler`
- engine scheduler hooks
- transaction flushes
- invalidation consumption
- direct render/flush paths
- portal-specific scheduling
- post-scroll RAF and timer work

`RenderScheduler` also uses a microtask before `requestAnimationFrame`, introducing an extra pending state without a measured benefit. Invalidation is not the sole source of paint truth, so render ordering depends on which API happened to request work.

## What to add

### 1. One frame coordinator

```ts
// packages/core/src/renderer/frameCoordinator.ts

export interface FrameCoordinator {
	requestScrollFrame(): void;
	requestPaintFrame(): void;
	requestPostScrollWork(): void;
	flushNowForTests(): void;
	destroy(): void;
}
```

The coordinator owns the only RAF handles used for renderer work.

### 2. Strict request rules

- Scroll events may only request a scroll frame.
- State/domain mutations add invalidation and request a paint frame.
- Portal hydration and deferred decoration enqueue post-scroll work.
- Normal production code may not call immediate render methods.
- `flushNowForTests()` is test-only/internal.

### 3. Invalidation as paint input

`InvalidationManager` must be the complete input to ordinary paint frames. A frame consumes one immutable invalidation snapshot and either completes it or explicitly requeues remaining work.

### 4. Remove microtask-to-RAF scheduling

Schedule RAF directly unless benchmark evidence demonstrates that the microtask stage improves coalescing or latency.

### 5. Deterministic priority

For a single browser frame:

```text
scroll frame > paint frame > post-scroll work
```

A newer scroll request invalidates stale post-scroll work through the runtime epoch from Plan 065.

## Phases

### Phase 1 — Add coordinator behind current adapters

- Introduce `FrameCoordinator`
- Route existing scheduler entry points through it
- Keep output behavior unchanged

### Phase 2 — Make invalidation authoritative

- Audit every `requestRender`, `schedulePaint`, and direct flush call
- Require an invalidation reason before paint is requested
- Add missing invalidation categories rather than bypassing the manager

### Phase 3 — Consolidate RAF ownership

- Delete `RenderScheduler` and `ScrollFrameScheduler` after migration
- Remove portal-owned RAF scheduling
- Move post-scroll work into the coordinator queue

### Phase 4 — Remove production immediate flushes

- Keep synchronous flushing only for tests, explicit initialization, and documented transactional API boundaries
- Add runtime assertions against nested or reentrant frame execution

## STOP conditions

- Do not redesign row or cell rendering in this plan.
- Do not add an idle-callback abstraction until post-scroll work is measured.
- Do not retain old scheduler classes as aliases after all call sites migrate.
- Do not use `queueMicrotask` merely to preserve the previous implementation shape.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add scheduler tests for coalescing, scroll priority, invalidation consumption, stale post-scroll cancellation, reentrancy prevention, and destruction with pending RAFs.
