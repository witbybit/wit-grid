# Plan 080: Real Post-Scroll Queue and Scheduler Authority

> **Why this follows Plan 079**: Once paint frames report their real lifecycle, the remaining scheduler lie is `requestPostScrollWork()`: it currently aliases paint scheduling and has no distinct queue, callback, cancellation, or epoch semantics. This plan makes the frame coordinator the sole authority for scroll, paint, and post-scroll work.

## Status

- **Priority**: P0 — scheduling correctness and lifecycle completion
- **Effort**: M
- **Risk**: MEDIUM — central scheduling path
- **Depends on**: Plan 079
- **Category**: rendering, scheduling, architecture
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

The coordinator exposes:

```ts
requestScrollFrame(): void;
requestPaintFrame(): void;
requestPostScrollWork(): void;
```

but `requestPostScrollWork()` delegates to `requestPaintFrame()`. There is no post-scroll queue or callback. The implementation therefore cannot guarantee the documented priority:

```text
scroll > paint > post-scroll
```

Scheduling is also split between:

- `FrameCoordinator`
- injected `GridScheduler`
- direct imports of `defaultGridScheduler`
- timers and RAF calls in scroll coordination

This leaves multiple timing authorities.

## What to add

### 1. Distinct post-scroll queue

```ts
interface FrameCoordinatorDeps {
	onScrollFrame(): void;
	onPaintFrame(): void;
	onPostScrollWork(): void;
}
```

Track post-scroll scheduling independently:

```ts
private postScrollScheduled = false;
private requestedPostScrollEpoch = 0;
```

### 2. Explicit priority rules

Within a frame/session:

1. Scroll work wins over paint.
2. Paint runs after pending scroll work is clear.
3. Post-scroll work runs only after the matching scroll epoch finishes.
4. A new scroll epoch cancels stale post-scroll work.

### 3. One injected scheduler

All RAF, microtask, timeout, and cancellation operations in render coordination must use the same injected `GridScheduler`. Remove production imports of `defaultGridScheduler` from coordinators.

### 4. Simplify paint scheduling

Remove the microtask-before-RAF layer unless a benchmark demonstrates a measurable benefit. A pending RAF already coalesces synchronous requests.

Store cancellable handles for every scheduled callback.

### 5. Destruction and cancellation contract

`destroy()` must:

- cancel pending RAF/timers when supported
- clear all queue flags
- invalidate captured epochs
- prevent callbacks from invoking runtime work

## Phases

### Phase 1 — Add distinct post-scroll work

- Add callback and queue state
- Wire post-scroll decoration and deferred portal work to it

### Phase 2 — Centralize scheduler usage

- Inject one scheduler into all render coordinators
- Remove direct default scheduler imports

### Phase 3 — Remove unnecessary microtask layer

- Benchmark direct RAF versus microtask-to-RAF
- Keep the simpler direct RAF path unless evidence says otherwise

### Phase 4 — Cancellation tests

- New scroll cancels old post-scroll work
- Destroy cancels all queued work
- Priority is deterministic

## STOP conditions

- Do not implement post-scroll as another alias to paint.
- Do not retain direct RAF or timer calls in production render coordinators.
- Do not introduce independent scheduler flags outside `FrameCoordinator`.
- Do not use time delays as lifecycle truth; scroll epochs and runtime phases own correctness.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add deterministic scheduler tests for priority, coalescing, stale epoch rejection, cancellation, destruction, and post-scroll work that never executes during an active scroll or paint frame.
