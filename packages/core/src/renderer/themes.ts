/**
 * Wit Grid Theme System
 *
 * Complete CSS variable architecture for light/dark modes and custom themes.
 * Supports runtime theme switching via ThemeManager and custom theme injection.
 *
 * Design: shadcn-style tokens organized by semantic purpose (colors, sizing, typography).
 * Users can extend the token set or switch built-in themes through the core theme API.
 */

export interface ThemeTokens {
	/* ─────────────────────────────────────────────────────────────────────
     Typography & Fonts
     ───────────────────────────────────────────────────────────────────── */
	fontFamily: string;

	/* ─────────────────────────────────────────────────────────────────────
     Base Colors (backgrounds, text, borders)
     ───────────────────────────────────────────────────────────────────── */
	bgColor: string;
	textColor: string;
	borderColor: string;
	borderColorAccent: string; // slightly brighter border for emphasis

	/* ─────────────────────────────────────────────────────────────────────
     Header Styling
     ───────────────────────────────────────────────────────────────────── */
	headerBg: string;
	headerText: string;

	/* ─────────────────────────────────────────────────────────────────────
     Row & Cell States
     ───────────────────────────────────────────────────────────────────── */
	rowHoverBg: string;
	cellBorder: string;

	/* ─────────────────────────────────────────────────────────────────────
     Selection & Focus
     ───────────────────────────────────────────────────────────────────── */
	selectionBorder: string;
	selectionBg: string;
	focusRing: string; // Primary accent color used for focus and highlights
	/** Text on the accent colour (active items, ticks, badges). Default white. */
	accentContrast?: string;

	/* ─────────────────────────────────────────────────────────────────────
     Pin Column Styling (vertical dividers between pinned/center/pinned)
     ───────────────────────────────────────────────────────────────────── */
	pinLeftBorderColor: string;
	pinRightBorderColor: string;
	pinLeftShadow: string;
	pinRightShadow: string;

	/* ─────────────────────────────────────────────────────────────────────
     Skeleton Loading (shimmer animation)
     ───────────────────────────────────────────────────────────────────── */
	skeletonStart: string;
	skeletonMid: string;
	skeletonEnd: string;
	skeletonWidth: string;
	skeletonHeight: string;
	skeletonBorderRadius: string;
	skeletonAnimationDuration: string;

	/* ─────────────────────────────────────────────────────────────────────
     Group Rows
     ───────────────────────────────────────────────────────────────────── */
	groupRowBg: string;
	groupRowHoverBg: string;
	groupRowText: string;
	groupRowFontSize: string;
	groupRowFontWeight: string;
	groupBadgeBg: string;
	groupBadgeBorder: string;
	groupBadgeText: string;

	/* ─────────────────────────────────────────────────────────────────────
     Detail Rows
     ───────────────────────────────────────────────────────────────────── */
	detailRowBg: string;
	detailRowBorder: string;
	detailRowText: string;
	detailRowFontSize: string;

	/* ─────────────────────────────────────────────────────────────────────
     Popover & Menu (context menu, header menu, filters)
     ───────────────────────────────────────────────────────────────────── */
	popoverBg: string;
	popoverBorder: string;
	popoverText: string;
	popoverItemHoverBg: string;
	popoverItemActiveBg: string;
	popoverDivider: string;
	popoverInputBg: string;
	popoverInputBorder: string;

	/* ─────────────────────────────────────────────────────────────────────
     Semantic Status Colors
     ───────────────────────────────────────────────────────────────────── */
	/** Color used for validation errors: cell outline, badge background, tooltip accent. */
	error: string;

	/* ─────────────────────────────────────────────────────────────────────
     Read-only Cell
     ───────────────────────────────────────────────────────────────────── */
	readonlyCellBg?: string;
	readonlyCellOpacity?: string;

