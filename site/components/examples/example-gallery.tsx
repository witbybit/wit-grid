'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Check, Copy, Sparkles, MousePointerClick, Database, ListFilter, Pencil, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';
import examples from '@/generated/next/examples.json';
import { showcaseExamples, type WitGridExampleMeta } from '@eregister/wit-grid-examples/showcase';

const FEATURED_EXAMPLE_ID = 'realtime-dashboard';

const CATEGORY_ICONS: Record<WitGridExampleMeta['category'], LucideIcon> = {
	'Getting started': Sparkles,
	Selection: MousePointerClick,
	State: Database,
	'Row models': Database,
	Filtering: ListFilter,
	Editing: Pencil,
	Validation: ShieldCheck,
	Rendering: Zap,
};

const previewModules = {
	'basic-grid': dynamic(() => import('@eregister/wit-grid-examples/basic-grid').then((module) => module.Component), { ssr: false }),
	'row-selection': dynamic(() => import('@eregister/wit-grid-examples/row-selection').then((module) => module.Component), { ssr: false }),
	persistence: dynamic(() => import('@eregister/wit-grid-examples/persistence').then((module) => module.Component), { ssr: false }),
	'infinite-server-scroll': dynamic(() => import('@eregister/wit-grid-examples/infinite-server-scroll'), { ssr: false }),
	'advanced-filters': dynamic(() => import('@eregister/wit-grid-examples/advanced-filters'), { ssr: false }),
	'row-drag': dynamic(() => import('@eregister/wit-grid-examples/row-drag'), { ssr: false }),
	'native-cell-types': dynamic(() => import('@eregister/wit-grid-examples/native-cell-types'), { ssr: false }),
	'data-integrity': dynamic(() => import('@eregister/wit-grid-examples/data-integrity'), { ssr: false }),
	'realtime-dashboard': dynamic(() => import('@eregister/wit-grid-examples/realtime-dashboard'), { ssr: false }),
};

type HighlightToken = {
	content: string;
	color?: string;
};

type ExampleDoc = {
	id: keyof typeof previewModules;
	title: string;
	description: string;
	source: string;
	tokens?: HighlightToken[][];
};

type GalleryMode = 'preview' | 'source';

function getExampleTone(level: WitGridExampleMeta['level']) {
	if (level === 'advanced') return 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300';
	if (level === 'intermediate') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
	return 'border-fd-border bg-fd-muted text-fd-muted-foreground';
}

function CodeViewer({ source, sourcePath, tokens }: { source: string; sourcePath: string; tokens?: HighlightToken[][] }) {
	const [copied, setCopied] = useState(false);
	const fileName = sourcePath.split('/').at(-1) ?? 'source.tsx';
	const lines: HighlightToken[][] = tokens ?? source.split('\n').map((line) => [{ content: line }]);

	async function copySource() {
		await navigator.clipboard.writeText(source);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1400);
	}

	return (
		<div className='wg-code-viewer'>
			<div className='wg-code-viewer-header'>
				<div className='flex items-center gap-2'>
					<span className='rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300'>TSX</span>
					<span className='font-mono text-xs text-fd-muted-foreground'>{fileName}</span>
				</div>
				<button type='button' onClick={copySource} className='wg-code-copy' aria-label='Copy source code'>
					{copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
					<span>{copied ? 'Copied' : 'Copy'}</span>
				</button>
			</div>
			<div className='wg-code-viewer-body'>
				<pre>
					{lines.map((lineTokens, index) => (
						<span key={index} className='wg-code-line'>
							<span className='wg-code-line-number'>{index + 1}</span>
							<span className='wg-code-line-content'>
								{lineTokens.length > 0
									? lineTokens.map((token, tokenIndex) => (
											<span key={tokenIndex} style={token.color ? { color: token.color } : undefined}>
												{token.content}
											</span>
										))
									: ' '}
							</span>
						</span>
					))}
				</pre>
			</div>
		</div>
	);
}

