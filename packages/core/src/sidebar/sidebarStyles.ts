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
  background: var(--og-glass-header-bg, var(--og-header-bg)); border-left: 1px solid var(--og-sb-line);
  backdrop-filter: var(--og-glass-backdrop-filter, none); -webkit-backdrop-filter: var(--og-glass-backdrop-filter, none);
}
.og-sb[data-position='left'] .og-sb-rail { border-left: 0; border-right: 1px solid var(--og-sb-line); }
.og-sb-tab {
  position: relative; width: 34px; height: 34px; flex: none; display: grid; place-items: center; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: var(--og-header-text); cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
}
/* Every rail icon at the built-ins' 18px, so a custom panel's icon (any SVG markup) matches. */
.og-sb-tab > svg { width: 18px; height: 18px; flex: none; }
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
  background: var(--og-sb-accent); color: var(--og-ct-on-accent); box-shadow: 0 0 0 2px var(--og-header-bg); font-variant-numeric: tabular-nums;
}
.og-sb-tab[data-badged] .og-sb-badge { display: inline-flex; }

/* Panel */
.og-sb-panel {
  width: 0; flex: none; overflow: hidden; background: var(--og-glass-popover-bg, var(--og-bg-color));
  backdrop-filter: var(--og-glass-backdrop-filter, none); -webkit-backdrop-filter: var(--og-glass-backdrop-filter, none);
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
.og-sb-btn[data-variant='primary'] { background: var(--og-sb-accent); color: var(--og-ct-on-accent); }
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
  background: var(--og-sb-accent); color: var(--og-ct-on-accent); box-shadow: 0 0 0 2px var(--og-bg-color);
}
.og-sb-theme[aria-checked='true'] .og-sb-theme-check { display: grid; }

