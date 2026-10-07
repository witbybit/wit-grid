/**
 * Named hues for option badges, dots and avatars. A badge mixes its hue with the theme's text
 * colour (see cellStyles.ts), so the same name reads well on light and dark themes alike.
 */
export const CELL_HUES = {
	gray: '#71717a',
	red: '#ef4444',
	orange: '#f97316',
	amber: '#f59e0b',
	yellow: '#eab308',
	lime: '#84cc16',
	green: '#22c55e',
	emerald: '#10b981',
	teal: '#14b8a6',
	cyan: '#06b6d4',
	sky: '#0ea5e9',
	blue: '#3b82f6',
	indigo: '#6366f1',
	violet: '#8b5cf6',
	purple: '#a855f7',
	fuchsia: '#d946ef',
	pink: '#ec4899',
	rose: '#f43f5e',
} as const;

export type CellHueName = keyof typeof CELL_HUES;

/** An option colour: a palette name or any CSS colour. */
export type CellColor = CellHueName | (string & {});

const AUTO_HUES: readonly CellHueName[] = [
	'blue',
	'emerald',
	'amber',
	'violet',
	'rose',
	'cyan',
	'orange',
	'pink',
	'teal',
	'indigo',
	'lime',
	'fuchsia',
];

/** The CSS colour for a palette name or a raw CSS colour; undefined for none. */
export function resolveCellColor(color: CellColor | undefined): string | undefined {
	if (!color) return undefined;
	return (CELL_HUES as Record<string, string>)[color] ?? color;
}

/** A stable palette colour for any text (avatars, options without a colour). */
export function hashCellColor(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
	return CELL_HUES[AUTO_HUES[Math.abs(hash) % AUTO_HUES.length]];
}
