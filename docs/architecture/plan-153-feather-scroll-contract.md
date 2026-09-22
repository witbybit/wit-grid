# Plan 153 Phase A: Feather Scroll Contract

## Purpose

Phase A defines what "feather scroll" means before the renderer changes underneath it.

This contract is intentionally two-part:

1. Motion quality
2. Fidelity quality

The grid is not allowed to look fast by quietly dropping correctness.

## Non-negotiable perceptual rules

- No blank visible cells during scroll.
- No visible cell may show stale content from a previous row or column identity.
- Integrity decorations must remain visually coherent through motion.
- Pinned and center lanes must feel like one surface.
- Direct interaction must not be required to "wake up" correct visible content.

## Metric split

Review scroll work in two buckets instead of one blended number.

### Motion metrics

These represent gesture-path cost and should stay close to geometry-dominant work:

- `scrollFrames`
- `stateReadsDuringScroll`
- `cellsVisitedDuringScroll`
- `cellsWrittenDuringScroll`
- `portalOpsDuringScroll`
- `valueGetterCallsDuringScroll`
- `getCellValueCallsDuringScroll`
- `formulaCallsDuringScroll`
- `customRendererMountsDuringScroll`

### Fidelity metrics

These represent prewarm and settle quality, not gesture-path cost:

- `prewarmPasses`
- `prewarmedDisplayValues`
- `prewarmedCellSnapshots`
- `cellsDecoratedAfterScroll`
- `postScrollDirtyCellsDecorated`
- `customRendererWarmHits`
- `customRendererWarmMisses`

## Scenario matrix

The contract is only meaningful if we exercise different failure modes:

- Vertical-only scroll
- Horizontal-only scroll
- Mixed diagonal scroll
- Wide-grid buffered reveal
- Integrity-heavy scroll
- Custom-renderer-heavy scroll
- Server-backed scroll with loading churn

Executable evidence for these scenarios lives primarily in [serverRuntimePerformance.test.ts](C:/Users/rishi/witbybit/wit-grid/packages/core/src/renderer/serverRuntimePerformance.test.ts), with complementary reveal and prewarm regressions in [renderEngine.test.ts](C:/Users/rishi/witbybit/wit-grid/packages/core/src/renderer/renderEngine.test.ts).

## Human review rubric

When reviewing a PR for Plan 153, ask these in order:

1. Did any visible cell go blank at any point?
2. Did any visible cell reveal stale text, stale portal content, or the wrong row/column identity?
3. Did validation, diff, conflict, or quality styling disappear and fail to recover?
4. Did pinned lanes move or wake differently than center lanes?
5. Did the motion feel calm, continuous, and low-jitter at the viewport center?
6. If fidelity lagged, was it outside the foveal path and still deterministic?

If the answer to any of the first four is "yes", the change fails regardless of counters.

## Exit criteria for Phase A

Phase A is complete when:

- the perceptual contract is written down
- scenario evidence exists in automated tests
- motion and fidelity metrics are discussed separately
- later phases can be judged against a stable review language instead of subjective memory
