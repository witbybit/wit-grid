# Open Grid CSS Theming System

Complete guide to the advanced theming system in Open Grid. Build advanced CSS styling/theming natively with support for light/dark modes, custom themes, and runtime switching.

## Overview

Open Grid provides a **modern, shadcn-style theming system** with:

- ✅ Built-in light & dark themes
- ✅ High-contrast accessibility themes
- ✅ Pre-built branded themes (Cool Blue, Warm Orange, Minimal Monochrome)
- ✅ Runtime theme switching with zero configuration
- ✅ System color scheme detection (prefers-color-scheme)
- ✅ Custom theme composition
- ✅ Partial theme merging
- ✅ Event-based theme change notifications
- ✅ CSS-variable based (no JS-in-CSS overhead)

All theme interaction from consumer code goes through `GridApi` — the same `api` object you get from `onGridReady` or `useGridApi()`. There is no separate theming object to construct or manage; the grid owns its own theme state internally and `GridApi` is the front door to it.

## Quick Start

### 1. Setting the theme when the grid is created

Set a built-in theme name declaratively via `initialState`. This is resolved once, atomically, before the grid's first paint — no flash of the default theme.

```tsx
<Grid
	initialState={{ themeName: 'light' }}
	// ...
/>
```

Framework-agnostic (`@eregister/open-grid-core`) equivalent:

```typescript
import { createClientGrid } from '@eregister/open-grid-core';

const api = createClientGrid(config);

// Via GridHost interface (recommended)
host.switchTheme('light'); // Switch to light theme
host.switchTheme('dark-hc'); // Switch to high-contrast dark
host.switchTheme('cool-blue'); // Modern tech aesthetic

// Or get the theme manager directly
const themeManager = host.setTheme?.toString(); // Access via host methods
```

### 2. Using ThemeManager Directly

```typescript
import { ThemeManager, DARK_THEME } from '@eregister/open-grid-core';

const manager = new ThemeManager(DARK_THEME);
manager.mount(); // Inject theme into document

// Switch themes
manager.switchTheme('light');
manager.switchTheme('cool-blue');

// Get current theme
const theme = manager.getTheme();

// Subscribe to changes
const unsubscribe = manager.onThemeChange((theme) => {
	console.log('Theme changed:', theme);
});
```

### 2. Switching themes at runtime

Get `api` from `onGridReady` (React) or the return value of `createClientGrid`/`createInfiniteGrid`/`createServerPageGrid` (core), then call the theme methods directly on it:

````typescript
import { createTheme, ThemeManager } from '@eregister/open-grid-core';

### 3. Composing a custom theme

`ThemeTokens` is a plain flat object — a themed variant of a built-in theme is just a spread, no helper function required:

```typescript
import { getBuiltInTheme, type ThemeTokens } from '@eregister/open-grid-core';

export const acmeTheme: ThemeTokens = {
	...getBuiltInTheme('light'),
	bgColor: '#1a1a2e',
	textColor: '#eaeaea',
	focusRing: '#00d4ff',
	headerBg: '#0f0f1e',
	headerText: '#b0b0b0',
};
````

Apply it in one of two ways:

```typescript
// Declaratively, at grid creation — atomic, no flicker:
<Grid initialState={{ themeOverrides: acmeTheme }} />

// Or imperatively at runtime, via the grid api:
api.setTheme(acmeTheme);
```

For small, incremental tweaks on top of whatever theme is currently active, use `mergeTheme` instead of `setTheme`:

```typescript
api.mergeTheme({
	focusRing: '#10b981', // just the accent color
	selectionBg: 'rgba(16, 185, 129, 0.1)',
});
```

Or declare the initial tweaks up front, alongside a base theme name — both are resolved together before first paint:

```tsx
<Grid
	initialState={{
		themeName: 'light',
		themeOverrides: { focusRing: '#1e2148', selectionBg: 'rgba(30, 33, 72, 0.08)' },
	}}
/>
```

### 4. System color scheme detection

`ThemeManager.detectSystemPreference()` is a standalone static helper (no grid instance needed) — use it to pick the right built-in theme name up front:

```typescript
import { ThemeManager } from '@eregister/open-grid-core';

const prefersDark = ThemeManager.detectSystemPreference();

