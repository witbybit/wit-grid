# Plan 073: Incremental Active Slot Index

> **Why this is separate from the slot rewrite**: The renderer now preserves physical row slots incrementally, but `activeRows` is still cleared and rebuilt by scanning every slot after viewport recycling. That duplicated rebuild is small today, yet it violates the slot architecture’s ownership model and makes later slot metadata work harder than necessary.

## Status

- **Priority**: P2 — localized hot-path cleanup
- **Effort**: S
- **Risk**: LOW — narrow renderer data-structure change
- **Depends on**: Plans 065–067
- **Category**: rendering, virtualization, performance
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

After slot assignment, `RowRenderer` clears `activeRows` and scans the complete slot pool to reconstruct the map from visual index to slot. The assignment process already knows which rows stayed, exited, and entered, so rebuilding the map is redundant.

This also creates two representations whose consistency is restored by a full scan rather than maintained by ownership operations.

## What to add

### 1. Active-slot index abstraction

```ts
class ActiveSlotIndex {
	bind(visualIndex: number, slot: RowSlot): void;
	unbind(visualIndex: number, slot: RowSlot): void;
	move(from: number, to: number, slot: RowSlot): void;
	get(visualIndex: number): RowSlot | undefined;
	clear(): void;
}
```

### 2. Update during assignment

- stayed rows retain existing entries
- exited rows are unbound before slot reuse
- entered rows are bound after slot identity/generation update
- clear only on renderer reset/destroy

### 3. Development invariant checks

In tests/dev builds, optionally scan the pool after assignment and assert it matches the incremental index. Production must not perform the scan.

## Phases

### Phase 1 — Add abstraction and parity tests

- Wrap existing map access
- Preserve current rebuild behavior temporarily

### Phase 2 — Incremental maintenance

- Update index inside slot assignment/rebind operations
- Remove per-recycle clear-and-scan

### Phase 3 — Add randomized invariant tests

- Simulate scroll forward/backward, large jumps, row-count shrink, and slot-pool resize
- Compare against a reference reconstruction

## STOP conditions

- Do not merge slot ownership into a generic renderer registry.
- Do not remove invariant validation before randomized tests exist.
- Do not optimize map implementation before measurements require it.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
```

Runtime performance tests must show zero full active-slot scans during ordinary viewport recycling.
