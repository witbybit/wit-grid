# Plan 067: Portal Ownership and Single Edit Lifecycle

> **Why this is P0**: The React portal adapter currently behaves like a second renderer. Every custom portal cell can subscribe to global edit state, renderer identity is represented by several keys, and edit completion has more than one commit path. These are correctness risks before they are performance problems.

## Status

- **Priority**: P0 — correctness, editor stability, React hot-path control
- **Effort**: L
- **Risk**: HIGH — portal and editing lifecycle are tightly coupled
- **Depends on**: Plans 065–066
- **Category**: rendering, React adapter, editing, correctness
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

Portal ownership is currently spread across core slot state, portal mount management, custom renderer managers, and the React portal store. Custom portal cells may independently subscribe to `activeEdit`, causing all mounted custom renderers to receive notifications for one edited cell.

Editing can also complete through different paths:

- normal `commitEdit(...)`
- blur/Enter handling
- `editStopped` fallback using `setCellValue(...)`

These paths do not guarantee the same validation, async setter, formula, history, and event semantics.

## What to add

### 1. Formal mount identity

```ts
export interface CellMountIdentity {
	slotId: string;
	generation: number;
	columnId: string;
}
```

A slot increments `generation` whenever it is rebound to a different visual row. Deferred or async renderer work must validate the full identity before applying.

### 2. Push-based renderer payloads

```ts
export interface ReactCellRenderPayload {
	identity: CellMountIdentity;
	rowId: string;
	columnId: string;
	value: unknown;
	editState?: {
		value: unknown;
		validationError: string | null;
		pending: boolean;
	};
}
```

Core pushes payload changes to the affected renderer instance. Portal cells must not subscribe individually to global edit state.

### 3. One edit owner and one commit protocol

All edit completion flows call the same engine operation. Remove React-side fallback commits through `setCellValue`.

Required semantics:

- commit succeeds -> editor closes
- synchronous validation fails -> editor remains mounted with error payload
- asynchronous commit is pending -> identity is pinned or safely cancellable
- stale completion after slot rebind -> ignored
- cancel -> no value mutation and one edit-stopped event

### 4. Thin React adapter

Split `GridPortal.tsx` by responsibility:

```text
portal/PortalRoot.tsx
portal/CellPortal.tsx
portal/RowPortal.tsx
portal/MenuPortal.tsx
editing/ReactCellEditorHost.tsx
portal/ReactPortalStore.ts
```

The store should reconcile mount descriptors, not reproduce core renderer state.

## Phases

### Phase 1 — Identity generations

- Add slot generation to row/cell slot ownership
- Attach identity to portal mount/update/release requests
- Reject stale deferred operations

### Phase 2 — Push edit payloads

- Remove per-cell `useSyncExternalStore` subscription to `activeEdit`
- Update only the active editor renderer when edit state changes
- Add instrumentation asserting one affected portal update

### Phase 3 — Unify commit behavior

- Route blur, Enter, API stop, and renderer callbacks through one engine command
- Remove fallback `setCellValue` commit
- Make async validation and cancellation explicit

### Phase 4 — Split React portal implementation

- Extract portal types and hosts
- Keep renderer ownership in core
- Reduce `GridPortal.tsx` to composition and adapter wiring

## STOP conditions

- Do not make React the owner of renderer identity.
- Do not keep the global edit subscription as a fallback.
- Do not close an editor before an async commit result is known unless the edit session is represented independently of the slot.
- Do not support multiple commit protocols for compatibility.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Tests must cover stale portal updates after rebind, one-cell edit notifications, blur/Enter/API commit parity, validation failure, async completion, cancellation, and exactly-once edit events.
