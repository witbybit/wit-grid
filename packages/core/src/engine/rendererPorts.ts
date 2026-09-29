import type { RenderStats } from '../renderer/renderTelemetry.js';
import { createEmptyRenderStats } from '../renderer/renderTelemetry.js';
import type { ThemeTokens, BuiltInThemeName } from '../renderer/themes.js';
import { DARK_THEME } from '../renderer/themes.js';

/**
 * Contract for rendering capabilities that are available only when a renderer is mounted.
 * DOM-specific methods (getContainer) return null in headless contexts.
 */
export interface RendererPort {
	requestRender(reason: string): void;
	getStats(): RenderStats;
	resetStats(): void;
	getContainer(): HTMLElement | null;
	scrollCellIntoView(rowId: string, colField: string): void;
	scrollRowIntoView(rowId: string): void;
}

/**
 * Contract for theme capabilities. Headless context returns a stable default theme.
 */
export interface ThemePort {
	getTheme(): ThemeTokens;
	getThemeName(): BuiltInThemeName | null;
	getAvailableThemes(): BuiltInThemeName[];
	switchTheme(themeName: string): void;
	mergeTheme(partial: Partial<ThemeTokens>): void;
	setTheme(theme: ThemeTokens): void;
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;
}

/**
 * Aggregate of all runtime ports available to the API facade.
 * Ports are mutable host capability bindings with a headless fallback;
 * use bindRuntimePorts() / unbindRuntimePorts() to manage the lifecycle.
 */
export interface GridRuntimePorts {
	renderer: RendererPort;
	theme: ThemePort;
}

/** No-op renderer port for headless / server-side / test contexts. */
export const headlessRendererPort: RendererPort = {
	requestRender: () => {},
	getStats: () => createEmptyRenderStats(),
	resetStats: () => {},
	getContainer: () => null,
	scrollCellIntoView: () => {},
	scrollRowIntoView: () => {},
};

/** Default theme port for headless contexts — returns dark theme tokens, accepts but ignores mutations. */
export const headlessThemePort: ThemePort = {
	getTheme: () => DARK_THEME,
	getThemeName: () => null,
	getAvailableThemes: () => [],
	switchTheme: () => {},
	mergeTheme: () => {},
	setTheme: () => {},
	onThemeChange: () => () => {},
};

/** Stable singleton headless ports object. Avoids allocation on every renderer unmount. */
export const HEADLESS_PORTS: GridRuntimePorts = { renderer: headlessRendererPort, theme: headlessThemePort };

/** Opaque token returned by a successful bindRuntimePorts(). Captures the binding generation to detect stale host callbacks. */
export interface RuntimePortBinding {
	readonly generation: number;
}

/**
 * Result of bindRuntimePorts().
 * ok=false means the current ports are unchanged — the caller must not mount.
 */
export type RuntimePortBindResult =
	| { readonly ok: true; readonly binding: RuntimePortBinding }
	| { readonly ok: false; readonly reason: 'already-bound' | 'destroyed' };
