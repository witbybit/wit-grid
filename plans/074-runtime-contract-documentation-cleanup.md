# Plan 074: Runtime Contract Documentation Cleanup

> **Why this still deserves a plan**: Source comments currently preserve migration history through labels such as `Phase 5`, `Phase 5+6`, and plan-number references. Those comments become misleading after the migration and obscure the invariants future maintainers actually need to preserve. Cleanup should happen only after the new runtime contracts land.

## Status

- **Priority**: P2 — maintainability and architecture hygiene
- **Effort**: S
- **Risk**: LOW — documentation and dead compatibility cleanup
- **Depends on**: Plans 065–073
- **Category**: documentation, cleanup, architecture
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

Several renderer comments explain project history or a migration phase rather than the current behavior. Plan identifiers and “old versus new” descriptions age quickly and make temporary implementation details look like permanent contracts.

At the same time, critical invariants such as slot ownership, phase transitions, portal release ordering, and allocation rules are spread across implementations rather than documented near their owning types.

## What to add

### 1. Invariant-focused comments

Document only enforceable contracts, for example:

- physical slot index is not visual row index
- a slot generation changes before new portal work is accepted
- scroll frames may not mount deferred portals
- invalidation is consumed once per paint frame
- transactions commit once at the outer boundary

### 2. Runtime architecture note

Add a short maintained document:

```text
docs/architecture/render-runtime.md
```

It should describe ownership and lifecycle, not roadmap history.

### 3. Remove migration archaeology

Delete comments containing completed phase numbers, old-plan references, and descriptions of removed implementations.

### 4. Remove dead compatibility code

While cleaning comments, delete only compatibility branches proven unreachable by tests and the completed plans. Behavioral changes require separate work.

## Phases

### Phase 1 — Comment inventory

- Search for `Phase`, `Plan 0`, `temporary`, `legacy`, and `TODO`
- Classify as invariant, active work, history, or dead code

### Phase 2 — Write runtime architecture note

- Document render phase ownership
- Document frame scheduling and invalidation
- Document slot and portal identity
- Document state/domain version ownership

### Phase 3 — Replace and delete

- Replace historical comments with concise invariants
- Delete obsolete comments and proven dead compatibility paths

### Phase 4 — Documentation verification

- Link code owners to the architecture note
- Ensure examples match current class and method names

## STOP conditions

- Do not preserve plan numbers in production source comments.
- Do not turn the architecture note into a chronological project diary.
- Do not delete compatibility behavior without tests proving it is unused.
- Do not describe aspirational behavior that the implementation does not enforce.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

A repository search should find no completed migration-phase comments in runtime source, and the architecture note must match the final ownership model.
