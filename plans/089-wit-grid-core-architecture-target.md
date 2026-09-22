# Plan 089: Wit Grid Core Architecture Target

> This is a **convergence plan**, not an additive feature plan. It is complete only when the target owner is authoritative, superseded mechanisms are deleted, architecture guards prevent regression, and behavioral/performance evidence passes. Merely adding the proposed abstraction beside existing paths is a failed implementation.

## Mission

Define the architecture that all future code must converge toward. Establish one canonical mutation path, one render path, explicit domain ownership, renderer identity rules, package boundaries, feature maturity levels, and release gates.

## Why this changes the project

The codebase has been improved through many local plans, but local correctness does not guarantee global simplicity. Without a governing target, Claude or Codex can continue adding valid-looking coordinators, controllers, compatibility layers, and caches while increasing the number of ways work can happen. This plan makes architectural convergence testable.

## Status

- **Priority**: P0 — governing architecture
- **Effort**: M
- **Risk**: LOW — documentation plus enforceable boundaries
- **Depends on**: nothing
- **Category**: architecture, governance, convergence
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Current state to replace

Architecture is currently documented across source comments, plan files, tests, and inferred class responsibilities. Several concepts have improved, but there is no single normative document that decides which layer owns mutation, scheduling, derived rows, physical rendering, framework adaptation, and public API behavior.

## Target end state

Create `docs/architecture/core-target.md` as the normative architecture constitution. Every production subsystem must fit one of these roles: API/command boundary, domain model, derived model, invalidation, frame coordination, physical renderer, renderer adapter, diagnostics, or host integration. The document must include legal dependency directions and the only permitted end-to-end execution flows.

## Non-negotiable invariants

- Every mutable concept has one named owner.
- Every render enters through invalidation and the frame coordinator.
- Every public operation enters through `GridApi` or an explicitly internal command boundary.
- React remains an adapter and never becomes state or rendering authority.
- Physical slot identity never leaks into consumer APIs.
- No future plan may contradict the constitution without an explicit architecture-decision amendment.

## Mandatory demolition

The implementation is not complete until these are removed or reduced to an explicitly documented compatibility shell:

- Architecture decisions duplicated in roadmap comments or contradictory source comments.
- Unowned responsibilities described only by convention.
- Any compatibility API that exposes `GridStore`, internal models, scheduler details, or physical renderer identity.
- Architecture tests that merely look for plan names instead of enforcing dependency rules.

## Execution workstreams

### Workstream 1 — Write the architecture constitution

- Document the canonical command-to-render flow and raw-row-to-viewport flow.
- Define exact owners for rows, columns, geometry, selection, focus, editing, configuration, persistence, diagnostics, and host binding.
- Define logical versus physical identity and lifecycle boundaries.
- Define legal dependency arrows between packages and layers.

### Workstream 2 — Encode the constitution

- Add dependency-graph architecture tests for illegal imports and back-references.
- Add a responsibility registry mapping major production classes to one architectural role.
- Add a PR checklist requiring owner, invalidation, lifecycle, deletion, and benchmark analysis for core changes.

### Workstream 3 — Classify features

- Mark each feature as foundation, reference, incubating, or deferred.
- Foundation and reference features must have stable internal contracts; incubating features may break; deferred features receive no architectural expansion.
- Document which feature combinations are required before the first alpha.

## Forbidden end state

- A diagram that describes aspirations but is not reflected in tests.
- A responsibility table where one class appears as owner of unrelated domains.
- Architecture rules that allow exceptions without named expiry/removal plans.
- Keeping all current classes and simply categorizing them.

## Verification program

- Run dependency tests over every production TypeScript module.
- Add a test that fails for direct React imports in core.
- Add a test that fails for renderer imports from domain models.
- Add a test that fails for browser scheduling outside the scheduler/frame boundary.
- Review every exported package symbol against the target document.

## Evidence required in the PR

- Before/after architecture diagram showing ownership changes.
- List of deleted files, methods, paths, and compatibility aliases.
- Behavioral test output and benchmark output.
- Explanation of any target invariant not achieved; unresolved items block completion.

## Completion gate

- `docs/architecture/core-target.md` is committed and referenced from the repository root.
- All major production classes have exactly one declared role.
- Illegal dependency directions are executable test failures.
- The remaining convergence plans reference this document instead of inventing local architecture.
- There are no undocumented exceptions.

## STOP conditions

- Stop if the implementation introduces a second owner for the same responsibility.
- Stop if old and new paths are selected through a long-lived feature flag.
- Stop if tests prove only source-string presence rather than runtime behavior.
- Stop if performance claims are made without recorded benchmark evidence.
- Stop if public compatibility is preserved at the cost of keeping an invalid pre-release architecture.
