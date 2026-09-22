# Plan 130: Conflict Resolution Layer

## Mission

Build explicit conflict detection and resolution on top of the Live Data Stream MVP.

This plan should prevent unsafe overwrites when local/user changes and remote/live updates touch the same cells.

Conflict Resolution must be a data-integrity tool.

It must not become a second mutation system.

It should prove:

```text
Wit Grid can safely deal with changing data while users edit/review data.
```

---

## Architectural rules

Conflict Resolution must not:

```text
silently overwrite local edits
mutate rows directly
patch DOM directly
own history
own validation
own row model state
own datasource lifecycle
```

Resolution actions must use:

```text
batchCellValues / setCellValue / applyTransaction
→ GridCommitKernel
→ normal history/invalidation/render
```

Conflicts are metadata until resolved.

---

## Core conflict types

```ts
export type GridConflictSource = 'liveStream' | 'serverRefresh' | 'collaboration' | 'import';

export interface GridCellConflict {
	readonly id: string;
	readonly rowId: string;
	readonly colField: string;

	readonly baseValue: unknown;
	readonly localValue: unknown;
	readonly remoteValue: unknown;

	readonly localVersion?: string | number;
	readonly remoteVersion?: string | number;

	readonly source: GridConflictSource;
	readonly createdAt: number;
	readonly message?: string;
}

export interface ResolveConflictOptions {
	readonly strategy: 'local' | 'remote' | 'custom';
	readonly value?: unknown;
}
```

Diagnostics:

```ts
export interface ConflictDiagnostics {
	readonly activeConflicts: number;
	readonly resolvedConflicts: number;
	readonly lastConflictAt: number | null;
}
```

---

## Conflict manager

Add:

```ts
export class GridConflictManager<TRowData> implements GridInsightLayer {
	readonly id = 'conflict';

	addConflict(conflict: GridCellConflict): void;

	getConflicts(): readonly GridCellConflict[];

	getConflict(rowId: string, colField: string): GridCellConflict | null;

	resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<void> | void;

	clearConflict(conflictId: string): void;

	clearAllConflicts(): void;

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[];

	getDiagnostics(): ConflictDiagnostics;
}
```

Register as an insight layer.

---

## Live stream integration

Update Plan 129 dirty cell behavior.

Instead of only skipping dirty updates, allow:

```ts
dirtyCellPolicy: 'markConflict';
```

When remote update targets dirty local cell:

```text
baseValue = last clean/base value if known
localValue = current grid value
remoteValue = incoming stream value
→ add GridCellConflict
→ do not mutate cell
→ decorate cell
→ panel shows conflict
```

Default for editable grids:

```text
markConflict
```

Default for read-only dashboard grids:

```text
remoteWins
```

Keep config explicit.

---

## Conflict resolution behavior

### Keep local

```text
remove conflict
do not change current value
optionally mark as resolved
```

### Use remote

```text
commit remoteValue through setCellValue/batchCellValues
remove conflict
```

### Custom

```text
commit custom value through setCellValue/batchCellValues
remove conflict
```

All commits must use commit kernel and normal history.

Recommended history:

```text
grouped
```

Source:

```text
conflictResolution
```

---

## Validation and capability integration

When resolving with remote/custom value:

```text
capability check
→ parser if applicable
→ validation
→ commit
```

If validation fails:

```text
conflict remains
resolution error appears
```

Do not resolve invalid custom values silently.

If capability denies edit/paste/update:

```text
conflict remains
reason is shown
```

This links the feature to your validation/capability architecture instead of bypassing it.

---

## Sidebar panel

Add built-in panel:

```ts
{
  id: 'conflicts',
  label: 'Conflicts'
}
```

Panel sections:

- active conflict count;
- conflict list;
- focus conflict cell;
- keep local;
- use remote;
- custom value input;
- clear resolved;
- resolve all local/remote with confirmation.

Conflict list item:

```text
rowId.colField
local: <localValue>
remote: <remoteValue>
source
createdAt
```

---

## Decorations

CSS:

```css
.og-cell-conflict {
	background-image: repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255, 0, 0, 0.16) 4px, rgba(255, 0, 0, 0.16) 8px);
}
```

Tooltip:

```text
Conflict: local <localValue> vs remote <remoteValue>
```

---

## API

Add:

```ts
api.getConflicts(): readonly GridCellConflict[];

api.getCellConflict(
  rowId: string,
  colField: string
): GridCellConflict | null;

api.resolveConflict(
  conflictId: string,
  options: ResolveConflictOptions
): Promise<void> | void;

api.clearConflict(conflictId: string): void;

api.clearAllConflicts(): void;
```

Optional alias for live stream conflicts:

```ts
api.getLiveConflicts();
```

But prefer generic conflict API.

---

## Row model support

Client row model:

```text
full support
```

Infinite row model:

```text
loaded rows only
```

Server pagination:

```text
current page only
```

Do not store conflicts for unknown/unloaded rows in MVP unless conflict contains enough row identity and the app opts in.

Future can add:

```text
conflict cache for unloaded rows
route/store conflicts for SSRM
server version checks
collaboration conflict metadata
```

---

## DevTools integration

DevTools should show:

- conflict count;
- latest conflict;
- resolved conflict count;
- conflict sources;
- stream conflict events.

---

## Demo requirement

Extend the Data Integrity demo:

1. Start live stream with `dirtyCellPolicy: 'markConflict'`.
2. User edits a cell or marks one locally dirty.
3. Stream sends remote update for same row/column.
4. Grid does not overwrite local value.
5. Conflict cell decoration appears.
6. Conflicts panel shows local vs remote.
7. User clicks “Use remote.”
8. Value commits through normal mutation path.
9. Conflict clears.
10. User repeats and chooses “Keep local.”
11. Conflict clears without changing current value.
12. DevTools shows conflict diagnostics.

---

## Tests

Add tests:

1. Conflict manager registers as insight layer.
2. Adding conflict decorates cell.
3. Conflict appears in diagnostics.
4. Live stream dirty remote update creates conflict.
5. Dirty remote update does not mutate cell.
6. Keep local removes conflict without mutation.
7. Use remote commits through normal mutation API.
8. Custom value commits through normal mutation API.
9. Invalid custom value fails validation and keeps conflict.
10. Capability denial keeps conflict.
11. Conflict resolution creates expected history entry.
12. Clearing conflict removes decoration.
13. Source guards prevent direct mutation.
14. Remote modes are limited to loaded/current rows.

---

## Extension points

Leave room for:

```text
server refresh conflicts
import conflicts
collaboration conflicts
row-level conflicts
bulk conflict resolution policies
version-vector conflict detection
conflict export
conflict replay
```

Do not build all of this now.

---

## Completion gate

Plan 130 is complete when:

- conflicts are explicit metadata;
- live stream can mark conflicts instead of overwriting dirty cells;
- conflict decorations appear through Insight Layer;
- conflict sidebar panel exists;
- resolving conflicts uses existing commit/validation/history paths;
- local/remote/custom resolution is supported;
- remote row model support is scoped honestly;
- source guards prove no architecture bypass.

Final report must say:

```text
Plan 130 complete. Wit Grid now has an explicit Conflict Resolution Layer for live/server/local data changes. Conflicts are metadata and decorations until resolved, resolution flows through existing commit, validation, history, invalidation, and render systems, and the feature strengthens data integrity without polluting core architecture.
```
