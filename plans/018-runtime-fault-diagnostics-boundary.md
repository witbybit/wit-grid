# Plan 018: Normalize runtime fault reporting before renderer refactors

> **Executor instructions**: Execute this plan end to end. Run each verification
> command before moving on. If a STOP condition occurs, stop and report instead
> of improvising.
>
> **Drift check (run first)**:
> `git diff --stat bb60b76..HEAD -- packages/core/src/events/EventBus.ts packages/core/src/state/StateManager.ts packages/core/src/commands/CommandHistory.ts packages/core/src/plugins/GridPluginRegistry.ts packages/core/src/engine/CellNotificationController.ts packages/core/src/serverRowModel.ts packages/core/src/engine/GridEngine.ts packages/core/src/store.ts packages/core/src/createGrid.ts packages/core/src/api/GridEvents.ts packages/core/src/api/GridApi.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/017-row-model-runtime-boundary.md`
- **Category**: tech-debt
- **Planned at**: commit `bb60b76`, 2026-06-12

## Why this matters

Plan 017 removed the last broad store coupling directly under the visual row
producers. The remaining pre-renderer architectural seam is failure policy.
Core runtime subsystems still catch exceptions locally and then either
`console.error(...)`, swallow the fault, or mutate state ad hoc without any
shared diagnostic surface.

That is workable for demos, but it is not industrial-grade. Before touching the
renderers we want:

- one owned runtime fault reporter,
- one consistent event surface for runtime faults,
- bounded retained diagnostics instead of ephemeral console output,
- core listeners/history/plugins/server loading reporting through the same path,
- tests and guardrails that stop local `console.error` drift from returning.

## Current state

- `packages/core/src/events/EventBus.ts` catches listener failures and logs
  inline.
- `packages/core/src/state/StateManager.ts` logs in global listeners,
  targeted listeners, and on-change callbacks.
- `packages/core/src/commands/CommandHistory.ts` logs undo/redo failures.
- `packages/core/src/plugins/GridPluginRegistry.ts` does not guard `onInit`
  and logs raw errors in `onDestroy`.
- `packages/core/src/engine/CellNotificationController.ts` logs subscription
  callback failures.
- `packages/core/src/serverRowModel.ts` routes fetch failures through a local
  runtime callback that still resolves to ad hoc logging today.

## Scope

**In scope**:

- Core non-renderer runtime fault paths
- Shared runtime fault reporter / event payloads
- Store/API access to recent fault snapshots
- Architecture guardrails and focused tests

**Out of scope**:

- Renderer-specific style-slot and portal error handling
- A user-facing overlay/toast UX for runtime faults
- Redesigning persistence error semantics
- Changing normal row-model, event, plugin, or selection behavior beyond fault
  reporting

## Steps

### Step 1: Introduce a shared runtime fault reporter

Add a bounded reporter that:

- normalizes captured fault metadata,
- logs through one formatting path,
- stores a recent snapshot,
- optionally emits a `runtimeFault` grid event.

### Step 2: Wire core subsystems onto the reporter

Move core pre-renderer fault paths onto the shared reporter:

- `EventBus`
- `StateManager`
- `CommandHistory`
- `GridPluginRegistry`
- `CellNotificationController`
- server row model fetch failure reporting

Avoid recursive re-reporting when the `runtimeFault` event listener itself
throws.

### Step 3: Expose bounded diagnostics at the store/API boundary

Add a minimal surfaced contract so callers can:

- inspect recent runtime faults,
- clear them,
- subscribe via the new `runtimeFault` event.

Keep this smaller than a broad public diagnostics redesign.

### Step 4: Add tests and guardrails

Cover at least:

- reporter capture/retention behavior,
- event-listener fault capture,
- plugin lifecycle fault capture,
- server datasource failure capture,
- guardrails preventing scattered `console.error` in targeted pre-renderer core
  files.

## Verification

Run sequentially:

1. `corepack pnpm --filter @eregister/wit-grid-core build`
2. `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/diagnostics/RuntimeFaultReporter.test.ts src/store.test.ts src/serverRowModel.test.ts src/engine/architectureGuards.test.ts`
3. `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/engine/GridChangeApplier.test.ts src/engine/gridFeatureEffects.test.ts`
4. `corepack pnpm --filter @eregister/wit-grid-core test`
5. `corepack pnpm --filter @eregister/wit-grid-react build`
6. `corepack pnpm --filter @eregister/wit-grid-react test`
7. `corepack pnpm --filter demo-app build`

## Done criteria

- [ ] Pre-renderer core fault paths report through one shared runtime reporter.
- [ ] `runtimeFault` is available as a typed grid event.
- [ ] Recent runtime faults can be inspected and cleared through the API/store
      boundary.
- [ ] Targeted tests cover event, plugin, and server fault capture.
- [ ] Guardrails prevent the targeted non-renderer core files from drifting back
      to local `console.error`.
- [ ] Core, React, and demo verification all pass.

## STOP conditions

Stop and report if:

- This work requires renderer file refactors to preserve correctness.
- The reporter grows into a broad user-facing diagnostics product instead of a
  focused pre-renderer hardening seam.
- The public API changes needed become materially larger than a minimal fault
  snapshot/clear surface plus event payload.
