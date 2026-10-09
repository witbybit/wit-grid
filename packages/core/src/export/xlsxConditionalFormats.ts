import type { GridStyleRule, ValueScaleRule } from '../columnDef.js';
import { resolveCellColor, type CellColor } from '../cells/palette.js';

/**
 * The grid's conditional formats (colour scales, data bars, icon sets) as native Excel ones, so the
 * sheet keeps them live: edit a number in Excel and its colour, bar or icon follows.
 */

/** Excel's own soft red / amber / green, for scales left on the grid's defaults. */
const EXCEL_SCALE = ['FFF8696B', 'FFFFEB84', 'FF63BE7B'];
const EXCEL_BAR = 'FF638EC6';

const ICON_SETS: Record<NonNullable<Extract<ValueScaleRule, { kind: 'iconSet' }>['icons']>, string> = {
	arrows: '3Arrows',
	dots: '3TrafficLights1',
	// Excel has no three-bar signal; its four-bar rating starts at one bar lit, so the lowest band
	// never shows and the three bands read as two, three and four bars.
	signal: '4Rating',
};

/** Excel's column letters: A..Z, AA.. */
export const columnName = (index: number): string => {
	let name = '';
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	return name;
};

/** A CSS hex or palette colour as Excel ARGB, mixed toward white by `lighten` (0..1); null for anything else. */
export function toArgb(colour: string | undefined, lighten = 0): string | null {
	const resolved = colour ? (resolveCellColor(colour as CellColor) ?? colour) : undefined;
	const match = resolved?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (!match) return null;
	const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
	const channel = (i: number) => {
		const value = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		return Math.round(value + (255 - value) * lighten)
			.toString(16)
			.padStart(2, '0');
	};
	return `FF${channel(0)}${channel(1)}${channel(2)}`.toUpperCase();
}

const cfvo = (type: 'min' | 'max' | 'num' | 'percent' | 'percentile', val?: number) =>
	val === undefined ? `<cfvo type="${type}"/>` : `<cfvo type="${type}" val="${Number(val.toFixed(6))}"/>`;

function ruleXml(rule: ValueScaleRule, priority: number): string {
	const low = rule.min !== undefined ? cfvo('num', rule.min) : cfvo('min');
	const high = rule.max !== undefined ? cfvo('num', rule.max) : cfvo('max');
	if (rule.kind === 'colorScale') {
		// Custom colours are lightened as the grid tints them, so text stays readable in Excel too.
		const colours = rule.colors?.map((c) => toArgb(c, 0.45)) ?? null;
		const palette = colours && colours.every(Boolean) ? (colours as string[]) : null;
		if (rule.colors?.length === 2) {
			const [a, b] = palette ?? [EXCEL_SCALE[0], EXCEL_SCALE[2]];
			return `<cfRule type="colorScale" priority="${priority}"><colorScale>${low}${high}<color rgb="${a}"/><color rgb="${b}"/></colorScale></cfRule>`;
		}
		const [a, m, b] = palette ?? EXCEL_SCALE;
		const middle = rule.mid !== undefined ? cfvo('num', rule.mid) : cfvo('percentile', 50);
		return `<cfRule type="colorScale" priority="${priority}"><colorScale>${low}${middle}${high}<color rgb="${a}"/><color rgb="${m}"/><color rgb="${b}"/></colorScale></cfRule>`;
	}
	if (rule.kind === 'dataBar') {
		return `<cfRule type="dataBar" priority="${priority}"><dataBar>${low}${high}<color rgb="${toArgb(rule.color) ?? EXCEL_BAR}"/></dataBar></cfRule>`;
	}
	const [lowT, highT] = rule.thresholds ?? [1 / 3, 2 / 3];
	// Bands split at fractions of the range: percent of it, or numbers between a fixed min and max.
	const fixed = rule.min !== undefined && rule.max !== undefined;
	const at = (t: number) => (fixed ? cfvo('num', rule.min! + t * (rule.max! - rule.min!)) : cfvo('percent', t * 100));
	const set = ICON_SETS[rule.icons ?? 'arrows'];
	const points = set === '4Rating' ? [at(0), at(0), at(lowT), at(highT)] : [at(0), at(lowT), at(highT)];
	return `<cfRule type="iconSet" priority="${priority}"><iconSet iconSet="${set}"${rule.reverse ? ' reverse="1"' : ''}>${points.join('')}</iconSet></cfRule>`;
}

/** `<conditionalFormatting>` blocks for the value-scale rules on exported columns, over their data rows. */
export function conditionalFormattingXml(
	rules: readonly GridStyleRule<any>[] | undefined,
	plans: readonly { col: { field: string } }[],
	firstRow: number,
	lastRow: number
): string {
	if (!rules || lastRow < firstRow) return '';
	let priority = 0;
	let xml = '';
	plans.forEach((plan, index) => {
		const own = rules.filter(
			(rule): rule is ValueScaleRule =>
				(rule.kind === 'colorScale' || rule.kind === 'dataBar' || rule.kind === 'iconSet') && rule.field === plan.col.field
		);
		if (own.length === 0) return;
		const column = columnName(index);
		xml += `<conditionalFormatting sqref="${column}${firstRow}:${column}${lastRow}">${own.map((rule) => ruleXml(rule, ++priority)).join('')}</conditionalFormatting>`;
	});
	return xml;
}
