# Plan 065: Single Render Runtime Phase Authority

> **Why this must land first**: Scroll state currently exists across `RenderEngine`, `GridEngine`, the portal manager, schedulers, and post-scroll coordination. That replicated state is the foundation for stale portal work, premature scroll completion, deferred paints that never flush, and transitions running in the wrong phase. Before consolidating scheduling, the grid needs one authoritative render lifecycle.

## Status

- **Priority**: P0 — render correctness and coordination gate
- **Effort**: M
- **Risk**: MEDIUM — central lifecycle change, but behavior should remain equivalent
- **Depends on**: Plan 064
- **Category**: architecture, rendering, correctness
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

The renderer represents the same lifecycle through several partially overlapping booleans and coordinator states:

- `RenderEngine.isScrolling`
- `RenderEngine.isScrollFrameActive`
- `GridEngine.isScrolling`
- `GridEngine.isScrollFrameActive`
- scroll coordinator state
- scheduler pending state
- portal manager scrolling state
- post-scroll decoration flags

These values can drift because there is no single owner for the current runtime phase. Every new renderer feature must know which combination of booleans means “safe to mount portals”, “safe to paint”, or “scroll has ended”.

## What to add

### 1. Authoritative runtime phase model

```ts
// packages/core/src/renderer/renderRuntimeState.ts

export type RenderRuntimePhase = 'idle' | 'scroll-pending' | 'scroll-frame' | 'paint-frame' | 'post-scroll' | 'destroyed';

export interface RenderRuntimeSnapshot {
	phase: RenderRuntimePhase;
	frameEpoch: number;
	scrollEpoch: number;
}
```

Add a small `RenderRuntimeState` class that alone owns phase transitions and epochs.

### 2. Explicit transition contract

Allowed transitions:

```text
idle -> scroll-pending -> scroll-frame -> post-scroll -> idle
idle -> paint-frame -> idle
post-scroll -> scroll-pending
any live phase -> destroyed
```

Invalid transitions must report a runtime fault in development/test builds.

### 3. Derived queries instead of replicated flags

Expose helpers:

```ts
isScrolling(): boolean;
isFrameActive(): boolean;
canFlushPortals(): boolean;
canRunDecoration(): boolean;
```

Remove mutable copies of these facts from other components.

### 4. Epochs for stale-work rejection

Every scheduled scroll, paint, portal, and post-scroll callback captures the relevant epoch. Work must no-op when its epoch no longer matches the runtime state.

## Phases

### Phase 1 — Introduce runtime state

- Add `renderRuntimeState.ts`
- Add transition and derived-query tests
- Construct it once inside renderer initialization

### Phase 2 — Migrate scroll ownership

- Replace scroll booleans in `RenderEngine`
- Replace duplicated scroll flags in `GridEngine`
- Move scroll start/end epoch changes into the runtime state

### Phase 3 — Migrate consumers

- Update portal manager, orchestrator, and decoration paths to query runtime state
- Remove local `scrolling` and `frame active` booleans where they duplicate runtime phase

### Phase 4 — Delete compatibility state

- Remove legacy setters and mirrored fields
- Add assertions that no subsystem mutates render phase independently

## STOP conditions

- Do not change frame scheduling policy in this plan; Plan 066 owns scheduler consolidation.
- Do not merge scroll and paint execution paths yet.
- Do not expose `RenderRuntimeState` through the public API.
- Do not preserve duplicate booleans “temporarily” after all consumers are migrated.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests proving legal transitions, stale epoch rejection, portal flush eligibility, and teardown from every live phase.
