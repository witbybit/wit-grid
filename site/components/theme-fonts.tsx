'use client';

import { BUILT_IN_THEME_FONTS_URL } from '@eregister/wit-grid-react';

/** The built-in grid themes' fonts (the hero switches themes). React hoists the stylesheet into <head>. */
export function ThemeFonts() {
	return <link rel='stylesheet' href={BUILT_IN_THEME_FONTS_URL} precedence='default' />;
}
