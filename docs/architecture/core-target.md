# Open Grid Core Architecture Target

> **Status**: Normative — plans 089–103 converge toward this document.
> This document is the architecture constitution. A future plan may not contradict it
> without an explicit architecture-decision amendment committed alongside the change.

---

## 1. Layer map

```
┌───────────────────────────────────────────────────────────────────┐
│  Public API (GridApi, GridEvents, index.ts)                        │  packages/core src/api/, src/index.ts
│  — the only surface consumers and framework adapters may call      │
├───────────────────────────────────────────────────────────────────┤
│  Store / Façade (GridStore, createGrid)                            │  src/store.ts, src/createGrid.ts
│  — wires API to engine; owns port binding lifecycle                │
├───────────────────────────────────────────────────────────────────┤
│  Engine (GridEngine, GridStateReactionController)                  │  src/engine/
│  — owns invalidation, feature orchestration, domain version bumps  │
├───────────────────────────────────────────────────────────────────┤
│  State (StateManager, GridState, GridDomainVersions)               │  src/state/
│  — single transactional source of truth; emits change notifications│
├───────────────────────────────────────────────────────────────────┤
│  Domain Models (DataModel, ColumnModel, SelectionModel, …)         │  src/models/
│  — pure computed projections of state; no rendering knowledge      │
├──────────────────────────────┬────────────────────────────────────┤
│  Row Processing               │  Feature Controllers               │
│  (RowPipeline, stages)        │  (Editing, Selection, Grouping, …) │
│  src/rows/                    │  src/features/                     │
├──────────────────────────────┴────────────────────────────────────┤
│  Frame Coordination (FrameCoordinator, GridScheduler)              │  src/renderer/frameCoordinator.ts
│  — the ONLY site where setTimeout/rAF/rIC may be called            │  src/renderer/gridScheduler.ts
├───────────────────────────────────────────────────────────────────┤
│  Physical Renderer (RenderEngine, ViewportRenderer, RowRenderer,   │  src/renderer/
│   CellRenderer, PortalMountManager, …)                             │
│  — owns all DOM writes; never imported by layers above             │
├───────────────────────────────────────────────────────────────────┤
│  Framework Adapter (React package, GridHost)                       │  packages/react/
│  — consumes GridApi and GridHost; never becomes state authority    │
├───────────────────────────────────────────────────────────────────┤
│  Host Integration (gridHost.ts, RuntimePortBinding)                │  src/gridHost.ts, src/engine/rendererPorts.ts
│  — binds renderer ports and ResizeObserver to a DOM container      │
└───────────────────────────────────────────────────────────────────┘
```

### Legal dependency directions

A module in layer N may import from layer N or any layer **below** N (higher line number in the table above), never from a layer above it. The exact rules:

| Layer               | May import from                                                        |
| ------------------- | ---------------------------------------------------------------------- |
| Public API          | nothing in core (type-only is permitted for GridState/ColumnDef)       |
| Store / Façade      | Engine, State, API, Host Integration, Diagnostics                      |
| Engine              | State, Domain Models, Row Processing, Feature Controllers, Diagnostics |
| State               | nothing in core (pure data structures only)                            |
| Domain Models       | State (read-only via GridState), Diagnostics                           |
| Row Processing      | Domain Models (type imports), State (type imports)                     |
| Feature Controllers | Engine (via injected deps), State, Domain Models                       |
| Frame Coordination  | nothing above Frame Coordination; allowed browser scheduling APIs      |
| Physical Renderer   | Frame Coordination, Domain Models (type-only), Diagnostics             |
| Framework Adapter   | Public API, GridHost interface                                         |
| Host Integration    | Physical Renderer (port types only), Store (type-only)                 |

**Prohibited cross-cuts** (enforced by architecture tests):

- `packages/core` must not import from `packages/react` or any framework package.
- `src/engine/`, `src/state/`, `src/models/`, `src/rows/` must not import React.
- `src/renderer/` must not import from `src/store.ts` barrel.
- `src/models/` must not import from `src/renderer/`.
- `setTimeout`, `requestAnimationFrame`, `requestIdleCallback` are forbidden outside frame-coordination files.

---

## 2. Domain ownership

Every mutable concern has exactly one owner. "Owner" means: the entity that decides the value, persists it in `GridState`, and is the single writer. All other layers read from the owner's projection.

