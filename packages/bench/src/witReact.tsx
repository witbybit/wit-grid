// Wit Grid through the React adapter, with React component cell renderers on the renderer columns
// (the default scroll presentation: no capabilities declared). Fidelity runs only — there is no
// AG Grid React counterpart in the bench, so it has no paired timing comparison.
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Grid, type ColumnDef } from '../../react/src/index.js';
import {
	installMeasurement,
	installTicker,
	makeRows,
	markReady,
	middleVisibleRowIndex,
	readScenario,
	rendererCalls,
	type BenchRow,
	HOT_CLASS,
	isHotValue,
	styledCells,
} from './common.js';

const scenario = readScenario();
const container = document.getElementById('grid')!;

function BarCell({ value }: { value: unknown }) {
	const mounted = useRef(false);
	if (mounted.current) rendererCalls.updates++;
	useEffect(() => {
		mounted.current = true;
		rendererCalls.mounts++;
	}, []);
	const n = typeof value === 'number' ? value : 0;
	return (
		<div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			<div
				className='bench-bar'
				style={{ position: 'absolute', left: 0, top: '25%', height: '50%', background: '#4f8cff55', width: `${n / 10}%` }}
			/>
			<span style={{ position: 'relative' }}>{String(value ?? '')}</span>
		</div>
	);
}

const columns: ColumnDef<BenchRow>[] = Array.from({ length: scenario.cols }, (_, c) => {
	const base = { field: `c${c}`, header: `Col ${c}`, width: 110 };
	if (c >= scenario.domCols) return base;
	// ?reactMode=live|text picks the scroll presentation; default: none declared ('text').
	const mode = new URLSearchParams(location.search).get('reactMode');
	const capabilities = mode ? { capabilities: { scroll: mode as 'live' | 'text' } } : {};
	// ?getters=1: the renderer columns read their value through a valueGetter (the #perf demo's Greeks shape).
	const getter = new URLSearchParams(location.search).get('getters') === '1' ? { valueGetter: ({ row }: { row: BenchRow }) => row[`c${c}`] } : {};
	return { ...base, ...getter, renderer: { kind: 'react' as const, component: BarCell, ...capabilities } };
});
const rows = makeRows(scenario);

// ?reactMounts=<n> caps live React mounts per frame (rendererOptions.live.maxMountsPerFrame).
const reactMounts = new URLSearchParams(location.search).get('reactMounts');
const rendererOptions = reactMounts ? { live: { maxMountsPerFrame: Number(reactMounts) } } : undefined;

const root = createRoot(container);
const styleRules = styledCells
	? [{ kind: 'cell' as const, when: (row: BenchRow, col: { field: string }) => isHotValue(row[col.field]), cellClass: HOT_CLASS }]
	: undefined;
const render = (current: BenchRow[]) =>
	root.render(
		<Grid<BenchRow> columns={columns} rows={current} getRowId={(row) => row.id} rendererOptions={rendererOptions} styleRules={styleRules} />
	);
render(rows);
// Tick scenarios edit a renderer cell (c1) of the row in the middle of the viewport, through the
// React way of updating data: a new rows prop.
installTicker(rows, render, (i) => middleVisibleRowIndex('.og-rows-container > .og-row') ?? i % 12);

installMeasurement({
	viewport: () => container.querySelector<HTMLElement>('.og-scroll-viewport'),
	header: () => container.querySelector<HTMLElement>('.og-layer-header-wrapper'),
	rows: () =>
		container.querySelectorAll<HTMLElement>('.og-rows-container > .og-row, .og-layer-pinned-top > .og-row, .og-layer-pinned-bottom > .og-row'),
	cells: (row) => row.querySelectorAll<HTMLElement>('.og-cell'),
	cellIds: (cell) => ({ rowId: cell.dataset.rowId ?? null, colId: cell.dataset.colField ?? null }),
});
// Ready once the grid has drawn its first rows.
const waitForRows = () =>
	container.querySelector('.og-rows-container > .og-row .og-cell')
		? requestAnimationFrame(() => requestAnimationFrame(markReady))
		: requestAnimationFrame(waitForRows);
waitForRows();
