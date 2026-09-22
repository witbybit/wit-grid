# Plan 117: Private Runtime Composition Root

## Mission

Finalize the permanent internal runtime composition object so its name, dependencies, and adapter boundary match its true responsibility.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM - internal rename/decomposition with broad touch points
- **Depends on**: Plans 113-116
- **Category**: runtime composition, dependency narrowing, adapter boundary
- **State**: DONE on 2026-06-19

## Problem

The codebase already treated `GridStore` as a private runtime composition root in practice, but the surrounding wiring still mixed public factory concerns and private runtime composition concerns in the same module.

## Target end state

The runtime composition object should be private, explicit, and adapter-facing only through narrow capabilities.

For Plan 117, the least-disruptive honest outcome was:

- keep `GridStore` private
- make runtime composition explicit in a private internal module
- make host/plugin bridge capabilities more precise
- remove composition-only helpers from the public package surface

## Outcome

Plan 117 is implemented.

Delivered:

- runtime composition is now built in private [packages/core/src/internal/createGridRuntimeComposition.ts](/C:/Users/rishi/witbybit/wit-grid/packages/core/src/internal/createGridRuntimeComposition.ts)
- the public package no longer exports `createApiFacade`
- the internal bridge now models explicit composition roles with `GridRuntimeComposition` and `GridHostComposition`
- host wiring resolves the narrow host composition handle instead of a broader runtime bundle name
- create-grid factory code now delegates API/runtime registration to the private composition root instead of owning that wiring inline
- comments and guards now describe the object as a private runtime composition root rather than a public/store facade

## Non-negotiable invariants

- no public export
- no reverse lookup from public API in public/app code
- no raw mutation API
- no application or demo usage
- adapters receive narrow host capabilities only
- feature controllers receive only required dependencies
- the runtime root is not a general service locator

## Mandatory demolition

- concrete runtime recovery from public API
- feature/controller dependence on the full runtime root when narrow deps suffice
- stale naming or comments that imply public/store semantics where the object is private runtime composition

## Execution workstreams

### 1. Decide on naming

Decision:

- kept `GridStore` as the private concrete type for now
- renamed the bridge-facing composition concepts instead: `GridRuntimeComposition`, `GridHostComposition`

### 2. Narrow dependency injection

Delivered:

- host wiring now consumes `GridHostComposition`
- plugin-controller recovery remains narrow through `resolveGridPluginController(...)`
- the public factory module no longer contains the full API/runtime composition implementation

### 3. Remove remaining reverse-lookup assumptions

Delivered:

- internal tests/guards now assert against the new composition names
- public/internal entry tests confirm the bridge helpers remain non-exported
- no public API surface exposes the composition helper

### 4. Make the composition role explicit

Delivered:

- private runtime composition is now responsible for:
    - public API facade creation
    - runtime bridge registration
    - host composition binding
    - plugin controller attachment

## Verification

- no production code outside composition roots depends on the concrete runtime root unnecessarily
- adapters compile and run against narrow host capabilities only
- demo/application code imports no runtime internals
- architecture guards enforce the private runtime-root boundary

Verification completed:

- `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/boundary.test.ts src/gridHost.test.ts src/gridHost.adversarial.test.ts src/engine/architectureGuards.test.ts`
- `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/persistence/statePersistence.test.ts src/store.test.ts`
- `corepack pnpm --filter @eregister/wit-grid-core build`

## Completion gate

- the runtime composition object has an honest role and boundary
- the adapter/runtime relationship is narrow and explicit
- no public or application code depends on the concrete runtime root

## Notes

- This plan deliberately did not rename `GridStore` to `GridKernel` or `GridRuntime`; the clearer win was separating runtime-composition concepts and removing public composition leakage first.
- The new internal composition root is private implementation detail only and is not exported from package entrypoints.
