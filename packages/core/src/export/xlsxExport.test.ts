import { describe, expect, it } from 'vitest';
import { currencyColumnType, dateColumnType, percentColumnType, resolveColumnTypes, selectColumnType } from '../cells/cellTypes.js';
import { createClientGrid } from '../createGrid.js';

interface Row {
	id: string;
	name: string;
	budget: number;
	share: number;
	due: string;
	status: string;
	region: string;
}

const ROWS: Row[] = [
	{ id: '1', name: 'Ava & Co <x>', budget: 2500, share: 0.25, due: '2026-03-04', status: 'done', region: 'EMEA' },
	{ id: '2', name: 'Liam', budget: 1250.5, share: 0.5, due: '2026-03-05T09:30', status: 'todo', region: 'EMEA' },
	{ id: '3', name: 'Noah', budget: 900, share: 1, due: '', status: 'done', region: 'APAC' },
];

function grid(grouped = false) {
	const columns = resolveColumnTypes<Row>(
		[
			{ field: 'name', header: 'Name', width: 210 },
			{ field: 'budget', header: 'Budget', type: 'currency' },
			{ field: 'share', header: 'Share', type: 'percent' },
			{ field: 'due', header: 'Due', type: 'date' },
			{ field: 'status', header: 'Status', type: 'status' },
			{ field: 'region', header: 'Region' },
		],
		{
			currency: currencyColumnType({ currency: 'USD' }),
			percent: percentColumnType(),
			date: dateColumnType(),
			status: selectColumnType([{ value: 'done', label: 'Done' }, { value: 'todo', label: 'To do' }]),
		}
	);
	return createClientGrid<Row>({
		rows: ROWS,
		columns,
		initialState: grouped ? { grouping: { by: ['region'] } } : undefined,
	});
}

/** The parts of a ZIP archive, inflated. */
async function unzip(bytes: Uint8Array): Promise<Record<string, string>> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: Record<string, string> = {};
	let at = 0;
	while (view.getUint32(at, true) === 0x04034b50) {
		const method = view.getUint16(at + 8, true);
		const size = view.getUint32(at + 18, true);
		const nameLength = view.getUint16(at + 26, true);
		const extra = view.getUint16(at + 28, true);
		const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
		const start = at + 30 + nameLength + extra;
		const body = bytes.subarray(start, start + size);
		const data =
			method === 8 ? new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : body;
		out[name] = new TextDecoder().decode(data);
		at = start + size;
	}
	return out;
}

async function exported(api: ReturnType<typeof grid>, options = {}) {
	const blob = await api.getExcel(options);
	expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	return unzip(new Uint8Array(await blob.arrayBuffer()));
}

describe('Excel export', () => {
	it('is a workbook: content types, workbook, sheet and styles', async () => {
		const parts = await exported(grid());
		expect(Object.keys(parts).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
		expect(parts['xl/workbook.xml']).toContain('<sheet name="Sheet1"');
	});

	it('keeps numbers, currency, percent and dates typed; option labels as text; escapes XML', async () => {
		const parts = await exported(grid());
		const sheet = parts['xl/worksheets/sheet1.xml'];
		const styles = parts['xl/styles.xml'];
		// Currency and percent formats.
		expect(styles).toContain('formatCode="&quot;$&quot;#,##0.00"');
		expect(styles).toContain('formatCode="0%"');
		expect(styles).toContain('formatCode="yyyy-mm-dd"');
		expect(styles).toContain('formatCode="yyyy-mm-dd hh:mm"');
		expect(sheet).toMatch(/<c r="B2" s="\d+"><v>2500<\/v><\/c>/);
		expect(sheet).toMatch(/<c r="C2" s="\d+"><v>0.25<\/v><\/c>/);
		// 2026-03-04 is Excel day 46085; 09:30 adds 0.395833…
		expect(sheet).toMatch(/<c r="D2" s="\d+"><v>46085<\/v><\/c>/);
		expect(sheet).toMatch(/<c r="D3" s="\d+"><v>46086\.3958/);
		// An empty date writes no cell.
		expect(sheet).not.toContain('r="D4"');
		expect(sheet).toContain('<t xml:space="preserve">Done</t>');
		expect(sheet).toContain('Ava &amp; Co &lt;x&gt;');
	});

	it('a bold, frozen, filterable header and the grid widths', async () => {
		const sheet = (await exported(grid()))['xl/worksheets/sheet1.xml'];
		expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
		expect(sheet).toContain('<autoFilter ref="A1:F4"/>');
		expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
		expect(sheet).toMatch(/<c r="A1" t="inlineStr" s="\d+"><is><t xml:space="preserve">Name<\/t>/);
	});

	it('columns, rows and sheet name can be chosen', async () => {
		const parts = await exported(grid(), { columns: ['name', 'budget'], rowIds: ['3'], sheetName: 'Q1/close' });
		const sheet = parts['xl/worksheets/sheet1.xml'];
		expect(sheet).toContain('<dimension ref="A1:B2"/>');
		expect(sheet).toContain('Noah');
		expect(sheet).not.toContain('Liam');
		expect(parts['xl/workbook.xml']).toContain('<sheet name="Q1 close"');
	});

	it('grouped grids export as outlines with group rows above their rows', async () => {
		const sheet = (await exported(grid(true)))['xl/worksheets/sheet1.xml'];
		expect(sheet).toContain('<outlinePr summaryBelow="0"/>');
		expect(sheet).toMatch(/<row r="\d+" outlineLevel="1">/);
		expect(sheet).toContain('EMEA');
	});

	it('carries conditional formats over as native, live Excel rules on the data rows', async () => {
		const api = grid();
		api.setStyleRules([
			{ kind: 'dataBar', field: 'budget', color: '#22c55e' },
			{ kind: 'colorScale', field: 'share' },
			{ kind: 'iconSet', field: 'share', icons: 'dots', reverse: true },
			{ kind: 'colorScale', field: 'budget', colors: ['#000000', 'var(--brand)'], min: 0, max: 5000 },
			{ kind: 'cell', field: 'name', when: () => true, cellClass: 'x' },
		]);
		const sheet = (await exported(api))['xl/worksheets/sheet1.xml'];
		// After the auto filter, as the schema orders them; one block per column, B = Budget, C = Share.
		expect(sheet.indexOf('<conditionalFormatting')).toBeGreaterThan(sheet.indexOf('<autoFilter'));
		expect(sheet).toContain('<conditionalFormatting sqref="B2:B4"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF22C55E"/>');
		// A colour the export cannot read (a CSS variable) falls back to Excel's scale; fixed bounds are numbers.
		expect(sheet).toContain('<cfRule type="colorScale" priority="2"><colorScale><cfvo type="num" val="0"/><cfvo type="num" val="5000"/><color rgb="FFF8696B"/><color rgb="FF63BE7B"/>');
		expect(sheet).toContain('<conditionalFormatting sqref="C2:C4">');
		expect(sheet).toContain('<cfvo type="percentile" val="50"/>');
		expect(sheet).toContain('<iconSet iconSet="3TrafficLights1" reverse="1"><cfvo type="percent" val="0"/><cfvo type="percent" val="33.333333"/><cfvo type="percent" val="66.666667"/></iconSet>');
		expect(sheet.match(/<conditionalFormatting /g)).toHaveLength(2);
	});
});
