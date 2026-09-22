# Plan 071: Decompose the Core Store Type Hub

> **Why this is necessary now**: `store.ts` acts as a gravitational centre for public API types, internal engine contracts, renderer types, events, row models, and feature state. This creates conceptual cycles even where TypeScript imports remain technically acyclic. Future grouping, filtering, SSRM, and renderer work will become harder unless dependencies are made explicit.

## Status

- **Priority**: P1 — maintainability and dependency control
- **Effort**: L
- **Risk**: MEDIUM — import churn with low intended runtime impact
- **Depends on**: Plan 070
- **Category**: architecture, types, module boundaries
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

Many core modules import broad contracts from `store.ts`. The file effectively acts as a pseudo-barrel and allows renderer, rows, editing, selection, events, and public API concerns to know about one master type module.

This hides coupling and encourages new features to append types to the same file.

## What to add

### 1. Domain type modules

Target structure:

```text
core/api/types.ts
core/state/types.ts
core/rows/types.ts
core/columns/types.ts
core/editing/types.ts
core/selection/types.ts
core/rendering/types.ts
core/events/types.ts
core/filtering/types.ts
```

### 2. Public vs internal API split

- `api/types.ts` contains only public contracts.
- Internal engine and renderer contracts live in explicit internal modules.
- Package exports expose only intended public paths.

### 3. Dependency rules

Examples:

- rows and columns must not import rendering
- state types must not import React
- renderer may import narrow row/column/selection types
- public API types may reference public domain types, not internal models

Add static import-boundary tests or lint rules.

### 4. Shrink `store.ts`

Temporarily retain it as a compatibility re-export file, then delete it once all internal imports move and public exports are updated.

## Phases

### Phase 1 — Inventory and dependency graph

- Classify every export in `store.ts`
- Identify cycles and public compatibility requirements

### Phase 2 — Extract domain contracts

- Move types without changing runtime code
- Update internal imports to narrow modules

### Phase 3 — Split public and internal exports

- Update `index.ts` and `internal.ts`
- Add API surface snapshot tests

### Phase 4 — Remove the hub

- Delete internal imports from `store.ts`
- Remove compatibility re-export when no supported public import depends on it

## STOP conditions

- Do not create new broad barrel files that reproduce the same problem.
- Do not move runtime classes solely to match type folders.
- Do not expose internal model classes while preserving old imports.
- Do not combine this plan with behavioral refactors.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add package-export and forbidden-import tests. Generated declaration output must contain no accidental internal renderer or model exports.