	/* ─────────────────────────────────────────────────────────────────────
     Filter Chip Bar
     ───────────────────────────────────────────────────────────────────── */
	filterChipBarBg?: string;
	filterChipBg?: string;
	filterChipBorder?: string;
	filterChipColor?: string;

	/* ─────────────────────────────────────────────────────────────────────
     Floating Filter Row
     ───────────────────────────────────────────────────────────────────── */
	/** Background of the floating filter row. Defaults to headerBg when unset. */
	floatingFilterBg?: string;
	/** Background of filter inputs inside the floating filter row. */
	floatingFilterInputBg?: string;
	/** Border color of filter inputs inside the floating filter row. */
	floatingFilterInputBorder?: string;

	/* ─────────────────────────────────────────────────────────────────────
     Outer Container Shape
     ───────────────────────────────────────────────────────────────────── */
	/** Border radius of the grid's outer container (e.g. "8px", "0", "16px"). */
	outerBorderRadius?: string;

	/* ─────────────────────────────────────────────────────────────────────
     Sizing Tokens (optional but commonly needed)
     ───────────────────────────────────────────────────────────────────── */
	leafHeaderHeight?: string;
	groupPanelHeight?: string;
	bottomChromeHeight?: string;
	totalHeaderHeight?: string;

	/**
	 * Optional frosted-glass treatment for floating surfaces, headers, and pinned rows.
	 * It is deliberately opt-in because backdrop blur can add paint work while scrolling.
	 */
	glass?: GlassThemeOptions;
}

/** Controls the opt-in frosted-glass treatment emitted by a theme. */
export interface GlassThemeOptions {
	/** Blur radius applied behind glass surfaces. Defaults to `24px`. */
	blur?: string;
	/** Backdrop saturation. Defaults to `160%`. */
	saturation?: string;
	/** Tint for menus, editors, tooltips, and chart windows. */
	tint?: string;
	/** Tint for column headers and sidebar rails. */
	headerTint?: string;
	/** Tint for pinned rows. */
	pinnedTint?: string;
}

/** The handful of colours (and a font) a whole theme is made from. */
export interface ThemePalette {
	appearance: 'light' | 'dark';
	/** A CSS font stack; the first family is used when the page has loaded it. */
	font: string;
	/** The grid body. */
	background: string;
	/** Header, floating-filter row and other chrome. */
	surface: string;
	/** Popovers and menus. */
	raised: string;
	text: string;
	/** Header text and secondary text. */
	muted: string;
	border: string;
	/** A stronger border (emphasis, skeleton shimmer). */
	borderStrong: string;
	/** Focus, selection, active items, badges. */
	accent: string;
	/** The accent as text on the background (badges, links). Default: the accent. */
	accentText?: string;
	/** Row hover. */
	hover: string;
	error: string;
	/** The outer corner radius. Default '8px'. */
	radius?: string;
	/** Inputs inside popovers and the floating-filter row. */
	inputBackground?: string;
	/**
	 * Enables frosted surfaces for menus, editors, tooltips, charts, headers, and pinned rows.
	 * Disabled by default to keep the regular scrolling path as cheap as possible.
	 */
	glass?: boolean | GlassThemeOptions;
}

