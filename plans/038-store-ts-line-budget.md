# Plan 038: `store.ts` line budget — reach ≤850

> **Executor instructions**: Follow each step precisely. This is a pure
> readability refactor — no semantic changes, only formatting.
> Update `plans/README.md` when done.

## Status

- **Priority**: P2
- **Effort**: XS
- **Risk**: NONE
- **Depends on**: nothing (standalone)
- **Category**: cleanup, maintainability
- **Planned at**: 2026-06-14

## Why this matters

`store.ts` is the central hub for the grid — it must stay easy to scan.
The architecture guard currently enforces `< 875` (an intermediate budget).
The real target is 850. At 873 lines, 23 lines need to go.

The simplest, least-invasive path: 12+ simple delegate methods in the 770–870
range each use a 3-line brace form (`{\n  return x;\n}`) even though the body
is a single expression. Collapsing those to arrow-expression form drops 2 lines
per method.

## Steps

### Step 1: Collapse pure single-expression delegates at lines 774–844

Each block has the form:

```ts
public foo = (arg: T): R => {
    return this.engine.foo(arg);
};
```

Collapse to:

```ts
public foo = (arg: T): R => this.engine.foo(arg);
```

Methods to collapse (12):

- `getColumnIndex`
- `getColumnField`
- `getColumnDef`
- `getCellAccess`
- `registerCellSubscription`
- `unregisterCellSubscription`
- `batch`
- `flushCellUpdatesSync`
- `registerPlugin`
- `unregisterPlugin`
- `undo`
- `redo`

### Step 2: Update architecture guard threshold

In `packages/core/src/engine/architectureGuards.test.ts` update the line
budget assertion from `< 875` to `< 855` (keeps a 5-line margin above 850).

### Step 3: Verify

```
corepack pnpm --filter @eregister/wit-grid-core test
```

→ exit 0.

## Done criteria

- [ ] `store.ts` is ≤850 lines.
- [ ] Guard threshold updated to `< 855`.
- [ ] All tests pass.
