# Plan 003 — Row Pipeline Test Harness

**Written against commit:** `970c777`  
**Branch:** `rendering-architecture-v2-wip-2`

---

## Why it matters

The five pipeline stages are the engine's critical data path — every data row the user sees passes through them in order: `groupStage` → `treeStage` → `sortTreeStage` → `aggregateStage` → `flattenStage`. A single subtle regression here silently corrupts the visual output for every grouped, sorted, or aggregated grid. All five files currently have **zero test coverage**.

---

## Scope

**In scope:**

- `packages/core/src/rows/stages/groupStage.test.ts` — new file
- `packages/core/src/rows/stages/treeStage.test.ts` — new file
- `packages/core/src/rows/stages/sortTreeStage.test.ts` — new file
- `packages/core/src/rows/stages/aggregateStage.test.ts` — new file
- `packages/core/src/rows/stages/flattenStage.test.ts` — new file

**Out of scope:**

- `RowPipeline.ts` (integration-level, separate concern)
- `RowDataStore.ts`
- Any renderer or store changes

---

## Architecture background

All five stage functions are **pure functions** (or nearly so — they mutate their inputs in `aggregateStage` but are deterministic). They share a common helper:

```ts
// packages/core/src/rows/pipelineContext.ts
function createRowPipelineContext<TData>(columns, expandedIds): RowPipelineContext<TData>;
```

The context provides `getValue(node, field)` and `getGroupKey(node, groupDef)`.

Key types (all in `packages/core/src/rows/stages/types.ts`):

```ts
type RowTreeNode<TData> =
	| { kind: 'data'; rowId: string; node: RowNode<TData>; depth: number; children?: RowTreeNode<TData>[] }
	| {
			kind: 'group';
			id: string;
			field: string;
			key: unknown;
			keyString: string;
			depth: number;
			path: GroupPathItem[];
			children: RowTreeNode<TData>[];
			childCount: number;
			leafCount: number;
			aggregateValues: Record<string, unknown>;
	  };
```

`RowNode<TData>` is imported from `../../store.js` and constructed as:

```ts
import { RowNode } from '../../store.js';
const node = new RowNode('id-1', { id: 'id-1', name: 'Alice', amount: 100 });
```

---

## Test patterns to follow

Use the `rowModel.test.ts` style: `describe` → `it`, import from the file under test, use a local `TestRow` interface. No stores, no React.

```ts
import { describe, it, expect } from 'vitest';
import { groupStage } from './groupStage.js';
import { RowNode } from '../../store.js';
import { createRowPipelineContext } from '../pipelineContext.js';
```

---

## Implementation steps

### Step 1 — `groupStage.test.ts`

Create `packages/core/src/rows/stages/groupStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RowNode } from '../../store.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { GroupDef } from '../RowPipeline.js';

interface Row {
	id: string;
	category: string;
	sub: string;
	amount: number;
}

function makeNode(id: string, data: Row) {
	return new RowNode(id, data);
}

function makeContext(cols: { field: string }[] = [{ field: 'category' }, { field: 'sub' }, { field: 'amount' }]) {
	return createRowPipelineContext<Row>(
		cols.map((c) => ({ field: c.field, header: c.field })),
		{ groups: new Set(), treeRows: new Set(), details: new Set() }
	);
}
```

**Tests to write (≥ 10):**

1. **No groupDefs returns flat data nodes** — `groupStage(nodes, [], ctx)` → all `kind: 'data'`, depth 0, count equals input length.
2. **Single-level grouping produces correct group keys** — 3 rows, 2 distinct categories → 2 group nodes.
3. **Group child counts are correct** — a group with 3 leaf rows has `childCount: 3`, `leafCount: 3`.
4. **Leaf nodes inside groups have correct depth** — leaf at depth 1 when grouped once.
5. **Two-level grouping nests correctly** — groups by `category` then `sub`; inner group has depth 1, leaves at depth 2.
6. **Empty input returns empty array**.
7. **All rows same key produces single group**.
8. **Group id is deterministic** — same data in same order → same `id` on group node.
9. **Custom `keyCreator` in GroupDef is used** — `keyCreator: ({ value }) => String(value).toUpperCase()` maps keys to uppercase.
10. **Custom `comparator` in GroupDef changes ordering** — `comparator: (a, b) => String(b).localeCompare(String(a))` reverses alphabetical order.

