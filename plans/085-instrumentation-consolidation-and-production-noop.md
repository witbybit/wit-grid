# Plan 085: Instrumentation Consolidation and Production No-Op

> **Why this follows state cleanup**: `GridInstrumentation` now exists, but legacy counters and mutable render-stat arrays remain embedded across `StateManager`, `RenderEngine`, row rendering, and portal management. Two telemetry architectures increase hot-path cost and make metrics disagree. This plan makes the instrumentation sink canonical and removes direct counters from business logic.

## Status

- **Priority**: P2 — performance hygiene and diagnostics consistency
- **Effort**: M
- **Risk**: MEDIUM — test and benchmark instrumentation changes
- **Depends on**: Plan 084
- **Category**: diagnostics, performance, architecture
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

The codebase currently contains both:

- `GridInstrumentation` with no-op and recording implementations
- direct mutable counters and arrays such as state read counts, render stats, portal stats, frame cell counts, and debug fields

This causes:

- duplicated metrics
- unavoidable production mutations
- test-only concerns in foundational methods
- inconsistent reset and aggregation semantics
- unclear ownership of performance data

## What to add

### 1. Canonical metric catalog

```ts
type GridMetric =
	| 'state.read'
	| 'render.frame'
	| 'render.cellVisited'
	| 'render.cellWritten'
	| 'render.sameWindowBailout'
	| 'portal.mount'
	| 'portal.release'
	| 'slot.rebind'
	| 'rowMutation.incremental'
	| 'rowMutation.fullRebuild';
```

Use typed payloads for frame summaries where counters are insufficient.

### 2. Static no-op production path

The default instrumentation object must be stable and allocation-free. Hot paths call it without creating payload objects unless recording is enabled.

### 3. Compatibility stats facade

If public/debug APIs expose render stats, derive them from the recording instrumentation implementation rather than maintaining a second counter set.

### 4. Remove direct counters

Delete or migrate:

- `debugGetStateCount`
- renderer-local duplicated counters
- portal manager duplicated counters
- unbounded per-frame arrays

### 5. Bounded recording

Diagnostic frame histories must have explicit capacity and reset semantics.

## Phases

### Phase 1 — Metric inventory

- Map every existing counter to the canonical sink
- Identify public compatibility requirements

### Phase 2 — Migrate hot paths

- state
- renderer
- slots
- portals
- row mutations

### Phase 3 — Delete duplicate telemetry

- Remove old fields
- Update tests and debug APIs

### Phase 4 — Production-cost verification

Benchmark no-op instrumentation versus instrumentation disabled at compile time and confirm negligible difference.

## STOP conditions

- Do not keep legacy counters “for tests” after equivalent sink metrics exist.
- Do not allocate metric payload objects on every cell when instrumentation is no-op.
- Do not expose the instrumentation sink as a general public mutation API.
- Do not retain unbounded diagnostic histories.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-core test -- performance
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests for metric parity, no-op stability, bounded histories, reset behavior, compatibility render stats, and absence of old direct counter fields through architecture guards.