/* Columns */
.og-sb-groups { display: flex; flex-direction: column; gap: 8px; padding-bottom: 4px; }
.og-sb-groups-head { display: flex; align-items: center; gap: 6px; color: var(--og-ct-muted); min-height: 28px; }
.og-sb-groups-title { flex: 1; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.og-sb-groups-tools { display: flex; gap: 2px; }
.og-sb-dropzone {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 40px; padding: 6px; border-radius: 9px;
  border: 1px dashed var(--og-ct-control-border); transition: border-color .12s ease, background-color .12s ease;
}
.og-sb-dropzone[data-empty] { justify-content: center; }
.og-sb-dropzone[data-over] { border-color: var(--og-sb-accent); background: color-mix(in srgb, var(--og-sb-accent) 8%, transparent); }
.og-sb-dropzone-hint { font-size: 12px; color: var(--og-ct-subtle); text-align: center; padding: 2px 6px; }
.og-sb-pill {
  display: inline-flex; align-items: center; gap: 2px; height: 26px; padding: 0 2px 0 9px; border-radius: 7px; cursor: grab;
  background: color-mix(in srgb, var(--og-sb-accent) 14%, transparent); color: color-mix(in srgb, var(--og-sb-accent) 80%, var(--og-text-color));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-sb-accent) 30%, transparent); font-size: 12.5px; font-weight: 500;
}
.og-sb-pill .og-sb-icon-btn { width: 20px; height: 20px; color: inherit; }
.og-sb-pill-sep { color: var(--og-ct-subtle); font-size: 13px; }
.og-sb-group-options { display: flex; flex-direction: column; border-radius: 9px; box-shadow: inset 0 0 0 1px var(--og-sb-line); }
.og-sb-switch-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 38px; padding: 0 10px; border: 0;
  background: transparent; color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; text-align: left;
}
.og-sb-switch-row + .og-sb-switch-row { border-top: 1px solid var(--og-sb-line); }
.og-sb-switch-row:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: -2px; border-radius: 9px; }
.og-sb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.og-sb-seg-sm .og-sb-seg-btn { height: 22px; font-size: 11.5px; padding: 0 7px; }
.og-sb-lanes { display: flex; flex-direction: column; gap: 10px; }
.og-sb-lane-title { display: flex; align-items: center; gap: 5px; padding: 0 4px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--og-ct-muted); }
.og-sb-col-list { display: flex; flex-direction: column; }
.og-sb-col {
  position: relative; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 4px 0 2px; border-radius: 7px;
  transition: background-color .1s ease, opacity .1s ease;
}
.og-sb-col:hover { background: var(--og-sb-hover); }
.og-sb-col[data-dragging] { opacity: .4; }
.og-sb-col[data-drop='before']::before, .og-sb-col[data-drop='after']::after {
  content: ''; position: absolute; left: 4px; right: 4px; height: 2px; border-radius: 2px; background: var(--og-sb-accent);
}
.og-sb-col[data-drop='before']::before { top: -1px; }
.og-sb-col[data-drop='after']::after { bottom: -1px; }
.og-sb-col-grip { display: grid; place-items: center; width: 16px; color: var(--og-ct-subtle); cursor: grab; opacity: 0; transition: opacity .1s ease; }
.og-sb-col:hover .og-sb-col-grip { opacity: 1; }
.og-sb-col-grip[data-disabled] { visibility: hidden; }
.og-sb-checkbox { border: 0; padding: 0; }
.og-sb-checkbox:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: 2px; }
.og-sb-col-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-col[data-hidden] .og-sb-col-name { color: var(--og-ct-muted); }
.og-sb-col-tools { display: flex; gap: 1px; }
.og-sb-col-tools .og-sb-icon-btn { width: 26px; height: 26px; opacity: 0; }
.og-sb-col:hover .og-sb-col-tools .og-sb-icon-btn, .og-sb-col-tools .og-sb-icon-btn:focus-visible { opacity: 1; }
.og-sb-col-tools .og-sb-icon-btn[data-on] { opacity: 1; color: var(--og-sb-accent); }
.og-sb-menu { display: flex; flex-direction: column; padding: 4px; min-width: 160px; }
.og-sb-menu-item {
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent;
  color: var(--og-text-color); font: inherit; font-size: 13px; cursor: pointer; text-align: left;
}
.og-sb-menu-item > span:not(.og-sb-icon) { flex: 1; }
.og-sb-menu-item:hover, .og-sb-menu-item:focus-visible { background: var(--og-sb-hover); outline: 0; }
.og-sb-menu-item .og-sb-icon { color: var(--og-ct-muted); }
.og-sb-menu-item .og-sb-menu-check { color: var(--og-sb-accent); }

