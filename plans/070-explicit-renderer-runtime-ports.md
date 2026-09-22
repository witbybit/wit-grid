# Plan 070: Explicit Renderer and Host Runtime Ports

> **Why this matters**: `GridEngine` currently acquires optional renderer methods after construction, including render stats, theme operations, container access, and render requests. That temporal mutation hides dependencies and makes the engine a service locator. Runtime capabilities must be explicit objects with stable ownership.

## Status

- **Priority**: P1 — architecture boundary and lifecycle clarity
- **Effort**: M
- **Risk**: MEDIUM — API facade and initialization wiring changes
- **Depends on**: Plans 065–069
- **Category**: architecture, API boundary, rendering
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

Optional function fields on `GridEngine` allow renderer capabilities to appear after the engine has already been created. Callers must account for undefined methods, renderer teardown can leave stale closures, and tests can accidentally exercise an engine with an incomplete capability set.

## What to add

### 1. Explicit ports

```ts
export interface RendererPort {
	requestRender(reason: RenderReason): void;
	getStats(): RenderStats;
	resetStats(): void;
	getContainer(): HTMLElement | null;
}

export interface ThemePort {
	getTheme(): ThemeTokens;
	switchTheme(theme: ThemeName): void;
}

export interface GridRuntimePorts {
	renderer: RendererPort;
	theme: ThemePort;
}
```

Use no-op or unavailable implementations where headless operation is supported.

### 2. Stable lifecycle

Ports are supplied during runtime composition and invalidated on destroy. They are not attached as optional methods to `GridEngine`.

### 3. API facade composition

Public API methods that need rendering or host access delegate through runtime ports. Domain-only methods continue to call the engine directly.

### 4. Headless contract

Document which API calls are valid without a mounted renderer. Unsupported calls must return a defined result or report a runtime fault, never fail through an undefined function.

## Phases

### Phase 1 — Define ports and adapters

- Add port interfaces
- Build DOM renderer and headless implementations
- Add lifecycle tests

### Phase 2 — Migrate API facade

- Move renderer/theme/container methods out of `GridEngine`
- Delegate through runtime composition

### Phase 3 — Remove injected function fields

- Delete optional renderer methods from `GridEngine`
- Remove initialization-time mutation
- Add compile-time checks preventing reintroduction

## STOP conditions

- Do not turn ports into a generic service locator map.
- Do not let domain models import renderer ports.
- Do not expose internal port objects directly through public API.
- Do not preserve optional engine fields as deprecated aliases.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests for mounted, headless, and destroyed runtimes, including deterministic behavior for renderer-dependent API calls.
