export type DocSection = {
	id: string;
	path: string;
	group: string;
	title: string;
	description: string;
	body: string[];
	code?: string;
	checklist?: string[];
};

export type ApiEntry = {
	name: string;
	kind: 'component' | 'hook' | 'type' | 'event' | 'method';
	packageName: '@eregister/wit-grid-react' | '@eregister/wit-grid-core';
	description: string;
};

export type ExampleCard = {
	title: string;
	description: string;
	tags: string[];
	code: string;
};

export const docSections: DocSection[] = [
	{
		id: 'introduction',
		path: '/docs/introduction',
		group: 'Start',
		title: 'Introduction',
		description: 'What Wit Grid is, which packages it exposes, and where the public surface is stable.',
		body: [
			'Wit Grid is a lightweight, framework-agnostic grid engine for high-performance virtualized spreadsheets and data grids.',
			'The core package owns row models, viewport planning, state, events, persistence, diagnostics, and rendering coordination. The React package provides the supported React component and hook surface on top of that engine.',
		],
		checklist: [
			'@eregister/wit-grid-core for headless usage',
			'@eregister/wit-grid-react for React apps',
			'experimental exports may change during alpha',
		],
	},
	{
		id: 'installation',
		path: '/docs/installation',
		group: 'Start',
		title: 'Installation',
		description: 'Install the React adapter for application work, or the core package for a custom framework integration.',
		body: [
			'Most apps should start with the React package. It re-exports the public types developers use day to day, including column definitions, grid APIs, events, renderers, and style rules.',
			'Use the core package directly when you are building a custom adapter, a headless integration, or a test harness around the engine.',
		],
		code: `pnpm add @eregister/wit-grid-react @eregister/wit-grid-core`,
	},
	{
		id: 'quick-start',
		path: '/docs/quick-start',
		group: 'Start',
		title: 'Quick Start',
		description: 'Render your first grid with explicit client mode and typed columns.',
		body: [
			'The simplest way to use Wit Grid is the single public Grid component. Pick mode="client" or mode="server" explicitly.',
			'Use onGridReady when a parent component needs the GridApi handle outside the grid tree.',
		],
		code: `import { useMemo, useState } from 'react';
import { Grid, type ColumnDef, type GridApi } from '@eregister/wit-grid-react';

type BookRow = {
  id: string;
  title: string;
  author: string;
  price: number;
};

export function BookInventoryGrid() {
  const [api, setApi] = useState<GridApi<BookRow> | null>(null);
  const columns = useMemo<ColumnDef<BookRow>[]>(() => [
    { field: 'id', header: 'Asset ID', width: 100 },
    { field: 'title', header: 'Book Title', width: 250 },
    { field: 'author', header: 'Author', width: 180 },
    { field: 'price', header: 'Price', width: 120 },
  ], []);

  return (
    <Grid
      mode="client"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      onGridReady={({ api }) => setApi(api)}
    />
  );
}`,
	},
	{
		id: 'architecture',
		path: '/docs/architecture',
		group: 'Core Concepts',
		title: 'Architecture',
		description: 'How data, row models, viewport planning, rendering, and adapters fit together.',
		body: [
			'Wit Grid decouples raw record arrays from visual presentation using row nodes, row pipeline stages, viewport planning, and framework adapters.',
			'The core engine is responsible for state, row model composition, event publication, rendering coordination, and diagnostics. Framework packages should depend on the public core API and adapter contracts rather than reaching into engine internals.',
			'The detailed architecture target remains in docs/architecture/core-target.md; this site page is the practical overview for users.',
		],
		checklist: ['RowNode tree', 'VisualRow pipeline', 'GridApi facade', 'Viewport recycler', 'Framework adapter boundary'],
	},
	{
		id: 'columns',
		path: '/docs/columns',
		group: 'Core Concepts',
		title: 'Columns',
		description: 'Columns define field access, headers, renderers, editors, sizing, pinning, filters, and semantic cell types.',
		body: [
			'Column definitions should be stable across renders. Memoize them in React apps, especially when using renderers, editors, value getters, or style rules.',
			'Built-in cell types cover common spreadsheet workflows. Use custom renderers when a cell needs richer presentation, but keep the primitive path for large plain-text surfaces.',
		],
		checklist: ['field and headerName', 'value getters', 'cell renderers', 'cell editors', 'pinning and sizing', 'filter definitions'],
	},
	{
		id: 'row-models',
		path: '/docs/row-models',
		group: 'Core Concepts',
		title: 'Row Models',
		description: 'Choose client rows for local data or server-backed rows for paged and async datasets.',
		body: [
			'Client mode is appropriate when the application already has the full row array in memory and wants local sorting, filtering, grouping, editing, and selection.',
			'Server mode is appropriate when the grid should request ranges as the user scrolls or when filtering and sorting live on the backend.',
		],
		checklist: ['Client row model', 'Server-backed row model', 'Range requests', 'Sort and filter forwarding', 'Request identity'],
	},
	{
		id: 'events',
		path: '/docs/events',
		group: 'Core Concepts',
		title: 'Events',
		description: 'Subscribe to grid lifecycle, editing, selection, viewport, row model, and data mutation events.',
		body: [
			'Events should describe user-observable changes. Use them for application side effects, analytics, persistence, and diagnostics. Use the GridApi for commands and state reads.',
			'Event pages should include when the event fires, payload shape, ordering guarantees, and common examples. This is one of the first references we should auto-generate from public event types.',
		],
		code: `<Grid
  mode="client"
  rows={rows}
  columns={columns}
  onGridReady={({ api }) => setGridApi(api)}
  onCellValueChanged={({ rowId, colField, newValue }) => {
    audit.log('cell.changed', { rowId, colField, newValue });
  }}
/>`,
	},
	{
		id: 'theming',
		path: '/docs/theming',
		group: 'Customization',
		title: 'Theming',
		description: 'Use built-in themes, CSS variables, or theme tokens to align the grid with your product interface.',
		body: [
			'Wit Grid exposes theme tokens and CSS variable output for applications that need product-specific styling.',
			'Use built-in themes for default light, dark, high-contrast, and product-style palettes. Use custom theme tokens when your app needs precise alignment with an existing design system.',
		],
		checklist: ['Theme tokens', 'CSS variables', 'Built-in themes', 'Runtime switching', 'Accessibility contrast guidance'],
	},
	{
		id: 'performance',
		path: '/docs/performance',
		group: 'Production',
		title: 'Performance',
		description: 'Understand virtualization budgets, renderer lifecycles, long-session stability, and diagnostics.',
		body: [
			'Performance docs should be concrete: what is virtualized, what work is bounded per frame, how live renderers are admitted, and which props affect scroll cost.',
			'This is a core differentiator. We should publish benchmark scenarios, adversarial tests, and guidance for keeping renderers cheap.',
		],
		checklist: ['Row and column virtualization', 'Renderer budgets', 'Overscan tuning', 'Long-session resilience', 'Flight recorder diagnostics'],
	},
	{
		id: 'api-reference',
		path: '/api/reference',
		group: 'Reference',
		title: 'API Reference',
		description: 'Public API pages for packages, components, hooks, events, types, and methods.',
		body: [
			'The first version is curated. The next version should generate reference pages from TypeScript declarations so code and docs never drift.',
			'Each reference item needs examples, stability labels, package ownership, and links back to conceptual docs.',
		],
	},
];

