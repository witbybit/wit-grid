# Plan 081: Portal Mount Identity and Generation Contract

> **Why this is P0**: Physical row slots can be rebound while their visible payload remains equal. The React portal store currently may treat a mount as unchanged without comparing `slotGeneration`, leaving stale generation state and allowing deferred or imperative work to target a new physical owner. Slot generation must be part of formal mount identity, not an optional comparison detail.

## Status

- **Priority**: P0 — stale renderer correctness
- **Effort**: M
- **Risk**: MEDIUM — portal lifecycle and identity changes
- **Depends on**: Plan 080
- **Category**: React adapter, portals, correctness
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

Portal ownership is represented through several parallel values:

- cell key
- row ID and column field
- container mapping
- physical row slot
- lane and lane index
- renderer key
- `slotGeneration`

The mount equality check compares visible payload but can omit `slotGeneration`. A physical slot may advance generation while value, node, column, focus, loading, and editing state remain equal. The portal store can then preserve stale ownership metadata.

## What to add

### 1. Formal physical mount identity

```ts
export interface CellMountIdentity {
	slotId: string;
	generation: number;
	lane: 'left' | 'center' | 'right';
	laneIndex: number;
}
```

Keep logical payload identity separate:

```ts
export interface CellPayloadIdentity {
	rowId: string;
	columnId: string;
}
```

### 2. Identity-aware equality

A portal mount is unchanged only when both physical identity and relevant payload are equal. Generation must always participate.

### 3. Generation capture for deferred work

Every deferred mount, release, imperative update, edit update, and warm-cache operation captures `CellMountIdentity`. Before execution it verifies the current physical owner still matches.

### 4. Single ownership token

Replace loose `slotGeneration` arguments and parallel key checks with one token passed through core portal management and the React adapter.

### 5. Host/container ownership cleanup

Container mappings must be released only by the mount identity that installed them. A stale release must not detach a newer portal mounted into the same container.

## Phases

### Phase 1 — Add identity type

- Define physical and logical identity contracts
- Include generation in mount equality immediately

### Phase 2 — Migrate deferred operations

- Portal mounts
- portal releases
- imperative renderer updates
- editor updates
- warm renderer reuse

### Phase 3 — Remove loose generation plumbing

- Replace optional numeric generation arguments
- Add assertions for missing identity

### Phase 4 — Race tests

Simulate rapid slot reuse with identical values and verify stale work cannot affect the new owner.

## STOP conditions

- Do not use row ID as physical slot identity.
- Do not allow generation to be optional for slot-backed portals.
- Do not fix only the equality check; all deferred ownership operations must use the same token.
- Do not remount every portal on ordinary value changes; preserve incremental payload updates when identity is stable.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add tests for identical payload with new generation, stale deferred mount, stale release, stale imperative update, container reuse, edit renderer reuse, and rapid scroll rebinding.
