# Plan 164: Establish a deletion-first core simplicity contract and select the first proven simplification slice

> **Executor instructions**: This is an evidence and architecture plan, not a refactor. Follow every step, write only the listed documentation and guard files, and do not modify production source. The purpose is to prevent speculative consolidation from deleting real safety boundaries or adding another architecture. Stop at every STOP condition instead of proposing implementation from intuition.
>
> **Drift check (run first)**: `git diff --stat faf29558..HEAD -- packages/core/src packages/react/src docs/architecture package.json plans/README.md`
> If the core changed, refresh every metric and verify every cited path against the live tree before proceeding.

## Status

- **State**: DONE in working tree on 2026-07-29
- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `faf29558`, 2026-07-28

## Why this matters

Wit Grid has strong correctness and performance boundaries, but repeated decomposition plans have also produced many controllers, coordinators, bridges, ports, registries, and protocol types. A broad “simplify everything” refactor would be dangerous because some of those abstractions isolate frameworks, untrusted input, lifecycle faults, or alternative row models. This plan makes ownership and execution paths explicit, measures conceptual complexity, and chooses exactly one deletion-oriented vertical slice whose benefit and safety can be proven before production code changes.

The target is not small files. The target is fewer facts with multiple owners, fewer semantic handoffs, fewer forwarding-only layers, and fewer concepts required to predict behavior—without weakening public behavior, performance budgets, diagnostic evidence, or optional-feature isolation.

## Current state

Facts verified at the planned commit:

- `packages/core/src` contains approximately 220 non-test TypeScript files and 55,527 non-test lines; there are 121 core test files. These numbers are baselines, not targets by themselves.
- `packages/core/src/engine/architectureGuards.test.ts` is approximately 2,985 lines and begins with file-size budgets for `store.ts`, `GridEngine.ts`, `renderEngine.ts`, and `rowRenderer.ts`. Moving code can satisfy these guards without reducing concepts.
- `packages/core/src/internal/createGridRuntimeComposition.ts` is approximately 285 lines and constructs the public API largely through forwarding closures over `GridStore`. This may be a necessary package boundary, a replaceable indirection, or both; the audit must decide from ownership and call-path evidence.
- `packages/core/src/renderer/renderEngine.ts:171-444` composes `PortalMountManager`, `HeaderMenuController`, `GeometryController`, `DefaultFrameCoordinator`, `ViewportRenderer`, `LayoutTransitionController`, `ColumnInteractionController`, `FillDragController`, `StickyGroupRenderer`, `RowDragController`, `RenderScrollCoordinator`, `RenderViewportCoordinator`, `RenderPaintCoordinator`, and `RenderInvalidationCoordinator`. Do not assume that class count alone proves overengineering.
- `packages/core/src/renderer/rowRenderer.ts:169-200` owns a single `RowRendererRuntimeBridge`, and `packages/core/src/renderer/rowRendererRuntime.ts` exists only for that owner. This is a candidate for investigation, not pre-approved demolition.
- `packages/core/src/features/DataMutationController.ts` is composed only by `GridEngine`, while `GridDomainMutation.ts` receives its operations through an execution context. The mutation path must be traced before deciding whether this is clean separation or redundant indirection.
- `packages/core/src/store/GridStoreHostFacade.ts` is created only by `GridStore`. Its renderer/theme boundary may be essential even if many methods forward.
- The canonical cell-write path currently crosses public runtime composition, `GridStore`, `GridEngine`, `GridChangeApplier`, `GridDomainMutation`, `DataMutationController`, row-model structural writes, invalidation, events, history, and render scheduling. Each hop needs an explicit justification.
- The full main-worktree build, focused recorder/replay tests, React DevTools tests, and adversarial suites were green immediately before this plan. `verify:core` has previously exposed a test-typecheck baseline mismatch; the executor must establish the live result rather than inheriting that report.
- A live 2026-07-28 rerun of `test:architecture` passed 315 of 316 core checks but failed the Plan 089 browser-scheduling source guard because `diagnostics/GridTraceReplay.ts` contains the default `setTimeout` adapter for its injected `GridReplayScheduler`. Treat this as a known baseline mismatch to classify: replay pacing already has a deterministic substitution seam, so coupling diagnostics to the renderer scheduler merely to satisfy the allowlist is not an acceptable simplification.

