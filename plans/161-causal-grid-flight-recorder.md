# Plan 161: Build a bounded causal grid flight recorder

> **Executor instructions**: Follow every step and verification gate. Stop rather than improvise when a STOP condition occurs. Update this plan's row in `plans/README.md` when complete unless a reviewer owns the index.
>
> **Drift check**: `git diff --stat a743eebe..HEAD -- packages/core/src/diagnostics packages/core/src/engine/GridChangeApplier.ts packages/core/src/renderer packages/core/src/api packages/core/src/internal packages/core/src/experimental.ts packages/core/src/perf`

## Status

- **State**: DONE at `8c54cb59117ac2d97806be0da252bbc72c3e8de9`
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `a743eebe`, 2026-07-28

## Why this matters

Open Grid assigns mutation change IDs, publishes precise cell changes, records bounded frame telemetry, and retains structured faults. These facts are disconnected, so users cannot answer “why did this cell change?” or correlate an expensive frame with its cause. Build one opt-in, bounded, redaction-safe causal recorder for the DevTools and replay plans. It observes existing paths; it must not become another event bus, history stack, mutation protocol, or scheduler.

## Current state

- `packages/core/src/engine/GridChangeApplier.ts:198-356`: canonical commit kernel; ordering is domains → normalized invalidations → cell publication → history → render request → events.
- `packages/core/src/diagnostics/GridInstrumentation.ts:36-175`: frame/fallback snapshots plus fixed-capacity recording and production no-op implementations.
- `packages/core/src/diagnostics/RuntimeFaultReporter.ts:55-96`: structured, bounded faults.
- `packages/core/src/api/GridApiSurfaces.ts:182-204`: immutable snapshots, granular subscriptions, faults, and instrumentation.
- `packages/core/src/calculations/dagEngine.ts:7-49`: formula dependency indexes. Query them through a narrow port; the recorder must not import formula internals.
- Experimental exports belong in `packages/core/src/experimental.ts`, not the stable entry.

Match `RecordingGridInstrumentation` fixed-capacity behavior and immutable snapshots. Preserve physical row/column identity exactly; never derive IDs by string convention.

## Commands

