/**
 * Styles for the built-in cell types, their editors and popovers.
 *
 * Every colour derives from the grid theme (--og-text-color, --og-focus-ring, --og-popover-*), so
 * built-in and custom themes restyle the cells with nothing extra to set. The derived --og-ct-*
 * tokens are defined on every theme scope: the grid container and the popovers, which carry the
 * grid's data-og-theme-scope when they are appended to <body>. Override any --og-ct-* on a grid
 * to adjust the cells alone.
 *
 * A hued element sets --og-ct-hue; badges mix it with the theme's text colour, so one palette
 * name reads well on light and dark themes alike.
 */
export const CELL_STYLES = `
.og-grid-container, [data-og-theme-scope] {
  --og-ct-text: var(--og-text-color);
  --og-ct-muted: color-mix(in srgb, var(--og-text-color) 58%, transparent);
  --og-ct-subtle: color-mix(in srgb, var(--og-text-color) 36%, transparent);
  --og-ct-accent: var(--og-focus-ring);
  --og-ct-on-accent: var(--og-accent-contrast, #fff);
  --og-ct-control-border: color-mix(in srgb, var(--og-text-color) 30%, transparent);
  --og-ct-neutral-bg: color-mix(in srgb, var(--og-text-color) 9%, transparent);
  --og-ct-track: color-mix(in srgb, var(--og-text-color) 11%, transparent);
  --og-ct-danger: var(--og-error, #ef4444);
  --og-ct-rating: #f5a524;
  --og-ct-timeline-tick: color-mix(in srgb, var(--og-text-color) 10%, transparent);
  --og-ct-timeline-today: color-mix(in srgb, var(--og-ct-danger) 70%, transparent);
  --og-ct-radius: 6px;
}

/* ── Cells ─────────────────────────────────────────────────────────────── */
/* Timeline: month lines and today on the track; the bar moves and resizes. */
.og-ct-timeline { position: relative; flex: 1; align-self: stretch; margin: 0 -6px; }
.og-ct-timeline-bar {
  position: absolute; top: 50%; height: 18px; transform: translateY(-50%); min-width: 4px; box-sizing: border-box;
  display: flex; align-items: center; padding: 0 6px; overflow: hidden; border-radius: 5px;
  background: color-mix(in srgb, var(--og-ct-hue, var(--og-ct-accent)) 30%, transparent);
  border: 1px solid color-mix(in srgb, var(--og-ct-hue, var(--og-ct-accent)) 75%, transparent);
  transition: left .18s ease, width .18s ease;
}
.og-ct-timeline-bar[data-dragging] { transition: none; box-shadow: 0 2px 10px color-mix(in srgb, var(--og-ct-hue, var(--og-ct-accent)) 40%, transparent); }
.og-ct-timeline-label { font-size: 11px; font-weight: 600; color: var(--og-ct-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
.og-ct-timeline[data-editable] .og-ct-timeline-bar { cursor: grab; touch-action: none; }
.og-ct-timeline[data-editable] .og-ct-timeline-bar[data-dragging] { cursor: grabbing; }
.og-ct-timeline[data-editable] .og-ct-timeline-bar[data-edge="start"],
.og-ct-timeline[data-editable] .og-ct-timeline-bar[data-edge="end"] { cursor: ew-resize; }
.og-ct-cell { display: flex; align-items: center; gap: 6px; width: 100%; height: 100%; min-width: 0; overflow: hidden; }
.og-ct-cell-end { justify-content: flex-end; }
.og-ct-cell-center { justify-content: center; }
.og-ct-empty-value { color: var(--og-ct-subtle); }
.og-ct-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-icon { display: inline-flex; flex: none; color: var(--og-ct-muted); }
.og-ct-icon svg { display: block; }

.og-ct-badge {
  display: inline-flex; align-items: center; gap: 6px; height: 22px; max-width: 100%; padding: 0 8px; flex: none;
  border-radius: var(--og-ct-radius); font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap;
  background: var(--og-ct-neutral-bg); color: var(--og-ct-text);
}
.og-ct-badge[data-hued] {
  background: color-mix(in srgb, var(--og-ct-hue) 15%, transparent);
  color: color-mix(in srgb, var(--og-ct-hue) 72%, var(--og-text-color));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ct-hue) 24%, transparent);
}
.og-ct-badge > span { overflow: hidden; text-overflow: ellipsis; }
.og-ct-badge[data-variant='dot'] { background: transparent; box-shadow: none; color: var(--og-ct-text); padding: 0 2px; }
.og-ct-badge[data-variant='outline'] { background: transparent; box-shadow: inset 0 0 0 1px var(--og-ct-control-border); color: var(--og-ct-text); }
.og-ct-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; background: var(--og-ct-hue, var(--og-ct-muted)); }
.og-ct-chips { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; }
.og-ct-more { flex: none; color: var(--og-ct-muted); font-variant-numeric: tabular-nums; }
/* In a row of chips the last one shrinks (with an ellipsis) so the “+N” stays in view. */
.og-ct-chips > .og-ct-badge, .og-ct-chips > .og-ct-record { flex: 0 1 auto; min-width: 28px; }

.og-ct-checkbox {
  width: 16px; height: 16px; border-radius: 4px; flex: none; display: grid; place-items: center;
  box-shadow: inset 0 0 0 1px var(--og-ct-control-border); color: transparent; background: transparent;
  transition: background-color .12s ease, box-shadow .12s ease, color .12s ease; cursor: pointer;
}
.og-ct-checkbox[data-checked] { background: var(--og-ct-accent); box-shadow: none; color: var(--og-ct-on-accent); }
.og-ct-checkbox-host:hover .og-ct-checkbox:not([data-checked]) { box-shadow: inset 0 0 0 1px var(--og-ct-muted); }
.og-ct-checkbox-host { cursor: pointer; user-select: none; }

.og-ct-number { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.og-ct-number[data-negative] { color: var(--og-ct-danger); }

.og-ct-stars { display: inline-flex; gap: 2px; color: var(--og-ct-track); }
.og-ct-star { display: inline-flex; color: color-mix(in srgb, var(--og-text-color) 22%, transparent); }
.og-ct-star[data-on] { color: var(--og-ct-rating); }
.og-ct-stars[data-interactive] .og-ct-star { cursor: pointer; }

.og-ct-progress { flex: 1; min-width: 24px; height: 6px; border-radius: 999px; background: var(--og-ct-track); overflow: hidden; }
.og-ct-progress > i { display: block; height: 100%; border-radius: inherit; background: var(--og-ct-hue, var(--og-ct-accent)); transition: width .2s ease; }
.og-ct-progress-label { width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; color: var(--og-ct-muted); font-size: 12px; flex: none; }

.og-ct-link { color: var(--og-ct-accent); text-decoration: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-link:hover { text-decoration: underline; text-underline-offset: 2px; }

.og-ct-avatar {
  width: 22px; height: 22px; border-radius: 999px; flex: none; display: grid; place-items: center; overflow: hidden;
  font-size: 10px; font-weight: 600; letter-spacing: .02em; color: #fff; background: var(--og-ct-hue, var(--og-ct-muted));
}
.og-ct-avatar img { width: 100%; height: 100%; object-fit: cover; }
.og-ct-avatars { display: flex; }
.og-ct-avatars .og-ct-avatar + .og-ct-avatar { margin-left: -6px; box-shadow: 0 0 0 2px var(--og-bg-color); }

/* ── Editors ───────────────────────────────────────────────────────────── */
/* The shell also carries og-cell-editor: the grid's editor frame, focus ring and event guards. */
.og-cell-editor.og-ct-editor { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 0 6px 0 8px; }
.og-ct-editor input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--og-ct-text); font: inherit; padding: 0 2px; }
.og-ct-editor input[data-numeric] { text-align: right; font-variant-numeric: tabular-nums; }
.og-ct-trigger { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; height: 100%; cursor: pointer; }
.og-ct-trigger .og-ct-chevron { margin-left: auto; color: var(--og-ct-muted); display: inline-flex; }
.og-ct-stepper { display: flex; flex-direction: column; flex: none; }
.og-ct-stepper button {
  display: grid; place-items: center; width: 18px; height: 12px; padding: 0; border: 0; border-radius: 3px;
  background: transparent; color: var(--og-ct-muted); cursor: pointer;
}
.og-ct-stepper button:hover { background: var(--og-ct-neutral-bg); color: var(--og-ct-text); }
.og-ct-placeholder { color: var(--og-ct-subtle); }

/* ── Popover, listbox, calendar ────────────────────────────────────────── */
.og-ct-popover {
  position: fixed; z-index: 10000; box-sizing: border-box; min-width: 180px; max-width: min(440px, calc(100vw - 16px));
  padding: 4px; border-radius: 10px; border: 1px solid var(--og-popover-border);
  /* Themes give popovers a slightly translucent colour: lay it over the opaque grid background. */
  background: linear-gradient(var(--og-popover-bg), var(--og-popover-bg)), var(--og-bg-color);
  color: var(--og-popover-text, var(--og-text-color));
  box-shadow: 0 16px 36px -12px rgba(0, 0, 0, .45), 0 2px 8px -2px rgba(0, 0, 0, .2);
  font-family: var(--og-font-family); font-size: 13px; line-height: 1.35; outline: none; overflow-y: auto;
  animation: og-ct-pop .12s ease-out;
}
@keyframes og-ct-pop { from { opacity: 0; transform: translateY(-3px) scale(.985); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .og-ct-popover { animation: none; } }
.og-ct-search {
  display: flex; align-items: center; gap: 8px; height: 34px; margin: 2px 2px 4px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--og-popover-input-border, var(--og-popover-border)); background: var(--og-popover-input-bg, transparent);
  color: var(--og-ct-muted);
}
.og-ct-search:focus-within { border-color: var(--og-ct-accent); }
.og-ct-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--og-ct-text); font: inherit; }
.og-ct-search input::placeholder { color: var(--og-ct-subtle); }
/* The field's frame shows focus; the input itself draws no second ring. */
.og-ct-search input:focus, .og-ct-search input:focus-visible { outline: none; box-shadow: none; }
.og-ct-list { max-height: 296px; overflow-y: auto; overscroll-behavior: contain; scroll-padding: 4px; outline: none; }
.og-ct-group { padding: 8px 8px 4px; font-size: 11.5px; font-weight: 500; color: var(--og-ct-muted); }
.og-ct-option {
  display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 8px; border-radius: 6px;
  cursor: pointer; user-select: none; color: var(--og-ct-text);
}
.og-ct-option[data-active] { background: var(--og-popover-item-hover-bg); }
.og-ct-option[aria-disabled='true'] { opacity: .45; cursor: default; }
.og-ct-option[data-muted] { color: var(--og-ct-muted); }
.og-ct-option-body { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; padding: 6px 0; }
.og-ct-option-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-option-desc { font-size: 11.5px; color: var(--og-ct-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-option .og-ct-check { flex: none; display: inline-flex; color: var(--og-ct-text); visibility: hidden; }
.og-ct-option[aria-selected='true'] .og-ct-check { visibility: visible; }
.og-ct-option[data-multiple] .og-ct-checkbox { cursor: inherit; }
.og-ct-option-icon { display: inline-flex; flex: none; color: var(--og-ct-muted); }
.og-ct-list-empty { padding: 18px 8px; text-align: center; color: var(--og-ct-muted); }
.og-ct-list-status {
  display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 4px 8px;
  font-size: 12px; color: var(--og-ct-muted);
}
.og-ct-list-status[data-meta] { min-height: 28px; font-size: 11.5px; color: var(--og-ct-subtle); font-variant-numeric: tabular-nums; }
.og-ct-spinner {
  width: 14px; height: 14px; border-radius: 999px; flex: none;
  border: 2px solid var(--og-ct-track); border-top-color: var(--og-ct-accent);
  animation: og-ct-spin .7s linear infinite;
}
@keyframes og-ct-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .og-ct-spinner { animation-duration: 2s; } }
/* A value whose label is still being looked up. */
.og-ct-skeleton {
  display: inline-block; height: 10px; width: 64%; max-width: 120px; border-radius: 999px;
  background: var(--og-ct-track); animation: og-ct-pulse 1.2s ease-in-out infinite;
}
@keyframes og-ct-pulse { 50% { opacity: .45; } }
.og-ct-separator { height: 1px; margin: 4px -4px; background: var(--og-popover-divider, var(--og-popover-border)); }

.og-ct-calendar { width: 252px; padding: 6px; user-select: none; }
.og-ct-cal-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 2px 8px; font-weight: 600; }
.og-ct-cal-nav {
  display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 6px;
  border: 1px solid var(--og-popover-border); background: transparent; color: var(--og-ct-text); cursor: pointer;
}
.og-ct-cal-nav:hover { background: var(--og-popover-item-hover-bg); }
.og-ct-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.og-ct-cal-dow { height: 26px; display: grid; place-items: center; font-size: 11.5px; color: var(--og-ct-muted); }
.og-ct-cal-day {
  height: 32px; display: grid; place-items: center; border: 0; border-radius: 6px; padding: 0;
  background: transparent; color: var(--og-ct-text); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer;
}
.og-ct-cal-day[data-outside] { color: var(--og-ct-subtle); }
.og-ct-cal-day[data-today] { box-shadow: inset 0 0 0 1px var(--og-ct-control-border); }
.og-ct-cal-day:hover, .og-ct-cal-day[data-active] { background: var(--og-popover-item-hover-bg); }
.og-ct-cal-day[aria-selected='true'] { background: var(--og-ct-accent); color: var(--og-ct-on-accent); }
.og-ct-cal-foot { display: flex; justify-content: space-between; gap: 8px; padding-top: 8px; margin-top: 6px; border-top: 1px solid var(--og-popover-divider, var(--og-popover-border)); }
.og-ct-btn {
  height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--og-popover-border);
  background: transparent; color: var(--og-ct-text); font: inherit; font-size: 12.5px; cursor: pointer;
}
.og-ct-btn:hover { background: var(--og-popover-item-hover-bg); }
.og-ct-btn[data-ghost] { border-color: transparent; color: var(--og-ct-muted); }
.og-ct-popover :focus-visible { outline: 2px solid var(--og-ct-accent); outline-offset: 1px; }
.og-ct-btn[data-primary] { background: var(--og-ct-accent); border-color: var(--og-ct-accent); color: var(--og-ct-on-accent); font-weight: 500; }
.og-ct-btn[data-primary]:hover { background: color-mix(in srgb, var(--og-ct-accent) 88%, #000); }
.og-ct-btn:disabled { opacity: .45; cursor: default; }
.og-ct-popover-wide { max-width: min(640px, calc(100vw - 16px)); }

/* ── Switch, segmented ─────────────────────────────────────────────────── */
.og-ct-switch {
  position: relative; width: 30px; height: 17px; border-radius: 999px; flex: none; cursor: pointer;
  background: var(--og-ct-track); box-shadow: inset 0 0 0 1px var(--og-ct-control-border);
  transition: background-color .15s ease, box-shadow .15s ease;
}
.og-ct-switch > i {
  position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 999px; background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3); transition: transform .15s ease;
}
.og-ct-switch[data-checked] { background: var(--og-ct-accent); box-shadow: none; }
.og-ct-switch[data-checked] > i { transform: translateX(13px); }
.og-ct-switch-label { font-size: 12.5px; color: var(--og-ct-muted); }
@media (prefers-reduced-motion: reduce) { .og-ct-switch, .og-ct-switch > i { transition: none; } }

.og-ct-segmented {
  display: inline-flex; max-width: 100%; padding: 2px; gap: 2px; border-radius: 7px; overflow: hidden;
  background: var(--og-ct-neutral-bg); box-shadow: inset 0 0 0 1px var(--og-ct-control-border);
}
.og-ct-segment {
  display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 5px; flex: none;
  font-size: 12px; color: var(--og-ct-muted); cursor: pointer; white-space: nowrap; user-select: none;
  transition: background-color .12s ease, color .12s ease;
}
.og-ct-segment:hover { color: var(--og-ct-text); }
.og-ct-segment[aria-checked='true'] {
  background: var(--og-bg-color); color: var(--og-ct-text); font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18), inset 0 0 0 1px var(--og-ct-control-border);
}
.og-ct-segment[data-hued][aria-checked='true'] {
  background: color-mix(in srgb, var(--og-ct-hue) 18%, var(--og-bg-color));
  color: color-mix(in srgb, var(--og-ct-hue) 75%, var(--og-text-color));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ct-hue) 35%, transparent);
}

/* ── Colour ────────────────────────────────────────────────────────────── */
.og-ct-swatch {
  width: 16px; height: 16px; border-radius: 5px; flex: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-text-color) 22%, transparent);
}
.og-ct-swatch[data-empty] { background: repeating-conic-gradient(var(--og-ct-track) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
.og-ct-hex { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--og-ct-muted); letter-spacing: .02em; }
.og-ct-editor input[data-invalid] { color: var(--og-ct-danger); }
.og-ct-color-panel { width: 252px; padding: 6px; display: flex; flex-direction: column; gap: 8px; }
.og-ct-swatches { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; outline: none; }
.og-ct-swatch-button {
  aspect-ratio: 1; width: 100%; padding: 0; border: 0; border-radius: 5px; cursor: pointer;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-text-color) 14%, transparent); transition: transform .1s ease;
}
.og-ct-swatch-button:hover { transform: scale(1.12); }
.og-ct-swatch-button[aria-selected='true'], .og-ct-swatch-button[data-active] {
  box-shadow: 0 0 0 2px var(--og-popover-bg), 0 0 0 4px var(--og-ct-accent);
}
.og-ct-color-custom { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--og-popover-divider, var(--og-popover-border)); font-size: 12.5px; color: var(--og-ct-muted); }
.og-ct-color-custom > span { flex: 1; }
.og-ct-color-native { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; }
.og-ct-color-native::-webkit-color-swatch-wrapper { padding: 0; }
.og-ct-color-native::-webkit-color-swatch { border: 0; border-radius: 6px; box-shadow: inset 0 0 0 1px var(--og-ct-control-border); }
.og-ct-color-native::-moz-color-swatch { border: 0; border-radius: 6px; }

/* ── Long text ─────────────────────────────────────────────────────────── */
.og-ct-longtext { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-longtext[data-multiline] {
  white-space: pre-line; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--og-ct-lines, 2);
  line-height: 1.35; font-size: 12.5px;
}
.og-ct-longtext-panel { display: flex; flex-direction: column; gap: 6px; min-width: 300px; }
.og-ct-textarea {
  width: 100%; box-sizing: border-box; resize: none; padding: 8px 10px; border-radius: 8px; line-height: 20px;
  border: 1px solid var(--og-popover-input-border, var(--og-popover-border)); background: var(--og-popover-input-bg, transparent);
  color: var(--og-ct-text); font: inherit; font-size: 13px; outline: none;
}
.og-ct-textarea:focus { border-color: var(--og-ct-accent); }
.og-ct-longtext-foot { display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--og-ct-subtle); }
.og-ct-kbd-hint { flex: 1; }
.og-ct-kbd-hint kbd {
  display: inline-block; min-width: 16px; padding: 0 4px; margin-right: 2px; border-radius: 4px; text-align: center;
  font: inherit; font-size: 10.5px; border: 1px solid var(--og-popover-border); color: var(--og-ct-muted);
}
.og-ct-count { font-variant-numeric: tabular-nums; }
.og-ct-count[data-near] { color: var(--og-ct-danger); }

/* ── Linked records ────────────────────────────────────────────────────── */
.og-ct-record {
  display: inline-flex; align-items: center; gap: 6px; height: 22px; max-width: 100%; padding: 0 8px 0 3px; flex: none;
  border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--og-ct-text);
  background: var(--og-bg-color); box-shadow: inset 0 0 0 1px var(--og-ct-control-border), 0 1px 1px rgba(0, 0, 0, .06);
}
.og-ct-record-tile {
  width: 16px; height: 16px; border-radius: 4px; flex: none; display: grid; place-items: center;
  font-size: 9.5px; font-weight: 700; color: #fff; background: var(--og-ct-hue);
}
.og-ct-record-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-chips[data-openable] .og-ct-record, .og-ct-chips[data-openable] .og-ct-badge { cursor: pointer; }
.og-ct-chips[data-openable] .og-ct-record:hover { box-shadow: inset 0 0 0 1px var(--og-ct-accent); }

/* ── Cascading select ──────────────────────────────────────────────────── */
.og-ct-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ct-path-part { color: var(--og-ct-muted); }
.og-ct-path-sep { color: var(--og-ct-subtle); }
.og-ct-cascade { display: flex; flex-direction: column; }
.og-ct-cascade-columns { display: flex; outline: none; max-width: 100%; overflow-x: auto; }
.og-ct-cascade-column { min-width: 172px; max-height: 296px; overflow-y: auto; overscroll-behavior: contain; padding-right: 4px; }
.og-ct-cascade-column + .og-ct-cascade-column { border-left: 1px solid var(--og-popover-divider, var(--og-popover-border)); padding-left: 4px; }
.og-ct-cascade-results { min-width: 280px; flex: 1; }
.og-ct-option[data-open] { background: color-mix(in srgb, var(--og-ct-accent) 12%, transparent); }
.og-ct-option[data-open][data-active], .og-ct-option[data-active] { background: var(--og-popover-item-hover-bg); }
.og-ct-option[data-open] .og-ct-option-label { font-weight: 500; }
.og-ct-cascade-tail { display: inline-flex; flex: none; margin-left: auto; color: var(--og-ct-muted); }

/* ── Date range ────────────────────────────────────────────────────────── */
.og-ct-range-length {
  flex: none; padding: 1px 6px; border-radius: 999px; font-size: 10.5px; font-weight: 500;
  color: var(--og-ct-muted); background: var(--og-ct-neutral-bg); font-variant-numeric: tabular-nums;
}
.og-ct-popover-range { max-width: calc(100vw - 16px); overflow: hidden auto; padding: 0; }
.og-ct-range-panel { display: flex; }
.og-ct-range-presets {
  display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; width: 132px; flex: none;
  border-right: 1px solid var(--og-popover-divider, var(--og-popover-border));
}
.og-ct-range-preset {
  text-align: left; height: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
  color: var(--og-ct-muted); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap;
  transition: background-color .12s ease, color .12s ease;
}
.og-ct-range-preset:hover { background: var(--og-popover-item-hover-bg); color: var(--og-ct-text); }
.og-ct-range-preset[aria-pressed='true'] {
  background: color-mix(in srgb, var(--og-ct-accent) 14%, transparent); color: var(--og-ct-accent); font-weight: 500;
}
.og-ct-range-main { display: flex; flex-direction: column; min-width: 0; padding: 12px 14px 0; }
.og-ct-range-fields { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.og-ct-range-field {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--og-popover-input-border, var(--og-popover-border)); background: var(--og-popover-input-bg, transparent);
  transition: border-color .12s ease, box-shadow .12s ease;
}
.og-ct-range-field[data-picking] { border-color: var(--og-ct-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-ct-accent) 18%, transparent); }
.og-ct-range-field-label { font-size: 10.5px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--og-ct-subtle); }
.og-ct-range-field-value { font-size: 13px; color: var(--og-ct-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-ct-range-arrow { color: var(--og-ct-subtle); }
.og-ct-range-months { display: flex; gap: 20px; outline: none; }
.og-ct-range-months:focus-visible { outline: none; }
.og-ct-range-months .og-ct-calendar { width: 238px; padding: 0; }
.og-ct-range-months .og-ct-calendar + .og-ct-calendar { padding-left: 20px; border-left: 1px solid var(--og-popover-divider, var(--og-popover-border)); }
.og-ct-range-months .og-ct-cal-head { padding: 0 0 8px; font-size: 13px; }
.og-ct-range-months .og-ct-cal-nav { width: 26px; height: 26px; border-color: transparent; color: var(--og-ct-muted); }
.og-ct-range-months .og-ct-cal-nav:hover { color: var(--og-ct-text); }
.og-ct-range-grid { gap: 2px 0; }
.og-ct-range-grid .og-ct-cal-day {
  position: relative; height: 34px; border-radius: 0; background: transparent; box-shadow: none;
}
/* The base calendar paints the whole day; here the pill and band do (declared before the band rules). */
.og-ct-range-grid .og-ct-cal-day:hover,
.og-ct-range-grid .og-ct-cal-day[data-active],
.og-ct-range-grid .og-ct-cal-day[aria-selected='true'] { background: transparent; }
.og-ct-range-grid .og-ct-cal-day > span {
  position: relative; z-index: 1; display: grid; place-items: center; width: 30px; height: 30px; margin: auto; border-radius: 8px;
  transition: background-color .1s ease;
}
.og-ct-range-grid .og-ct-cal-day:hover > span { background: var(--og-popover-item-hover-bg); }
.og-ct-range-grid .og-ct-cal-day[data-today] > span::after {
  content: ''; position: absolute; bottom: 3px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 999px; background: var(--og-ct-accent);
}
/* The band: in-range days, and the inner half of each end. */
.og-ct-range-grid .og-ct-cal-day[data-in-range] { background: color-mix(in srgb, var(--og-ct-accent) 15%, transparent); }
.og-ct-range-grid .og-ct-cal-day[data-in-range][data-preview] { background: color-mix(in srgb, var(--og-ct-accent) 9%, transparent); }
.og-ct-range-grid .og-ct-cal-day[data-range-start] { background: linear-gradient(to right, transparent 50%, color-mix(in srgb, var(--og-ct-accent) 15%, transparent) 50%); }
.og-ct-range-grid .og-ct-cal-day[data-range-end] { background: linear-gradient(to left, transparent 50%, color-mix(in srgb, var(--og-ct-accent) 15%, transparent) 50%); }
.og-ct-range-grid .og-ct-cal-day[data-range-start][data-row-end], .og-ct-range-grid .og-ct-cal-day[data-range-end][data-row-start] { background: transparent; }
.og-ct-range-grid .og-ct-cal-day[data-in-range][data-row-start] { border-radius: 8px 0 0 8px; }
.og-ct-range-grid .og-ct-cal-day[data-in-range][data-row-end] { border-radius: 0 8px 8px 0; }
.og-ct-range-grid .og-ct-cal-day[data-in-range][data-row-start][data-row-end] { border-radius: 8px; }
.og-ct-range-grid .og-ct-cal-day[data-range-start] > span,
.og-ct-range-grid .og-ct-cal-day[data-range-end] > span,
.og-ct-range-grid .og-ct-cal-day[data-range-single] > span {
  background: var(--og-ct-accent); color: var(--og-ct-on-accent); font-weight: 600;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--og-ct-accent) 45%, transparent);
}
.og-ct-range-grid .og-ct-cal-day[data-range-start] > span::after,
.og-ct-range-grid .og-ct-cal-day[data-range-end] > span::after,
.og-ct-range-grid .og-ct-cal-day[data-range-single] > span::after { background: var(--og-ct-on-accent); }
.og-ct-range-grid .og-ct-cal-day[data-active] > span { box-shadow: inset 0 0 0 2px var(--og-ct-accent); }
.og-ct-range-main .og-ct-cal-foot {
  align-items: center; margin: 12px -14px 0; padding: 10px 14px; border-top: 1px solid var(--og-popover-divider, var(--og-popover-border));
}
.og-ct-range-summary { font-size: 12px; color: var(--og-ct-muted); font-variant-numeric: tabular-nums; }
.og-ct-range-actions { display: flex; gap: 6px; }

/* ── Sparkline ─────────────────────────────────────────────────────────── */
.og-ct-spark { position: relative; flex: 1; min-width: 32px; }
.og-ct-spark svg { display: block; overflow: visible; }
.og-ct-spark-dot {
  position: absolute; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 999px;
  box-shadow: 0 0 0 1.5px var(--og-bg-color); pointer-events: none;
}
.og-ct-spark-label { flex: none; min-width: 3.2em; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--og-ct-muted); }
/* ── Filter editors ────────────────────────────────────────────────────── */
.og-flt { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 13px; color: var(--og-ct-text); }
.og-flt-compact { flex-direction: row; align-items: center; gap: 4px; width: 100%; height: 100%; }
.og-flt-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.og-flt-compact .og-flt-row { flex: 1; gap: 4px; }
.og-flt-values { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.og-flt-field {
  display: flex; align-items: center; flex: 1; min-width: 0; height: 32px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--og-popover-input-border, var(--og-popover-border)); background: var(--og-popover-input-bg, transparent);
  transition: border-color .12s ease, box-shadow .12s ease;
}
.og-flt-field:focus-within { border-color: var(--og-ct-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-ct-accent) 18%, transparent); }
.og-flt-compact .og-flt-field { height: 26px; border-radius: 6px; padding: 0 6px; }
.og-flt-input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--og-ct-text); font: inherit; }
.og-flt-select { appearance: none; cursor: pointer; padding-right: 16px; background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 2px center; }
.og-flt-select option { background: var(--og-popover-bg, var(--og-bg-color)); color: var(--og-ct-text); }
.og-flt-amount { flex: 0 0 64px; }
.og-flt-row:has(> .og-flt-values[data-wrap]) { flex-wrap: wrap; }
.og-flt-values[data-wrap] { flex-basis: 100%; }
.og-flt-periods { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; width: 100%; }
.og-flt-period {
  height: 28px; padding: 0 6px; border: 0; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; background: var(--og-ct-neutral-bg); color: var(--og-ct-text); transition: background-color .12s ease, color .12s ease;
}
.og-flt-period:hover { background: color-mix(in srgb, var(--og-text-color) 14%, transparent); }
.og-flt-period[aria-checked='true'] { background: var(--og-ct-accent); color: var(--og-ct-on-accent); }
.og-flt-period:focus-visible { outline: 2px solid var(--og-ct-accent); outline-offset: 1px; }
.og-flt-input:focus, .og-flt-input:focus-visible { outline: none; }
.og-flt-input::placeholder { color: var(--og-ct-subtle); }
.og-flt-input[data-numeric] { font-variant-numeric: tabular-nums; }
.og-flt-dash { color: var(--og-ct-subtle); flex: none; }
.og-flt-icon-btn {
  display: grid; place-items: center; width: 22px; height: 22px; margin-right: -4px; padding: 0; flex: none;
  border: 0; border-radius: 5px; background: transparent; color: var(--og-ct-muted); cursor: pointer;
}
.og-flt-icon-btn:hover { background: var(--og-popover-item-hover-bg); color: var(--og-ct-text); }
.og-flt-op {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px 0 10px; flex: none; max-width: 150px;
  border-radius: 7px; border: 1px solid var(--og-popover-input-border, var(--og-popover-border)); background: var(--og-popover-input-bg, transparent);
  color: var(--og-ct-text); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.og-flt-op:hover { border-color: var(--og-ct-control-border); }
.og-flt-op-label { overflow: hidden; text-overflow: ellipsis; }
.og-flt-op-compact { height: 26px; min-width: 26px; padding: 0 6px; justify-content: center; font-weight: 600; color: var(--og-ct-muted); }
.og-flt-more { display: flex; flex-direction: column; gap: 8px; }
.og-flt-join { display: flex; align-items: center; justify-content: space-between; }
.og-flt-link {
  align-self: flex-start; padding: 2px 0; border: 0; background: none; color: var(--og-ct-accent);
  font: inherit; font-size: 12.5px; cursor: pointer;
}
.og-flt-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.og-flt-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; background: var(--og-ct-neutral-bg); }
.og-flt-seg-btn {
  height: 26px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent;
  color: var(--og-ct-muted); font: inherit; font-size: 12.5px; cursor: pointer;
}
.og-flt-seg-btn:hover { color: var(--og-ct-text); }
.og-flt-seg-btn[aria-checked='true'] { background: var(--og-popover-bg); color: var(--og-ct-text); font-weight: 500; box-shadow: 0 1px 2px rgba(0, 0, 0, .2); }
.og-flt-seg-sm .og-flt-seg-btn { height: 22px; padding: 0 9px; font-size: 12px; }
.og-flt-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; border-top: 1px solid var(--og-popover-divider, var(--og-popover-border)); }
.og-flt-toolbar:empty { display: none; }
.og-flt-actions { display: flex; gap: 12px; margin-left: auto; }
.og-flt-select .og-ct-list { max-height: 260px; }
.og-ct-option-count {
  flex: none; margin-left: auto; padding: 0 6px; min-width: 18px; text-align: center; border-radius: 999px;
  font-size: 11px; font-variant-numeric: tabular-nums; color: var(--og-ct-muted); background: var(--og-ct-neutral-bg);
}
.og-flt-stars { display: flex; align-items: center; gap: 2px; }
.og-flt-hint { margin-right: 6px; font-size: 12.5px; color: var(--og-ct-muted); }
.og-flt-star { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: none; cursor: pointer; color: color-mix(in srgb, var(--og-text-color) 22%, transparent); }
.og-flt-star[data-on] { color: var(--og-ct-rating); }
.og-flt-compact .og-flt-star { width: 18px; height: 18px; }
.og-flt-tree-list { max-height: 280px; }
.og-flt-tree-row { gap: 6px; min-height: 30px; }
.og-flt-caret { display: grid; place-items: center; width: 16px; height: 16px; flex: none; color: var(--og-ct-muted); border-radius: 4px; }
.og-flt-caret:hover { background: var(--og-popover-item-hover-bg); color: var(--og-ct-text); }
.og-ct-checkbox[data-partial] { box-shadow: inset 0 0 0 1px var(--og-ct-accent); background: linear-gradient(var(--og-ct-accent), var(--og-ct-accent)) center / 8px 2px no-repeat; }
.og-flt-swatches .og-ct-swatches { width: 240px; }
.og-flt-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%; height: 24px; padding: 0 6px 0 8px; border-radius: 6px;
  border: 1px dashed var(--og-ct-control-border); background: transparent; color: var(--og-ct-muted); font: inherit; font-size: 12px; cursor: pointer;
}
.og-flt-chip[data-active] { border-style: solid; border-color: color-mix(in srgb, var(--og-ct-accent) 55%, transparent); color: var(--og-ct-text); background: color-mix(in srgb, var(--og-ct-accent) 12%, transparent); }
.og-flt-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-flt-popover-body { min-width: 260px; max-width: 360px; padding: 4px; }

/* The filter popover (header funnel) and its header. */
.og-flt-panel { display: flex; flex-direction: column; gap: 10px; width: 300px; max-width: calc(100vw - 32px); padding: 6px 6px 4px; }
.og-flt-panel-head { display: flex; align-items: center; gap: 8px; padding: 2px 2px 0; }
.og-flt-panel-title { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-flt-panel-title > span { color: var(--og-ct-muted); font-weight: 500; }

.og-popover-filter-body { padding: 2px 4px 4px; }
.og-header-popover:has(.og-flt-select, .og-flt-tree, .og-flt-more) { width: 284px; }
.og-floating-filter-cell .og-flt-compact { padding: 0 4px; }
.og-header-filter-button {
  display: none; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; border-radius: 4px;
  cursor: pointer; color: var(--og-header-text, #94a3b8); opacity: 0; transition: opacity .15s ease, color .15s ease, background-color .15s ease;
}
.og-header-cell:hover .og-header-filter-button, .og-header-filter-button[data-active] { opacity: 1; }
.og-header-filter-button[data-active] { color: var(--og-focus-ring); }
.og-header-filter-button[data-active] svg { fill: color-mix(in srgb, var(--og-focus-ring) 30%, transparent); }
.og-header-filter-button:hover { color: var(--og-focus-ring); background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, .08)); }

`;
