# Plan 103 Direct-Write Inventory

Updated: 2026-06-18

This is the first checked-in inventory for the Plan 103 convergence pass. It records the remaining production files that still perform raw `setState` or invalidation writes outside the canonical typed-command path.

## Newly converted in this pass

- `renderer/floatingFilterRenderer.ts`
  Converted floating-filter mutations from renderer-owned `stateManager.setState(...)` + manual invalidation to `engine.setFilterModel(...)`.
- `renderer/paginationBarRenderer.ts`
  Converted client pagination page changes from renderer-owned state/event mutation to `engine.setPaginationPage(...)`.
- `store.ts`
    - Converted `setShowFloatingFilters(...)` from a direct state write to `engine.setShowFloatingFilters(...)`.
    - Converted hidden-column filter cleanup to `engine.setFilterModel(...)`.
    - Converted bulk row-height setters to `engine.setRowHeights(...)` / `engine.setDefaultRowHeight(...)`.
- `engine/createRowModelRuntimes.ts`
  Centralized runtime bootstrap/loading/pagination writes behind named `GridEngine` allowlist methods so the factory no longer mutates state directly.
- `engine/GridEngine.ts`
  Converted `setData(...)`, range-selection commits, and row-model registration side effects onto `GridChangeApplier`.
- `features/GridStateFeatureController.ts`
  Removed the legacy fallback branch so UI-state feature writes now require `GridChangeApplier`.
- `engine/GridEngine.ts`
  Converted row-model helper commits (`initializeRowModelState`, `bumpRowModelGlobalVersion`, `updateExpansionState`, `setRowModelLoadingState`, `setServerPaginationState`) onto typed changes with render suppressed.
- `viewportController.ts`
  Converted visible-range synchronization to `engine.setVisibleRanges(...)` so viewport runtime no longer writes raw state directly.

## Current allowlist

The source-of-truth allowlist lives in [packages/core/src/engine/gridDirectWriteAllowlist.ts](/C:/Users/rishi/witbybit/wit-grid/packages/core/src/engine/gridDirectWriteAllowlist.ts:1).

## Remaining hot spots to convert next

- `engine/GridEngine.ts`
  Bootstrap and legacy public facade helpers such as generic `setState(...)` still contain direct writes.
- `store.ts`
  Legacy facade compatibility still exists, but row overscan plus panel/chart/theme/pin sync now route through typed engine intent methods.
  The dead private `state` setter has been removed; the remaining escape hatch is the explicit public `setState(...)` compatibility API.
- `renderer/RenderInvalidationCoordinator.ts`
  State-reaction invalidation remains active and will be reduced in Plan 105.

## Immediate count reduction from this pass

- Removed 8 renderer/store direct logical mutation sites:
    - `floatingFilterRenderer.ts`: 3
    - `paginationBarRenderer.ts`: 1
    - `store.ts`: 4
