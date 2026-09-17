# Plan 157: Interaction Kernel Hardening

> **Executor instructions**: Follow this plan as a demolition-and-replacement architecture program, not as feature polish. The target is one authoritative interaction kernel in `@eregister/open-grid-core` that owns focus, navigation, selection, range, editing, clipboard routing, and accessibility derivation. Do not preserve parallel legacy interaction paths for compatibility convenience. Open Grid is in alpha; prefer clean replacement over compatibility clutter.
>
> **Drift check (run first)**: `git diff --stat 3824a049..HEAD -- packages/core/src/api packages/core/src/engine packages/core/src/models packages/core/src/features packages/core/src/renderer packages/core/src/navigation.ts packages/react/src/GridView.tsx packages/react/src/hooks.tsx packages/react/src/gridPortalHosts.tsx packages/react/src/GridPortal.tsx`
> If any in-scope seam changed since this plan was written, compare the "Current state" section against the live code before proceeding. Any mismatch in interaction identity, renderer ownership, or adapter responsibilities is a STOP condition until reconciled.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: `plans/113-unified-grid-commit-kernel.md`, `plans/131-commit-kernel-write-path-unification.md`, `plans/156-row-model-completion-and-public-row-node-facade.md`
- **Category**: architecture
- **Planned at**: commit `3824a049`, 2026-07-09

## Why this matters

Plans 154, 155, and 156 hardened renderer identity, live overscan correctness, and row-model/load-state authority. The next weakest core layer is interaction. Today the grid already routes many writes and selection commits through central core owners, but focus, navigation, editing lifecycle, and DOM event orchestration are still split across multiple owners and still rely too heavily on `rowId + colField` identity.

That is the exact failure mode that makes a grid feel toy-grade even when virtualization is strong: wrong cell focus after column duplication or reorder, editor state tied to a field instead of a column instance, selection/range drift under virtualization, and React adapter logic owning semantic behavior that should belong to core. This plan hardens interaction into one authoritative kernel so the renderer only reflects interaction state and the React adapter only assembles DOM and portals around core-owned behavior.

## North star

Final architecture must obey:

```txt
DOM event
→ runtime event resolver
→ InteractionKernel command
→ authoritative core state update
→ invalidation / event publication
→ renderer reflects interaction state

Focus/edit/range identity:
  rowId + columnInstanceId

Row selection identity:
  rowId

Viewport navigation:
  RowModelViewportAccess + columnInstanceId

Editing writes:
  InteractionKernel
  → GridCommitKernel / canonical write path
  → row model + integrity + invalidation ownership

React adapter:
  thin event forwarding + portal/editor assembly only

No parallel navigation stacks.
No adapter-owned semantic interaction state.
No compatibility hub preserving deprecated field-based identity internally.
```

## Current state

The following excerpts describe the live interaction architecture this plan replaces.

- [packages/core/src/api/GridApi.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/api/GridApi.ts) defines public interaction state and still uses field-based cell identity:
    - `GridCellPointer { rowId, colField }` at lines 82-85
    - `ActiveEditState extends GridCellPointer` at lines 87-89
    - `GridSelectionState` with `focus`, `anchor`, `range`, and `bounds` at lines 192-198

- [packages/core/src/models/SelectionModel.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/models/SelectionModel.ts) owns cell selection/range state mechanics, but range bounds still convert through row id + field:
    - `calculateRangeBounds(...)` maps `range.start.colField` / `range.end.colField` to displayed column indexes at lines 70-90
    - invalidated cells are keyed as `${rowId}:${colField}` at lines 183-188

- [packages/core/src/models/EditModel.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/models/EditModel.ts) is only a shallow pointer holder:
    - `private activeEdit: GridCellPointer | null = null` at lines 3-4
    - there is no `draftValue`, `originalValue`, `startedBy`, `version`, or lifecycle state machine

