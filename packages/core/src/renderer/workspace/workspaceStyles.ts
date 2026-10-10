/**
 * The workspace stylesheet. Injected once per document when a workspace first mounts (grids that
 * stay tables never parse it). Every colour derives from the grid's theme tokens, so the workspace
 * follows the grid's theme — light, dark, glass, custom.
 */
const WORKSPACE_STYLES = `
.og-ws {
  --og-ws-bg: var(--og-bg-color);
  --og-ws-text: var(--og-text-color);
  --og-ws-surface: color-mix(in srgb, var(--og-text-color) 3%, var(--og-bg-color));
  --og-ws-surface-2: color-mix(in srgb, var(--og-text-color) 5.5%, var(--og-bg-color));
  --og-ws-raised: color-mix(in srgb, var(--og-text-color) 4.5%, var(--og-bg-color));
  --og-ws-hover: color-mix(in srgb, var(--og-text-color) 7%, transparent);
  --og-ws-line: color-mix(in srgb, var(--og-text-color) 10%, var(--og-bg-color));
  --og-ws-line-strong: color-mix(in srgb, var(--og-text-color) 17%, var(--og-bg-color));
  --og-ws-muted: color-mix(in srgb, var(--og-text-color) 62%, transparent);
  --og-ws-faint: color-mix(in srgb, var(--og-text-color) 42%, transparent);
  --og-ws-accent: var(--og-focus-ring);
  --og-ws-accent-soft: color-mix(in srgb, var(--og-focus-ring) 16%, transparent);
  --og-ws-on-accent: var(--og-accent-contrast, #fff);
  --og-ws-danger: #ef4444;
  --og-ws-warn: #f59e0b;
  --og-ws-ok: #22c55e;
  --og-ws-radius: 10px;
  --og-ws-radius-sm: 7px;
  --og-ws-shadow: 0 1px 2px rgb(0 0 0 / .08), 0 10px 28px -14px rgb(0 0 0 / .45);
  --og-ws-shadow-lg: 0 24px 64px -16px rgb(0 0 0 / .55), 0 2px 6px rgb(0 0 0 / .12);
  --og-ws-inspector-width: 368px;
  position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; width: 100%;
  background: var(--og-ws-bg); color: var(--og-ws-text);
  font-family: var(--og-font-family, inherit); font-size: 13px; line-height: 1.35;
  -webkit-font-smoothing: antialiased;
}
.og-ws[hidden], .og-ws [hidden] { display: none !important; }
.og-layer-view.og-ws { position: absolute; inset: 0; z-index: 35; }
.og-ws *, .og-ws *::before, .og-ws *::after { box-sizing: border-box; }
.og-ws-icon { display: inline-grid; place-items: center; flex: none; line-height: 0; }
.og-ws-spacer { flex: 1 1 auto; min-width: 4px; }
.og-ws-hint { color: var(--og-ws-muted); font-size: 12px; }
.og-ws-kbd { font: 500 10.5px/1 var(--og-font-family, inherit); color: var(--og-ws-faint); border: 1px solid var(--og-ws-line-strong); border-bottom-width: 2px; border-radius: 5px; padding: 3px 5px; background: var(--og-ws-surface); }
.og-ws-group { display: inline-flex; align-items: center; gap: 4px; }
.og-ws-dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; background: var(--og-ws-hue, var(--og-ws-accent)); flex: none; }
.og-ws-dot-lg { width: 10px; height: 10px; }

/* Buttons */
.og-ws-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: var(--og-ws-radius-sm);
  border: 1px solid var(--og-ws-line); background: var(--og-ws-surface); color: var(--og-ws-text);
  font: 500 12.5px/1 var(--og-font-family, inherit); cursor: pointer; white-space: nowrap; flex: none;
  transition: background-color .12s ease, border-color .12s ease, color .12s ease;
}
.og-ws-btn:hover:not(:disabled) { background: var(--og-ws-surface-2); border-color: var(--og-ws-line-strong); }
.og-ws-btn:disabled { opacity: .45; cursor: default; }
.og-ws-btn:focus-visible, .og-ws-tab:focus-visible, .og-ws-chip:focus-visible, .og-ws-list-item:focus-visible { outline: 2px solid var(--og-ws-accent); outline-offset: 1px; }
.og-ws-btn-icon { width: 30px; padding: 0; justify-content: center; border-color: transparent; background: transparent; color: var(--og-ws-muted); }
.og-ws-btn-icon:hover:not(:disabled) { color: var(--og-ws-text); background: var(--og-ws-hover); border-color: transparent; }
.og-ws-btn[aria-pressed='true'], .og-ws-btn[data-active] { border-color: color-mix(in srgb, var(--og-ws-accent) 45%, transparent); background: var(--og-ws-accent-soft); color: var(--og-ws-text); }
.og-ws-btn-icon[aria-pressed='true'] { color: var(--og-ws-accent); }
.og-ws-btn-primary { background: var(--og-ws-accent); border-color: var(--og-ws-accent); color: var(--og-ws-on-accent); }
.og-ws-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--og-ws-accent) 88%, #fff); border-color: transparent; }
.og-ws-btn-quiet { border-color: transparent; background: transparent; color: var(--og-ws-muted); height: 26px; }
.og-ws-btn.og-ws-danger { color: var(--og-ws-danger); }
.og-ws-badge { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; background: var(--og-ws-accent); color: var(--og-ws-on-accent); font-size: 10.5px; font-weight: 600; }
.og-ws-badge-quiet { background: var(--og-ws-surface-2); color: var(--og-ws-muted); border: 1px solid var(--og-ws-line); }

/* Command bar */
.og-ws-bar { container: og-ws-bar / inline-size; flex: none; display: flex; flex-direction: column; border-bottom: 1px solid var(--og-ws-line); background: var(--og-glass-header-bg, var(--og-ws-bg)); backdrop-filter: var(--og-glass-backdrop-filter, none); position: relative; z-index: 3; }
.og-ws-bar-row { display: flex; align-items: center; gap: 8px; padding: 8px 14px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.og-ws-bar-row::-webkit-scrollbar { display: none; }
.og-ws-bar-top { padding-top: 10px; padding-bottom: 6px; }
.og-ws-bar-sub { padding-top: 4px; padding-bottom: 8px; flex-wrap: wrap; row-gap: 6px; overflow: visible; }
.og-ws-view-tools { flex-wrap: wrap; row-gap: 6px; }
@container og-ws-bar (max-width: 1180px) { .og-ws-toggle .og-ws-btn-label, .og-ws-bar-sub .og-ws-group:last-child .og-ws-btn-label { display: none; } .og-ws-toggle, .og-ws-bar-sub .og-ws-group:last-child .og-ws-btn { padding: 0 8px; } }
@container og-ws-bar (max-width: 760px) { .og-ws-tab span:not(.og-ws-icon) { display: none; } .og-ws-title { display: none; } .og-ws-search { width: 150px; } }
.og-ws-title { font-size: 15px; font-weight: 650; letter-spacing: -.02em; white-space: nowrap; margin-right: 6px; }
.og-ws-tabs { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--og-ws-line); border-radius: 9px; background: var(--og-ws-surface); flex: none; }
.og-ws-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 6px; border: 0; background: transparent; color: var(--og-ws-muted); font: 500 12.5px/1 var(--og-font-family, inherit); cursor: pointer; white-space: nowrap; }
.og-ws-tab:hover { color: var(--og-ws-text); background: var(--og-ws-hover); }
.og-ws-tab[aria-selected='true'] { color: var(--og-ws-text); background: var(--og-ws-surface-2); box-shadow: inset 0 0 0 1px var(--og-ws-line-strong), 0 1px 2px rgb(0 0 0 / .15); }
.og-ws-tab[aria-selected='true'] .og-ws-icon { color: var(--og-ws-accent); }
.og-ws-search { display: flex; align-items: center; gap: 8px; height: 32px; width: clamp(160px, 24vw, 300px); padding: 0 8px 0 10px; border: 1px solid var(--og-ws-line); border-radius: 8px; background: var(--og-ws-surface); color: var(--og-ws-muted); flex: none; cursor: text; }
.og-ws-search:focus-within { border-color: color-mix(in srgb, var(--og-ws-accent) 60%, transparent); box-shadow: 0 0 0 3px var(--og-ws-accent-soft); }
.og-ws-search-input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--og-ws-text); font: inherit; }
.og-ws-search-input::-webkit-search-cancel-button { display: none; }
.og-ws-peers { display: inline-flex; align-items: center; padding-left: 4px; }
.og-ws-peer { width: 26px; height: 26px; margin-left: -6px; border-radius: 99px; display: grid; place-items: center; font-size: 10px; font-weight: 700; color: #fff; background: var(--og-ws-hue); box-shadow: 0 0 0 2px var(--og-ws-bg); }
.og-ws-peer-more { background: var(--og-ws-surface-2); color: var(--og-ws-muted); }
.og-ws-count { color: var(--og-ws-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.og-ws-view-tools { display: flex; align-items: center; gap: 6px; min-width: 0; }
.og-ws-summary { display: flex; gap: 8px; padding: 0 14px 10px; overflow-x: auto; scrollbar-width: none; }
.og-ws-metric { min-width: 128px; padding: 8px 12px; border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); background: var(--og-ws-surface); display: flex; flex-direction: column; gap: 3px; flex: none; }
.og-ws-metric-label { font-size: 11px; color: var(--og-ws-muted); white-space: nowrap; }
.og-ws-metric-value { display: inline-flex; align-items: center; gap: 7px; font-size: 16px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.og-ws-meter { height: 5px; border-radius: 99px; background: var(--og-ws-surface-2); overflow: hidden; margin-top: 2px; }
.og-ws-meter-fill { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--og-ws-accent), color-mix(in srgb, var(--og-ws-ok) 80%, var(--og-ws-accent))); }

/* Stage */
.og-ws-main { flex: 1 1 auto; display: flex; min-height: 0; min-width: 0; position: relative; }
.og-ws-stage { flex: 1 1 auto; position: relative; min-width: 0; min-height: 0; display: flex; }
.og-ws-stage > :not(.og-ws-surface) { flex: 1 1 auto; min-width: 0; min-height: 0; }
.og-ws-table-hidden { visibility: hidden; }
.og-ws-surface { position: absolute; inset: 0; display: flex; min-width: 0; min-height: 0; background: var(--og-ws-bg); }
.og-ws-view { position: relative; flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.og-ws-loading { margin: auto; display: flex; align-items: center; gap: 10px; color: var(--og-ws-muted); }
.og-ws-spinner { width: 16px; height: 16px; border-radius: 99px; border: 2px solid var(--og-ws-line-strong); border-top-color: var(--og-ws-accent); animation: og-ws-spin .8s linear infinite; }
@keyframes og-ws-spin { to { transform: rotate(360deg); } }
.og-ws-empty { margin: auto; padding: 32px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--og-ws-muted); max-width: 420px; }
.og-ws-view > .og-ws-empty { position: absolute; inset: 0; pointer-events: none; justify-content: center; }
.og-ws-view > .og-ws-empty .og-ws-btn { pointer-events: auto; }
.og-ws-empty-title { font-size: 15px; font-weight: 600; color: var(--og-ws-text); }

/* Pills, people, progress, counters */
.og-ws-pill { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: 6px; font-size: 11.5px; font-weight: 550; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
  color: color-mix(in srgb, var(--og-ws-hue) 62%, var(--og-ws-text)); background: color-mix(in srgb, var(--og-ws-hue) 15%, transparent); }
.og-ws-pill-outline { background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ws-hue) 45%, transparent); }
.og-ws-pill-dot { background: transparent; padding: 0; color: var(--og-ws-text); font-weight: 500; }
.og-ws-pills { display: inline-flex; gap: 5px; min-width: 0; align-items: center; }
.og-ws-more { color: var(--og-ws-muted); font-size: 11px; }
.og-ws-person { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: 12.5px; }
.og-ws-person-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-ws-person-stack .og-ws-avatar + .og-ws-avatar { margin-left: -12px; box-shadow: 0 0 0 2px var(--og-ws-raised); }
.og-ws-avatar { width: 22px; height: 22px; border-radius: 99px; display: inline-grid; place-items: center; flex: none; overflow: hidden; font-size: 9.5px; font-weight: 700; letter-spacing: .02em; color: #fff; background: var(--og-ct-hue, var(--og-ws-accent)); }
.og-ws-avatar-md { width: 28px; height: 28px; font-size: 11px; }
.og-ws-avatar-lg { width: 34px; height: 34px; font-size: 12px; }
.og-ws-avatar-more { background: var(--og-ws-surface-2); color: var(--og-ws-muted); }
.og-ws-avatars { display: inline-flex; }
.og-ws-due { display: inline-flex; align-items: center; gap: 5px; color: var(--og-ws-muted); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.og-ws-overdue { color: var(--og-ws-danger); }
.og-ws-progress { display: flex; align-items: center; gap: 8px; width: 100%; }
.og-ws-progress-track { flex: 1; height: 6px; border-radius: 99px; background: var(--og-ws-surface-2); overflow: hidden; }
.og-ws-progress-fill { display: block; height: 100%; border-radius: inherit; background: var(--og-ws-accent); transition: width .3s ease; }
.og-ws-progress-label { min-width: 34px; text-align: right; color: var(--og-ws-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.og-ws-counts { display: inline-flex; gap: 12px; }
.og-ws-counter { display: inline-flex; align-items: center; gap: 4px; color: var(--og-ws-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.og-ws-presence { display: inline-flex; }
.og-ws-presence-peer { width: 18px; height: 18px; margin-left: -4px; border-radius: 99px; display: grid; place-items: center; font-size: 8px; font-weight: 700; color: #fff; background: var(--og-ws-hue); box-shadow: 0 0 0 2px var(--og-ws-raised); }
.og-ws-presence-peer.og-ws-editing { animation: og-ws-breathe 1.4s ease-in-out infinite; }
@keyframes og-ws-breathe { 50% { box-shadow: 0 0 0 2px var(--og-ws-raised), 0 0 0 4px color-mix(in srgb, var(--og-ws-hue) 50%, transparent); } }
.og-ws-blocked { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border-radius: 6px; font-size: 11.5px; font-weight: 600; color: var(--og-ws-danger); background: color-mix(in srgb, var(--og-ws-danger) 14%, transparent); }
.og-ws-key { color: var(--og-ws-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; letter-spacing: .01em; white-space: nowrap; }

/* Cards (shared by board and gallery) */
.og-ws-card {
  position: absolute; left: 0; top: 0; display: flex; flex-direction: column; gap: 8px; padding: 11px 12px 10px 14px; overflow: hidden;
  border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); background: var(--og-ws-raised); box-shadow: var(--og-ws-shadow);
  cursor: pointer; outline: none; contain: layout style;
  transition: border-color .12s ease, box-shadow .15s ease, opacity .15s ease;
}
.og-ws-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--og-ws-accent); opacity: .9; }
.og-ws-card:hover { border-color: var(--og-ws-line-strong); }
.og-ws-card[data-selected] { border-color: color-mix(in srgb, var(--og-focus-ring) 70%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--og-focus-ring) 70%, transparent), var(--og-ws-shadow); background: color-mix(in srgb, var(--og-focus-ring) 7%, var(--og-ws-raised)); }
.og-ws-card[data-focused]:focus-visible, .og-ws-card:focus-visible { box-shadow: 0 0 0 2px var(--og-focus-ring), var(--og-ws-shadow); }
.og-ws-card[data-blocked]::before { background: var(--og-ws-danger); }
.og-ws-card[data-done] .og-ws-card-title { color: var(--og-ws-muted); }
.og-ws-card[data-drag-source] { opacity: .35; }
.og-ws-card-top, .og-ws-card-meta, .og-ws-card-foot { display: flex; align-items: center; gap: 8px; min-width: 0; }
.og-ws-card-value { font-size: 12px; color: var(--og-ws-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.og-ws-card-title { font-size: 13.5px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-ws-card-pills { display: flex; gap: 6px; min-width: 0; overflow: hidden; }
.og-ws-card-progress { margin-top: 1px; }
.og-ws-card-foot { margin-top: auto; min-height: 16px; }
.og-ws-card-field { display: flex; align-items: center; gap: 8px; min-height: 22px; font-size: 12px; }
.og-ws-card-field > .og-ws-hint { flex: none; width: 76px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ws-field-value { min-width: 0; flex: 1; overflow: hidden; display: flex; align-items: center; min-height: 22px; position: relative; }
.og-ws-field-empty::after { content: '—'; color: var(--og-ws-faint); }
.og-ws-landed { animation: og-ws-land .45s cubic-bezier(.2,.8,.2,1); }
@keyframes og-ws-land { from { box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-focus-ring) 60%, transparent), var(--og-ws-shadow); } }
.og-ws-drag-ghost { position: fixed !important; left: 0; top: 0; z-index: 10000; pointer-events: none; box-shadow: var(--og-ws-shadow-lg); opacity: .96; height: auto !important; max-height: 220px; font-family: var(--og-font-family, inherit); color: var(--og-text-color); --og-ws-raised: color-mix(in srgb, var(--og-text-color) 6%, var(--og-bg-color)); --og-ws-line: color-mix(in srgb, var(--og-text-color) 16%, var(--og-bg-color)); --og-ws-muted: color-mix(in srgb, var(--og-text-color) 62%, transparent); --og-ws-surface-2: color-mix(in srgb, var(--og-text-color) 8%, var(--og-bg-color)); }
.og-ws-drag-count { position: absolute; top: -8px; right: -8px; min-width: 24px; height: 24px; border-radius: 99px; display: grid; place-items: center; background: var(--og-focus-ring); color: #fff; font-weight: 700; font-size: 12px; box-shadow: 0 2px 8px rgb(0 0 0 / .4); }

/* Board */
.og-ws-board { flex: 1 1 auto; position: relative; overflow: auto; min-height: 0; overscroll-behavior: contain; }
.og-ws-board-head { position: sticky; top: 0; z-index: 4; height: 76px; background: linear-gradient(var(--og-ws-bg) 82%, transparent); }
.og-ws-col-head { position: absolute; top: 8px; height: 62px; padding: 9px 8px 8px 12px; border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); background: var(--og-ws-surface); display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.og-ws-col-head.og-ws-over { border-color: color-mix(in srgb, var(--og-ws-warn) 55%, transparent); }
.og-ws-col-head.og-ws-collapsed { padding: 8px 4px; align-items: center; }
.og-ws-col-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.og-ws-col-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; border: 0; background: none; color: inherit; font: inherit; padding: 0; cursor: pointer; }
.og-ws-col-name strong { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-ws-col-name .og-ws-dot { background: var(--og-ws-hue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-ws-hue) 25%, transparent); }
.og-ws-collapsed .og-ws-col-name strong { display: none; }
.og-ws-count-badge { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--og-ws-surface-2); color: var(--og-ws-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.og-ws-count-badge.og-ws-over { background: color-mix(in srgb, var(--og-ws-warn) 18%, transparent); color: var(--og-ws-warn); }
.og-ws-col-head .og-ws-btn-icon { width: 24px; height: 24px; }
.og-ws-col-total { font-size: 12px; color: var(--og-ws-muted); font-variant-numeric: tabular-nums; padding-left: 18px; }
.og-ws-wip { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--og-ws-line); }
.og-ws-wip-fill { display: block; height: 100%; background: var(--og-ws-hue); }
.og-ws-over .og-ws-wip-fill { background: var(--og-ws-warn); }
.og-ws-board-canvas { position: relative; }
.og-ws-lane-head { position: absolute; left: 12px; height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 8px 0 4px; border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); background: var(--og-ws-surface); }
.og-ws-lane-sticky { position: sticky; left: 12px; display: flex; align-items: center; gap: 9px; min-width: 0; padding-right: 8px; background: inherit; }
.og-ws-lane-sticky strong { font-size: 13.5px; white-space: nowrap; }
.og-ws-lane-mark { width: 26px; height: 26px; border-radius: 99px; display: grid; place-items: center; font-size: 10px; font-weight: 700; color: #fff; background: var(--og-ws-hue); flex: none; }
.og-ws-lane-total { color: var(--og-ws-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.og-ws-lane-counts { display: flex; gap: 4px; }
.og-ws-lane-count { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--og-ws-hue) 40%, transparent); color: var(--og-ws-muted); font-size: 11px; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--og-ws-hue) 8%, transparent); }
.og-ws-ring { width: 7px; height: 7px; border-radius: 99px; border: 2px solid var(--og-ws-hue); }
.og-ws-cell { position: absolute; border-radius: 12px; transition: background-color .12s ease, box-shadow .12s ease; }
.og-ws-cell[data-drop] { background: color-mix(in srgb, var(--og-focus-ring) 7%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-focus-ring) 35%, transparent); }
.og-ws-cell[data-rejected] { background: color-mix(in srgb, var(--og-ws-danger) 7%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ws-danger) 40%, transparent); }
.og-ws-cell.og-ws-collapsed { background: var(--og-ws-surface); }
.og-ws-cell-collapsed { position: absolute; inset: 6px 0; border: 0; background: none; color: var(--og-ws-muted); writing-mode: vertical-rl; font: 600 12px var(--og-font-family, inherit); cursor: pointer; }
.og-ws-cell-add { position: absolute; left: 0; right: 0; height: 30px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px dashed transparent; border-radius: 8px; background: none; color: var(--og-ws-faint); font: 500 12px var(--og-font-family, inherit); cursor: pointer; opacity: 0; transition: opacity .12s ease; }
.og-ws-cell:hover .og-ws-cell-add, .og-ws-cell-add:focus-visible { opacity: 1; border-color: var(--og-ws-line-strong); }
.og-ws-board[data-dragging] .og-ws-cell-add { display: none; }
.og-ws-drop-indicator { position: absolute; left: 0; top: 0; height: 3px; border-radius: 3px; background: var(--og-focus-ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--og-focus-ring) 25%, transparent); pointer-events: none; z-index: 2; }
.og-ws-drop-indicator::before, .og-ws-drop-indicator::after { content: ''; position: absolute; top: -3px; width: 9px; height: 9px; border-radius: 99px; background: var(--og-focus-ring); }
.og-ws-drop-indicator::before { left: -4px; } .og-ws-drop-indicator::after { right: -4px; }
.og-ws-drop-hint { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 2px dashed color-mix(in srgb, var(--og-focus-ring) 60%, transparent); border-radius: var(--og-ws-radius); color: var(--og-focus-ring); background: color-mix(in srgb, var(--og-focus-ring) 6%, transparent); pointer-events: none; font-size: 12px; z-index: 2; }
.og-ws-drop-hint span { color: var(--og-ws-muted); }
.og-ws-drop-hint.og-ws-rejected { border-color: color-mix(in srgb, var(--og-ws-danger) 60%, transparent); color: var(--og-ws-danger); background: color-mix(in srgb, var(--og-ws-danger) 6%, transparent); }
.og-ws-board[data-density='compact'] .og-ws-card { gap: 6px; padding: 9px 10px 9px 13px; }

/* Inspector */
.og-ws-inspector { flex: 0 0 var(--og-ws-inspector-width); width: var(--og-ws-inspector-width); max-width: max(280px, 48%); min-height: 0; border-left: 1px solid var(--og-ws-line); background: var(--og-glass-header-bg, var(--og-ws-bg)); overflow: auto; overscroll-behavior: contain; animation: og-ws-slide .18s cubic-bezier(.2,.8,.2,1); }
@keyframes og-ws-slide { from { transform: translateX(16px); opacity: 0; } }
.og-ws-inspector-body { container: og-ws-inspector / inline-size; padding: 14px 18px 24px; display: flex; flex-direction: column; gap: 14px; }
@container og-ws-inspector (max-width: 300px) {
  .og-ws-prop { grid-template-columns: 1fr; gap: 2px; padding: 4px 0; }
  .og-ws-prop-value { margin-left: -8px; }
}
.og-ws-inspector-head { display: flex; align-items: center; gap: 6px; }
.og-ws-inspector-title { margin: -4px 0 0; font-size: 19px; font-weight: 650; letter-spacing: -.025em; line-height: 1.3; border-radius: 6px; padding: 2px 4px; margin-left: -4px; outline: none; overflow-wrap: anywhere; }
.og-ws-inspector-title[contenteditable='true']:hover { background: var(--og-ws-hover); }
.og-ws-inspector-title:focus { box-shadow: 0 0 0 2px var(--og-ws-accent); }
.og-ws-inspector-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.og-ws-inspector-chips > .og-ws-prop-value { margin-left: 0; padding: 2px 4px; min-height: 30px; }
.og-ws-inspector-chips > .og-ws-prop-value[role='button']::after { content: ''; width: 6px; height: 6px; margin: -3px 4px 0 6px; border-right: 1.5px solid var(--og-ws-muted); border-bottom: 1.5px solid var(--og-ws-muted); transform: rotate(45deg); flex: none; }
.og-ws-props { display: flex; flex-direction: column; gap: 2px; }
.og-ws-prop { display: grid; grid-template-columns: 118px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 34px; }
.og-ws-prop-label { display: inline-flex; align-items: center; gap: 8px; color: var(--og-ws-muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; }
.og-ws-prop-label .og-ws-icon:last-child:not(:first-child) { opacity: .6; }
.og-ws-prop-value { position: relative; min-height: 30px; display: flex; align-items: center; padding: 2px 8px; margin-left: -8px; border-radius: 7px; min-width: 0; cursor: default; }
.og-ws-prop-value[role='button'] { cursor: pointer; }
.og-ws-prop-value[role='button']:hover { background: var(--og-ws-hover); }
.og-ws-prop-value:focus-visible { outline: 2px solid var(--og-ws-accent); }
.og-ws-prop-value[data-editing] { background: var(--og-ws-surface); box-shadow: inset 0 0 0 1px var(--og-ws-accent); flex-direction: column; align-items: stretch; }
.og-ws-prop-block { align-items: flex-start; padding: 8px; line-height: 1.55; color: color-mix(in srgb, var(--og-ws-text) 88%, transparent); }
.og-ws-prop-block .og-ws-field-value { white-space: normal; display: block; }
.og-ws-prop-block .og-ct-longtext { white-space: pre-line; display: block; -webkit-line-clamp: unset; overflow: visible; }
.og-ws-editor { position: relative; width: 100%; min-height: 28px; }
.og-ws-editor-error { color: var(--og-ws-danger); font-size: 11.5px; }
.og-ws-editor-error:empty { display: none; }
.og-ws-input { width: 100%; min-height: 30px; padding: 5px 9px; border: 1px solid var(--og-ws-line-strong); border-radius: 7px; background: var(--og-ws-bg); color: var(--og-ws-text); font: inherit; outline: none; resize: vertical; }
.og-ws-input:focus { border-color: var(--og-ws-accent); box-shadow: 0 0 0 3px var(--og-ws-accent-soft); }
.og-ws-inspector-section h3 { margin: 4px 0 6px; font-size: 12.5px; font-weight: 600; color: var(--og-ws-muted); }
.og-ws-dep-list { display: flex; flex-wrap: wrap; gap: 6px; }
.og-ws-dep-chip { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--og-ws-line); background: var(--og-ws-surface); color: var(--og-ws-text); font: 500 12px var(--og-font-family, inherit); cursor: pointer; }
.og-ws-dep-chip:hover { border-color: var(--og-ws-line-strong); }
.og-ws-dep-chip.og-ws-done { color: var(--og-ws-muted); text-decoration: line-through; }
.og-ws-dep-up { color: var(--og-ws-danger); font-weight: 700; }
.og-ws-dep-down { color: #60a5fa; font-weight: 700; }
.og-ws-inspector-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--og-ws-line); margin-top: 4px; overflow-x: auto; scrollbar-width: none; }
.og-ws-inspector-tab { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--og-ws-muted); font: 600 12.5px var(--og-font-family, inherit); cursor: pointer; margin-bottom: -1px; white-space: nowrap; }
.og-ws-inspector-tab:hover { color: var(--og-ws-text); }
.og-ws-inspector-tab[aria-selected='true'] { color: var(--og-ws-text); border-bottom-color: var(--og-ws-accent); }
.og-ws-inspector-panel { display: flex; flex-direction: column; gap: 12px; min-height: 60px; }
.og-ws-composer { display: flex; align-items: flex-start; gap: 10px; }
.og-ws-composer-input { min-height: 36px; resize: none; }
.og-ws-feed { display: flex; flex-direction: column; gap: 14px; }
.og-ws-comment { display: flex; gap: 10px; }
.og-ws-comment-main { flex: 1; min-width: 0; }
.og-ws-comment-head { display: flex; align-items: baseline; gap: 8px; }
.og-ws-comment-body { margin: 3px 0 0; line-height: 1.5; color: color-mix(in srgb, var(--og-ws-text) 88%, transparent); white-space: pre-wrap; overflow-wrap: anywhere; }
.og-ws-reactions { display: flex; gap: 6px; margin-top: 6px; }
.og-ws-reaction { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 99px; border: 1px solid var(--og-ws-line); background: var(--og-ws-surface); font-size: 12px; }
.og-ws-reaction.og-ws-mine { border-color: color-mix(in srgb, var(--og-ws-accent) 50%, transparent); background: var(--og-ws-accent-soft); }
.og-ws-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.og-ws-timeline-item { display: flex; gap: 10px; line-height: 1.45; font-size: 12.5px; }
.og-ws-old { text-decoration: line-through; color: var(--og-ws-muted); }
.og-ws-new { color: var(--og-ws-text); font-weight: 600; }
.og-ws-file { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--og-ws-line); border-radius: 8px; color: inherit; text-decoration: none; background: var(--og-ws-surface); font: inherit; cursor: pointer; text-align: left; }
.og-ws-file:hover { border-color: var(--og-ws-line-strong); }

/* Bulk bar */
.og-ws-bulk { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 20; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 14px; border: 1px solid var(--og-ws-line-strong); border-radius: 12px; background: color-mix(in srgb, var(--og-text-color) 7%, var(--og-bg-color)); box-shadow: var(--og-ws-shadow-lg); max-width: calc(100% - 32px); animation: og-ws-rise .2s cubic-bezier(.2,.8,.2,1); }
@keyframes og-ws-rise { from { transform: translate(-50%, 12px); opacity: 0; } }
.og-ws-bulk > .og-ws-icon { color: var(--og-ws-accent); }
.og-ws-bulk-count { font-weight: 600; white-space: nowrap; padding-right: 6px; border-right: 1px solid var(--og-ws-line-strong); margin-right: 2px; }
.og-ws-bulk-actions { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.og-ws-bulk .og-ws-btn:not(.og-ws-btn-icon) { border-color: transparent; background: transparent; }
.og-ws-bulk .og-ws-btn:not(.og-ws-btn-icon):hover { background: var(--og-ws-hover); }

/* Toasts */
.og-ws-toasts { position: absolute; right: 16px; bottom: 16px; z-index: 30; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; }
.og-ws[data-inspecting] .og-ws-toasts { right: calc(var(--og-ws-inspector-width) + 16px); }
.og-ws-toast { pointer-events: auto; display: flex; align-items: center; gap: 12px; min-height: 38px; max-width: 420px; padding: 8px 8px 8px 14px; border-radius: 10px; border: 1px solid var(--og-ws-line-strong); background: color-mix(in srgb, var(--og-text-color) 8%, var(--og-bg-color)); box-shadow: var(--og-ws-shadow-lg); animation: og-ws-rise-in .2s cubic-bezier(.2,.8,.2,1); transition: opacity .2s ease, transform .2s ease; }
.og-ws-toast::before { content: ''; width: 8px; height: 8px; border-radius: 99px; background: var(--og-ws-accent); flex: none; }
.og-ws-toast-success::before { background: var(--og-ws-ok); } .og-ws-toast-warn::before { background: var(--og-ws-warn); } .og-ws-toast-error::before { background: var(--og-ws-danger); }
.og-ws-toast-out { opacity: 0; transform: translateY(6px); }
@keyframes og-ws-rise-in { from { opacity: 0; transform: translateY(8px); } }
.og-ws-toast-action { border: 0; background: var(--og-ws-hover); color: var(--og-ws-accent); font: 600 12.5px var(--og-font-family, inherit); padding: 6px 10px; border-radius: 7px; cursor: pointer; }

/* Dialogs, palette */
.og-ws-scrim { position: absolute; inset: 0; z-index: 50; display: grid; place-items: center; background: rgb(0 0 0 / .45); backdrop-filter: blur(2px); animation: og-ws-fade .15s ease; }
.og-ws-scrim-top { place-items: start center; padding-top: 10vh; }
@keyframes og-ws-fade { from { opacity: 0; } }
.og-ws-dialog { width: min(560px, calc(100% - 32px)); max-height: 80%; display: flex; flex-direction: column; border: 1px solid var(--og-ws-line-strong); border-radius: 14px; background: var(--og-ws-bg); box-shadow: var(--og-ws-shadow-lg); overflow: hidden; }
.og-ws-dialog-title { margin: 0; padding: 16px 18px 6px; font-size: 16px; font-weight: 650; letter-spacing: -.02em; }
.og-ws-dialog-body { padding: 6px 18px 12px; overflow: auto; }
.og-ws-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--og-ws-line); background: var(--og-ws-surface); }
.og-ws-palette { width: min(620px, calc(100% - 32px)); border: 1px solid var(--og-ws-line-strong); border-radius: 14px; background: var(--og-ws-bg); box-shadow: var(--og-ws-shadow-lg); overflow: hidden; }
.og-ws-palette-search { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 52px; border-bottom: 1px solid var(--og-ws-line); color: var(--og-ws-muted); }
.og-ws-palette-input { flex: 1; border: 0; outline: 0; background: none; color: var(--og-ws-text); font: 15px var(--og-font-family, inherit); }
.og-ws-palette-list { max-height: min(420px, 55vh); overflow: auto; padding: 6px; }
.og-ws-palette-group { padding: 10px 10px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--og-ws-faint); }
.og-ws-palette-item { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border-radius: 8px; cursor: pointer; color: var(--og-ws-text); }
.og-ws-palette-item .og-ws-icon { color: var(--og-ws-muted); }
.og-ws-palette-item[aria-selected='true'] { background: var(--og-ws-accent-soft); }
.og-ws-palette-item[aria-selected='true'] .og-ws-icon { color: var(--og-ws-accent); }
.og-ws-palette-empty { padding: 18px; text-align: center; }
.og-ws-list-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.og-ws-anchor { position: absolute; width: 1px; height: 1px; pointer-events: none; }

/* View manager */
.og-ws-create-view { display: flex; flex-direction: column; gap: 14px; padding-top: 6px; }
.og-ws-field-row { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 10px; }
.og-ws-kind-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.og-ws-kind { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border: 1px solid var(--og-ws-line); border-radius: 10px; background: var(--og-ws-surface); color: var(--og-ws-text); font: inherit; text-align: left; cursor: pointer; }
.og-ws-kind .og-ws-icon { color: var(--og-ws-muted); margin-bottom: 4px; }
.og-ws-kind:hover:not(:disabled) { border-color: var(--og-ws-line-strong); }
.og-ws-kind[aria-checked='true'] { border-color: var(--og-ws-accent); box-shadow: 0 0 0 1px var(--og-ws-accent); background: var(--og-ws-accent-soft); }
.og-ws-kind[aria-checked='true'] .og-ws-icon { color: var(--og-ws-accent); }
.og-ws-kind:disabled { opacity: .45; cursor: not-allowed; }
.og-ws-view-options { display: flex; flex-direction: column; gap: 8px; }
.og-ws-view-options:empty { display: none; }
.og-ws-tab-divider { width: 1px; height: 18px; background: var(--og-ws-line-strong); margin: 0 4px; }
.og-ws-tab .og-ws-dirty { width: 6px; height: 6px; border-radius: 99px; background: var(--og-ws-warn); }
.og-ws-tab .og-ws-scope { color: var(--og-ws-faint); }
.og-ws-tab-add { width: 28px; height: 28px; }

/* Impact preview */
.og-ws-impact { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.og-ws-impact th { text-align: left; font-weight: 600; color: var(--og-ws-muted); font-size: 11.5px; padding: 6px 8px; border-bottom: 1px solid var(--og-ws-line); }
.og-ws-impact td { padding: 7px 8px; border-bottom: 1px solid var(--og-ws-line); white-space: nowrap; }
.og-ws-impact td:first-child { white-space: normal; }
.og-ws-shift { color: var(--og-ws-warn); font-weight: 600; }
.og-ws-shift-early { color: var(--og-ws-ok); }
`;

