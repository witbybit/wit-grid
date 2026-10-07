/** The sidebar: all colours from the grid's theme variables (the sidebar carries the grid's theme scope). */
export const SIDEBAR_STYLES = `
.og-shell { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.og-shell[data-og-sidebar='left'] { flex-direction: row-reverse; }
.og-shell-grid { flex: 1 1 auto; min-width: 0; height: 100%; position: relative; }

.og-sb {
  --og-sb-accent: var(--og-focus-ring);
  --og-sb-line: var(--og-border-color);
  --og-sb-soft: color-mix(in srgb, var(--og-text-color) 5%, transparent);
  --og-sb-hover: color-mix(in srgb, var(--og-text-color) 8%, transparent);
  display: flex; height: 100%; flex: none; min-height: 0;
  font-family: var(--og-font-family, inherit); font-size: 13px; color: var(--og-text-color);
}
.og-sb[data-position='left'] { flex-direction: row-reverse; }

/* Rail */
.og-sb-rail {
  width: 48px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0;
  background: var(--og-header-bg); border-left: 1px solid var(--og-sb-line);
}
.og-sb[data-position='left'] .og-sb-rail { border-left: 0; border-right: 1px solid var(--og-sb-line); }
.og-sb-tab {
  position: relative; width: 34px; height: 34px; flex: none; display: grid; place-items: center; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: var(--og-header-text); cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
}
.og-sb-tab:hover { background: var(--og-sb-hover); color: var(--og-text-color); }
.og-sb-tab:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: 1px; }
.og-sb-tab[aria-selected='true'] { background: color-mix(in srgb, var(--og-sb-accent) 16%, transparent); color: var(--og-sb-accent); }
.og-sb-tab[aria-selected='true']::before {
  content: ''; position: absolute; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--og-sb-accent);
  right: -7px;
}
.og-sb[data-position='left'] .og-sb-tab[aria-selected='true']::before { right: auto; left: -7px; }
.og-sb-badge {
  position: absolute; top: 1px; right: 1px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  display: none; align-items: center; justify-content: center; font-size: 9.5px; font-weight: 700; line-height: 1;
  background: var(--og-sb-accent); color: #fff; box-shadow: 0 0 0 2px var(--og-header-bg); font-variant-numeric: tabular-nums;
}
.og-sb-tab[data-badged] .og-sb-badge { display: inline-flex; }

/* Panel */
.og-sb-panel {
  width: 0; flex: none; overflow: hidden; background: var(--og-bg-color);
  transition: width .22s cubic-bezier(.4, 0, .2, 1);
}
.og-sb[data-open] .og-sb-panel { width: var(--og-sb-width, 300px); border-left: 1px solid var(--og-sb-line); }
.og-sb[data-position='left'][data-open] .og-sb-panel { border-left: 0; border-right: 1px solid var(--og-sb-line); }
.og-sb-panel-inner { width: var(--og-sb-width, 300px); height: 100%; display: flex; flex-direction: column; min-height: 0; }
.og-sb-head {
  display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 10px 0 16px; flex: none;
  border-bottom: 1px solid var(--og-sb-line);
}
.og-sb-title { flex: 1; min-width: 0; margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.005em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-actions { display: flex; align-items: center; gap: 4px; }
.og-sb-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px; }
.og-sb-body::-webkit-scrollbar { width: 10px; }
.og-sb-body::-webkit-scrollbar-thumb { background: var(--og-sb-hover); border-radius: 10px; border: 3px solid transparent; background-clip: padding-box; }
.og-sb-adapter { display: contents; }

/* Kit */
.og-sb-icon { display: inline-flex; flex: none; }
.og-sb-icon svg { display: block; }
.og-sb-icon-btn {
  width: 28px; height: 28px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--og-ct-muted); cursor: pointer; transition: background-color .12s ease, color .12s ease;
}
.og-sb-icon-btn:hover { background: var(--og-sb-hover); color: var(--og-text-color); }
.og-sb-icon-btn:focus-visible, .og-sb-btn:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: 1px; }
.og-sb-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 6px;
  border: 0; background: transparent; color: var(--og-ct-muted); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: background-color .12s ease, color .12s ease, border-color .12s ease;
}
.og-sb-btn:hover { background: var(--og-sb-hover); color: var(--og-text-color); }
.og-sb-btn[data-variant='primary'] { background: var(--og-sb-accent); color: #fff; }
.og-sb-btn[data-variant='primary']:hover { background: color-mix(in srgb, var(--og-sb-accent) 88%, #000); }
.og-sb-btn[data-variant='subtle'] { border: 1px dashed var(--og-ct-control-border); color: var(--og-text-color); }
.og-sb-btn[data-variant='subtle']:hover { border-color: var(--og-sb-accent); color: var(--og-sb-accent); background: color-mix(in srgb, var(--og-sb-accent) 6%, transparent); }
.og-sb-btn[hidden] { display: none; }
.og-sb-stack { display: flex; flex-direction: column; gap: 10px; }
.og-sb-hint { font-size: 12px; line-height: 1.45; color: var(--og-ct-muted); padding: 0 2px; }
.og-sb-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 28px 12px 18px; }
.og-sb-empty-icon {
  width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; margin-bottom: 4px;
  background: var(--og-sb-soft); color: var(--og-ct-muted); box-shadow: inset 0 0 0 1px var(--og-sb-line);
}
.og-sb-empty-title { font-size: 13.5px; font-weight: 600; }
.og-sb-empty-hint { font-size: 12.5px; line-height: 1.5; color: var(--og-ct-muted); max-width: 230px; }
.og-sb-search {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border-radius: 8px; cursor: text;
  background: var(--og-popover-input-bg, var(--og-sb-soft)); box-shadow: inset 0 0 0 1px var(--og-popover-input-border, var(--og-sb-line));
  color: var(--og-ct-muted); transition: box-shadow .12s ease;
}
.og-sb-search:focus-within { box-shadow: inset 0 0 0 1px var(--og-sb-accent), 0 0 0 3px color-mix(in srgb, var(--og-sb-accent) 20%, transparent); }
.og-sb-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--og-text-color); font: inherit; font-size: 13px; }
.og-sb-search input::placeholder { color: var(--og-ct-subtle); }
.og-sb-search input::-webkit-search-cancel-button { display: none; }
.og-sb-seg { display: flex; padding: 2px; gap: 2px; border-radius: 7px; background: var(--og-sb-soft); box-shadow: inset 0 0 0 1px var(--og-sb-line); }
.og-sb-seg-btn {
  flex: 1; height: 24px; padding: 0 8px; border: 0; border-radius: 5px; background: transparent; color: var(--og-ct-muted);
  font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; font-variant-numeric: tabular-nums;
  transition: background-color .12s ease, color .12s ease;
}
.og-sb-seg-btn:hover { color: var(--og-text-color); }
.og-sb-seg-btn[aria-checked='true'] { background: var(--og-bg-color); color: var(--og-text-color); box-shadow: 0 1px 2px rgba(0, 0, 0, .18), inset 0 0 0 1px var(--og-sb-line); }

/* Filters */
.og-sb-sections { display: flex; flex-direction: column; gap: 6px; }
.og-sb-section { border-radius: 9px; box-shadow: inset 0 0 0 1px var(--og-sb-line); transition: box-shadow .15s ease, background-color .15s ease; }
.og-sb-section[data-active] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-sb-accent) 45%, var(--og-sb-line)); background: color-mix(in srgb, var(--og-sb-accent) 4%, transparent); }
.og-sb-section-head { display: flex; align-items: center; gap: 2px; padding-right: 4px; }
.og-sb-section-toggle {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 6px 0 10px; border: 0;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 9px;
}
.og-sb-section-toggle:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: -2px; }
.og-sb-chevron { color: var(--og-ct-subtle); transition: transform .15s ease; }
.og-sb-section[data-open] .og-sb-chevron { transform: rotate(90deg); }
.og-sb-section-text { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.og-sb-section-label { flex: none; max-width: 60%; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-section[data-active] .og-sb-section-label { color: var(--og-sb-accent); }
.og-sb-section-summary { flex: 1; min-width: 0; font-size: 12px; color: var(--og-ct-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-section[data-open] .og-sb-section-summary { visibility: hidden; }
.og-sb-section-clear[hidden] { display: none; }
.og-sb-section-body { padding: 2px 10px 12px; }

/* Sort */
.og-sb-rules { display: flex; flex-direction: column; gap: 6px; }
.og-sb-rule {
  position: relative; display: flex; flex-direction: column; gap: 8px; padding: 8px 8px 10px; border-radius: 9px;
  background: var(--og-sb-soft); box-shadow: inset 0 0 0 1px var(--og-sb-line); transition: opacity .12s ease, box-shadow .12s ease;
}
.og-sb-rule[data-dragging] { opacity: .45; }
.og-sb-rule[data-drop='before']::before, .og-sb-rule[data-drop='after']::after {
  content: ''; position: absolute; left: 6px; right: 6px; height: 2px; border-radius: 2px; background: var(--og-sb-accent);
}
.og-sb-rule[data-drop='before']::before { top: -4px; }
.og-sb-rule[data-drop='after']::after { bottom: -4px; }
.og-sb-rule-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.og-sb-grip {
  width: 20px; height: 26px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--og-ct-subtle); cursor: grab;
}
.og-sb-grip:hover { color: var(--og-text-color); background: var(--og-sb-hover); }
.og-sb-grip:focus-visible { outline: 2px solid var(--og-sb-accent); }
.og-sb-rule-order {
  width: 20px; height: 20px; flex: none; display: grid; place-items: center; border-radius: 6px; font-size: 11px; font-weight: 700;
  background: color-mix(in srgb, var(--og-sb-accent) 16%, transparent); color: var(--og-sb-accent); font-variant-numeric: tabular-nums;
}
.og-sb-rule-name { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-rule .og-sb-seg { margin-left: 26px; }
.og-sb-add { width: 100%; height: 34px; }

/* Themes */
.og-sb-themes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.og-sb-theme {
  position: relative; display: flex; flex-direction: column; gap: 8px; padding: 6px 6px 8px; border: 0; border-radius: 10px;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--og-sb-line); transition: box-shadow .15s ease, transform .15s ease;
}
.og-sb-theme:hover { box-shadow: inset 0 0 0 1px var(--og-ct-control-border); }
.og-sb-theme:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: 1px; }
.og-sb-theme[aria-checked='true'] { box-shadow: inset 0 0 0 2px var(--og-sb-accent); }
.og-sb-theme-preview { height: 62px; border-radius: 6px; overflow: hidden; border: 1px solid; display: flex; flex-direction: column; }
.og-sb-theme-header, .og-sb-theme-row { display: flex; align-items: center; gap: 4px; padding: 0 6px; border-bottom: 1px solid; flex: 1; }
.og-sb-theme-header > span, .og-sb-theme-row > span:not(.og-sb-theme-pill) { height: 3px; border-radius: 2px; opacity: .55; }
.og-sb-theme-header > span { opacity: .7; }
.og-sb-theme-row:last-child { border-bottom: 0; }
.og-sb-theme-pill { width: 10px; height: 5px; border-radius: 3px; margin-left: auto; }
.og-sb-theme-caption { display: flex; flex-direction: column; gap: 1px; padding: 0 2px; }
.og-sb-theme-name { font-size: 12.5px; font-weight: 600; }
.og-sb-theme-mode { font-size: 11px; color: var(--og-ct-muted); }
.og-sb-theme-check {
  position: absolute; top: 10px; right: 10px; width: 18px; height: 18px; border-radius: 999px; display: none; place-items: center;
  background: var(--og-sb-accent); color: #fff; box-shadow: 0 0 0 2px var(--og-bg-color);
}
.og-sb-theme[aria-checked='true'] .og-sb-theme-check { display: grid; }

@media (prefers-reduced-motion: reduce) {
  .og-sb-panel, .og-sb-chevron, .og-sb-tab, .og-sb-theme { transition: none; }
}
`;