export function ExampleGallery() {
	const sourceById = useMemo(() => new Map((examples.examples as ExampleDoc[]).map((example) => [example.id, example])), []);
	const items = showcaseExamples as WitGridExampleMeta[];
	const initialId = items.some((item) => item.id === FEATURED_EXAMPLE_ID) ? FEATURED_EXAMPLE_ID : (items[0]?.id ?? 'basic-grid');
	const [selectedId, setSelectedId] = useState(initialId);
	const [mode, setMode] = useState<GalleryMode>('preview');
	const { resolvedTheme } = useTheme();
	const selected = items.find((example) => example.id === selectedId) ?? items[0];
	const Preview: any = selected ? previewModules[selected.id as keyof typeof previewModules] : null;
	const selectedDoc = selected ? sourceById.get(selected.id as keyof typeof previewModules) : undefined;
	const source = selectedDoc?.source ?? '';

	return (
		<div className='not-prose wg-examples-workbench flex flex-col gap-5'>
			<div className='flex flex-col gap-4 border-b border-fd-border pb-4'>
				<div className='flex flex-wrap items-end justify-between gap-3'>
					<div>
						<p className='text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400'>Live &amp; interactive</p>
						<h2 className='mt-1 text-2xl font-bold tracking-tight text-fd-foreground sm:text-3xl'>Try the grid, not a screenshot</h2>
						<p className='mt-1.5 max-w-2xl text-sm leading-6 text-fd-muted-foreground'>
							Every example below is a running instance of `@eregister/wit-grid-examples` — sort it, edit it, scroll it. Flip to{' '}
							<span className='font-semibold text-fd-foreground'>Source</span> to see exactly how it's built.
						</p>
					</div>
					<div className='flex shrink-0 items-center gap-2 rounded-lg border border-fd-border bg-fd-muted/40 px-3 py-2'>
						<span className='text-2xl font-bold text-fd-foreground'>{items.length}</span>
						<span className='text-xs leading-tight text-fd-muted-foreground'>
							live
							<br />
							examples
						</span>
					</div>
				</div>
				<div className='wg-example-rail flex gap-2 overflow-x-auto pb-1'>
					{items.map((example) => {
						const isSelected = example.id === selected?.id;
						const Icon = CATEGORY_ICONS[example.category] ?? Sparkles;
						return (
							<button
								key={example.id}
								type='button'
								onClick={() => {
									setSelectedId(example.id);
									setMode('preview');
								}}
								className={`group flex min-w-fit items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition ${
									isSelected
										? 'border-sky-500/70 bg-sky-500/10 text-fd-foreground shadow-[0_0_0_1px_rgba(14,165,233,0.25)]'
										: 'border-fd-border bg-fd-card/80 text-fd-card-foreground hover:border-sky-500/45 hover:bg-fd-muted/60'
								}`}
							>
								<Icon aria-hidden size={15} className={isSelected ? 'text-sky-600 dark:text-sky-300' : 'text-fd-muted-foreground'} />
								<span className='text-sm font-semibold leading-5'>{example.title}</span>
								<span
									className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
										isSelected ? 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300' : getExampleTone(example.level)
									}`}
								>
									{example.level}
								</span>
							</button>
						);
					})}
				</div>
			</div>
			{selected && Preview ? (
				<section className='overflow-hidden rounded-lg border border-fd-border bg-fd-card'>
					<div className='flex flex-col gap-4 border-b border-fd-border p-4 xl:flex-row xl:items-start xl:justify-between'>
						<div className='min-w-0'>
							<div className='flex flex-wrap items-center gap-2'>
								<h2 className='m-0 text-2xl font-semibold tracking-tight text-fd-foreground'>{selected.title}</h2>
								<span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${getExampleTone(selected.level)}`}>
									{selected.level}
								</span>
								<span className='rounded-md border border-fd-border px-2 py-0.5 text-xs text-fd-muted-foreground'>
									{selected.category}
								</span>
							</div>
							<p className='mt-2 max-w-4xl text-sm leading-6 text-fd-muted-foreground'>{selected.description}</p>
							<div className='mt-3 flex flex-wrap gap-2'>
								{selected.tags.map((tag) => (
									<span
										key={tag}
										className='rounded-md border border-fd-border bg-fd-muted/30 px-2 py-1 text-xs text-fd-muted-foreground'
									>
										{tag}
									</span>
								))}
							</div>
						</div>

						<div className='flex shrink-0 flex-col items-start gap-2'>
							<div className='inline-flex w-fit rounded-lg border border-fd-border bg-fd-muted p-1'>
								{(['preview', 'source'] as const).map((item) => (
									<button
										key={item}
										type='button'
										onClick={() => setMode(item)}
										className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
											mode === item
												? 'bg-fd-card text-fd-foreground shadow-sm'
												: 'text-fd-muted-foreground hover:text-fd-foreground'
										}`}
									>
										{item}
									</button>
								))}
							</div>
							<a
								href={selected.docs}
								className='rounded-md border border-fd-border bg-fd-card px-3 py-2 text-sm font-medium text-fd-foreground transition hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-300'
							>
								Read related docs
							</a>
						</div>
					</div>

					<div className='p-3'>
						{mode === 'preview' ? (
							<div className='wg-preview-frame'>
								<div className='wg-preview-frame-bar'>
									<span className='flex gap-1.5'>
										<span className='h-2.5 w-2.5 rounded-full bg-rose-500/70' />
										<span className='h-2.5 w-2.5 rounded-full bg-amber-500/70' />
										<span className='h-2.5 w-2.5 rounded-full bg-emerald-500/70' />
									</span>
									<span className='flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400'>
										<span className='h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400' />
										Live preview
									</span>
								</div>
								<div className='wg-grid-preview wg-example-stage'>
									<Preview theme={resolvedTheme === 'light' ? 'light' : 'dark'} />
								</div>
							</div>
						) : (
							<CodeViewer source={source} sourcePath={selected.sourcePath} tokens={selectedDoc?.tokens} />
						)}
					</div>
				</section>
			) : null}
		</div>
	);
}
