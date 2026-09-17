# Plan 158: Repair server-backed row-model correctness and replace server pages with real SSRM

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report, do not improvise.
>
> **Drift check (run first)**: `git diff --stat 6f594575..HEAD -- packages/core/src/infiniteRowModel.ts packages/core/src/serverPageRowModel.ts packages/core/src/serverRowModel.test.ts packages/core/src/serverRowModel.adversarial.test.ts packages/core/src/createGrid.ts packages/core/src/store.ts packages/core/src/rowModel.ts packages/core/src/api packages/core/src/engine packages/react/src/Grid.tsx demo docs/architecture plans/README.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts below against live code before proceeding; if they no longer match materially, treat that as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/156-row-model-completion-and-public-row-node-facade.md`, `plans/157-interaction-kernel-hardening.md`
- **Category**: bug
- **Planned at**: commit `6f594575`, 2026-07-13

## Why this matters

Plans 156 and 157 landed enough shared row-model infrastructure to make the remaining server-backed defects visible. The infinite model can still render blank row bands or skip rows under scrolling pressure, and sort/filter changes for infinite and the current `server` model are not yet guaranteed to republish committed async results into visible slots.

The current `server` row model is also the wrong architecture: it is page-oriented, exposes page APIs publicly, and cannot be evolved into the final server-side row model without carrying incorrect semantics forward. This plan first fixes the shared async publication contract and infinite correctness in core, then deletes the page-oriented server implementation and replaces `rowModelType: 'server'` with one real hierarchical SSRM.

## Current state

The following facts are already true in the repo and must anchor the work:

- `packages/core/src/infiniteRowModel.ts` owns the flat remote block model and already contains the new explicit block-state split plus queueing/concurrency settings.
- `packages/core/src/serverPageRowModel.ts` is still the live implementation behind `rowModelType: 'server'`, and it is explicitly page-based.
- `packages/core/src/engine/createRowModelRuntimes.ts` still exposes separate infinite and server-page runtime ports and still emits `serverPage*` events.
- `packages/core/src/createGrid.ts` still constructs `ServerPageRowModelController` via `createServerPageGrid(...)`.
- `packages/core/src/serverRowModel.test.ts` and `packages/core/src/serverRowModel.adversarial.test.ts` already hold the focused infinite/server-backed correctness regressions.
- `docs/architecture/plan-158-readiness-audit.md` and `docs/architecture/plan-158-server-page-deletion-manifest.md` already exist and should be treated as required evidence inputs, not rewritten from scratch unless stale.

Live code excerpts to confirm before editing:

- `packages/core/src/infiniteRowModel.ts:163-180`

```ts
export interface InfiniteBlockSnapshot {
  readonly blockIndex: number;
  readonly startRow: number;
  readonly endRow: number;
  readonly state: InfiniteBlockStatus;
  readonly committedRowCount: number;
  readonly requestId?: number;
  readonly queryGeneration: number;
  readonly lastAccessedAt: number;
  readonly error?: string;
}

export interface InfiniteRowModelOptions<TData = unknown> {
  blockSize?: number;
  maxBlocksInCache?: number;
  maxConcurrentRequests?: number;
  prefetchBlockCount?: number;
```

- `packages/core/src/infiniteRowModel.ts:209-217`

```ts
type InfiniteBlockStatus = 'absent' | 'queued' | 'loadingInitial' | 'loaded' | 'refreshing' | 'failedInitial' | 'failedRefresh' | 'stale';
```

- `packages/core/src/infiniteRowModel.ts:273-330`

```ts
public markQueued(blockIndex: number, blockSize: number): InfiniteBlock<TData> {
  const block = this.ensureBlock(blockIndex, blockSize);
  if (!this.hasCommittedRows(block) && block.status !== 'loadingInitial') {
    block.status = 'queued';
```

```ts
public markLoaded(...){
  ...
  if (typeof totalCount === 'number') {
    this.knownRowCount = Math.max(0, totalCount);
  } else if (returnedRowCount < blockSize && options?.canInferTerminalFromShortBlock !== false) {
    this.knownRowCount = Math.max(0, block.startRow + returnedRowCount);
  } else {
    const provisionalReachableCount = block.startRow + returnedRowCount + blockSize;
    this.estimatedRowCount = Math.max(this.estimatedRowCount, provisionalReachableCount);
  }
}
```