**Verification:** `pnpm -F @eregister/wit-grid-core test -- groupStage` — all pass.

---

### Step 2 — `treeStage.test.ts`

Create `packages/core/src/rows/stages/treeStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RowNode } from '../../store.js';
import { treeStage } from './treeStage.js';

interface Row {
	id: string;
	name: string;
	parentId?: string | null;
}

function makeNode(id: string, parentId?: string | null) {
	return new RowNode(id, { id, name: id, parentId });
}
const getParentId = (row: Row) => row.parentId ?? null;
```

**Tests to write (≥ 8):**

1. **Flat list (no parent IDs) → all roots at depth 0**.
2. **Parent-child → parent has child nested, child at depth 1**.
3. **Three-level hierarchy → correct depths 0, 1, 2**.
4. **Node with unknown parentId is treated as root** — orphan nodes don't vanish.
5. **Empty input → empty output**.
6. **Single node, no parent → single root**.
7. **Diamond/cycle guard** — if row A has parentId pointing to row B but row B is not in the input, A becomes a root.
8. **`children` array order matches input order for siblings**.

**Verification:** `pnpm -F @eregister/wit-grid-core test -- treeStage` — all pass.

---

### Step 3 — `sortTreeStage.test.ts`

Create `packages/core/src/rows/stages/sortTreeStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RowNode } from '../../store.js';
import { sortTreeStage } from './sortTreeStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { SortModel } from '../../rowModel.js';
```

**Tests to write (≥ 6):**

1. **Null / empty sortModel is a no-op** — tree structure unchanged.
2. **Ascending sort on string field orders roots correctly** — `['Banana', 'Apple', 'Cherry']` → `['Apple', 'Banana', 'Cherry']`.
3. **Descending sort reverses order**.
4. **Numeric field sorts numerically, not lexicographically** — `[10, 2, 100]` ascending → `[2, 10, 100]`.
5. **Sort is applied recursively to children** — siblings within a group are also sorted.
6. **Multi-column sort** — primary ascending, secondary descending.

**Verification:** `pnpm -F @eregister/wit-grid-core test -- sortTreeStage` — all pass.

---

### Step 4 — `aggregateStage.test.ts`

Create `packages/core/src/rows/stages/aggregateStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RowNode } from '../../store.js';
import { aggregateStage } from './aggregateStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { AggregationDef } from './aggregateStage.js';
```

**Helper:** Run `groupStage` first to get a `RowTreeNode[]`, then pass to `aggregateStage`. This mirrors the real pipeline.

**Tests to write (≥ 8):**

1. **`sum` aggregation totals leaf values correctly** — two groups, sum per group is correct.
2. **`count` aggregation counts leaf nodes** — `childCount` matches.
3. **`avg` aggregation computes mean** — 3 rows with amounts 10, 20, 30 → avg 20.
4. **`min` and `max` select boundary values**.
5. **Empty aggDefs is a no-op** — `aggregateValues` stays `{}`.
6. **Custom function aggregation** — `aggFunc: (nodes) => nodes.length * 2` returns double count.
7. **Non-numeric values are excluded from sum/avg/min/max** — strings in a numeric field don't throw or produce NaN.
8. **Nested groups propagate aggregates up** — two-level grouping: inner group sums first, outer group sums inner sums.
9. **Custom function that throws is caught** — `aggregateValues[field]` is `undefined`, no exception propagates.

**Verification:** `pnpm -F @eregister/wit-grid-core test -- aggregateStage` — all pass.

---

