# Plan 039: Harden the grid layout layer — native expand/collapse + pin animation, four-edge chrome, layer registry

> **Executor instructions**: This is an architectural umbrella plan, not a single patch. Execute it in phases. Each phase must build + pass tests before the next starts. Do not add a feature before its foundation phase lands. Do not introduce magic pixel constants for chrome offsets — everything structural comes from `GridLayoutPlan`. Do not run animation work on the scroll/data-tick hot path.
>
> **Drift check (run first)**: `git diff --stat c9d5cdb..HEAD -- packages/core/src/renderer packages/core/src/rows packages/core/src/rowModel.ts packages/core/src/store.ts packages/react/src/GridPortal.tsx`. If any in-scope file changed since this plan was written, compare current code against the targets below before proceeding.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH (hot-path sensitive; 481 core tests must stay green)
- **Depends on**: Plan 009 (GridLayoutPlan, header bands, sticky group layer) — DONE
- **Category**: architecture, rendering robustness, animation
- **Planned at**: commit `c9d5cdb`, 2026-06-14
- **Decisions locked**: animation mechanism = **Web Animations API (WAAPI)**; deliver all three features (expand/collapse, pinning, bottom chrome) after the foundation.
- **Progress (2026-06-14, branch rendering-architecture-v2-wip-3)**:
    - **Phase 1 DONE** — `GridLayoutPlan.chrome`/`origins` extended with four-edge bottom chrome (`statusBarHeight`, `paginationHeight`, `bottomChromeHeight`, `bottomChromeTop`, `statusBarTop`, `paginationTop`); `STATUS_BAR_HEIGHT`/`PAGINATION_HEIGHT` constants; config gates `showStatusBar`/`pagination` added to `GridState`/`GridEngineConfig`/store/engine init (height 0 until Phase 5). New `renderer/layerRegistry.ts` (`LAYER_REGISTRY` descriptors); `ViewportRenderer.mount` builds + `syncLayoutPlan` positions all layers from it (`buildLayers`, `getLayer`). Tests: `layoutPlan.test.ts` bottom-chrome block + `layerRegistry.test.ts`.
    - **Phase 2 DONE** — `renderer/layoutTransitionController.ts` (WAAPI) replaces `sortAnimationController.ts` (deleted). Handles **move** (sort, parity with old FLIP, no forced reflow) + **enter** (opacity, gated on non-empty snapshot). Feature-detected (jsdom/SSR/reduced-motion → instant). Dep renamed `sortAnimation`→`layoutTransition`, state `pendingSortAnimation`→`pendingTransition` across renderEngine/RenderInvalidationCoordinator/renderPaintCoordinator/renderScrollCoordinator + test. Unit tests: `layoutTransitionController.test.ts`.
    - **Phase 3 PARTIAL** — expand/collapse arms the transition: paint coordinator arms on reasons `group expansion`/`detail` (group + tree + master-detail); `RenderInvalidationCoordinator` captures snapshot on `expansion` state-key change. Displaced rows slide (move), revealed rows fade (enter). **Remaining**: slot **exit** retention pool (collapsed rows currently vanish instantly while rows below slide up) + detail-row height/clip animation. See STOP condition on full-width portal exit.
    - **Phase 4a DONE (pinning unification)** — `GridLayoutPlan.columns.lanes: ColumnLanes` ({left,center,right} each `{width, baseLeft, colStart, colEnd}`). `lanes.right.baseLeft` (= `totalColumnsWidth - pinRightWidth` = compiled plan `pinRightBaseLeft`) is now the single right-lane origin. `headerRenderer` reads it in both `syncPinnedLayerPositions` + leaf-render (removed 2 independent `totalColumnsWidth - pinRightWidth` recomputations); body binder already used the compiled plan's `pinRightBaseLeft`, so header + body now trace to one value. Guard tests in `layoutPlan.test.ts` (`pin lanes` block) assert lane↔compiled-plan agreement + empty-lane (-1) ranges.
    - **Phase 5 DONE (bottom-chrome layers)** — Status bar + pagination bar are first-class registry layers (`og-layer-status-bar`, `og-layer-pagination`, parent `container`, positioned from `origins.statusBarTop`/`paginationTop`, sized from `chrome.*Height`). Scroll viewport reserves the space via CSS `bottom: var(--og-bottom-chrome-height)` — no fragile re-measurement (the ~2-row over-render sits behind an opaque bar; harmless overscan). New `statusBarRenderer.ts` (live total + selected counts) + `paginationBarRenderer.ts` (summary + first/prev/next/last + Page X of Y; updates `state.pagination.page`, clamps out-of-range, dispatches the generic `paginationChanged` {page,pageCount,totalRows,pageSize}). Both wired in `renderEngine` mount/unmount via `viewportRenderer.getLayer(id)`. Styles in `styles.ts`. Tests: `statusBarRenderer.test.ts`, `paginationBarRenderer.test.ts`, registry guard updated. **Proves the registry + four-edge chrome end-to-end: two new layers added with ZERO edits to mount/syncLayoutPlan bodies.**
    - Test status: **core 555/555, react 100/100**, core+react+demo builds clean.
    - **NOT done — recommended follow-ups (each its own focused pass):**
        - **Client pagination row-slicing**: the bar drives page state + the `paginationChanged` event (works for server/external pagination), but the rendered client row set is not yet sliced. Slicing must thread a page window through the row pipeline so visual-row index maps, geometry, and group/sticky meta stay consistent (broad blast radius — its own data-layer task). Guard to flat data first; grouping/tree/detail cross-page semantics need a decision.
        - **Phase 4b — pin animation**: per-cell reparent FLIP (center↔lane) + sticky interaction + lane-width interpolation through `LayoutTransitionController`. Hot-path-adjacent (rebind), modest payoff. STOP risk: clone-and-swap if sticky fights the reparent mid-animation. (Pinning _correctness/unification_ already done in 4a.)
        - **Phase 3 exit pool**: collapsed rows fade-out (today they vanish instantly while rows below slide up). STOP risk #1: full-width (group/detail) portal lifecycle.

