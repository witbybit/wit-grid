# Plan 127: Data Quality Panel

## Mission

Build a data quality system on top of existing validation, column metadata, and row access.

This feature should prove Wit Grid can help users trust their data.

It should answer:

```text
What is wrong, suspicious, missing, duplicated, or invalid in this dataset?
```

This plan must not replace the existing validation system.

It must aggregate validation and additional quality rules into a report.

---

## Architectural rules

Data Quality must be a read/report/decorate layer.

It must not:

```text
own validation
mutate rows directly
write DOM directly
create a new row pipeline
pretend to scan unloaded remote rows
bypass commit kernel for fixes
```

Quick fixes, if added, must use normal grid mutation APIs.

---

## Core types

```ts
export type DataQualityIssueType =
	| 'validation'
	| 'missing'
	| 'duplicate'
	| 'outlier'
	| 'typeMismatch'
	| 'formulaError'
	| 'inconsistentFormat'
	| 'custom';

export interface DataQualityIssue {
	readonly id: string;
	readonly type: DataQualityIssueType;
	readonly severity: 'info' | 'warning' | 'error';
	readonly rowId?: string;
	readonly colField?: string;
	readonly message: string;
	readonly value?: unknown;
	readonly groupKey?: string;
	readonly suggestedFix?: DataQualityFix;
}

export interface DataQualityFix {
	readonly id: string;
	readonly label: string;
	readonly kind: 'setCellValue' | 'batchCellValues' | 'applyTransaction' | 'custom';
}

export interface DataQualityReport {
	readonly id: string;
	readonly generatedAt: number;
	readonly scope: 'loadedRows' | 'filteredRows' | 'selectedRows' | 'allClientRows' | 'serverProvided';

	readonly issues: readonly DataQualityIssue[];

	readonly summary: {
		readonly totalIssues: number;
		readonly errors: number;
		readonly warnings: number;
		readonly infos: number;
	};
}
```

---

## Quality rule contract

Add extensible rules.

```ts
export interface DataQualityRuleContext<TRowData> {
	readonly rows: readonly TRowData[];
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly getRowId: (row: TRowData) => string;
}

export interface DataQualityRule<TRowData> {
	readonly id: string;
	readonly label: string;

	run(context: DataQualityRuleContext<TRowData>): readonly DataQualityIssue[] | Promise<readonly DataQualityIssue[]>;
}
```

Rules are read-only.

Rules cannot mutate rows.

---

## DataQualityManager

Add:

```ts
export class GridDataQualityManager<TRowData> implements GridInsightLayer {
	readonly id = 'dataQuality';

	run(scope?: DataQualityReport['scope']): Promise<DataQualityReport> | DataQualityReport;
	clear(): void;
	getReport(): DataQualityReport | null;

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[];

	getDiagnostics(): DataQualityDiagnostics;
}
```

Diagnostics:

```ts
export interface DataQualityDiagnostics {
	readonly active: boolean;
	readonly scope: string | null;
	readonly totalIssues: number;
	readonly errors: number;
	readonly warnings: number;
	readonly infos: number;
	readonly lastRunAt: number | null;
	readonly lastError: string | null;
}
```

Register this manager as an insight layer through Plan 126.

---

## Built-in checks for MVP

Implement low-risk checks first.

### 1. Existing validation aggregation

Convert existing validation errors into `DataQualityIssue`.

Validation remains source of truth.

### 2. Missing required values

Use existing column metadata if present:

```ts
column.required;
```

If the project has no existing required metadata, add it as optional metadata only:

```ts
required?: boolean | ((params) => boolean);
```

Do not make required validation compete with existing validators. It is a quality rule.

### 3. Duplicate value rule helper

Provide helper:

```ts
createDuplicateValueRule<TRowData>(
  colField: string,
  options?: {
    severity?: 'info' | 'warning' | 'error';
    ignoreEmpty?: boolean;
  }
): DataQualityRule<TRowData>
```

Do not automatically duplicate-check every column. That can be expensive and noisy.

### 4. Custom rules

Allow app-defined rules.

