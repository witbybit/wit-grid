# Plan 084: Domain State Versions and Targeted Notification

> **Why this is still necessary**: Transaction safety landed, but internal state updates still revolve around shallow-cloning one top-level `GridState` and notifying from broad key changes. Renderer and row-model code already rely on domain-specific versions in several places. This plan completes that direction so internal consumers stop treating the monolithic snapshot as the primary coordination mechanism.

## Status

- **Priority**: P1 — state scalability and architecture
- **Effort**: L
- **Risk**: HIGH — state ownership and subscriptions
- **Depends on**: Plan 083
- **Category**: state, architecture, performance
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

`StateManager` still commonly performs:

```ts
this.state = { ...this.state, ...nextState };
```

Internal subsystems then observe broad snapshot/key changes even when a dedicated domain model already owns the real data. This produces:

- top-level allocation on every update
- duplicate state between snapshots and models
- broad notification paths
- unclear version ownership
- difficulty proving which render work a mutation requires

## What to add

### 1. Domain version registry

```ts
interface GridDomainVersions {
	columns: number;
	rows: number;
	viewport: number;
	selection: number;
	editing: number;
	filtering: number;
	sorting: number;
	styling: number;
	pagination: number;
}
```

Each owning model advances its version when its observable output changes.

### 2. Targeted domain subscriptions

```ts
subscribeDomain(
  domain: keyof GridDomainVersions,
  listener: (version: number) => void
): Unsubscribe;
```

Internal consumers subscribe to domains or dedicated model events, not broad state snapshots.

### 3. Snapshot boundary

Keep `getState()` for public API/debugging compatibility, but build or cache the immutable snapshot at the boundary. Do not require every internal mutation to replace the entire snapshot first.

### 4. Transaction commit model

Transactions collect dirty domains and commit each version once. Notifications fire after all domain models are internally consistent.

### 5. Compatibility migration

Migrate consumers in stages and delete duplicate fields only after ownership is explicit.

## Phases

### Phase 1 — Version registry

- Add domain versions
- Add transaction-aware dirty-domain collection

### Phase 2 — Migrate hot consumers

- renderer invalidation
- viewport
- selection
- editing
- rows and columns

### Phase 3 — Snapshot boundary

- Cache public state snapshot by domain versions
- Remove unconditional top-level cloning from hot paths

### Phase 4 — Delete duplicate ownership

- Document model owner for every persisted/public field
- Remove legacy mirrored state where safe

## STOP conditions

- Do not introduce an external immutable-state dependency.
- Do not expose mutable internal models through `GridApi`.
- Do not maintain both domain versions and broad cloned state indefinitely.
- Do not notify consumers before a transaction has reached a consistent commit point.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests for one version increment per committed transaction, targeted subscription isolation, cached snapshot identity, exception-safe transactions, and no renderer notification for unrelated domain changes.
