# Plan 116: Persistence Commit Restore and Schema Hardening

## Mission

Make persisted state fully versioned, validated, fault-reported, and restored only through the commit kernel.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH - restore semantics affect startup correctness and user data
- **Depends on**: Plans 113-115
- **Category**: persistence, schema, restore, batching
- **State**: DONE on 2026-06-19

## Problem

Persistence contracts were improved earlier, but still needed final closure:

- schema version had to become mandatory
- restore had to use one explicit commit/commit-batch path instead of a startup-only hydration shortcut
- malformed or unsupported payloads needed runtime-fault reporting instead of soft console warnings
- restore needed to suppress intermediate autosave/history/render churn

## Target end state

Persisted state remains separate from runtime/public state:

```text
InternalGridState
GridStateSnapshot
PersistedGridState
```

Mandatory versioned persisted contract:

```ts
interface PersistedGridState {
	v: number;
	state: SerializedGridState;
}
```

Restore through the existing public restore entrypoint:

```ts
api.applyGridState(...)
```

## Outcome

Plan 116 is implemented.

Delivered:

- `PersistedGridState` is now a mandatory versioned envelope: `{ v, state }`
- persisted payloads are strictly validated before any restore work begins
- missing-version, malformed, and runtime-only persisted fields are rejected
- restore flows through `applyGridState(...)` and the existing commit/batch path instead of a startup-only state merge shortcut
- persistence-triggered autosave is suspended while restore runs, preventing immediate re-save churn during startup hydration
- restore failures report runtime faults instead of relying on `console.warn` / `console.error`

## Non-negotiable invariants

- missing version is rejected
- unsupported version is rejected
- malformed payload is rejected
- restore validates the full blob before any commit
- restore produces one logical commit/render boundary
- restore does not directly hydrate live runtime state after startup

## Mandatory demolition

- optional persisted schema version
- `console.warn`-based persistence diagnostics
- direct runtime-state hydration during restore
- intermediate restore states visible to consumers

## Execution workstreams

### 1. Harden schema contract

Delivered:

- required `v`
- required `state`
- strict validation before application

### 2. Route restore through the kernel

Delivered:

- restore uses `applyGridState(...)`
- synchronous and async loads converge on the same restore path
- intermediate history suppression remains enforced
- intermediate autosave suppression is explicit
- batched rendering/notification boundary is preserved
- restore reports success/failure through one explicit result

### 3. Strengthen runtime fault reporting

Delivered:

- invalid blobs are rejected through runtime-fault reporting rather than console warnings

### 4. Normalize persisted/public/runtime separation

Delivered:

- persisted structures remain separate from public snapshot/runtime state contracts
- runtime-only fields are rejected from persisted payloads

## Verification

- unversioned persistence is rejected
- unsupported schema is rejected
- restore produces one logical commit/render boundary
- restore does not emit partial intermediate history/autosave
- persisted blobs cannot carry runtime-only fields

Verification completed:

- `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/persistence/statePersistence.test.ts src/store.test.ts src/boundary.test.ts`
- `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/engine/architectureGuards.test.ts`
- `corepack pnpm --filter @eregister/wit-grid-core build`

## Completion gate

- persisted state is mandatory-versioned and strictly validated
- restore enters through the commit kernel
- persistence contracts are fully separate from runtime and public snapshot contracts

## Notes

- The public restore entrypoint remains `api.applyGridState(...)`; the earlier `applyPersistedGridState(...)` name was a design sketch, not a required additional alias.
- Synchronous persistence load no longer hydrates startup state via `applyPersistedState(...)` in `createGrid.ts`; both sync and async loads now converge on the same restore path.
