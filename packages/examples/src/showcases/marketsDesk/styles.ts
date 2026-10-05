/**
 * Theme tokens and cell styles for the markets desk. Cell renderers are consumer-drawn DOM that the
 * grid's own theme system cannot reach, so they read CSS variables set by `.md-dark` / `.md-light`
 * on the showcase root: switching theme re-tints every cell without touching the columns.
 */
export const DESK_CSS = `
.md-root { --md-flash: 0.7s; }
.md-root.md-dark {
  --md-up: #34d399; --md-down: #f87171; --md-text: #e2e8f0; --md-muted: #8b98ad;
  --md-track: rgba(148,163,184,.18); --md-up-soft: rgba(52,211,153,.2); --md-down-soft: rgba(248,113,113,.2);
  --md-up-flash: rgba(52,211,153,.55); --md-down-flash: rgba(248,113,113,.55);
  --md-accent: #818cf8; --md-warn: #fbbf24; --md-group-bg: rgba(99,102,241,.1); --md-group-stuck: #151a2c;
}
.md-root.md-light {
  --md-up: #0f9d58; --md-down: #c0392b; --md-text: #202124; --md-muted: #5f6368;
  --md-track: rgba(60,64,67,.13); --md-up-soft: rgba(15,157,88,.16); --md-down-soft: rgba(192,57,43,.15);
  --md-up-flash: rgba(15,157,88,.4); --md-down-flash: rgba(192,57,43,.38);
  --md-accent: #4f46e5; --md-warn: #b7791f; --md-group-bg: rgba(79,70,229,.07); --md-group-stuck: #eef0fb;
}

.md-cell { display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 8px; box-sizing: border-box; font-variant-numeric: tabular-nums; color: var(--md-text); }
.md-cell.md-end { justify-content: flex-end; }

.md-price { font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 5px; border-radius: 4px; }
@keyframes mdFlashUp0 { 0% { background: var(--md-up-flash); } 100% { background: transparent; } }
@keyframes mdFlashUp1 { 0% { background: var(--md-up-flash); } 100% { background: transparent; } }
@keyframes mdFlashDn0 { 0% { background: var(--md-down-flash); } 100% { background: transparent; } }
@keyframes mdFlashDn1 { 0% { background: var(--md-down-flash); } 100% { background: transparent; } }
.md-fu0 { animation: mdFlashUp0 var(--md-flash) ease-out; }
.md-fu1 { animation: mdFlashUp1 var(--md-flash) ease-out; }
.md-fd0 { animation: mdFlashDn0 var(--md-flash) ease-out; }
.md-fd1 { animation: mdFlashDn1 var(--md-flash) ease-out; }

.md-spark { display: block; overflow: visible; }
.md-spark[data-dir='up'] { --c: var(--md-up); }
.md-spark[data-dir='down'] { --c: var(--md-down); }
.md-spark-line { fill: none; stroke: var(--c, var(--md-muted)); stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
.md-spark-area { fill: var(--c, var(--md-muted)); opacity: .14; stroke: none; }
.md-spark-dot { fill: var(--c, var(--md-muted)); }

.md-heat { position: relative; width: 100%; height: 18px; border-radius: 4px; background: var(--md-track); overflow: hidden; }
.md-heat::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--md-muted); opacity: .35; }
/* Bars move by transform (the compositor animates it), and only tween while a row's own value changes (.md-tween); a cell rebound to another row snaps. */
.md-heat-bar { position: absolute; top: 0; bottom: 0; left: 50%; width: 50%; transform-origin: left center; transform: scaleX(0); }
.md-tween { transition: transform .25s ease; }
.md-heat-bar[data-dir='up'] { background: var(--md-up-soft); box-shadow: inset 0 0 0 1px var(--md-up-soft); }
.md-heat-bar[data-dir='down'] { background: var(--md-down-soft); box-shadow: inset 0 0 0 1px var(--md-down-soft); }
.md-heat-text { position: relative; z-index: 1; display: block; text-align: center; font: 700 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--md-text); }
.md-heat-text[data-dir='up'], .md-agg[data-dir='up'], .md-pnl-text[data-dir='up'] { color: var(--md-up); }
.md-heat-text[data-dir='down'], .md-agg[data-dir='down'], .md-pnl-text[data-dir='down'] { color: var(--md-down); }

.md-quote { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; width: 100%; font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; align-items: center; }
.md-quote-bid { color: var(--md-down); text-align: right; }
.md-quote-ask { color: var(--md-up); }
.md-quote-spread { color: var(--md-muted); font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--md-track); }

.md-range { display: flex; align-items: center; gap: 6px; width: 100%; font: 500 9px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--md-muted); }
.md-range-lo { min-width: 38px; text-align: right; }
.md-range-hi { min-width: 38px; }
.md-range-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: var(--md-track); }
.md-range-marker { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.md-range-marker::before { content: ''; position: absolute; top: -3px; left: -2px; width: 4px; height: 10px; border-radius: 2px; background: var(--md-text); }
.md-range-marker[data-dir='up']::before { background: var(--md-up); }
.md-range-marker[data-dir='down']::before { background: var(--md-down); }
.md-range-vwap { position: absolute; top: -2px; width: 1px; height: 8px; background: var(--md-accent); opacity: .9; }

.md-bar-cell { display: flex; align-items: center; gap: 6px; width: 100%; }
.md-bar-track { flex: 1; height: 5px; border-radius: 3px; background: var(--md-track); overflow: hidden; }
.md-bar-fill { display: block; width: 100%; height: 100%; background: var(--md-muted); transform-origin: left center; }
.md-bar-fill.md-bar-accent { background: var(--md-accent); }
.md-bar-fill[data-level='lo'] { background: var(--md-up); }
.md-bar-fill[data-level='mid'] { background: var(--md-warn); }
.md-bar-fill[data-level='hi'] { background: var(--md-down); }
.md-bar-text { min-width: 40px; text-align: right; font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }

.md-pnl { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; width: 100%; }
.md-pnl-text { font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.md-pnl-track { width: 100%; height: 3px; border-radius: 2px; background: var(--md-track); overflow: hidden; display: flex; justify-content: flex-end; }
.md-pnl-fill { display: block; width: 100%; height: 100%; transform-origin: right center; }
.md-pnl-fill[data-dir='up'] { background: var(--md-up); }
.md-pnl-fill[data-dir='down'] { background: var(--md-down); }
.md-agg { font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; }

.md-pos { color: var(--md-up) !important; }
.md-neg { color: var(--md-down) !important; }
.md-dim { opacity: .5; }
.md-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* React cells */
.md-avatar { display: flex; align-items: center; gap: 8px; height: 100%; }
.md-avatar-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 9px; font-weight: 800; flex-shrink: 0; }
.md-avatar-sym { font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--md-text); }
.md-stars { display: inline-flex; align-items: center; height: 100%; gap: 1px; font-size: 11px; letter-spacing: 1px; }
.md-star-on { color: var(--md-warn); }
.md-star-off { color: var(--md-track); }
.md-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; padding: 2px 8px; border-radius: 999px; border: 1px solid; }
.md-badge[data-status='active'] { color: var(--md-up); border-color: var(--md-up-soft); background: var(--md-up-soft); }
.md-badge[data-status='halted'] { color: var(--md-down); border-color: var(--md-down-soft); background: var(--md-down-soft); }
.md-badge[data-status='auction'] { color: var(--md-warn); border-color: rgba(251,191,36,.3); background: rgba(251,191,36,.12); }
.md-badge i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; display: block; }

/* Group rows */
.md-grp { display: flex; align-items: center; gap: 8px; height: 100%; width: 100%; padding-right: 8px; box-sizing: border-box; font-size: 12px; color: var(--md-text); background: var(--md-group-bg); container-type: inline-size; }
.md-grp.md-grp-stuck { background: var(--md-group-stuck); font-size: 11px; }
/* The label keeps room for a short name; the bar gives way first, then the % column drops out. */
.md-grp-label { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 64px; flex: 0 1 auto; }
.md-grp-pct { min-width: 44px; text-align: right; }
@container (max-width: 320px) { .md-grp-pct { display: none; } }
@container (max-width: 250px) { .md-grp-bar { display: none; } }
.md-grp-count { font-size: 10px; color: var(--md-muted); white-space: nowrap; }
.md-grp-pnl { font: 700 11px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.md-grp-pnl[data-dir='up'] { color: var(--md-up); }
.md-grp-pnl[data-dir='down'] { color: var(--md-down); }
.md-grp-bar { position: relative; width: 48px; min-width: 20px; height: 5px; border-radius: 3px; background: var(--md-track); flex-shrink: 1; }
.md-grp-bar::after { content: ''; position: absolute; left: 50%; top: -1px; bottom: -1px; width: 1px; background: var(--md-muted); opacity: .5; }
.md-grp-bar i { position: absolute; top: 0; bottom: 0; left: 50%; width: 50%; transform-origin: left center; }
.md-grp-bar i[data-dir='up'] { background: var(--md-up); }
.md-grp-bar i[data-dir='down'] { background: var(--md-down); }
.md-grp-actions { margin-left: auto; display: flex; gap: 4px; flex-shrink: 0; }
.md-grp-btn { font-size: 10px; font-weight: 700; line-height: 1; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--md-track); background: transparent; color: var(--md-muted); cursor: pointer; }
.md-grp-btn:hover { color: var(--md-text); border-color: var(--md-muted); }
.md-grp-total { font-weight: 800; color: var(--md-warn); }
`;