| Domain                                    | Owner class                                                  | Module                                                   |
| ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Raw row data                              | `DataModel`                                                  | `src/models/DataModel.ts`                                |
| Column definitions and order              | `ColumnModel`                                                | `src/models/ColumnModel.ts`                              |
| Column geometry (widths, lefts)           | `GeometryModel`                                              | `src/models/GeometryModel.ts`                            |
| Row geometry (heights, tops)              | `GeometryModel`                                              | `src/models/GeometryModel.ts`                            |
| Visual row list (filtered/sorted/grouped) | `RowPipeline` (client) / `ServerRowModelController` (server) | `src/rows/RowPipeline.ts` / `src/serverRowModel.ts`      |
| Viewport range (visible rows/cols)        | `ViewportModel`                                              | `src/models/ViewportModel.ts`                            |
| Cell selection                            | `SelectionModel`                                             | `src/models/SelectionModel.ts`                           |
| Focus (keyboard)                          | `SelectionModel`                                             | `src/models/SelectionModel.ts`                           |
| Active edit                               | `EditModel`                                                  | `src/models/EditModel.ts`                                |
| Validation errors                         | `GridDataIntegrityManager`                                   | `src/features/dataIntegrity/GridDataIntegrityManager.ts` |
| Column filter state                       | `GridState.filters` via `StateManager`                       | `src/state/GridState.ts`                                 |
| Sort state                                | `GridState.sort` via `StateManager`                          | `src/state/GridState.ts`                                 |
| Group state                               | `GridState.grouping` via `StateManager`                      | `src/state/GridState.ts`                                 |
| Pagination state                          | `GridState.pagination` via `StateManager`                    | `src/state/GridState.ts`                                 |
| Domain versions (invalidation)            | `GridEngine`                                                 | `src/engine/GridEngine.ts`                               |
| Renderer port binding                     | `GridStore` (`bindRuntimePorts`)                             | `src/store.ts`                                           |
| Feature state (plugins)                   | `GridPluginRegistry`                                         | `src/plugins/GridPluginRegistry.ts`                      |
| Grid events                               | `EventBus`                                                   | `src/events/EventBus.ts`                                 |
| Diagnostics / metrics                     | `GridInstrumentation`                                        | `src/diagnostics/GridInstrumentation.ts`                 |
| Undo / redo                               | `CommandHistory`                                             | `src/commands/CommandHistory.ts`                         |
| Persistence                               | `statePersistence` helpers                                   | `src/persistence/statePersistence.ts`                    |

---

## 3. Canonical execution flows

### 3.1 Command-to-render flow

```
User action / API call
  │
  ▼
GridApi method (e.g. setData, setSort, commitEdit)
  │
  ▼
GridStore (delegates to GridEngine feature controller)
  │
  ▼
Feature Controller (e.g. DataMutationController, EditingFeatureController)
  │  writes via StateManager.setState()
  ▼
StateManager — batches writes, emits state-change notification
  │
  ▼
GridStateReactionController.handleStateChanges()
  │  updates domain models and bumps GridDomainVersions
  ▼
GridEngine.notifyDomainVersionListeners()
  │
  ▼
RenderEngine (subscribed via subscribeDomain)
  │  schedules a paint via FrameCoordinator
  ▼
FrameCoordinator.scheduleFrame()  ← ONLY rAF site in core
  │
  ▼
RenderEngine.runFrame() → ViewportRenderer.syncLayoutPlan()
                        → RowRenderer.bindVisibleRows()
                        → CellRenderer / PortalMountManager
  │
  ▼
DOM updated — one write batch per frame
```

### 3.2 Raw-row-to-viewport flow

```
setData / addRows / updateRows (API)
  │
  ▼
DataModel (stores RowNode tree)
  │
  ▼
RowPipeline.run()
  stages: tree → group → sort → filter → aggregate → flatten → paginate
  │
  ▼
VisualRow[] (immutable list of discriminated rows)
  │
  ▼
ViewportModel (computes visible slice from scroll position)
  │
  ▼
RowRenderer.bindVisibleRows() — recycles physical RowSlots
  │
  ▼
CellRenderer / PortalMountManager — writes text or mounts portals
  │
  ▼
DOM cells (read by framework adapter for React portal reconciliation)
```

---

## 4. Identity rules

### Logical identity

A logical identity is stable across scroll, sort, filter, and row model rebuilds:

- **Row**: `RowNode.id` — assigned by `rowId` config or `getId()`.
- **Column**: `ColumnDef.id` — stable string provided by the consumer.
- **Cell**: `rowId + colId` string pair.

### Physical identity

A physical identity is a transient DOM slot assignment that may change on every frame:

- **Row slot**: `RowSlot.id` — a recycled DOM element. Does NOT equal `rowId`.
- **Column lane index**: display position in the virtualized lane; changes on column reorder.
- **Cell slot**: `CellSlot` element — shared across row bindings.

**Rule**: Physical slot identity must never appear in `GridApi`, `GridEvents`, or any consumer-facing type. `CellMountIdentity.slotId` is renderer-internal.

