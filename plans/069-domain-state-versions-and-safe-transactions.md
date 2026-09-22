# Plan 069: Domain State Versions and Exception-Safe Transactions

> **Why this follows incremental rows**: The renderer already relies on geometry, row-model, column, and row versions, while `StateManager` still shallow-clones one broad state object for every update and repeatedly merges objects inside transactions. Formal domain versions let internal consumers stop treating the monolithic snapshot as the primary runtime model.

## Status

- **Priority**: P1 — allocation control and state ownership
- **Effort**: L
- **Risk**: MEDIUM-HIGH — broad state plumbing change
- **Depends on**: Plan 068
- **Category**: state, architecture, performance
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

`StateManager` shallow-clones top-level state on each update. During a transaction it repeatedly spreads both accumulated updates and current state. Notification also allocates changed-key sets and arrays.

At the same time, internal subsystems increasingly use domain models and version counters. The architecture is split between a monolithic immutable-style snapshot and mutable internal models without an explicit contract between them.

Transactions also rely on paired `startTransaction()` / `endTransaction()` calls. An exception can leave batching active indefinitely.

## What to add

### 1. Formal domain version record

```ts
export interface GridDomainVersions {
	columns: number;
	rows: number;
	geometry: number;
	viewport: number;
	selection: number;
	editing: number;
	styling: number;
	filters: number;
	sorting: number;
}
```

Each domain owner increments its version exactly once per committed logical mutation.

### 2. Single-commit transaction API

```ts
transaction<T>(work: () => T): T {
  this.beginTransaction();
  try {
    return work();
  } finally {
    this.endTransaction();
  }
}
```

Nested transactions are supported through depth tracking and commit once at the outer boundary.

### 3. Accumulate patches without repeated spreads

Within a transaction, mutate an internal patch record or map. Materialize the public snapshot once at commit.

### 4. Domain subscriptions

Internal renderer and controller subscriptions should prefer domain versions or specific model events. Public state-key subscriptions remain supported at the API boundary.

### 5. Immutable public snapshots

`getState()` continues to return a stable public snapshot. Internal models are not exposed and public callers cannot mutate runtime state by retaining references.

## Phases

### Phase 1 — Safe transaction wrapper

- Add `transaction(work)` with `try/finally`
- Migrate all paired transaction call sites
- Add nested and thrown-error tests

### Phase 2 — Domain versions

- Add version registry
- Define ownership and increment rules
- Replace duplicated ad hoc versions where equivalent

### Phase 3 — One snapshot materialization per transaction

- Replace repeated object spreads in batched updates
- Compute changed public keys at commit
- Notify listeners once

### Phase 4 — Migrate internal consumers

- Move renderer/controller subscriptions from broad state snapshots to domain versions or model events
- Retain public compatibility in `GridApi`

## STOP conditions

- Do not expose mutable domain models publicly.
- Do not replace the state manager with an external state library.
- Do not increment versions during reads or speculative work.
- Do not remove public key subscriptions until React and external API consumers have replacements.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Tests must prove exception-safe transaction cleanup, one notification per outer transaction, stable domain version semantics, and immutable public snapshots.