- [packages/core/src/navigation.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/navigation.ts) is the current keyboard/pointer navigation owner:
    - pointer and keyboard commands are driven directly through `GridPluginRuntime`
    - focus/edit/range movement is all field-based, via `GridCellPointer`
    - `PageUp` / `PageDown` currently use a fixed `const page = 10` heuristic at lines 182-188
    - printable-character editing, deletion, clipboard routing, selection drag, and edit movement all live here

- [packages/core/src/engine/GridEngine.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/engine/GridEngine.ts) already provides a strong central commit seam:
    - `applySelectionRange(...)` performs core-owned selection/focus commit and invalidation at lines 1288-1348
    - row-selection commands route through `RowSelectionFeatureController` at lines 1260-1285
    - clipboard API calls route through `ClipboardController` at lines 945-952

- [packages/core/src/engine/GridProjectionPipeline.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/engine/GridProjectionPipeline.ts) currently normalizes selection/editing validity after row-model changes:
    - `normalizeSelectionState(...)` clears or collapses selection when pointers go invalid at lines 216-243
    - `normalizeActiveEdit(...)` nulls editing when row or column disappears at lines 245-253
    - this normalization still uses row id + field, not row id + column instance id

- [packages/core/src/features/EditingFeatureController.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/features/EditingFeatureController.ts) already routes committed writes through core authority:
    - `startEdit(...)` / `stopEdit(...)` own edit-start / edit-stop invalidations and events at lines 63-98
    - `commitEdit(...)` validates and commits through `ctx.applyChange(...)` at lines 100-185
    - but committed edit identity is still `rowId + colField`, and the controller does not own draft/original state

- [packages/core/src/features/RowSelectionFeatureController.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/features/RowSelectionFeatureController.ts) is already relatively solid:
    - row-selection gestures are core-owned and row-model-scope-aware at lines 13-153
    - this should be folded into the final kernel rather than reimplemented in the adapter

- [packages/core/src/features/ClipboardController.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/features/ClipboardController.ts) currently derives copy/paste from selection bounds + displayed columns:
    - copy/paste start from `selection.focus` and `selection.bounds` at lines 38-77
    - paste iterates visible rows + displayed columns using field-based column access at lines 89-119
    - this is structurally good, but it still depends on field/index identity rather than instance identity

- [packages/react/src/GridView.tsx](/C:/Users/rishi/witbybit/open-grid/packages/react/src/GridView.tsx) currently owns too much interaction assembly:
    - global `keydown` / `mouseup` / `mousedown` activity tracking is wired in the adapter at lines 246-294
    - the adapter resolves `.og-cell` DOM targets to logical pointers at lines 296-303
    - the adapter manually focuses cells and forwards mouse/click/double-click/contextmenu behavior to the navigation plugin at lines 305-430
    - this is the clearest sign that interaction orchestration is not yet core-owned enough

- [packages/core/src/renderer/selectionPaintManager.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/renderer/selectionPaintManager.ts) still owns row-selection click behavior inside a renderer-facing class:
    - delegated viewport click handling for checkbox and row clicks lives at lines 46-121
    - this class mixes row-class paint concerns with semantic row-selection interaction
    - this is a clean demolition target for Plan 157

- [packages/core/src/renderer/rowCellBindingLanes.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/renderer/rowCellBindingLanes.ts) shows the renderer is already column-instance-aware:
    - row slots and cell slots are reconciled by `ColumnInstanceId`
    - current focus recovery still derives a focused instance id from `focusedCell.colField` by searching displayed columns at lines 479-481
    - this is a temporary bridge that Plan 157 should remove

- [packages/core/src/renderer/cellSlot.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/renderer/cellSlot.ts), [packages/core/src/renderer/rowSlot.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/renderer/rowSlot.ts), and [packages/core/src/renderer/viewportRenderer.ts](/C:/Users/rishi/witbybit/open-grid/packages/core/src/renderer/viewportRenderer.ts) already provide the physical identity and ARIA paint foundation:
    - cell slots own stable `columnInstanceId`, `cellInstanceId`, `aria-colindex`, and `aria-selected`
    - row slots own `aria-rowindex`
    - viewport root owns `role="grid"`, `aria-rowcount`, and `aria-colcount`
    - this means Plan 157 should derive accessibility from kernel state rather than inventing a second DOM-only system

