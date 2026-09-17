# Plan 028: Split the public React surface into explicit entrypoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If any
> STOP condition happens, stop and report rather than improvising a different
> API shape. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 1015f23..HEAD -- packages/react/src/OpenGrid.tsx packages/react/src/GridPortal.tsx packages/react/src/useGrid.ts packages/react/src/index.ts packages/react/src/index.test.tsx demo/src/components/GridShared.tsx demo/src/pages`
> If any in-scope file has changed since this plan was written, compare the
> "Current state" section against the live code before proceeding.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/027-render-engine-viewport-layout-coordinator.md`
- **Category**: migration
- **Planned at**: commit `1015f23`, 2026-06-13

## Why this matters

The current React package is usable, but it still asks app authors to navigate
too many ownership modes through one overloaded convenience component. That is
fine for a prototype; it is not the strongest public contract to freeze before
the API becomes established.

Right now `OpenGrid` handles inline client ownership, external `api` ownership,
and provider fallback all in one branchy entrypoint. At the same time,
`useClientGrid` and `useServerGrid` hide lifecycle rules behind initial-only
runtime warnings, and the demo app still mixes the old `OpenGrid` path with the
more compositional `GridProvider` pattern. If we go live with that shape as the
primary story, we will be teaching people the least explicit version of the API
first.

This plan hardens the public React surface before that happens. The goal is a
cleaner contract with a better center of gravity:

- explicit grid ownership entrypoints for client and server use,
- a render-only grid view surface for composition,
- one tiny React-side host bridge instead of several files reaching into core
  internals,
- lifecycle types that make "initial-only" values obvious in the API instead of
  discoverable through warnings,
- and demo pages that consume the better surface as the default example.

## Current state

- `packages/react/src/index.ts:1-8` exports `OpenGrid`, `GridProvider`,
  `useClientGrid`, `useServerGrid`, portal helpers, and pagination, but no
  explicit `ClientGrid`, `ServerGrid`, or public `GridView` component.
- `packages/react/src/OpenGrid.tsx:39-107` gives one component three ownership
  modes: inline client data, external `api`, and `GridProvider` fallback.
- `packages/react/src/useGrid.ts:20-91` and `102-173` accept flat option bags,
  but some fields are actually initial-only and are guarded only by console
  warnings after mount.
- `packages/react/src/OpenGrid.tsx:16` and
  `packages/react/src/GridPortal.tsx:25` still reach into
  `@eregister/open-grid-core/internal` for mount and renderer-capability plumbing. That is
  a narrow dependency today, but it should be concentrated into one tiny React
  bridge module rather than spread across the public surface.
- `demo/src/components/GridShared.tsx:429-498` already has a local `GridView`
  wrapper that composes `OpenGrid`; that is the right migration template to
  promote into the public API.
- Representative demo pages still import `OpenGrid` directly:
  `demo/src/pages/RowMultiSelectDemo.tsx:12,283`,
  `demo/src/pages/SidebarPanelsDemo.tsx:2,208`,
  `demo/src/pages/RealtimeGroupingDemo.tsx:2,373`,
  `demo/src/pages/NestedTablesGrouping.tsx:2,289,552,564,575`, and similar
  showcase pages.
- `packages/react/src/index.test.tsx:1453-1507` already characterizes the old
  inline `OpenGrid` behavior and the "missing ownership mode" throw. That test
  file is the right place to evolve the surface assertions rather than layering
  a second, parallel characterization suite.

## Commands you will need

| Purpose     | Command                                                   | Expected on success |
| ----------- | --------------------------------------------------------- | ------------------- |
| Build core  | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0              |
| Build react | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0              |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0              |
| React tests | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0              |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0              |

## Scope

**In scope**:

- `packages/react/src/OpenGrid.tsx`
- `packages/react/src/GridPortal.tsx`
- `packages/react/src/useGrid.ts`
- `packages/react/src/index.ts`
- `packages/react/src/index.test.tsx`
- new React entrypoint and bridge modules needed for the explicit surface
- `demo/src/components/GridShared.tsx`
- `demo/src/pages/RowMultiSelectDemo.tsx`
- `demo/src/pages/SidebarPanelsDemo.tsx`
- `demo/src/pages/RealtimeGroupingDemo.tsx`
- `demo/src/pages/NestedTablesGrouping.tsx`
- other demo pages only if they still import `OpenGrid` after the main migration

**Out of scope**:

- renderer/core internals outside the React host bridge
- visual redesigns or demo styling changes
- changing the behavior of grid features unrelated to the public API shape

## Steps

### Step 1: Define the explicit public surface and move internal plumbing into one React bridge

Add the new public entrypoints that the package should actually be telling
people to use:

- `ClientGrid` for owned client data grids,
- `ServerGrid` for owned server-backed grids,
- `GridView` for render-only composition against an existing `api` or
  `GridProvider`,
- keep `GridProvider` as the context bridge,
- keep `OpenGrid` only as compatibility sugar around the new primitives.

