# Plan 129: Live Data Stream MVP

## Mission

Build a minimal, safe live data stream orchestrator.

This plan should prove Wit Grid can ingest frequent updates without bypassing the core architecture.

Live Stream MVP should support:

```text
cell updates
row patch updates
batching
coalescing
pause/resume/flush/destroy
change flash decorations
DevTools diagnostics
client row model first
```

Do not implement full conflict resolution in this plan.

Only protect dirty local cells by skipping/deferring updates and reporting diagnostics.

Full conflict UX comes in Plan 130.

---

## Architectural rules

Live Stream must not:

```text
mutate row data directly
patch visible DOM directly
bypass GridCommitKernel
bypass invalidation manager
create a parallel history system
silently overwrite dirty local edits
pollute row models with hidden stream caches
force sort/filter recompute for every update without policy
```

The stream is only an orchestrator:

```text
incoming update
→ buffer/coalesce
→ call existing mutation APIs
→ normal commit/invalidation/render
→ expose diagnostics/decorations
```

---

## Core types

```ts
export interface CellStreamUpdate {
	readonly rowId: string;
	readonly colField: string;
	readonly value: unknown;
	readonly version?: string | number;
	readonly source?: string;
}

export interface RowStreamUpdate<TRowData> {
	readonly rowId: string;
	readonly patch: Partial<TRowData>;
	readonly version?: string | number;
	readonly source?: string;
}

export interface TransactionStreamUpdate<TRowData> {
	readonly cells?: readonly CellStreamUpdate[];
	readonly rows?: readonly RowStreamUpdate<TRowData>[];
}
```

Options:

```ts
export interface TransactionStreamOptions {
	readonly batchMs?: number;
	readonly maxBatchSize?: number;
	readonly coalesceBy?: 'cell' | 'row';
	readonly history?: 'suppress' | 'grouped';
	readonly flashChanges?: boolean;
	readonly dirtyCellPolicy?: 'skip' | 'queue' | 'markConflictLater';
	readonly sortPolicy?: 'live' | 'defer';
	readonly filterPolicy?: 'live' | 'defer';
}
```

Recommended defaults:

```ts
{
  batchMs: 16,
  maxBatchSize: 1000,
  coalesceBy: 'cell',
  history: 'suppress',
  flashChanges: true,
  dirtyCellPolicy: 'skip',
  sortPolicy: 'defer',
  filterPolicy: 'defer'
}
```

State:

```ts
export interface TransactionStreamState {
	readonly paused: boolean;
	readonly pendingUpdates: number;
	readonly committedBatches: number;
	readonly skippedDirtyUpdates: number;
	readonly droppedUpdates: number;
	readonly lastFlushDurationMs: number | null;
	readonly lastError: string | null;
	readonly backpressureActive: boolean;
}
```

---

## Stream interface

```ts
export interface GridTransactionStream<TRowData> {
	push(update: TransactionStreamUpdate<TRowData>): void;

	pushCells(updates: readonly CellStreamUpdate[]): void;

	pushRows(updates: readonly RowStreamUpdate<TRowData>[]): void;

	pause(): void;

	resume(): void;

	flush(): Promise<void> | void;

	destroy(): void;

	getState(): TransactionStreamState;
}
```

API:

```ts
api.createTransactionStream(
  options?: TransactionStreamOptions
): GridTransactionStream<TRowData>;
```

---

## Commit integration

Cell updates must call existing canonical mutation:

```text
batchCellValues()
```

or equivalent public/internal API.

Row patches must call:

```text
applyTransaction()
```

or equivalent row transaction API.

Do not write directly into row storage.

Default history:

```text
suppress
```

Reason: live ticks should not create endless undo entries.

Allow grouped history if explicitly requested.

---

## Dirty cell protection

The MVP must not silently overwrite dirty local edits.

Add dependency:

```ts
isCellDirty(rowId, colField): boolean
```

If dirty:

```text
dirtyCellPolicy: skip
→ skip update
→ increment skippedDirtyUpdates
→ record stream diagnostic
```

Do not create full conflicts yet.

Plan 130 will convert this into real conflict state.

---

