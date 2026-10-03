import { createClientGrid, type ColumnDef } from '../../core/src/index.js';
import { mountGridHost } from '../../core/src/internal.js';
import {
	createBarElements,
	formatBenchValue,
	formatNumbers,
	rendererCalls,
	installMeasurement,
	installTicker,
	makeRows,
	markReady,
	paintBar,
	readScenario,
	type BenchRow,
	HOT_CLASS,
	isHotValue,
	styledCells,
} from './common.js';

const scenario = readScenario();
const container = document.getElementById('grid')!;

const columns: ColumnDef<BenchRow>[] = Array.from({ length: scenario.cols }, (_, c) => {
	const base = { field: `c${c}`, header: `Col ${c}`, width: 110 };
	if (c >= scenario.domCols)
		return formatNumbers && c % 3 !== 0 ? { ...base, valueFormatter: ({ value }: { value: unknown }) => formatBenchValue(value) } : base;
	return {
		...base,
		renderer: {
			kind: 'dom' as const,
			renderer: {
				mount(el: HTMLElement, params: { value: unknown }) {
					const { bar, label } = createBarElements(el);
					paintBar(bar, label, params.value);
					return {
						update: (next: { value: unknown }) => {
							rendererCalls.updates++;
							paintBar(bar, label, next.value);
						},
					};
				},
			},
		},
	};
});

// ?css=<variant> injects an experimental stylesheet override, for A/B-testing CSS containment.
const cssVariant = new URLSearchParams(location.search).get('css');
const CSS_VARIANTS: Record<string, string> = {
	cell: '.og-cell{contain:strict}',
	cellrow: '.og-cell{contain:strict}.og-row{contain:strict}',
	// Rows as layout boundaries without size containment (row heights stay measurable).
	rowlayout: '.og-row{contain:layout style}',
	// Renderer containers as layout boundaries: a change inside stops there instead of dirtying the cell, row and rows container.
	hoststrict: '.og-dom-renderer-container,.og-custom-renderer-container{contain:strict}',
	// The portal host without a box of its own.
	hostcontents: '.og-cell[data-content-mode="portal"]>.og-cell-portal-host{display:contents}',
	both: '.og-dom-renderer-container,.og-custom-renderer-container{contain:strict}.og-cell[data-content-mode="portal"]>.og-cell-portal-host{display:contents}',
};
if (cssVariant && CSS_VARIANTS[cssVariant]) {
	const style = document.createElement('style');
	style.textContent = CSS_VARIANTS[cssVariant];
	document.head.appendChild(style);
}

const initialRows = makeRows(scenario);
// ?grouped=1: grouped by c1 (1,000 groups of ~100 rows), every group open, sticky group headers, and
// two rows pinned to the top and one to the bottom: every element that stays put while rows scroll.
const grouped = new URLSearchParams(location.search).get('grouped') === '1';
const api = createClientGrid<BenchRow>({
	columns,
	rows: initialRows,
	getRowId: (row) => row.id,
});
if (grouped) {
	api.setGrouping({ by: ['c1'], defaultExpanded: true, stickyHeaders: true });
	api.transaction({ pins: { top: 2, bottom: 1 } });
}
if (styledCells) api.setStyleRules([{ kind: 'cell', when: (row, col) => isHotValue(row[col.field]), cellClass: HOT_CLASS }]);
installTicker(initialRows, (rows) => api.setRows(rows));
const host = mountGridHost(api, container);
// Diagnostics only (bench --trace): the grid's own write counters for the measured window.
(window as unknown as { witHost: typeof host }).witHost = host;

installMeasurement({
	viewport: () => container.querySelector<HTMLElement>('.og-scroll-viewport'),
	header: () => container.querySelector<HTMLElement>('.og-layer-header-wrapper'),
	rows: () => container.querySelectorAll<HTMLElement>('.og-rows-container > .og-row'),
	cells: (row) => row.querySelectorAll<HTMLElement>('.og-cell'),
	cellIds: (cell) => ({ rowId: cell.dataset.rowId ?? null, colId: cell.dataset.colField ?? null }),
});
requestAnimationFrame(() => requestAnimationFrame(markReady));
