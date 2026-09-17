# Plan 032: Lock the React surface to one `Grid` entrypoint and delete showroom ownership helpers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report rather than improvising a fallback API. When done, update the status
> row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4d3b9fc..HEAD -- packages/react/src demo/src packages/core/src/engine/architectureGuards.test.ts plans`
> If any in-scope file changed since this plan was written, compare the
> "Current state" notes against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/030-single-grid-entrypoint-migration.md
- **Category**: migration
- **Planned at**: commit `4d3b9fc`, 2026-06-13

## Why this matters

We need one obvious way to own and render a grid. Right now the React package
still exposes the old ownership helpers and the demo still preserves a shared
showroom store layer, which means the public contract is not actually as simple
as the single-`Grid` story suggests.

This plan finishes the cleanup in the direction that has already been chosen:
`Grid` becomes the only public grid entrypoint, ownership helpers stop being
exported, and the demo stops depending on a shared `useShowroomStores`
indirection. That keeps the core contract easy to reason about and prevents the
demo from teaching a second, hidden way to wire the grid.

## Current state

The relevant files, each with its role:

- `packages/react/src/index.ts:1-12` still exports `GridView`, `GridProvider`,
  `useOwnedClientGrid`, and `useOwnedServerGrid` alongside `Grid`.
- `packages/react/src/Grid.tsx:1-157` owns the grid lifecycle, but it still
  reaches into `@eregister/open-grid-core` directly and renders `GridProvider` +
  `GridView`, so the adapter surface is not yet collapsed to one explicit
  public entrypoint.
- `packages/react/src/ownedGrid.ts:1-58` still exposes the owned-grid helper
  hooks.
- `packages/core/src/engine/architectureGuards.test.ts:146-200` already
  contains architecture fence tests for the React adapter, which is the right
  place to extend the public-surface guardrails.
- `demo/src/hooks/useOwnedGrid.ts:1` currently re-exports the owned-grid helper
  names from `@eregister/open-grid-react`, preserving the old pattern in the demo
  namespace.
- `demo/src/hooks/useShowroomStores.ts:27,158,285-854` centralizes all showroom
  grid instances behind the owned-grid helpers.
- `demo/src/App.tsx:23,104-177` still selects active page state from
  `useShowroomStores`.
- `demo/src/components/GridShared.tsx:419-506` still wraps `GridView` and
  `GridProvider` as a shared demo shell.
- Representative pages still depend on that shared ownership model:
  `demo/src/pages/PerformanceLab.tsx:13,213-270`,
  `demo/src/pages/InfiniteServerScroll.tsx:5,157-166`,
  `demo/src/pages/NativeCellTypesDemo.tsx:12,365-520`,
  `demo/src/pages/RealtimeGroupingDemo.tsx:4,148-410`,
  `demo/src/pages/NestedTablesGrouping.tsx:3,239-587`, and
  `demo/src/pages/SidebarPanelsDemo.tsx:4,185-237`.

The repo already shows the right direction in the public API tests: `Grid`
exists as the flagship surface, so the remaining job is to remove the extra
entrypoints and remove the demo-side ownership scaffolding that keeps them
alive.

## Commands you will need

| Purpose     | Command                                                   | Expected on success    |
| ----------- | --------------------------------------------------------- | ---------------------- |
| React build | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0                 |
| React tests | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0, all tests pass |
| Core build  | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0                 |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0, all tests pass |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0                 |

## Scope

**In scope**:

- `packages/react/src/Grid.tsx`
- `packages/react/src/index.ts`
- `packages/react/src/ownedGrid.ts` (delete or internalize)
- `packages/react/src/GridView.tsx` and `packages/react/src/gridContext.tsx`
  if they need to stay as internal implementation details only
- `packages/react/src/index.test.tsx`
- `packages/core/src/engine/architectureGuards.test.ts`
- `demo/src/App.tsx`
- `demo/src/components/GridShared.tsx`
- `demo/src/hooks/useOwnedGrid.ts`
- `demo/src/hooks/useShowroomStores.ts`
- `demo/src/pages/*`
- `plans/README.md`

**Out of scope**:

- Core engine behavior changes unrelated to the React surface
- New demo visuals or redesigns
- Any new escape-hatch hook or compatibility alias that would reintroduce a
  second grid ownership contract

## Steps

### Step 1: Make `Grid` the only public grid entrypoint

Refactor `packages/react/src/Grid.tsx` so the package barrel only needs to
export `Grid` as the grid instance surface. Keep any `GridView`/`GridProvider`
usage as private implementation detail inside the React package, but stop
exposing them from `packages/react/src/index.ts`.

Delete `packages/react/src/ownedGrid.ts` if it is no longer needed after the
refactor. There should be no public `useOwnedClientGrid` or
`useOwnedServerGrid` export, and no public path that invites the demo to build
its own ownership wrapper.

**Verify**: `corepack pnpm --filter @eregister/open-grid-react build` -> exit 0.

### Step 2: Add guard rails that fail fast on surface drift

Update `packages/react/src/index.test.tsx` so it asserts the barrel exports the
single grid entrypoint and does not export `GridView`, `GridProvider`,
`useOwnedClientGrid`, or `useOwnedServerGrid`.

Extend `packages/core/src/engine/architectureGuards.test.ts` with file-read
assertions that:

- `packages/react/src/index.ts` does not re-export the removed helpers,
- `packages/react/src/ownedGrid.ts` is not reachable as a public surface,
- `demo/src` does not import `@eregister/open-grid-core`,
- `demo/src` does not import or re-export `useOwnedGrid`,
- `demo/src` does not depend on `useShowroomStores`.

Use the existing architecture guard style in that test file as the precedent.

**Verify**: `corepack pnpm --filter @eregister/open-grid-react test` and
`corepack pnpm --filter @eregister/open-grid-core test` -> both exit 0.

### Step 3: Remove the showroom ownership layer and migrate the demo to `Grid`

Delete `demo/src/hooks/useOwnedGrid.ts` and `demo/src/hooks/useShowroomStores.ts`
once the last caller is removed.

Refactor `demo/src/App.tsx` so it no longer selects apis from a shared showroom
store. Each page should own its own grid inputs locally and pass them into the
single `Grid` entrypoint. For pages that need sibling sidebars or tool panels,
capture the api through `onGridReady` and thread it into local props rather
than using `GridProvider` outside the component.

Rewrite `demo/src/components/GridShared.tsx` so it stops wrapping `GridView` and
`GridProvider`. Keep the shared renderers, data generators, and cell helpers,
but remove the shared ownership shell.

Then sweep every page in `demo/src/pages` and replace the old shared ownership
pattern with local page state plus `Grid` usage. The important constraint is
that the demo should no longer teach a second way to own the grid.

**Verify**: `corepack pnpm --filter demo-app build` -> exit 0.

### Step 4: Lock the index, docs, and plan index to the new contract

Update `plans/README.md` with this plan as the follow-up to the single-grid
entrypoint work.

Remove or update stale comments and copy in the demo that still describe the
showroom store or owned-grid helper pattern as a normal path.

Finish by running the full verification sequence:

`corepack pnpm --filter @eregister/open-grid-react build`
`corepack pnpm --filter @eregister/open-grid-react test`
`corepack pnpm --filter @eregister/open-grid-core build`
`corepack pnpm --filter @eregister/open-grid-core test`
`corepack pnpm --filter demo-app build`

All must pass.

## Test plan

- Expand `packages/react/src/index.test.tsx` to prove `Grid` is the only
  public grid entrypoint and the removed helpers are absent from the barrel.
- Extend `packages/core/src/engine/architectureGuards.test.ts` with demo
  import guards and public-surface guards.
- Let `demo-app build` serve as the integration proof that every showroom page
  now compiles against the single-entrypoint contract.

## Done criteria

Machine-checkable. All must hold:

- [ ] `packages/react/src/index.ts` exports `Grid` as the only public grid
      entrypoint.
- [ ] `packages/react/src/ownedGrid.ts` is deleted or fully internal and not
      reachable from the barrel.
- [ ] `packages/react/src/index.test.tsx` fails if `GridView`,
      `GridProvider`, `useOwnedClientGrid`, or `useOwnedServerGrid` reappear
      in the public surface.
- [ ] `demo/src/hooks/useOwnedGrid.ts` and `demo/src/hooks/useShowroomStores.ts`
      are gone.
- [ ] `demo/src` no longer imports `@eregister/open-grid-core`.
- [ ] `demo/src` pages render through `Grid` with page-local ownership, not a
      shared showroom store layer.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `plans/README.md` is updated to reflect this plan and its dependency
      ordering.

## STOP conditions

Stop and report back if:

- The code at the locations in "Current state" does not match the plan's
  assumptions because the surface has drifted again.
- `Grid` cannot own the full client/server lifecycle without adding a new
  public escape hatch that would recreate a second ownership contract.
- A demo page truly cannot be expressed with the single `Grid` entrypoint plus
  local page state and `onGridReady`, in which case report the missing API gap
  instead of reintroducing `useOwnedGrid`.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Reviewers should look for accidental reintroduction of ownership helpers via
  re-exports, demo-local wrapper hooks, or "just for the demo" shortcuts.
- Keep `GridView` and `GridProvider` as internal implementation details only if
  they are still needed inside the React package. They should not become a
  second public surface.
- If future demo pages need the api for sibling controls, capture it through
  `onGridReady` and pass it locally. Do not re-open a shared showroom store
  layer.
- If a new ownership mode ever becomes truly necessary, add it deliberately to
  `Grid` rather than reviving `useOwnedGrid` as a hidden side channel.