---

## 5. Lifecycle rules

### Grid lifecycle

1. `createClientGrid()` / `createServerGrid()` — constructs `GridStore`; no DOM access.
2. `gridHost.ts:connectGrid()` / `GridHost.mount()` — calls `bindRuntimePorts()`, starts `ResizeObserver`, attaches renderer.
3. `GridStore.destroy()` — calls `unbindRuntimePorts()`, cancels pending frames, destroys all sub-systems.

### Renderer port binding

- Exactly one `RuntimePortBinding` is active at a time.
- `bindRuntimePorts()` reports a fault and no-ops if called while a binding is active.
- `unbindRuntimePorts()` restores `HEADLESS_PORTS` and nulls the active generation.
- `isBindingCurrent(binding)` guards every async callback that touches the DOM.

### Feature controller lifecycle

- Feature controllers are created by `GridEngine` and destroyed by `GridEngine.destroy()`.
- They must not hold DOM references after `destroy()`.
- They communicate with the renderer only through state changes and domain version bumps — never by direct import.

---

## 6. Feature maturity classification

| Level          | Meaning                                                                 | Convergence treatment                                                       |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Foundation** | Required for any grid use case; API contracts are frozen for the alpha  | Must be covered by integration tests; no breaking changes without amendment |
| **Reference**  | Standard feature present in competitive grids; shipped but may evolve   | API stability expected; allowed minor breakage with migration path          |
| **Incubating** | Being built or being converged; no stability promise                    | May break; must not distort foundation contracts                            |
| **Deferred**   | Defined but not required for alpha; receives no architectural expansion | Code may exist but must not add coupling to foundation layers               |

### Classification table

| Feature                                             | Level      |
| --------------------------------------------------- | ---------- |
| Client row model (sort, filter, group, tree)        | Foundation |
| Column virtualization (pin left, pin right, center) | Foundation |
| Cell selection and keyboard navigation              | Foundation |
| Inline cell editing                                 | Foundation |
| Virtual scroll (row + column)                       | Foundation |
| Column resize                                       | Foundation |
| Row geometry (variable height)                      | Foundation |
| Column geometry (variable width)                    | Foundation |
| Frame coordinator / scheduler                       | Foundation |
| GridApi public surface                              | Foundation |
| GridEvents pub/sub                                  | Foundation |
| Diagnostics / instrumentation                       | Foundation |
| Server row model                                    | Reference  |
| Grouping and aggregation                            | Reference  |
| Pagination (client + server)                        | Reference  |
| Column reorder (drag)                               | Reference  |
| Row drag                                            | Reference  |
| Floating filters                                    | Reference  |
| Filter chip bar                                     | Reference  |
| Status bar                                          | Reference  |
| Context menu                                        | Reference  |
| Copy / paste                                        | Reference  |
| CSV export                                          | Reference  |
| State persistence                                   | Reference  |
| Master-detail rows                                  | Reference  |
| Sticky group rows                                   | Reference  |
| Cell validation                                     | Reference  |
| Fill drag (spreadsheet-style)                       | Incubating |
| Formula / DAG engine                                | Incubating |
| Undo / redo                                         | Incubating |
| Column auto-size                                    | Incubating |
| Theme system                                        | Incubating |
| Header menus                                        | Incubating |
| Spreadsheet fill range                              | Deferred   |

---

## 7. Package boundary

| Package                      | Role                                                             | Allowed consumers            |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `@eregister/open-grid-core`  | Engine, state, row pipeline, physical renderer, host integration | framework adapters, demo app |
| `@eregister/open-grid-react` | React adapter (component, hooks, portals)                        | React applications           |

Rules:

- `@eregister/open-grid-core` must not import from `@eregister/open-grid-react` or any other framework package.
- `@eregister/open-grid-react` imports from `@eregister/open-grid-core` only through the exported public API (`src/index.ts`), never through deep internal paths.
- No other inter-package imports are permitted until a new package is chartered with an explicit dependency budget.

---

## 8. Responsibility registry

Every major production class below has exactly one declared role. A future class that blurs two roles or duplicates an existing owner violates this constitution.