- `packages/core/src/infiniteRowModel.ts:495-552`

```ts
export class InfiniteRowModelController<TData = unknown> ... {
  private readonly maxConcurrentRequests: number;
  private readonly prefetchBlockCount: number;
  private readonly blockCache = new InfiniteBlockCache<TData>();
  private readonly pendingBlockLoads = new Map<number, QueuedInfiniteBlockLoad>();
  ...
  this.unsubscribers.push(
    this.runtime.addEventListener(GridEventName.sortChanged, () => this.invalidateQueryCache()),
    this.runtime.addEventListener(GridEventName.filterChanged, () => this.invalidateQueryCache()),
    this.runtime.addEventListener(GridEventName.quickFilterChanged, () => this.invalidateQueryCache()),
    this.runtime.addEventListener(GridEventName.queryModelChanged, () => this.invalidateQueryCache())
  );
```

- `packages/core/src/infiniteRowModel.ts:933-935`

```ts
public getBlockSnapshots = (): readonly InfiniteBlockSnapshot[] => {
  return this.blockCache.getSnapshots();
};
```

- `packages/core/src/serverPageRowModel.ts:66-83`

```ts
export interface ServerGetPageParams {
	readonly page: number;
	readonly pageSize: number;
	readonly sortModel: unknown;
	readonly filterModel: unknown;
	readonly quickFilterModel: unknown;
	readonly queryModel: unknown;
}

export interface ServerDatasource<TRowData = unknown> {
	getPage(params: ServerGetPageParams, context: { signal?: AbortSignal }): Promise<ServerGetPageResult<TRowData>>;
}
```

- `packages/core/src/serverPageRowModel.ts:90-104`

```ts
export interface ServerPageState {
	readonly page: number;
	readonly pageSize: number;
	readonly pageCount: number;
	readonly totalRowCount: number;
	readonly loading: boolean;
	readonly error: string | null;
}
```

- `packages/core/src/serverPageRowModel.ts:130-190`

```ts
export class ServerPageRowModelController<TData = unknown> ... {
  private currentPage: number;
  private pageSize: number;
  private pageCount = 1;
  private totalRowCount = 0;
  ...
  this.unsubscribers.push(
    this.runtime.addEventListener(GridEventName.sortChanged, () => {
      this.invalidateQueryAndResetPage();
    }),
```

- `packages/core/src/engine/createRowModelRuntimes.ts:57-67`

```ts
setLoadingState: (loading) => store.engine.setRowModelLoadingState(loading),
dispatchInfiniteBlockLoaded: (payload) => {
  store.dispatchEvent(GridEventName.infiniteBlockLoaded, payload);
},
dispatchInfiniteBlockLoadFailed: (payload) => {
  store.dispatchEvent(GridEventName.infiniteBlockLoadFailed, payload);
},
dispatchPaginationChanged: (payload) => {
  store.engine.setServerPaginationState(payload);
  store.dispatchEvent(GridEventName.paginationChanged, payload);
},
```

- `packages/core/src/engine/createRowModelRuntimes.ts:79-109`

```ts
export function createServerPageRowModelRuntime<TRowData>(store: RowModelRuntimeStoreBridge<TRowData>): ServerPageRowModelRuntime<TRowData> {
  return {
    ...
    dispatchServerPageLoadingStarted: (payload) => store.dispatchEvent(GridEventName.serverPageLoadingStarted, payload),
    dispatchServerPageLoaded: (payload) => {
      store.dispatchEvent(GridEventName.serverPageLoaded, payload);
      store.dispatchEvent(GridEventName.serverPageChanged, payload);
    },
```

- `packages/core/src/createGrid.ts:71-79`

```ts
/** Options for creating a server-page (explicit page loading) grid. */
export interface ServerPageGridOptions<TRowData> extends ServerPageRowModelOptions<TRowData> {
  ...
}
```

- `packages/core/src/createGrid.ts:315-355`

```ts
export function createServerPageGrid<TRowData>(options: ServerPageGridOptions<TRowData>): GridApi<TRowData> {
  ...
  const controller = new ServerPageRowModelController<TRowData>(runtime.getServerPageRowModelRuntime(), { ...options, columns: resolvedColumns });
```

