# Plan 050: Rendering & layout pipeline hardening

> **Executor instructions**: This plan fixes correctness bugs across the pin lanes, the
> scroll/recycle pipeline, and the custom-cell portal path, then hardens the underlying
> architecture so they cannot regress. Keep every hot-path guarantee from prior plans:
> no per-cell user callbacks or unguarded DOM writes on scroll/data-tick frames; the
> `runtimePerformance.test.ts` scroll invariants (`cellsWrittenDuringScroll === 0` on
> bailout frames, no `getCellValue`/`stateReads`/`customRendererMounts` during scroll)
> must stay green.

## Status

- **Priority**: P0 (core rendering quality — "not professional grid quality" per user)
- **Effort**: L (multi-file; correctness + architectural unification)
- **Risk**: MEDIUM–HIGH (touches scroll recycle, pin geometry, portal lifecycle)
- **Planned at**: 2026-06-14
- **Status**: IMPLEMENTED 2026-06-14 (Phases 1-3 landed; tests/builds green; pending foreground browser confirmation)
- **Decisions (user)**: (1) **gate off the Plan 044 pin animation** until the pin geometry is solid — keep the code, disable the trigger so pinning is instant + correct; (2) **full hardening in one effort** (Phases 1–3 together).

## Problem (observed in a real browser)