<Grid initialState={{ themeName: prefersDark ? 'dark' : 'light' }} />
```

To keep the grid in sync as the OS preference changes live, listen for the media query change yourself and call `api.switchTheme()`:

```typescript
useEffect(() => {
	const mql = window.matchMedia('(prefers-color-scheme: dark)');
	const onChange = (e: MediaQueryListEvent) => api.switchTheme(e.matches ? 'dark' : 'light');
	mql.addEventListener('change', onChange);
	return () => mql.removeEventListener('change', onChange);
}, [api]);
```

## Built-In Themes

### Dark (Default)

High-contrast, professional dark theme optimized for extended viewing and reduced eye strain.

```typescript
import { DARK_THEME } from '@eregister/open-grid-core';
```

### Light

Clean, bright professional theme for daytime use.

```typescript
import { LIGHT_THEME } from '@eregister/open-grid-core';
```

### High-Contrast Light (`light-hc`)

Enhanced light theme with stronger contrasts for better accessibility.

```typescript
import { HIGH_CONTRAST_LIGHT_THEME } from '@eregister/open-grid-core';
```

### High-Contrast Dark (`dark-hc`)

Enhanced dark theme with stronger contrasts for better accessibility.

```typescript
import { HIGH_CONTRAST_DARK_THEME } from '@eregister/open-grid-core';
```

### Cool Blue (`cool-blue`)

Modern tech aesthetic with cool blue accent tones.

```typescript
import { COOL_BLUE_THEME } from '@eregister/open-grid-core';
```

### Warm Orange (`warm-orange`)

Energetic, warm aesthetic with orange accent tones.

```typescript
import { WARM_ORANGE_THEME } from '@eregister/open-grid-core';
```

### Minimal Monochrome (`minimal-monochrome`)

Ultra-clean, minimalist monochrome theme.

```typescript
import { MINIMAL_MONOCHROME_THEME } from '@eregister/open-grid-core';
```

All built-in themes are also reachable by name via `getBuiltInTheme(name)` and `BUILT_IN_THEMES[name]`, which is generally more convenient than importing each theme constant individually.

## Theme Tokens

A complete theme defines **40+ CSS variables** organized by semantic purpose:

### Base Colors

- `bgColor` - Primary background
- `textColor` - Primary text
- `borderColor` - Standard border
- `borderColorAccent` - Emphasized border

### Header

- `headerBg` - Header background
- `headerText` - Header text color

### Interactive States

- `rowHoverBg` - Row hover state
- `cellBorder` - Cell border color
- `selectionBg` - Selection background
- `selectionBorder` - Selection border
- `focusRing` - Focus indicator (primary accent)

### Pinned Columns

- `pinLeftBorderColor` - Left pin border
- `pinRightBorderColor` - Right pin border
- `pinLeftShadow` - Left pin shadow
- `pinRightShadow` - Right pin shadow

### Loading States

- `skeletonStart` - Shimmer start color
- `skeletonMid` - Shimmer middle color
- `skeletonEnd` - Shimmer end color
- `skeletonWidth` - Skeleton element width
- `skeletonHeight` - Skeleton element height
- `skeletonBorderRadius` - Skeleton border radius
- `skeletonAnimationDuration` - Shimmer animation speed

### Group Rows

- `groupRowBg` - Group row background
- `groupRowHoverBg` - Group row hover background
- `groupRowText` - Group row text color
- `groupRowFontSize` - Group row font size
- `groupRowFontWeight` - Group row font weight
- `groupBadgeBg` - Count badge background
- `groupBadgeBorder` - Count badge border
- `groupBadgeText` - Count badge text color

### Detail Rows

- `detailRowBg` - Detail row background
- `detailRowBorder` - Detail row border
- `detailRowText` - Detail row text color
- `detailRowFontSize` - Detail row font size

### Popovers & Menus

- `popoverBg` - Popover background
- `popoverBorder` - Popover border
- `popoverText` - Popover text color
- `popoverItemHoverBg` - Menu item hover background
- `popoverItemActiveBg` - Menu item active background
- `popoverDivider` - Menu divider color
- `popoverInputBg` - Input/select background
- `popoverInputBorder` - Input/select border

### Sizing (Optional)

- `leafHeaderHeight` - Single header row height
- `groupPanelHeight` - Group panel height
- `bottomChromeHeight` - Status bar + pagination height
- `totalHeaderHeight` - Total header height (with grouping)

## Theming API

### ThemeTokens Interface

```typescript
interface ThemeTokens {
	fontFamily: string;
	bgColor: string;
	textColor: string;
	borderColor: string;
	borderColorAccent: string;
	headerBg: string;
	headerText: string;
	rowHoverBg: string;
	cellBorder: string;
	selectionBorder: string;
	selectionBg: string;
	focusRing: string;
	// ... 30+ more tokens
}
```

### GridApi theme methods

This is the API surface every consumer should reach for — obtained via `onGridReady`/`useGridApi()` in React, or as the return value of `createClientGrid`/`createInfiniteGrid`/`createServerPageGrid` in core:

```typescript
interface GridApi<TRowData> {
	getTheme(): ThemeTokens;
	getThemeName(): BuiltInThemeName | null; // null once a fully custom theme is active
	getAvailableThemes(): BuiltInThemeName[];
	switchTheme(themeName: string): void; // reset to a built-in theme by name
	mergeTheme(partial: Partial<ThemeTokens>): void; // tweak specific tokens, keep the rest
	setTheme(theme: ThemeTokens): void; // replace the active theme wholesale
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;
	// ... plus everything else on GridApi
}
```

### Helper functions

```typescript
// Get a built-in theme's full token set (compose your own variant with a plain spread)
function getBuiltInTheme(themeName: BuiltInThemeName): ThemeTokens;

