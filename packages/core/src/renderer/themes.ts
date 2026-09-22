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
}

/**
 * Light theme - clean, professional appearance
 * Used by default or when explicitly requested
 */
export const LIGHT_THEME: ThemeTokens = {
	fontFamily: "'Outfit', 'Inter', -apple-system, sans-serif",

	bgColor: '#ffffff',
	textColor: '#1a202c',
	borderColor: '#e2e8f0',
	borderColorAccent: '#cbd5e1',

	headerBg: '#f8fafc',
	headerText: '#475569',

	rowHoverBg: '#f1f5f9',
	cellBorder: 'rgba(226, 232, 241, 0.5)',

	selectionBorder: 'rgba(59, 130, 246, 0.6)',
	selectionBg: 'rgba(59, 130, 246, 0.1)',
	focusRing: '#3b82f6',

	pinLeftBorderColor: 'rgba(0, 0, 0, 0.08)',
	pinRightBorderColor: 'rgba(0, 0, 0, 0.08)',
	pinLeftShadow: '-2px 0 8px rgba(0, 0, 0, 0.06)',
	pinRightShadow: '2px 0 8px rgba(0, 0, 0, 0.06)',

	skeletonStart: '#e2e8f0',
	skeletonMid: '#cbd5e1',
	skeletonEnd: '#e2e8f0',
	skeletonWidth: '75%',
	skeletonHeight: '14px',
	skeletonBorderRadius: '4px',
	skeletonAnimationDuration: '1.5s',

	groupRowBg: 'rgba(59, 130, 246, 0.04)',
	groupRowHoverBg: 'rgba(59, 130, 246, 0.08)',
	groupRowText: '#1a202c',
	groupRowFontSize: '13px',
	groupRowFontWeight: '600',
	groupBadgeBg: 'rgba(59, 130, 246, 0.15)',
	groupBadgeBorder: 'rgba(59, 130, 246, 0.3)',
	groupBadgeText: '#2563eb',

	detailRowBg: 'rgba(59, 130, 246, 0.02)',
	detailRowBorder: 'rgba(59, 130, 246, 0.1)',
	detailRowText: '#64748b',
	detailRowFontSize: '12px',

	popoverBg: 'rgba(248, 250, 252, 0.98)',
	popoverBorder: 'rgba(0, 0, 0, 0.08)',
	popoverText: '#1a202c',
	popoverItemHoverBg: 'rgba(59, 130, 246, 0.08)',
	popoverItemActiveBg: '#3b82f6',
	popoverDivider: 'rgba(0, 0, 0, 0.08)',
	popoverInputBg: '#ffffff',
	popoverInputBorder: 'rgba(226, 232, 241, 0.8)',

	error: '#dc2626',

	readonlyCellBg: 'rgba(0, 0, 0, 0.02)',
	readonlyCellOpacity: '0.55',

	floatingFilterBg: '#f1f5f9',
	floatingFilterInputBg: '#ffffff',
	floatingFilterInputBorder: '#e2e8f0',

	outerBorderRadius: '8px',

	leafHeaderHeight: '40px',
	groupPanelHeight: '42px',
	bottomChromeHeight: '0px',
	totalHeaderHeight: '40px',
};

/**
 * Dark theme (default) - optimized for extended viewing
 * High contrast, reduced eye strain, professional appearance
 */
export const DARK_THEME: ThemeTokens = {
	fontFamily: "'Outfit', 'Inter', -apple-system, sans-serif",

	bgColor: '#0d0f12',
	textColor: '#e2e8f0',
	borderColor: '#1e293b',
	borderColorAccent: '#334155',

	headerBg: '#090a0f',
	headerText: '#94a3b8',

	rowHoverBg: '#161b22',
	cellBorder: 'rgba(30, 41, 59, 0.5)',

	selectionBorder: 'rgba(59, 130, 246, 0.6)',
	selectionBg: 'rgba(59, 130, 246, 0.09)',
	focusRing: '#3b82f6',

	pinLeftBorderColor: 'rgba(255, 255, 255, 0.07)',
	pinRightBorderColor: 'rgba(255, 255, 255, 0.07)',
	pinLeftShadow: '4px 0 14px rgba(0, 0, 0, 0.45)',
	pinRightShadow: '-4px 0 14px rgba(0, 0, 0, 0.45)',

	skeletonStart: '#1e293b',
	skeletonMid: '#334155',
	skeletonEnd: '#1e293b',
	skeletonWidth: '75%',
	skeletonHeight: '14px',
	skeletonBorderRadius: '4px',
	skeletonAnimationDuration: '1.5s',

	groupRowBg: 'rgba(15, 23, 42, 0.4)',
	groupRowHoverBg: 'rgba(30, 41, 59, 0.6)',
	groupRowText: '#e2e8f0',
	groupRowFontSize: '13px',
	groupRowFontWeight: '600',
	groupBadgeBg: 'rgba(59, 130, 246, 0.2)',
	groupBadgeBorder: 'rgba(59, 130, 246, 0.4)',
	groupBadgeText: '#60a5fa',

	detailRowBg: 'rgba(255, 255, 255, 0.02)',
	detailRowBorder: 'rgba(255, 255, 255, 0.05)',
	detailRowText: '#a0aec0',
	detailRowFontSize: '12px',

	popoverBg: 'rgba(17, 20, 28, 0.97)',
	popoverBorder: 'rgba(255, 255, 255, 0.08)',
	popoverText: '#e7e9ee',
	popoverItemHoverBg: 'rgba(255, 255, 255, 0.07)',
	popoverItemActiveBg: '#3b82f6',
	popoverDivider: 'rgba(255, 255, 255, 0.07)',
	popoverInputBg: 'rgba(30, 41, 59, 0.7)',
	popoverInputBorder: 'rgba(255, 255, 255, 0.08)',

	error: '#ef4444',

	readonlyCellBg: 'rgba(255, 255, 255, 0.02)',
	readonlyCellOpacity: '0.65',

	floatingFilterBg: '#0c0e13',
	floatingFilterInputBg: 'rgba(30, 41, 59, 0.6)',
	floatingFilterInputBorder: 'rgba(255, 255, 255, 0.08)',

	outerBorderRadius: '8px',

	leafHeaderHeight: '40px',
	groupPanelHeight: '42px',
	bottomChromeHeight: '0px',
	totalHeaderHeight: '40px',
};