1. **Pinned columns are broken**:
    - On horizontal scroll, unpinned (center) columns visually **overlap / paint over** the pinned columns.
    - **Right-pinned** column headers are **horizontally misaligned** with their body cells (and borders don't line up).
    - On pinning, the pinned area appears **blank**.
    - Applying more pins makes column **headers animate over each other** — glitchy/messy.
2. **PageUp → blank viewport**: after the new keyboard nav, PageDown scrolls + renders fine, but PageUp scrolls up and the **visible area is blank**.
3. **Custom (React) cells go stale on horizontal scroll**: some custom cells show the wrong/old value during horizontal scroll, and only **render correctly after a click**.

User's framing: the rendering + layout pipeline is not yet rock-solid / professional-grid quality; the layer-registry work (Plan 039) fixed a lot but on-scroll rendering of grid components is still subpar. Harden it.

## Root-cause diagnosis (from three focused investigations)

### A. PageUp / Ctrl+Home blank — programmatic-scroll double-write (PRE-EXISTING)

`renderViewportCoordinator.ts` `scrollCellIntoView` (~lines 70–73) writes **both** the DOM scrollTop (`scrollEngine.scrollTo`) **and** the model scrollTop (`engine.viewport.setScrollPosition`) to the same value. The viewport recycle is driven only by the DOM `scroll` event → `RenderScrollCoordinator.onScroll` → `viewport.setScrollPosition(...)`, which **returns `false` (no change)** because the model was already set, and **bails before `requestScrollFrame()`** (`renderScrollCoordinator.ts:84-85`). No frame → no `recycleViewport` → no rows bound → blank.

Directional because: PageDown's `computeScrollTarget` overshoots (`scrollIntoView.ts`, subtracts `topChromeHeight`), the browser **clamps** the DOM scrollTop to a smaller value → DOM vs model mismatch → a frame _does_ fire. PageUp's target is exact + in-range → DOM == model → frame suppressed → blank. **Same failure class as Ctrl+Home (target = 0)** and any "scroll to exact position" API. Not the ARIA changes; the new keys just exposed it.

Evidence: `renderViewportCoordinator.ts:70-73`, `renderScrollCoordinator.ts:84-85`, `scrollIntoView.ts:65-68`, `ViewportModel.ts:88-107`.

### B. Custom cells stale on horizontal scroll — deferred-flush gap + stale value source (PRE-EXISTING)

In `rowCellBinder.ts` `bindCellDuringScroll`, the **new-column mount branch** (~lines 430–454, taken when a slot slides to a different column during horizontal scroll) does two wrong things:

1. Mounts the portal with `value: getScrollMountValue(...)`, which returns `getCachedDisplayValue(node.id, col.field)` and **falls back to `cellSlot.lastFormattedValue` (the previous column's value, or `''`)** on a cache miss (value-getter/formula columns always miss). → wrong value painted.
2. **Never calls `markCellDirtyAfterScroll(cellSlot.element)`** — unlike the frozen branch (line ~428). So `decorateDirtyCellsAfterScroll` (post-scroll → `bindCellFull` with the real `access.value`) **never reconciles these cells**. A click routes through focus/selection → `bindCellFull` → real value, which is why it "fixes on click."

Portal identity/keys are correct (`createSlotRendererKey(slotId, colField)` includes the column); this is **not** a key/re-mount bug. Evidence: `rowCellBinder.ts:100-109` (getScrollMountValue), `:388-454` (scroll bind branches), `rowRenderMaintenance.ts` (decorateDirtyCellsAfterScroll), `rowRenderer.ts:326` (`colsEntered` only bumps stats, never marks dirty).

### C. Pinned-column overlap + misalignment — two coordinate systems (PRE-EXISTING)

The grid pins headers and bodies with **two different coordinate systems**:

- **Header pins**: three overlapping absolute layers JS-positioned every scroll frame via `style.left`/`style.transform` (`headerRenderer.ts` `syncPinnedLayerPositions`, ~83-109).
- **Body pins**: per-row `position: sticky` containers positioned natively by the compositor (`rowRenderer.ts` `ensurePinnedContainer`; `styles.ts` sticky rules).

Two defects:

- **C1 — center overlaps pinned (z-banding)**: each `.og-row` has `transform: translateY(...)` → its own stacking context. The pinned lane is `z-index: 3` (`styles.ts:668,672,693`), but a focused (`z:20`) or editing (`z:30`) center cell (`styles.ts:776,786`) outranks it within the row, so the center cell paints over the pinned lane on scroll.
- **C2 — right-pin header/body misalignment**: body right-pin screen-X = `(clientWidth − pinRightWidth) + (colLefts[c] − pinRightBaseLeft)` (sticky `right:0` anchors to the scroll viewport **clientWidth**, excludes scrollbar). Header right-pin screen-X = `max(pinLeftWidth, viewportWidth − pinRightWidth) + (colLefts[c] − pinRightBaseLeft)` (`headerRenderer.ts:103,191`), where `viewportWidth` is the **container box width (includes the scrollbar)**. Two divergences: the extra `max(pinLeftWidth, …)` term, and `viewportWidth` vs `clientWidth`. The overlay renderer already matches the body (`overlayRenderer.ts:173`), so the **header formula is the outlier**.

### D. Pin animation blank + glitch — Plan 044 clone-and-swap fights the recycler (REGRESSION)

`layoutTransitionController.ts` `beginColumnPin` sets `visibility: hidden` on the real moved cells, restored only on the clone's `onfinish` (~280ms). But: (a) the `pinnedColumns` subscription's own geometry/viewport invalidation forces a `recycleViewport` that rebinds those cells, and **no rebind path ever clears `style.visibility`** (`cellSlot.ts` hot path / `update()` don't touch it; only `unbindCold` does) → cells stuck hidden → blank. (b) Pinning swaps a column from the center lane (element removed) to a sticky lane (fresh element created), so the captured rect identity diverges. (c) Rapid re-pins call `clearPinClones()` mid-flight → glittery overlap. Confirmed: only `layoutTransitionController.ts` ever writes `style.visibility`.

## Plan

### Phase 1 — Targeted correctness fixes

Implementation note (2026-06-14): Phase 1 landed. The original Plan 044 clone-and-swap pin animation was removed and replaced with a semantic post-layout pin effect; programmatic scroll now writes the DOM and explicitly schedules a scroll frame instead of pre-writing the model; horizontal-scroll portal mounts no longer reuse a previous column's value on cache miss and are marked dirty for post-scroll reconciliation; pinned lanes were moved into a higher z-band.

**1.1 Replace the brittle pin animation (Decision updated).** Remove the clone-and-swap FLIP path entirely. The `pinnedColumns` subscription keeps its geometry/viewport/header invalidation so pinning repaints correctly and instantly; Plan 044 now adds only a subtle semantic CSS effect after the committed layout.

**1.2 Programmatic scroll single-source-of-truth (fixes #1 / A).** In `renderViewportCoordinator.scrollCellIntoView`, stop pre-writing the model scrollTop; let the DOM `scroll` event remain the single source that drives the recycle. Additionally guarantee a frame for the exact-position case (e.g. explicitly request a scroll frame / `invalidateViewport` after a programmatic jump) so Ctrl+Home (target 0) and any scroll-to-exact-row also recompute the window. Verify no synchronous reader depends on the model scrollTop being set in the same tick.

**1.3 Scroll portal reconciliation + value (fixes #3 / B).** In `bindCellDuringScroll`'s new-column mount branch, call `deps.markCellDirtyAfterScroll(cellSlot.element)` (mirroring the frozen branch) so post-scroll `decorateDirtyCellsAfterScroll` reconciles via `bindCellFull`. Also fix `getScrollMountValue` so cache misses never fall back to the previous column's `lastFormattedValue`; for value-getter/formula columns it uses an empty placeholder during the scroll frame and relies on the post-scroll full bind for the authoritative value, preserving the no-user-callbacks scroll invariant.

**1.4 Pinned-lane z-banding (fixes #3a / C1).** Raise the body pinned lane (`.og-row-pin-left/right` + pinned cells) to a stacking band above the focused/editor ceiling (> 30) so pinned cells always paint above scrolling center cells. Ensure focused/editing **within** a pinned cell still layers correctly. Keep header bands consistent.

### Phase 2 — Pin geometry unification

Implementation note (2026-06-14): Phase 2 landed with `viewport.clientWidth` in `GridLayoutPlan` and a shared `getRightPinnedLaneScreenLeft(...)` helper. Header and overlay now use the same right-lane screen origin as the sticky body lane, and scroll clamps / visible column range / keyboard scroll targeting consume the scrollbar-corrected width.

**2.1 One right-lane screen anchor (fixes #3b / C2).** Introduce a single helper that computes the right-lane screen origin from the scroll viewport's actual `clientWidth` (scrollbar-corrected), and make header, body, and overlay all consume it. Drop the header's extra `max(pinLeftWidth, …)` term and its scrollbar-inclusive `viewportWidth`. Header and body then share one origin and cannot drift.

**2.2 Lane geometry as the single source.** Audit every place that computes a pin X/width independently (`headerRenderer`, `rowCellBindingLanes`, `overlayRenderer`, `columnInteractionController`) and route them through `columns.lanes` (Plan 039 Phase 4a) so there is exactly one source for left/right lane origins + widths. Add a guard test that the header and body right-lane origins are equal.

### Phase 3 — Pipeline robustness guarantees

Implementation note (2026-06-14): Phase 3 landed for the known failure classes. Newly mounted portal cells during scroll are reconciled after scroll, exact programmatic jumps always schedule an authoritative window recompute, and `CellSlot` clears stale `visibility` on rebind/unbind so transient animation state cannot survive recycling.

**3.1 Universal post-scroll reconciliation.** Guarantee that **every** cell newly bound during a scroll frame with a possibly-stale value — vertical (new row) _and_ horizontal (new column) — is marked dirty and reconciled by the post-scroll `bindCellFull` pass. Centralize so a future code path can't silently skip it.

**3.2 Programmatic scroll contract.** Make programmatic scroll always produce exactly one authoritative window recompute regardless of whether the target equals the current position (covers scroll-to-row API, jump-to-selection, Ctrl+Home/End, PageUp/Down).

**3.3 Stuck-visibility safety.** Ensure no transient renderer state (`visibility`, transforms, etc.) set by an animation/overlay can survive a recycle — the rebind/`unbindHot` path must reset it (so a future re-enabled pin animation, or any overlay, can't leave a cell hidden). This is the structural fix that makes Decision 1's animation safe to re-enable later.

## Verification

- Per-fix unit/integration tests in jsdom (ARIA-style deterministic assertions where possible):
    - programmatic scroll: a large upward `scrollCellIntoView` jump recomputes the window / binds rows (no blank); Ctrl+Home (target 0) recomputes.
    - portal reconciliation: a horizontal-scroll new-column bind marks the cell dirty; post-scroll reconcile uses the real value.
    - z-banding: assert the pinned lane's effective z-band > focused/editor (computed-style or rule presence).
    - right-lane anchor: header right-lane origin == body/overlay right-lane origin (guard test).
- Full suite: `corepack pnpm --filter @eregister/wit-grid-core test` + `--filter @eregister/wit-grid-react test`.
- **Hot-path guard**: `runtimePerformance.test.ts` + `serverRuntimePerformance.test.ts` must stay green (no new scroll-frame writes/reads).
- Builds: core + react + demo.
- **Browser caveat**: this host can't run the live grid (preview tab hidden → RAF paused; Control_Chrome is macOS-only). The fixes are asserted via jsdom + characterization tests; the user verifies the visuals (pin alignment/overlap, PageUp, custom-cell scroll) in a foreground browser.

## Scope

In: `renderer/renderViewportCoordinator.ts`, `renderer/renderScrollCoordinator.ts`, `renderer/scrollIntoView.ts`, `renderer/rowCellBinder.ts`, `renderer/rowRenderMaintenance.ts`, `renderer/headerRenderer.ts`, `renderer/rowCellBindingLanes.ts`, `renderer/overlayRenderer.ts`, `renderer/layoutPlan.ts` (lane anchor helper), `renderer/cellSlot.ts` (visibility reset), `renderer/styles.ts` (z-band), `renderer/layoutTransitionController.ts` + `renderPaintCoordinator.ts` + `RenderInvalidationCoordinator.ts` (044 gate). Out: re-enabling the pin animation (separate follow-up once 2.x + 3.3 land), new features.

## Risks & mitigations

- **Scroll change touches the hottest path** → keep `runtimePerformance` invariants green; prefer additive guarded changes; verify both directions + programmatic + wheel scroll paths.
- **Pin geometry change could shift correct cases** → introduce the shared anchor behind a guard test asserting header==body==overlay before/after; keep `columns.lanes` the only source.
- **z-band change could hide focused pinned-cell affordances** → verify focused/editor inside pinned lanes still layer above sibling pinned cells.
- **Can't visually verify here** → comprehensive jsdom + characterization coverage; explicit hand-off for foreground-browser confirmation.

## Follow-up (separate plan)

- Tune the Plan 044 semantic pin effect if the foreground browser pass wants it slightly stronger or softer.
- Consider collapsing the two pin coordinate systems entirely (header also sticky, or body also JS-positioned) so there is literally one positioning mechanism — larger, evaluate after 2.x.