// Convert theme to CSS custom properties
function themeToCSSVariables(theme: ThemeTokens, selector?: string): string;

// Available theme names
type BuiltInThemeName = 'light' | 'dark' | 'light-hc' | 'dark-hc' | 'cool-blue' | 'warm-orange' | 'minimal-monochrome' | 'spreadsheet';

// Pre-built theme registry
const BUILT_IN_THEMES: Record<BuiltInThemeName, ThemeTokens>;
```

## Advanced Usage

### 1. Merging themes

Modify specific tokens while keeping the rest, at any point after the grid is created:

```typescript
import { ThemeManager, DARK_THEME } from '@eregister/open-grid-core';

const manager = new ThemeManager(DARK_THEME);
manager.mount();

// Change just the accent color and selection background
api.mergeTheme({
	focusRing: '#10b981', // Emerald instead of blue
	selectionBg: 'rgba(16, 185, 129, 0.1)',
	groupBadgeText: '#34d399',
});
```

### 2. Dynamic Theme Switching

````typescript
import { useCallback, useEffect, useState } from 'react';
import { createClientGrid } from '@eregister/open-grid-core';

```tsx
function DynamicThemeExample() {
	const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');
	const [api, setApi] = useState<GridApi<Row> | null>(null);

	useEffect(() => {
		api?.switchTheme(themeMode);
	}, [api, themeMode]);

	return (
		<div>
			<button onClick={() => setThemeMode('light')}>Light</button>
			<button onClick={() => setThemeMode('dark')}>Dark</button>
			<Grid onGridReady={(event) => setApi(event.api)} /* ...rest of grid config */ />
		</div>
	);
}
````

### 3. System preference sync

```typescript
import { ThemeManager } from '@eregister/open-grid-core';

// Pick the initial theme from the OS preference, before the grid ever mounts
const initialThemeName = ThemeManager.detectSystemPreference() ? 'dark' : 'light';

// ...then keep it in sync as the OS preference changes (see Quick Start §4 above)
```

### 4. Custom theme from brand guidelines

```typescript
import { createTheme, ThemeManager } from '@eregister/open-grid-core';

	// Brand primary
	focusRing: '#6366f1', // Indigo

	// Light backgrounds
	bgColor: '#f8fafc',
	headerBg: '#f1f5f9',
	rowHoverBg: '#e2e8f0',

	// Typography
	textColor: '#1e293b',
	headerText: '#475569',

	// Interactive
	selectionBg: 'rgba(99, 102, 241, 0.08)',
	selectionBorder: 'rgba(99, 102, 241, 0.6)',

	// Popovers
	popoverBg: 'rgba(248, 250, 252, 0.98)',
	popoverItemHoverBg: 'rgba(99, 102, 241, 0.08)',
	popoverItemActiveBg: '#6366f1',
};

api.setTheme(brandTheme);
// or, declaratively at creation:
<Grid initialState={{ themeOverrides: brandTheme }} />
```

### 5. Exporting theme configuration

```typescript
import { themeToCSSVariables } from '@eregister/open-grid-core';

const theme = { ...getBuiltInTheme('dark'), focusRing: '#00d4ff' };
const cssText = themeToCSSVariables(theme);

// Output as a .css file, or embed in style tag
console.log(cssText);
// :root, .og-grid-container {
//   --og-bg-color: ...;
//   --og-text-color: ...;
//   ...
// }
```

## Integration with the low-level host (`@eregister/open-grid-core` internal)

If you're building a custom framework adapter directly on `mountGridHost` (rather than using `<Grid>` from `@eregister/open-grid-react`), the same theme methods are also available directly on the returned host object:

```typescript
import { mountGridHost } from '@eregister/open-grid-core/internal';

const host = mountGridHost(api, container);

host.switchTheme('light');
host.setTheme(customTheme);
const theme = host.getTheme();

const unsubscribe = host.onThemeChange((theme) => {
	console.log('Theme changed');
});
```