function hexToRgb(hex: string): [number, number, number] | null {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return null;
	const h = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A hex colour at an opacity (plain rgba, so canvases and every browser read it). */
function alpha(hex: string, a: number): string {
	const rgb = hexToRgb(hex);
	return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})` : hex;
}

/** Text that reads on the colour: near-black on light accents, white on dark ones. */
function contrastOn(hex: string): string {
	const rgb = hexToRgb(hex);
	if (!rgb) return '#ffffff';
	const [r, g, b] = rgb.map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#0b0d12' : '#ffffff';
}

/**
 * A complete theme from a palette: selection, popovers, group and detail rows, skeletons and
 * pinned-column shadows all follow from a few colours.
 *
 * @example
 * api.setTheme(createTheme({ ...myPalette, accent: '#0ea5e9' }));
 */
export function createTheme(p: ThemePalette): ThemeTokens {
	const dark = p.appearance === 'dark';
	const accentText = p.accentText ?? p.accent;
	const input = p.inputBackground ?? (dark ? alpha(p.borderStrong, 0.35) : p.background);
	const glass = p.glass
		? {
				blur: p.glass === true ? '24px' : (p.glass.blur ?? '24px'),
				saturation: p.glass === true ? '160%' : (p.glass.saturation ?? '160%'),
				tint: p.glass === true ? alpha(p.raised, dark ? 0.46 : 0.58) : (p.glass.tint ?? alpha(p.raised, dark ? 0.46 : 0.58)),
				headerTint: p.glass === true ? alpha(p.surface, dark ? 0.42 : 0.54) : (p.glass.headerTint ?? alpha(p.surface, dark ? 0.42 : 0.54)),
				pinnedTint: p.glass === true ? alpha(p.surface, dark ? 0.52 : 0.62) : (p.glass.pinnedTint ?? alpha(p.surface, dark ? 0.52 : 0.62)),
			}
		: undefined;
	return {
		fontFamily: p.font,

		bgColor: p.background,
		textColor: p.text,
		borderColor: p.border,
		borderColorAccent: p.borderStrong,

		headerBg: p.surface,
		headerText: p.muted,

		rowHoverBg: p.hover,
		cellBorder: alpha(p.border, dark ? 0.75 : 0.8),

		selectionBorder: alpha(p.accent, 0.7),
		selectionBg: alpha(p.accent, dark ? 0.14 : 0.1),
		focusRing: p.accent,
		accentContrast: contrastOn(p.accent),

		pinLeftBorderColor: dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)',
		pinRightBorderColor: dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)',
		pinLeftShadow: dark ? '4px 0 14px rgba(0, 0, 0, 0.45)' : '4px 0 10px rgba(0, 0, 0, 0.06)',
		pinRightShadow: dark ? '-4px 0 14px rgba(0, 0, 0, 0.45)' : '-4px 0 10px rgba(0, 0, 0, 0.06)',

		skeletonStart: p.border,
		skeletonMid: p.borderStrong,
		skeletonEnd: p.border,
		skeletonWidth: '75%',
		skeletonHeight: '14px',
		skeletonBorderRadius: '4px',
		skeletonAnimationDuration: '1.5s',

		groupRowBg: alpha(p.accent, dark ? 0.06 : 0.05),
		groupRowHoverBg: alpha(p.accent, dark ? 0.11 : 0.09),
		groupRowText: p.text,
		groupRowFontSize: '13px',
		groupRowFontWeight: '600',
		groupBadgeBg: alpha(p.accent, 0.16),
		groupBadgeBorder: alpha(p.accent, 0.36),
		groupBadgeText: accentText,

		detailRowBg: alpha(p.accent, 0.03),
		detailRowBorder: alpha(p.accent, 0.12),
		detailRowText: p.muted,
		detailRowFontSize: '12px',

		popoverBg: p.raised,
		popoverBorder: alpha(p.text, dark ? 0.1 : 0.12),
		popoverText: p.text,
		popoverItemHoverBg: alpha(p.text, dark ? 0.07 : 0.05),
		popoverItemActiveBg: p.accent,
		popoverDivider: alpha(p.text, 0.08),
		popoverInputBg: input,
		popoverInputBorder: alpha(p.text, dark ? 0.12 : 0.16),

		error: p.error,

		readonlyCellBg: dark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
		readonlyCellOpacity: dark ? '0.65' : '0.55',

		floatingFilterBg: p.surface,
		floatingFilterInputBg: input,
		floatingFilterInputBorder: p.border,

		outerBorderRadius: p.radius ?? '8px',

		leafHeaderHeight: '40px',
		groupPanelHeight: '42px',
		bottomChromeHeight: '0px',
		totalHeaderHeight: '40px',

		glass,
	};
}

/* Font stacks: each falls back to fonts every system has. */
const FONTS = {
	inter: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
	jakarta: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif",
	plex: "'IBM Plex Sans', 'Segoe UI', system-ui, -apple-system, sans-serif",
	dmSans: "'DM Sans', 'Segoe UI', system-ui, -apple-system, sans-serif",
	grotesk: "'Space Grotesk', 'Avenir Next', 'Segoe UI', system-ui, sans-serif",
	sourceSans: "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif",
	mono: "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, Menlo, Consolas, monospace",
	serif: "'Source Serif 4', 'Iowan Old Style', Charter, Georgia, ui-serif, serif",
	lexend: "'Lexend', 'Segoe UI', system-ui, -apple-system, sans-serif",
	rounded: "'Nunito', 'SF Pro Rounded', ui-rounded, 'Segoe UI', system-ui, sans-serif",
	sheets: "'Roboto', 'Segoe UI', Arial, system-ui, sans-serif",
	system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

/** Dark: neutral graphite with an indigo accent. The default. */
export const DARK_THEME: ThemeTokens = createTheme({
	appearance: 'dark',
	font: FONTS.inter,
	background: '#0b0d12',
	surface: '#08090d',
	raised: '#12151c',
	text: '#e6e9ef',
	muted: '#98a1b2',
	border: '#1d2330',
	borderStrong: '#2c3444',
	accent: '#6d7cff',
	accentText: '#a5b0ff',
	hover: '#141821',
	error: '#f05252',
});

/** Light: crisp white with a blue accent. */
export const LIGHT_THEME: ThemeTokens = createTheme({
	appearance: 'light',
	font: FONTS.inter,
	background: '#ffffff',
	surface: '#f7f8fa',
	raised: '#ffffff',
	text: '#111827',
	muted: '#4b5563',
	border: '#e5e7eb',
	borderStrong: '#d1d5db',
	accent: '#2563eb',
	accentText: '#1d4ed8',
	hover: '#f3f5f9',
	error: '#dc2626',
});

/** Dark frosted surfaces with cool-blue highlights. */
export const GLASS_DARK_THEME: ThemeTokens = createTheme({
	appearance: 'dark',
	font: FONTS.inter,
	background: '#0b1020',
	surface: '#111a30',
	raised: '#17213a',
	text: '#edf3ff',
	muted: '#a9b8d3',
	border: '#2a3855',
	borderStrong: '#465b82',
	accent: '#7c9cff',
	accentText: '#b8c8ff',
	hover: '#18233d',
	error: '#fb7185',
	radius: '12px',
	glass: true,
});

/** Bright frosted surfaces with a cobalt-blue accent. */
export const GLASS_LIGHT_THEME: ThemeTokens = createTheme({
	appearance: 'light',
	font: FONTS.inter,
	background: '#eef4ff',
	surface: '#dfeaff',
	raised: '#ffffff',
	text: '#17233b',
	muted: '#52627d',
	border: '#c4d2ec',
	borderStrong: '#9db3d8',
	accent: '#3267dc',
	accentText: '#2554bd',
	hover: '#e1ebfb',
	error: '#dc2626',
	radius: '12px',
	glass: true,
});

/**
 * Theme registry - built-in themes users can reference by name
 */
export const BUILT_IN_THEMES = {
	dark: DARK_THEME,
	light: LIGHT_THEME,
	'glass-dark': GLASS_DARK_THEME,
	'glass-light': GLASS_LIGHT_THEME,
	/** Deep sea navy with a cyan glow. */
	ocean: createTheme({
		appearance: 'dark',
		font: FONTS.jakarta,
		background: '#071a24',
		surface: '#05141d',
		raised: '#0b2230',
		text: '#d9f1f7',
		muted: '#7fb3c4',
		border: '#123241',
		borderStrong: '#1d4758',
		accent: '#22d3ee',
		accentText: '#67e8f9',
		hover: '#0c2735',
		error: '#fb7185',
		radius: '10px',
	}),
	/** Arctic slate with frost-blue accents (Nord). */
	fjord: createTheme({
		appearance: 'dark',
		font: FONTS.plex,
		background: '#2e3440',
		surface: '#292e39',
		raised: '#3b4252',
		text: '#eceff4',
		muted: '#aab3c5',
		border: '#3b4252',
		borderStrong: '#4c566a',
		accent: '#88c0d0',
		accentText: '#8fbcbb',
		hover: '#353b49',
		error: '#e07a83',
		radius: '10px',
		inputBackground: '#353b49',
	}),
	/** Midnight plum with a neon-pink accent. */
	velvet: createTheme({
		appearance: 'dark',
		font: FONTS.dmSans,
		background: '#191626',
		surface: '#14111f',
		raised: '#221d33',
		text: '#ece6ff',
		muted: '#a99bd1',
		border: '#2b2440',
		borderStrong: '#3d3459',
		accent: '#ff6ec7',
		accentText: '#ff9ad8',
		hover: '#221c33',
		error: '#ff6b81',
		radius: '12px',
	}),
	/** Warm charcoal lit with amber. */
	ember: createTheme({
		appearance: 'dark',
		font: FONTS.grotesk,
		background: '#17120e',
		surface: '#110d0a',
		raised: '#201913',
		text: '#f4e9df',
		muted: '#bfa58d',
		border: '#2c221a',
		borderStrong: '#3e3024',
		accent: '#f59e0b',
		accentText: '#fbbf24',
		hover: '#211912',
		error: '#f87171',
	}),
	/** Deep pine with emerald highlights. */
	forest: createTheme({
		appearance: 'dark',
		font: FONTS.sourceSans,
		background: '#0d1712',
		surface: '#09120e',
		raised: '#13201a',
		text: '#e3f1e8',
		muted: '#8fb5a0',
		border: '#1b2d24',
		borderStrong: '#274034',
		accent: '#34d399',
		accentText: '#6ee7b7',
		hover: '#13221b',
		error: '#f87171',
	}),
	/** A terminal: monospace, black and grey, a green cursor. */
	mono: createTheme({
		appearance: 'dark',
		font: FONTS.mono,
		background: '#0c0c0c',
		surface: '#070707',
		raised: '#151515',
		text: '#e4e4e4',
		muted: '#8a8a8a',
		border: '#222222',
		borderStrong: '#363636',
		accent: '#4ade80',
		accentText: '#86efac',
		hover: '#181818',
		error: '#f87171',
		radius: '0px',
	}),
	/** Cream paper, ink and a terracotta pen: a serif for reading. */
	paper: createTheme({
		appearance: 'light',
		font: FONTS.serif,
		background: '#fbf7ef',
		surface: '#f3ecdf',
		raised: '#fffdf8',
		text: '#2b2620',
		muted: '#6b5f50',
		border: '#e6dccb',
		borderStrong: '#d6c8b2',
		accent: '#c2410c',
		accentText: '#9a3412',
		hover: '#f5eee2',
		error: '#b91c1c',
		radius: '6px',
	}),
	/** Soft lavender-grey with a violet accent (Catppuccin Latte). */
	latte: createTheme({
		appearance: 'light',
		font: FONTS.lexend,
		background: '#eff1f5',
		surface: '#e6e9ef',
		raised: '#ffffff',
		text: '#4c4f69',
		muted: '#6c6f85',
		border: '#ccd0da',
		borderStrong: '#bcc0cc',
		accent: '#8839ef',
		accentText: '#7c3aed',
		hover: '#e6e9f2',
		error: '#d20f39',
		radius: '10px',
		inputBackground: '#ffffff',
	}),
	/** Rosewater and raspberry, with rounded type. */
	blossom: createTheme({
		appearance: 'light',
		font: FONTS.rounded,
		background: '#fffafb',
		surface: '#fdf0f3',
		raised: '#ffffff',
		text: '#3b2a30',
		muted: '#8a6470',
		border: '#f3dde3',
		borderStrong: '#e9c4cf',
		accent: '#e11d74',
		accentText: '#be185d',
		hover: '#fdf2f5',
		error: '#dc2626',
		radius: '14px',
	}),
	/** Excel / Google Sheets: hairlines, grey headers, a green cursor. */
	spreadsheet: createTheme({
		appearance: 'light',
		font: FONTS.sheets,
		background: '#ffffff',
		surface: '#f3f3f3',
		raised: '#ffffff',
		text: '#202124',
		muted: '#444444',
		border: '#d0d0d0',
		borderStrong: '#bdbdbd',
		accent: '#0f9d58',
		accentText: '#0b8043',
		hover: '#f5f5f5',
		error: '#c0392b',
		radius: '0px',
	}),
	/** Black and white with a bright blue focus: the strongest contrast. */
	'dark-hc': createTheme({
		appearance: 'dark',
		font: FONTS.system,
		background: '#000000',
		surface: '#0a0a0a',
		raised: '#0a0a0a',
		text: '#ffffff',
		muted: '#e5e5e5',
		border: '#6b6b6b',
		borderStrong: '#a3a3a3',
		accent: '#58a6ff',
		hover: '#1c1c1c',
		error: '#ff6b6b',
		inputBackground: '#000000',
	}),
	/** White and black with a deep blue focus: the strongest contrast. */
	'light-hc': createTheme({
		appearance: 'light',
		font: FONTS.system,
		background: '#ffffff',
		surface: '#f0f0f0',
		raised: '#ffffff',
		text: '#000000',
		muted: '#1a1a1a',
		border: '#767676',
		borderStrong: '#4d4d4d',
		accent: '#0040c1',
		hover: '#e8eefc',
		error: '#b00020',
	}),
} as const;

export type BuiltInThemeName = keyof typeof BUILT_IN_THEMES;

export const BUILT_IN_THEME_ORDER: BuiltInThemeName[] = [
	'dark',
	'light',
	'glass-dark',
	'glass-light',
	'ocean',
	'fjord',
	'velvet',
	'ember',
	'forest',
	'mono',
	'paper',
	'latte',
	'blossom',
	'spreadsheet',
	'dark-hc',
	'light-hc',
];

export const BUILT_IN_THEME_METADATA: Record<BuiltInThemeName, { label: string; description: string; appearance: 'light' | 'dark'; font: string }> = {
	dark: { label: 'Dark', description: 'Neutral graphite with an indigo accent.', appearance: 'dark', font: 'Inter' },
	light: { label: 'Light', description: 'Crisp white with a blue accent.', appearance: 'light', font: 'Inter' },
	'glass-dark': { label: 'Glass dark', description: 'Frosted navy surfaces with a cool-blue accent.', appearance: 'dark', font: 'Inter' },
	'glass-light': { label: 'Glass light', description: 'Bright frosted surfaces with a cobalt-blue accent.', appearance: 'light', font: 'Inter' },
	ocean: { label: 'Ocean', description: 'Deep sea navy with a cyan glow.', appearance: 'dark', font: 'Plus Jakarta Sans' },
	fjord: { label: 'Fjord', description: 'Arctic slate with frost-blue accents.', appearance: 'dark', font: 'IBM Plex Sans' },
	velvet: { label: 'Velvet', description: 'Midnight plum with a neon-pink accent.', appearance: 'dark', font: 'DM Sans' },
	ember: { label: 'Ember', description: 'Warm charcoal lit with amber.', appearance: 'dark', font: 'Space Grotesk' },
	forest: { label: 'Forest', description: 'Deep pine with emerald highlights.', appearance: 'dark', font: 'Source Sans 3' },
	mono: { label: 'Mono', description: 'A terminal: monospace, greys and a green cursor.', appearance: 'dark', font: 'JetBrains Mono' },
	paper: { label: 'Paper', description: 'Cream paper, ink and terracotta, in a serif.', appearance: 'light', font: 'Source Serif 4' },
	latte: { label: 'Latte', description: 'Soft lavender-grey with a violet accent.', appearance: 'light', font: 'Lexend' },
	blossom: { label: 'Blossom', description: 'Rosewater and raspberry, rounded type.', appearance: 'light', font: 'Nunito' },
	spreadsheet: { label: 'Spreadsheet', description: 'Excel / Google Sheets: hairlines and a green cursor.', appearance: 'light', font: 'Roboto' },
	'dark-hc': { label: 'High contrast dark', description: 'Black, white and a bright blue focus.', appearance: 'dark', font: 'System' },
	'light-hc': { label: 'High contrast light', description: 'White, black and a deep blue focus.', appearance: 'light', font: 'System' },
};

/**
 * Google Fonts families the built-in themes use (a stylesheet URL to add to your page). Without
 * them each theme falls back to its system font stack.
 */
export const BUILT_IN_THEME_FONTS_URL =
	'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Lexend:wght@400;500;600;700&family=Nunito:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Roboto:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&family=Source+Serif+4:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap';

export function isBuiltInThemeName(value: string): value is BuiltInThemeName {
	return value in BUILT_IN_THEMES;
}

/**
 * Get the full token set for a built-in theme. `ThemeTokens` is a plain flat object, so a
 * themed variant of a built-in is just a spread — no helper function needed:
 *
 * @example
 * export const acmeTheme: ThemeTokens = {
 *   ...getBuiltInTheme('light'),
 *   focusRing: '#1e2148',
 *   selectionBg: 'rgba(30, 33, 72, 0.08)',
 * };
 *
 * api.setTheme(acmeTheme);
 */
export function getBuiltInTheme(themeName: BuiltInThemeName): ThemeTokens {
	return BUILT_IN_THEMES[themeName];
}

/**
 * Convert a theme object to CSS custom properties string.
 * Used to inject theme variables into the document.
 */
export function themeToCSSVariables(theme: ThemeTokens, selector = '.og-grid-container'): string {
	const varName = (key: string): string => {
		return '--og-' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
	};

	const lines = [`${selector} {`];
	for (const [key, value] of Object.entries(theme)) {
		if (key !== 'glass' && value !== undefined) {
			lines.push(`  ${varName(key)}: ${value};`);
		}
	}
	if (theme.glass) {
		const glass = theme.glass;
		lines.push(`  --og-glass-backdrop-filter: blur(${glass.blur ?? '24px'}) saturate(${glass.saturation ?? '160%'});`);
		lines.push(`  --og-glass-popover-bg: ${glass.tint ?? theme.popoverBg};`);
		lines.push(`  --og-glass-header-bg: ${glass.headerTint ?? theme.headerBg};`);
		lines.push(`  --og-glass-pinned-bg: ${glass.pinnedTint ?? theme.headerBg};`);
		lines.push(`  --og-glass-border: ${theme.borderColorAccent};`);
	}
	lines.push('}');
	return lines.join('\n');
}

/**
 * ThemeManager - runtime theme switching and injection
 *
 * Manages theme state and provides APIs for:
 * - Getting/setting the active theme
 * - Switching between built-in themes
 * - Injecting custom theme variables
 * - Event-based theme change notifications
 */
export class ThemeManager {
	private currentTheme: ThemeTokens;
	private currentThemeName: BuiltInThemeName | null;
	private styleElement: HTMLStyleElement | null = null;
	private listeners: Set<(theme: ThemeTokens) => void> = new Set();
	private selector = '.og-grid-container';

	constructor(initialTheme: ThemeTokens = DARK_THEME, initialThemeName: BuiltInThemeName | null = 'dark') {
		this.currentTheme = initialTheme;
		this.currentThemeName = initialThemeName;
	}

	/**
	 * Mount the theme manager - injects style element into the document.
	 * Call after the grid container is created but before rendering.
	 */
	public mount(selector = this.selector): void {
		if (typeof document === 'undefined') return;
		this.selector = selector;

		if (!this.styleElement) {
			this.styleElement = document.createElement('style');
			this.styleElement.setAttribute('data-theme-manager', 'true');
			document.head.appendChild(this.styleElement);
		}

		this.updateStyleElement(selector);
	}

	/**
	 * Unmount the theme manager - removes the injected style element.
	 */
	public unmount(): void {
		if (this.styleElement?.parentElement) {
			this.styleElement.parentElement.removeChild(this.styleElement);
			this.styleElement = null;
		}
	}

	/**
	 * Get the currently active theme.
	 */
	public getTheme(): ThemeTokens {
		return this.currentTheme;
	}

	/**
	 * Returns the active built-in theme name, or null when a custom theme is active.
	 */
	public getThemeName(): BuiltInThemeName | null {
		return this.currentThemeName;
	}

	/**
	 * Set a custom theme and apply it immediately.
	 */
	public setTheme(theme: ThemeTokens, selector?: string): void {
		this.currentTheme = theme;
		this.currentThemeName = null;
		this.updateStyleElement(selector);
		this.notifyListeners();
	}

	/**
	 * Switch to a built-in theme by name.
	 */
	public switchTheme(themeName: BuiltInThemeName, selector?: string): void {
		const theme = BUILT_IN_THEMES[themeName];
		if (!theme) {
			console.warn(`Unknown theme: ${themeName}`);
			return;
		}
		this.currentTheme = theme;
		this.currentThemeName = themeName;
		this.updateStyleElement(selector);
		this.notifyListeners();
	}

	/**
	 * Merge partial theme with current theme (shallow merge).
	 * Useful for tweaking specific variables while keeping the rest.
	 */
	public mergeTheme(partial: Partial<ThemeTokens>, selector?: string): void {
		const merged = { ...this.currentTheme, ...partial };
		this.setTheme(merged, selector);
	}

	/**
	 * Get all built-in theme names.
	 */
	public getAvailableThemes(): BuiltInThemeName[] {
		return BUILT_IN_THEME_ORDER.slice();
	}

	/**
	 * Subscribe to theme changes.
	 * Returns an unsubscribe function.
	 */
	public onThemeChange(listener: (theme: ThemeTokens) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Detect system color scheme preference and apply appropriate theme.
	 * Returns true if dark mode is preferred, false if light mode.
	 */
	public static detectSystemPreference(): boolean {
		if (typeof window === 'undefined') return true; // Default to dark for SSR
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	/**
	 * Create a theme manager that syncs with system color scheme.
	 * Automatically switches between light and dark themes based on system preference.
	 */
	public static createSystemAware(): ThemeManager {
		const isDark = this.detectSystemPreference();
		const manager = new ThemeManager(isDark ? DARK_THEME : LIGHT_THEME);

		if (typeof window !== 'undefined') {
			const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			const listener = (e: MediaQueryListEvent | MediaQueryList) => {
				manager.setTheme(e.matches ? DARK_THEME : LIGHT_THEME);
			};

			// Modern browsers support addEventListener
			if (mediaQuery.addEventListener) {
				mediaQuery.addEventListener('change', listener);
			} else {
				// Fallback for legacy browsers (not type-safe in modern TypeScript)
				(mediaQuery as any).addListener(listener);
			}
		}

		return manager;
	}

	private updateStyleElement(selector?: string): void {
		if (!this.styleElement) return;
		this.styleElement.textContent = themeToCSSVariables(this.currentTheme, selector ?? this.selector);
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener(this.currentTheme);
		}
	}
}