export const apiEntries: ApiEntry[] = [
	{
		name: 'Grid',
		kind: 'component',
		packageName: '@eregister/wit-grid-react',
		description: 'Primary React entrypoint for client and server-backed grids.',
	},
	{
		name: 'GridApi',
		kind: 'type',
		packageName: '@eregister/wit-grid-core',
		description: 'Imperative command and state access surface returned by onGridReady and hooks.',
	},
	{
		name: 'ColumnDef',
		kind: 'type',
		packageName: '@eregister/wit-grid-core',
		description: 'Column schema for field access, rendering, editing, filtering, and layout.',
	},
	{
		name: 'GridReadyEvent',
		kind: 'event',
		packageName: '@eregister/wit-grid-core',
		description: 'Lifecycle event fired when a grid instance is ready for API commands.',
	},
	{
		name: 'GridEventName.cellValueChanged',
		kind: 'event',
		packageName: '@eregister/wit-grid-core',
		description: 'Dispatched after a committed cell value changes.',
	},
	{
		name: 'GridEventName.writeBlocked',
		kind: 'event',
		packageName: '@eregister/wit-grid-core',
		description: 'Dispatched when validation, capabilities, or commit rules block a write.',
	},
	{
		name: 'GridEventName.selectionChanged',
		kind: 'event',
		packageName: '@eregister/wit-grid-core',
		description: 'Dispatched when the cell or range selection model changes.',
	},
	{
		name: 'useGridApi',
		kind: 'hook',
		packageName: '@eregister/wit-grid-react',
		description: 'React hook for reading the current grid API from context.',
	},
	{
		name: 'setFilterModel',
		kind: 'method',
		packageName: '@eregister/wit-grid-core',
		description: 'Applies a structured filter model through the public API.',
	},
];

export const examples: ExampleCard[] = [
	{
		title: 'Editable Orders Grid',
		description: 'Client row model, typed columns, number editing, status dropdowns, and change auditing.',
		tags: ['React', 'Editing', 'Events'],
		code: `const columns = [
  { field: 'orderId', headerName: 'Order' },
  { field: 'amount', headerName: 'Amount', type: 'number', editable: true },
  { field: 'status', headerName: 'Status', type: 'dropdown', editable: true },
];`,
	},
	{
		title: 'Server-Side Activity Feed',
		description: 'Block loading, sort and filter model forwarding, and resilient request identity.',
		tags: ['Server', 'Async Rows', 'Performance'],
		code: `const datasource = {
  getRows: async ({ startRow, endRow, sortModel, filterModel }) => {
    return fetchRows({ startRow, endRow, sortModel, filterModel });
  },
};`,
	},
	{
		title: 'Theme Studio',
		description: 'Live theme token previews with light, dark, high contrast, and custom product palettes.',
		tags: ['Theming', 'Design Systems'],
		code: `api.setTheme(createTheme({
  name: 'workspace-dark',
  colors: { accent: '#7c3aed' },
}));`,
	},
];