## Commands you will need

| Purpose                   | Command                                                                                                                                                                                                                                        | Expected on success |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Core build                | `corepack pnpm --filter @eregister/open-grid-core build`                                                                                                                                                                                       | exit 0              |
| React build               | `corepack pnpm --filter @eregister/open-grid-react build`                                                                                                                                                                                      | exit 0              |
| Core tests                | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                                                                                                                        | all pass            |
| React tests               | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                                                                                                                       | all pass            |
| Architecture guards       | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts`                                                                                                                                       | all pass            |
| Focused interaction tests | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/models/SelectionModel.test.ts src/features/EditingFeatureController.test.ts src/features/RowSelectionFeatureController.test.ts src/features/ClipboardController.test.ts` | all pass            |

## Scope

**In scope**

- `packages/core/src/api/**`
- `packages/core/src/engine/**`
- `packages/core/src/models/**`
- `packages/core/src/features/**`
- `packages/core/src/navigation.ts`
- `packages/core/src/renderer/**` where interaction/event ownership or accessibility derivation changes are required
- `packages/react/src/GridView.tsx`
- `packages/react/src/hooks.tsx`
- `packages/react/src/gridPortalHosts.tsx`
- `packages/react/src/GridPortal.tsx` only if editor/portal interaction ownership must be reduced
- `plans/README.md`

**Out of scope**

- New end-user feature polish unrelated to interaction architecture
- New DevTools / runtime inspector work
- New spreadsheet product features beyond the kernel foundation needed to keep current behavior honest
- A new compatibility layer preserving field-based internal identity after the kernel exists

## Non-negotiable demolition rules

- Do not keep `navigation.ts` and a new kernel as parallel semantic owners. The old path must be deleted or reduced to a trivial shim that is then deleted before the plan closes.
- Do not leave row-selection click semantics inside renderer paint helpers if the new kernel can own them.
- Do not leave focus/edit/range identity field-based internally once the new kernel lands.
- Do not let `GridView.tsx` remain the owner of semantic keyboard/pointer routing. It may only resolve DOM targets and forward them into core-owned commands, or call a core-provided binder.
- Do not preserve deprecated internal APIs for convenience just because the grid is in use. Alpha state means clean replacement wins.

## Phases

### Phase 1 - Canonical interaction state and identity cutover

- [x] Introduce a dedicated `InteractionKernelState` (or equivalent named core-owned structure)
- [x] Split interaction sub-state into explicit domains:
    - [x] focus
    - [x] active edit
    - [x] cell/range selection
    - [x] row selection
- [x] Introduce canonical cell identity for interaction:
    - [x] `rowId`
    - [x] `columnInstanceId`
    - [x] stable displayed `colField` / `colId` as derived metadata only
- [x] Replace internal field-based focus/edit/range identity
- [x] Keep public API compatibility only at the public boundary if required; no field-based identity inside core state after this phase
- [x] Add architecture guards prohibiting new field-only interaction identity in core interaction state

### Phase 2 - Single interaction kernel surface

- [x] Add one core-owned `InteractionKernel` (final name up to implementation)
- [x] Move authoritative commands behind it:
    - [x] focus/move
    - [x] select/extend/clear range
    - [x] row-selection gestures
    - [x] start/cancel/commit edit
    - [x] copy/paste command routing
    - [x] ensure-visible / scroll-navigation follow-up
- [x] Define one input command vocabulary for keyboard/pointer/api origins
- [x] Make `GridEngine` route interaction APIs through this kernel instead of directly splitting logic across older controllers
- [x] Delete obsolete parallel interaction orchestration paths once the kernel is active

### Phase 3 - Focus model hardening

