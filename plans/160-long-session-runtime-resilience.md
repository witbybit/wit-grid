# Plan 160: Prove the grid stays bounded through long sessions

> **Executor instructions**: Follow this plan phase by phase. Run every focused verification command before continuing. Treat every resource count and backlog limit as a correctness invariant, not a wall-clock benchmark. If a STOP condition occurs, stop and report it instead of widening scope. When all gates pass, update this plan and its row in `plans/README.md` to DONE.
>
> **Drift check (run first)**: `git diff --stat 8b74053a..HEAD -- packages/core/src/diagnostics/GridInstrumentation.ts packages/core/src/renderer packages/core/src/infiniteRowModel.ts packages/core/src/serverSideRowModel.ts packages/core/src/lifecycle.adversarial.test.ts packages/core/src/perf packages/react/src/gridPortalStore.ts packages/react/src/gridPortalStore.adversarial.test.ts packages/react/src/index.test.tsx package.json plans/README.md`
>
> The working tree already contains an unrelated user-owned `.claude/settings.local.json`. Preserve it and do not include it in this plan's changes.

## Status

- **Implementation**: DONE — verified in working tree on 2026-07-27 (`bench:long-session` twice, `bench`, `verify:core`, React suite, and workspace build)
- **Priority**: P0
- **Effort**: XL
- **Risk**: MED-HIGH
- **Depends on**: `plans/144-performance-guardrails-and-hot-scroll-budgets.md`, `plans/159-core-contract-and-performance-convergence.md`
- **Supersedes**: `plans/151-long-session-performance-memory-and-scheduler-resilience.md`
- **Unblocks**: reconciliation and execution of `plans/153-feather-scroll-snapshot-program.md`
- **Category**: perf, correctness, tests, diagnostics
- **Planned at**: commit `8b74053a`, 2026-07-27

## Why this matters

Open Grid now has strong per-operation and per-frame contracts, but most tests reset or destroy the grid after a short scenario. A grid can satisfy every short budget while still accumulating retained row nodes, portal listeners, warm renderers, queued work, frame histories, or async request state over thousands of interactions. This plan makes steady-state ownership and backlog observable, proves that resource counts plateau after warm-up, and fixes any concrete leak revealed by those tests before the snapshot-heavy renderer program begins.

The target is not "a soak test did not crash." The target is machine-checkable evidence that work per epoch stays bounded, live resources return to a defined baseline, and destroy is terminal across core and React.

## Current state

### Existing strengths to preserve

- `packages/core/src/perf/instrumentedBudgets.test.ts:1-10` explicitly uses instrumentation counts instead of timing. Follow this convention for CI gates.
- `packages/core/src/renderer/renderOrchestrator.ts:3-125` exposes accumulated renderer counters and live portal/controller/slot-related fields through `RenderStats`.
- `packages/core/src/renderer/portalMountManager.ts:633-660` exposes active portal counts, deferred work count, and chunk statistics.
- `packages/core/src/renderer/slotRuntimeStats.ts:7-39` defines live slot counts and per-scroll structural work.
- `packages/core/src/infiniteRowModel.ts:351-430` already has cache snapshots/count state, and `packages/core/src/serverSideRowModel.ts:981-1017` exposes store snapshots with block/loading/failure counts.
- `packages/core/src/renderer/frameCoordinator.ts:66-228` owns one pending scroll/paint/post-scroll arbiter and clears pending bits plus RAF ownership on destroy.
- `packages/react/src/gridPortalStore.ts:126-178` removes empty per-cell listener sets and dirty-gates snapshot reconstruction; `:354-362` clears maps/listeners on destroy.
- `packages/core/src/lifecycle.adversarial.test.ts:123-143` performs 50 controller cycles, while `:166-195` checks controller unsubscriber symmetry.
- `packages/core/src/renderer/runtimePerformance.test.ts` and `serverRuntimePerformance.test.ts` already contain wide-grid, million-row, portal-heavy, integrity-heavy, and bounded-scroll fixtures. Reuse their helpers where possible instead of inventing a parallel renderer harness.

