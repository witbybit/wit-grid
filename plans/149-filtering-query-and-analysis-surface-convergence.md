# Plan 149: Converge Filtering, Query Building, and Analysis Surfaces Into One Serious Workflow

## Mission

Make filtering feel complete and unified by connecting column filters, floating filters, set/date-style analysis affordances, query composition, chips, and saved views into one coherent user and API model.

## Why now

Filtering is one of the first deal-breaker features users evaluate. Wit Grid already has a strong internal row pipeline, but the analysis surface still needs to feel deliberate rather than accumulated. This plan turns filtering from a collection of widgets into a workflow teams can trust for real datasets.

## Focus areas

- align filter model, floating filters, chip bars, and advanced query expressions
- preserve deterministic projection/invalidation behavior as filter richness grows
- make distinct-value and set-like filters efficient on large datasets
- support serializable saved filter/query states without contract drift
- reduce conceptual duplication between “column filtering” and “query building”

## Architecture emphasis

- there should be one authoritative filter/query state model
- UI helpers must compile down to canonical filter/query representations
- analysis affordances should remain row-model-aware and virtualization-safe
- saved views should persist stable public state, not internal runtime fragments

## Related backlog

- should absorb or coordinate Plans 060 (`floating-filters`), 076 (`named-column-views-profiles`), 123 (`workspace-views-and-persistence-controls`), and 124 (`advanced-query-builder`)
- should preserve the public snapshot/persistence direction from Plans 115 and 116

## Done criteria

- filter/query UI surfaces compile into one consistent model and persistence shape
- large distinct-value and set-like scenarios remain bounded and tested
- saved views and analysis controls do not introduce state authority duplication
- the filtering surface feels feature-complete enough for serious evaluation workflows