/** Popovers and menus live in <body> (with the grid's theme scope), so they are styled outside .og-ws. */
const POPOVER_STYLES = `
.og-ws-popover { --og-ws-line: color-mix(in srgb, var(--og-text-color) 12%, var(--og-bg-color)); --og-ws-line-strong: color-mix(in srgb, var(--og-text-color) 18%, var(--og-bg-color)); --og-ws-muted: color-mix(in srgb, var(--og-text-color) 60%, transparent); --og-ws-faint: color-mix(in srgb, var(--og-text-color) 42%, transparent); --og-ws-hover: color-mix(in srgb, var(--og-text-color) 7%, transparent); --og-ws-surface: color-mix(in srgb, var(--og-text-color) 3%, var(--og-bg-color)); --og-ws-surface-2: color-mix(in srgb, var(--og-text-color) 6%, var(--og-bg-color)); --og-ws-accent: var(--og-focus-ring); --og-ws-accent-soft: color-mix(in srgb, var(--og-focus-ring) 16%, transparent); --og-ws-danger: #ef4444; font-family: var(--og-font-family, inherit); font-size: 13px; color: var(--og-text-color); }
.og-ws-popover *, .og-ws-popover *::before { box-sizing: border-box; }
.og-ws-menu { display: flex; flex-direction: column; min-width: 200px; max-height: 60vh; overflow: auto; padding: 5px; }
.og-ws-menu-item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.og-ws-menu-item:hover:not(:disabled), .og-ws-menu-item:focus-visible { background: var(--og-ws-hover); outline: none; }
.og-ws-menu-item:disabled { opacity: .5; cursor: default; }
.og-ws-menu-item .og-ws-icon { color: var(--og-ws-muted); }
.og-ws-menu-item.og-ws-danger, .og-ws-menu-item.og-ws-danger .og-ws-icon { color: var(--og-ws-danger); }
.og-ws-menu-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-ws-menu-sep { height: 1px; margin: 4px 6px; background: var(--og-ws-line); }
.og-ws-menu-heading { padding: 8px 10px 4px; font-size: 11px; font-weight: 600; color: var(--og-ws-faint); text-transform: uppercase; letter-spacing: .05em; }
.og-ws-popover .og-ws-icon { display: inline-grid; place-items: center; flex: none; line-height: 0; width: 16px; }
.og-ws-popover .og-ws-kbd { font-size: 10.5px; color: var(--og-ws-faint); border: 1px solid var(--og-ws-line-strong); border-radius: 5px; padding: 2px 5px; }
.og-ws-popover-panel > div { padding: 10px; min-width: 260px; max-width: 360px; max-height: 70vh; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.og-ws-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 4px 8px; }
.og-ws-popover .og-ws-hint { color: var(--og-ws-muted); font-size: 12px; margin: 4px; }
.og-ws-popover .og-ws-btn { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: var(--og-ws-muted); font: 500 12px var(--og-font-family, inherit); cursor: pointer; }
.og-ws-popover .og-ws-btn:hover:not(:disabled) { background: var(--og-ws-hover); color: var(--og-text-color); }
.og-ws-popover .og-ws-btn:disabled { opacity: .45; }
.og-ws-filter-section { padding: 6px 4px 10px; border-top: 1px solid var(--og-ws-line); }
.og-ws-section-label { font-size: 11.5px; font-weight: 600; color: var(--og-ws-muted); margin-bottom: 7px; }
.og-ws-chip-list { display: flex; flex-wrap: wrap; gap: 5px; }
.og-ws-chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 99px; border: 1px solid var(--og-ws-line); background: var(--og-ws-surface); color: inherit; font: 500 12px var(--og-font-family, inherit); cursor: pointer; }
.og-ws-chip:hover { border-color: var(--og-ws-line-strong); }
.og-ws-chip[aria-pressed='true'] { border-color: color-mix(in srgb, var(--og-ws-accent) 60%, transparent); background: var(--og-ws-accent-soft); }
.og-ws-dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; flex: none; }
.og-ws-list-item { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 8px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.og-ws-list-item:hover { background: var(--og-ws-hover); }
.og-ws-list-item[aria-pressed='true'] { color: var(--og-ws-accent); }
.og-ws-popover .og-ws-list-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-ws-sort-dir { font-size: 11.5px; color: var(--og-ws-accent); font-variant-numeric: tabular-nums; }
.og-ws-check input { accent-color: var(--og-ws-accent); margin: 0; }
.og-ws-role { font-size: 10.5px; color: var(--og-ws-faint); border: 1px solid var(--og-ws-line); border-radius: 5px; padding: 1px 5px; }
`;

const shared = new WeakMap<Document, { tag: HTMLStyleElement; users: number }>();

export function acquireWorkspaceStyles(doc: Document): HTMLStyleElement {
	const entry = shared.get(doc);
	if (entry && entry.tag.isConnected) {
		entry.users++;
		return entry.tag;
	}
	const tag = doc.createElement('style');
	tag.dataset.ogWorkspaceStyles = '';
	tag.textContent = WORKSPACE_STYLES + POPOVER_STYLES;
	doc.head.appendChild(tag);
	shared.set(doc, { tag, users: 1 });
	return tag;
}

export function releaseWorkspaceStyles(tag: HTMLStyleElement): void {
	const entry = shared.get(tag.ownerDocument);
	if (!entry || entry.tag !== tag) {
		tag.remove();
		return;
	}
	if (--entry.users > 0) return;
	tag.remove();
	shared.delete(tag.ownerDocument);
}

/** Styles appended by view modules (loaded with them). */
export function addViewStyles(doc: Document, id: string, css: string): void {
	if (doc.head.querySelector(`style[data-og-view-styles='${id}']`)) return;
	const tag = doc.createElement('style');
	tag.dataset.ogViewStyles = id;
	tag.textContent = css;
	doc.head.appendChild(tag);
}
