import { DARK_THEME, themeToCSSVariables } from './themes.js';

/**
 * Structural and Visual CSS Styles for Wit Grid.
 *
 * Theme variables are injected by ThemeManager at runtime.
 * Default (dark theme) is defined here for quick load before ThemeManager.mount().
 *
 * CSS variable hierarchy:
 * 1. theme variables (--og-*) injected by ThemeManager
 * 2. structural classes (.og-*) that use those variables
 * 3. state classes (.og-*-active, .og-*-hover, etc.) that override or augment
 *
 * Users can override theme variables by:
 * - Using ThemeManager.setTheme() / .switchTheme()
 * - Switching or extending the core theme token set
 * - Directly setting CSS variables on .og-grid-container
 */
export const CORE_STYLES = `
  ${themeToCSSVariables(DARK_THEME, ':root, .og-grid-container')}

  :root, .og-grid-container {
    --og-overlay-top: var(--og-leaf-header-height);
  }

  @keyframes og-cell-flash {
    0%   { background-color: var(--og-copy-flash-color, rgba(99, 179, 237, 0.45)); }
    100% { background-color: transparent; }
  }

  .og-cell-flash {
    animation: og-cell-flash var(--og-copy-flash-duration, 380ms) ease-out;
  }

  @keyframes og-shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  .og-cell-loading-skeleton {
    width: var(--og-skeleton-width);
    height: var(--og-skeleton-height);
    border-radius: var(--og-skeleton-border-radius);
    background: linear-gradient(90deg, 
      var(--og-skeleton-start) 25%, 
      var(--og-skeleton-mid) 50%, 
      var(--og-skeleton-end) 75%
    );
    background-size: 200% 100%;
    animation: og-shimmer var(--og-skeleton-animation-duration) infinite linear;
  }

  .og-row-loading {
    pointer-events: none;
  }

  .og-grid-container {
    position: relative;
    overflow: hidden;
    contain: strict;
    font-family: var(--og-font-family);
    background-color: var(--og-bg-color);
    color: var(--og-text-color);
    border: 1px solid var(--og-border-color);
    border-radius: var(--og-outer-border-radius, 8px);
    box-sizing: border-box;
  }

  /*
   * Scroll viewport — single overflow container for both axes.
   * No CSS Grid: rows live in og-rows-container (block flow after the sticky header).
   */
  .og-scroll-viewport {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    /* Bottom chrome (status bar / pagination) is docked below the scroll viewport.
       The viewport gives up exactly that much height so content never sits under it.
       Default 0 → flush to the container bottom when no bottom chrome is configured. */
    bottom: var(--og-bottom-chrome-height, 0px);
    overflow: auto;
    z-index: 10;
  }

  /* ── Exit-animation overlay ─────────────────────────────────────────────── */
  /* Sits in the rows' content coordinate space; ghosts carry their own translateY.
     Pointer-inert and above normal rows so fade-outs read on top of rows sliding up. */
  .og-layer-exiting {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--og-content-width, 100%);
    height: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 4;
  }

  .og-layer-exiting > .og-row {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  /* ── Minimap: every displayed row on a strip beside the vertical scrollbar ─ */
  .og-layer-minimap {
    position: absolute;
    width: 10px;
    z-index: 30;
    cursor: pointer;
    background: color-mix(in srgb, var(--og-text-color) 5%, transparent);
    border-left: 1px solid color-mix(in srgb, var(--og-text-color) 10%, transparent);
    --og-minimap-window: color-mix(in srgb, var(--og-text-color) 22%, transparent);
    --og-minimap-selection: var(--og-focus-ring);
    --og-minimap-change: #f59e0b;
    --og-minimap-error: #ef4444;
    --og-minimap-warning: #f59e0b;
  }
  .og-layer-minimap[hidden] {
    display: none;
  }
  .og-minimap-canvas {
    display: block;
  }

  /* ── Presence: peers' cell cursors and cell flashes ─────────────────────── */
  /* Content coordinates like the rows; pointer-inert, above the cells. */
  .og-layer-presence {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 6;
  }

  .og-presence,
  .og-cell-flash {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
  }

  .og-presence {
    border: 2px solid var(--og-presence-color);
    border-radius: 3px;
    transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), width 240ms cubic-bezier(0.2, 0.8, 0.2, 1), height 240ms ease;
  }
  .og-presence-still {
    transition: none;
  }
  .og-presence[data-editing] {
    background: color-mix(in srgb, var(--og-presence-color) 14%, transparent);
    animation: og-presence-pulse 1.4s ease-in-out infinite;
  }

  .og-presence-tag {
    position: absolute;
    left: -2px;
    bottom: 100%;
    padding: 1px 6px;
    border-radius: 4px 4px 4px 0;
    background: var(--og-presence-color);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
  }
  .og-presence-tag-below {
    bottom: auto;
    top: 100%;
    border-radius: 0 4px 4px 4px;
  }
  .og-presence[data-editing] .og-presence-tag::after {
    content: ' ✎';
  }

  .og-cell-flash {
    background: var(--og-flash-color, var(--og-focus-ring));
    opacity: 0;
    animation: og-cell-flash 900ms ease-out;
  }

  @keyframes og-presence-pulse {
    50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-presence-color) 30%, transparent); }
  }
  @keyframes og-cell-flash {
    from { opacity: 0.38; }
    to { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .og-presence { transition: none; }
    .og-presence[data-editing] { animation: none; }
  }

  /* ── Floating filter row ────────────────────────────────────────────────── */

  /* Wrapper: sticky horizontal stripe, same z-index as the header. */
  /*
   * Floating filter wrapper — same flex+sticky model as the header wrapper.
   * overflow:clip preserves sticky propagation for pin lanes; no left:0 so the
   * wrapper scrolls horizontally (pin lanes handle their own sticky anchoring).
   */
  .og-layer-floating-filter-wrapper {
    position: sticky;
    top: 0;
    z-index: 11;
    box-sizing: border-box;
    background-color: var(--og-floating-filter-bg, var(--og-header-bg));
    border-bottom: 1px solid var(--og-border-color);
    overflow: clip;
  }

  /* Center lane — grows to fill space between pin lanes. */
  .og-layer-floating-filter {
    order: 1;
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
    height: 100%;
    overflow: hidden;
  }

  /* Left / right pin lanes — compositor-sticky, structurally clipped. */
  .og-layer-floating-filter-left,
  .og-layer-floating-filter-right {
    position: sticky;
    flex-shrink: 0;
    height: 100%;
    z-index: 2;
    overflow: hidden;
    contain: layout paint;
    background-color: var(--og-floating-filter-bg, var(--og-header-bg));
  }

  .og-layer-floating-filter-left {
    order: 0;
    left: 0;
    border-right: 1px solid var(--og-pin-left-border-color, var(--og-border-color));
  }

  .og-scrolled-left .og-layer-floating-filter-left {
    box-shadow: var(--og-pin-left-shadow, none);
  }

  .og-layer-floating-filter-right {
    order: 2;
    right: 0;
    border-left: 1px solid var(--og-pin-right-border-color, var(--og-border-color));
  }

  .og-scrolled-right .og-layer-floating-filter-right {
    box-shadow: var(--og-pin-right-shadow, none);
  }

  /* Individual filter cell */
  .og-floating-filter-cell {
    position: absolute;
    top: 0;
    height: 100%;
    box-sizing: border-box;
    border-right: 1px solid var(--og-border-color);
    display: flex;
    align-items: center;
    padding: 0 6px;
    overflow: hidden;
  }

  /* Default text / number / date input inside a filter cell */
  .og-floating-filter-input {
    width: 100%;
    height: 22px;
    background: var(--og-floating-filter-input-bg, var(--og-popover-input-bg, var(--og-bg-color)));
    border: 1px solid var(--og-floating-filter-input-border, var(--og-border-color));
    border-radius: 4px;
    color: var(--og-text-color);
    font-family: var(--og-font-family);
    font-size: 11px;
    padding: 0 6px;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.12s;
  }

  .og-floating-filter-input:focus {
    border-color: var(--og-focus-ring);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--og-focus-ring) 20%, transparent);
  }

  .og-floating-filter-input::placeholder {
    color: var(--og-text-color);
    opacity: 0.35;
  }

  /* Set filter badge — shows "N values" with a clear button */
  .og-floating-filter-set-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--og-focus-ring) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--og-focus-ring) 35%, transparent);
    color: var(--og-focus-ring);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .og-floating-filter-set-badge:hover {
    background: color-mix(in srgb, var(--og-focus-ring) 25%, transparent);
  }

  .og-floating-filter-empty {
    width: 100%;
    cursor: pointer;
    opacity: 0.35;
    font-size: 11px;
    font-family: var(--og-font-family);
    color: var(--og-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Operator picker button */
  .og-floating-filter-op-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    margin-right: 3px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--og-text-color);
    font-size: 11px;
    font-weight: 700;
    font-family: var(--og-font-family);
    cursor: pointer;
    opacity: 0.55;
    transition: opacity 0.1s, border-color 0.1s, background 0.1s;
    line-height: 1;
    white-space: nowrap;
  }

  .og-floating-filter-op-btn:hover {
    opacity: 1;
    border-color: var(--og-border-color);
    background: color-mix(in srgb, var(--og-text-color) 8%, transparent);
  }

  /* Label shown for blank/notBlank (no input needed) */
  .og-floating-filter-no-value {
    flex: 1;
    font-size: 10px;
    font-family: var(--og-font-family);
    color: var(--og-text-color);
    opacity: 0.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Range inputs take equal space */
  .og-ff-input-range {
    width: 0;
    flex: 1;
    min-width: 0;
  }

  /* Dash separator between range inputs */
  .og-ff-range-sep {
    flex-shrink: 0;
    padding: 0 2px;
    font-size: 10px;
    color: var(--og-text-color);
    opacity: 0.4;
  }

  /* ── Bottom chrome: status bar + pagination ─────────────────────────────── */

  .og-layer-status-bar,
  .og-layer-pagination {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 12;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    background-color: var(--og-header-bg);
    color: var(--og-text-color);
    font-size: 12px;
    user-select: none;
  }

  .og-layer-status-bar {
    gap: 16px;
    padding: 0 12px;
    border-top: 1px solid var(--og-border-color);
  }

  .og-status-bar-panel {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .og-status-bar-panel-label {
    opacity: 0.7;
  }

  .og-status-bar-panel-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .og-status-bar-spacer {
    flex: 1 1 auto;
  }

  .og-layer-pagination {
    gap: 6px;
    padding: 0 12px;
    justify-content: flex-end;
    border-top: 1px solid var(--og-border-color);
  }

  .og-pagination-summary {
    margin-right: auto;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  .og-pagination-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--og-border-color);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
  }

  .og-pagination-btn:hover:not(:disabled) {
    background-color: var(--og-row-hover-bg);
  }

  .og-pagination-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .og-pagination-page-info {
    margin: 0 8px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Filter chip bar ─────────────────────────────────────────────────── */

  .og-filter-chip-bar {
    position: sticky;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    background: var(--og-filter-chip-bar-bg, var(--og-header-bg));
    border-bottom: 1px solid var(--og-border-color);
    overflow: hidden;
  }

  .og-filter-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px 0 10px;
    border-radius: 11px;
    background: var(--og-filter-chip-bg, color-mix(in srgb, var(--og-focus-ring) 12%, transparent));
    border: 1px solid var(--og-filter-chip-border, color-mix(in srgb, var(--og-focus-ring) 35%, transparent));
    color: var(--og-filter-chip-color, var(--og-focus-ring));
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .og-filter-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  .og-filter-chip-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .og-filter-chip-remove:hover {
    opacity: 1;
    background: var(--og-filter-chip-border);
  }

  .og-filter-clear-all {
    margin-left: auto;
    padding: 3px 10px;
    height: 22px;
    border-radius: 4px;
    border: 1px solid var(--og-border-color);
    background: none;
    color: var(--og-header-text);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .og-filter-clear-all:hover {
    background: var(--og-row-hover-bg);
    opacity: 1;
  }

  /* ── Filter indicator on header cell ─────────────────────────────────── */

  .og-header-filter-indicator {
    display: none;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--og-focus-ring);
    opacity: 0.85;
  }

  /* ── Group panel ─────────────────────────────────────────────────────── */

  .og-group-panel {
    position: sticky;
    top: 0;
    z-index: 31;
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 7px;
    padding: 7px 10px;
    min-height: var(--og-group-panel-height);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0)),
      var(--og-header-bg);
    border-bottom: 1px solid var(--og-border-color);
    overflow: hidden;
    box-sizing: border-box;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.035) inset;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }

  .og-group-panel-drop-active {
    background:
      linear-gradient(90deg, rgba(59, 130, 246, 0.16), rgba(167, 139, 250, 0.09)),
      var(--og-header-bg);
    border-bottom-color: rgba(59, 130, 246, 0.4);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.22) inset, 0 10px 28px rgba(0, 0, 0, 0.26);
  }

  .og-group-panel-empty {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 26px;
    padding: 0 8px;
    border: 1px dashed rgba(148, 163, 184, 0.22);
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.26);
    font-size: 12px;
    color: var(--og-header-text);
    opacity: 0.82;
    pointer-events: none;
    user-select: none;
  }

  .og-group-panel-empty-icon {
    display: inline-flex;
    width: 18px;
    height: 18px;
    color: #93c5fd;
    opacity: 0.85;
  }

  .og-group-panel-label {
    flex: 0 0 auto;
    padding: 0 2px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
    color: #64748b;
  }

  /* Drop position indicator within the panel */
  .og-group-panel-drop-indicator {
    position: absolute;
    top: 5px;
    bottom: 5px;
    width: 3px;
    background: #60a5fa;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 18px rgba(96, 165, 250, 0.9);
    pointer-events: none;
    display: none;
    z-index: 4;
  }

  /* Group-by chip */
  .og-group-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 190px;
    height: 26px;
    padding: 0 7px 0 6px;
    background: var(--og-group-badge-bg, rgba(59, 130, 246, 0.18));
    border: 1px solid var(--og-group-badge-border, rgba(96, 165, 250, 0.38));
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--og-group-badge-text, #93c5fd);
    cursor: grab;
    user-select: none;
    white-space: nowrap;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset;
    transition: background 0.12s, border-color 0.12s, box-shadow 0.12s, opacity 0.12s, transform 0.12s;
  }

  .og-group-chip:hover {
    filter: brightness(1.15);
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.08) inset, 0 8px 18px rgba(0, 0, 0, 0.18);
  }

  .og-group-chip:focus-visible {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: 2px;
  }

  .og-group-chip:active,
  .og-group-panel-chip-dragging .og-group-chip {
    cursor: grabbing;
  }

  .og-group-chip-handle {
    display: inline-flex;
    align-items: center;
    opacity: 0.62;
    flex-shrink: 0;
    color: inherit;
  }

  .og-group-chip-handle svg {
    width: 8px;
    height: 13px;
  }

  .og-group-chip-label {
    font-size: 12px;
    line-height: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .og-group-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    opacity: 0.55;
    border-radius: 3px;
    flex-shrink: 0;
    transition: opacity 0.1s, background 0.1s;
  }

  .og-group-chip-remove:hover {
    opacity: 1;
    background: var(--og-group-badge-border, rgba(59, 130, 246, 0.25));
  }

  .og-group-chip-remove svg {
    width: 10px;
    height: 10px;
    pointer-events: none;
  }

  /* Drop-position highlights when reordering chips */
  .og-group-chip-drop-before {
    transform: translateX(3px);
    box-shadow: -4px 0 0 #60a5fa, 0 0 18px rgba(96, 165, 250, 0.3);
  }

  .og-group-chip-drop-after {
    transform: translateX(-3px);
    box-shadow: 4px 0 0 #60a5fa, 0 0 18px rgba(96, 165, 250, 0.3);
  }

  .og-group-chip-drag-source {
    opacity: 0.45;
  }

  .og-group-chip-separator {
    color: #475569;
    font-size: 16px;
    line-height: 1;
    flex: 0 0 auto;
  }

  /*
   * Header wrapper — sticky at the top of the scroll viewport.
   * Uses a flex row so the three child lanes (left-pin | center | right-pin) sit
   * side-by-side. overflow:clip (not hidden) preserves sticky propagation to
   * og-scroll-viewport for the left/right pin lanes.
   */
  .og-layer-header-wrapper {
    position: sticky;
    top: 0;
    height: var(--og-total-header-height, 40px);
    z-index: 30;
    overflow: clip;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
  }

  /* Center lane — grows to fill the space between the two pin lanes. */
  .og-layer-header {
    order: 1;
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
    overflow: hidden;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    background-color: var(--og-header-bg);
  }

  /* Left / right pin lanes — compositor-sticky so they never lag behind body rows. */
  .og-layer-header-left {
    order: 0;
    position: sticky;
    left: 0;
    flex-shrink: 0;
    height: 100%;
    z-index: 5;
    overflow: hidden;
    contain: layout paint;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    border-right: 1px solid var(--og-pin-left-border-color);
    background-color: var(--og-header-bg);
  }

  .og-scrolled-left .og-layer-header-left {
    box-shadow: var(--og-pin-left-shadow);
  }

  .og-layer-header-right {
    order: 2;
    position: sticky;
    right: 0;
    flex-shrink: 0;
    height: 100%;
    z-index: 5;
    overflow: hidden;
    contain: layout paint;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    border-left: 1px solid var(--og-pin-right-border-color);
    background-color: var(--og-header-bg);
  }

  .og-scrolled-right .og-layer-header-right {
    box-shadow: var(--og-pin-right-shadow);
  }

  /*
   * Rows container — one compositor layer for all rows.
   * Rows are absolutely positioned inside; will-change here (not per-row) means
   * all rows share a single GPU texture instead of N individual layers.
   */
  .og-rows-container {
    position: relative;
    will-change: transform;
    pointer-events: auto;
    width: var(--og-content-width, 100%);
  }

  /*
   * One section per expanded group, spanning the group's rows in content coordinates. Its first
   * child is the group header copy, position: sticky: the browser sticks it below the top chrome,
   * pushes it up where the section ends and releases it, with no JS positioning. Sections never
   * take pointer events; only the header does.
   */
  .og-sticky-section {
    position: absolute;
    left: 0;
    pointer-events: none;
  }

  /*
   * A recycled row/cell container whose adapter-rendered content is still the previous row's while
   * its own mount waits out the scroll: the old content is hidden and the new row's label shown.
   */
  .og-hierarchy-cell-host {
    display: contents;
  }

  .og-row-content-pending > * {
    visibility: hidden;
  }
  .og-row-content-pending::before {
    content: attr(data-stand-in);
    position: absolute;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .og-row.og-sticky-group-row-host {
    position: sticky;
    left: auto;
    right: auto;
    pointer-events: auto;
  }

  /*
   * The copy is only shown while stuck: otherwise the body's own group row is right beneath it
   * (and animates with the body on expand/collapse; the copy would not). The stuck class flips a
   * frame after the compositor, at the instant copy and body row coincide, so the swap is invisible.
   */
  .og-row.og-sticky-group-row-host:not(.og-row-group-stuck) {
    visibility: hidden;
    pointer-events: none;
  }

  /*
   * Viewport-pinned rows: zero-height sticky bands, so the compositor keeps pinned rows stuck with
   * no per-frame JS. Painted above body rows (25, matching the pinned-row z-index) and below the
   * header (30).
   */
  .og-layer-pinned-top,
  .og-layer-pinned-bottom {
    position: sticky;
    height: 0;
    z-index: 25;
  }

  .og-layer-pinned-top {
    top: 0;
  }

  .og-layer-pinned-bottom {
    bottom: 0;
  }

  .og-row.og-sticky-group-row-host {
    pointer-events: auto;
  }

  /*
   * Overlay — absolute, outside the scroll container so selection/focus rings
   * render over content without being clipped by overflow:auto.
   */
  .og-layer-overlay {
    position: absolute;
    top: var(--og-overlay-top);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    pointer-events: none;
    overflow: hidden;
  }

  /*
   * Row — absolutely positioned at top:0 inside og-rows-container and offset via
   * transform: translateY() (paint/composite-only; writing style.top invalidates
   * layout, and pinned/sticky rows reposition every scroll frame).
   * A 2D transform on .og-row does NOT break descendant position:sticky — sticky
   * resolves against the nearest scrollport, not the transformed ancestor (the FLIP
   * sort animation has always relied on this).
   * display:flex so the sticky pin containers (og-row-pin-left / og-row-pin-right)
   * can use margin-left:auto and position:sticky for zero-lag compositor pinning.
   * contain:style only (NOT layout) so that position:sticky propagates correctly
   * to the scroll viewport as the containing scroll ancestor.
   * No will-change — the compositor layer is on og-rows-container, not each row.
   */
  .og-row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: stretch;
    contain: style;
    border-bottom: 1px solid var(--og-border-color);
    background-color: var(--og-bg-color);
    box-sizing: border-box;
    transition: background-color 0.15s ease;
  }

  /*
   * Hover only matches while NOT scrolling (og-is-scrolling on the container during
   * scroll): the cursor sweeps dozens of rows per second during scroll, and each
   * :hover match + 150ms background transition is style-recalc and paint work stolen
   * from the frame budget. Transitions are likewise suspended during scroll.
   */
  .og-grid-container:not(.og-is-scrolling) .og-row:hover,
  .og-row-hovered {
    background-color: var(--og-row-hover-bg);
  }

  .og-is-scrolling .og-row {
    transition: none;
  }

  /* Full-width row content: viewport-wide and horizontally fixed (see --og-viewport-width). */
  .og-row-portal-host {
    position: sticky;
    left: 0;
    flex: 0 0 auto;
    width: var(--og-viewport-width, 100%);
    max-width: 100%;
    height: 100%;
  }

  .og-row-portal-host > * {
    width: 100%;
    height: 100%;
  }

  /* detail.height: 'auto' — the host takes its content's height, which the grid measures. */
  .og-row-portal-host-auto {
    height: auto;
    align-self: flex-start;
  }

  .og-row-portal-host-auto > * {
    height: auto;
  }

  .og-row-selected {
    background-color: var(--og-selection-bg) !important;
  }

  .og-row-node-selected {
    background-color: var(--og-row-selected-bg, rgba(59, 130, 246, 0.08));
  }
  .og-row-node-selected .og-cell {
    background-color: inherit;
  }

  .og-row-focused {
    background-color: var(--og-selection-bg) !important;
  }

  .og-row-pinned-top {
    background-color: var(--og-header-bg);
    z-index: 25;
    border-bottom: 2px solid var(--og-border-color) !important;
  }

  /*
   * The sticky copy looks exactly like the group row it stands for, so attaching, detaching and
   * being pushed change nothing visible: the same tint over an opaque grid background (the copy
   * covers rows scrolling underneath). Only a soft shadow marks it as stuck (unless the grid turns
   * it off); it fades in once when the header sticks and never changes while pushed.
   */
  .og-row-group-sticky {
    background: linear-gradient(var(--og-group-row-bg), var(--og-group-row-bg)), var(--og-bg-color);
    color: var(--og-group-row-text);
    font-weight: var(--og-group-row-font-weight);
  }

  .og-row-group-stuck.og-row-group-sticky-shadow::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    height: 6px;
    pointer-events: none;
    background: linear-gradient(rgba(0, 0, 0, 0.16), transparent);
  }

  @media (prefers-reduced-motion: no-preference) {
    .og-row-group-stuck.og-row-group-sticky-shadow::after {
      animation: og-sticky-shadow-in 140ms ease-out;
    }
  }

  @keyframes og-sticky-shadow-in {
    from { opacity: 0; }
  }

  .og-row-pinned-bottom {
    background-color: var(--og-header-bg);
    z-index: 25;
    border-top: 2px solid var(--og-border-color) !important;
  }

  /*
   * Cells are absolutely positioned (left/width set by JS).
   * Pinned cells live inside sticky lane containers and stay absolute within
   * those lanes, avoiding per-scroll cell coordinate writes.
   */
  .og-cell {
    position: absolute;
    top: 0;
    height: 100%;
    contain: layout paint style;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid var(--og-cell-border);
  }

  .og-cell-row-selector,
  .og-header-cell-row-selector {
    justify-content: center;
    padding: 0;
  }

  .og-cell-row-selector .og-cell-content {
    justify-content: center;
  }

  .og-row-checkbox,
  .og-hierarchy-checkbox,
  .og-header-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1.5px solid rgba(100, 116, 139, 0.9);
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.72);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
    cursor: pointer;
    pointer-events: auto;
    transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease;
  }

  .og-row-checkbox:hover,
  .og-hierarchy-checkbox:hover,
  .og-header-checkbox:hover {
    border-color: #93c5fd;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
  }

  .og-row-checkbox:focus-visible,
  .og-header-checkbox:focus-visible {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: 2px;
  }

  .og-row-checkbox:checked,
  .og-hierarchy-checkbox:checked,
  .og-hierarchy-checkbox:indeterminate,
  .og-header-checkbox:checked,
  .og-header-checkbox:indeterminate {
    border-color: #60a5fa;
    background: linear-gradient(180deg, #60a5fa, #2563eb);
  }

  .og-row-checkbox:checked::after,
  .og-hierarchy-checkbox:checked::after,
  .og-header-checkbox:checked::after {
    content: '';
    width: 8px;
    height: 5px;
    border-left: 2px solid #ffffff;
    border-bottom: 2px solid #ffffff;
    transform: rotate(-45deg) translateY(-1px);
  }

  .og-hierarchy-checkbox:indeterminate::after,
  .og-header-checkbox:indeterminate::after {
    content: '';
    width: 8px;
    height: 2px;
    border-radius: 2px;
    background: #ffffff;
  }

  /* ── Hierarchy column: indent | toggle | checkbox | label | count ── */
  .og-hierarchy {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    width: 100%;
    height: 100%;
  }

  .og-hierarchy-toggle {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    color: currentColor;
    opacity: 0.8;
    cursor: pointer;
    transition: background-color 0.12s ease, opacity 0.12s ease;
  }

  /* A drawn chevron: crisp at any zoom, inherits the row's text colour. */
  .og-hierarchy-toggle::before {
    content: '';
    width: 7px;
    height: 7px;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: translateX(-1px) rotate(-45deg);
    transition: transform 0.15s ease;
  }

  .og-hierarchy-toggle-open::before {
    transform: translateY(-2px) rotate(45deg);
  }

  .og-hierarchy-toggle:hover {
    opacity: 1;
    background: var(--og-group-badge-bg, rgba(167, 139, 250, 0.14));
  }

  .og-hierarchy-toggle-none::before {
    content: none;
  }

  /* No children: keeps the slot so labels at one level align. */
  .og-hierarchy-toggle-none {
    cursor: default;
    visibility: hidden;
  }

  .og-hierarchy-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .og-hierarchy-count {
    flex: 0 0 auto;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    background: var(--og-group-badge-bg);
    border: 1px solid var(--og-group-badge-border);
    color: var(--og-group-badge-text);
  }

  .og-cell-hierarchy-group .og-hierarchy-label,
  .og-cell-hierarchy-total .og-hierarchy-label {
    font-weight: 600;
  }

  /* Core's built-in full-width rows (display: 'row' groups and totals, detail / failed / placeholder). */
  .og-full-width-row {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 100%;
    min-width: 0;
    padding: 0 12px;
    overflow: hidden;
    white-space: nowrap;
  }

  .og-full-width-group {
    background: var(--og-group-row-bg);
    color: var(--og-group-row-text);
    font-weight: var(--og-group-row-font-weight);
  }

  .og-full-width-total {
    font-weight: 600;
  }

  .og-full-width-hierarchy {
    flex: 0 1 auto;
    min-width: 0;
  }

  .og-full-width-aggregates {
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .og-full-width-aggregate {
    display: inline-flex;
    gap: 5px;
    font-size: 11px;
    color: var(--og-group-badge-text);
  }

  .og-full-width-aggregate > span {
    opacity: 0.7;
  }

  .og-full-width-detail,
  .og-full-width-placeholder {
    color: var(--og-header-text);
    opacity: 0.75;
  }

  .og-full-width-failed {
    color: #fca5a5;
    font-weight: 600;
  }

  /*
   * Group and total rows drawn as cell rows. The tint over an opaque base (as the sticky copy and the
   * selection do): the pinned lanes inherit it, and a translucent lane let centre cells scrolled under
   * it show through.
   */
  .og-row.og-row-group:not(.og-row-group-sticky) {
    background: linear-gradient(var(--og-group-row-bg), var(--og-group-row-bg)), var(--og-bg-color);
    color: var(--og-group-row-text);
    font-weight: var(--og-group-row-font-weight);
  }

  .og-row.og-row-total {
    font-weight: 600;
    box-shadow: inset 0 1px 0 var(--og-group-badge-border, rgba(148, 163, 184, 0.3));
  }

  .og-row-node-selected .og-row-checkbox {
    border-color: #93c5fd;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }

  /* Pinned cells and lanes take the row's whole background (a tint over a base, not just the colour). */
  .og-cell-pinned-left {
    z-index: 40;
    background: inherit;
  }

  .og-cell-pinned-right {
    z-index: 40;
    background: inherit;
  }

  /*
   * Pin containers use position:sticky so the browser compositor handles
   * their fixed-edge behaviour natively — no RAF-based JS transforms needed.
   * This eliminates the one-frame lag that caused flicker on horizontal scroll.
   *
   * Left pin: sticks to left:0 of the scroll viewport.
   * Right pin: margin-left:auto pushes it to the natural right side of the
   *   full-width flex row; sticky right:0 then anchors it to the viewport's
   *   right edge when horizontal scrolling would otherwise move it off-screen.
   */
  .og-row-pin-left,
  .og-row-pin-right {
    position: sticky;
    top: 0;
    height: 100%;
    flex-shrink: 0;
    z-index: 40;
    background: inherit;
    overflow: hidden;
    contain: layout paint;
  }

  /*
   * Each row's lane casts the pinned-edge shadow; clipped to the outer side so a blur cannot spill
   * over the rows above and below (overlapping row shadows read as a band on every row instead of
   * one continuous edge).
   */
  .og-row-pin-left {
    left: 0;
    border-right: 1px solid var(--og-pin-left-border-color);
    clip-path: inset(0 -32px 0 0);
  }

  /* The edge shadow only while content is scrolled under the lane; at rest the border alone. */
  .og-scrolled-left .og-row-pin-left {
    box-shadow: var(--og-pin-left-shadow);
  }

  .og-scrolled-right .og-row-pin-right {
    box-shadow: var(--og-pin-right-shadow);
  }

  .og-row-pin-right {
    right: 0;
    margin-left: auto;
    border-left: 1px solid var(--og-pin-right-border-color);
    clip-path: inset(0 0 0 -32px);
  }

  .og-row-selected .og-row-pin-left,
  .og-row-selected .og-row-pin-right,
  .og-row-selected .og-cell-pinned-left,
  .og-row-selected .og-cell-pinned-right,
  .og-row-focused .og-row-pin-left,
  .og-row-focused .og-row-pin-right,
  .og-row-focused .og-cell-pinned-left,
  .og-row-focused .og-cell-pinned-right,
  .og-cell-pinned-left.og-cell-selected,
  .og-cell-pinned-right.og-cell-selected,
  .og-cell-pinned-left.og-cell-focused,
  .og-cell-pinned-right.og-cell-focused {
    background: linear-gradient(var(--og-selection-bg), var(--og-selection-bg)), var(--og-bg-color);
  }

  .og-row-node-selected .og-row-pin-left,
  .og-row-node-selected .og-row-pin-right,
  .og-row-node-selected .og-cell-pinned-left,
  .og-row-node-selected .og-cell-pinned-right {
    background: linear-gradient(var(--og-row-selected-bg, rgba(59, 130, 246, 0.08)), var(--og-row-selected-bg, rgba(59, 130, 246, 0.08))), var(--og-bg-color);
  }

  .og-grid-container:not(.og-is-scrolling) .og-row:hover .og-row-pin-left,
  .og-grid-container:not(.og-is-scrolling) .og-row:hover .og-row-pin-right,
  .og-grid-container:not(.og-is-scrolling) .og-row:hover .og-cell-pinned-left,
  .og-grid-container:not(.og-is-scrolling) .og-row:hover .og-cell-pinned-right,
  .og-row-hovered .og-row-pin-left,
  .og-row-hovered .og-row-pin-right,
  .og-row-hovered .og-cell-pinned-left,
  .og-row-hovered .og-cell-pinned-right {
    background: linear-gradient(var(--og-row-hover-bg), var(--og-row-hover-bg)), var(--og-bg-color);
  }

  /*
   * Cell text: a plain block, vertically centred by the .og-cell flex parent. Not a flex
   * container itself — text in a flex container is wrapped in an anonymous flex item (one more
   * layout object per cell, re-laid out whenever the text changes) and text-overflow: ellipsis
   * does not apply to it, so long values were cut off without the ellipsis.
   */
  .og-cell-content {
    width: 100%;
    min-width: 0;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
   * Direct-text cells (columns with no custom renderer): the text is the cell's own child, with no
   * .og-cell-content wrapper — one element and one text box per cell. Block layout keeps
   * text-overflow: ellipsis working; align-content centres the line vertically.
   */
  .og-cell[data-text-cell] {
    display: block;
    align-content: center;
  }

  /* An editor (portal host) or a skeleton is a box, not text: centre it like wrapped cells do. */
  .og-cell[data-text-cell][data-content-mode="portal"],
  .og-cell[data-text-cell][data-content-mode="pending"],
  .og-cell[data-text-cell][data-content-mode="loading"] {
    display: flex;
    align-items: center;
  }

  .og-cell-readonly[data-text-cell] {
    color: color-mix(in srgb, currentColor calc(var(--og-readonly-cell-opacity, 0.65) * 100%), transparent);
  }

  /* Content that is not text centres a child box: the row-selector checkbox, loading skeletons. */
  .og-cell-row-selector .og-cell-content,
  .og-cell[data-content-mode="pending"] > .og-cell-content,
  .og-cell[data-content-mode="loading"] > .og-cell-content {
    height: 100%;
    display: flex;
    align-items: center;
  }

  /*
   * The portal host is a DOM anchor for renderer containers, not a box: display: contents lets its
   * children (which size themselves 100% x 100% and clip) lay out directly in the flex cell. A host
   * box of its own was one more flex container per rich cell for every layout to walk through.
   */
  .og-cell-portal-host {
    display: contents;
  }

  .og-custom-renderer-container,
  .og-dom-renderer-container {
    width: 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
  }

  .og-cell[data-content-mode="portal"] > .og-cell-content,
  .og-cell[data-content-mode="text"] > .og-cell-portal-host,
  .og-cell[data-content-mode="empty"] > .og-cell-portal-host,
  .og-cell[data-content-mode="fallback"] > .og-cell-portal-host,
  .og-cell[data-content-mode="pending"] > .og-cell-portal-host,
  .og-cell[data-content-mode="loading"] > .og-cell-portal-host {
    display: none;
  }

  .og-cell[data-content-mode="pending"] > .og-cell-content::before,
  .og-cell[data-text-cell][data-content-mode="pending"]::before {
    content: '';
    width: min(72%, 120px);
    height: 16px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(148, 163, 184, 0.12), rgba(148, 163, 184, 0.22), rgba(148, 163, 184, 0.12));
  }

  .og-cell[data-content-mode="loading"] > .og-cell-content::before,
  .og-cell[data-text-cell][data-content-mode="loading"]::before {
    content: '';
    width: var(--og-skeleton-width);
    height: var(--og-skeleton-height);
    border-radius: var(--og-skeleton-border-radius);
    background: linear-gradient(90deg, 
      var(--og-skeleton-start) 25%, 
      var(--og-skeleton-mid) 50%, 
      var(--og-skeleton-end) 75%
    );
    background-size: 200% 100%;
    animation: og-shimmer var(--og-skeleton-animation-duration) infinite linear;
  }


  .og-cell-focused {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: -2px;
    background-color: var(--og-selection-bg);
    z-index: 20;
  }

  .og-cell-selected {
    background-color: var(--og-selection-bg);
  }

  /* When the editor is mounted the editor border IS the focus ring — suppress the cell outline */
  .og-cell:has(.og-cell-editor) {
    outline: none;
    padding: 0px;
  }

  .og-cell-editor {
    position: absolute;
    inset: 0;
    z-index: 50;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 0 10px;
    border: 2px solid var(--og-focus-ring);
    outline: none;
    background: var(--og-bg-color);
    color: var(--og-text-color);
    font: inherit;
  }

  .og-cell-pinned-left.og-cell-focused,
  .og-cell-pinned-right.og-cell-focused {
    z-index: 45;
  }

  /* ── Read-only cell ──────────────────────────────────────────────────────── */
  .og-cell-readonly {
    cursor: default;
    background-color: var(--og-readonly-cell-bg);
  }

  .og-cell-readonly .og-cell-content {
    opacity: var(--og-readonly-cell-opacity, 0.65);
  }

  /* ── Cell validation / integrity error ───────────────────────────────────── */
  /* og-cell-integrity-error is emitted via the decoration layer (getCellDecorations).  */
  /* og-cell-validation-error is a more specific alias applied for in-editor validators. */
  .og-cell-integrity-error,
  .og-cell-validation-error {
    outline: 2px solid var(--og-error);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-error) 6%, transparent);
    z-index: 15;
  }

  /* Error wins over selection bg */
  .og-cell-integrity-error.og-cell-selected,
  .og-cell-validation-error.og-cell-selected {
    background-color: color-mix(in srgb, var(--og-error) 8%, var(--og-selection-bg));
  }

  /* Error wins over focus outline colour and bg */
  .og-cell-integrity-error.og-cell-focused,
  .og-cell-validation-error.og-cell-focused {
    outline-color: var(--og-error);
    background-color: color-mix(in srgb, var(--og-error) 8%, var(--og-selection-bg));
    z-index: 20;
  }

  /* Error border on the inline editor input */
  .og-cell-integrity-error .og-cell-editor,
  .og-cell-validation-error .og-cell-editor {
    border-color: var(--og-error);
  }

  /* Badge dot via CSS pseudo-element — no DOM manipulation required */
  .og-cell-integrity-error::after,
  .og-cell-validation-error::after {
    content: '';
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--og-error);
    pointer-events: none;
  }

  /* Hide badge while the editor is open — the red editor border signals the error */
  .og-cell-integrity-error:has(.og-cell-editor)::after,
  .og-cell-validation-error:has(.og-cell-editor)::after {
    display: none;
  }

  /* ── Cell diff decorations ───────────────────────────────────────────────── */

  .og-cell-diff-changed {
    outline: 2px solid var(--og-diff-changed, #f6ad55);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-diff-changed, #f6ad55) 8%, transparent);
  }

  .og-cell-diff-added {
    outline: 2px solid var(--og-diff-added, #68d391);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-diff-added, #68d391) 8%, transparent);
  }

  .og-cell-diff-removed {
    outline: 2px solid var(--og-diff-removed, #fc8181);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-diff-removed, #fc8181) 8%, transparent);
    text-decoration: line-through;
    opacity: 0.7;
  }

  /* ── Row diff decorations ─────────────────────────────────────────────────── */

  .og-row-diff-added {
    background-color: color-mix(in srgb, var(--og-diff-added, #68d391) 6%, transparent) !important;
  }

  .og-row-diff-changed {
    background-color: color-mix(in srgb, var(--og-diff-changed, #f6ad55) 5%, transparent) !important;
  }

  .og-row-diff-removed {
    background-color: color-mix(in srgb, var(--og-diff-removed, #fc8181) 6%, transparent) !important;
    opacity: 0.7;
  }

  /* ── Cell conflict decoration ─────────────────────────────────────────────── */

  .og-cell-conflict {
    outline: 2px solid var(--og-conflict, #b794f4);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-conflict, #b794f4) 8%, transparent);
  }

  .og-cell-conflict::after {
    content: '';
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--og-conflict, #b794f4);
    pointer-events: none;
  }

  /* ── Cell insight decorations (generic) ───────────────────────────────────── */

  .og-cell-insight-error {
    outline: 2px solid var(--og-error);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-error) 6%, transparent);
  }

  .og-cell-insight-warning {
    outline: 2px solid var(--og-warning, #ed8936);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-warning, #ed8936) 6%, transparent);
  }

  .og-cell-insight-info {
    outline: 2px solid var(--og-info, #63b3ed);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-info, #63b3ed) 6%, transparent);
  }

  /* ── Cell quality decorations ─────────────────────────────────────────────── */

  .og-cell-quality-error {
    outline: 2px solid var(--og-error);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-error) 6%, transparent);
  }

  .og-cell-quality-warning {
    outline: 2px solid var(--og-warning, #ed8936);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--og-warning, #ed8936) 6%, transparent);
  }

  /* Validation error tooltip — shown on hover/focus of invalid cells */
  .og-validation-tooltip {
    position: fixed;
    z-index: 9999;
    padding: 5px 10px;
    background: color-mix(in srgb, var(--og-error) 12%, var(--og-bg-color));
    color: var(--og-error);
    border: 1px solid color-mix(in srgb, var(--og-error) 40%, transparent);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    pointer-events: none;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }

  .og-cell-pinned-left .og-cell-editor,
  .og-cell-pinned-right .og-cell-editor {
    z-index: 50;
  }

  .og-header-cell {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--og-header-text);
    border-right: 1px solid var(--og-border-color);
    box-sizing: border-box;
    user-select: none;
  }

  .og-header-group-cell {
    background-color: var(--og-group-header-bg, color-mix(in srgb, var(--og-header-bg) 82%, var(--og-focus-ring) 18%));
    color: var(--og-group-header-text, var(--og-header-text));
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid var(--og-border-color);
    border-right: 1px solid var(--og-border-color);
    justify-content: center;
    cursor: default;
    pointer-events: none;
  }

  .og-header-group-cell.og-header-cell-pinned-left:last-child,
  .og-header-group-cell.og-header-cell-pinned-right:first-child {
    border-right: none;
  }

  .og-header-cell-col-focus {
    background-color: color-mix(in srgb, var(--og-focus-ring) 10%, var(--og-header-bg));
    color: var(--og-focus-ring);
    box-shadow: inset 0 -2px 0 var(--og-focus-ring);
  }

  .og-header-cell-movable {
    cursor: grab;
    transition: box-shadow 0.15s ease, opacity 0.15s ease;
  }

  /* Transform transition only active during live column reorder — prevents animation
     during topology changes (pin/unpin, scroll) where the cell jumps to a new position
     and should appear immediately rather than sliding from the old one. */
  .og-col-reordering .og-header-cell-movable {
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s ease, opacity 0.15s ease;
  }

  .og-header-cell-dragging {
    cursor: grabbing;
    opacity: 0.95;
    background-color: color-mix(in srgb, var(--og-focus-ring) 20%, var(--og-header-bg));
    /* transform is composited inline by headerRenderer — scale(1.035) translateY(-2px) */
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55),
                0 0 0 1.5px var(--og-focus-ring),
                0 0 20px rgba(59, 130, 246, 0.2);
    z-index: 10;
  }

  /* Dim non-dragging header cells so the lifted column pops out — kept light enough
     that the live-reorder shift (columns sliding aside) stays clearly visible. */
  .og-col-reordering .og-header-cell:not(.og-header-cell-dragging) {
    opacity: 0.55;
    transition: opacity 0.15s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* Live column-reorder preview: body cells slide to their previewed
     post-drop position via a translateX composed on top of their left offset. The
     glide transition is scoped to an active drag, so steady-state scroll/resize
     frames — which never carry this class — never transition transform. On drop the
     class is removed and the cell left already equals the previewed position, so
     there is no jump and no separate FLIP pass is needed. */
  .og-col-reordering .og-cell {
    transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .og-column-drop-indicator {
    position: absolute;
    top: 0;
    width: 2px;
    /* Fade in/out at the ends so it doesn't look clipped */
    background: linear-gradient(
      to bottom,
      transparent 0%,
      var(--og-focus-ring) 6%,
      var(--og-focus-ring) 94%,
      transparent 100%
    );
    box-shadow: 0 0 8px var(--og-focus-ring), 0 0 2px rgba(255, 255, 255, 0.25);
    pointer-events: none;
    z-index: 60;
    opacity: 0;
  }
  /* Enabled after the first placement (set by the controller) so the indicator glides
     between insertion points and fades in, instead of flying in from the left edge. */
  .og-column-drop-indicator.og-indicator-ready {
    opacity: 1;
    transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.14s ease;
  }

  /* White-fill circle caps with blue ring — crisp insertion-point markers */
  .og-column-drop-indicator::before,
  .og-column-drop-indicator::after {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid var(--og-focus-ring);
    box-shadow: 0 0 8px var(--og-focus-ring);
  }

  .og-column-drop-indicator::before { top: -5px; }
  .og-column-drop-indicator::after  { bottom: -5px; }

  .og-column-drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    max-width: min(240px, calc(100vw - 24px));
    padding: 7px 12px 7px 9px;
    border: 1px solid color-mix(in srgb, var(--og-focus-ring) 60%, transparent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--og-header-bg) 80%, var(--og-focus-ring));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55),
                0 4px 12px rgba(0, 0, 0, 0.3),
                0 0 0 1px rgba(255, 255, 255, 0.08) inset;
    color: var(--og-header-text);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1;
    overflow: hidden;
    pointer-events: none;
    text-overflow: ellipsis;
    text-transform: uppercase;
    user-select: none;
    white-space: nowrap;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 7px;
    /* Fluid pickup — fade in as the ghost appears (position itself is JS-driven via
       transform, so the entrance only touches opacity to avoid fighting it). */
    animation: og-drag-ghost-in 0.14s ease;
  }
  @keyframes og-drag-ghost-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Out of the grid: letting go hides the column. */
  .og-drag-ghost-hide {
    display: none;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    padding: 3px 6px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--og-text-color) 12%, transparent);
    color: var(--og-text-color);
    font-size: 10.5px;
    letter-spacing: 0.06em;
  }
  .og-column-drag-ghost[data-hide] {
    border-color: color-mix(in srgb, var(--og-text-color) 30%, transparent);
    background: color-mix(in srgb, var(--og-header-bg) 92%, var(--og-text-color));
  }
  .og-column-drag-ghost[data-hide] > span:not(.og-drag-ghost-hide) {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .og-column-drag-ghost[data-hide] .og-drag-ghost-hide { display: inline-flex; }

  /* SVG drag-handle icon injected by JS */
  .og-drag-ghost-icon {
    width: 10px;
    height: 16px;
    opacity: 0.45;
    flex-shrink: 0;
    color: var(--og-header-text);
  }

  .og-selection-border {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 19;
    border: 2px dashed var(--og-selection-border);
    background-color: var(--og-selection-bg);
    box-sizing: border-box;
    pointer-events: none;
  }

  /*
   * The selection box is part of the scrolled content (rows container / pinned bands), positioned
   * in content coordinates, so it scrolls on the compositor with the cells. Pieces over pinned
   * columns sit in zero-height sticky lanes (left:0 / right:0) like the pinned cells they cover.
   * 19 keeps it above body cells and below sticky group headers (21-24), the pinned bands (25) and
   * the column header (30).
   */
  .og-selection-lane {
    position: sticky;
    height: 0;
    z-index: 19;
    pointer-events: none;
  }

  .og-selection-lane-left {
    left: 0;
  }

  .og-selection-lane-right {
    right: 0;
    margin-left: auto;
  }

  .og-layer-pinned-top > .og-selection-border,
  .og-layer-pinned-top > .og-selection-lane,
  .og-layer-pinned-bottom > .og-selection-border,
  .og-layer-pinned-bottom > .og-selection-lane {
    z-index: 26;
  }

  /* Selection Fill Handle Style */
  .og-selection-fill-handle {
    position: absolute;
    bottom: -4.5px;
    right: -4.5px;
    width: 9px;
    height: 9px;
    background-color: var(--og-focus-ring, #3b82f6);
    border: 1px solid #ffffff;
    border-radius: 1.5px;
    cursor: crosshair;
    pointer-events: auto;
    z-index: 50;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.1s ease, background-color 0.1s ease;
  }

  .og-selection-fill-handle:hover {
    transform: scale(1.35);
    background-color: #2563eb;
  }

  /* Fill Preview Border Style */
  .og-fill-preview-border {
    position: absolute;
    border: 2px dashed rgba(168, 85, 247, 0.75); /* Glowing Purple drag fill preview */
    background-color: rgba(168, 85, 247, 0.06);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 45;
  }

  .og-header-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
    transition: background-color 0.15s ease;
  }

  .og-header-resize-handle:hover {
    background-color: var(--og-focus-ring);
  }

  /*
   * Menus (context menu and column menu) share one surface: a solid panel with a hairline border and
   * soft shadow, 30px rows, muted icons, subtle hover/active fills. They spring open from their anchor
   * and leave with a quicker ease-in (og-closing); reduced motion gets a plain fade.
   */
  .og-context-menu,
  .og-header-popover {
    position: fixed;
    background: var(--og-popover-bg, rgba(15, 18, 26, 0.98));
    backdrop-filter: blur(12px) saturate(140%);
    -webkit-backdrop-filter: blur(12px) saturate(140%);
    border: 1px solid var(--og-popover-border, rgba(255, 255, 255, 0.09));
    border-radius: 10px;
    box-shadow:
      0 16px 40px -12px rgba(0, 0, 0, 0.55),
      0 4px 12px -4px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    padding: 5px;
    font-family: var(--og-font-family), inherit;
    font-size: 13px;
    color: var(--og-popover-text, #e7e9ee);
    opacity: 0;
    transform: translateY(-6px) scale(0.96);
    transform-origin: top left;
    transition:
      opacity 0.16s ease-out,
      transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
    will-change: transform, opacity;
  }
  .og-context-menu {
    z-index: 1000;
    min-width: 220px;
  }
  .og-context-menu.og-placement-top,
  .og-header-popover.og-placement-top {
    transform: translateY(6px) scale(0.96);
    transform-origin: bottom left;
  }
  .og-context-menu.og-placement-left {
    transform-origin: top right;
  }
  .og-context-menu.og-placement-top.og-placement-left {
    transform-origin: bottom right;
  }
  .og-context-menu.og-visible,
  .og-header-popover.og-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  .og-context-menu.og-closing,
  .og-header-popover.og-closing {
    transform: translateY(-2px) scale(0.98);
    transition:
      opacity 0.11s ease-in,
      transform 0.11s cubic-bezier(0.4, 0, 1, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .og-context-menu,
    .og-header-popover,
    .og-context-menu.og-closing,
    .og-header-popover.og-closing {
      transform: none !important;
      transition: opacity 0.1s linear;
    }
  }
  .og-context-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 450;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.1s ease, color 0.1s ease;
    user-select: none;
    color: var(--og-popover-text, #e7e9ee);
  }
  .og-context-menu-item:hover,
  .og-context-menu-item.og-menu-active {
    background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, 0.07));
  }
  /* Keyboard navigation highlights via .og-menu-active; no separate browser outline. */
  .og-context-menu-item:focus,
  .og-context-menu-item:focus-visible {
    outline: none;
  }
  .og-context-menu-item.og-danger {
    color: var(--og-danger-text, #f87171);
  }
  .og-context-menu-item.og-danger:hover,
  .og-context-menu-item.og-danger.og-menu-active {
    background-color: var(--og-danger-hover-bg, rgba(248, 113, 113, 0.1));
  }
  .og-context-menu-item.og-disabled {
    opacity: 0.38;
    cursor: default;
  }
  .og-context-menu-item.og-disabled:hover {
    background-color: transparent;
  }
  .og-context-menu-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: inherit;
    opacity: 0.6;
    transition: opacity 0.1s ease;
  }
  .og-context-menu-item:hover .og-context-menu-item-icon,
  .og-context-menu-item.og-menu-active .og-context-menu-item-icon {
    opacity: 0.95;
  }
  .og-context-menu-item-icon svg {
    width: 15px;
    height: 15px;
  }
  .og-context-menu-item-label {
    flex-grow: 1;
    white-space: nowrap;
  }
  .og-context-menu-item-shortcut {
    margin-left: auto;
    padding-left: 20px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.3px;
    opacity: 0.45;
    background: none;
    border: 0;
  }
  .og-context-menu-divider {
    height: 1px;
    background-color: var(--og-popover-divider, rgba(255, 255, 255, 0.07));
    margin: 5px -5px;
  }

  /* Column Header Popover Styles & Developer Themeable CSS Variables */
  .og-header-sort-indicator {
    display: none;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--og-focus-ring, #3b82f6);
    margin-left: 4px;
    margin-right: 4px;
    flex-shrink: 0;
  }
  
  .og-header-menu-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--og-header-text, #94a3b8);
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
    margin-right: 4px;
    z-index: 5;
  }
  .og-header-cell:hover .og-header-menu-button {
    opacity: 1;
  }
  .og-header-menu-button:hover {
    color: var(--og-focus-ring, #ffffff);
    background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, 0.08));
  }
  
  .og-header-popover {
    z-index: 1100;
    width: 236px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .og-popover-sort-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .og-popover-item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 450;
    line-height: 1;
    cursor: pointer;
    color: inherit;
    transition: background-color 0.1s ease, color 0.1s ease;
    user-select: none;
  }
  .og-popover-item svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    color: inherit;
    opacity: 0.6;
    transition: opacity 0.1s ease;
  }
  .og-popover-item:hover,
  .og-popover-item:focus-visible {
    background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, 0.07));
    outline: none;
  }
  .og-popover-item:hover svg,
  .og-popover-item:focus-visible svg {
    opacity: 0.95;
  }
  /* The current sort: a soft accent tint and a dot, not a solid block competing with hover. */
  .og-popover-item.og-active {
    background-color: color-mix(in srgb, var(--og-popover-item-active-bg, var(--og-focus-ring, #3b82f6)) 16%, transparent);
    color: color-mix(in srgb, var(--og-popover-item-active-bg, var(--og-focus-ring, #3b82f6)) 65%, var(--og-popover-text, #ffffff));
  }
  .og-popover-item.og-active svg {
    opacity: 1;
  }
  .og-popover-item.og-active::after {
    content: '';
    margin-left: auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .og-popover-item.og-danger {
    color: var(--og-danger-text, #f87171);
  }
  .og-popover-item.og-danger:hover,
  .og-popover-item.og-danger:focus-visible {
    background-color: var(--og-danger-hover-bg, rgba(248, 113, 113, 0.1));
  }
  .og-popover-divider {
    height: 1px;
    background-color: var(--og-popover-divider, rgba(255, 255, 255, 0.07));
    margin: 4px -5px;
  }
  .og-popover-filter-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 3px 3px;
  }
  .og-popover-section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    opacity: 0.5;
    padding: 0 5px;
  }
  .og-popover-select,
  .og-popover-input {
    height: 30px;
    background: var(--og-popover-input-bg, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--og-popover-input-border, rgba(255, 255, 255, 0.09));
    color: inherit;
    border-radius: 6px;
    padding: 0 9px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .og-popover-select {
    cursor: pointer;
  }
  .og-popover-select option {
    background: var(--og-popover-option-bg, #0f172a);
    color: var(--og-popover-text, #f1f5f9);
  }
  .og-popover-select:focus,
  .og-popover-input:focus {
    border-color: var(--og-focus-ring, #3b82f6);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-focus-ring, #3b82f6) 22%, transparent);
  }
  .og-popover-input::placeholder {
    color: inherit;
    opacity: 0.4;
  }
  .og-popover-btn-group {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
  .og-popover-btn {
    flex: 1;
    height: 28px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
    transition: background-color 0.12s ease, border-color 0.12s ease, filter 0.12s ease;
  }
  .og-btn-primary {
    background-color: var(--og-popover-item-active-bg, var(--og-focus-ring, #3b82f6));
    color: var(--og-accent-contrast, #ffffff);
  }
  .og-btn-primary:hover {
    filter: brightness(1.1);
  }
  .og-btn-secondary {
    background-color: transparent;
    border-color: var(--og-popover-input-border, rgba(255, 255, 255, 0.12));
    color: inherit;
  }
  .og-btn-secondary:hover {
    background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, 0.06));
  }
  .og-group-row-toggle {
    width: 18px;
    height: 18px;
    margin-right: 0;
    transition: transform 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border-radius: 4px;
    border: 1px solid var(--og-group-badge-border, rgba(167, 139, 250, 0.34));
    background: var(--og-group-badge-bg, rgba(167, 139, 250, 0.14));
    color: var(--og-group-badge-text, #c4b5fd);
    line-height: 1;
  }

  .og-group-row-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1.5px solid rgba(147, 197, 253, 0.5);
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.62);
    cursor: pointer;
    flex: 0 0 auto;
    pointer-events: auto;
  }

  .og-group-row-checkbox:hover {
    border-color: #bfdbfe;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.13);
  }

  .og-group-row-checkbox:focus-visible {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: 2px;
  }

  .og-group-row-checkbox:checked,
  .og-group-row-checkbox:indeterminate {
    border-color: #93c5fd;
    background: linear-gradient(180deg, #60a5fa, #2563eb);
  }

  .og-group-row-checkbox:checked::after {
    content: '';
    width: 8px;
    height: 5px;
    border-left: 2px solid #ffffff;
    border-bottom: 2px solid #ffffff;
    transform: rotate(-45deg) translateY(-1px);
  }

  .og-group-row-checkbox:indeterminate::after {
    content: '';
    width: 8px;
    height: 2px;
    border-radius: 2px;
    background: #ffffff;
  }

  .og-group-row-toggle-expanded {
    transform: rotate(90deg);
  }

  .og-group-row-label-prefix {
    opacity: 0.72;
    margin-right: 6px;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0;
    color: #94a3b8;
    white-space: nowrap;
  }

  .og-group-count {
    margin-left: 4px;
    background: var(--og-group-badge-bg);
    border: 1px solid var(--og-group-badge-border);
    color: var(--og-group-badge-text);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    flex: 0 0 auto;
  }

  .og-group-row-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .og-group-aggregate {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 160px;
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.32);
    color: #94a3b8;
    font-size: 11px;
    white-space: nowrap;
  }

  .og-group-aggregate span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .og-group-aggregate strong {
    color: #dbeafe;
    font-weight: 800;
  }

  .og-detail-row-content {
    display: flex;
    align-items: center;
    padding-left: 24px;
    height: 100%;
    width: 100%;
    background-color: var(--og-detail-row-bg);
    border-bottom: 1px dashed var(--og-detail-row-border);
    color: var(--og-detail-row-text);
    font-size: var(--og-detail-row-font-size);
    font-style: italic;
  }

  /* Row Drag-and-Drop */
  .og-drag-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-left: 2px;
    flex-shrink: 0;
    color: var(--og-cell-text-muted, rgba(148, 163, 184, 0.5));
    cursor: grab;
    border-radius: 3px;
    transition: color 0.12s ease, background-color 0.12s ease;
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    touch-action: none;
    user-select: none;
  }
  .og-drag-handle:hover {
    color: var(--og-cell-text, #e2e8f0);
    background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, 0.08));
  }
  .og-drag-handle:active {
    cursor: grabbing;
  }

  .og-row-drop-indicator {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--og-focus-ring, #3b82f6);
    pointer-events: none;
    z-index: 100;
    box-shadow: 0 0 4px var(--og-focus-ring, #3b82f6);
  }
  .og-row-drop-indicator::before {
    content: '';
    position: absolute;
    left: 0;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--og-focus-ring, #3b82f6);
  }

  .og-row-being-dragged {
    opacity: 0.3;
    transition: opacity 0.1s ease;
  }

  .og-drag-ghost {
    position: fixed;
    pointer-events: none;
    z-index: 1000;
    overflow: hidden;
    border-radius: 4px;
    border: 1px solid var(--og-focus-ring, #3b82f6);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(59, 130, 246, 0.3);
    opacity: 0.9;
  }
`;