- [x] Replace the current implicit focus usage with an explicit focus state model
- [x] Track:
    - [x] `rowId`
    - [x] `rowIndex` when useful as derived metadata
    - [x] `columnInstanceId`
    - [x] `colField` / `colId` as derived metadata
    - [x] focus origin
    - [x] version
- [x] Make focus restoration virtualization-safe and controller-safe
- [x] Ensure focus clears or remaps honestly when row/column identity disappears
- [x] Remove renderer-time field-to-instance recovery shims once focus state is instance-aware

### Phase 4 - Navigation engine replacement

- [x] Replace `GridNavigationController` as the semantic owner
- [x] Move keyboard navigation into the interaction kernel or a kernel-owned navigation engine
- [x] Make navigation understand:
    - [x] pinned columns
    - [x] hidden columns
    - [x] duplicate-field columns via `columnInstanceId`
    - [x] loading/failed/placeholder rows
    - [x] row-model unknown/estimated counts
    - [x] editable-only navigation mode is not supported in the current kernel surface, so no parallel mode was preserved
- [x] Replace fixed `PageUp` / `PageDown` heuristics with viewport-aware navigation
- [x] Keep keyboard behavior test-driven during demolition so there is no regression in current capabilities

### Phase 5 - Editing lifecycle state machine

- [x] Replace shallow `EditModel` pointer storage with an explicit lifecycle state machine
- [x] Track:
    - [x] idle vs editing
    - [x] `rowId`
    - [x] `columnInstanceId`
    - [x] `startedBy`
    - [x] `draftValue`
    - [x] `originalValue`
    - [x] version
- [x] Move editor lifecycle decisions into core:
    - [x] start
    - [x] update draft
    - [x] commit
    - [x] cancel
    - [x] move-after-commit
    - [x] restore focus
- [x] Keep committed writes on the existing canonical write path
- [x] Reject edits honestly for loading/failed/placeholder rows and unsupported row-model states
- [x] Remove remaining adapter-owned semantic edit decisions

### Phase 6 - Row selection and range selection convergence

- [x] Fold row-selection gesture ownership into the kernel while preserving honest row-model scope semantics from Plan 156
- [x] Keep row selection keyed by `rowId` only
- [x] Make cell/range selection keyed by `rowId + columnInstanceId`
- [x] Define explicit range anchor semantics in core
- [x] Remove range-selection semantics from renderer/painter classes once the kernel owns them
- [x] Preserve honest `all` / `loaded` / `page` selection behavior across row models

### Phase 7 - Clipboard foundation rebased on kernel identity

- [x] Rebase clipboard source/target resolution on kernel-owned selection/focus state
- [x] Remove any remaining assumptions that field identity is authoritative
- [x] Keep copy/paste capability and integrity checks where they already belong
- [x] Ensure duplicate-field columns and reordered columns copy/paste against the correct logical columns
- [x] Add regression tests for no stale visual-row dependence during copy/paste

### Phase 8 - Adapter de-thickening and event routing cleanup

- [x] Reduce `packages/react/src/GridView.tsx` to thin DOM assembly + event forwarding only
- [x] Move semantic event routing out of the React adapter into core wherever feasible
- [x] Decide the cleanest final shape:
    - [x] core-provided DOM event binder
    - [x] adapter-resolved pointer forwarding into kernel commands was intentionally not kept as a parallel semantic owner
- [x] Delete legacy adapter-owned navigation/activity logic after the new flow is live
- [x] Keep React-specific responsibilities limited to portal/editor rendering assembly

### Phase 9 - Accessibility state derivation

- [x] Derive ARIA selection/focus/edit/read-only/invalid state from the kernel, not ad hoc per caller
- [x] Normalize:
    - [x] `aria-selected`
    - [x] `aria-rowindex`
    - [x] `aria-colindex`
    - [x] `aria-readonly`
    - [x] `aria-invalid`
    - [x] `tabIndex`
    - [x] active-cell focus contract
- [x] Ensure virtualization does not break accessibility state truthfulness
- [x] Add regression tests around focus/editing/selection ARIA output

