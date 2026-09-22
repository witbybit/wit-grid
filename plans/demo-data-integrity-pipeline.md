# Demo: Data Integrity Pipeline

## Demo Mission

Create one cohesive demo that proves the full data integrity story:

```text
Wit Grid is not only fast.
It helps users trust, review, validate, and safely update data.
```

The demo should showcase Plans 126–130 together:

```text
Insight Layer Foundation
→ Data Quality Panel
→ Data Diff Mode
→ Live Data Stream MVP
→ Conflict Resolution Layer
```

This demo must prove these tools sit on top of the core engine.

It must also prove that all real data changes still flow through existing commit/mutation/history/invalidation/render systems.

---

## Demo name

Suggested route/page:

```text
Data Integrity Lab
```

or:

```text
Integrity Pipeline Demo
```

---

## Dataset

Use an invoice/order-like dataset because it naturally shows data quality, diff, validation, live updates, and conflicts.

Example row shape:

```ts
interface IntegrityRow {
	id: string;
	invoiceNo: string;
	customerName: string;
	customerEmail: string;
	status: 'Draft' | 'Pending' | 'Approved' | 'Paid' | 'Disputed';
	amount: number;
	dueDate: string;
	updatedAt: string;
	owner: string;
}
```

Initial data should intentionally include:

```text
missing customer name
duplicate invoice number
invalid email
negative amount
missing due date
several valid rows
```

---

## Columns

Columns should include validation metadata:

```ts
const columns = [
	{
		field: 'invoiceNo',
		headerName: 'Invoice No',
		required: true,
	},
	{
		field: 'customerName',
		headerName: 'Customer',
		required: true,
	},
	{
		field: 'customerEmail',
		headerName: 'Email',
		required: true,
		valueValidator: ({ value }) => (isValidEmail(value) ? null : 'Invalid email'),
	},
	{
		field: 'status',
		headerName: 'Status',
	},
	{
		field: 'amount',
		headerName: 'Amount',
		valueValidator: ({ value }) => (Number(value) >= 0 ? null : 'Amount cannot be negative'),
	},
	{
		field: 'dueDate',
		headerName: 'Due Date',
		required: true,
	},
	{
		field: 'owner',
		headerName: 'Owner',
	},
];
```

Adjust to your real validation API.

---

## Sidebar panels

Enable:

```text
Columns
Filters
Views
Query
Data Quality
Diff
Conflicts
DevTools
```

If all panels are too much, make a dedicated layout with primary panels:

```text
Data Quality
Diff
Conflicts
DevTools
```

---

## Demo section 1: Data Quality

### Flow

1. Load dirty dataset.
2. Open Data Quality panel.
3. Click “Run checks.”
4. Panel shows:
    - invalid emails;
    - missing required fields;
    - duplicate invoice numbers;
    - negative amount validation errors.
5. Cells are decorated.
6. Clicking an issue focuses the cell.
7. Clear report removes decorations.

### What this proves

```text
Validation is visible.
Data problems are reportable.
Insight decorations work.
The grid helps users trust data.
```

### DevTools check

DevTools should show:

```text
insight layer: dataQuality
issue counts
last run scope
decorations active
```

---

## Demo section 2: Data Diff

### Prepare compare dataset

Create modified dataset:

```text
one invoice amount changed
one status changed
one customer name corrected
one new row added
one row removed
```

### Flow

1. Click “Compare with updated dataset.”
2. `api.setDiffModel()` is called.
3. Diff panel shows:
    - added rows;
    - removed rows;
    - changed rows;
    - changed cells.
4. Changed cells are highlighted.
5. Clicking changed cell focuses it.
6. Tooltip shows old/new values.
7. Clear diff removes decorations.

Optional:

8. Accept one cell diff.
9. It commits through normal mutation/history.

### What this proves

```text
The grid can review data changes without replacing row model.
Diff is metadata/decorations, not mutated row data.
Accepting changes uses normal commit pipeline.
```

