# Plan 054: Multi-Level Column Headers — Demo, Polish, and Tests

> **Executor instructions**: The data model and core rendering for multi-level column headers is fully implemented. `buildHeaderBands()` produces `HeaderBandLayout[]` with correct spans, heights, and pin-lane routing. `headerRenderer.ts` renders group bands at lines 362-373 using `.og-header-group-cell`. This plan adds a real demo to surface and verify the feature, fixes the visual gaps found during that exercise, and adds test coverage.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW-MEDIUM — CSS layout changes affect the header band container; test carefully against resize + pinning interactions
- **Depends on**: nothing (core pipeline already produces correct data)
- **Category**: feature polish, demo, tests
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What already exists (do not re-implement)

| Component                                                 | File                                   | Status                               |
| --------------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| `ColumnDef.headerGroup?: string \| string[]`              | `columnDef.ts`                         | ✓ public API                         |
| `buildHeaderBands()`                                      | `renderer/layoutPlan.ts:127-248`       | ✓ full span computation              |
| `HeaderBandLayout` / `HeaderCellLayout` interfaces        | `renderer/layoutPlan.ts:12-36`         | ✓                                    |
| `totalHeaderHeight` / `columnGroupHeaderHeight` in chrome | `renderer/layoutPlan.ts:291-299`       | ✓ accounts for all bands             |
| `--og-total-header-height` CSS var                        | `renderer/viewportRenderer.ts:177-186` | ✓ set on mount + sync                |
| Group band rendering in `headerRenderer`                  | `renderer/headerRenderer.ts:362-373`   | ✓ iterates bands, routes by pin lane |
| `.og-header-group-cell` CSS class                         | `renderer/styles.ts:1021-1027`         | ✓ minimal styling exists             |
| Pin-zone boundary split                                   | `renderer/layoutPlan.ts:204-209`       | ✓ groups don't span pin zones        |

## Confirmed gaps

1. **No demo** — `headerGroup` is never used in `demo/src/`. Users cannot discover the feature.
2. **CSS is minimal** — `.og-header-group-cell` has only `font-size`, `letter-spacing`, `border-bottom`, `justify-content: center`, `cursor: default`. Missing: background differentiation from leaf row, left/right border between adjacent group cells, top-border for the first band, resize-handle suppression confirmation, column-drag highlight suppression.
3. **No test that exercises `buildHeaderBands` with real column data** against `headerRenderer` output. The only tests are unit-level layout-plan tests (`layoutPlan.test.ts`).
4. **Column resize reflow** — when a column under a group is resized, the group cell's `width` must recompute. This works because `syncLayoutPlan` is called on every column resize, but it is not explicitly tested.
5. **Horizontal scroll of group cells** — group cells are NOT virtualized (by design), but they DO scroll horizontally with the center lane. Verify they translate correctly.

## Phases

---

### Phase 1 — Demo Page

**New file**: `demo/src/pages/ColumnGroupHeaderDemo.tsx`

Create a financial-style dataset with naturally grouped columns:

```
Group: "Identity"     → Name, ID
Group: "Q1 Actuals"   → Q1 Revenue, Q1 Cost, Q1 Margin
Group: "Q2 Actuals"   → Q2 Revenue, Q2 Cost, Q2 Margin
Group: "Full Year"    → FY Revenue, FY Margin, YoY %
Ungrouped            → Status, Region
```

Also include a nested group example (2 levels deep):

```
Group: ["Financials", "Revenue"] → Q1 Rev, Q2 Rev, Q3 Rev
Group: ["Financials", "Cost"]    → Q1 Cost, Q2 Cost, Q3 Cost
Group: "Region"                  → APAC, EMEA, NA
```

Wire the demo into the demo app nav. The page should include:

- Toggle to switch between single-level and two-level grouping (`showNested` boolean)
- Pinning controls (to verify pin-zone boundary splitting works visually)
- Column resize handles (to verify group widths reflow)

**Acceptance**: Opening the demo shows group-band rows above the leaf row. Group cells are visually distinct from leaf cells. Resizing a column under a group widens/narrows the group cell. Pinning a column causes the group to split at the pin boundary.

---

### Phase 2 — CSS Polish