### Step 5 — `flattenStage.test.ts`

Create `packages/core/src/rows/stages/flattenStage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RowNode } from '../../store.js';
import { flattenStage } from './flattenStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { FlattenConfig } from './flattenStage.js';

const defaultConfig: FlattenConfig<any> = {
	expandedGroupIds: new Set(),
	expandedTreeRowIds: new Set(),
	expandedDetailRowIds: new Set(),
	defaultRowHeight: 38,
	rowHeightsRecord: {},
};
```

**Tests to write (≥ 10):**

1. **Flat data nodes (no grouping) flatten to same count as input**.
2. **Collapsed group → only group row appears, leaf rows hidden**.
3. **Expanded group → group row followed by leaf rows**.
4. **Two-level group, outer expanded, inner collapsed → outer group row + inner group row, no leaves**.
5. **Both levels expanded → all group rows + all leaf rows in correct order**.
6. **Row height from `rowHeightsRecord` overrides `defaultRowHeight`**.
7. **Group row height uses `groupRowHeight` config when set**.
8. **`masterDetailEnabled` + `expandedDetailRowIds` includes a detail row after its parent**.
9. **`includeFooter: true` adds a footer row after each group's children**.
10. **`defaultGroupsExpanded: true` expands all groups without explicit IDs in `expandedGroupIds`**.
11. **`kind` field on output rows is correct**: data rows are `'data'`, group rows are `'group'`, detail rows are `'detail'`.
12. **Output row `depth` matches the `RowTreeNode` depth**.

**Verification:** `pnpm -F @eregister/wit-grid-core test -- flattenStage` — all pass.

---

### Step 6 — Run full test suite

```bash
pnpm -F @eregister/wit-grid-core test
```

All existing tests must continue to pass. No existing test file may be modified.

---

## Files in scope

| File                                                   | Change type  |
| ------------------------------------------------------ | ------------ |
| `packages/core/src/rows/stages/groupStage.test.ts`     | **New file** |
| `packages/core/src/rows/stages/treeStage.test.ts`      | **New file** |
| `packages/core/src/rows/stages/sortTreeStage.test.ts`  | **New file** |
| `packages/core/src/rows/stages/aggregateStage.test.ts` | **New file** |
| `packages/core/src/rows/stages/flattenStage.test.ts`   | **New file** |

**Explicitly out of scope:** All non-test source files, `RowPipeline.ts`, React package, demo.

---

## Done criteria

```bash
pnpm -F @eregister/wit-grid-core test
# Expected output: all existing tests pass + new tests pass
# New test count: ≥ 43 new test cases across the 5 files
# Zero test failures, zero skipped tests
```

Individual file checks:

```bash
pnpm -F @eregister/wit-grid-core test -- groupStage     # ≥ 10 cases
pnpm -F @eregister/wit-grid-core test -- treeStage      # ≥ 8 cases
pnpm -F @eregister/wit-grid-core test -- sortTreeStage  # ≥ 6 cases
pnpm -F @eregister/wit-grid-core test -- aggregateStage # ≥ 9 cases
pnpm -F @eregister/wit-grid-core test -- flattenStage   # ≥ 12 cases
```

---

## Escape hatches

- If `RowNode` constructor signature has changed since `970c777`, check `packages/core/src/rowNode.ts` before writing tests. The `new RowNode(id, data)` form must still work.
- If `createRowPipelineContext` has changed, check `packages/core/src/rows/pipelineContext.ts`. The second argument's `groups/treeRows/details` shape must match.
- If any import path fails to resolve, check `packages/core/src/rows/stages/types.ts` for the correct `RowTreeNode` type.
- **STOP and report back** if the stage functions are no longer pure (e.g., they take a live store reference) — the test approach will need to change.

---

## Maintenance note

These tests should be extended whenever a new pipeline stage is added. If a stage's input/output shape changes (e.g., new fields on `RowTreeNode`), update the corresponding test file to cover the new shape.