### DevTools check

DevTools should show:

```text
insight layer: diff
changedCells count
last computed time
commit if accept was used
```

---

## Demo section 3: Live Stream MVP

### Flow

1. Click “Start Live Stream.”
2. Random updates arrive:
    - amount changes;
    - status changes;
    - updatedAt changes.
3. Updates batch/coalesce.
4. Cells flash on update.
5. Pause stream.
6. Updates queue or stop according to implementation.
7. Resume stream.
8. Flush now.

### What this proves

```text
Live updates go through existing commit APIs.
Cells update without renderer hacks.
Flash is decoration-only.
Stream diagnostics are observable.
```

### DevTools check

DevTools should show:

```text
stream active
pending updates
committed batches
last flush duration
skipped dirty updates
```

---

## Demo section 4: Conflict Resolution

### Flow

1. Start stream with `dirtyCellPolicy: 'markConflict'`.
2. User edits a cell or marks one locally dirty.
3. Stream sends remote update for same row/column.
4. Grid does not overwrite local value.
5. Conflict cell decoration appears.
6. Conflicts panel shows:
    - local value;
    - remote value;
    - source;
    - created time.
7. User clicks “Use remote.”
8. Value commits through normal mutation path.
9. Conflict clears.
10. Repeat conflict and choose “Keep local.”
11. Conflict clears without changing current value.

### What this proves

```text
The grid does not silently overwrite user edits.
Conflicts are explicit metadata.
Resolution uses validation/capability/commit pipeline.
```

### DevTools check

DevTools should show:

```text
conflict count
latest conflict
resolved conflict count
stream conflict event
normal commit on use-remote/custom
```

---

## Demo section 5: Full pipeline story

This is the most important part.

### Narrative

```text
1. Load messy invoice data.
2. Data Quality finds problems.
3. User corrects a few cells.
4. Diff Mode compares original vs corrected data.
5. User reviews changes.
6. Live Stream simulates server updates.
7. Conflict appears where server update touches local change.
8. User resolves conflict.
9. DevTools proves every mutation went through the normal pipeline.
```

### This proves

```text
Wit Grid is not just rendering data.
It protects data integrity.
It makes changes explainable.
It makes unsafe overwrites visible.
It complements the core architecture instead of bypassing it.
```

---

## Demo controls

Add a top toolbar:

```text
Run Quality Check
Clear Quality
Compare Updated Dataset
Clear Diff
Start Stream
Pause Stream
Resume Stream
Stop Stream
Create Conflict
Resolve All Local
Resolve All Remote
Open DevTools
Reset Demo
```

---

## Demo technical guardrails

The demo must not cheat.

Forbidden:

```text
direct setState row mutation
direct DOM class toggling
manual renderer refresh
manual conflict UI state unrelated to core conflict manager
manual fake quality report not produced by DataQualityManager
manual fake diff report not produced by DiffManager
```

Required:

```text
quality via api.runDataQualityCheck()
diff via api.setDiffModel()
stream via api.createTransactionStream()
conflicts via ConflictManager/API
focus via existing api.setFocusedCell()
mutations via existing commit APIs
```

---

## Acceptance checklist

The demo is complete when:

- Data Quality reports real validation/missing/duplicate issues;
- cells are decorated through Insight Layer;
- Diff reports real changed cells;
- live stream flashes changed cells;
- dirty local cells are not overwritten silently;
- conflicts appear and resolve;
- DevTools shows diagnostics for all layers;
- resetting demo clears quality, diff, stream, conflicts, and restores data;
- no demo code bypasses core mutation/render systems.

---

## Suggested final demo copy

Use this description in the demo app:

```text
Data Integrity Lab demonstrates how Wit Grid can validate, review, compare, stream, and safely reconcile data changes without compromising the core engine. Quality issues, diffs, live updates, and conflicts are implemented as insight layers that sit on top of the existing commit, invalidation, render, and diagnostics systems.
```