### Gaps this plan must close

1. `RecordingGridInstrumentation` stores every frame and fallback in unbounded arrays at `packages/core/src/diagnostics/GridInstrumentation.ts:96-124`. Long-lived diagnostics/devtools use can retain an unlimited session history.
2. `RenderStats` contains many cumulative counters, but it does not provide one coherent live-ownership snapshot for pending frame work, deferred portal queues, warm renderer pools, active request controllers, or subscription ownership.
3. Existing performance tests usually assert one operation or a short burst. They do not compare warm-up, middle, and final epochs to prove a plateau.
4. Existing repeated lifecycle tests primarily assert "does not throw" and inspect one controller-private unsubscriber array; they do not cover a mounted renderer, custom portals, pending scheduler work, or all three row modes.
5. React portal adversarial tests validate physical identity and stale unmount behavior, but do not assert listener/map ownership returns to zero after hundreds of mount/update/unmount cycles.
6. Heap-size assertions in `packages/core/src/performance.test.ts` depend on optional browser memory APIs. They are useful diagnostics but are not a deterministic ownership proof.

## Architectural contract

Implement and enforce these invariants:

1. **Plateau, not merely a cap**: after warm-up, live resource gauges may oscillate within a documented viewport/cache-dependent band but must not trend upward with session length.
2. **One owner per queue**: RAF, microtask, idle work, portal hydration, warm moves, remote requests, and listener sets each have an observable owner and terminal cleanup path.
3. **Cumulative and live data stay distinct**: counters may increase; gauges represent current ownership. Tests must not infer a leak from a cumulative counter.
4. **No wall-clock CI thresholds**: CI asserts counts, ratios, queue depths, cache sizes, and completion within a deterministic fake scheduler. Real-browser timing/heap evidence is supplemental.
5. **Destroy returns to baseline**: after the scheduler is drained and the grid is destroyed, every owned live gauge is zero except explicitly shared immutable/no-op singletons.
6. **Production no-op remains cheap**: renderer production files must not import `RecordingGridInstrumentation`, allocate history arrays, or enable long-session recording by default.

## Commands you will need

| Purpose             | Command                                                                                                                         | Expected on success                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Core verification   | `corepack pnpm run verify:core`                                                                                                 | exit 0                                                                       |
| Performance budgets | `corepack pnpm run bench`                                                                                                       | all existing and new deterministic budget tests pass                         |
| Long-session suite  | `corepack pnpm run bench:long-session`                                                                                          | all long-session resource and backlog invariants pass                        |
| React focused tests | `corepack pnpm --filter @eregister/open-grid-react exec vitest run src/gridPortalStore.adversarial.test.tsx src/index.test.tsx` | exit 0; use the actual extension of the adversarial test if it remains `.ts` |
| Build               | `corepack pnpm run build`                                                                                                       | exit 0                                                                       |
| Format              | `corepack pnpm run format:check`                                                                                                | exit 0                                                                       |

Do not run package installation unless a required existing workspace dependency is missing. This plan should not require a new runtime dependency.

## Scope

### In scope

- `packages/core/src/diagnostics/GridInstrumentation.ts`
- `packages/core/src/diagnostics/GridInstrumentation.test.ts`
- `packages/core/src/renderer/renderOrchestrator.ts`
- `packages/core/src/renderer/renderTelemetry.ts`
- `packages/core/src/renderer/frameCoordinator.ts` and focused tests, only if live pending-state observability or a proven fairness defect requires it
- `packages/core/src/renderer/portalMountManager.ts`
- `packages/core/src/renderer/customRendererManager.ts`
- `packages/core/src/renderer/slotRuntimeStats.ts`
- `packages/core/src/renderer/renderEngine.ts`, only for composing an internal/live resilience snapshot
- `packages/core/src/infiniteRowModel.ts`
- `packages/core/src/serverSideRowModel.ts`
- `packages/core/src/perf/instrumentedBudgets.test.ts`
- Create `packages/core/src/perf/longSessionResilience.test.ts`
- Existing focused renderer tests/harnesses needed to reuse mounted-grid fixtures
- `packages/core/src/lifecycle.adversarial.test.ts`
- `packages/react/src/gridPortalStore.ts`
- `packages/react/src/gridPortalStore.adversarial.test.ts`
- `packages/react/src/index.test.tsx`
- `package.json` for `bench:long-session`
- `docs/architecture/benchmark-scenarios.json` and `docs/architecture/baseline.json` only if their schemas already support a deterministic long-session scenario; otherwise add a focused `docs/architecture/long-session-resilience.md`
- `plans/README.md` and this plan for final status

