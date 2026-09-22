# Plans 145-152: Default Serious Grid Program

## Objective

Turn Wit Grid from a deeply hardened core into the default serious choice for real product teams:

- simple use cases stay easy
- advanced use cases stay composable
- React feels trustworthy
- async/server data feels first-class
- high-frequency editing feels spreadsheet-grade
- customization does not require breaking architecture

## Why this program exists

The repo has spent a long stretch hardening core ownership, canonical writes, deterministic invalidation, and hot-path performance. That work was necessary. The next risk is different: shipping advanced features on top of a core that is strong internally but still incomplete in the areas that determine broad adoption.

This program focuses on the features and contracts that make teams stop evaluating AG Grid, Airtable-style grids, and spreadsheet hybrids separately.

## North-star outcomes

- product teams can trust the React adapter under real app churn
- client, infinite, and server-style row models expose consistent behavior under edits, selection, filtering, integrity, and viewport churn
- editing, clipboard, fill, validation, formulas, and advanced editors behave like one system
- grouping, tree data, master/detail, and pinned lanes compose without visual or state corruption
- filtering, query building, and analysis affordances feel complete enough for serious workflows
- import/export and integration surfaces make Wit Grid usable in business applications instead of only demos
- long-session performance stays fast, predictable, and measurable
- advanced customization happens through explicit extension seams instead of internal reach-through

## Program order

### Phase A - Trust the default stack

1. `145-react-adapter-lifecycle-and-public-contract-resilience.md`
2. `146-async-row-models-and-server-runtime-parity.md`
3. `147-editing-clipboard-fill-formula-and-capability-maturity.md`
4. `148-group-tree-master-detail-and-pinned-composition.md`

### Phase B - Complete high-impact product expectations

5. `149-filtering-query-and-analysis-surface-convergence.md`
6. `150-import-export-and-interoperability-foundation.md`
7. `152-extension-surface-and-enterprise-customization-contract.md`

### Phase C - Preserve the edge while feature count grows

8. `151-long-session-performance-memory-and-scheduler-resilience.md`

## Relationship to existing TODO plans

This program does not replace the existing backlog. It organizes it:

- Plan 060 (`floating-filters`) feeds Plan 149
- Plan 061 (`react-hook-surface`) feeds Plan 145
- Plan 062 (`xlsx-export`) feeds Plan 150
- Plan 064 (`ssrm-server-push-filter-sort`) follows Plan 146
- Plan 075 (`formula-bar-cross-cell-formulas`) and Plan 077 (`advanced-cell-editors`) feed Plan 147
- Plan 122 (`grid-devtools-runtime-inspector`) is a strong companion to Plans 145, 146, and 151
- Plan 124 (`advanced-query-builder`) feeds Plan 149
- Plan 125 (`validation-and-cell-capability-framework`) feeds Plans 147 and 152

## Sequencing rules

- Do not start major differentiators like pivoting, scenario workspaces, or conflict workbenches until at least Plans 145-149 are complete.
- Every new feature in this program must preserve the canonical write pipeline, commit-owned invalidation, and renderer hot-path budgets established through Plans 131-144.
- If any plan reveals missing core ownership, stop and write a narrow follow-up architecture plan before layering more surface area on top.

## Exit criteria

This program is successful when:

- the common enterprise evaluation checklist is covered without architectural backsliding
- cross-feature gauntlets and perf budgets remain green as feature count rises
- React and async/server usage feel first-class rather than adapter-like
- the repo is ready to add flagship differentiators from a position of strength rather than compensation
