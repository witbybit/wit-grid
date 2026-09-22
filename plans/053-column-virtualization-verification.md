# Plan 053: Column Virtualization — Verification, Demo, and Hardening

> **Executor instructions**: Column virtualization is already architecturally implemented — the render window tracks `colStart`/`colEnd`, `ViewportModel.getVisibleColumnRange()` computes the visible range via O(log C) binary search, and `rowCellBindingLanes.ts` binds only `centerColStart…centerColStart+centerColCount-1` cells per row. This plan verifies it actually works end-to-end, exposes it in a demo, and closes the remaining gaps.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — no architectural changes; this is verification + demo + test hardening
- **Depends on**: nothing (core already has the pipeline)
- **Category**: performance, verification, demo
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What already exists (do not re-implement)

| Component                        | File                                       | Status                             |
| -------------------------------- | ------------------------------------------ | ---------------------------------- |
| `RenderWindow.colStart / colEnd` | `renderer/renderWindow.ts:14-45`           | ✓ in struct                        |
| `getVisibleColumnRange()`        | `models/ViewportModel.ts:189-241`          | ✓ binary search, adaptive overscan |
| Center-lane column loop          | `renderer/rowCellBindingLanes.ts:165-209`  | ✓ `centerColStart + i`             |
| `rowRenderer` passes col range   | `renderer/rowRenderer.ts:348-350, 522-523` | ✓                                  |
| Header leaf-band virtualization  | `renderer/headerRenderer.ts:379-382`       | ✓ skips off-screen leaves          |
| `colBuffer` config               | `models/ViewportModel.ts:220`              | ✓ default 1                        |
| Adaptive col overscan            | `models/ViewportModel.ts:224-234`          | ✓ velocity-gated                   |

## Gaps to close

1. **No demo** — no showcase page exercises a wide grid (30+ columns). Users can't see or verify the feature.
2. **No DOM-count tests** — no test asserts that `DOM cell count ≈ visibleCols × visibleRows`, so a regression could silently undo the optimization.
3. **Filter chip bar + column focus** — not verified to work correctly when the focused/filtered column is outside the current colStart..colEnd range (e.g. filters on column 80 when viewing columns 0-15).
4. **`colBuffer` not surfaced in any demo config** — users don't know it exists.

## Phases

---

### Phase 1 — Wide Grid Demo

**Goal**: Ship a demo page with 100 columns that visually proves virtualization is working.

**New file**: `demo/src/pages/WideGridDemo.tsx`

Generate 100 numeric columns (`col_0` … `col_99`) and 500 rows of random float data. Show:

- A toolbar badge: `Visible columns: {colEnd - colStart + 1} / 100` (read from `api.getLayoutPlan().columns`)
- A `colBuffer` slider (1–8) wired to `GridApi` config update
- `overscanAdaptive` toggle

Wire the page into the demo app's sidebar nav.

**GridApi addition needed** — expose `getLayoutPlan()` if not already public, or add a `onLayoutPlanChange` event so the demo can read `colStart`/`colEnd` without polling.

Check if `GridApi` already exposes the layout plan. If not, add:

```ts
// GridApi.ts
getLayoutPlan(): Readonly<GridLayoutPlan>;
```

and forward it in `store.ts`, `createGrid.ts`, `createGridPluginRuntime.ts`.

**Verification target**: With 100 columns and viewport showing ~10, the toolbar badge must show ≤ 14 (10 + 2×colBuffer=1 + overscan). If it shows 100, virtualization is broken.

**STOP**: If the badge shows 100 regardless of scroll, investigate `computeRenderWindowInto` — the column range may not be flowing into the layout plan correctly.

---

### Phase 2 — DOM-Count Architecture Guard Tests

**Goal**: Lock in the column virtualization contract with a failing test that would catch a regression.

**New test block** in `packages/core/src/renderer/renderWindow.test.ts` (or a new `columnVirtualization.test.ts`):

```ts
describe('column virtualization', () => {
	it('center lane cell count = centerColCount not totalColCount', () => {
		// Set up a grid with 50 columns, viewport showing 10
		// Assert: rendered center cells per row = colEnd - colStart + 1 (≈10-12)
		// Assert: rendered center cells per row ≠ 50
	});

	it('scrolling updates colStart/colEnd correctly', () => {
		// Scroll right by totalWidth/2, assert colStart > 0
	});

	it('pinned columns excluded from virtualization range', () => {
		// 2 left-pinned + 50 center + 2 right-pinned
		// Assert pinned cols always in DOM; center cols virtualized
	});
});
```

---

### Phase 3 — Filter / Column-Focus Correctness with Virtualization

**Goal**: Verify that filters, focus, and selection on out-of-viewport columns work correctly.

Checks to do (manual + test):

1. **Filter on hidden column**: Set a filter on `col_80` while viewing `col_0`–`col_15`. Filter chip should appear; `col_80` cells should not be in DOM. Scrolling to `col_80` should show the cells with the correct filtered state.

2. **Cell focus on hidden column**: `api.scrollToColumn('col_80')` should bring `col_80` into viewport. Verify the scroll fires and the column becomes visible.

3. **Column resize of hidden column**: `api.resizeColumn('col_80', 200)` — verify the column width updates in geometry even though the column is not currently rendered.

Fix any failures found.

---

### Phase 4 — colBuffer Documentation + Defaults Review

Review whether `colBuffer = 1` is the right default for a finance grid where columns are typically narrow (80-120px) and horizontal swipes are fast. Consider bumping default to 2. Document the tradeoff in the config type comment.

```ts
// columnDef.ts or GridEngineConfig
/**
 * Number of off-screen columns to pre-render on each side of the visible range.
 * Higher values smooth fast horizontal scrolls at the cost of more DOM nodes.
 * Default: 2.
 */
colBuffer?: number;
```

---

## Verification gate

After all phases:

```
pnpm -F @eregister/wit-grid-core build
pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build
pnpm -F @eregister/wit-grid-react test
pnpm -F demo-app build
```

Wide grid demo loads, badge shows `≤ 20` visible cols for a 100-column grid, scroll is smooth.

## STOP conditions

- **Do not** change the binary-search geometry path (`getColIndexAtOffset`) — it is O(log C) and correct.
- **Do not** add a separate "column render window" struct — `RenderWindow.colStart/colEnd` is the canonical source.
- **Do not** virtualize pinned lanes — they are O(pinCount) and always bounded.
- **Do not** virtualize header group-band cells — group cells span multiple columns; culling requires span-intersection logic that is out of scope here.
