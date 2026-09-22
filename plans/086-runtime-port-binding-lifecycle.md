# Plan 086: Runtime Port Binding Lifecycle

> **Why this is needed**: Renderer and theme capabilities were moved behind explicit ports, but the engine still mutates those ports after construction through `setRendererPorts()`. That is a valid host lifecycle, not constructor-only injection. The API and safeguards must describe and enforce the real binding model, including stale host rejection across remounts.

## Status

- **Priority**: P2 — host lifecycle correctness
- **Effort**: M
- **Risk**: MEDIUM — mount/unmount integration
- **Depends on**: Plan 085
- **Category**: engine, host integration, architecture
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

Current documentation says ports are supplied during composition and never attached after construction, while runtime code calls a setter during host mount and restores headless ports during unmount.

The actual model is:

> A mutable host capability binding with a headless fallback.

Without an explicit lifecycle and generation, delayed calls from an old renderer host can target a newly mounted host.

## What to add

### 1. Honest binding API

Replace ambiguous setter naming:

```ts
bindRuntimePorts(ports: RuntimePorts): RuntimePortBinding;
unbindRuntimePorts(binding: RuntimePortBinding): void;
```

### 2. Binding generation

```ts
interface RuntimePortBinding {
	readonly generation: number;
}
```

Every host-bound callback captures the generation. Calls from stale generations no-op or report a development fault.

### 3. Single active host contract

Define whether one engine can have:

- exactly one active renderer host
- sequential hosts over its lifetime
- no concurrent renderer hosts

Enforce that contract.

### 4. Headless fallback

Unbinding restores stable headless ports without allocating new fallback objects on every unmount.

### 5. Destruction ordering

Destroying the engine invalidates all bindings before host callbacks or portal work can run.

## Phases

### Phase 1 — Rename and document lifecycle

- Add binding token
- Update host composition

### Phase 2 — Generation guards

- Renderer requests
- theme operations
- container access
- deferred callbacks

### Phase 3 — Remount tests

- mount → unmount → remount
- stale old-host callback
- destroy while mounted
- headless operation

## STOP conditions

- Do not claim constructor-only injection while supporting host remounts.
- Do not allow concurrent hosts unless explicitly designed and tested.
- Do not reset to newly allocated fallback ports on every unmount.
- Do not let stale host generations invoke new-host capabilities.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add lifecycle tests for binding ownership, stale generation rejection, sequential remounts, headless fallback, destroy ordering, and duplicate active-host faults.