/* Query */
.og-sb-query { display: flex; flex-direction: column; gap: 12px; min-height: 100%; }
.og-sb-qgroup { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--og-sb-line); }
.og-sb-qgroup-root { padding: 0; box-shadow: none; }
.og-sb-qgroup:not(.og-sb-qgroup-root) { background: var(--og-sb-soft); border-left: 2px solid color-mix(in srgb, var(--og-sb-accent) 55%, transparent); border-radius: 4px 10px 10px 4px; }
.og-sb-qgroup-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; color: var(--og-ct-muted); }
.og-sb-qgroup-head .og-sb-icon-btn { margin-left: auto; }
.og-sb-qgroup-head .og-sb-seg-btn { min-width: 40px; }
.og-sb-qgroup-body { display: flex; flex-direction: column; }
.og-sb-qjoin {
  align-self: flex-start; margin: 4px 0 4px 12px; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600;
  letter-spacing: .05em; text-transform: uppercase; color: var(--og-sb-accent); background: color-mix(in srgb, var(--og-sb-accent) 12%, transparent);
}
.og-sb-qcond { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 9px; background: var(--og-bg-color); box-shadow: inset 0 0 0 1px var(--og-sb-line); }
.og-sb-qcond-head { display: flex; align-items: center; gap: 4px; }
.og-sb-select {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px 0 10px; border: 0; border-radius: 7px;
  background: var(--og-popover-input-bg, var(--og-sb-soft)); box-shadow: inset 0 0 0 1px var(--og-popover-input-border, var(--og-sb-line));
  color: var(--og-text-color); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; text-align: left;
}
.og-sb-select:hover { box-shadow: inset 0 0 0 1px var(--og-ct-control-border); }
.og-sb-select:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: 1px; }
.og-sb-select .og-sb-icon { color: var(--og-ct-muted); transform: rotate(90deg); }
.og-sb-select-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-qcond-body { padding: 0 2px 2px; }
.og-sb-qgroup-add { display: flex; gap: 4px; }
.og-sb-qgroup-add .og-sb-btn { height: 26px; padding: 0 8px; font-size: 12px; }
.og-sb-warn { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 7px; font-size: 12px; line-height: 1.45; color: var(--og-ct-danger); background: color-mix(in srgb, var(--og-ct-danger) 10%, transparent); }
.og-sb-footer {
  position: sticky; bottom: -12px; margin: auto -12px -12px; display: flex; align-items: center; gap: 6px; padding: 10px 12px;
  background: var(--og-bg-color); border-top: 1px solid var(--og-sb-line);
}
.og-sb-footer[hidden] { display: none; }
.og-sb-footer-status { flex: 1; min-width: 0; font-size: 12px; color: var(--og-ct-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-footer-status[data-dirty] { color: var(--og-text-color); }
.og-sb-btn:disabled { opacity: .45; cursor: default; pointer-events: none; }

/* Views */
.og-sb-views { gap: 12px; }
.og-sb-current {
  display: flex; flex-direction: column; gap: 12px; padding: 12px; border-radius: 11px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--og-sb-accent) 9%, transparent), color-mix(in srgb, var(--og-sb-accent) 3%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-sb-accent) 24%, var(--og-sb-line));
}
.og-sb-current-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.og-sb-current-icon { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 9px; background: color-mix(in srgb, var(--og-sb-accent) 18%, transparent); color: var(--og-sb-accent); }
.og-sb-current-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.og-sb-current-kicker { font-size: 11px; color: var(--og-ct-muted); }
.og-sb-current-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-status-pill { flex: none; height: 20px; padding: 0 8px; border-radius: 999px; display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; background: var(--og-sb-hover); color: var(--og-ct-muted); }
.og-sb-status-pill[data-dirty] { background: color-mix(in srgb, #f59e0b 18%, transparent); color: color-mix(in srgb, #f59e0b 80%, var(--og-text-color)); }
.og-sb-current-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.og-sb-current-actions .og-sb-btn[data-variant='subtle'] { flex: 1; }
.og-sb-name-field { display: flex; align-items: center; gap: 6px; margin: 0; }
.og-sb-input {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px; border: 0; border-radius: 7px; outline: 0; font: inherit; font-size: 13px;
  background: var(--og-popover-input-bg, var(--og-bg-color)); color: var(--og-text-color);
  box-shadow: inset 0 0 0 1px var(--og-popover-input-border, var(--og-sb-line));
}
.og-sb-input:focus { box-shadow: inset 0 0 0 1px var(--og-sb-accent), 0 0 0 3px color-mix(in srgb, var(--og-sb-accent) 20%, transparent); }
.og-sb-warn[hidden] { display: none; }
.og-sb-list-head { display: flex; align-items: center; gap: 6px; padding: 4px 2px 0; }
.og-sb-list-title { font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--og-ct-muted); }
.og-sb-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 10.5px; font-weight: 600; background: var(--og-sb-hover); color: var(--og-ct-muted); }
.og-sb-search[hidden] { display: none; }
.og-sb-views-list { display: flex; flex-direction: column; gap: 2px; }
.og-sb-views-list .og-sb-name-field { padding: 4px; }
.og-sb-view { display: flex; align-items: center; border-radius: 8px; transition: background-color .1s ease; }
.og-sb-view:hover { background: var(--og-sb-hover); }
.og-sb-view[data-active] { background: color-mix(in srgb, var(--og-sb-accent) 9%, transparent); }
.og-sb-view-main {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 4px 8px 8px; border: 0; border-radius: 8px;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.og-sb-view-main:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: -2px; }
.og-sb-view-mark {
  width: 18px; height: 18px; flex: none; display: grid; place-items: center; border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px var(--og-ct-control-border); color: var(--og-ct-on-accent);
}
.og-sb-view[data-active] .og-sb-view-mark { background: var(--og-sb-accent); box-shadow: none; }
.og-sb-view-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.og-sb-view-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-view[data-active] .og-sb-view-name { color: var(--og-sb-accent); }
.og-sb-view-meta { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--og-ct-muted); white-space: nowrap; overflow: hidden; }
.og-sb-view-default { display: inline-flex; align-items: center; gap: 3px; color: var(--og-ct-rating); font-weight: 500; }
.og-sb-view-default svg { fill: currentColor; }
.og-sb-view-scope { padding: 0 5px; border-radius: 4px; font-size: 10.5px; font-weight: 600; background: var(--og-sb-hover); }
.og-sb-view-more { opacity: 0; margin-right: 4px; }
.og-sb-view:hover .og-sb-view-more, .og-sb-view-more:focus-visible { opacity: 1; }
.og-sb-menu-sep { height: 1px; margin: 4px 2px; background: var(--og-sb-line); }
.og-sb-menu-item[data-danger], .og-sb-menu-item[data-danger] .og-sb-icon { color: var(--og-ct-danger); }
.og-sb-views-footer { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--og-sb-line); }
.og-sb-views-footer[hidden] { display: none; }
.og-sb-save-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.og-sb-save-status { font-size: 12px; color: var(--og-ct-muted); }
.og-sb-save-status[data-error] { color: var(--og-ct-danger); }
.og-sb-btn[data-danger] { color: var(--og-ct-danger); }

