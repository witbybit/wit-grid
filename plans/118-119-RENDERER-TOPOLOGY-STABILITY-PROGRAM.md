# Wit Grid Renderer and Topology Stability Program — Plans 118–119

## Purpose

Plans 118 and 119 close two coupled renderer design flaws:

1. Physical body-cell and React renderer ownership is tied to lane slots rather than stable cell identity.
2. Header, body, and floating-filter lanes independently infer topology and mix viewport/content coordinates.

The program replaces both with stable physical views driven by one compiled column topology.

## Execution order

### Plan 118 — Stable CellView Ownership and Renderer Lifecycle Convergence

Establishes:

- one stable physical cell per row slot and rendered column;
- exact cell-instance identity;
- lane-independent renderer lifecycle;
- persistent React portal hosts;
- non-blanking content transitions;
- placement, refresh, structural, and decoration operation categories.

Plan 118 must land first because Plan 119 needs stable views that can be relocated by topology.

### Plan 119 — Unified Column Topology and Pinned-Lane Rendering

Establishes:

- one column topology authority;
- viewport-fixed pinned lanes;
- center-only horizontal translation;
- stable header and floating-filter views;
- shared body/header/filter placement;
- deterministic group segmentation and topology reconciliation.

## Combined target

```text
ColumnModel + Geometry
→ CompiledColumnTopology
    ├── HeaderView placement
    ├── FloatingFilterView placement
    └── RowSlot.cellsByColumnId → CellView placement
```

```text
CellView
├── stable physical identity
├── stable DOM element
├── persistent portal host
├── unified renderer handle
├── row binding generation
└── topology placement
```

## Global forbidden patterns

- Fixing correctness with full redraws.
- Increasing overscan to hide lane drift.
- Clearing visible content before replacement is committed.
- Retargeting React portals during pin/unpin.
- Treating lane change as destroy/create.
- Keying header identity by displayed index.
- Counter-transforming pinned layers during scroll.
- Independent lane arithmetic in header/body/filter renderers.
- Keeping both old and new ownership/topology systems after migration.

## Program success criteria

After both plans:

- pin/unpin preserves retained cell, renderer, header, and floating-filter instances;
- rapid vertical scroll produces no blank React cells;
- rapid horizontal scroll produces no foreign headers or filters inside pinned lanes;
- pinned layers receive zero steady-scroll layout writes;
- only center content translates horizontally;
- one topology version drives every column-oriented renderer;
- no correctness fallback requires full redraw or broad portal release;
- lifecycle and topology metrics prove structural churn only for true entered/exited views.
