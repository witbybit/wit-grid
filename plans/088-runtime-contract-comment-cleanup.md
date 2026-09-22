# Plan 088: Runtime Contract Comment Cleanup

> **Why this is last**: The architecture should be cleaned only after the new lifecycle, portal, row-model, state, instrumentation, and boundary contracts are stable. Production comments still contain roadmap chronology such as `Plan 041`, `Phase 7`, and migration history. Those comments age badly and obscure the invariants future maintainers actually need.

## Status

- **Priority**: P3 — maintainability and documentation quality
- **Effort**: S
- **Risk**: LOW — documentation and naming cleanup
- **Depends on**: Plan 087
- **Category**: documentation, cleanup, architecture
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

Production source contains comments that explain when or in which roadmap phase code was introduced:

- `Plan 041`
- `Plan 060`
- `Phase 068`
- `Phase 7`
- descriptions of replaced implementations

These references are useful during migration but become misleading after plans are completed. They do not define enforceable behavior.

## What to add

### 1. Comment standard

Production comments should explain one of:

- invariant
- ownership
- lifecycle ordering
- performance constraint
- safety condition
- non-obvious compatibility requirement

They should not describe roadmap chronology.

### 2. Replace history with contracts

Before:

```ts
// Phase 7: delegate warm DOM move budget...
```

After:

```ts
// Warm renderer moves are budgeted per frame so scroll work cannot monopolize the main thread.
```

### 3. Architecture contract documents

For complex subsystems, maintain concise documents covering:

- render phases and queues
- slot and portal ownership
- row mutation strategy
- state/domain ownership
- runtime port lifecycle

### 4. Source guard

Add a lightweight check preventing new `Plan NNN` or `Phase N` references in production source. Permit them in `/plans`, changelogs, and migration documents.

### 5. Remove dead compatibility comments

Delete comments describing code paths that no longer exist.

## Phases

### Phase 1 — Inventory

Search core and React production source for roadmap and migration-history comments.

### Phase 2 — Rewrite

Replace useful history with invariant-focused comments. Delete comments with no remaining value.

### Phase 3 — Consolidate architecture docs

Create or update subsystem contract documents and link to them only where necessary.

### Phase 4 — Guardrail

Add a source check preventing roadmap chronology from returning to production files.

## STOP conditions

- Do not remove comments that document real invariants or browser workarounds.
- Do not replace every deleted comment with longer prose.
- Do not move stale implementation history into source-level JSDoc.
- Do not enforce the guard against plan files, changelogs, or migration notes.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Verify production source contains no roadmap chronology, architecture documents describe the final contracts, and the source guard permits legitimate plan and migration documentation.
