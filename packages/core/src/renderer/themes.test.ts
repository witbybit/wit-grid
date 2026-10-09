import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, createTheme, themeToCSSVariables } from './themes.js';

const palette = {
	appearance: 'dark' as const,
	font: 'system-ui',
	background: '#101418',
	surface: '#0b0e11',
	raised: '#171c22',
	text: '#e8edf2',
	muted: '#93a1b0',
	border: '#1f2730',
	borderStrong: '#2d3844',
	accent: '#00d4ff',
	hover: '#161c22',
	error: '#ff6b6b',
};

describe('glass themes', () => {
	it('keeps glass disabled unless a palette opts in', () => {
		const css = themeToCSSVariables(createTheme(palette));
		expect(css).not.toContain('--og-glass-backdrop-filter');
	});

	it('emits glass variables with palette-derived defaults', () => {
		const theme = createTheme({ ...palette, glass: true });
		const css = themeToCSSVariables(theme);

		expect(theme.glass).toMatchObject({ blur: '24px', saturation: '160%' });
		expect(css).toContain('--og-glass-backdrop-filter: blur(24px) saturate(160%)');
		expect(css).toContain('--og-glass-popover-bg: rgba(23, 28, 34, 0.46)');
		expect(css).toContain('--og-glass-header-bg: rgba(11, 14, 17, 0.42)');
	});

	it('supports custom glass surface values and ships both glass presets', () => {
		const css = themeToCSSVariables(
			createTheme({ ...palette, glass: { blur: '12px', saturation: '125%', tint: 'rgba(1, 2, 3, .6)' } })
		);

		expect(css).toContain('--og-glass-backdrop-filter: blur(12px) saturate(125%)');
		expect(css).toContain('--og-glass-popover-bg: rgba(1, 2, 3, .6)');
		expect(BUILT_IN_THEMES['glass-dark'].glass).toBeDefined();
		expect(BUILT_IN_THEMES['glass-light'].glass).toBeDefined();
	});
});