## Change flash

Live updates should expose flash decorations through Insight Layer.

Add stream as insight layer:

```ts
id = 'liveStream';
```

Decoration:

```ts
{
  layerId: 'liveStream',
  kind: 'flash',
  className: 'og-cell-live-flash'
}
```

CSS:

```css
.og-cell-live-flash {
	animation: og-cell-live-flash 600ms ease-out;
}

@keyframes og-cell-live-flash {
	from {
		background-color: rgba(255, 230, 120, 0.75);
	}

	to {
		background-color: transparent;
	}
}
```

Flash must be decoration-only.

No renderer remount.

---

## Row model support

MVP support:

```text
client row model: full support
infinite row model: loaded rows only if easy, otherwise explicit unsupported
server row model: current page only if easy, otherwise explicit unsupported
```

Be honest in diagnostics.

Do not build hidden patch caches for unloaded rows.

Do not mix stream state into datasource state.

---

## Sort/filter policy

Default:

```text
defer
```

Meaning:

- stream commits values;
- row pipeline may mark sort/filter dirty;
- app/user can refresh/reapply if needed.

If existing infrastructure makes live sort/filter cheap, allow:

```text
live
```

But do not force expensive recompute on every update by default.

---

## Backpressure

MVP should have minimal backpressure.

If pending updates exceed `maxBatchSize`:

```text
coalesce aggressively
or drop newest with diagnostics
```

Do not let memory grow unbounded.

State should expose:

```text
droppedUpdates
backpressureActive
```

---

## DevTools integration

DevTools should show:

- stream active/inactive;
- pending updates;
- committed batches;
- skipped dirty updates;
- dropped updates;
- last flush duration;
- last error;
- backpressure state.

---

## Sidebar / demo control panel

For the demo, add a simple Live Stream panel or controls in the Data Integrity demo:

- start stream;
- pause stream;
- resume stream;
- flush now;
- stop stream;
- show pending update count;
- show skipped dirty count;
- show last flush duration.

Do not build a polished production panel yet unless desired.

---

## Demo requirement

Extend the Data Integrity demo:

1. Grid loads invoice/order rows.
2. User clicks “Start Live Stream.”
3. Random status/amount updates arrive every 100–300ms.
4. Updates are coalesced and committed through existing mutation APIs.
5. Updated cells flash.
6. Pause/resume works.
7. Editing a cell marks it dirty.
8. Stream update targeting dirty cell is skipped.
9. Diagnostics show skipped dirty update.
10. DevTools shows stream state.

---

## Tests

Add tests:

1. Creates stream from API.
2. Push cell update.
3. Coalesces repeated cell updates to latest value.
4. Flush calls `batchCellValues`.
5. Push row patch.
6. Flush calls row transaction/applyTransaction.
7. Pause prevents flushing.
8. Resume flushes pending updates.
9. Destroy clears pending work.
10. History suppressed by default.
11. Grouped history works if enabled.
12. Dirty cell update is skipped.
13. Skipped dirty update increments diagnostics.
14. Flash decoration appears after commit.
15. Flash decoration expires.
16. Backpressure prevents unbounded queue.
17. No direct row mutation.
18. No direct DOM mutation.
19. Source guards pass.

---

## Extension points

Leave room for:

```text
real conflict state
local-vs-remote resolution
remote row model loaded-row policy
server version checks
collaboration
append-only log mode
sliding time window mode
stream replay
```

Do not build these now.

---

## Completion gate

Plan 129 is complete when:

- `api.createTransactionStream()` exists;
- cell and row update streams work;
- updates commit through existing mutation APIs;
- dirty local cells are not silently overwritten;
- flash decorations use Insight Layer;
- stream diagnostics appear in DevTools;
- client row model is supported;
- remote support is explicit and limited;
- source guards prove no architecture bypass.

Final report must say:

```text
Plan 129 complete. Wit Grid now has a risk-averse Live Data Stream MVP that batches and coalesces updates through existing commit APIs, protects dirty local cells, exposes live flash decorations through Insight Layers, and reports diagnostics without polluting row models, renderers, history, invalidation, or datasource logic.
```
