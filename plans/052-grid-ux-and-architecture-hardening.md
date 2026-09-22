# Plan 052: Grid UX and Architecture Hardening

> **Executor instructions**: Follow phases in order. Run verification after each phase.
> Update `plans/README.md` status row when done.
> Drift check: `git diff --stat 5181f1a4..HEAD` before starting each phase.

## Status

- **Priority**: P1
- **Effort**: M (4 phases, ~4 hrs total)
- **Risk**: LOW–MEDIUM (Phase 3 touches scroll hot-path)
- **Depends on**: none
- **Planned at**: commit `5181f1a4`, 2026-06-15

## Phases

| #   | Title                                 | Effort | Risk   |
| --- | ------------------------------------- | ------ | ------ |
| 1   | `getAllValidationErrors()` public API | XS     | LOW    |
| 2   | Filter chip click-to-edit             | S      | LOW    |
| 3   | Per-row version map                   | M      | MEDIUM |
| 4   | `rowRenderer.ts` decomposition        | M      | LOW    |

---

## Phase 1 — `getAllValidationErrors()` public API

### Why

`hasValidationErrors()` returns a boolean. There is no way to read the current error
map without either iterating every known cell with `getCellValidationError()` or
re-running `validateGrid()` (which triggers re-validation). The sparse error map
already lives at `state.validationErrors?: Record<string, string>`; we just need to
expose it.

### Files

- `packages/core/src/api/GridApi.ts`
- `packages/core/src/store.ts` (facade forwarding)
- `packages/core/src/features/ValidationManager.ts`

### Steps

1. Add to `GridApi` interface (after `hasValidationErrors`):

    ```ts
    /**
     * Returns all current validation errors as an array.
     * Does NOT re-run validation — reads the current state snapshot only.
     */
    getAllValidationErrors(): CellValidationError[];
    ```

2. Implement in `ValidationManager`:

    ```ts
    public getAllValidationErrors(): CellValidationError[] {
        const errors = this.ctx.stateManager.getState().validationErrors ?? {};
        return Object.entries(errors).map(([key, error]) => {
            const colonIdx = key.indexOf(':');
            return { rowId: key.slice(0, colonIdx), colField: key.slice(colonIdx + 1), error };
        });
    }
    ```

3. Wire in `store.ts` facade alongside existing `hasValidationErrors` delegation.

### Verification

- `pnpm -F @eregister/wit-grid-core test` — all pass
- `pnpm exec tsc --noEmit` — no errors

---

## Phase 2 — Filter chip click-to-edit

### Why

Filter chip bar chips are display-only. Clicking a chip does nothing — the user must
navigate to the column header to edit the filter. The natural UX is: click a chip →
the column's filter popover opens anchored to the chip element. This works without any
sidebar; `HeaderMenuController` already manages the built-in floating filter+sort
popover.

The gap: `HeaderMenuController.show(headerCell, colField)` requires the actual header
`<th>` DOM element as the positioning anchor. We add `showForField(colField, anchorEl)`
which uses an arbitrary anchor element (the chip div) instead.

### Files

- `packages/core/src/renderer/headerMenuController.ts`
- `packages/core/src/renderer/filterChipBarRenderer.ts`

### Steps

1. **`headerMenuController.ts`**: add `showForField(colField: string, anchorEl: HTMLElement)`:
    - Reads `anchorEl.getBoundingClientRect()` as the positioning rect
    - Calls the same internal build logic as `show()` — extract the rect-dependent part
      into a private `_showWithRect(rect, colField)` so both paths share it
    - `show(headerCell, colField)` becomes `_showWithRect(headerCell.getBoundingClientRect(), colField)`
    - `showForField(colField, anchorEl)` calls `_showWithRect(anchorEl.getBoundingClientRect(), colField)`
    - Toggle behaviour: if `activePopover` is open and the same `colField` is requested
      via `showForField`, close it (match existing toggle semantics of `show()`)

2. **`filterChipBarRenderer.ts`**: wire a `headerMenuController` reference and add chip click:
    - Constructor/deps: accept `headerMenuController: HeaderMenuController<TRowData>`
    - In the chip build loop, add a click listener on the chip's label span (NOT the × button):
        ```ts
        chipLabel.addEventListener('click', () => {
        	this.headerMenuController.showForField(colField, chipEl);
        });
        chipLabel.style.cursor = 'pointer';
        ```
    - Pass `headerMenuController` from wherever `FilterChipBarRenderer` is constructed
      (trace to `renderEngine.ts`).

3. Add `og-filter-chip:hover` cursor pointer to `styles.ts` so chips look interactive.

### Verification

- `pnpm -F @eregister/wit-grid-core test` — all pass
- `pnpm exec tsc --noEmit` — no errors

---

## Phase 3 — Per-row version map

**STATUS: ALREADY IMPLEMENTED** (discovered during code audit before execution).

`GridEngine.rowVersions: Map<string, number>` exists and is live:

- Populated by `CellNotificationController` (bumps per-row on cell changes)
- Threaded through `renderEngine.ts` and `renderScrollCoordinator.ts` into `ScrollRenderContext.rowVersions`
- Read in `rowCellBinder.ts` lines 442–446 for the per-row thaw check
- `CellSlot.lastMountedRowVersion` tracked alongside `lastMountedGlobalVersion`

No work needed. Skipped.

---

## Phase 4 — `rowRenderer.ts` decomposition

### Why

`rowRenderer.ts` was 654 lines. Plans 020–023 extracted cell binders, lane helpers,
runtime adapters, and the runtime bridge, but the file remained oversized.

### What was done

- **`PinnedContainerManager`** (`pinnedContainerManager.ts`, new): the
  `ensurePinnedContainer(slot, side, width)` logic moved to its own class.
  `RowRenderer` holds a `private readonly pinnedContainers` instance and delegates
  with a 3-line wrapper. Saves ~44 lines.
- `RowRendererScrollStats` extraction was **rejected**: scroll-stat fields are
  directly written by `renderScrollCoordinator.ts`, `rowRendererRuntime.ts`, and
  `renderTelemetry.ts` (20+ external write/read sites). Wrapping them in a class
  would require updating all callers — too much blast radius for this phase.
- `bindSlotRow` inner-loop extraction was **rejected**: the per-slot body needs
  `this.selectionPaint`, `this.dirtyRowsAfterScroll`, `this.engine`, and all
  loop-invariant locals. Passing them via an opts struct creates a per-`recycleViewport`
  allocation and verbose plumbing with no correctness benefit.

### Outcome

`rowRenderer.ts`: **654 → 612 lines**. The file is now a focused slot-lifecycle
shell. Further reduction requires extracting `recycleViewport` sub-logic (which is
tightly coupled to `this.*`) or a broader refactor of the stats callers — deferred.

### Verification

- `pnpm -F @eregister/wit-grid-core test` — 659/659 pass
- `pnpm -F @eregister/wit-grid-react test` — 70/70 pass

---

## Done criteria

- [x] `getAllValidationErrors()` exists on `GridApi`, returns current errors without re-validating
- [x] Clicking a filter chip label opens the column's filter popover anchored to the chip
- [x] `rowVersions: Map<string, number>` was already implemented — confirmed in GridEngine + rowCellBinder
- [x] `rowRenderer.ts` reduced 654 → 612 lines; `pinnedContainerManager.ts` extracted
- [x] `pnpm -F @eregister/wit-grid-core test` — 659/659 pass
- [x] `pnpm -F @eregister/wit-grid-react test` — 70/70 pass
- [x] `plans/README.md` updated
