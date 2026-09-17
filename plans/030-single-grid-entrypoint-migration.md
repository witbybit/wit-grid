# Plan 030: Replace the React surface with a single `Grid` component

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report rather than improvising.
>
> **Drift check (run first)**: `git diff --stat d79c342..HEAD -- packages/react/src packages/core/src/engine/architectureGuards.test.ts demo/src plans`
> If any in-scope file changed since this plan was written, compare the Current state notes against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/029-react-hook-lifecycle-contract-hardening.md
- **Category**: migration
- **Planned at**: commit `d79c342`, 2026-06-13

## Why this matters

The package is now structurally ready for a single flagship grid component, but the public React surface still exposes multiple top-level grid entrypoints. That is clean enough for engineers, but it is still more than one mental model for app authors to learn and remember. AG Grid-level strength comes from one obvious component and one obvious ownership story, with the rest of the machinery hidden behind that surface.

We need to make the public component story as simple as possible before people build on top of it. The safest scalable shape is a single `Grid` component with an explicit discriminated union for client/server ownership. That is slightly more verbose than inference, but it is much harder to misuse, it scales to future modes, and it keeps the component contract self-documenting.

## Choice: discriminated union, not inference

Two options were considered:

1. **Infer mode from `rows` vs `datasource`**.
    - Pros: fewer props, slightly terser call sites.
    - Cons: ambiguous when both are present or neither is present, harder to evolve when a future mode is added, and the wrong behavior can be selected by accident rather than by design.

2. **Explicit discriminated union with `mode: 'client' | 'server'`**.
    - Pros: the compiler enforces the mode, docs can show one clear component, future modes can be added without hidden heuristics, and validation errors become obvious at compile time instead of runtime.
    - Cons: one extra prop at the call site.

Choose option 2. The extra character is worth the safety and long-term scalability.

## Current state

The relevant files, each with its role:

- `packages/react/src/index.ts:1-6` exports `GridView`, `ClientGrid`, and `ServerGrid` as separate public components.
- `packages/react/src/GridView.tsx:1-56` is the current explicit view layer; it owns mount orchestration and assumes an already-owned `api`.
- `packages/react/src/ClientGrid.tsx:1-40` and `packages/react/src/ServerGrid.tsx:1-40` are thin ownership wrappers around the lifecycle hooks.
- `packages/react/src/useGrid.ts:1-115` currently exposes lifecycle-only hook APIs; it is already compatible with a direct `Grid` implementation.
- `packages/react/src/types.ts:76-186` still carries the old `ClientGridOptions` / `ServerGridOptions` alongside the newer lifecycle types.
- `packages/react/src/index.test.tsx:754-798` and `packages/react/src/index.test.tsx:1512-1540` contain hook/component smoke coverage that will need to be retargeted to the new single component.
- `packages/core/src/engine/architectureGuards.test.ts:146-205` currently guards the React adapter boundary around `GridView.tsx` and `GridPortal.tsx`; it will need to be updated to assert the single `Grid` public entrypoint instead.
- `demo/src/components/GridShared.tsx:419-506` is the demo's shared grid shell; it currently aliases the package `GridView` and is the right place to swap in the new `Grid`.
- `demo/src/pages/RealtimeGroupingDemo.tsx:2-393`, `demo/src/pages/SidebarPanelsDemo.tsx:2-228`, `demo/src/pages/NestedTablesGrouping.tsx:2-578`, `demo/src/pages/PerformanceLab.tsx:5-269`, and `demo/src/pages/RowMultiSelectDemo.tsx:12-283` are representative demo consumers that still build on the current multi-entrypoint surface.

The codebase already shows the shape we want in the hooks: the lifecycle split is explicit and stable. The missing piece is the top-level public component consolidation.

## Commands you will need

| Purpose     | Command                                                   | Expected on success    |
| ----------- | --------------------------------------------------------- | ---------------------- |
| React build | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0                 |
| React tests | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0, all tests pass |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0, all tests pass |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0                 |

## Scope

**In scope**:

- `packages/react/src/index.ts`
- `packages/react/src/Grid.tsx` (new)
- `packages/react/src/GridView.tsx` if it remains as an internal implementation helper
- `packages/react/src/ClientGrid.tsx` and `packages/react/src/ServerGrid.tsx` for deletion or internalization
- `packages/react/src/index.test.tsx`
- `packages/react/src/types.ts`
- `packages/react/src/useGrid.ts` only as needed to support the new public component
- `packages/core/src/engine/architectureGuards.test.ts`
- `demo/src/components/GridShared.tsx`
- `demo/src/pages/*` demo consumers that still import the current public grid components
- `plans/README.md`

**Out of scope**:

- Core renderer internals
- Any new row-model, store, or portal behavior unrelated to the component surface
- Any broad demo visual redesign beyond replacing the grid entrypoint

