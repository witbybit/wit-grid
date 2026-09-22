# Plan 122 — Grid DevTools / Runtime Inspector

**Status:** TODO  
**Depends on:** Plans 118–121 (topology/rendering foundation)

---

## Mission

Create an internal sidebar panel that lets developers inspect the grid runtime at a glance. The diagnostics foundation already exists and is partially public — this plan wires it into a cohesive snapshot API and a `devtools` sidebar panel.

**Constraints:**

- Internal named sidebar panel — not a browser extension
- Read-only: does not expose mutable internals
- Reads from existing instrumentation and fault reporter — does not create a second diagnostics system
- Disabled by default; timeline recorder does not start when DevTools is not enabled

---

## What already exists

| Symbol                                              | File                                                       | Notes                                          |
| --------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `GridInstrumentation` interface + `GridMetric` enum | `packages/core/src/diagnostics/GridInstrumentation.ts:8`   | Live metrics tracking                          |
| `RecordingGridInstrumentation`                      | same:96                                                    | Accumulates counters and frames                |
| `NoopGridInstrumentation`                           | same:82                                                    | Zero-overhead no-op                            |
| `RuntimeFaultReporter`                              | `packages/core/src/diagnostics/RuntimeFaultReporter.ts:55` | Bounded FIFO fault history                     |
| `RuntimeFault` interface                            | same:18                                                    | source, phase, message, recoverable            |
| `api.getRuntimeFaults()`                            | `packages/core/src/api/GridApi.ts:597`                     | Already public                                 |
| `api.clearRuntimeFaults()`                          | `packages/core/src/api/GridApi.ts:599`                     | Already public                                 |
| `api.getInstrumentation()`                          | `packages/core/src/api/GridApi.ts:603`                     | Already public                                 |
| `api.setInstrumentation()`                          | `packages/core/src/api/GridApi.ts:605`                     | Already public                                 |
| Sidebar system                                      | `packages/react/src/sidebar/GridSidebar.tsx`               | 4 built-ins: columns, filters, sort, themes    |
| `BuiltinSidebarPanelId`                             | `packages/react/src/sidebar/GridSidebar.tsx:11`            | `'columns' \| 'filters' \| 'sort' \| 'themes'` |
| `PersistenceStatus` interface                       | `packages/core/src/persistence/statePersistence.ts:232`    | Persistence state for diagnostics              |

---

## Public enablement

```tsx
// Boolean shorthand
<WitGrid enableDevTools />

// Explicit sidebar config — devtools must be listed explicitly
<WitGrid
  sidebar={{
    panels: ['columns', 'filters', 'sort', 'themes', 'devtools'],
  }}
/>
```

Add `'devtools'` to `BuiltinSidebarPanelId`:

```ts
// packages/react/src/sidebar/GridSidebar.tsx
export type BuiltinSidebarPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'devtools';
```

Register with `internal: true` so it does not appear in the default panel list unless explicitly included:

```ts
{ id: 'devtools', label: 'DevTools', internal: true }
```

---

## Diagnostics snapshot API

New file `packages/core/src/diagnostics/GridDiagnosticsSnapshot.ts`:

```ts
export interface GridDiagnosticsSnapshot {
	readonly timestamp: number;
	readonly state: GridStateDiagnostics;
	readonly rowModel: RowModelDiagnostics;
	readonly columns: ColumnDiagnostics;
	readonly topology: ColumnTopologyDiagnostics;
	readonly rendering: RenderDiagnostics;
	readonly instrumentation: GridInstrumentationSnapshot; // wraps existing GridInstrumentation
	readonly faults: readonly RuntimeFault[]; // wraps existing RuntimeFaultReporter
	readonly validation: ValidationDiagnostics;
	readonly persistence: PersistenceDiagnostics; // wraps existing PersistenceStatus
}
```

All returned objects are immutable value snapshots — no live internal references.

New API additions to `GridApi.ts`:

```ts
api.getDiagnosticsSnapshot(): GridDiagnosticsSnapshot;
api.clearDiagnostics(): void;
// api.clearRuntimeFaults() already exists at line 599
```

---

## Diagnostic section types

### State diagnostics

```ts
export interface GridStateDiagnostics {
	readonly rowModelType: string;
	readonly sortCount: number;
	readonly filterCount: number;
	readonly groupCount: number;
	readonly selectedRowCount: number;
	readonly focusedCell: { rowId: string; colField: string } | null;
	readonly activeTheme?: string;
}
```

### Row model diagnostics

```ts
export interface RowModelDiagnostics {
	readonly rowModelType: 'client' | 'infinite' | 'server' | string;
	readonly sourceRowCount?: number;
	readonly visualRowCount: number;
	readonly loadingRows?: number;
	readonly loadedBlocks?: number;
	readonly loadingBlocks?: number;
	readonly currentPage?: number;
	readonly pageSize?: number;
	readonly totalRowCount?: number;
}
```

