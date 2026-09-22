# Plan 031: Complete runtime fault routing for remaining core callback surfaces

> Status: implemented and verified on 2026-06-13.

## Goal

Finish the diagnostics boundary started in plan 018 by routing the remaining
core production callback failures through the runtime fault reporter instead of
local `console.error` calls.

## Why this matters

Feature work gets easier when failures have one observable path. Renderer
callbacks, context-menu clipboard operations, and row-pipeline custom
aggregations were still reporting locally, which made those paths harder to
test, subscribe to, and reason about.

## Implemented cut

1. Added `plugin` and `row-pipeline` runtime fault sources.
2. Exposed `reportRuntimeFault` on the typed plugin runtime facade.
3. Routed context-menu clipboard failures through plugin diagnostics.
4. Routed custom aggregation failures through a row-pipeline fault hook.
5. Routed fill-drag and header callback failures through renderer diagnostics.
6. Tightened architecture guards so these production paths do not drift back to
   scattered `console.error` calls.

## Verification

- `corepack pnpm --filter @eregister/wit-grid-core build`
- `corepack pnpm --filter @eregister/wit-grid-core test`
- `corepack pnpm --filter @eregister/wit-grid-react build`
- `corepack pnpm --filter @eregister/wit-grid-react test`
- `corepack pnpm --filter demo-app build`
