# Plan 168 — Record workspace: one record model, many projections

Table, Gallery, Kanban, Gantt and Calendar are projections over the same rows, the same field
schema, the same mutation pipeline and the same selection. Switching projection keeps the user's
working context (filters, search, selection, focused record, inspector, undo history).

## Principles

- **Opt-in by cost.** A table-only grid loads no workspace code: the workspace host and every view
  module are dynamic imports, fetched the first time a view (or the workspace chrome) is asked for.
- **One owner per fact** (core simplicity contract):
  | Fact | Owner |
  | --- | --- |
  | Field semantics (kind, options, colours) | `ColumnDef.schema`, set by column types |
  | Record roles (title, status, schedule…) | `resolveRecordRoles` over columns + `records` config |
  | Displayed records (filter, sort, search) | the row model (views read it, never copy it) |
  | Selection | grid row selection |
  | Focused record / inspector | the workspace host (survives view switches) |
  | Writes, validation, history | `api.transaction` (one commit = one undo step) |
  | Projection (board, outline, schedule) | pure kernels in `records/`, recomputed from rows |
  | View navigation (scroll, zoom, collapse) | workspace host per view kind (renderer-local) |
- **Pure kernels, thin DOM.** Grouping, board placement, ranking, outline/WBS, rollups,
  dependency graph, critical path, auto-scheduling and resource load are DOM-free and unit-tested.
- **No patchwork.** Views do not scrape the DOM for records: each declares its record order and
  reveal function; the host owns selection, keyboard, menus and inspector.

## Layers

```
records/              pure — field schema readers, roles, groups, board, rank, activity
records/schedule/     pure — work calendar, dependencies, outline, CPM scheduler, time scale, resources
renderer/workspace/   DOM — host, shell (command bar, inspector, palette, bulk bar), ui kit, styles
renderer/workspace/views/{kanban,gallery,gantt,calendar}
```

## View module contract

```ts
interface WorkspaceViewModule<C> {
	kind;
	label;
	icon;
	create(host, ctx, config): WorkspaceView;
}
interface WorkspaceView {
	render();
	destroy();
	order(): string[]; // record order (keyboard, range select)
	reveal?(id): HTMLElement | null; // scroll a record into view, return its element
	toolbar?(): HTMLElement | null; // contextual controls in the command bar
	summary?(): WorkspaceMetric[]; // board / project summary strip
	commands?(): WorkspaceCommand[]; // command palette entries
	inspectorTabs?(id): InspectorTab[]; // schedule, dependencies, resources…
}
```

## Phases

1. Field schema on column types; record roles + readers; grouping/aggregates; rank. (tests)
2. Schedule kernel: calendar, dependencies (FS/SS/FF/SF + lag, cycles), outline/WBS/rollups,
   CPM + critical path, auto-schedule impact, time scale, resource load. (tests)
3. Workspace host + shell: command bar, view switcher, search, filter/sort/group/fields, presence,
   undo/redo, inspector with tabs, activity, comments adapter, bulk bar, command palette.
4. Kanban: status columns with WIP/aggregates/collapse/quick-add, swimlanes, compact cards,
   insertion indicator, multi-card drag, blocked state, summary strip, drop-rejected state.
5. Gallery: cover modes, four layouts, visible fields, grouped sections + aggregates, quick-add,
   multi-select, responsive columns.
6. Gantt: one row projection / one scroll authority, outline + timeline, summary tasks,
   milestones, WBS, dependency connectors (4 types), baseline + variance, critical path,
   non-working shading, day→year zoom, move/resize/progress/link handles, auto-schedule with impact
   dialog, Today/Fit, minimap, inspector schedule/dependency/resource tabs.
7. Calendar port onto the contract. Demo, docs, browser verification.

Later: view configuration dialog, saved-view manager scopes, card template editor, resource
workload view, version history, print/export previews, mobile read-only mode.

## Status (2026-10-10)

Done: phases 1–7, plus saved views as tabs (view config persisted in `SerializedGridState.view`; `+` new-view
dialog with personal / team scope; rename, duplicate, default, delete, save / revert), the Gantt workload panel,
`GridTransaction.origin: 'remote'` (collaborator edits stay out of undo), and the `workspace` option unified with
the saved-views adapter. Tests: kernel (records, schedule), workspace host and views (jsdom), persistence,
remote origin; full core suite green.

Open:

- Print / export previews using the active view's projection (export in outline / board order).
- Deep links to records, groups and time ranges (an `onNavigate` / `locate` pair on the workspace).
- Card-template editor for gallery / board cards beyond the `fields` list.
- Mobile read-only presentation beyond the container-query collapse of the command bar and inspector.
- Conflict-resolution UI for concurrent edits (data integrity has the conflict model; the inspector does not show it yet).
- Kanban hard `rank` writes for whole-cell re-ranking can be large for very long cells; consider batching.
