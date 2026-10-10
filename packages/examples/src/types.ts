import type { ComponentType } from 'react';

export type WitGridExampleLevel = 'basic' | 'intermediate' | 'advanced';

export type WitGridExampleCategory =
	| 'Getting started'
	| 'Selection'
	| 'State'
	| 'Row models'
	| 'Filtering'
	| 'Editing'
	| 'Grouping'
	| 'Validation'
	| 'Rendering'
	| 'Views';

export type WitGridExampleMeta = {
	id: string;
	title: string;
	description: string;
	category: WitGridExampleCategory;
	level: WitGridExampleLevel;
	tags: string[];
	docs: string;
	showcase: boolean;
	sourcePath: string;
};

export type WitGridExampleModule = {
	meta: WitGridExampleMeta;
	Component: ComponentType;
};

/**
 * The shared "host chrome" contract every showcase component should accept, on top of whatever
 * example-specific props it already has (onGridReady, onCellValueChanged, etc).
 *
 * A showcase is free to render as much hand-built chrome around its `<Grid>` as it wants — side
 * panels, toolbars, activity logs, legends — but every one of those SHOULD be gated behind
 * `!compact` (default `compact` to `false`, so nothing changes for a host that doesn't pass it,
 * like the demo app). A consuming host that's tight on space — most notably the docs site's
 * example gallery when *not* in its fullscreen sandbox — passes `compact` to strip that chrome
 * down to just the grid (plus, at most, a minimal single-line status strip). The gallery expands
 * back to the component's full richness in fullscreen by passing `compact={false}`.
 *
 * `theme` is a lighter-weight convention some showcases also use to re-tint hand-rolled renderers
 * that can't just inherit CSS variables (canvas/DOM/imperative cell renderers) to match the host
 * page's light/dark mode.
 */
export type WitGridExampleRuntimeProps = {
	compact?: boolean;
	theme?: 'light' | 'dark';
};
