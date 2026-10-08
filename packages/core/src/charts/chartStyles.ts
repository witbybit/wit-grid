/** Charts and the chart window: colours from the grid theme (both wear the grid's theme scope). */
export const CHART_STYLES = `
.og-chart { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; gap: 8px; color: var(--og-text-color); font-family: var(--og-font-family, inherit); }
.og-chart-title { font-size: 14px; font-weight: 600; padding: 0 4px; }
.og-chart-title[hidden] { display: none; }
.og-chart-plot { position: relative; flex: 1 1 auto; min-height: 120px; }
.og-chart-canvas { position: absolute; inset: 0; display: block; touch-action: none; }
.og-chart-empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: color-mix(in srgb, var(--og-text-color) 55%, transparent); pointer-events: none; text-align: center; padding: 16px; }
.og-chart-empty[hidden] { display: none; }
.og-chart-tooltip {
  position: absolute; z-index: 2; min-width: 140px; max-width: 260px; padding: 8px 10px; border-radius: 8px; pointer-events: none;
  background: var(--og-popover-bg, var(--og-bg-color)); border: 1px solid var(--og-popover-border, var(--og-border-color));
  box-shadow: 0 10px 30px rgba(0, 0, 0, .28); font-size: 12px; line-height: 1.5;
}
.og-chart-tooltip[hidden] { display: none; }
.og-chart-tooltip-title { font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-chart-tooltip-row { display: flex; align-items: center; gap: 6px; }
.og-chart-tooltip-row i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.og-chart-tooltip-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, var(--og-text-color) 70%, transparent); }
.og-chart-tooltip-row b { font-weight: 600; font-variant-numeric: tabular-nums; }
.og-chart-tooltip-hint { margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--og-border-color); font-size: 11px; color: color-mix(in srgb, var(--og-text-color) 55%, transparent); }
.og-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 0 4px; font-size: 12px; }
.og-chart-legend[hidden] { display: none; }
.og-chart-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 2px 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: default; }
button.og-chart-legend-item { cursor: pointer; }
.og-chart-legend-item i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.og-chart-legend-item[aria-pressed='false'] { opacity: .4; }
.og-chart-legend-item[aria-pressed='false'] span { text-decoration: line-through; }

.og-cw {
  --og-cw-line: var(--og-border-color);
  --og-cw-hover: color-mix(in srgb, var(--og-text-color) 8%, transparent);
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column; min-width: 380px; min-height: 280px;
  background: var(--og-bg-color); color: var(--og-text-color); font-family: var(--og-font-family, inherit); font-size: 13px;
  border: 1px solid var(--og-cw-line); border-radius: 12px; box-shadow: 0 24px 60px rgba(0, 0, 0, .35), 0 2px 8px rgba(0, 0, 0, .2); overflow: hidden;
}
.og-cw-head { display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--og-cw-line); background: var(--og-header-bg); cursor: grab; user-select: none; }
.og-cw-head:active { cursor: grabbing; }
.og-cw-title { flex: 1; min-width: 60px; height: 30px; padding: 0 6px; border: 0; border-radius: 6px; outline: 0; background: transparent; color: inherit; font: inherit; font-size: 14px; font-weight: 600; }
.og-cw-title:hover { background: var(--og-cw-hover); }
.og-cw-title:focus { background: var(--og-bg-color); box-shadow: inset 0 0 0 1px var(--og-focus-ring); cursor: text; }
.og-cw-title::placeholder { color: color-mix(in srgb, var(--og-text-color) 40%, transparent); }
.og-cw-types, .og-cw-tools { display: flex; gap: 2px; }
.og-cw-types { padding: 2px; border-radius: 8px; background: var(--og-cw-hover); }
.og-cw-btn { width: 30px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: color-mix(in srgb, var(--og-text-color) 65%, transparent); cursor: pointer; }
.og-cw-btn:hover { color: var(--og-text-color); background: var(--og-cw-hover); }
.og-cw-btn:focus-visible { outline: 2px solid var(--og-focus-ring); outline-offset: 1px; }
.og-cw-types .og-cw-btn[aria-checked='true'] { background: var(--og-bg-color); color: var(--og-focus-ring); box-shadow: 0 1px 2px rgba(0, 0, 0, .2); }
.og-cw-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--og-cw-line); }
.og-cw-seg { display: flex; padding: 2px; gap: 2px; border-radius: 7px; background: var(--og-cw-hover); }
.og-cw-seg-btn { height: 24px; padding: 0 10px; border: 0; border-radius: 5px; background: transparent; color: color-mix(in srgb, var(--og-text-color) 65%, transparent); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
.og-cw-seg-btn[aria-checked='true'] { background: var(--og-bg-color); color: var(--og-text-color); box-shadow: 0 1px 2px rgba(0, 0, 0, .2); }
.og-cw-field { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.og-cw-field-label { color: color-mix(in srgb, var(--og-text-color) 55%, transparent); }
.og-cw-select {
  appearance: none; height: 28px; padding: 0 24px 0 9px; border-radius: 7px; font: inherit; font-size: 12.5px; cursor: pointer; max-width: 160px;
  color: var(--og-text-color); border: 1px solid var(--og-popover-input-border, var(--og-cw-line)); background: var(--og-popover-input-bg, transparent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center;
}
.og-cw-select:focus-visible { outline: 2px solid var(--og-focus-ring); outline-offset: 1px; }
.og-cw-select option { background: var(--og-bg-color); color: var(--og-text-color); }
.og-cw-options { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.og-cw-chip { height: 26px; padding: 0 9px; border: 1px solid var(--og-cw-line); border-radius: 999px; background: transparent; color: color-mix(in srgb, var(--og-text-color) 70%, transparent); font: inherit; font-size: 12px; cursor: pointer; }
.og-cw-chip:hover { color: var(--og-text-color); border-color: color-mix(in srgb, var(--og-text-color) 30%, transparent); }
.og-cw-chip[aria-pressed='true'] { color: var(--og-focus-ring); border-color: color-mix(in srgb, var(--og-focus-ring) 50%, transparent); background: color-mix(in srgb, var(--og-focus-ring) 10%, transparent); }
.og-cw-body { flex: 1; min-height: 0; padding: 12px 12px 10px; }
/* The window's header holds the title. */
.og-cw .og-chart-title { display: none; }
.og-cw-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--og-text-color) 25%, transparent) 50%, transparent 62%, color-mix(in srgb, var(--og-text-color) 25%, transparent) 62%, transparent 74%); }
`;
