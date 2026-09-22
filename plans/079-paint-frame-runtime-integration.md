# Plan 079: Paint Frame Runtime Integration

> **Why this must land first**: `RenderRuntimeState` now models `paint-frame`, but ordinary paint execution never enters that phase. The renderer therefore reports itself as idle while painting, allowing portal flushes, decoration, and stale-work checks to make decisions from false lifecycle state. The phase model must become authoritative in real execution before more scheduler work lands.

## Status

- **Priority**: P0 — render lifecycle correctness
- **Effort**: S
- **Risk**: LOW — integration of an existing phase model
- **Depends on**: Plan 078
- **Category**: rendering, correctness, architecture
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

`RenderRuntimeState` defines:

```ts
type RenderRuntimePhase = 'idle' | 'scroll-pending' | 'scroll-frame' | 'paint-frame' | 'post-scroll' | 'destroyed';
```

Production scroll work transitions through the runtime state, but ordinary paint callbacks do not transition into `paint-frame`. During a real paint:

- `isFrameActive()` may return `false`
- `canFlushPortals()` may return `true`
- `canRunDecoration()` may return `true`
- `frameEpoch` does not advance
- stale work cannot reliably distinguish one paint from another

The lifecycle abstraction exists but is not authoritative.

## What to add

### 1. Paint execution wrapper

Add one internal execution method owned by the frame coordinator or render runtime:

```ts
private runPaintFrame(): void {
  this.runtimeState.transitionTo('paint-frame');

  try {
    this.onPaintFrame();
  } finally {
    if (!this.runtimeState.isDestroyed()) {
      this.runtimeState.transitionTo('idle');
    }
  }
}
```

No consumer may call the paint callback directly.

### 2. Paint epoch advancement

Every entered paint frame increments `frameEpoch`. Scheduled work that captures a frame epoch must reject itself when the runtime has advanced.

### 3. Runtime assertions

In development and test builds, report a runtime fault when:

- paint begins from an invalid phase
- paint exits into a non-idle live phase
- a second paint begins while a frame is active
- paint executes after destruction

### 4. Integration tests

Tests must assert the phase from inside the real paint callback, not only test `RenderRuntimeState` in isolation.

## Phases

### Phase 1 — Central paint wrapper

- Route all paint callbacks through one wrapper
- Enter `paint-frame` before invalidation is consumed
- Exit through `finally`

### Phase 2 — Epoch integration

- Advance `frameEpoch` for paint frames
- Update stale-work tests

### Phase 3 — Remove bypasses

- Search for direct paint callback execution
- Add an architecture test preventing new bypasses

## STOP conditions

- Do not redesign scheduling policy in this plan; Plan 080 owns queue semantics.
- Do not add another `isPainting` boolean.
- Do not allow portal or decoration code to infer paint state from scheduler flags.
- Do not swallow paint exceptions; phase cleanup must happen in `finally`, then the original error must propagate or be reported through the existing fault path.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests proving the runtime phase is `paint-frame` inside actual paint execution, returns to `idle` after success and failure, increments `frameEpoch`, and never flushes portals as if idle during paint.