## Vision

The grid should accommodate enterprise-grid layout behavior the way AG Grid does:

- Expanding/collapsing a **row group**, **tree node**, or **master-detail** row animates: revealed rows fade/slide in, removed rows fade/slide out, and all displaced rows glide to their new positions instead of jumping.
- **Left/right column pinning** is driven by one coordinate system shared by header and body (today they use two), and pin/unpin **animates** the affected columns sliding between center and pinned lanes.
- **Pagination** and a **status bar / footer** are first-class chrome owned by the layout plan, not scrolling rows hacked into the body.
- Any **new HTML layer** (status bar, pagination, loading bar, find-bar, side panels) **slots in declaratively** through a layer registry — no hand-editing of `mount()` + `syncLayoutPlan()` for each one.
- **Hot-path performance is untouched.** Scroll frames and high-frequency cell updates never set a transition/animation; animations only ever run on discrete user actions (toggle, pin, sort) and are force-cancelled the instant a scroll or data-tick begins.

Design principle (extends Plan 009):

```text
State -> Row/Column Models -> Layout Plan (4-edge chrome + lanes) -> Render Plan
     -> { steady-state paint }  |  { LayoutTransition diff -> WAAPI animations }
     -> Layer Registry -> Layer Renderers
```

## Problem statement (current gaps)

1. **`GridLayoutPlan` is top-only.** `chrome` = `groupPanelHeight + totalHeaderHeight`; `origins` are all top offsets. No bottom chrome → pagination/status bars have nowhere to live. Group "footer" is a _scrolling full-width row_, not pinned chrome. The render window's `visibleBottom` reserves no bottom space. (`renderer/layoutPlan.ts:47-84,294-299`)

2. **The plan is a static snapshot, not a transition.** Expand/collapse (group/tree/master-detail) regenerates `VisualRow[]` → `GeometryModel.updateRows` recomputes `rowTops` → renderer writes new `translateY` **instantly**. The only animated thing, `SortAnimationController`, is a **DOM-snapshot FLIP** that reads `style`/`lastTop` before and animates after; it only handles **reordering the same row set**. It cannot animate rows that **enter** (newly revealed), **exit** (the slot pool recycles them immediately — `rowSlotPool.ts:66-72`), or a **changing container height**.