## Steps

### Step 1: Introduce the single public `Grid` component

Create `packages/react/src/Grid.tsx` as the new primary public component. Use a discriminated union with `mode: 'client' | 'server'` as the top-level discriminator, for example:

```ts
type GridProps<TRowData> = ({ mode: 'client' } & ClientGridProps<TRowData>) | ({ mode: 'server' } & ServerGridProps<TRowData>);
```

The component should own the grid lifecycle internally and render the existing `GridView` implementation underneath. Keep the implementation explicit and readable; do not infer mode from prop presence.

**Verify**: `corepack pnpm --filter @eregister/open-grid-react build` → exit 0.

### Step 2: Remove the extra public grid components

Update `packages/react/src/index.ts` so the public barrel exports `Grid` as the single grid component. Remove `GridView`, `ClientGrid`, and `ServerGrid` from the public component exports. If `GridView` is still needed, keep it as an internal module that is not exported from the package barrel. Delete `ClientGrid.tsx` and `ServerGrid.tsx` if they are no longer used internally after `Grid` is wired up.

Tighten `packages/core/src/engine/architectureGuards.test.ts` so it enforces the new surface and no longer treats `GridView`/`ClientGrid`/`ServerGrid` as public API.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core test` → exit 0.

### Step 3: Migrate the demo in one pass

Update the demo shell in `demo/src/components/GridShared.tsx` to render the new `Grid` component, not the old public grid variants. Then update the pages that import `GridView` from `@eregister/open-grid-react` to import and use `Grid` instead, keeping any existing hook-owned wrapper logic only where it is genuinely needed for local orchestration.

Target the representative pages and then sweep the rest of `demo/src/pages` for any direct package-level grid component imports.

**Verify**: `corepack pnpm --filter demo-app build` → exit 0.

### Step 4: Retarget tests to the new public API

Update `packages/react/src/index.test.tsx` so the smoke coverage exercises the single `Grid` component in both client and server modes. Keep the hook tests only if they are still relevant as lower-level API coverage, but make sure no test depends on the old top-level split being public.

Add a guard test that the package barrel exposes only the single grid component as the public instance.

**Verify**: `corepack pnpm --filter @eregister/open-grid-react test` → exit 0.

### Step 5: Remove dead code and stale references

Once the new `Grid` component is in place and the demo is migrated, remove any stale references to the retired components from comments, plan notes, and docs. This includes any direct mentions of the old public grid variants in `plans/README.md` and any package docs that still describe multiple top-level grid components as the primary surface.

Do not leave compatibility aliases behind in the package barrel. The public React surface should read as one component, not a family of siblings.

**Verify**: `rg -n "ClientGrid|ServerGrid|GridView" packages/react/src demo/src` should only match internal implementation details, tests, or non-public demo wrappers that are intentionally retained; no package-barrel exports should remain.

## Test plan

- Update `packages/react/src/index.test.tsx` to cover:
    - single `Grid` client mode
    - single `Grid` server mode
    - both modes using the same top-level API shape
    - any remaining `useGrid` hook coverage that is still relevant
- Update `packages/core/src/engine/architectureGuards.test.ts` so the React adapter boundary now treats `Grid` as the single public grid instance.
- Use the existing React test file as the structural pattern for render/hook smoke coverage.
- Verification sequence: `@eregister/open-grid-react build`, `@eregister/open-grid-react test`, `@eregister/open-grid-core test`, `demo-app build`.

## Done criteria

Machine-checkable. All must hold:

- [ ] `packages/react/src/index.ts` exports only the single public grid component for the grid instance surface.
- [ ] `packages/react/src/ClientGrid.tsx` and `packages/react/src/ServerGrid.tsx` are deleted or no longer reachable from the public barrel.
- [ ] `Grid` uses an explicit discriminated union for client/server ownership.
- [ ] Demo pages render through `Grid` rather than the retired public grid components.
- [ ] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [ ] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [ ] `corepack pnpm --filter demo-app build` exits 0.
- [ ] `plans/README.md` is updated to reflect this plan and its dependency ordering.

## STOP conditions

Stop and report back if:

- The code at the locations in "Current state" does not match the plan's assumptions because the surface drifted.
- The single `Grid` component requires a much broader core API change than expected, especially in `GridView`, `GridProvider`, or the lifecycle hooks.
- The demo migration reveals a genuine need for a second public component that cannot be handled by the discriminated union design.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Reviewers should look closely at the public barrel and demo imports; the point of this migration is that users only see one grid component.
- Keep the discriminated union explicit in docs and examples. Do not silently reintroduce mode inference later.
- If future modes are added, extend the union deliberately rather than adding a second public component.
- Keep lower-level hooks available only as implementation/advanced APIs, not as the primary documented path.
