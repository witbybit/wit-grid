export type DocSection = {
	id: string;
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
		group: 'Start',
		title: 'Introduction',
		description: 'A serious data grid engine for React applications that need speed, control, and long-session resilience.',
		body: [
			'Wit Grid separates the data engine from framework rendering. The core package owns row models, viewport planning, state, events, and diagnostics; the React package provides ergonomic components and hooks on top.',
			'The docs site is organized around production workflows: start fast, choose the right row model, wire columns and editing, then go deep on events, API methods, performance, and theming.',
		],
		checklist: ['Framework-agnostic core', 'React adapter', 'Virtualized rows and columns', 'Editing, filtering, grouping, diagnostics'],
	},
	{
		id: 'installation',
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
		group: 'Start',
		title: 'Quick Start',
		description: 'Render your first grid with explicit client mode and typed columns.',
		body: [
			'The quickest path is the single public Grid component. Pass rows, columns, and an explicit mode. Capture the API with onGridReady when page-level controls need to drive the grid.',
		],
		code: `import { Grid, type ColumnDef } from '@eregister/wit-grid-react';

type Invoice = { id: string; customer: string; total: number; status: string };

const columns: ColumnDef<Invoice>[] = [
  { field: 'customer', headerName: 'Customer' },
  { field: 'total', headerName: 'Total', type: 'number' },
  { field: 'status', headerName: 'Status' },
];

export function InvoiceGrid({ rows }: { rows: Invoice[] }) {
  return <Grid mode="client" rows={rows} columns={columns} />;
}`,
	},
	{
		id: 'columns',
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
		id: 'events',
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
		group: 'Customization',
		title: 'Theming',
		description: 'Use built-in themes, CSS variables, or theme tokens to align the grid with your product interface.',
		body: [
			'Wit Grid theming should feel like shadcn-quality infrastructure: tasteful defaults, explicit tokens, and easy overrides. The docs should show every token with live previews.',
			'The existing theming guide becomes this section, split into practical recipes: dark mode, high contrast, compact density, custom palettes, and runtime switching.',
		],
		checklist: ['Theme tokens', 'CSS variables', 'Built-in themes', 'Runtime switching', 'Accessibility contrast guidance'],
	},
	{
		id: 'performance',
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