3. **Pinning uses two mechanisms.** Body pin lanes: `position: sticky` + `margin-left:auto` (`styles.ts:603-624`). Header pin lanes: separate absolute layers with JS-set widths (`viewportRenderer.ts:61-65,163-168`). Two coordinate systems for one concept → drift risk, and `sticky` cannot be transitioned, so pin/unpin (a hard center↔lane DOM reparent) can never animate.

4. **Layers are hand-coded.** `ViewportRenderer.mount()` `createElement`s each `.og-layer-*`; `syncLayoutPlan()` manually sets each one's top/height/width (`viewportRenderer.ts:38-87,124-169`). A new layer requires editing both methods + styles + the plan. Nothing slots in.

## Target architecture

### A. Four-edge chrome in `GridLayoutPlan`

Extend the plan so chrome is described on every edge, and the render window subtracts bottom chrome from usable height.

```ts
chrome: {
	// existing top
	groupPanelHeight: number;
	columnGroupHeaderHeight: number;
	leafHeaderHeight: number;
	totalHeaderHeight: number;
	topChromeHeight: number;
	// NEW bottom
	statusBarHeight: number;
	paginationHeight: number;
	bottomChromeHeight: number; // statusBarHeight + paginationHeight (+ future docked footers)
}
origins: {
	headerTop: number;
	rowLayerTop: number;
	stickyGroupLayerTop: number;
	overlayTop: number;
	// NEW
	bottomChromeTop: number; // viewport.height - bottomChromeHeight
	statusBarTop: number;
	paginationTop: number;
}
```

Rules:

- `viewport usable height` for the render window = `viewportHeight - topChromeHeight - bottomChromeHeight`. Pinned-bottom rows and `overlayTop`/overlay height already derive from the plan and must subtract bottom chrome.
- No magic constants: heights come from config (`STATUS_BAR_HEIGHT`, `PAGINATION_HEIGHT`) like `LEAF_HEADER_HEIGHT` today.

### B. Declarative layer registry

Replace hand-coded layer creation with a descriptor table. `viewportRenderer` iterates it to mount and to position. Each descriptor:

```ts
interface LayerDescriptor {
	id: string; // 'header' | 'sticky-groups' | 'rows' | 'status-bar' | 'pagination' | 'overlay' | ...
	className: string; // 'og-layer-*'
	parent: 'scroll-viewport' | 'container'; // scrolls with body, or fixed chrome
	order: number; // DOM insertion order within parent
	// pure positioning derived ONLY from the plan; no magic numbers
	apply(el: HTMLDivElement, plan: GridLayoutPlan): void;
}
```

- `viewportRenderer.mount()` builds layers from `LAYER_REGISTRY`; `syncLayoutPlan()` loops descriptors calling `apply`. Existing layers (group panel, header wrapper + 3 header sub-layers, sticky groups, rows, overlay) are migrated to descriptors with **identical** output (characterization-locked).
- New layers (status bar, pagination) are added by registering a descriptor + a renderer + styles — no edits to `mount`/`syncLayoutPlan` bodies.
- A guard test asserts every `.og-layer-*` element in the DOM corresponds to a registry entry, and that no renderer sets a layer `top`/`height` outside `apply`.

### C. `LayoutTransitionController` (WAAPI) — generalizes `SortAnimationController`

One controller owns all animated **discrete** layout deltas. Same three hook points already wired for sort:

- capture (before structural state change): `RenderInvalidationCoordinator` (`sortModel` today; add `expansion`, `groupBy`, `filterModel`, `columnPin`).
- play (after `recycleViewport`): `renderPaintCoordinator.fullPaintInternal` (`pendingSortAnimation` today → generalize to `pendingTransition`).
- cancel (on scroll start / data tick): `renderScrollCoordinator` (`sortAnimation.cancel()` today).

