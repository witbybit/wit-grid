# Plan 029 - React Hook Lifecycle Contract Hardening

> Planned after plan 028. This is the next React-layer slice after the public surface split.

> Status: implemented and verified on 2026-06-13.

## Goal

Make the React hook contract as explicit as the component contract:

- separate initial ownership/configuration from live updates
- stop relying on runtime warnings to teach callers what is immutable
- remove the last overloaded/deprecated React entrypoints so the surface is fully explicit
- keep the demo aligned with the preferred entrypoints so the public API stays honest

## Why this matters

The public surface is now thinner, but the hooks still accept a single option bag that mixes:

- initial-only configuration like `getRowId`, `initialState`, and `persistence`
- live inputs like rows, columns, datasource, and styling

That works, but it still makes the API feel like a negotiation. AG Grid-level strength comes from making ownership and mutability obvious from the type shape, not from dev-time warnings.

## Proposed cut

1. Introduce an explicit lifecycle shape for hook inputs.
2. Split initial-only config from live update inputs in the public React types.
3. Move any remaining docs and examples to the explicit shape.
4. Add architecture guards so the React layer cannot drift back toward a single overloaded entrypoint.

## Working order

1. Inspect `packages/react/src/useGrid.ts` and `packages/react/src/types.ts` for the current option model.
2. Decide the smallest safe split that improves the contract without forcing a big bang migration.
3. Implement the type split and update internal hook wiring to use it.
4. Update the demo helpers and tests to consume the clarified contract.
5. Run React build/test and the demo build.

## Acceptance criteria

- Hook call sites read like ownership plus updates, not a mixed bag of rules.
- Initial-only behavior is represented in the type surface, not just in console warnings.
- The overloaded React surface is gone; only explicit entrypoints remain.
- The demo continues to use the preferred API entrypoints.
- React build/test and demo build stay green.

## Verification

- `pnpm --filter @eregister/wit-grid-react build`
- `pnpm --filter @eregister/wit-grid-react test`
- `pnpm --filter demo-app build`