At the same time, create one small React-owned host bridge module that is the
only place in `packages/react/src` allowed to import `@eregister/open-grid-core/internal`
for mount/imperative-renderer wiring. `OpenGrid`, `GridPortal`, and the new
entrypoints should consume that bridge rather than importing core internals
directly.

Export the new public primitives from `packages/react/src/index.ts`, and mark
`OpenGrid` as compatibility-only in the package docs/comments if you keep it
around.

**Verify**: `corepack pnpm --filter @eregister/open-grid-react build` -> exit 0.

### Step 2: Make lifecycle mutability explicit in the React types

Refactor the public option shapes so the lifecycle is visible in the type
system instead of hidden behind runtime warnings. The recommended shape should
separate:

- initial-only config such as `getRowId`, `persistence`, `initialState`,
  `rowSelection`, and server block sizing,
- live grid data/config such as `rows`, `columns`, `datasource`,
  `columnTypes`, and `styleRules`.

If keeping compatibility overloads, make them wrappers around the explicit
shapes rather than the shape everyone is encouraged to write. The goal is that
the new public components and the preferred hook API no longer teach callers to
rely on warning-driven behavior.

Add or update focused tests in `packages/react/src/index.test.tsx` to prove the
new entrypoints mount correctly, the compatibility wrapper still works, and the
initial-only fields remain stable after mount.

**Verify**: `corepack pnpm --filter @eregister/open-grid-react test` -> exit 0.

### Step 3: Migrate the demo app to the recommended surface as part of the same pass

Use the demo as the acceptance path for the new public API, not as a passive
consumer of the old one.

Update `demo/src/components/GridShared.tsx` so its shared grid wrapper renders
the public `GridView` instead of `OpenGrid`.

Then convert the showcase pages that still import `OpenGrid` to the explicit
public primitives:

- pages that already own an `api` should use `GridProvider` + `GridView`,
- pages that only need a self-contained client grid should use `ClientGrid`,
- server-backed examples should use `ServerGrid`,
- keep `GridProvider` only where nested/shared composition really needs it.

Prefer removing `OpenGrid` imports from the demo entirely by the end of this
step. If a page truly cannot be expressed cleanly without the compatibility
wrapper, stop and report which API gap remains instead of leaving the page
half-migrated.

**Verify**: `corepack pnpm --filter demo-app build` -> exit 0.

### Step 4: Tighten the boundary so the old wrapper cannot become the primary API again

Add guardrail coverage that codifies the new intended surface:

- the package barrel should expose the explicit primitives first,
- `OpenGrid` should be tested as a compatibility path, not the recommended
  contract,
- the new public entrypoints should not reach into `@eregister/open-grid-core/internal`
  directly outside the single host bridge module,
- the demo should not import `OpenGrid` once the migration is complete.

If necessary, add a small demo-side import guard or grep-style test so this
does not regress silently when new pages are added later.

Update `plans/README.md` to mark this plan done and to document the new
recommended public surface.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core build`
`corepack pnpm --filter @eregister/open-grid-react build`
`corepack pnpm --filter @eregister/open-grid-core test`
`corepack pnpm --filter @eregister/open-grid-react test`
`corepack pnpm --filter demo-app build`
-> all exit 0.

## Test plan

- Expand `packages/react/src/index.test.tsx` with explicit surface assertions for
  `ClientGrid`, `ServerGrid`, `GridView`, `GridProvider`, and the compatibility
  wrapper.
- Keep the old `OpenGrid` characterization only as far as needed to prove the
  wrapper still forwards correctly.
- Add a demo import guard or package test that fails if the recommended demo
  files drift back to `OpenGrid` or `@eregister/open-grid-core/internal` imports.

## Done criteria

- [ ] `packages/react/src/index.ts` exports explicit recommended entrypoints.
- [ ] The React package has a single host-bridge module for core-internal
      mounting and renderer-capability plumbing.
- [ ] `OpenGrid` is compatibility-only and no longer the primary surface in the
      demo.
- [ ] `useClientGrid` / `useServerGrid` no longer teach initial-only behavior
      through runtime warnings as the normal path.
- [ ] Demo pages consume the new public API instead of `OpenGrid`.
- [ ] Focused react tests, core tests, and the demo build pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:

- the explicit public components would have to duplicate a large chunk of the
  host lifecycle instead of sharing one small bridge,
- the new API shape cannot express a current demo page without reintroducing
  the old overloaded modes,
- the lifecycle split would break existing public behavior in a way that would
  require a wider migration plan, or
- the demo migration uncovers a dependency on `OpenGrid` that is better solved
  by a different public component than the one proposed here.

## Maintenance notes

Future React work should keep the public surface intentionally small:

- new demos should prefer `GridView` + `GridProvider` when they already own an
  `api`,
- convenience wrappers should be treated as sugar, not the canonical API,
- and any additional core-internal access from React should go through the
  single host bridge, not reappear ad hoc in public components.