Most consumers should never need this — reach for `GridApi` (the object you already have from `onGridReady`/`createClientGrid`) instead. `GridApi`'s theme methods delegate to the same underlying renderer once a host is mounted, and remain safely inert (rather than throwing) before mount.

## CSS Variable Customization

All theme variables are CSS custom properties, so you can override them directly on the container:

```html
<div id="grid" style="--og-bg-color: #1a1a2e; --og-focus-ring: #00d4ff;">
	<!-- Grid will render with custom colors -->
</div>
```

Or via stylesheets:

```css
.og-grid-container {
	--og-bg-color: #1a1a2e;
	--og-text-color: #eaeaea;
	--og-focus-ring: #00d4ff;
	/* ... override other tokens */
}
```

## CSS Theme Studio Demo

Open Grid includes an interactive CSS Theme Studio component to:

- Preview all built-in themes
- Inspect theme tokens live
- Export theme configuration code
- Test custom color combinations

```tsx
import { CSSThemeStudio } from './components/CSSThemeStudio';

function App() {
	const [api, setApi] = useState<GridApi<Row> | null>(null);

	return (
		<>
			<CSSThemeStudio onThemeSelect={(themeName, theme) => api?.setTheme(theme)} />
			<Grid onGridReady={(event) => setApi(event.api)} /* ...rest of grid config */ />
		</>
	);
}
```

## Performance Characteristics

- **Zero runtime overhead**: All theming via CSS custom properties (no JS calculations)
- **Instant switching**: Theme change = style element update (no re-render)
- **SSR-safe**: theme resolution detects SSR and skips DOM operations
- **Memory efficient**: single shared style element per mounted grid
- **No flash**: `initialState.themeName`/`themeOverrides` are resolved atomically before the grid's first paint — no default-theme flicker, no imperative call needed on mount

## Best Practices

1. **Use semantic token names** when creating themes (e.g., `selectionBg` not `blue42`)
2. **Test with accessibility themes** (`light-hc`, `dark-hc`) for contrast
3. **Detect system preference up front** via `ThemeManager.detectSystemPreference()` and pass the result as `initialState.themeName`
4. **Persist theme choice** in localStorage for user preference
5. **Use `mergeTheme`** for small tweaks rather than a full `setTheme` replacement
6. **Monitor color contrast** when creating custom themes
7. **Avoid hardcoding colors** in component styles; use CSS variables instead

## Troubleshooting

### Theme not applying?

1. Set it via `initialState.themeName`/`themeOverrides` for the initial theme, or `api.switchTheme()`/`api.mergeTheme()`/`api.setTheme()` for changes after mount — not by trying to reach into the renderer directly.
2. Check that any custom CSS selectors targeting `--og-*` variables don't have higher specificity than the grid's own scoped theme selector.
3. Confirm `api` in your `onGridReady` handler is the one actually attached to the `<Grid>` instance on screen (a common bug when multiple grids are mounted at once).

### Style flash on load?

`initialState.themeName` and `initialState.themeOverrides` are both resolved atomically before the grid's first paint, so there is no flash as long as you set them there rather than switching themes in a `useEffect`/`onGridReady` callback after the grid has already mounted:

```tsx
// No flash — resolved before first paint:
<Grid initialState={{ themeName: 'light', themeOverrides: { focusRing: '#1e2148' } }} />

// Avoid — the default theme paints first, then flips:
<Grid onGridReady={({ api }) => api.switchTheme('light')} />
```

### Custom theme colors look wrong?

Ensure you're providing colors in the right format:

- Hex: `#3b82f6`
- RGB: `rgb(59, 130, 246)`
- RGBA: `rgba(59, 130, 246, 0.5)`
- CSS keywords: `transparent`, `inherit`

## Examples

See the CSS Theme Studio demo component (`demo/src/components/CSSThemeStudio.tsx`) for interactive examples of:

- Theme switching
- Token inspection
- Code export
- Live preview with all built-in themes

## Accessibility

Open Grid includes two high-contrast themes specifically designed for accessibility:

- **Light HC** (`light-hc`): Enhanced light theme with WCAG AA+ contrasts
- **Dark HC** (`dark-hc`): Enhanced dark theme with WCAG AA+ contrasts

Always test your custom themes against accessibility guidelines.

## Future Enhancements

Potential future additions to the theming system:

- [ ] Theme editor UI component
- [ ] Theme export/import (JSON)
- [ ] Local storage persistence adapter
- [ ] Runtime theme animation (smooth color transitions)
- [ ] Per-component theme overrides
- [ ] Theme preset library and marketplace
