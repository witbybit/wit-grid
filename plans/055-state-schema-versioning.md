# Plan 055: State Serialization Schema Versioning

> **Why this must land first**: Plans 059 (filter types) and 061 (React hooks) will change the shape of `FilterModel` and `ColumnState`. Any user who has persisted grid state in `localStorage` before those changes will silently load corrupt state after upgrading. This plan adds a version envelope to every serialized state blob so `applyGridState` can detect and reject (or migrate) incompatible schemas rather than blowing up silently.

## Status

- **Priority**: P0 — stability gate before filter/column model changes
- **Effort**: S
- **Risk**: LOW — purely additive; no runtime behavior change for fresh state
- **Depends on**: nothing
- **Category**: architecture, stability, persistence
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## Problem

`getGridState()` returns a plain object with no schema version. `applyGridState()` applies it unconditionally. When the `FilterModel` shape changes (Plan 059 adds set/date filter types with richer operator objects), any persisted state blob from before the change will be fed into the new filter pipeline and produce undefined behavior: wrong results, crashes, or silent data corruption.

AG Grid solves this with an explicit `columnStateVersion` field on their column state. We need the equivalent on our full state blob.

## What to add

### 1. Version envelope type

```ts
// packages/core/src/persistence/statePersistence.ts

export const GRID_STATE_SCHEMA_VERSION = 1;

export interface PersistedGridState {
	/** Schema version. Increment when any persisted field shape changes. */
	v: number;
	state: SerializedGridState;
}
```

### 2. `getGridState()` wraps output

```ts
getGridState(): PersistedGridState {
  return { v: GRID_STATE_SCHEMA_VERSION, state: this._serializeState() };
}
```

### 3. `applyGridState()` validates version

```ts
applyGridState(persisted: PersistedGridState | SerializedGridState): void {
  // Accept legacy unwrapped blobs (v=undefined) with a warning
  if (!('v' in persisted)) {
    this._reportRuntimeFault('applyGridState received unversioned state blob — ignoring');
    return;
  }
  if (persisted.v !== GRID_STATE_SCHEMA_VERSION) {
    this._reportRuntimeFault(
      `applyGridState: schema version mismatch (got ${persisted.v}, expected ${GRID_STATE_SCHEMA_VERSION}) — ignoring`
    );
    return;
  }
  this._applySerializedState(persisted.state);
}
```

### 4. Version bump protocol (documented in this file)

When any serialized field changes shape:

1. Increment `GRID_STATE_SCHEMA_VERSION`
2. Add a migration function `migrateV{N}toV{N+1}(old) → new` in `statePersistence.ts`
3. Call it in the version-dispatch chain in `applyGridState`
4. Update tests

For now (v=1) there is only one version, so the migration chain is empty. The infrastructure exists for Plan 059 to add a v2 migration.

### 5. `getColumnState()` / `applyColumnState()` same treatment

Column state is persisted independently. Wrap it with `{ v: number, columns: ColumnStateEntry[] }`.

## Phases

### Phase 1 — Envelope type + `getGridState` / `applyGridState`

- Add `GRID_STATE_SCHEMA_VERSION = 1` and `PersistedGridState` type to `statePersistence.ts`
- Upgrade `getGridState()` return type, `applyGridState()` parameter type
- Update `GridApi.ts` signatures
- Reject unversioned blobs with a runtime fault (not a throw — graceful degradation)

### Phase 2 — Column state envelope

- Add `PersistedColumnState` with same `v` field
- Upgrade `getColumnState()` / `applyColumnState()`

### Phase 3 — Tests

```ts
it('applyGridState rejects unversioned blob', () => { ... });
it('applyGridState rejects wrong version', () => { ... });
it('applyGridState accepts correct version', () => { ... });
it('round-trip: getGridState → applyGridState is identity', () => { ... });
```

### Phase 4 — `autoSave` path

The `autoSave` persistence path calls `getGridState()` internally. Verify it writes the versioned envelope. The restore path must validate the version before applying.

## STOP conditions

- Do not throw on version mismatch — report a runtime fault and no-op. A corrupt localStorage entry must not crash the grid on startup.
- Do not add runtime migration for v0→v1 in this plan. There are no existing users with persisted state that warrants backward compatibility tooling yet.
- Do not change the shape of any existing serialized fields in this plan — version is additive only.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

`statePersistence.test.ts` covers all 4 new test cases. No existing tests broken.
