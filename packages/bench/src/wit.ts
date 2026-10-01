import { createClientGrid, type ColumnDef } from '../../core/src/index.js';
import { mountGridHost } from '../../core/src/internal.js';
import {
	createBarElements,
	formatBenchValue,
	formatNumbers,
	rendererCalls,
	installMeasurement,
	makeRows,
	markReady,
	paintBar,
	readScenario,
	type BenchRow,
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
			// ?domLive=1 opts the DOM renderers into live in-frame updates during scroll.
			...(new URLSearchParams(location.search).get('domLive') === '1' ? { capabilities: { scrollPresentation: 'live' as const } } : {}),
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

const api = createClientGrid<BenchRow>({ columns, rows: makeRows(scenario), getRowId: (row) => row.id });
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