Relevant repo conventions and evidence files:

- Plan files use the handoff template in `C:\Users\rishi\witbybit\open-grid\.agents\skills\improve\references\plan-template.md`.
- Existing row-model demolition evidence already lives in:
    - `C:\Users\rishi\witbybit\open-grid\docs\architecture\plan-158-readiness-audit.md`
    - `C:\Users\rishi\witbybit\open-grid\docs\architecture\plan-158-server-page-deletion-manifest.md`
- Use `packages/core/src/serverRowModel.test.ts` and `packages/core/src/serverRowModel.adversarial.test.ts` as the primary test homes for infinite/server-backed async correctness.

## Commands you will need

| Purpose                         | Command                                                                                                                                                                                                                                                                                                                                                                                                                    | Expected on success              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------- | -------------------- | ---------------- | ----------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Drift check                     | `git diff --stat 6f594575..HEAD -- packages/core/src/infiniteRowModel.ts packages/core/src/serverPageRowModel.ts packages/core/src/serverRowModel.test.ts packages/core/src/serverRowModel.adversarial.test.ts packages/core/src/createGrid.ts packages/core/src/store.ts packages/core/src/rowModel.ts packages/core/src/api packages/core/src/engine packages/react/src/Grid.tsx demo docs/architecture plans/README.md` | exit 0; inspect output for drift |
| Core focused tests              | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts src/renderer/renderEngine.test.ts src/renderer/serverRuntimePerformance.test.ts`                                                                                                                                                                                                       | all pass                         |
| Core full tests                 | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                                                                                                                                                                                                                                                                    | exit 0; all tests pass           |
| React tests                     | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                                                                                                                                                                                                                                                                                                   | exit 0; all tests pass           |
| Workspace tests                 | `corepack pnpm run test`                                                                                                                                                                                                                                                                                                                                                                                                   | exit 0; all tests pass           |
| Architecture guards             | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/boundary.test.ts src/engine/architectureGuards.test.ts`                                                                                                                                                                                                                                                                                              | all pass                         |
| Adversarial suite               | `corepack pnpm run test:adversarial`                                                                                                                                                                                                                                                                                                                                                                                       | exit 0; all tests pass           |
| Build                           | `corepack pnpm run build`                                                                                                                                                                                                                                                                                                                                                                                                  | exit 0                           |
| Repo search for removed symbols | `rg -n "ServerPageRowModelController                                                                                                                                                                                                                                                                                                                                                                                       | serverPage                       | goToServerPage | getCurrentServerPage | serverPageLoaded | serverPageChanged | pageNumber" packages/core/src packages/react/src demo docs -g '!**/node_modules/**'` | no matches outside explicit migration notes, if any |

## Scope

**In scope**:

- `packages/core/src/infiniteRowModel.ts`
- `packages/core/src/serverPageRowModel.ts` until deleted
- `packages/core/src/serverRowModel.test.ts`
- `packages/core/src/serverRowModel.adversarial.test.ts`
- `packages/core/src/renderer/renderEngine.test.ts`
- `packages/core/src/renderer/serverRuntimePerformance.test.ts`
- `packages/core/src/engine/createRowModelRuntimes.ts`
- `packages/core/src/engine/runtimePorts.ts`
- `packages/core/src/createGrid.ts`
- `packages/core/src/store.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/api/*`
- `packages/core/src/state/GridState.ts`
- `packages/core/src/index.ts`
- `packages/react/src/Grid.tsx`
- SSRM replacement files created under `packages/core/src/`
- Demo files that exercise `rowModelType: 'server'`, only after core behavior is correct
- `docs/architecture/plan-158-readiness-audit.md` and `docs/architecture/plan-158-server-page-deletion-manifest.md` if they need factual refresh
- `plans/README.md` status row for Plan 158 when the implementation is complete

**Out of scope**:

- Unrelated feature work from other plans
- Cosmetic demo redesign or UX polish unrelated to correctness
- Compatibility wrappers such as `serverPage`, `legacyServer`, `pagedServer`, or datasource translation shims
- Timer-based or forced-render hacks that mask publication bugs
- New enterprise features beyond the minimum SSRM feature set required here

## Git workflow