## Architecture principle to test

Every production concept must fit one of these roles:

1. **Authoritative owner** — uniquely owns durable or derived state.
2. **Safety boundary** — isolates framework code, untrusted input, lifecycle faults, or nondeterministic dependencies.
3. **Alternative implementation seam** — has at least two real production implementations.
4. **Optional feature boundary** — keeps disabled features out of foundational paths and cost.
5. **Replaceable indirection** — forwards to one owner without providing one of the benefits above.
6. **Duplicate authority** — independently represents or decides a fact owned elsewhere.
7. **Obsolete/dead path** — no supported caller or retained compatibility obligation.

Only roles 5-7 are simplification candidates. Roles 1-4 must be preserved unless evidence shows their responsibility can move while reducing total concepts.

## Commands you will need

| Purpose      | Command                                | Expected on success |
| ------------ | -------------------------------------- | ------------------- |
| Build        | `corepack pnpm run build`              | exit 0              |
| Full tests   | `corepack pnpm run test`               | exit 0              |
| Architecture | `corepack pnpm run test:architecture`  | exit 0              |
| Adversarial  | `corepack pnpm run test:adversarial`   | exit 0              |
| Performance  | `corepack pnpm run bench`              | exit 0              |
| Long session | `corepack pnpm run bench:long-session` | exit 0              |
| API          | `corepack pnpm run api:check`          | exit 0              |
| Package      | `corepack pnpm run pack:verify`        | exit 0              |
| Formatting   | `corepack pnpm run format:check`       | exit 0              |
| Diff hygiene | `git diff --check`                     | no output, exit 0   |

If `corepack pnpm run verify:core` fails only because of a pre-existing test-typecheck baseline, record the exact diagnostics and independently run every remaining constituent command. Do not weaken or update a baseline in this plan.

## Scope

**In scope**:

- Create `docs/architecture/core-simplicity-contract.md`.
- Create `docs/architecture/core-concept-inventory.md`.
- Create `docs/architecture/core-execution-traces.md`.
- Create `docs/architecture/core-complexity-baseline.json`.
- Create one narrow `packages/core/src/engine/coreSimplicityGuards.test.ts` only if the guard can enforce ownership or dependency direction without snapshotting volatile implementation text.
- Update only Plan 164's row/status in `plans/README.md` if directed by the reviewer.

**Out of scope**:

- Any production TypeScript, CSS, demo, package export, or public API change.
- Merging, moving, renaming, or deleting a production file.
- Adding a general dependency-analysis library or runtime dependency.
- Creating Plans 165+ before the evidence package selects and bounds the first slice.
- Reopening Plan 164 as an incremental row engine; that proposal is explicitly rejected.
- Treating line count, file count, or class count alone as proof that code should be merged.

## Git workflow

- Branch: `codex/164-core-simplicity-baseline`
- Commit message: `Document core simplicity baseline`
- Do not push or open a PR unless instructed.
- Keep the user's unrelated `.claude/settings.local.json` untouched.

## Steps

### Step 1: Establish the verified behavioral and performance baseline

Run every command in “Commands you will need.” Record command, exit status, test counts, benchmark budgets, build/package result, and any known baseline failure in `docs/architecture/core-complexity-baseline.json`. The JSON must include the planned commit, capture date, Node/pnpm versions, and whether each result is authoritative, informational, or blocked.

Also record these structural values using deterministic repository reads:

