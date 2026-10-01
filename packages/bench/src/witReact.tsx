// Wit Grid through the React adapter, with React component cell renderers on the renderer columns
// (the default scroll presentation: no capabilities declared). Fidelity runs only — there is no
// AG Grid React counterpart in the bench, so it has no paired timing comparison.
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Grid, type ColumnDef } from '../../react/src/index.js';
import { installMeasurement, makeRows, markReady, readScenario, rendererCalls, type BenchRow } from './common.js';

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
	// ?reactMode=live|html-snapshot|freeze picks the scroll presentation; default: none declared.
	const mode = new URLSearchParams(location.search).get('reactMode');
	const capabilities = mode ? { capabilities: { scrollPresentation: mode as 'live' | 'html-snapshot' | 'freeze' } } : {};
	return { ...base, renderer: { kind: 'react' as const, component: BarCell, ...capabilities } };
});
const rows = makeRows(scenario);

// ?reactMounts=<n> caps live React mounts per frame (rendererOptions.liveReact.maxMountsPerFrame).
const reactMounts = new URLSearchParams(location.search).get('reactMounts');
const rendererOptions = reactMounts ? { liveReact: { maxMountsPerFrame: Number(reactMounts) } } : undefined;

createRoot(container).render(<Grid<BenchRow> columns={columns} rows={rows} getRowId={(row) => row.id} rendererOptions={rendererOptions} />);

installMeasurement({
	viewport: () => container.querySelector<HTMLElement>('.og-scroll-viewport'),
	header: () => container.querySelector<HTMLElement>('.og-layer-header-wrapper'),
	rows: () => container.querySelectorAll<HTMLElement>('.og-rows-container > .og-row'),
	cells: (row) => row.querySelectorAll<HTMLElement>('.og-cell'),
	cellIds: (cell) => ({ rowId: cell.dataset.rowId ?? null, colId: cell.dataset.colField ?? null }),
});
// Ready once the grid has drawn its first rows.
const waitForRows = () =>
	container.querySelector('.og-rows-container > .og-row .og-cell')
		? requestAnimationFrame(() => requestAnimationFrame(markReady))
		: requestAnimationFrame(waitForRows);
waitForRows();