### Column diagnostics

- total / visible / hidden / pinned-left / pinned-right / center counts
- column order
- grouped columns

### Topology diagnostics

Reads from existing topology/lane counters introduced in Plans 118–119:

- topology version
- left / center / right placement counts
- pinned widths
- mismatch warnings if header/body/floating-filter versions diverge

This section is specifically useful for catching regressions in the lane/topology system.

### Rendering diagnostics

Reads from existing render engine counters:

- rendered row range
- rendered center column range
- row slot count
- cell view count
- portal mount/unmount/refresh counts
- stale operation rejection count

### Instrumentation diagnostics

Wraps the existing `GridInstrumentation` counters and frame metrics from `RecordingGridInstrumentation`. No new counters are introduced here.

### Fault diagnostics

Wraps the existing `RuntimeFaultReporter` bounded list. Shows per fault: source, phase, message, recoverable flag, timestamp.

### Validation diagnostics

```ts
export interface ValidationDiagnostics {
	readonly errorCount: number;
	readonly asyncPendingCount: number;
	readonly errorsByCell: readonly { rowId: string; colField: string; error: string }[];
	readonly rowLevelErrors: readonly { rowId: string; error: string }[];
}
```

### Persistence diagnostics

Reads from the existing `PersistenceStatus` interface at `statePersistence.ts:232`:

- persistence enabled
- adapter type
- auto-save enabled
- dirty state
- last saved / restore time
- last error
- schema version (`GRID_STATE_SCHEMA_VERSION`)

Persistence controls (save now, reset, clear) remain in the Columns panel until Plan 123 moves them to the Views panel.

---

## Timeline

Bounded ring buffer — max 500 events. Only allocates and starts recording when DevTools is enabled.

New file `packages/core/src/diagnostics/GridTimeline.ts`:

```ts
export type GridTimelineEvent =
	| { type: 'commit'; timestamp: number; reason: string; durationMs?: number }
	| { type: 'frame'; timestamp: number; reason: string; durationMs?: number }
	| { type: 'rowModel'; timestamp: number; reason: string }
	| { type: 'datasource'; timestamp: number; requestId: string; status: string }
	| { type: 'portal'; timestamp: number; action: string; key?: string }
	| { type: 'fault'; timestamp: number; source: string; phase: string };
```

---

## DevTools panel UI

File: `packages/react/src/sidebar/panels/DevToolsPanel.tsx`

```
Tabs: Overview | State | Rows | Columns | Topology | Rendering | Frames | Validation | Persistence | Faults | Timeline
```

**Overview tab** — compact cards: row model type, source/visual row count, visible column count, active filter count, active sort count, validation errors, runtime faults, latest frame duration, persistence status.

**Timeline tab** — scrollable event list, newest first, bounded at 500.

All tabs call `api.getDiagnosticsSnapshot()` — no direct runtime access.

---

## Files in scope

| File                                                       | Change                                               |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `packages/core/src/diagnostics/GridDiagnosticsSnapshot.ts` | New — snapshot types and builder                     |
| `packages/core/src/diagnostics/GridTimeline.ts`            | New — bounded ring buffer                            |
| `packages/core/src/api/GridApi.ts`                         | Add `getDiagnosticsSnapshot()`, `clearDiagnostics()` |
| `packages/react/src/sidebar/GridSidebar.tsx`               | Add `'devtools'` to `BuiltinSidebarPanelId`          |
| `packages/react/src/sidebar/panels/DevToolsPanel.tsx`      | New — devtools panel UI                              |
| `packages/react/src/Grid.tsx`                              | Wire `enableDevTools` prop → sidebar panel           |
| `packages/react/src/index.ts`                              | Export new public types                              |

---

## Tests

1. DevTools panel does not appear unless `enableDevTools` or explicit panel config
2. `'devtools'` is a valid value in `BuiltinSidebarPanelId`
3. `api.getDiagnosticsSnapshot()` returns all required sections
4. Snapshot faults come from existing `RuntimeFaultReporter`
5. Snapshot instrumentation comes from existing `GridInstrumentation`
6. Snapshot persistence comes from existing `PersistenceStatus`
7. Topology diagnostics reflect lane/placement counters from Plans 118–119
8. Timeline is bounded at 500 events and drops oldest on overflow
9. Timeline does not allocate or record when DevTools is disabled
10. `getDiagnosticsSnapshot()` returns plain value objects with no live internal references

---

## Completion gate

Plan 122 is complete when:

- `'devtools'` is a valid `BuiltinSidebarPanelId`
- `enableDevTools` prop enables the panel
- `api.getDiagnosticsSnapshot()` returns an immutable snapshot backed by existing `RuntimeFaultReporter`, `GridInstrumentation`, and `PersistenceStatus`
- `GridTimeline` bounded ring buffer exists and only runs when DevTools is enabled
- DevTools panel renders all tabs
- All 10 tests pass