- Stay on the current branch unless the operator asks otherwise.
- Commit by logical phase, not by file dump.
- Before each commit, run at least `corepack pnpm --filter @eregister/open-grid-core test` and ensure it is green.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Lock in the async publication regressions with tests

Use the existing focused suites to prove the failures and pin the expected core behavior before large refactors:

- Add or finish tests in `packages/core/src/serverRowModel.test.ts` for:
    - infinite blank-row replacement when a non-zero block resolves
    - infinite sort publication after async commit
    - infinite filter publication and row-count update after async commit
    - row-count transitions across unknown, estimated, and known states
    - deliberate loading/failed placeholders instead of unexplained blanks
- Add or finish adversarial tests in `packages/core/src/serverRowModel.adversarial.test.ts` for:
    - stale query responses losing to newer sort/filter/query generations
    - datasource replacement invalidating old authority
    - rapid scrolling not requiring incidental renders to repaint committed rows
- If a renderer-specific reproduction is clearer, add a narrowly focused assertion in `packages/core/src/renderer/renderEngine.test.ts`.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts src/renderer/renderEngine.test.ts` -> all pass

### Step 2: Finish the infinite block model so no represented row can go blank

Work in `packages/core/src/infiniteRowModel.ts` only. Keep infinite flat and remote; do not import grouping/store semantics into it.

Required outcomes:

- Preserve committed rows during refresh and failed refresh.
- Ensure queued/loading/failed states always map to deliberate visual rows.
- Keep row-count authority explicit and deterministic.
- Make request queueing prefer visible blocks, cap concurrency, and discard stale distant work.
- Ensure eviction removes ownership cleanly and revisit reloads deterministically.
- Validate responses before commit so invalid payloads never partially mutate rows or indexes.
- Expose immutable diagnostics through `getBlockSnapshots()` and use them in tests where that improves observability.

Do not move sort/filter logic into demos; the datasource request snapshot and publication path belong in core.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts src/renderer/serverRuntimePerformance.test.ts` -> all pass

### Step 3: Introduce one authoritative async publication path

Refactor the server-backed row-model runtime seam so async responses publish one committed row-model transition after rows, indexes, counts, and cache state are fully installed.

Target areas:

- `packages/core/src/engine/createRowModelRuntimes.ts`
- `packages/core/src/engine/runtimePorts.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/store.ts`
- Any new shared helper file created under `packages/core/src/`

Requirements:

- Distinguish observability events from renderer invalidation.
- Capture immutable request/query state once per request.
- Reject stale responses before validation or mutation.
- Publish committed async changes through one runtime operation instead of scattered direct render nudges.
- Emit diagnostics and consumer-facing events after publication, not as the trigger for publication.

If a new shared helper is needed, keep it generic enough for infinite and SSRM, but do not collapse the two row models into one giant controller with branching.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` -> exit 0; all tests pass

### Step 4: Demolish the page-based server row model

Use `docs/architecture/plan-158-server-page-deletion-manifest.md` as the checklist, then delete the old architecture rather than adapting it.

Must remove:

- `ServerPageRowModelController`
- page-number/page-size/page-count-owned row-model state
- page datasource contracts
- `serverPage*` events and selectors
- page navigation APIs such as `goToServerPage(...)`
- runtime branches that construct or forward the old implementation
- page-based docs, tests, demos, and public exports

Update compile-time seams until the repo no longer assumes `rowModelType: 'server'` means selected-page loading.

**Verify**: `rg -n "ServerPageRowModelController|serverPage|goToServerPage|getCurrentServerPage|serverPageLoaded|serverPageChanged|pageNumber" packages/core/src packages/react/src demo docs -g '!**/node_modules/**'` -> no matches outside explicit migration notes, if any

### Step 5: Replace `server` with one real SSRM

Implement the new server-side row model under the existing public type name `server`.

Minimum architecture to introduce:

- one top-level `ServerSideRowModel`
- one store manager
- one root store
- child stores by canonical route
- per-store bounded block cache and block state
- store-aware request scheduling and stale rejection
- route-aware refresh/purge operations
- immutable store/block diagnostic snapshots

Minimum behavior to ship before closing the plan:

- flat root-store virtual scrolling
- bounded cache
- viewport-priority requests with max concurrency
- server-side sort/filter/quick-filter/query forwarding
- refresh without purge
- purge with deliberate loading rows
- stale response rejection
- unknown/estimated/known row counts
- child-store creation on group expansion
- targeted route refresh and subtree purge

Public API must converge on `rowModelType: 'server'` plus SSRM-focused datasource and refresh APIs. Do not leave deprecated page overloads behind.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/serverRowModel.test.ts src/serverRowModel.adversarial.test.ts src/rowModel.capabilities.test.ts src/query/queryModel.test.ts src/store.test.ts` -> all pass