- Production and test TypeScript file counts by top-level core directory.
- Production LOC by top-level directory and the 25 largest production files.
- Counts of exported production classes named `*Controller`, `*Coordinator`, `*Manager`, `*Registry`, `*Bridge`, `*Port`, and `*Runtime`.
- Public and experimental export counts for core and React.
- Production import edges between top-level core directories.
- Bundle/package sizes produced by the existing build/pack workflow.

Do not declare lower counts intrinsically better. They establish drift and help quantify whether later work deletes concepts or merely moves them.

**Verify**: parse `docs/architecture/core-complexity-baseline.json` with Node and confirm every required field exists; `corepack pnpm run format:check` exits 0.

### Step 2: Write the sole-owner responsibility table

In `docs/architecture/core-simplicity-contract.md`, define the minimal conceptual architecture:

`public intent -> canonical commit -> authoritative mutation -> derived projection -> precise invalidations -> viewport -> renderer -> adapter/DOM`

Create a responsibility table for at least:

- Raw row storage and row identity
- Client/infinite/server-side visual projection
- Grid configuration state
- Commit ordering, rejection, rollback, history, and event publication
- Formula dependencies and cached values
- Domain versions and subscriptions
- Render invalidation
- Frame scheduling
- Viewport/geometry
- Mounted row/cell/portal identity
- Feature capability decisions
- Runtime faults, instrumentation, causal recording, and replay
- Persistence/workspace behavior
- React adapter lifecycle

For each fact, name exactly one authoritative production owner, consumers, allowed mutation boundary, and forbidden duplicate representations. If no sole owner can be named, mark it `DISPUTED` with concrete competing symbols; disputed facts are high-priority findings.

Document the acceptance rule for new abstractions: at least two production implementations, a real package/framework/security/lifecycle boundary, optional-feature cost isolation, or deterministic substitution of a nondeterministic dependency. “May be useful later” is rejected.

**Verify**: every responsibility row has one owner or explicit `DISPUTED`; no production source changed.

### Step 3: Trace five canonical operations end to end

In `docs/architecture/core-execution-traces.md`, trace:

1. Synchronous accepted cell edit and rejected validation edit.
2. Mixed row transaction with update and remove.
3. Sort/filter/query configuration change.
4. One fast-scroll frame followed by scroll-idle fidelity repair.
5. Mounted grid destroy while optional persistence, recorder, renderer ports, and React subscriptions exist.

For every hop list:

- Exact `file:symbol` and current line.
- Input/output type.
- State read or written.
- Whether it owns policy, transforms data, isolates failure, schedules work, or only forwards.
- Fault/rollback behavior.
- Diagnostic evidence emitted.
- Whether another path represents the same decision.

Each trace must finish with a concise call-depth and semantic-handoff count. A semantic handoff changes vocabulary or authority; a direct typed delegation does not automatically count.

**Verify**: every trace starts at a stable public API/React action and ends at observable state/render/destruction; every symbol exists via `rg`.

### Step 4: Inventory and classify core concepts

In `docs/architecture/core-concept-inventory.md`, list production controllers, managers, coordinators, registries, bridges, ports, runtimes, caches, schedulers, version counters, and mutation/result protocols. For each include:

- Definition and all production consumers.
- Role 1-7 from the architecture principle.
- State owned, if any.
- Number of production implementations.
- Disabled-mode/runtime cost.
- Failure boundary supplied.
- Recommendation: keep, merge, replace, quarantine, or delete.
- Confidence and evidence.

Independently inventory all representations of:

- Cell/row mutation intent and result
- Invalidation intent and frame work
- Cell identity and column instance identity
- Row-model capabilities
- Domain versions
- Renderer freshness/version stamps
- Runtime port binding state

Duplicate names do not prove duplicate authority; confirm semantics and writers.

**Verify**: every `Controller|Coordinator|Manager|Registry|Bridge|Port|Runtime` production definition returned by the inventory command appears in the document or an explicitly listed exclusion category.

### Step 5: Select exactly one first simplification slice

Rank findings by leverage and confidence. The first executable slice must:

- Remove or collapse at least one production concept, protocol, or dependency edge.
- Preserve all public and experimental exports unless removal is separately approved.
- Preserve or improve performance, bundle size, disabled-feature cost, and Flight Recorder causality.
- Have existing characterization coverage or specify the exact missing tests needed first.
- Touch one coherent vertical path, not perform a repository-wide rename/reorganization.
- Have an unambiguous rollback boundary.
- State production LOC/files/types expected to be deleted—not merely moved.

Required candidate evaluations, even if rejected:

- Public API composition and `GridStore` forwarding layers.
- `DataMutationController`/`GridDomainMutation` execution-context indirection.
- `RowRendererRuntimeBridge` and renderer coordinator topology.
- String/line-count-heavy architecture guards.
- Legacy/compatibility and single-implementation port surfaces.

Conclude with one recommended slice and at most two alternatives. Include “considered and rejected” entries so future audits do not repeat weak ideas.

Do not create the implementation plan yet. The reviewer will validate the evidence and author Plan 165 from the selected slice.

**Verify**: recommended slice satisfies every bullet; `git diff --stat` shows documentation plus at most the narrow semantic guard test.

### Step 6: Add only durable semantic guards, if justified

If the audit discovers a high-confidence dependency or ownership rule that is not already enforced, add it to `coreSimplicityGuards.test.ts`. Tests must inspect imports/exports or execute behavior; do not assert incidental method names, comments, source substrings, or exact line counts.

Good examples:

- Production writes to an authoritative state type occur only through its named owner/boundary.
- Experimental DevTools/replay code is absent from stable entrypoints.
- A framework adapter cannot import core internals outside the explicit bridge.

If no durable rule meets this bar, do not create the test file.

**Verify**: focused guard tests and `test:architecture` pass.

## Test plan

- No production behavior changes are allowed, so the authoritative existing full, architecture, adversarial, benchmark, long-session, API, pack, and build gates must remain unchanged.
- Any new guard must first be demonstrated to fail against a temporary local violation, then pass after the violation is removed; do not commit the temporary violation.
- Validate every JSON artifact parses and every documented file/symbol reference exists.
- Run `git diff --check` and formatting checks.

## Done criteria

- [x] No production source, public export, CSS, demo, or package configuration changed during the Plan 164 evidence phase; Plan 165 then executed sequentially in the same working tree.
- [x] The baseline records every required verification result and structural metric.
- [x] Every major state/fact has one authoritative owner or an explicit disputed-owner finding.
- [x] Five canonical operations are traced from public intent to observable completion.
- [x] Every in-scope production concept is classified with evidence.
- [x] Exactly one first simplification slice is recommended with deletion targets and safety gates.
- [x] At most two alternatives are retained; weak candidates are recorded as rejected.
- [x] No new general dependency/tooling framework was added.
- [x] All existing correctness, architecture, performance, build, and package gates pass; the unrelated experimental declaration baseline drift is recorded explicitly.
- [x] `git diff --check` and formatting pass.

## STOP conditions

Stop and report instead of improvising if:

- The live core differs materially from the planned commit and cited execution paths no longer match.
- A supposedly forwarding-only layer owns lifecycle, failure isolation, compatibility, or alternative implementations not represented elsewhere.
- Establishing a metric requires installing a dependency or modifying production/build configuration.
- Any existing correctness/performance gate fails for a reason introduced by this documentation-only plan.
- The recommended slice cannot name concrete deletions or relies primarily on line-count reduction.
- More than one production vertical slice appears necessary in the first implementation plan.

## Maintenance notes

- This plan is intentionally the only pre-authored simplification plan. Plan 165 must be derived from its reviewed evidence.
- Future feature plans must state which authoritative owners they touch and justify every new production abstraction against the simplicity contract.
- Complexity metrics are evidence, not score-gaming targets. Reviewers should reject changes that improve counts by merging unrelated policy into a god object.
- Preserve the Flight Recorder as an observer. Simplification must not make diagnostics a mutation authority.
