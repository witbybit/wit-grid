/**
 * Excel (.xlsx) export that keeps what the grid shows: numbers stay numbers with their currency,
 * percent and decimal formats, dates are Excel dates, option columns (select, people, tags) write
 * their labels, column widths follow the grid, the header is bold, frozen and filterable, and
 * grouped grids export as Excel outlines that collapse.
 */
import type { ColumnDef, GridStyleRule } from '../columnDef.js';
import type { NumberCellOptions } from '../cells/format.js';
import { parseCellDate } from '../cells/format.js';
import { resolveColumnFilterDef } from '../filters/filterDef.js';
import { hierarchyColumnGroupColId, isHierarchyColumn } from '../rows/hierarchyColumn.js';
import type { VisualRow } from '../visualRow.js';
import { exportDataRows, triggerDownload, type Exportable } from './csvExport.js';
import { createZip } from './zip.js';
import { columnName, conditionalFormattingXml } from './xlsxConditionalFormats.js';

export interface ExcelExportOptions {
	/** Downloaded file name. Default: 'export.xlsx' */
	fileName?: string;
	/** Default: 'Sheet1' */
	sheetName?: string;
	/** Default: true */
	includeHeader?: boolean;
	/** Restrict the export to these column fields (in order). Defaults to the displayed columns. */
	columns?: string[];
	/** Only selected rows. Default: false */
	onlySelected?: boolean;
	/** Only these rows, in this order. Takes precedence over onlySelected. */
	rowIds?: string[];
	/** Grouped / tree grids: group rows as collapsible Excel outlines. Default: true. */
	includeGroups?: boolean;
	/** Total rows. Default: true */
	includeTotals?: boolean;
	/** Keep the header in view and give it filter buttons. Default: true */
	freezeHeader?: boolean;
	autoFilter?: boolean;
	/** Locale for currency symbols. Default: the browser's. */
	locale?: string;
}

type CellKind = 'number' | 'date' | 'text';

export interface ColumnPlan {
	col: ColumnDef<any>;
	kind: CellKind;
	/** Excel number format code, for number and date cells. */
	numFmt?: string;
	/** Width in Excel characters. */
	width: number;
}

const escapeXml = (text: string) =>
	text
		.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'))
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function decimalsPattern(decimals: number | undefined, fallback: number): string {
	const d = decimals ?? fallback;
	return d > 0 ? `.${'0'.repeat(d)}` : '';
}

/** The Excel format of a grid number format. */
function numberFormat(format: NumberCellOptions | undefined, locale?: string): string | undefined {
	if (!format) return undefined;
	if (format.format === 'percent') return `0${decimalsPattern(format.decimals, 0)}%`;
	if (format.format === 'currency') {
		let symbol = format.currency ?? '';
		try {
			symbol =
				new Intl.NumberFormat(locale, { style: 'currency', currency: format.currency ?? 'USD' })
					.formatToParts(1)
					.find((p) => p.type === 'currency')?.value ?? symbol;
		} catch {
			// An unknown currency code: keep the code.
		}
		return `"${symbol.replace(/"/g, '')}"#,##0${decimalsPattern(format.decimals, 2)}`;
	}
	// Without fixed decimals, General (a pattern like #,##0.## leaves a trailing point on whole numbers).
	return format.decimals === undefined ? undefined : `#,##0${decimalsPattern(format.decimals, 0)}`;
}