/* Data integrity */
.og-sb-health {
  --og-sb-tone: #22c55e;
  display: flex; flex-direction: column; gap: 12px; padding: 12px; border-radius: 11px;
  background: color-mix(in srgb, var(--og-sb-tone) 8%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-sb-tone) 28%, var(--og-sb-line));
}
.og-sb-health[data-status='warning'] { --og-sb-tone: #f59e0b; }
.og-sb-health[data-status='blocked'] { --og-sb-tone: var(--og-ct-danger); }
.og-sb-health[data-status='checking'] { --og-sb-tone: var(--og-sb-accent); }
.og-sb-health-top { display: flex; align-items: center; gap: 10px; }
.og-sb-health-icon { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 9px; background: color-mix(in srgb, var(--og-sb-tone) 20%, transparent); color: var(--og-sb-tone); }
.og-sb-health[data-status='checking'] .og-sb-health-icon svg { animation: og-sb-spin 1s linear infinite; }
@keyframes og-sb-spin { to { transform: rotate(360deg); } }
.og-sb-health-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.og-sb-health-label { font-size: 14px; font-weight: 600; }
.og-sb-health-hint { font-size: 12px; color: var(--og-ct-muted); }
.og-sb-health-counts, .og-sb-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.og-sb-health-count, .og-sb-stat { display: flex; flex-direction: column; gap: 1px; padding: 7px 9px; border-radius: 8px; background: var(--og-bg-color); box-shadow: inset 0 0 0 1px var(--og-sb-line); }
.og-sb-stat-value { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; }
.og-sb-stat-label { font-size: 11px; color: var(--og-ct-muted); }
.og-sb-health-count[data-kind='error']:not([data-zero]) .og-sb-stat-value, .og-sb-health-count[data-kind='blocking']:not([data-zero]) .og-sb-stat-value, .og-sb-stat[data-kind='removed'] .og-sb-stat-value { color: var(--og-ct-danger); }
.og-sb-health-count[data-kind='warning']:not([data-zero]) .og-sb-stat-value, .og-sb-stat[data-kind='changed'] .og-sb-stat-value { color: #f59e0b; }
.og-sb-stat[data-kind='added'] .og-sb-stat-value { color: #22c55e; }
.og-sb-health-count[data-zero] .og-sb-stat-value { color: var(--og-ct-subtle); }
.og-sb-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--og-sb-line); }
.og-sb-tabs-btn {
  position: relative; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border: 0; background: transparent;
  color: var(--og-ct-muted); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
}
.og-sb-tabs-btn:hover { color: var(--og-text-color); }
.og-sb-tabs-btn[aria-selected='true'] { color: var(--og-text-color); }
.og-sb-tabs-btn[aria-selected='true']::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--og-sb-accent); }
.og-sb-tabs-btn:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: -2px; border-radius: 6px; }
.og-sb-issues { display: flex; flex-direction: column; gap: 2px; }
.og-sb-issue {
  display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 0; border-radius: 8px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.og-sb-issue:hover:not(:disabled) { background: var(--og-sb-hover); }
.og-sb-issue:disabled { cursor: default; }
.og-sb-issue:focus-visible { outline: 2px solid var(--og-sb-accent); outline-offset: -2px; }
.og-sb-issue-dot { width: 8px; height: 8px; margin-top: 5px; flex: none; border-radius: 999px; background: var(--og-ct-muted); }
.og-sb-issue[data-severity='error'] .og-sb-issue-dot { background: var(--og-ct-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-ct-danger) 18%, transparent); }
.og-sb-issue[data-severity='warning'] .og-sb-issue-dot { background: #f59e0b; box-shadow: 0 0 0 3px color-mix(in srgb, #f59e0b 18%, transparent); }
.og-sb-issue-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.og-sb-issue-message { font-size: 12.5px; line-height: 1.4; }
.og-sb-issue-meta { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--og-ct-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-tag { flex: none; padding: 0 5px; border-radius: 4px; font-size: 10.5px; font-weight: 600; background: var(--og-sb-hover); color: var(--og-ct-muted); text-transform: capitalize; }
.og-sb-issue-meta .og-sb-tag { background: color-mix(in srgb, var(--og-ct-danger) 14%, transparent); color: var(--og-ct-danger); }
.og-sb-diff { display: flex; align-items: center; gap: 4px; border-radius: 8px; }
.og-sb-diff:hover { background: var(--og-sb-hover); }
.og-sb-diff-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 7px 8px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.og-sb-diff-values { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.og-sb-diff-values del, .og-sb-diff-values ins { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; border-radius: 4px; }
.og-sb-diff-values del { color: var(--og-ct-danger); background: color-mix(in srgb, var(--og-ct-danger) 10%, transparent); }
.og-sb-diff-values ins { color: #22c55e; background: color-mix(in srgb, #22c55e 10%, transparent); text-decoration: none; }
.og-sb-diff-values .og-sb-icon { color: var(--og-ct-subtle); }
.og-sb-conflict { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--og-sb-line); }
.og-sb-conflict-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.og-sb-conflict-where { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-conflict-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.og-sb-conflict-side { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; background: var(--og-sb-soft); min-width: 0; }
.og-sb-conflict-label { font-size: 11px; color: var(--og-ct-muted); }
.og-sb-conflict-value { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-sb-conflict-side .og-sb-btn { height: 26px; font-size: 12px; }

@media (prefers-reduced-motion: reduce) {
  .og-sb-panel, .og-sb-chevron, .og-sb-tab, .og-sb-theme { transition: none; }
  .og-sb-health[data-status='checking'] .og-sb-health-icon svg { animation: none; }
}
`;
