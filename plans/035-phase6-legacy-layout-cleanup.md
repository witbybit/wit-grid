# Plan 035: Phase 6 – Remove remaining legacy layout shortcuts

> **Executor instructions**: Follow each step, run verifications after each
> one. All fixes are narrow and surgical — no behavior changes, only replacing
> hard-coded constants and unsafe casts with the correct typed alternatives.
> Update `plans/README.md` when done.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/034-server-grid-polish-foundation.md`
- **Category**: architecture, correctness, cleanup
- **Planned at**: working tree, 2026-06-14

## Why this matters

Plan 009 Phases 0–5 established `GridLayoutPlan` as the single source of truth
for all structural geometry (header height, chrome offsets, sticky group stack,
header bands). Three narrow legacy shortcuts survived into the working tree:

1. `fillDragController.ts:104` — `mouseY` subtracts a hard-coded `40` (the old
   leaf-header height constant) instead of reading `chrome.topChromeHeight` from
   the layout plan. When the group panel is open or when multi-level column
   groups push `topChromeHeight` above 40, fill-drag row hit-testing lands on
   the wrong row.

2. `GridEngine.ts:474-475` — `setAggDefs` signature uses `AggregationDef<any>`
   and casts `defs as any` when calling `groupingFeature.setAggDefs`. The
   callee already accepts `AggregationDef<TRowData>` — the cast is a leftover
   from an earlier refactor.

3. `contextMenu.ts:186` — `item.id as any` bypasses TypeScript's strict
   `includes()` check between `string | undefined` and the
   `DefaultContextMenuItemId` union. Can be fixed with a typed guard.

## Current state

- `packages/core/src/renderer/fillDragController.ts:14-20` — `FillDragControllerOptions` has no `getLayoutPlan` field. The hard-coded `40` is at line 104.
- `packages/core/src/renderer/renderEngine.ts:234-241` — `FillDragController` is constructed here; `getOverlayLayer` and `getScrollViewport` are already passed as lambdas off `this.viewportRenderer`. `getLayoutPlan` from `this.viewportRenderer.getLayoutPlan()` can be added the same way.
- `packages/core/src/renderer/renderEngine.ts:226-233` — The column-interaction controller already receives `getLayoutPlan: () => this.viewportRenderer.getLayoutPlan()`, confirming the pattern.
- `packages/core/src/renderer/layoutPlan.ts:5` — `LEAF_HEADER_HEIGHT = 40` is exported for callers that have no layout plan yet (fallback).
- `packages/core/src/engine/GridEngine.ts:474` — method signature uses `AggregationDef<any>[]`.
- `packages/core/src/features/GroupingFeatureController.ts:122` — `setAggDefs(defs: AggregationDef<TRowData>[])` is already generic.
- `packages/core/src/contextMenu.ts:28` — `DefaultContextMenuItemId` is already typed as the exact union.

## Commands

| Purpose     | Command                                                   | Expected |
| ----------- | --------------------------------------------------------- | -------- |
| Build core  | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0   |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0   |
| React build | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0   |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0   |

## Steps

### Step 1: Fix `fillDragController.ts` — replace hard-coded `40`

**`packages/core/src/renderer/fillDragController.ts`**

Add `getLayoutPlan?: () => import('./layoutPlan.js').GridLayoutPlan | null`
to `FillDragControllerOptions` and store it as a private field.

Replace line 104:

```ts
// before
const mouseY = e.clientY - scrollRect.top + scrollViewport.scrollTop - 40;
// after
const topChrome = this.getLayoutPlan?.()?.chrome.topChromeHeight ?? LEAF_HEADER_HEIGHT;
const mouseY = e.clientY - scrollRect.top + scrollViewport.scrollTop - topChrome;
```

Import `LEAF_HEADER_HEIGHT` from `'./layoutPlan.js'` so the fallback stays
explicit and type-safe.

**`packages/core/src/renderer/renderEngine.ts`**

Add `getLayoutPlan: () => this.viewportRenderer.getLayoutPlan()` to the
`FillDragController` constructor options (lines 234-241), matching the pattern
used for the column-interaction controller directly above it.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` → exit 0.

### Step 2: Fix `GridEngine.ts` — remove `setAggDefs` cast

**`packages/core/src/engine/GridEngine.ts:474`**

Change the method signature from:

```ts
public setAggDefs(defs: import('../rows/stages/aggregateStage.js').AggregationDef<any>[]): void {
    this.groupingFeature.setAggDefs(defs as any);
```

to:

```ts
public setAggDefs(defs: import('../rows/stages/aggregateStage.js').AggregationDef<TRowData>[]): void {
    this.groupingFeature.setAggDefs(defs);
```

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` → exit 0.

### Step 3: Fix `contextMenu.ts` — remove `item.id as any`

**`packages/core/src/contextMenu.ts:186`**

Replace:

```ts
const activeDefaults = this.options.disableDefaults ? [] : defaultItems.filter((item) => !item.id || !exclude.includes(item.id as any));
```

with:

```ts
const activeDefaults = this.options.disableDefaults
	? []
	: defaultItems.filter((item) => !item.id || !exclude.includes(item.id as DefaultContextMenuItemId));
```

`DefaultContextMenuItemId` is already defined at line 28 of the same file as
`NonNullable<GridContextMenuOptions['excludeDefaults']>[number]`. The cast from
`string` to that union is safe because the default item ids are a strict subset
of the union, and the non-null check on line 28 guarantees `item.id` is defined
before the `includes` call.

**Final verify**:

```
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter demo-app build
```

All → exit 0.

Update `plans/README.md` status to `DONE`.

## Done criteria

- [ ] `fillDragController.ts` has no hard-coded `40` for chrome height.
- [ ] `FillDragControllerOptions` has a `getLayoutPlan?` field.
- [ ] `renderEngine.ts` passes `getLayoutPlan` to `FillDragController`.
- [ ] `GridEngine.setAggDefs` uses `TRowData` generic, no `as any`.
- [ ] `contextMenu.ts` uses `as DefaultContextMenuItemId`, no `as any`.
- [ ] All verification commands exit 0.