If a test proves a leak in one of the named owners, its smallest owning implementation file is also in scope. Record that addition in this plan before changing it.

### Out of scope

- The snapshot-authority or impostor architecture proposed by Plan 153
- A public DevTools UI or general plugin API (Plan 122/152 territory)
- New grid features, renderer modes, row-model semantics, or public data APIs
- Wall-clock performance tuning without a failed deterministic work/resource invariant
- Browser automation framework adoption
- Making `RecordingGridInstrumentation` the production default
- Broad renderer decomposition or cosmetic refactors
- Fixing the existing characterized test-typecheck backlog unless a touched test adds a new diagnostic

## Git workflow

- Branch: `codex/160-long-session-runtime-resilience`
- Use one commit per phase or proven leak class.
- Match the repository's imperative commit style, for example `Bound long-session instrumentation history`.
- Do not push or open a pull request unless explicitly instructed.

## Phase 1: Define a live resilience snapshot

Create one internal/test-facing snapshot vocabulary that distinguishes cumulative counters from current ownership. Prefer composing existing owners rather than duplicating their state.

The snapshot must cover, when the corresponding subsystem exists:

- row and cell slot counts;
- active cell/row/menu portals;
- deferred portal mounts/releases/rows and pending warm renderer moves;
- active and warm custom renderer counts;
- pending scheduler bits and whether a RAF/frame is owned;
- row/cell controller live counts;
- infinite cache blocks, pending block loads, active abort controllers, and queued requests;
- SSRM root/child store count, total block count, loading/queued request count, and active request count;
- React portal, row portal, menu portal, per-cell listener-key, structural listener, row/menu listener, and imperative updater counts.

Rules:

- Reuse `getRenderStats()`, `PortalMountManager.getStats()`, `getDeferredCount()`, custom-renderer stats, infinite block snapshots, and SSRM store snapshots where they already provide the value.
- Add narrow `getLongSessionSnapshot()` / `getOwnershipSnapshot()` methods only to the owning internal components that lack a gauge. Do not let tests reach into private Maps using `as any` as the permanent solution.
- If adding optional fields to public `RenderStats`, classify them as diagnostics-only, update the checked API report intentionally, and keep zero-value headless behavior in `createEmptyRenderStats()`.
- React portal ownership gauges should extend the existing `getDebugStats()` result; they must not expose portal contents or mutable Maps.
- Snapshot reads must be allocation-bounded and side-effect free. Merely polling diagnostics must not increment topology/lifecycle counters.

**Verify**: focused owner tests demonstrate accurate non-zero values, zero after cleanup, stable repeated reads, and no mutations caused by snapshot collection.

## Phase 2: Bound diagnostic history itself

Change `RecordingGridInstrumentation` so frames and fallbacks cannot grow forever.

Required behavior:

- Constructor options define `frameCapacity` and `fallbackCapacity`; choose finite documented defaults appropriate for tests/devtools.
- Use a bounded ring buffer or equivalent O(capacity) storage. Do not call `Array.shift()` on every event.
- Snapshot order remains oldest-to-newest for retained entries.
- Counters remain monotonic until `reset()`.
- Snapshot exposes dropped-frame and dropped-fallback counts, or equivalent evidence that truncation occurred.
- `reset()` clears counters, buffers, indexes, and dropped counts.
- `NoopGridInstrumentation.snapshot()` remains a stable allocation-free empty object.
- Existing callers using `new RecordingGridInstrumentation()` continue to work.

