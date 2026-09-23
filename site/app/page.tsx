import Link from 'next/link';
import { ArrowRight, BookOpen, Code2, Layers3 } from 'lucide-react';

const cards = [
	{
		href: '/docs/next/quick-start',
		title: 'Quick start',
		description: 'Install the React adapter, render a grid, and connect your first rows and columns.',
		icon: Code2,
	},
	{
		href: '/docs/next/events',
		title: 'Events',
		description: 'Generated from the core event map so handlers match the runtime contract.',
		icon: Layers3,
	},
	{
		href: '/docs/next/api-reference',
		title: 'API reference',
		description: 'Props and exports generated from the package source during the docs build.',
		icon: BookOpen,
	},
];

export default function HomePage() {
	return (
		<main className='min-h-screen'>
			<section className='mx-auto flex max-w-6xl flex-col gap-8 px-6 py-16 sm:py-24'>
				<div className='max-w-3xl'>
					<p className='text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground'>Wit Grid Docs</p>
					<h1 className='mt-4 text-4xl font-semibold tracking-normal text-fd-foreground sm:text-6xl'>Data grid documentation.</h1>
					<p className='mt-6 text-lg leading-8 text-fd-muted-foreground'>
						Reference pages are generated, examples are file-backed, and versioned content lives next to the docs app.
					</p>
					<div className='mt-8'>
						<Link
							href='/docs/next'
							className='inline-flex items-center gap-2 rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground'
						>
							Open docs
							<ArrowRight aria-hidden size={16} />
						</Link>
					</div>
				</div>
				<div className='grid gap-4 md:grid-cols-3'>
					{cards.map((card) => {
						const Icon = card.icon;
						return (
							<Link
								key={card.href}
								href={card.href}
								className='rounded-lg border border-fd-border bg-fd-card p-5 transition-colors hover:bg-fd-accent'
							>
								<Icon aria-hidden className='mb-4 text-fd-muted-foreground' size={20} />
								<h2 className='text-base font-semibold'>{card.title}</h2>
								<p className='mt-2 text-sm leading-6 text-fd-muted-foreground'>{card.description}</p>
							</Link>
						);
					})}
				</div>
			</section>
		</main>
	);
}
