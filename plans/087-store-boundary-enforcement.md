# Plan 087: Store Compatibility Boundary Enforcement

> **Why this remains unfinished**: Dedicated API, state, renderer-port, and diagnostics modules now exist, but internal implementation files can still import broad contracts from `store.ts`. That keeps `store.ts` as the conceptual centre of the dependency graph and allows domain decomposition to regress silently.

## Status

- **Priority**: P2 — dependency architecture and maintainability
- **Effort**: M
- **Risk**: LOW — type/import migration with guardrails
- **Depends on**: Plan 086
- **Category**: architecture, types, boundaries
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

`store.ts` still acts as a compatibility hub for broad types and may be imported by internal state, renderer, row, or feature modules. Even when definitions have moved to owning domains, importing through the hub preserves hidden coupling and makes circular conceptual dependencies easy to reintroduce.

## What to add

### 1. Explicit compatibility role

Document `store.ts` as a compatibility/export facade only. It may re-export public contracts but must not be the source of internal implementation imports.

### 2. Direct domain imports

Internal code imports from owners:

```ts
import type { GridState } from './state/GridState.js';
import type { GridApi } from './api/GridApi.js';
import type { GridCellPointer } from './selection/types.js';
```

### 3. Architecture guard

Add a test or lint rule:

```text
core internal implementation files must not import from core/store.ts
```

Allow only an explicit small whitelist for compatibility tests or public entrypoints.

### 4. Cycle report

Generate a dependency-cycle report in CI for core and React adapter packages. Fail on new cycles across domain boundaries.

### 5. Ownership map

Add a short architecture document mapping major type families to their owning module.

## Phases

### Phase 1 — Import inventory

- Find all imports from `store.ts`
- Classify public compatibility versus internal misuse

### Phase 2 — Direct migration

- State manager
- renderers
- rows
- features
- React adapter internals

### Phase 3 — Guardrail

- Add architecture test/lint rule
- Add cycle detection

### Phase 4 — Shrink facade

Remove exports that are internal-only and no longer required for compatibility.

## STOP conditions

- Do not delete public compatibility exports without an intentional breaking-change decision.
- Do not create a new mega-barrel elsewhere.
- Do not solve import paths with `internal.ts` as another universal hub.
- Do not permit a broad permanent whitelist in the architecture guard.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add an architecture test proving internal files import owning modules directly, no new domain cycles exist, and public entrypoints continue exporting the intended compatibility surface.
