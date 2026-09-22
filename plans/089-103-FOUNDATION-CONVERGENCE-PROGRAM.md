# Wit Grid Foundation Convergence Program — Plans 089–103

## Purpose

This program converts the successful Wit Grid POC into a coherent pre-release foundation. It is not a feature roadmap. It defines the destination, cuts scope, captures evidence before demolition, closes known correctness defects, converges ownership, and proves the resulting system before an internal foundation milestone.

## Required execution order

### Stage A — Define the destination and reduce scope

1. **Plan 089 — Wit Grid Core Architecture Target**
2. **Plan 090 — Feature Surface Triage and Quarantine**
3. **Plan 091 — Performance Baseline Laboratory and Regression Harness**

Plan 089 is the architecture constitution. Plan 090 decides what the foundation must preserve and what may be quarantined or deleted. Plan 091 captures the pre-convergence baseline before hot paths are rewritten. No large convergence refactor begins before these three plans are complete.

### Stage B — Close known correctness and lifecycle defects

4. **Plan 092 — Aggregation Input Mutation Correctness**
5. **Plan 093 — Single RAF Frame Arbitration**
6. **Plan 094 — Exclusive Runtime Port Binding**
7. **Plan 095 — Portal Flush Phase Contract**
8. **Plan 096 — Frame Epoch and Post-Scroll Durability**

These plans fix known defects that would otherwise contaminate or destabilize the convergence work. Plans 092, 093, and 094 may proceed in parallel after Plan 091. Plan 095 follows 093 and 094. Plan 096 follows 093 and 095.

### Stage C — Converge the core architecture

9. **Plan 097 — Canonical Domain Command and Mutation Boundary**
10. **Plan 098 — Render Runtime Convergence and Demolition**
11. **Plan 099 — Row Model and Derived Data Authority**
12. **Plan 100 — Physical Renderer and Adapter Contract**
13. **Plan 101 — Public API and Package Boundary Reset**

Each convergence plan must remove the mechanism it supersedes. A plan fails when a new owner is added beside an old owner, when migration flags remain, or when compatibility is preserved without an existing released-user requirement.

### Stage D — Prove and cut the foundation

14. **Plan 102 — Adversarial Correctness, Fuzzing, and Lifecycle Hardening**
15. **Plan 103 — Alpha Foundation Cut and Codebase Demolition**

Plan 102 attacks the resulting architecture through reference models, hostile sequences, async races, and lifecycle leak detection. Plan 103 is the final demolition and evidence gate for the internal `0.1.0-foundation` milestone.

## Global operating rules

- Freeze net-new feature development until Plan 103 is complete, except work required by the real application to expose foundation defects.
- Prefer deletion over compatibility because no public release contract exists yet.
- Every implementation PR must state the authoritative owner after the change and list the old paths removed.
- No performance claim is accepted without a comparable result from Plan 091.
- No correctness claim is accepted solely through source-string architecture tests.
- Foundation and reference features are protected; incubating and deferred features may not distort core contracts.
- A feature flag is not a valid permanent migration strategy.
- Each plan must leave the codebase conceptually smaller or make a clearly measured capability authoritative.

## Completion standard for every plan

A plan is complete only when:

1. the target owner is authoritative in production code;
2. superseded paths are deleted;
3. runtime behavior is covered by integration tests;
4. relevant benchmark scenarios are recorded;
5. architecture guards prevent reintroduction of the removed path;
6. the real application still works through supported APIs;
7. unresolved exceptions are documented as blockers rather than silently deferred.

## Desired next conversation

After Plan 103, the next review should focus on release hardening, accessibility, browser coverage, API ergonomics, documentation, packaging, and the first supported feature matrix—not on competing schedulers, duplicated state ownership, renderer identity ambiguity, or architectural rescue.