### Step 6: Update adapters, docs, demos, and plan index after the core replacement is stable

Only after Steps 1-5 are green:

- update `packages/react/src/Grid.tsx` to remove page-server assumptions
- update or replace demos that exercise `rowModelType: 'server'`
- refresh `docs/architecture/plan-158-readiness-audit.md` and `docs/architecture/plan-158-server-page-deletion-manifest.md` only if code drift made them inaccurate
- update the Plan 158 row in `plans/README.md` when implementation is complete

Keep demo changes minimal and downstream of the core fix.

**Verify**: `corepack pnpm run build` -> exit 0

## Test plan

- Add or complete tests in `packages/core/src/serverRowModel.test.ts` covering:
    - infinite non-zero block commit replaces loading placeholders immediately
    - infinite sorting changes visible order only after the async response commits
    - infinite filtering changes visible rows and row count atomically
    - infinite refresh retains committed rows
    - failed refresh retains committed rows
    - hard purge intentionally removes committed rows
    - row-count transitions unknown -> estimated -> known and known shrink
    - no represented in-range visual index resolves to unexplained blank output
- Add or complete adversarial tests in `packages/core/src/serverRowModel.adversarial.test.ts` covering:
    - stale query responses
    - stale datasource responses
    - rapid distant scrolling
    - concurrency limit behavior
    - queue prioritization
- Add SSRM replacement tests for:
    - root-store loading and sort/filter/query forwarding
    - child-store route construction
    - route-targeted refresh/purge
    - stale child-store rejection
    - server-page API/type removal
- Reuse structural patterns from the existing row-model and adversarial suites rather than inventing a new test harness.
- Verification:
    - `corepack pnpm --filter @eregister/open-grid-core test` -> all pass
    - `corepack pnpm --filter @eregister/open-grid-react test` -> all pass
    - `corepack pnpm run test` -> all pass

## Done criteria

All must hold:

- [x] `corepack pnpm --filter @eregister/open-grid-core test` exits 0
- [x] `corepack pnpm --filter @eregister/open-grid-react test` exits 0
- [x] `corepack pnpm run build` exits 0
- [x] Infinite scrolling no longer produces unexplained blank or skipped in-range rows under the focused adversarial tests
- [x] Infinite sorting and filtering are verified in core tests, not demo-only behavior
- [x] `rowModelType: 'server'` instantiates only the new SSRM
- [x] No page-oriented server datasource contract remains in public types
- [x] No page-oriented server events or public APIs remain
- [x] Repo search for `ServerPageRowModelController|serverPage|goToServerPage|getCurrentServerPage|serverPageLoaded|serverPageChanged|pageNumber` finds no live implementation usage
- [x] No files outside the in-scope list are modified except for unavoidable compile-fix touch points caused by the server-page demolition
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if any of the following happens:

- The excerpts in "Current state" no longer match the live files after the drift check.
- Infinite blank rows turn out to originate primarily from renderer slot corruption rather than row-model publication or block-state ownership.
- Removing the page-based server implementation requires a compatibility adapter to keep the repo compiling.
- The new SSRM would require preserving page-number semantics in public API or datasource types.
- A verification command fails twice after a reasonable targeted fix attempt.
- The work cannot stay scoped to core-owned correctness plus the required downstream compile-fix updates.

## Maintenance notes

- The evidence docs for Plan 158 are already present. Prefer updating them surgically if drift appears rather than rewriting them from zero.
- Reviewers should scrutinize any new shared async helper to ensure it is truly generic infrastructure and not an accidental merged controller for infinite plus SSRM.
- Future pagination, if reintroduced for server data, must be a presentation layer on top of row-model state rather than the defining architecture of the server row model.
