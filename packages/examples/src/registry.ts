import { meta as basicGrid } from './demos/basic-grid/meta';
import { meta as persistence } from './demos/persistence/meta';
import { meta as rowSelection } from './demos/row-selection/meta';
import type { WitGridExampleMeta } from './types';

const promotedShowcases = [
	{
		id: 'infinite-server-scroll',
		title: 'Infinite server scroll',
		description: 'Server-side row model with block loading, sort/filter handoff, selection persistence, and load telemetry.',
		category: 'Row models',
		level: 'advanced',
		tags: ['infinite row model', 'server data', 'virtualization'],
		docs: '/docs/next/server-side-data',
		showcase: true,
		sourcePath: 'packages/examples/src/showcases/InfiniteServerScroll.tsx',
	},
	{
		id: 'advanced-filters',
		title: 'Advanced filters',
		description: 'Text, select, async, infinite, custom filters, global quick search, and named workspace views.',
		category: 'Filtering',
		level: 'advanced',
		tags: ['filters', 'quick filter', 'views'],
		docs: '/docs/next/filtering',
		showcase: true,
		sourcePath: 'packages/examples/src/showcases/AdvancedFiltersDemo.tsx',
	},
	{
		id: 'row-drag',
		title: 'Row drag and drop',
		description: 'Managed and host-driven row reordering with drag lifecycle events and programmatic ordering.',
		category: 'Editing',
		level: 'intermediate',
		tags: ['row drag', 'ordering', 'events'],
		docs: '/docs/next/events',
		showcase: true,
		sourcePath: 'packages/examples/src/showcases/RowDragDemo.tsx',
	},
	{
		id: 'native-cell-types',
		title: 'Native cell types',
		description: 'Built-in checkbox, multi-select, date, dropdown, number, and tag-style cells with editors.',
		category: 'Editing',
		level: 'intermediate',
		tags: ['cell types', 'editors', 'renderers'],
		docs: '/docs/next/columns',
		showcase: true,
		sourcePath: 'packages/examples/src/showcases/NativeCellTypesDemo.tsx',
	},
	{
		id: 'data-integrity',
		title: 'Data integrity lab',
		description: 'Quality checks, dataset diffing, streamed updates, and conflict markers on the same grid.',
		category: 'Validation',
		level: 'advanced',
		tags: ['validation', 'diff', 'conflicts'],
		docs: '/docs/next/events',
		showcase: true,
		sourcePath: 'packages/examples/src/showcases/DataIntegrityLab.tsx',
	},
	{
		id: 'realtime-dashboard',
		title: 'Realtime dashboard',
		description:
			'A 400-row live portfolio grid comparing DOM, imperative React, and standard React cell renderers side by side, plus the data integrity pipeline.',
		category: 'Rendering',
		level: 'advanced',
		tags: ['renderers', 'performance', 'data integrity'],
		docs: '/docs/next/columns',
		showcase: true,
		sourcePath: 'packages/examples/src/showcases/RealtimeDashboard.tsx',
	},
] satisfies WitGridExampleMeta[];

export const allExamples = [basicGrid, rowSelection, persistence, ...promotedShowcases] as const;

export const showcaseExamples = allExamples.filter((example) => example.showcase);