Tests must cover zero/one capacity policy, wraparound ordering, dropped counts, reset after wraparound, and at least 100,000 recorded frames with retained storage equal to capacity.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/diagnostics/GridInstrumentation.test.ts` passes, and the architecture guard still proves renderer production files do not import the recording implementation.

## Phase 3: Build the deterministic long-session harness

Create `packages/core/src/perf/longSessionResilience.test.ts`. The harness must use:

- a seeded pseudo-random generator already patterned by the adversarial suites;
- a deterministic fake `GridScheduler` with explicit microtask, RAF, and idle queues;
- warm-up, middle, and final sampling epochs;
- helper assertions for `boundedPeak`, `returnsToBaseline`, and `noPositiveSlopeAcrossEpochs` using integer resource counts;
- cleanup in `finally` so a failed assertion does not contaminate later scenarios.

Do not use `setTimeout`, real network calls, `performance.now()` thresholds, random seeds from the environment, or a requirement for exposed garbage collection.

Add root script:

```json
"bench:long-session": "pnpm --filter @eregister/open-grid-core exec vitest run src/perf/longSessionResilience.test.ts && pnpm --filter @eregister/open-grid-react exec vitest run src/gridPortalStore.adversarial.test.ts src/index.test.tsx"
```

If the full React `index.test.tsx` makes this command unreasonably broad, create a focused `longSessionResilience.test.tsx` in React and run that instead.

**Verify**: run the new command twice consecutively; both runs produce identical resource maxima and pass.

## Phase 4: Prove client renderer plateau under mixed interaction

Using a real mounted core renderer fixture with at least 100,000 logical rows and enough columns to exercise pinned and center lanes, run a deterministic mixed session of at least 10,000 operations:

- alternating vertical and horizontal scroll windows;
- focused-cell and range-selection movement;
- cell edits plus committed batch updates;
- filter/sort changes at sparse, documented checkpoints;
- custom renderer cells and portal hydration;
- column reorder/pin changes at sparse checkpoints;
- periodic render-stat resets only between measurement epochs, never to hide live ownership.

Assert:

- row slots, cell slots, controllers, active portals, warm renderers, and listener keys plateau after warm-up;
- no portal mounts, forced live mounts, full row-pipeline rebuilds, or global work appear on the active scroll path beyond already documented allowances;
- deferred portal/post-scroll queues drain within a fixed number of fake-scheduler steps after input stops;
- per-epoch cells/rows visited and written stay proportional to the viewport delta, not operation count or total rows;
- destroy plus queue drain returns all live ownership gauges to zero.

Do not assert that cumulative mount/rebind counters stop increasing; assert that the live working set and per-epoch deltas remain bounded.

**Verify**: the client scenario passes standalone and under the full `bench:long-session` command.

## Phase 5: Prove infinite and SSRM cache/request plateau

Create parallel remote scenarios using public factories and real runtime composition, following `runtimeComposition.conformance.test.ts` rather than controller-only mocks.

For both infinite and SSRM:

- configure a small explicit `maxBlocksInCache`, block size, and max concurrent request count;
- traverse thousands of non-adjacent ranges so eviction is mandatory;
- alternate resolved, rejected, explicitly retried, and stale-generation requests;
- change sort/filter/query generations during in-flight work;
- for SSRM, expand/collapse child routes and purge subtrees repeatedly;
- stop input, settle all accepted requests, drain scheduler work, then destroy with a final set of requests pending.

Assert at every epoch:

- cache block counts do not exceed configured limits plus documented protected/in-flight exceptions;
- loaded row-node and visual-index Maps remain proportional to retained blocks;
- pending request queues and active abort/request counts are bounded by configured concurrency;
- stale completions do not repopulate evicted generations or purged child stores;
- failed slots remain failed until explicit retry;
- after destroy, active request/abort counts, queues, stores, node indexes, and loading state return to zero/baseline.

If existing snapshots do not expose enough information, add narrow internal gauges; do not export controller-private collections.

**Verify**: run the new remote scenarios together with `rowModel.adversarial.test.ts`, `serverRowModel.adversarial.test.ts`, and `runtimeComposition.conformance.test.ts`.

## Phase 6: Prove scheduler fairness and bounded backlog

Extend `frameCoordinator.test.ts` with a long deterministic arbitration scenario of at least 10,000 mixed requests.

The fake scheduler must expose current and peak queue depths. Assert:

- at most one coordinator-owned RAF is pending at once;
- repeated scroll/paint/post-scroll requests coalesce rather than multiplying callbacks;
- paint is not starved by continuous scroll requests;
- post-scroll work runs after the current scroll epoch settles and stale epochs are discarded;
- bounded chunks eventually drain a large portal/fidelity backlog;
- destroy cancels the owned RAF, clears pending bits, and makes subsequently flushed microtasks inert;
- fault callbacks cannot leave the coordinator permanently `inFrame` or retain a reschedule loop.

Add a live scheduler gauge only if tests cannot prove these properties through the existing fake scheduler. Keep it internal.

**Verify**: `frameCoordinator.test.ts`, `gridScheduler.test.ts`, and the long-session suite pass twice with identical peak depths.

## Phase 7: Prove React portal and remount cleanup

Extend the React portal-store/debug surface and focused tests to cover at least 500 deterministic cycles of:

- mounting/updating/unmounting cell portals across recycled physical identities;
- mounting/unmounting row and menu portals;
- adding/removing per-cell and structural subscriptions;
- registering/removing imperative updaters;
- same-container key replacement and stale-unmount rejection;
- complete grid/provider mount and unmount with pending structural microtasks.

At warm-up, middle, final, and post-destroy epochs assert:

- portal and listener/updater counts plateau;
- snapshots contain only active physical owners;
- empty per-cell listener sets are removed;
- dirty snapshot rebuild counts are proportional to structural publications, not data-only updates;
- post-destroy microtasks do not notify listeners or recreate snapshots;
- every ownership gauge is zero after destroy.

Do not depend on React internal Fiber fields or heap snapshots. Use the portal store's narrow debug gauges and public mount lifecycle.

**Verify**: focused React long-session tests, existing portal adversarial tests, React full suite, and `bench:long-session` pass.

## Phase 8: Fix only proven leaks and record the baseline

For each failed plateau invariant:

1. Identify the single owner retaining the resource.
2. Add the minimal failing focused regression before changing production code.
3. Fix cleanup, eviction, cancellation, or bounded-storage ownership at that component.
4. Rerun the scenario that exposed it plus adjacent lifecycle/architecture tests.
5. Record the final scenario parameters, warm-up point, integer caps, and rationale in `docs/architecture/long-session-resilience.md` or the existing benchmark JSON if its schema cleanly fits.

Do not lower a cap merely until the test passes. Derive caps from viewport size, configured cache sizes, concurrency, renderer budget, or listener ownership. Include formulas in test messages, for example `rowSlots <= renderedRows + retentionAllowance`.

Finally, reconcile Plan 153 against the live code. Mark any snapshot-prewarm assumption removed by Plan 159 as stale in Plan 153 before it is executed; do not implement Plan 153 here.

**Verify**: `bench:long-session`, `bench`, `verify:core`, full React tests, and root build all pass.

## Test plan

### Required new deterministic scenarios

1. Bounded instrumentation ring buffers after 100,000 records.
2. Client mixed-interaction plateau over at least 10,000 operations.
3. Infinite cache/request plateau across at least 2,000 non-adjacent ranges.
4. SSRM root/child-store plateau across at least 2,000 range/route operations.
5. Frame-coordinator fairness across at least 10,000 mixed scheduling requests.
6. Core mounted render/destroy cycles with pending fidelity/portal work.
7. React portal-store ownership plateau across at least 500 cycles.
8. React component mount/unmount cycles with pending structural microtasks.

### Existing exemplars

- Work-count assertions: `packages/core/src/perf/instrumentedBudgets.test.ts`
- Wide mounted renderer: `packages/core/src/renderer/runtimePerformance.test.ts`
- Remote mounted renderer: `packages/core/src/runtimeComposition.conformance.test.ts` and `serverRuntimePerformance.test.ts`
- Fake scheduler arbitration: `packages/core/src/renderer/frameCoordinator.test.ts`
- Lifecycle symmetry: `packages/core/src/lifecycle.adversarial.test.ts`
- Portal physical ownership: `packages/react/src/gridPortalStore.adversarial.test.ts`

### Anti-flake rules

- Fixed seed checked into the test.
- Fake scheduler drained explicitly.
- Integer resource and work bounds only.
- No real timers, network, random seed, browser heap API, or CI-machine speed threshold.
- Run the long-session command twice as part of final review.

## Done criteria

- [x] `RecordingGridInstrumentation` has finite default history capacities, preserves retained order, reports drops, and passes a 100,000-record test.
- [x] A documented live resilience snapshot covers slots, portals, warm renderers, scheduler ownership, remote caches/requests, and React listener/portal ownership without exposing mutable collections.
- [x] Client mixed interaction reaches a stable live-resource plateau and bounded per-epoch work after warm-up.
- [x] Infinite and SSRM caches, indexes, stores, queues, and active requests remain within configuration-derived bounds throughout long traversal.
- [x] Scheduler peak queue depth is bounded, work classes are not starved, and destroy cancels all owned work.
- [x] React portal/listener/updater counts plateau and return to zero after destroy.
- [x] All three row modes plus mounted core and React lifecycles return owned live gauges to baseline after destroy.
- [x] Every discovered leak has a focused regression and an owner-local fix, or the plan is BLOCKED with the exact unresolved invariant.
- [x] `corepack pnpm run bench:long-session` passes twice consecutively with identical resource maxima.
- [x] `corepack pnpm run bench`, `corepack pnpm run verify:core`, React tests, and `corepack pnpm run build` exit 0.
- [x] `docs/architecture/long-session-resilience.md` or the benchmark registry records scenario seeds, operation counts, warm-up points, caps, formulas, and final evidence.
- [x] Plan 153 is reconciled against Plan 159/160 and no longer instructs executors to restore removed dead snapshot-prewarm Cartesian products.
- [x] No unrelated source, public feature, or user-owned `.claude/settings.local.json` changes are included.
- [x] This plan and `plans/README.md` are marked DONE with implementation commit evidence.

## STOP conditions

Stop and report instead of improvising if:

- A reliable plateau assertion requires wall-clock or heap-size thresholds rather than deterministic ownership/work counts.
- The only way to observe a resource is to expose mutable runtime internals through the stable public API.
- A cache can exceed its configured bound for reasons not represented by a documented protected/in-flight allowance.
- A proven leak fix requires changing public row-model, edit, selection, persistence, or renderer semantics.
- React cleanup can only be asserted through unstable Fiber internals.
- A scenario requires adding Playwright, Puppeteer, or another browser framework to the runtime/package dependency surface.
- The long-session suite exceeds 60 seconds in focused local execution before being run twice; reduce fixture allocation while preserving operation count and invariants, not test coverage.
- Any verification command fails twice after a focused reasonable attempt.
- Drift in an in-scope owner invalidates the current-state evidence or cap formula.

## Maintenance notes

- These tests are steady-state contracts. When viewport buffers, cache sizes, renderer budgets, or concurrency defaults change, update formulas, not arbitrary constants, and document the review.
- Keep live gauges separate from cumulative counters in names and types.
- Polling diagnostics must remain side-effect free and allocation-bounded; future DevTools may poll them frequently.
- A real-browser heap/trace soak may supplement this plan later, but it must not replace deterministic ownership tests.
- Plan 153 should consume the plateau evidence and live gauges established here rather than inventing another telemetry path.
