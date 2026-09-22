# Plan 128: Data Diff Mode

## Mission

Build a risk-averse Data Diff Mode that compares two datasets and exposes differences as read-only metadata/decorations.

This feature should prove Wit Grid can review data changes safely.

It should support:

```text
before vs after import
server vs local
snapshot A vs snapshot B
old report vs new report
```

The first version must be inline diff only.

Do not build side-by-side generated columns yet.

---

## Architectural rules

Data Diff must not:

```text
replace the row model
mutate grid rows
inject old/new values into row data
generate columns in the core column model for MVP
write DOM directly
own selection/focus/editing
bypass commit kernel for accept/reject
```

Diff is:

```text
base dataset + compare dataset
→ diff result
→ row/cell decorations
→ optional review actions through normal commit APIs
```

---

## Core types

```ts
export interface GridDiffDataset<TRowData> {
	readonly id: string;
	readonly label: string;
	readonly rows: readonly TRowData[];
	readonly getRowId?: (row: TRowData) => string;
}

export interface GridDiffModel<TRowData> {
	readonly id: string;
	readonly mode: 'inline';
	readonly base: GridDiffDataset<TRowData>;
	readonly compare: GridDiffDataset<TRowData>;
	readonly options?: GridDiffOptions;
}

export interface GridDiffOptions {
	readonly compareFields?: readonly string[];
	readonly ignoreFields?: readonly string[];
}

export interface GridCellDiff {
	readonly rowId: string;
	readonly colField: string;
	readonly oldValue: unknown;
	readonly newValue: unknown;
	readonly status: 'added' | 'removed' | 'changed';
}

export interface GridDiffResult {
	readonly addedRows: readonly string[];
	readonly removedRows: readonly string[];
	readonly changedRows: readonly string[];
	readonly changedCells: readonly GridCellDiff[];
}
```

---

## Diff manager

Add:

```ts
export class GridDiffManager<TRowData> implements GridInsightLayer {
	readonly id = 'diff';

	setDiffModel(model: GridDiffModel<TRowData> | null): void;
	getDiffModel(): GridDiffModel<TRowData> | null;
	getDiffResult(): GridDiffResult | null;
	getCellDiff(rowId: string, colField: string): GridCellDiff | null;
	clear(): void;

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[];

	getRowDecorations(rowId: string): readonly GridRowDecoration[];

	getDiagnostics(): GridDiffDiagnostics;
}
```

Diagnostics:

```ts
export interface GridDiffDiagnostics {
	readonly active: boolean;
	readonly addedRows: number;
	readonly removedRows: number;
	readonly changedRows: number;
	readonly changedCells: number;
	readonly lastComputedAt: number | null;
}
```

Register as an insight layer.

---

## Diff comparison rules

MVP comparison:

```text
compare by row ID
compare visible/current columns by field
use Object.is for value equality
support compareFields / ignoreFields
```

Do not introduce deep object diff yet.

For object values, treat as changed by identity/reference or stringified shallow comparison only if already supported.

Deep diff can come later.

---

## Added/removed row semantics

Inline diff has a challenge:

```text
What does “removed row” mean if current grid only displays compare rows?
```

For MVP:

- changed cells decorate cells that exist in both datasets;
- added rows decorate row-level state if compare has row not in base;
- removed rows appear in Diff panel summary/list;
- do not inject removed rows into the active row model in MVP.

This avoids polluting the row model.

A future side-by-side/review mode can display removed rows as synthetic review rows, but not now.

---

## Decorations

Cell classes:

```css
.og-cell-diff-changed {
	outline: 1px solid var(--og-warning-border);
}

.og-cell-diff-added {
	outline: 1px solid var(--og-success-border);
}

.og-cell-diff-removed {
	outline: 1px solid var(--og-danger-border);
}

.og-row-diff-added {
}

.og-row-diff-removed {
}

.og-row-diff-changed {
}
```

Tooltips:

```text
Old: <oldValue>
New: <newValue>
```

---

## API

Add:

```ts
api.setDiffModel(model: GridDiffModel<TRowData> | null): void;

api.clearDiffModel(): void;

api.getDiffResult(): GridDiffResult | null;

api.getCellDiff(
  rowId: string,
  colField: string
): GridCellDiff | null;
```

Optional review APIs for MVP:

```ts
api.acceptCellDiff(rowId: string, colField: string): void | Promise<void>;

api.rejectCellDiff(rowId: string, colField: string): void;
```

If `acceptCellDiff` exists, it must call normal mutation APIs:

```text
batchCellValues / setCellValue
→ GridCommitKernel
→ normal invalidation
→ history
```

Rejecting a diff should only clear/ignore diff metadata unless the current grid was already modified and needs a normal revert commit.

Keep accept/reject minimal.

---

## Sidebar panel

Add built-in panel:

```ts
{
  id: 'diff',
  label: 'Diff'
}
```

Panel should show:

- active diff label;
- added rows count;
- removed rows count;
- changed rows count;
- changed cells count;
- list of changed cells;
- focus changed cell;
- clear diff;
- accept selected cell/row if review API is implemented;
- reject selected diff if review API is implemented.

Do not build side-by-side view yet.

---

## Filtering changed rows

Optional MVP helper:

```ts
api.showDiffRows(kind?: 'added' | 'removed' | 'changed' | 'all'): void;
```

Safer alternative: panel button applies a normal filter/query if the query system supports metadata filtering.

If this creates row pipeline complexity, skip it.

---

## DevTools integration

DevTools should show:

- diff active/inactive;
- changed row/cell counts;
- last computed time.

---

## Demo requirement

Extend the Data Integrity demo:

1. Load base invoice/order dataset.
2. Create a modified compare dataset:
    - one amount changed;
    - one status changed;
    - one customer name changed;
    - one added row;
    - one removed row.
3. Apply `api.setDiffModel()`.
4. Diff panel shows summary.
5. Changed cells are highlighted.
6. Clicking changed cell focuses it.
7. Clearing diff removes decorations.

If accept-cell is implemented:

8. Accept one changed amount.
9. It commits through normal mutation/history.
10. DevTools shows normal commit/invalidation.

---

## Tests

Add tests:

1. Diff manager registers as insight layer.
2. Added rows detected.
3. Removed rows detected.
4. Changed cells detected.
5. Ignored fields are skipped.
6. Compare fields are respected.
7. Diff does not mutate base or compare rows.
8. Diff does not mutate current grid rows.
9. Cell decorations appear for changed cells.
10. Row decorations appear for added rows.
11. Removed rows appear in panel/report but are not injected into row model.
12. Clearing diff clears decorations.
13. Optional accept uses commit API.
14. Source guards pass.

---

## Extension points

Leave room for:

```text
side-by-side diff columns
deep object diff
accept/reject row
accept all valid changes
diff against persisted view
diff against server refresh
diff export
branch/scenario comparison
synthetic removed-row display mode
```

Do not build these now.

---

## Completion gate

Plan 128 is complete when:

- inline diff mode works;
- differences are exposed as insight decorations;
- removed rows are reported without row model pollution;
- no row model, renderer, or column model pollution occurs;
- diff is clearable;
- optional accept/reject uses existing commit APIs;
- Diff sidebar panel exists;
- DevTools can inspect diff diagnostics.

Final report must say:

```text
Plan 128 complete. Wit Grid now has risk-averse inline Data Diff Mode that compares datasets, reports added/removed/changed rows and cells, displays decorations through Insight Layers, and avoids polluting row models, renderers, columns, mutation, invalidation, or history.
```
