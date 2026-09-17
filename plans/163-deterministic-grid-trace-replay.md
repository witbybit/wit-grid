# Plan 163: Add safe deterministic trace replay with polished controls

> **Executor instructions**: Start only after Plans 161 and 162 are DONE. Replay imported traces only in a new isolated headless runtime, never the live grid.
>
> **Drift check**: `git diff --stat a743eebe..HEAD -- packages/core/src/diagnostics packages/core/src/engine packages/core/src/api packages/core/src/internal packages/core/src/experimental.ts packages/react/src/devtools`

## Status

- **State**: DONE at `6fc0fcf4`
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/161-causal-grid-flight-recorder.md`, `plans/162-advanced-flight-recorder-devtools.md`
- **Category**: direction
- **Planned at**: commit `a743eebe`, 2026-07-28

## Why this matters

Replay turns a trace into a reproducible bug artifact: load a redacted trace, step through supported commands, compare semantic checkpoints, and stop at the first divergence. It is not undo/redo. Imported traces are untrusted and must never mutate the live grid or execute serialized functions.

## Current state

- Plan 161 provides ordered, versioned traces; Plan 162 provides the DevTools shell.
- `GridCommitKernel` has explicit outcomes, normalized invalidation order, rollback, and runtime-local change IDs.
- Runtime composition supports fresh headless instances through headless renderer ports.
- Follow persisted-state validation style, but keep an independent trace schema.

## Commands

| Gate        | Command                                                                                                    | Expected |
| ----------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| Replay      | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/diagnostics/GridTraceReplay.test.ts` | exit 0   |
| Adversarial | `corepack pnpm run test:adversarial`                                                                       | exit 0   |
| Core        | `corepack pnpm run verify:core`                                                                            | exit 0   |
| React       | `corepack pnpm --filter @eregister/open-grid-react test`                                                   | exit 0   |
| Build       | `corepack pnpm run build`                                                                                  | exit 0   |

## Scope

**In scope**: new trace schema validator/migrations, isolated replay engine/tests, narrow experimental factory/API, `packages/react/src/devtools/replay/`, hostile-input fuzzing, and small real redacted fixtures.

**Out of scope**: serialized/executed callbacks, renderers, getters, validators, or datasources; applying to an existing grid; network/cloud/collaboration; pixel-identical DOM replay; unknown future versions; undo/redo as replay engine.

## Git workflow

- Branch: `codex/163-deterministic-grid-trace-replay`
- Do not push/open a PR unless instructed.

## Required contract

Replay only an allowlist of declarative commands/checkpoints after schema validation and hard byte/event/string/depth limits. Unknown commands are reported, never silently ignored.

Statuses: `ready | running | paused | completed | diverged | invalid | unsupported | cancelled`.

Compare semantic facts: outcome/reason, exact cells, selected domain versions, normalized invalidation kinds, permitted formula results, faults/fallbacks, and stable hashes over an explicit redacted subset. Never compare timestamps, frame durations, DOM nodes, or runtime-generated IDs directly.

## Steps

### 1. Specify and validate replayable traces

Separate observations from replayable commands. Reject malformed/oversized/unknown-version data, prototype-pollution keys, executable/non-plain values, and missing initial fixtures. Migrate only known versions.

### 2. Build isolated headless replay

Create a fresh runtime from sanitized initial data and run commands sequentially through supported canonical/public APIs. Support play, pause, step, seek-by-restart, cancel, status/index, and destroy. Seeking rebuilds; it never relies on undo history.

### 3. Add checkpoints and first-divergence reports

Compare after each command and stop at first divergence by default. Report expected/actual, last match, unsupported facts, and related causal evidence.

### 4. Build beautiful replay controls

Add drop/open, validation summary, privacy warning, play/pause, forward/back step (back restarts/seeks), speed, scrubber, event list, expected-vs-actual, divergence callout, and “Why this cell?” link. Respect reduced motion and never autoplay imports.

### 5. Add deterministic fixtures and fuzz gates

Fixtures cover edit, batch/paste, formula dependency, conflict resolution, rejected validation, fault, and fallback. Run twice and compare semantic checkpoints. Fuzz schema parsing and supported command sequences.

**Verify each step** with focused tests; finish with all listed gates.

## Test plan

- Hostile/malformed schema tests and fuzzing.
- Two-fresh-runtime deterministic results and seek equivalence.
- First divergence for order, value, rejection, formula, and invalidation changes.
- Proof source/live grid receives no writes/events/subscriptions.
- Arbitrary IDs, Unicode/null characters, empty data, deleted rows, partial server evidence.
- UI accessibility and lifecycle states.

## Done criteria

- [ ] Only validated allowlisted declarative commands replay.
- [ ] Replay always owns a fresh headless runtime; live grid is unchanged.
- [ ] No imported function execution.
- [ ] Fixture runs yield identical semantic checkpoints; seek equals straight run.
- [ ] First divergence links to causal evidence.
- [ ] Accessible UI supports play/pause/step/seek/cancel without autoplay.
- [ ] All listed gates pass.

## STOP conditions

- Replay needs consumer functions/callbacks.
- A command cannot use an existing canonical mutation boundary.
- Determinism depends on time, RAF, network, or DOM identity.
- Live-grid isolation or resource limits cannot be proven.
- Server replay requires real network access; use captured declarative fixtures or report unsupported.

## Maintenance notes

Every new replayable command needs schema, validator, executor, checkpoint, redaction, fuzz, and UI support. Unsupported observations remain visible but never execute. Treat all trace files as hostile forever.