Polish `.og-header-group-cell` to be production-ready. Fix all gaps found in Phase 1.

**Target styles** (`renderer/styles.ts`):

```css
.og-header-group-cell {
	/* Existing */
	font-size: 12px;
	letter-spacing: 0.03em;
	border-bottom: 1px solid var(--og-border-color);
	justify-content: center;
	cursor: default;

	/* New */
	background-color: var(--og-group-header-bg, color-mix(in srgb, var(--og-header-bg) 90%, var(--og-accent) 10%));
	color: var(--og-group-header-text, var(--og-header-text));
	font-weight: 700;
	text-transform: uppercase;
	font-size: 10px;
	letter-spacing: 0.08em;
	border-right: 1px solid var(--og-border-color);
	/* suppress leaf-cell interactions */
	pointer-events: none;
}

/* Last group cell in each band should not double-border with pinned lane edge */
.og-header-group-cell:last-child {
	border-right: none;
}
```

Add CSS variables to the theme token set so themes can override group header appearance:

- `--og-group-header-bg`
- `--og-group-header-text`

Verify all 7 pre-built themes look correct with group headers.

**Border continuity**: Group cells use `absolute` positioning (same as leaf cells). Adjacent group cells will touch but not overlap — verify `border-right` on each cell doesn't double-border. If it does, use `box-sizing: border-box` + `width` that includes border.

---

### Phase 3 — Column Resize Reflow Test

Add a test to `layoutPlan.test.ts` (or a new `headerGroups.test.ts`) verifying the full resize-reflow cycle:

```ts
it('group cell width updates when a child column is resized', () => {
	// Build bands with columns [A(100px), B(100px)] under group "Revenue"
	// Resize A to 200px → recompute layout plan
	// Assert: Revenue group cell width = 300px (A+B)
});

it('group spanning pinned + center splits into two cells', () => {
	// columns: [A pinned-left, B center], both headerGroup: 'Sales'
	// Assert: two separate group cells, one pinned-left and one center
});

it('totalHeaderHeight = groupBandCount * GROUP_BAND_HEIGHT + LEAF_HEADER_HEIGHT', () => {
	// 0 groups → 40px; 1 group → 72px; 2 groups → 104px
});
```

---

### Phase 4 — Keyboard Navigation Guard

Column keyboard navigation (`ArrowLeft`/`ArrowRight` on header cells) should skip group-band cells — they are not interactive. Verify `columnInteractionController` does not attach drag listeners to group cells (it currently doesn't — `movable: false` prevents it, but add an explicit test).

```ts
it('group header cells have no resize handle or drag listener', () => {
	// Render group cells; assert no .og-header-resize-handle child
	// Assert no mousedown listener attached
});
```

---

### Phase 5 — Horizontal Scroll Verification

Group cells in the center lane must scroll left/right with the center lane container. Because group cells are `position: absolute` inside `.og-layer-header` (which translates on horizontal scroll), they should scroll automatically.

Verify:

- Scroll `.og-layer-header` 200px right → group cell `left` position is unaffected (the container moves, not individual cells).
- Pinned group cells (in `.og-layer-header-left` / `.og-layer-header-right`) do NOT translate — confirm they stay fixed.

If anything is wrong, fix `viewportRenderer.syncPinnedLayerPositions` to not touch the header group band layers.

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

Demo shows multi-level groups, all themes look correct, resize reflows group widths, pin-zone split works.

## Architecture constraints (do not violate)

- **Group cells MUST NOT span pin-zone boundaries** — this is a hard layout constraint enforced by `buildHeaderBands`. If a user sets the same `headerGroup` on a pinned and an unpinned column, two separate group cells render. This is correct behavior.
- **Group cells are NOT interactive** — no sort, filter, resize, drag. The `isLeaf: false` flag gates this everywhere.
- **Group cells are NOT virtualized** — they render regardless of horizontal scroll position. This is intentional (a group can span many columns and culling requires span-intersection math). OK for now; large-column virtualization of group bands is a future optimization.
- **Do not change `buildHeaderBands()` logic** — it is well-tested and correct.
- **Do not add a `headerGroup` to `InternalColumnDef`** — it lives on `ColumnDef` and is normalized by `ColumnModel`.