/**
 * High-contrast light theme - enhanced accessibility
 * Stronger contrasts for better readability and visibility
 */
export const HIGH_CONTRAST_LIGHT_THEME: ThemeTokens = {
	...LIGHT_THEME,
	textColor: '#000000',
	borderColor: '#cccccc',
	headerText: '#000000',
	groupBadgeText: '#003d99',
	detailRowText: '#333333',
	popoverText: '#000000',
	error: '#b91c1c',
};

/**
 * High-contrast dark theme - enhanced accessibility
 * Stronger contrasts optimized for dark mode
 */
export const HIGH_CONTRAST_DARK_THEME: ThemeTokens = {
	...DARK_THEME,
	textColor: '#ffffff',
	borderColor: '#666666',
	headerText: '#ffffff',
	rowHoverBg: '#1a1f2e',
	groupBadgeText: '#90caf9',
	detailRowText: '#b0bec5',
	popoverText: '#ffffff',
	popoverBg: 'rgba(0, 0, 0, 0.98)',
	error: '#ff4444',
};

/**
 * Cool blue theme - modern tech aesthetic
 */
export const COOL_BLUE_THEME: ThemeTokens = {
	...DARK_THEME,
	bgColor: '#0a1929',
	textColor: '#e3f2fd',
	borderColor: '#1a3a52',
	headerBg: '#051827',
	headerText: '#90caf9',
	rowHoverBg: '#132f4c',
	focusRing: '#2196f3',
	groupBadgeBg: 'rgba(33, 150, 243, 0.2)',
	groupBadgeBorder: 'rgba(33, 150, 243, 0.4)',
	groupBadgeText: '#64b5f6',
	error: '#f87171',
};

/**
 * Warm orange theme - energetic aesthetic
 */
export const WARM_ORANGE_THEME: ThemeTokens = {
	...DARK_THEME,
	bgColor: '#1a0f00',
	textColor: '#ffe4d6',
	borderColor: '#332200',
	headerBg: '#0d0600',
	headerText: '#ffb399',
	rowHoverBg: '#2a1500',
	focusRing: '#ff9800',
	groupBadgeBg: 'rgba(255, 152, 0, 0.2)',
	groupBadgeBorder: 'rgba(255, 152, 0, 0.4)',
	groupBadgeText: '#ffb74d',
	error: '#fb923c',
};

/**
 * Spreadsheet theme - Microsoft Excel / Google Sheets aesthetic
 * Clean white body, light-gray headers, blue accent, hairline borders
 */
