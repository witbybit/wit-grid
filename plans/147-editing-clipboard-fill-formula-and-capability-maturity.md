# Plan 147: Make Editing, Clipboard, Fill, Formulas, Validation, and Editors One Coherent System

## Mission

Raise the mutation UX from “several strong subsystems” to one spreadsheet-grade workflow where edits, pastes, fills, formulas, validation, capabilities, and editor components behave consistently under heavy use.

## Why now

This is daily-driver value. Users feel it immediately. It is also where grids often become inconsistent: one write path for edit commits, another for paste, a third for fill, and a fourth for advanced editors. Wit Grid already converged the core pipeline a lot; this plan turns that architectural win into product-level maturity.

## Focus areas

- consistent commit semantics across inline edit, advanced editors, paste, fill, undo/redo, and API writes
- capability and validation decisions that remain coherent no matter which write surface is used
- formula and dependency recomputation that stays predictable during bulk edits
- advanced editor lifecycle and commit/reject behavior that does not bypass the canonical write path
- clear user-visible boundaries for atomic vs partial bulk writes

## Architecture emphasis

- every write surface must remain a client of the same mutation authority
- validation and capability checks should be shared services, not duplicated policy
- formulas must behave like a first-class dependent system, not an afterthought on top of editing
- advanced editors should enrich the write pipeline, not fork it

## Related backlog

- depends on the architectural baseline from Plans 138 and 141
- should align Plan 075 (`formula-bar-cross-cell-formulas`), Plan 077 (`advanced-cell-editors`), and Plan 125 (`validation-and-cell-capability-framework`)
- should expand the composition gauntlets introduced in Plan 142

## Done criteria

- editing, paste, fill, formulas, validation, and undo/redo share explicit and tested commit semantics
- advanced editors route through the canonical mutation protocol without side channels
- bulk-write behavior is documented and testable for all-or-nothing vs partial-apply cases
- cross-feature suites cover at least edit + validation + formula + paste/fill + undo/redo combinations
