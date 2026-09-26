import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Layers3, Rows3, SquareStack, Palette, Database, Paintbrush } from 'lucide-react';
import { HeroGrid } from '@/components/home/hero-grid';

const features = [
	{
		title: 'Virtualized at any scale',
		description: 'Cell-level micro-subscriptions repaint only the exact cell that changed — scrolling and editing bypass full-tree re-renders.',
		icon: Layers3,
	},
	{
		title: 'Grouping, tree data & master-detail',
		description:
			'Fold rows into expandable groups with live aggregates, nest parent-child hierarchies, or embed a full interactive sub-grid per row.',
		icon: Rows3,
	},
	{
		title: 'Client, infinite & server row models',
		description:
			'The same <Grid /> component reads from an in-memory array, a block-loading datasource, or a server-owned query — swap rowModelType, not your code.',
		icon: Database,
	},
	{
		title: 'Declarative style rules',
		description: 'Condition row, cell, and header classes on your data with styleRules — compiled once, no per-render style computation.',
		icon: Paintbrush,
	},
	{
		title: 'Seven built-in themes',
		description: 'Runtime theme switching, system color-scheme detection, and full custom theme composition — all through the same GridApi.',
		icon: Palette,
	},
	{
		title: 'Grid-level clipboard & formulas',
		description: 'TSV copy/paste compatible with Excel and Sheets out of the box, plus a per-cell formula API (setFormula/getFormula).',
		icon: SquareStack,
	},
];

const cards = [
	{
		href: '/docs/next/quick-start',
		title: 'Quick start',
		description: 'Install the React adapter, render a grid, and connect your first rows and columns.',
	},
	{
		href: '/docs/next/examples',
		title: 'Examples',
		description: 'Package-backed, runnable examples with live preview and source — the same ones used across the demo app.',
	},
	{
		href: '/docs/next/grid-api',
		title: 'Grid API',
		description: 'The imperative GridApi surface — state, editing, selection, grouping, clipboard, undo/redo.',
	},
];

export default function HomePage() {
	return (
		<main className='min-h-screen'>
			<section className='mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-16 sm:pt-24'>
				<div className='max-w-3xl'>
					<p className='text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground'>Wit Grid</p>
					<h1 className='mt-4 text-4xl font-semibold tracking-tight text-fd-foreground sm:text-6xl'>
						A framework-agnostic grid engine for massive, editable datasets.
					</h1>
					<p className='mt-6 text-lg leading-8 text-fd-muted-foreground'>
						A centralized, out-of-render state engine drives cell-level micro-subscriptions, so React paints individual cells with
						surgical precision instead of re-rendering the tree. This is a live grid — try sorting, filtering, and editing it below.
					</p>
					<div className='mt-8 flex flex-wrap items-center gap-3'>
						<Link
							href='/docs/next/quick-start'
							className='inline-flex items-center gap-2 rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground'
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
					</div>
				</div>

				<div className='wg-hero-grid-frame'>
					<HeroGrid />
				</div>
			</section>

			<section className='mx-auto max-w-6xl px-6 py-16 sm:py-20'>
				<h2 className='text-2xl font-semibold tracking-tight text-fd-foreground'>What's built in</h2>
				<div className='mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
					{features.map((feature) => {
						const Icon = feature.icon;
						return (
							<div key={feature.title} className='rounded-lg border border-fd-border bg-fd-card p-5'>
								<Icon aria-hidden className='mb-4 text-fd-muted-foreground' size={20} />
								<h3 className='text-base font-semibold text-fd-foreground'>{feature.title}</h3>
								<p className='mt-2 text-sm leading-6 text-fd-muted-foreground'>{feature.description}</p>
							</div>
						);
					})}
				</div>
			</section>

			<section className='mx-auto max-w-6xl px-6 pb-20'>
				<div className='grid gap-4 md:grid-cols-3'>
					{cards.map((card) => (
						<Link
							key={card.href}
							href={card.href}
							className='rounded-lg border border-fd-border bg-fd-card p-5 transition-colors hover:bg-fd-accent'
						>
							<h2 className='text-base font-semibold'>{card.title}</h2>
							<p className='mt-2 text-sm leading-6 text-fd-muted-foreground'>{card.description}</p>
						</Link>
					))}
				</div>
			</section>
		</main>
	);
}
