import { AllCommunityModule, ModuleRegistry, createGrid, type ColDef, type ICellRendererComp, type ICellRendererParams } from 'ag-grid-community';
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

ModuleRegistry.registerModules([AllCommunityModule]);

const scenario = readScenario();
const container = document.getElementById('grid')!;

/** AG Grid's equivalent of the Wit Grid DOM renderer: refresh() updates in place. */
class BarRenderer implements ICellRendererComp {
	private gui = document.createElement('div');
	private bar!: HTMLElement;
	private label!: HTMLElement;
	init(params: ICellRendererParams) {
		this.gui.style.cssText = 'width:100%;height:100%;';
		({ bar: this.bar, label: this.label } = createBarElements(this.gui));
		paintBar(this.bar, this.label, params.value);
	}
	getGui() {
		return this.gui;
	}
	refresh(params: ICellRendererParams) {
		rendererCalls.updates++;
		paintBar(this.bar, this.label, params.value);
		return true;
	}
}

const columnDefs: ColDef<BenchRow>[] = Array.from({ length: scenario.cols }, (_, c) => ({
	field: `c${c}`,
	headerName: `Col ${c}`,
	width: 110,
	...(c < scenario.domCols ? { cellRenderer: BarRenderer } : {}),
	...(c >= scenario.domCols && formatNumbers && c % 3 !== 0 ? { valueFormatter: (p: { value: unknown }) => formatBenchValue(p.value) } : {}),
}));

createGrid(container, {
	columnDefs,
	rowData: makeRows(scenario),
	getRowId: (p) => p.data.id,
	onFirstDataRendered: () => requestAnimationFrame(() => requestAnimationFrame(markReady)),
});

installMeasurement({
	viewport: () => container.querySelector<HTMLElement>('.ag-grid-viewport'),
	header: () => container.querySelector<HTMLElement>('.ag-header'),
	rows: () => container.querySelectorAll<HTMLElement>('.ag-grid-scrolling-rows .ag-row'),
	cells: (row) => row.querySelectorAll<HTMLElement>('.ag-cell'),
	cellIds: (cell, row) => ({ rowId: row.getAttribute('row-id'), colId: cell.getAttribute('col-id') }),
});
