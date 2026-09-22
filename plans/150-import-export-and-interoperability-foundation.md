# Plan 150: Make Wit Grid Easy to Integrate Into Real Business Workflows

## Mission

Build the import/export and interoperability foundation that lets product teams move data in and out of Wit Grid confidently, with enough fidelity and control for real applications rather than demo-only flows.

## Why now

A grid does not become the default choice if it is hard to connect to the rest of a business workflow. Users need reliable export, import-adjacent write behavior, formatting fidelity, and integration hooks that make Wit Grid practical in apps with spreadsheets, reporting, and data exchange requirements.

## Focus areas

- mature export paths beyond CSV, especially spreadsheet-compatible output
- align exported values with displayed, raw, formatted, and formula-aware representations
- provide clear APIs for programmatic import-style bulk writes and reconciliation
- keep interoperability features compatible with validation, integrity, and capability systems
- prove that package consumers can adopt these surfaces without internal imports

## Architecture emphasis

- import/export should consume public contracts, not internal runtime reach-through
- data representation layers must be explicit so exported output is predictable
- interoperability should reinforce the canonical write pipeline rather than bypassing it
- API design should favor stable integration points over clever shortcuts

## Related backlog

- should absorb Plan 062 (`xlsx-export`)
- should align with Plans 133, 147, and 149 so bulk interchange remains mutation-safe and state-safe
- should reuse package-consumer verification patterns established in earlier foundation work

## Done criteria

- spreadsheet-compatible export has a clear and stable surface
- import-style programmatic writes compose with validation, undo, and integrity semantics
- package-consumer verification proves interoperability features are usable without internal APIs
- the grid can participate in real app workflows, not just in-browser editing demos
