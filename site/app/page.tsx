import Link from 'next/link';
import {
	ArrowRight,
	ArrowUpRight,
	Layers3,
	Rows3,
	SquareStack,
	Palette,
	Database,
	Paintbrush,
	Rocket,
	FlaskConical,
	Terminal,
	ArrowRightLeft,
	Gauge,
} from 'lucide-react';
import { HeroGrid } from '@/components/home/hero-grid';
import { InstallSnippet } from '@/components/home/install-snippet';

const features = [
	{
		title: 'Virtualized at any scale',
		description: 'Cell-level micro-subscriptions repaint only the exact cell that changed — scrolling and editing bypass full-tree re-renders.',
		icon: Layers3,
		tag: 'scrollPresentation',
		gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
	},
	{
		title: 'Grouping, tree data & master-detail',
		description:
			'Fold rows into expandable groups with live aggregates, nest parent-child hierarchies, or embed a full interactive sub-grid per row.',
		icon: Rows3,
		tag: 'groupBy · getParentId',
		gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
	},
	{
		title: 'Client, infinite & server row models',
		description:
			'The same <Grid /> component reads from an in-memory array, a block-loading datasource, or a server-owned query — swap rowModelType, not your code.',
		icon: Database,
		tag: 'rowModelType',
		gradient: 'linear-gradient(135deg, #10b981, #0d9488)',
	},
	{
		title: 'Declarative style rules',
		description: 'Condition row, cell, and header classes on your data with styleRules — compiled once, no per-render style computation.',
		icon: Paintbrush,
		tag: 'styleRules',
		gradient: 'linear-gradient(135deg, #f59e0b, #ea580c)',
	},
	{
		title: 'Eight built-in themes',
		description: 'Runtime theme switching, system color-scheme detection, and full custom theme composition — all through the same GridApi.',
		icon: Palette,
		tag: 'switchTheme()',
		gradient: 'linear-gradient(135deg, #ec4899, #db2777)',
	},
	{
		title: 'Grid-level clipboard & formulas',
		description: 'TSV copy/paste compatible with Excel and Sheets out of the box, plus a per-cell formula API (setFormula/getFormula).',
		icon: SquareStack,
		tag: 'setFormula()',
		gradient: 'linear-gradient(135deg, #06b6d4, #0284c7)',
	},
];

const stats = [
	{ value: '100K+', label: 'Rows virtualized' },
	{ value: '1,000+', label: 'Columns virtualized' },
	{ value: '60fps', label: 'Even at full scale' },
	{ value: '0', label: 'Full-tree re-renders on scroll' },
];

const cards = [
	{
		href: '/docs/next/quick-start',
		title: 'Quick start',
		description: 'Install the React adapter, render a grid, and connect your first rows and columns.',
		icon: Rocket,
	},
	{
		href: '/docs/next/examples',
		title: 'Examples',
		description: 'Package-backed, runnable examples with live preview and source — the same ones used across the demo app.',
		icon: FlaskConical,
	},
	{
		href: '/docs/next/grid-api',
		title: 'Grid API',
		description: 'The imperative GridApi surface — state, editing, selection, grouping, clipboard, undo/redo.',
		icon: Terminal,
	},
	{
		href: '/docs/next/migrating-from-ag-grid',
		title: 'Coming from AG Grid?',
		description: 'A concept-by-concept map from rowData/columnDefs to Wit Grid, including grouping, row models, and theming.',
		icon: ArrowRightLeft,
	},
];

export default function HomePage() {
	return (
		<main className='min-h-screen'>
			<div className='wg-landing-bg'>
				<section className='mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-16 sm:pt-24'>
					<div className='max-w-3xl'>
						<span className='wg-eyebrow-badge'>
							<Gauge aria-hidden size={12} />
							100,000+ rows · 1,000+ columns · 60fps
						</span>
						<h1 className='mt-5 text-4xl font-semibold tracking-tight text-fd-foreground sm:text-6xl'>
							A grid engine built for{' '}
							<span className='bg-gradient-to-r from-sky-500 via-sky-400 to-violet-500 bg-clip-text text-transparent'>
								massive, editable
							</span>{' '}
							datasets.
						</h1>
						<p className='mt-6 text-lg leading-8 text-fd-muted-foreground'>
							A centralized, out-of-render state engine drives cell-level micro-subscriptions, so React paints individual cells with
							surgical precision instead of re-rendering the tree. This is a live grid — try sorting, filtering, and editing it below.
						</p>
						<div className='mt-8 flex flex-wrap items-center gap-3'>
							<Link
								href='/docs/next/quick-start'
								className='inline-flex items-center gap-2 rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-transform hover:-translate-y-0.5'
							>
								Get started
								<ArrowRight aria-hidden size={16} />
							</Link>
							<a
								href='https://github.com/witbybit/open-grid'
								className='inline-flex items-center gap-2 rounded-md border border-fd-border px-4 py-2 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent'
							>
								View on GitHub
								<ArrowUpRight aria-hidden size={16} />
							</a>
							<InstallSnippet />
						</div>
					</div>

					<div className='wg-hero-grid-frame'>
						<HeroGrid />
					</div>

					<div className='wg-stat-strip'>
						{stats.map((stat) => (
							<div key={stat.label}>
								<div className='text-2xl font-bold tracking-tight text-fd-foreground sm:text-3xl'>{stat.value}</div>
								<div className='mt-1 text-xs uppercase tracking-wide text-fd-muted-foreground'>{stat.label}</div>
							</div>
						))}
					</div>
				</section>

				<section className='mx-auto max-w-6xl px-6 py-20 sm:py-24'>
					<p className='text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400'>Under the hood</p>
					<h2 className='mt-2 text-2xl font-semibold tracking-tight text-fd-foreground sm:text-3xl'>What's built in</h2>
					<div className='mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
						{features.map((feature) => {
							const Icon = feature.icon;
							return (
								<div key={feature.title} className='wg-feature-card'>
									<div className='wg-feature-icon' style={{ background: feature.gradient }}>
										<Icon aria-hidden size={20} />
									</div>
									<h3 className='text-base font-semibold text-fd-foreground'>{feature.title}</h3>
									<p className='mt-2 text-sm leading-6 text-fd-muted-foreground'>{feature.description}</p>
									<code className='wg-feature-tag'>{feature.tag}</code>
								</div>
							);
						})}
					</div>
				</section>

				<section className='mx-auto max-w-6xl px-6 pb-20'>
					<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
						{cards.map((card) => {
							const Icon = card.icon;
							return (
								<Link key={card.href} href={card.href} className='wg-link-tile'>
									<Icon aria-hidden size={18} className='mb-3 text-sky-600 dark:text-sky-400' />
									<h2 className='text-base font-semibold text-fd-foreground'>{card.title}</h2>
									<p className='mt-2 text-sm leading-6 text-fd-muted-foreground'>{card.description}</p>
								</Link>
							);
						})}
					</div>
				</section>
			</div>
		</main>
	);
}