| Class                           | Role                                                                           | Module                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `GridStore`                     | Store / Façade — wires API to engine, owns port binding                        | `src/store.ts`                                           |
| `GridEngine`                    | Engine — feature orchestration, domain versions, invalidation dispatch         | `src/engine/GridEngine.ts`                               |
| `GridStateReactionController`   | Engine — reacts to state changes, drives model updates                         | `src/engine/GridStateReactionController.ts`              |
| `GridChangeApplier`             | Engine — applies mutation payloads to state                                    | `src/engine/GridChangeApplier.ts`                        |
| `CellNotificationController`    | Engine — cell-level subscription delivery                                      | `src/engine/CellNotificationController.ts`               |
| `StateManager`                  | State — transactional state writes and listener dispatch                       | `src/state/StateManager.ts`                              |
| `DataModel`                     | Domain model — RowNode tree storage and value cache                            | `src/models/DataModel.ts`                                |
| `ColumnModel`                   | Domain model — column definition state and render plan                         | `src/models/ColumnModel.ts`                              |
| `GeometryModel`                 | Domain model — row/col pixel geometry                                          | `src/models/GeometryModel.ts`                            |
| `SelectionModel`                | Domain model — cell selection and keyboard focus                               | `src/models/SelectionModel.ts`                           |
| `EditModel`                     | Domain model — active cell edit state                                          | `src/models/EditModel.ts`                                |
| `ViewportModel`                 | Domain model — visible row/col range                                           | `src/models/ViewportModel.ts`                            |
| `RowPipeline`                   | Row processing — client-side transform pipeline                                | `src/rows/RowPipeline.ts`                                |
| `ClientRowModelController`      | Row processing — client row model lifecycle                                    | `src/rowModel.ts`                                        |
| `ServerRowModelController`      | Row processing — server row model / block cache                                | `src/serverRowModel.ts`                                  |
| `EditingFeatureController`      | Feature — edit entry/commit/cancel                                             | `src/features/EditingFeatureController.ts`               |
| `RowSelectionFeatureController` | Feature — selection gestures                                                   | `src/features/RowSelectionFeatureController.ts`          |
| `ColumnFeatureController`       | Feature — column operations (resize, reorder, pin)                             | `src/features/ColumnFeatureController.ts`                |
| `DataMutationController`        | Feature — batch cell/row value writes                                          | `src/features/DataMutationController.ts`                 |
| `GridDataIntegrityManager`      | Feature — integrity orchestration, validation ownership, and issue publication | `src/features/dataIntegrity/GridDataIntegrityManager.ts` |
| `GroupingFeatureController`     | Feature — group/expand/collapse                                                | `src/features/GroupingFeatureController.ts`              |
| `ClipboardController`           | Feature — copy/paste                                                           | `src/features/ClipboardController.ts`                    |
| `RowDragController`             | Feature — row drag/drop                                                        | `src/features/RowDragController.ts`                      |
| `DefaultFrameCoordinator`       | Frame coordination — schedules rAF paint frames                                | `src/renderer/frameCoordinator.ts`                       |
| `GridScheduler`                 | Frame coordination — idle/deferred task queue                                  | `src/renderer/gridScheduler.ts`                          |
| `RenderEngine`                  | Physical renderer — owns all sub-renderers and paint entry                     | `src/renderer/renderEngine.ts`                           |
| `ViewportRenderer`              | Physical renderer — DOM structure (layers, scroll viewport)                    | `src/renderer/viewportRenderer.ts`                       |
| `RowRenderer`                   | Physical renderer — row slot lifecycle and cell recycling                      | `src/renderer/rowRenderer.ts`                            |
| `CellRenderer`                  | Physical renderer — cell DOM writes (text, class, position)                    | `src/renderer/cellRenderer.ts`                           |
| `PortalMountManager`            | Physical renderer — deferred portal mount/unmount queue                        | `src/renderer/portalMountManager.ts`                     |
| `CustomRendererManager`         | Physical renderer — warm cache for custom cell renderers                       | `src/renderer/customRendererManager.ts`                  |
| `HeaderRenderer`                | Physical renderer — header cell layout                                         | `src/renderer/headerRenderer.ts`                         |
| `LayoutTransitionController`    | Physical renderer — WAAPI row transition animations                            | `src/renderer/layoutTransitionController.ts`             |
| `EventBus`                      | Diagnostics / events — pub-sub for GridEvents                                  | `src/events/EventBus.ts`                                 |
| `RuntimeFaultReporter`          | Diagnostics — fault collection and reporting                                   | `src/diagnostics/RuntimeFaultReporter.ts`                |
| `CommandHistory`                | Undo/redo — command stack                                                      | `src/commands/CommandHistory.ts`                         |
| `GridPluginRegistry`            | Plugin system — plugin registration and lifecycle                              | `src/plugins/GridPluginRegistry.ts`                      |

---

## 9. Amendment process

A change to this document requires:

1. A `docs/architecture/adr/NNN-title.md` Architecture Decision Record stating: context, decision, consequences, supersedes.
2. The ADR committed in the same PR as the code change.
3. Architecture guard tests updated to reflect the new rule.
4. No plan in the 089–103 program may be used as an amendment justification for contradicting the invariants in Section 1 or Section 2.