Mechanism = **WAAPI** (`element.animate(...)`), chosen for: per-element cancel/finish handles (`Animation.cancel()`, `.finished`), no forced reflow needed (replaces the `getBoundingClientRect()` hack in the FLIP play step), and composability with the steady-state `transform: translateY` (the animation's keyframes carry the full `translateY`, and on finish we commit the final transform inline then `cancel()` the animation).

Capture model (geometry-driven, **not** DOM-snapshot): record `Map<rowId, top>` and the set of rendered rowIds at capture time. After recycle to the **final** row set:

- **move**: rowId in both, `oldTop !== newTop` → `animate` from `translateY(oldTop)` to `translateY(newTop)`.
- **enter**: rowId in new only → `animate` opacity 0→1 (+ small `translateY` settle) at `newTop`.
- **exit**: rowId in old only → row's slot was recycled; see slot exit pool (D). Animate opacity 1→0 / height collapse, then release.

Gating (the hot-path guarantee): the controller only runs when `pendingTransition` was armed by a discrete state change. `recycleViewport(isScrollFrame=true)` never arms it. `cancel()` calls `Animation.cancel()` on every live handle and commits final transforms. The existing `og-is-scrolling` class still forces `transition:none`; WAAPI animations are explicitly cancelled in the scroll-start path so none survive into a scroll frame. **No animation/transition property is ever set on a scroll or tick frame.**

Reduced-motion: respect `prefers-reduced-motion` → durations collapse to 0 (instant), preserving correctness.

### D. Slot exit retention pool

Exit animation needs the removed rows' DOM to persist briefly. The fixed `RowSlotPool` recycles immediately. Add an **exit lane**: when a structural change removes visible rows and a transition is armed, the paint coordinator moves those slots' elements into a small `og-layer-exiting` holding set (kept positioned at their old top), animates them out via the controller, and releases them (portals + DOM) on `animation.finished` / `cancel()`. Hard rule: exit slots never re-enter the active pool and never participate in scroll recycling. If portal lifecycle for full-width (group/detail) rows can't support this cleanly, **STOP** and ship move+enter only (still 80% of the visual win) behind a sub-flag.

### E. Pinning unification + animation

1. **Unify geometry.** Add `columns.lanes` to the plan: `{ left: {width, colStart, colEnd}, center: {...}, right: {...} }`, derived once. Header pin layers and body pin lanes both consume `lanes` — single source of truth. Keep body lanes on `position: sticky` for steady-state (zero-lag compositor pinning is correct and free); the header must consume the **same** lane widths/origins from the plan (no independent JS math). A guard test asserts header lane widths == plan lane widths == body lane widths.
2. **Animate pin/unpin.** Pin/unpin moves a column's cells between center and a pin lane = a reparent. Animate via horizontal FLIP through the same `LayoutTransitionController`: capture each affected header+body cell's pre-reparent screen-x, reparent into the new lane, `animate` `translateX(oldX-newX)`→`0`; lane widths (`pinLeftWidth`/`pinRightWidth`) animate too. Gated off during scroll like everything else. If reparenting + sticky interact badly mid-animation, animate on a temporary absolute clone and swap on finish.

### F. Pagination + status bar as first-class layers

- New config: `pagination?: { pageSize, page, ... }`, `statusBar?: { panels: [...] }` (rowCount, selectedCount, aggregations, etc.). Heights feed `chrome.paginationHeight`/`statusBarHeight`.
- New layers `og-layer-status-bar`, `og-layer-pagination` registered in the registry, parented to `container` (fixed chrome, **not** scrolling), positioned from `origins.statusBarTop`/`paginationTop`.
- Keep group footers as full-width rows (that's correct domain modelling); the _status/pagination bars_ are chrome. Wire counts from the row model + selection state.

## Execution phases

### Phase 0: Characterization baseline

Add/extend pure layout-plan tests (`renderer/layoutPlan.test.ts`) and viewport DOM characterization (`renderer/renderEngine.test.ts`) capturing current values BEFORE refactor:

- chrome/origins exact values with and without group panel.
- Every `.og-layer-*` element present, their top/height/width.
- Header pin layer widths == plan pin widths.
- Sort animation still fires (mock WAAPI/`Animation`).
  Verify: `corepack pnpm --filter @eregister/open-grid-core test` exit 0.

### Phase 1: Four-edge chrome + layer registry (no behavior change)

- Extend `GridLayoutPlan.chrome`/`origins` (bottom fields default 0 — no pagination/status yet).
- Subtract `bottomChromeHeight` from render-window usable height + overlay height (0 today → no change).
- Introduce `LAYER_REGISTRY` + descriptors; migrate all existing layers; `mount`/`syncLayoutPlan` loop the registry.
- Guard test: DOM layers ⟺ registry; no out-of-`apply` layer positioning.
  Done: identical rendering, registry in place, plan has bottom fields. Tests + builds (core/react/demo) green.

### Phase 2: `LayoutTransitionController` (WAAPI) + slot exit pool

- New `renderer/layoutTransitionController.ts` (WAAPI). Port sort (move) first; delete `SortAnimationController` after parity, or keep file as thin re-export during migration.
- Generalize hooks: `pendingSortAnimation` → `pendingTransition`; capture set = rendered rowIds + tops.
- Add enter (opacity) + exit (slot exit pool D). `prefers-reduced-motion` → instant.
- Scroll/tick cancel cancels all WAAPI handles.
  Done: sort animation visually identical, now WAAPI; move/enter/exit primitives unit-tested; zero transition props on scroll frames (assert via test + a perf characterization).

### Phase 3: Expand/collapse animation

- Arm a transition on `expansion`/`groupBy` state change (group, tree, master-detail all funnel through expansion → pipeline → geometry).
- Container height set to final instantly (scrollbar correct); displaced rows animate via move; revealed rows via enter; collapsed rows via exit.
- Master-detail height: detail row enters with height/clip animation (inner wrapper documented as the one justified extra element).
  Done: collapse/expand of group/tree/detail animates; no jump; scroll during animation snaps cleanly. Demo page exercises all three.

### Phase 4: Pinning unification + animation

- Add `columns.lanes`; migrate header + body to consume it; guard test for equality.
- Animate pin/unpin via horizontal transition path; lane width animation.
  Done: header/body share lane geometry; pin/unpin animates; no header tearing; scroll unaffected.

### Phase 5: Pagination + status bar

- Config + `chrome` heights + registry layers + renderers + styles.
- Wire row/selected counts, page controls; emit page-change events.
  Done: status bar + pagination render as fixed bottom chrome from the plan; body height reserves them; new layers required zero edits to `mount`/`syncLayoutPlan` bodies (proves B).

### Phase 6: Remove legacy shortcuts

- Delete any remaining bespoke layer positioning, the FLIP `getBoundingClientRect` hack, `SortAnimationController` shim.
- Architecture guards: no magic chrome constants; new layout features must extend `GridLayoutPlan` + registry.

## Test strategy

1. **Pure layout tests** (most important): given viewport/rows/columns/chrome config, assert exact plan values incl. four-edge chrome + lanes + transition diffs (move/enter/exit sets from two row-id snapshots).
2. **Renderer characterization**: layer registry ⟺ DOM, WAAPI animation handles created/cancelled, no transition on scroll frame.
3. **React integration**: expand/collapse + pin demos, status bar counts.

## Commands

| Purpose     | Command                                                   | Success |
| ----------- | --------------------------------------------------------- | ------- |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0  |
| Core build  | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0  |
| React tests | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0  |
| React build | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0  |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0  |

## Scope

In: `packages/core/src/renderer/*`, `packages/core/src/models/GeometryModel.ts`, `rows/*` + `rowModel.ts` (expansion metadata only), `store.ts`/state + config types, `packages/react/src/GridPortal.tsx`, demo pages for grouping/detail/pinning/pagination. Out: pivot, server enterprise grouping semantics, large visual redesign.

## Review checklist — reject if it:

- Adds a magic pixel constant for any chrome/overlay/lane offset.
- Sets a transition/animation property on a scroll or data-tick frame.
- Leaves header and body pinning on independent geometry.
- Adds a `.og-layer-*` element not registered in the registry.
- Animates by DOM-snapshot where geometry/plan data is available.
- Changes public behavior without characterization tests.

## STOP conditions

- Exit animation for full-width (group/detail) portal rows requires a portal-manager rewrite → ship move+enter only, flag exit.
- Pin reparent + `position:sticky` interact badly mid-animation → animate on absolute clone, swap on finish.
- Render-window usable-height change destabilizes pinned-bottom math → keep bottom chrome additive and re-baseline characterization tests before continuing.

## Maintenance

After this lands, any new layout-affecting feature MUST start by extending `GridLayoutPlan` (+ tests) and registering a layer descriptor. Renderers must not invent structural offsets or set transitions on the hot path.
