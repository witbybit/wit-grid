# Plan 072: Centralized Runtime Instrumentation Sink

> **Why this should be isolated**: Performance counters are currently stored and mutated across `GridEngine`, `RenderEngine`, `RenderOrchestrator`, portal managers, and slot structures. Instrumentation is influencing runtime design instead of observing it. A single no-op-capable sink keeps production paths stable and prevents duplicated metrics.

## Status

- **Priority**: P2 — observability cleanup and hot-path discipline
- **Effort**: M
- **Risk**: LOW-MEDIUM — mostly additive migration
- **Depends on**: Plans 065–071
- **Category**: performance, diagnostics, architecture
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

Counters and render stats are distributed across several runtime owners. Similar concepts can be counted twice, tests reach into internal mutable fields, and production hot paths contain branches or mutations used only by diagnostics.

## What to add

### 1. Instrumentation contract

```ts
export interface GridInstrumentation {
	increment(metric: GridMetric, amount?: number): void;
	recordFrame(frame: FrameMetrics): void;
	recordFallback(event: FallbackMetric): void;
	snapshot(): GridInstrumentationSnapshot;
	reset(): void;
}
```

Provide:

- `NoopGridInstrumentation`
- `RecordingGridInstrumentation`

### 2. Canonical metric ownership

Define one source for every metric. Examples:

- slot assignment metrics originate in slot assignment
- portal lifecycle metrics originate in portal manager
- row-pipeline fallbacks originate in row pipeline
- frame metrics are finalized by frame coordinator

### 3. Build/runtime configuration

Production defaults to the no-op sink. Tests and performance demos explicitly opt into recording.

### 4. Stable public stats projection

If render stats remain public, project them from the instrumentation snapshot rather than exposing internal counter objects.

## Phases

### Phase 1 — Metric catalog

- Inventory all counters
- Remove duplicates and define names, units, and owners

### Phase 2 — Add sinks

- Introduce no-op and recording implementations
- Inject through runtime composition

### Phase 3 — Migrate counters

- Replace mutable fields in engine, renderer, portals, and slots
- Delete direct test access to private counters

### Phase 4 — Production hot-path verification

- Confirm no-op calls inline cheaply
- Compare scroll and update benchmarks before/after

## STOP conditions

- Do not create a stringly typed arbitrary event logger.
- Do not expose the instrumentation sink publicly.
- Do not leave old counters synchronized with the new sink.
- Do not enable recording by default in production builds.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Performance tests must verify metric parity in recording mode and no material regression in no-op mode.
