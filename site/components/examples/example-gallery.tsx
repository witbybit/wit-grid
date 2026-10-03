'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import {
	Check,
	Copy,
	Sparkles,
	MousePointerClick,
	Database,
	ListFilter,
	Pencil,
	Layers,
	ShieldCheck,
	Zap,
	Maximize2,
	Minimize2,
	RefreshCw,
	Search,
	type LucideIcon,
} from 'lucide-react';
import examples from '@/generated/next/examples.json';
import { showcaseExamples, type WitGridExampleMeta } from '@eregister/wit-grid-examples/showcase';

const FEATURED_EXAMPLE_ID = 'realtime-dashboard';

const CATEGORY_ORDER: WitGridExampleMeta['category'][] = [
	'Getting started',
	'Selection',
	'State',
	'Row models',
	'Filtering',
	'Editing',
	'Grouping',
	'Validation',
	'Rendering',
];

const CATEGORY_ICONS: Record<WitGridExampleMeta['category'], LucideIcon> = {
	'Getting started': Sparkles,
	Selection: MousePointerClick,
	State: Database,
	'Row models': Database,
	Filtering: ListFilter,
	Editing: Pencil,
	Grouping: Layers,
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
	'kanban-board': dynamic(() => import('@eregister/wit-grid-examples/kanban-board'), { ssr: false }),
	clipboard: dynamic(() => import('@eregister/wit-grid-examples/clipboard'), { ssr: false }),
	'realtime-grouping': dynamic(() => import('@eregister/wit-grid-examples/realtime-grouping'), { ssr: false }),
	'grouping-sticky': dynamic(() => import('@eregister/wit-grid-examples/grouping-sticky'), { ssr: false }),
	'nested-hierarchy': dynamic(() => import('@eregister/wit-grid-examples/nested-hierarchy'), { ssr: false }),
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

type GalleryMode = 'preview' | 'source' | 'notes';

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

function PreviewStage({
	Preview,
	theme,
	title,
	isFullscreen,
	onToggleFullscreen,
	onReset,
}: {
	Preview: any;
	theme: 'light' | 'dark';
	title: string;
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
	onReset?: () => void;
}) {
	return (
		<div className={isFullscreen ? 'wg-preview-frame wg-example-fullscreen-frame' : 'wg-preview-frame'}>
			<div className='wg-preview-frame-bar'>
				<span className='flex items-center gap-3'>
					<span className='flex gap-1.5'>
						<span className='h-2.5 w-2.5 rounded-full bg-rose-500/70' />
						<span className='h-2.5 w-2.5 rounded-full bg-amber-500/70' />
						<span className='h-2.5 w-2.5 rounded-full bg-emerald-500/70' />
					</span>
					{isFullscreen && <span className='text-xs font-semibold text-slate-300'>{title}</span>}
				</span>
				<span className='flex items-center gap-3'>
					{onReset ? (
						<button
							type='button'
							onClick={onReset}
							className='wg-stage-fullscreen-toggle'
							aria-label='Reload preview'
							title='Reload preview'
						>
							<RefreshCw className='h-3.5 w-3.5' />
						</button>
					) : null}
					<button
						type='button'
						onClick={onToggleFullscreen}
						className='wg-stage-fullscreen-toggle'
						aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
						title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Expand to fullscreen'}
					>
						{isFullscreen ? <Minimize2 className='h-3.5 w-3.5' /> : <Maximize2 className='h-3.5 w-3.5' />}
					</button>
				</span>
			</div>
			<div className={isFullscreen ? 'wg-grid-preview wg-example-stage wg-example-stage-fullscreen' : 'wg-grid-preview wg-example-stage'}>
				{/* Not-fullscreen is a tight, cramped box — showcases hide their own side panels/toolbars/logs
				    behind `compact` so the grid itself stays the star. Fullscreen restores everything. */}
				<Preview theme={theme} compact={!isFullscreen} />
			</div>
		</div>
	);
}

function ExampleSidebar({
	groups,
	selectedId,
	onSelect,
	query,
	onQueryChange,
	totalCount,
}: {
	groups: [WitGridExampleMeta['category'], WitGridExampleMeta[]][];
	selectedId: string;
	onSelect: (id: string) => void;
	query: string;
	onQueryChange: (query: string) => void;
	totalCount: number;
}) {
	return (
		<nav className='wg-example-sidebar' aria-label='Examples'>
			<div className='wg-example-sidebar-header'>
				<div>
					<p className='text-[10px] font-black uppercase tracking-wider text-sky-500 dark:text-sky-300'>Live examples</p>
					<p className='mt-0.5 text-sm font-bold text-fd-foreground'>Showcase index</p>
				</div>
				<span className='wg-example-count'>{totalCount}</span>
			</div>
			<label className='wg-example-search'>
				<Search className='h-3.5 w-3.5' />
				<input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder='Filter examples' />
			</label>
			{groups.map(([category, categoryItems]) => (
				<div key={category} className='flex flex-col gap-1'>
					<p className='wg-example-group-label'>{category}</p>
					{categoryItems.map((example) => {
						const isSelected = example.id === selectedId;
						return (
							<button
								key={example.id}
								type='button'
								onClick={() => onSelect(example.id)}
								className={`wg-example-nav-item${isSelected ? ' is-active' : ''}`}
							>
								<span
									className={`h-1.5 w-1.5 shrink-0 rounded-full ${
										example.level === 'advanced'
											? 'bg-sky-500'
											: example.level === 'intermediate'
												? 'bg-emerald-500'
												: 'bg-fd-muted-foreground/50'
									}`}
								/>
								<span className='min-w-0 flex-1 truncate text-sm font-medium leading-5'>{example.title}</span>
							</button>
						);
					})}
				</div>
			))}
			<p className='mt-auto border-t border-fd-border pt-3 text-[11px] leading-5 text-fd-muted-foreground'>
				Every example runs from <code className='text-[10px]'>@eregister/wit-grid-examples</code>.
			</p>
		</nav>
	);
}

function ExampleNotes({ selected }: { selected: WitGridExampleMeta }) {
	return (
		<div className='wg-example-notes'>
			<div>
				<p className='text-[11px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-300'>What this demonstrates</p>
				<h3 className='mt-2 text-xl font-black tracking-tight text-fd-foreground'>{selected.title}</h3>
				<p className='mt-2 max-w-2xl text-sm leading-6 text-fd-muted-foreground'>{selected.description}</p>
			</div>
			<div className='grid gap-3 sm:grid-cols-3'>
				<div className='wg-example-note-card'>
					<span>Level</span>
					<strong>{selected.level}</strong>
				</div>
				<div className='wg-example-note-card'>
					<span>Category</span>
					<strong>{selected.category}</strong>
				</div>
				<div className='wg-example-note-card'>
					<span>Package</span>
					<strong>@eregister/wit-grid-examples</strong>
				</div>
			</div>
			<div>
				<p className='mb-2 text-[11px] font-black uppercase tracking-wider text-fd-muted-foreground'>Feature tags</p>
				<div className='flex flex-wrap gap-2'>
					{selected.tags.map((tag) => (
						<span key={tag} className='rounded-md border border-fd-border bg-fd-muted/40 px-2.5 py-1 text-xs text-fd-muted-foreground'>
							{tag}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

export function ExampleGallery() {
	const sourceById = useMemo(() => new Map((examples.examples as ExampleDoc[]).map((example) => [example.id, example])), []);
	const items = showcaseExamples as WitGridExampleMeta[];
	const [query, setQuery] = useState('');
	const filteredItems = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return items;
		return items.filter((example) =>
			[example.title, example.description, example.category, example.level, ...example.tags].some((value) =>
				value.toLowerCase().includes(normalized)
			)
		);
	}, [items, query]);
	const groups = useMemo(() => {
		const byCategory = new Map<WitGridExampleMeta['category'], WitGridExampleMeta[]>();
		for (const example of filteredItems) {
			const list = byCategory.get(example.category) ?? [];
			list.push(example);
			byCategory.set(example.category, list);
		}
		return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map(
			(category) => [category, byCategory.get(category)!] as [WitGridExampleMeta['category'], WitGridExampleMeta[]]
		);
	}, [filteredItems]);
	const initialId = items.some((item) => item.id === FEATURED_EXAMPLE_ID) ? FEATURED_EXAMPLE_ID : (items[0]?.id ?? 'basic-grid');
	const [selectedId, setSelectedId] = useState(initialId);
	const [mode, setMode] = useState<GalleryMode>('preview');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [previewRevision, setPreviewRevision] = useState(0);
	const { resolvedTheme } = useTheme();
	const selected = items.find((example) => example.id === selectedId) ?? filteredItems[0] ?? items[0];
	const Preview: any = selected ? previewModules[selected.id as keyof typeof previewModules] : null;
	const selectedDoc = selected ? sourceById.get(selected.id as keyof typeof previewModules) : undefined;
	const source = selectedDoc?.source ?? '';
	const CategoryIcon = selected ? (CATEGORY_ICONS[selected.category] ?? Sparkles) : Sparkles;
	const stageTheme = resolvedTheme === 'light' ? 'light' : 'dark';

	async function copyMarkdown() {
		if (!selected) return;
		await navigator.clipboard.writeText(`[${selected.title}](${selected.docs})`);
	}

	useEffect(() => {
		if (!isFullscreen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setIsFullscreen(false);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isFullscreen]);

	// Selecting a different example, or leaving preview mode, should always drop out of fullscreen.
	useEffect(() => {
		setIsFullscreen(false);
	}, [selectedId, mode]);

	return (
		<div className='not-prose wg-examples-workbench'>
			<div className='wg-example-shell'>
				<ExampleSidebar
					groups={groups}
					selectedId={selected?.id ?? ''}
					onSelect={setSelectedId}
					query={query}
					onQueryChange={setQuery}
					totalCount={items.length}
				/>

				{selected && Preview ? (
					<section className='wg-example-main'>
						<div className='wg-example-main-header'>
							<div className='min-w-0'>
								<div className='flex flex-wrap items-center gap-2'>
									<CategoryIcon aria-hidden size={16} className='shrink-0 text-sky-600 dark:text-sky-300' />
									<h3 className='m-0 max-w-lg text-2xl font-black leading-tight tracking-tight text-fd-foreground'>
										{selected.title}
									</h3>
									<span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${getExampleTone(selected.level)}`}>
										{selected.level}
									</span>
								</div>
								<p className='mt-2 max-w-xl text-sm leading-6 text-fd-muted-foreground'>{selected.description}</p>
								<div className='mt-2.5 flex flex-wrap gap-1.5'>
									{selected.tags.map((tag) => (
										<span
											key={tag}
											className='rounded-md border border-fd-border bg-fd-muted/30 px-2 py-0.5 text-xs text-fd-muted-foreground'
										>
											{tag}
										</span>
									))}
								</div>
							</div>

							<div className='flex shrink-0 items-center gap-2'>
								<div className='wg-mode-switcher'>
									{(['preview', 'source', 'notes'] as const).map((item) => (
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
							</div>
						</div>

						<div className='wg-example-stage-wrap'>
							{mode === 'preview' ? (
								<PreviewStage
									key={`${selected.id}-${previewRevision}`}
									Preview={Preview}
									theme={stageTheme}
									title={selected.title}
									isFullscreen={false}
									onToggleFullscreen={() => setIsFullscreen(true)}
									onReset={() => setPreviewRevision((value) => value + 1)}
								/>
							) : (
								<>
									{mode === 'source' ? (
										<CodeViewer source={source} sourcePath={selected.sourcePath} tokens={selectedDoc?.tokens} />
									) : (
										<ExampleNotes selected={selected} />
									)}
								</>
							)}
						</div>
					</section>
				) : null}
			</div>

			{isFullscreen && selected && Preview && typeof document !== 'undefined'
				? (createPortal(
						<div
							className='wg-example-fullscreen-overlay'
							role='dialog'
							aria-modal='true'
							aria-label={`${selected.title} — fullscreen preview`}
						>
							<PreviewStage
								Preview={Preview}
								theme={stageTheme}
								title={selected.title}
								isFullscreen={true}
								onToggleFullscreen={() => setIsFullscreen(false)}
							/>
						</div>,
						document.body
					) as ReturnType<typeof PreviewStage>)
				: null}
		</div>
	);
}