/** Excel's serial day number of a local date and time. */
function excelSerial(date: Date): number {
	const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
	return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

const hasTime = (date: Date) => date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;

function planColumns(cols: ColumnDef<any>[], widths: Record<string, number>, locale?: string): ColumnPlan[] {
	return cols.map((col) => {
		const def = resolveColumnFilterDef(col);
		const px = widths[col.field] ?? col.width ?? 120;
		const width = Math.max(6, Math.min(80, Math.round(px / 7)));
		if (def?.type === 'number' && !def.stars) return { col, kind: 'number', numFmt: numberFormat(def.format, locale), width };
		if (def?.type === 'number') return { col, kind: 'number', width };
		if (def?.type === 'date') return { col, kind: 'date', width };
		return { col, kind: 'text', width };
	});
}

/** Cell styles, registered as used (index 0 is the default). */
class StyleSheet {
	private readonly numFmts = new Map<string, number>();
	private readonly xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
	private readonly byKey = new Map<string, number>([['0|0|0', 0]]);

	style(numFmt: string | undefined, bold: boolean, header = false): number {
		let fmtId = 0;
		if (numFmt) {
			fmtId = this.numFmts.get(numFmt) ?? 164 + this.numFmts.size;
			this.numFmts.set(numFmt, fmtId);
		}
		const font = header || bold ? 1 : 0;
		const key = `${fmtId}|${font}|${header ? 1 : 0}`;
		const known = this.byKey.get(key);
		if (known !== undefined) return known;
		const fill = header ? 2 : 0;
		const border = header ? 1 : 0;
		const apply = `${fmtId ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1" applyBorder="1"' : ''}`;
		this.xfs.push(`<xf numFmtId="${fmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${apply}/>`);
		this.byKey.set(key, this.xfs.length - 1);
		return this.xfs.length - 1;
	}

	xml(): string {
		const fmts = [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('');
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
			(fmts ? `<numFmts count="${this.numFmts.size}">${fmts}</numFmts>` : '') +
			'<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
			'<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
			'<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
			'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
			'<border><left/><right/><top/><bottom style="thin"><color rgb="FFC8CDD5"/></bottom><diagonal/></border></borders>' +
			'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
			`<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
			'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
			'</styleSheet>'
		);
	}
}

interface SheetRow {
	cells: string[];
	outlineLevel?: number;
}

/** The workbook bytes of the export. */
/** What the sheet takes from the grid besides its rows: column widths and the conditional formats to carry over. */
export interface XlsxSheetContext {
	widths: Record<string, number>;
	styleRules?: readonly GridStyleRule<any>[];
}

export async function toXlsx<TRowData>(api: Exportable<TRowData>, context: XlsxSheetContext, options: ExcelExportOptions = {}): Promise<Uint8Array> {
	const { widths } = context;
	const {
		includeHeader = true,
		onlySelected = false,
		rowIds,
		includeGroups = true,
		includeTotals = true,
		freezeHeader = true,
		autoFilter = true,
	} = options;
	const cols = (api.getDisplayedColumns() as unknown as ColumnDef<TRowData>[]).filter(
		(col) => !options.columns || options.columns.includes(col.field)
	);
	const plans = planColumns(cols as ColumnDef<any>[], widths, options.locale);
	const styles = new StyleSheet();
	const rows: SheetRow[] = [];
	let dateTimeFmt: number | null = null;

	const textCell = (ref: string, text: string, style = 0) =>
		text === '' ? '' : `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
	const numberCell = (ref: string, value: number, style: number) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;

	/** A data cell, typed by its column. */
	const dataCell = (plan: ColumnPlan, ref: string, value: unknown, row: TRowData, rowId: string): string => {
		if (value == null || value === '') return '';
		if (plan.kind === 'number' && typeof value === 'number' && Number.isFinite(value))
			return numberCell(ref, value, plan.numFmt ? styles.style(plan.numFmt, false) : 0);
		if (plan.kind === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
			return numberCell(ref, Number(value), plan.numFmt ? styles.style(plan.numFmt, false) : 0);
		if (plan.kind === 'date') {
			const date = parseCellDate(value);
			if (date) {
				const style = hasTime(date) ? (dateTimeFmt ??= styles.style('yyyy-mm-dd hh:mm', false)) : styles.style('yyyy-mm-dd', false);
				return numberCell(ref, excelSerial(date), style);
			}
		}
		const col = plan.col;
		const text = col.valueFormatter
			? col.valueFormatter({ value, rowData: row, colDef: col, rowId } as never)
			: typeof value === 'object'
				? JSON.stringify(value)
				: String(value);
		return textCell(ref, text);
	};

	if (includeHeader) {
		const style = styles.style(undefined, true, true);
		rows.push({ cells: plans.map((plan, i) => textCell(`${columnName(i)}1`, plan.col.header || plan.col.field, style)) });
	}

	const hierarchyRows = !rowIds && !onlySelected ? (api.getHierarchyExportRows?.() ?? null) : null;
	if (hierarchyRows && api.hierarchyCellText) {
		const text = api.hierarchyCellText;
		const bold = styles.style(undefined, true);
		for (const row of hierarchyRows as VisualRow<TRowData>[]) {
			if (row.kind !== 'data' && row.kind !== 'group' && row.kind !== 'total') continue;
			if (row.kind === 'group' && !includeGroups) continue;
			if (row.kind === 'total' && !includeTotals) continue;
			const r = rows.length + 1;
			const level = row.hierarchy.level;
			const cells = plans.map((plan, i) => {
				const ref = `${columnName(i)}${r}`;
				const col = plan.col as ColumnDef<TRowData>;
				if (isHierarchyColumn(col)) {
					const label = row.kind === 'group' ? text(row, col, { withCount: true }) : text(row, col);
					if (!label) return '';
					const indent = hierarchyColumnGroupColId(col) === null ? '    '.repeat(level) : '';
					return textCell(ref, indent + label, row.kind === 'data' ? 0 : bold);
				}
				if (row.kind !== 'data') return textCell(ref, text(row, col), bold);
				return dataCell(plan, ref, api.getCellValue(row.rowId, col.field), row.node.data as TRowData, row.rowId);
			});
			rows.push({ cells, outlineLevel: Math.min(7, level) });
		}
	} else {
		for (const row of exportDataRows(api, { rowIds, onlySelected })) {
			const rowId = api.getRowId(row);
			const r = rows.length + 1;
			rows.push({ cells: plans.map((plan, i) => dataCell(plan, `${columnName(i)}${r}`, api.getCellValue(rowId, plan.col.field), row, rowId)) });
		}
	}

	const lastCol = columnName(Math.max(0, plans.length - 1));
	const outlined = rows.some((row) => row.outlineLevel);
	const sheet =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
		// Group rows sit above their children (Excel's default puts summaries below).
		(outlined ? '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' : '') +
		`<dimension ref="A1:${lastCol}${Math.max(1, rows.length)}"/>` +
		'<sheetViews><sheetView workbookViewId="0">' +
		(includeHeader && freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') +
		'</sheetView></sheetViews>' +
		'<sheetFormatPr defaultRowHeight="15"/>' +
		(plans.length
			? `<cols>${plans.map((plan, i) => `<col min="${i + 1}" max="${i + 1}" width="${plan.width}" customWidth="1"/>`).join('')}</cols>`
			: '') +
		'<sheetData>' +
		rows
			.map((row, i) => `<row r="${i + 1}"${row.outlineLevel ? ` outlineLevel="${row.outlineLevel}"` : ''}>${row.cells.join('')}</row>`)
			.join('') +
		'</sheetData>' +
		(includeHeader && autoFilter && rows.length > 1 && plans.length ? `<autoFilter ref="A1:${lastCol}${rows.length}"/>` : '') +
		conditionalFormattingXml(context.styleRules, plans, includeHeader ? 2 : 1, rows.length) +
		'</worksheet>';

	const sheetName = escapeXml((options.sheetName ?? 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
	return createZip([
		{
			name: '[Content_Types].xml',
			data:
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
				'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
				'<Default Extension="xml" ContentType="application/xml"/>' +
				'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
				'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
				'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
				'</Types>',
		},
		{
			name: '_rels/.rels',
			data:
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
				'</Relationships>',
		},
		{
			name: 'xl/workbook.xml',
			data:
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
				`<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
				(includeHeader && autoFilter && rows.length > 1 && plans.length
					? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${lastCol}$${rows.length}</definedName></definedNames>`
					: '') +
				'</workbook>',
		},
		{
			name: 'xl/_rels/workbook.xml.rels',
			data:
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
				'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
				'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
				'</Relationships>',
		},
		{ name: 'xl/worksheets/sheet1.xml', data: sheet },
		{ name: 'xl/styles.xml', data: styles.xml() },
	]);
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The export as a Blob (to upload, or to save yourself). */
export async function toXlsxBlob<TRowData>(api: Exportable<TRowData>, context: XlsxSheetContext, options: ExcelExportOptions = {}): Promise<Blob> {
	return new Blob([(await toXlsx(api, context, options)) as BlobPart], { type: XLSX_TYPE });
}

export async function exportToXlsx<TRowData>(api: Exportable<TRowData>, context: XlsxSheetContext, options: ExcelExportOptions = {}): Promise<void> {
	triggerDownload(await toXlsxBlob(api, context, options), options.fileName ?? 'export.xlsx');
}
