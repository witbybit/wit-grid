# Plan 152: Make Customization Powerful Without Letting Consumers Break the Core

## Mission

Define the extension and customization contract that lets teams build custom editors, renderers, menus, tool panels, inspectors, commands, and workflow integrations without internal imports or architecture-breaking escape hatches.

## Why now

Desirability is not just feature count. Teams choose a grid they can bend safely to their product. If the only way to customize advanced behavior is to reach into internals, the grid stays impressive but not adoptable. This plan turns Wit Grid into a platform without turning it into a dependency hazard.

## Focus areas

- explicit extension seams for renderers, editors, menus, panels, and commands
- plugin/runtime contracts that use public or intentionally-internalized surfaces only
- capability, validation, integrity, and event surfaces that custom features can consume safely
- examples and tests that prove advanced customization does not require store/engine downcasts
- guardrails against accidental public-surface sprawl

## Architecture emphasis

- extension power should come from narrow stable contracts, not broad object exposure
- customization must preserve canonical writes, projection ownership, and invalidation determinism
- internal composition roots can evolve, but consumer extension points must be deliberate
- examples should teach the supported path so teams do not cargo-cult internals

## Related backlog

- builds on Plans 101, 117, and 145
- should align with Plan 125 (`validation-and-cell-capability-framework`) and Plan 122 (`grid-devtools-runtime-inspector`)
- should reduce the need for future “compatibility hub” style exceptions

## Done criteria

- advanced customization scenarios are possible through explicit supported contracts
- no new extension feature requires public exposure of mutable runtime internals
- package-consumer tests or examples prove the extension seams are sufficient
- Wit Grid becomes easier to tailor deeply while staying maintainable
