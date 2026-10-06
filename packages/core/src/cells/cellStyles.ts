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
  --og-ct-on-accent: #fff;
  --og-ct-control-border: color-mix(in srgb, var(--og-text-color) 30%, transparent);
  --og-ct-neutral-bg: color-mix(in srgb, var(--og-text-color) 9%, transparent);
  --og-ct-track: color-mix(in srgb, var(--og-text-color) 11%, transparent);
  --og-ct-danger: var(--og-error, #ef4444);
  --og-ct-rating: #f5a524;
  --og-ct-radius: 6px;
}

/* ── Cells ─────────────────────────────────────────────────────────────── */
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
.og-ct-more { color: var(--og-ct-muted); font-variant-numeric: tabular-nums; }

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
  background: var(--og-popover-bg); color: var(--og-popover-text, var(--og-text-color));
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
`;