### Phase 10 - Legacy demolition and guardrails

- [x] Delete deprecated internal interaction types and controllers that the kernel replaces
- [x] Delete parallel event routing and navigation ownership paths
- [x] Add architecture guards that lock in:
    - [x] single interaction kernel ownership
    - [x] no field-only focus/edit/range identity in core
    - [x] no semantic keyboard/pointer orchestration in React adapter
    - [x] no row-selection semantics inside renderer paint helpers
- [x] Add adversarial regression coverage for virtualization, duplicate fields, and async row-model interaction

## Initial execution checklist

- [x] Create the plan and keep it updated as phases land
- [x] Start with identity cutover before behavior migration
- [x] Do not preserve two navigation/interaction stacks in parallel
- [x] Build and run focused interaction tests after each phase
- [x] Remove deprecated code as soon as the replacement path is verified, not in a later “cleanup maybe” pass

## Suggested implementation order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 5
5. Phase 4
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10

Reasoning:

- Identity must harden before navigation/edit/range cleanup or the wrong abstractions will get reinforced.
- Editing should become a real state machine before adapter thinning so portal/editor contracts can target the final owner.
- Accessibility should be derived after the kernel state is stable, not before.

## Test plan

- Add or update unit coverage in:
    - `packages/core/src/models/SelectionModel.test.ts`
    - `packages/core/src/features/EditingFeatureController.test.ts`
    - `packages/core/src/features/RowSelectionFeatureController.test.ts`
    - `packages/core/src/features/ClipboardController.test.ts`
    - new kernel-focused tests if a new module is introduced
- Add or update integration coverage for:
    - duplicate-field focus identity
    - horizontal reorder / virtualization preserving focused logical column instance
    - editing survival and correct teardown during scroll
    - loading/failed row navigation behavior
    - row-selection scope honesty under infinite/server-page
    - copy/paste correctness across duplicated fields and reordered columns
    - no adapter-owned semantic interaction regressions
- Use existing structure patterns from:
    - `packages/core/src/featureComposition.gauntlet.test.ts`
    - `packages/core/src/renderer/serverRuntimePerformance.test.ts`
    - `packages/react/src/index.test.tsx`

## Done criteria

- [x] `corepack pnpm --filter @eregister/open-grid-core build` exits 0
- [x] `corepack pnpm --filter @eregister/open-grid-react build` exits 0
- [x] `corepack pnpm --filter @eregister/open-grid-core test` exits 0
- [x] `corepack pnpm --filter @eregister/open-grid-react test` exits 0
- [x] `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts` exits 0
- [x] Core interaction state no longer uses field-only identity for focus/edit/range
- [x] `packages/core/src/navigation.ts` is either deleted or reduced to a non-semantic shim that is then removed before plan closure
- [x] `packages/react/src/GridView.tsx` no longer owns semantic keyboard/pointer interaction orchestration
- [x] Renderer paint helpers no longer own row-selection semantics
- [x] Clipboard/focus/editing/range behavior all route through one core-owned kernel
- [x] No files outside the intended implementation scope changed without explicit justification
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if any of the following occurs:

- The interaction identity cutover reveals a public API compatibility requirement that forces long-lived dual identity internally.
- Duplicate-field columns cannot be represented cleanly with the current public API vocabulary without a separate public contract decision.
- Portal/editor lifecycle in React depends on adapter-owned semantics that cannot be migrated without first changing the renderer host contract.
- A required change would reintroduce renderer-driven semantic state mutation or a second interaction owner.
- The live code has drifted materially from the "Current state" excerpts above.

## Maintenance notes

- Reviewers should be especially strict about hidden compatibility layers. The success condition is not “old tests still pass somehow”; it is “interaction now has one core owner.”
- Any future DevTools work should inspect the kernel state instead of rebuilding interaction truth from DOM and renderer artifacts.
- If a follow-up public API cleanup becomes desirable after the internal cutover, do it as a separate alpha-surface plan rather than polluting this kernel hardening pass.