| Gate         | Command                                                                                                                                                                                        | Expected |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Focused      | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/diagnostics/GridFlightRecorder.test.ts src/engine/GridChangeApplier.test.ts src/diagnostics/GridInstrumentation.test.ts` | exit 0   |
| Budgets      | `corepack pnpm run bench`                                                                                                                                                                      | exit 0   |
| Long session | `corepack pnpm run bench:long-session`                                                                                                                                                         | exit 0   |
| Architecture | `corepack pnpm run test:architecture`                                                                                                                                                          | exit 0   |
| Core         | `corepack pnpm run verify:core`                                                                                                                                                                | exit 0   |
| Build        | `corepack pnpm run build:packages`                                                                                                                                                             | exit 0   |

## Scope

**In scope**: new `diagnostics/GridCausalTrace.ts`, `diagnostics/GridFlightRecorder.ts` and tests; optional correlation hooks in commit, frame/fallback/fault, formula/integrity query ports; experimental API/runtime composition; instrumentation budgets and architecture guards.

**Out of scope**: React UI; replay; browser extension/network/persistence/analytics; whole-row/full-state event snapshots; replacing instrumentation, faults, history, or events; stable exports.

## Git workflow

- Branch: `codex/161-causal-grid-flight-recorder`
- Small imperative commits. Do not push or open a PR unless instructed.

## Required contract

Use a versioned JSON-safe envelope with monotonic sequence order:

```ts
interface GridTraceEnvelope {
	readonly v: 1;
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp: number; // diagnostic, never ordering authority
	readonly event: GridTraceEvent;
}
```

Discriminated events cover interaction, commit request/outcome, normalized invalidation, precise cell change, completed frame, fallback, and fault. Correlation fields may include `interactionId`, `changeId`, `frameEpoch`, exact cell coordinate, commit reason, domains, and outcome. Never retain functions, DOM nodes, `Error` objects, row nodes, or mutable references.

Options include fixed `capacity`, `captureValues: 'none' | 'metadata' | 'full'` (default `none`), and `redactValue(value, context)` called before storage. Metadata may contain type/null/length categories only. Recording is disabled by default.

## Steps

### 1. Define causal types and honest explanation states

Create immutable trace/snapshot types and `GridCellExplanation`. Facts must distinguish `known`, `unknown`, and `not-applicable`; unloaded server data and opaque custom getters/renderers are not completely explained.

**Verify**: serialization/type tests pass.

### 2. Implement the bounded recorder

Use a preallocated ring buffer with start/stop, clear, snapshot, dropped count, and `explainCell`. Disabled methods return stable empty results and allocate nothing per event. Test capacity zero, wraparound, sequence order, start/stop, clearing, redaction-before-storage, thrown redactor isolation, and detached snapshots.

**Verify**: recorder tests pass.

### 3. Correlate canonical boundaries

Add one optional recorder port to runtime composition. Record commit request/outcome, normalized invalidations, exact committed cells, frames, fallbacks, and faults without changing canonical order. Branch before creating payloads when disabled. Guards must prevent recorder imports from domain models and duplicate recorder ownership.

**Verify**: recorder, commit, frame, fault, and architecture tests pass.

### 4. Expose experimental APIs

Expose `startFlightRecorder`, `stopFlightRecorder`, `getFlightRecorderSnapshot`, `explainCell`, and `clearFlightRecorder` through experimental surfaces. Sessions are instance-local and destroyed with the grid. Stable export snapshot must not change.

**Verify**: core boundary tests and package build pass.

### 5. Lock down overhead and privacy

Prove disabled mode records zero events and does not increase allocation/counter budgets. Prove enabled memory is capacity-bounded with accurate drop counts. Wall-clock data may be informational, not the sole correctness gate.

**Verify**: budget and long-session gates pass.

## Test plan

- Accepted/rejected edits, batch mutation, formula-dependent invalidation, runtime fault, fallback, and completed frame.
- Exact cell filtering with arbitrary IDs containing `:`, null characters, and Unicode.
- Default trace JSON contains no raw values; redaction happens before retention.
- Destroy clears references and prevents recording.

## Done criteria

- [x] Opt-in, instance-local, bounded, versioned recorder.
- [x] No raw values by default.
- [x] Rejected edit-validation attempts are retained honestly without fabricating a committed change.
- [x] Completed frame events retain real active-only duration for the downstream slow-frame workspace.
- [x] `explainCell()` correlates known commit/cell/invalidation/frame/fallback/fault facts.
- [x] Disabled hot paths create no trace payloads.
- [x] Stable export unchanged; experimental export available.
- [x] All listed gates pass; only scoped files plus plan status changed.

## Completion evidence

- Candidate commit: `056be150f7907e0b52d4ba6970330eac69fb4bbe` on `codex/161-causal-grid-flight-recorder`.
- Focused causal/scheduler suite: 91/91 tests passed; final targeted review suite: 407/407.
- `bench`: 11/11; `bench:long-session`: core 6/6 and React 8/8.
- `verify:core`: 120 files / 1,965 core tests, architecture and adversarial suites, API check, and package verification passed.
- `build:packages` passed. Test typecheck remained at the repository baseline `444` / `d66dd57...`.
- Stable and internal declaration hashes remained unchanged; the reviewed API-contract delta contains only the new experimental recorder surface.

### Reopened finding

The real Plan 162 demo proved that blocking `EditingFeatureController` proposal validation returns before `GridCommitKernel`, so the recorder retains no request or rejection outcome for that edit. This contradicts this plan's rejected-edit test requirement. Correct the canonical pre-commit boundary, test both editing and clipboard proposal validation, rerun every gate, and issue a new reviewed foundation commit before resuming Plan 162.

Corrected by `486f56c8ed813e018c281667cd5afee73d26d5bf`: attempt IDs now have one recorder owner, edit and clipboard proposal rejection retain request/outcome pairs before `writeBlocked`, ambiguous multi-cell coordinates remain omitted, and adversarial exact-identity coverage includes null, colon, and Unicode IDs. Focused 317/317, full core 1,967 tests, architecture, adversarial, API, package verification, benchmarks, long-session, and package builds passed.

The Plan 162 performance-workspace audit then found that retained frame events omit `durationMs`, despite the underlying product contract requiring slow-frame analysis. Add a backward-compatible optional real duration measured only while recording is active; never fabricate unavailable row/cell/topology counters or add disabled-path clock work.

Corrected by `8c54cb59117ac2d97806be0da252bbc72c3e8de9`: frame events retain optional real flush duration with active-only clock work, deterministic timing tests, nested/session-safe cause context, and render-error preservation. Capacity is also normalized and capped at 100,000. Focused 93/93, architecture, adversarial, API, pack, benchmarks, combined long-session, and package builds passed; the dedicated long-session test remained green despite its known contention-only full-suite timeout.

## STOP conditions

- Correlation requires altering commit order or adding an event bus.
- Correctness requires retaining whole rows/full state per event.
- Disabled mode cannot branch before hot-path allocation.
- Replay requirements start reshaping the live mutation protocol.
- Stable exports must change, or a gate fails twice.

## Maintenance notes

Every new mutation, formula provider, row model, or renderer fallback must decide whether it contributes causal metadata. Schema evolution must be backward compatible or versioned. Review privacy, boundedness, exact physical identity, disabled allocations, and accidental user-object retention.