export const SPREADSHEET_THEME: ThemeTokens = {
	fontFamily: "'Roboto', 'Segoe UI', -apple-system, sans-serif",

	bgColor: '#ffffff',
	textColor: '#202124',
	borderColor: '#d0d0d0',
	borderColorAccent: '#bdbdbd',

	headerBg: '#f2f2f2',
	headerText: '#444444',

	rowHoverBg: '#f5f5f5',
	cellBorder: 'rgba(0, 0, 0, 0.08)',

	selectionBorder: 'rgba(15, 157, 88, 0.7)',
	selectionBg: 'rgba(15, 157, 88, 0.12)',
	focusRing: '#0f9d58',

	pinLeftBorderColor: '#d0d0d0',
	pinRightBorderColor: '#d0d0d0',
	pinLeftShadow: '2px 0 6px rgba(0, 0, 0, 0.1)',
	pinRightShadow: '-2px 0 6px rgba(0, 0, 0, 0.1)',

	skeletonStart: '#f5f5f5',
	skeletonMid: '#e8e8e8',
	skeletonEnd: '#f5f5f5',
	skeletonWidth: '75%',
	skeletonHeight: '14px',
	skeletonBorderRadius: '2px',
	skeletonAnimationDuration: '1.5s',

	groupRowBg: 'rgba(15, 157, 88, 0.04)',
	groupRowHoverBg: 'rgba(15, 157, 88, 0.08)',
	groupRowText: '#202124',
	groupRowFontSize: '12px',
	groupRowFontWeight: '600',
	groupBadgeBg: 'rgba(15, 157, 88, 0.12)',
	groupBadgeBorder: 'rgba(15, 157, 88, 0.3)',
	groupBadgeText: '#0f9d58',

	detailRowBg: '#fafafa',
	detailRowBorder: '#e0e0e0',
	detailRowText: '#5f6368',
	detailRowFontSize: '12px',

	popoverBg: '#ffffff',
	popoverBorder: 'rgba(0, 0, 0, 0.12)',
	popoverText: '#202124',
	popoverItemHoverBg: 'rgba(15, 157, 88, 0.08)',
	popoverItemActiveBg: '#0f9d58',
	popoverDivider: '#e0e0e0',
	popoverInputBg: '#ffffff',
	popoverInputBorder: '#d0d0d0',

	error: '#c0392b',

	floatingFilterBg: '#f8f9fa',
	floatingFilterInputBg: '#ffffff',
	floatingFilterInputBorder: '#d0d0d0',

	outerBorderRadius: '0px',

	leafHeaderHeight: '40px',
	groupPanelHeight: '42px',
	bottomChromeHeight: '0px',
	totalHeaderHeight: '40px',
};

/**
 * Minimal monochrome theme - ultra-clean aesthetic
 */
export const MINIMAL_MONOCHROME_THEME: ThemeTokens = {
	...DARK_THEME,
	bgColor: '#1a1a1a',
	textColor: '#e8e8e8',
	borderColor: '#2d2d2d',
	headerBg: '#0f0f0f',
	headerText: '#a0a0a0',
	rowHoverBg: '#262626',
	focusRing: '#808080',
	groupBadgeBg: 'rgba(128, 128, 128, 0.15)',
	groupBadgeBorder: 'rgba(128, 128, 128, 0.3)',
	groupBadgeText: '#b0b0b0',
	error: '#c0504d',
};

/**
 * Theme registry - built-in themes users can reference by name
 */
export const BUILT_IN_THEMES = {
	light: LIGHT_THEME,
	dark: DARK_THEME,
	'light-hc': HIGH_CONTRAST_LIGHT_THEME,
	'dark-hc': HIGH_CONTRAST_DARK_THEME,
	'cool-blue': COOL_BLUE_THEME,
	'warm-orange': WARM_ORANGE_THEME,
	'minimal-monochrome': MINIMAL_MONOCHROME_THEME,
	spreadsheet: SPREADSHEET_THEME,
} as const;

export type BuiltInThemeName = keyof typeof BUILT_IN_THEMES;

export const BUILT_IN_THEME_ORDER: BuiltInThemeName[] = [
	'dark',
	'light',
	'dark-hc',
	'light-hc',
	'cool-blue',
	'warm-orange',
	'minimal-monochrome',
	'spreadsheet',
];

export const BUILT_IN_THEME_METADATA: Record<BuiltInThemeName, { label: string; description: string; appearance: 'light' | 'dark' }> = {
	dark: {
		label: 'Dark',
		description: 'High-contrast default tuned for long sessions.',
		appearance: 'dark',
	},
	light: {
		label: 'Light',
		description: 'Clean neutral daylight theme.',
		appearance: 'light',
	},
	'dark-hc': {
		label: 'Dark HC',
		description: 'Dark theme with stronger accessibility contrast.',
		appearance: 'dark',
	},
	'light-hc': {
		label: 'Light HC',
		description: 'Light theme with stronger accessibility contrast.',
		appearance: 'light',
	},
	'cool-blue': {
		label: 'Cool Blue',
		description: 'Blue-forward tech aesthetic.',
		appearance: 'dark',
	},
	'warm-orange': {
		label: 'Warm Orange',
		description: 'Warm amber accents with a dark base.',
		appearance: 'dark',
	},
	'minimal-monochrome': {
		label: 'Mono',
		description: 'Minimal grayscale presentation.',
		appearance: 'dark',
	},
	spreadsheet: {
		label: 'Spreadsheet',
		description: 'Excel / Google Sheets-style daylight theme.',
		appearance: 'light',
	},
};

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
		if (value !== undefined) {
			lines.push(`  ${varName(key)}: ${value};`);
		}
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