Do not implement outliers/type inference in the first version unless trivial. Those can come later.

---

## Remote row model rules

Be honest about scope.

Client row model:

```text
can run allClientRows
```

Infinite row model:

```text
loadedRows only
```

Server pagination:

```text
current page / loadedRows only
```

Future:

```text
serverProvided report
```

Do not claim full-dataset quality when the grid does not have full data.

The UI must display scope clearly:

```text
Scope: loaded rows only
```

---

## API

Add:

```ts
api.runDataQualityCheck(
  options?: { scope?: DataQualityReport['scope'] }
): Promise<DataQualityReport> | DataQualityReport;

api.getDataQualityReport(): DataQualityReport | null;

api.clearDataQualityReport(): void;

api.registerDataQualityRule(rule: DataQualityRule<TRowData>): void;

api.unregisterDataQualityRule(ruleId: string): void;
```

Optional later:

```ts
api.applyDataQualityFix(issueId: string, fixId: string): Promise<void>;
```

For this plan, quick fixes can be optional or limited.

If implemented, every fix must use commit APIs.

---

## Sidebar panel

Add built-in sidebar panel:

```ts
{
  id: 'dataQuality',
  label: 'Data Quality'
}
```

Panel sections:

```text
Summary
Validation Errors
Missing Values
Duplicates
Custom Rule Issues
```

Actions:

- Run checks;
- Clear report;
- Focus first issue;
- Show affected row/cell;
- Export report as JSON/CSV if export utility already exists;
- Filter/show issue rows later.

Issue row UI:

```text
severity
type
message
rowId
colField
focus button
```

Keep panel simple. It is a report UI, not a complex editor.

---

## Decorations

Expose cell decorations through Insight Layer.

CSS:

```css
.og-cell-quality-error {
	box-shadow: inset 0 -2px 0 var(--og-danger-border);
}

.og-cell-quality-warning {
	box-shadow: inset 0 -2px 0 var(--og-warning-border);
}

.og-cell-quality-info {
	box-shadow: inset 0 -2px 0 var(--og-info-border);
}
```

Decoration title should include issue messages.

If multiple issues exist on the same cell, aggregate them into one tooltip.

---

## DevTools integration

DevTools should show:

- Data Quality layer active/inactive;
- issue counts;
- last run;
- last error;
- scope.

---

## Demo requirement

Add the Data Integrity demo dataset with intentionally dirty rows:

```text
missing customer name
duplicate invoice number
invalid email through existing validator
negative amount through existing validator
missing due date
```

Demo should show:

1. Open Data Quality panel.
2. Run checks.
3. Issue summary appears.
4. Cells are decorated.
5. Clicking issue focuses the cell.
6. Clearing report removes decorations.

---

## Tests

Add tests:

1. Data Quality manager registers as insight layer.
2. Existing validation errors appear in quality report.
3. Missing required values are detected.
4. Duplicate value rule detects duplicates.
5. Custom rule issues appear.
6. Report summary counts are correct.
7. Cell decorations appear for issue cells.
8. Multiple issues on same cell aggregate.
9. Clearing report clears decorations.
10. Client scope all rows works.
11. Infinite/server scope is loaded/current rows only.
12. Quick fixes, if implemented, call commit APIs.
13. No direct row mutation occurs.
14. Source guards pass.

---

## Extension points

Leave room for:

```text
outlier detection
type inference
formula issue aggregation
server-provided quality reports
issue ignore/snooze
quality presets
AI-assisted cleanup suggestions
data quality score
```

Do not build these now.

---

## Completion gate

Plan 127 is complete when:

- Data Quality report system exists;
- existing validation is aggregated, not replaced;
- missing and duplicate checks exist;
- custom rules can be registered;
- Data Quality sidebar panel exists;
- issue decorations appear through Insight Layer;
- remote row model scope is honest;
- no row/model/render/commit pollution occurs.

Final report must say:

```text
Plan 127 complete. Wit Grid now has a Data Quality layer that aggregates validation and quality rules into reports, sidebar UI, diagnostics, and cell decorations without replacing validation or polluting row models, renderers, mutation, or invalidation.
```
