import { createClientGrid, type ColumnDef } from '../../core/src/index.js';
import { mountGridHost } from '../../core/src/internal.js';
import { createBarElements, installMeasurement, makeRows, markReady, paintBar, readScenario, type BenchRow } from './common.js';

const scenario = readScenario();
const container = document.getElementById('grid')!;

const columns: ColumnDef<BenchRow>[] = Array.from({ length: scenario.cols }, (_, c) => {
	const base = { field: `c${c}`, header: `Col ${c}`, width: 110 };
	if (c >= scenario.domCols) return base;
	return {
		...base,
		renderer: {
			kind: 'dom' as const,
			renderer: {
				mount(el: HTMLElement, params: { value: unknown }) {
					const { bar, label } = createBarElements(el);
					paintBar(bar, label, params.value);
					return { update: (next: { value: unknown }) => paintBar(bar, label, next.value) };
				},
			},
		},
	};
});

const api = createClientGrid<BenchRow>({ columns, rows: makeRows(scenario), getRowId: (row) => row.id });
mountGridHost(api, container);

installMeasurement({
	viewport: () => container.querySelector<HTMLElement>('.og-scroll-viewport'),
	header: () => container.querySelector<HTMLElement>('.og-layer-header-wrapper'),
	rows: () => container.querySelectorAll<HTMLElement>('.og-rows-container > .og-row'),
});
requestAnimationFrame(() => requestAnimationFrame(markReady));
