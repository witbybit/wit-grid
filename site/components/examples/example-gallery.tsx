'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import examples from '@/generated/next/examples.json';
import { showcaseExamples, type WitGridExampleMeta } from '@eregister/wit-grid-examples/showcase';

const previewModules = {
	'basic-grid': dynamic(() => import('@eregister/wit-grid-examples/basic-grid').then((module) => module.Component), { ssr: false }),
	'row-selection': dynamic(() => import('@eregister/wit-grid-examples/row-selection').then((module) => module.Component), { ssr: false }),
	persistence: dynamic(() => import('@eregister/wit-grid-examples/persistence').then((module) => module.Component), { ssr: false }),
	'infinite-server-scroll': dynamic(() => import('@eregister/wit-grid-examples/infinite-server-scroll'), { ssr: false }),
	'advanced-filters': dynamic(() => import('@eregister/wit-grid-examples/advanced-filters'), { ssr: false }),
	'row-drag': dynamic(() => import('@eregister/wit-grid-examples/row-drag'), { ssr: false }),
	'native-cell-types': dynamic(() => import('@eregister/wit-grid-examples/native-cell-types'), { ssr: false }),
	'data-integrity': dynamic(() => import('@eregister/wit-grid-examples/data-integrity'), { ssr: false }),
};

type ExampleDoc = {
	id: keyof typeof previewModules;
	title: string;
	description: string;
	source: string;
};

type GalleryMode = 'preview' | 'source';

type CodeToken = {
	text: string;
	kind: 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'jsx' | 'type' | 'operator';
};

const codeKeywords = new Set([
	'as',
	'async',
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'default',
	'do',
	'else',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'from',
	'function',
	'if',
	'import',
	'in',
	'interface',
	'let',
	'new',
	'null',
	'of',
	'return',
	'satisfies',
	'switch',
	'throw',
	'true',
	'try',
	'type',
	'undefined',
	'use',
	'while',
]);

function tokenizeLine(line: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	const pattern =
		/(\/\/.*|\/\*.*?\*\/|(["'`])(?:\\.|(?!\2).)*\2|\b\d+(?:\.\d+)?\b|<\/?[A-Z][\w.:-]*|[{}()[\].,;:<>/=+\-*|&!?]+|\b[A-Za-z_$][\w$]*\b|\s+|.)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(line))) {
		const text = match[0];
		let kind: CodeToken['kind'] = 'plain';
		if (text.startsWith('//') || text.startsWith('/*')) kind = 'comment';
		else if (/^["'`]/.test(text)) kind = 'string';
		else if (/^\d/.test(text)) kind = 'number';
		else if (/^<\/?[A-Z]/.test(text)) kind = 'jsx';
		else if (codeKeywords.has(text)) kind = 'keyword';
		else if (/^[A-Z][A-Za-z0-9_$]*$/.test(text)) kind = 'type';
		else if (/^[{}()[\].,;:<>/=+\-*|&!?]+$/.test(text)) kind = 'operator';
		else if (/^[A-Za-z_$][\w$]*$/.test(text) && line.slice(pattern.lastIndex).trimStart().startsWith('(')) kind = 'function';
		tokens.push({ text, kind });
	}

	return tokens;
}

function getExampleTone(level: WitGridExampleMeta['level']) {
	if (level === 'advanced') return 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300';
	if (level === 'intermediate') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
	return 'border-fd-border bg-fd-muted text-fd-muted-foreground';
}

function CodeViewer({ source, sourcePath }: { source: string; sourcePath: string }) {
	const [copied, setCopied] = useState(false);
	const fileName = sourcePath.split('/').at(-1) ?? 'source.tsx';
	const lines = source.split('\n');

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
					{lines.map((line, index) => (
						<span key={index} className='wg-code-line'>
							<span className='wg-code-line-number'>{index + 1}</span>
							<span className='wg-code-line-content'>
								{line
									? tokenizeLine(line).map((token, tokenIndex) => (
											<span key={tokenIndex} className={`wg-token-${token.kind}`}>
												{token.text}
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
	const [selectedId, setSelectedId] = useState(items[0]?.id ?? 'basic-grid');
	const [mode, setMode] = useState<GalleryMode>('preview');
	const selected = items.find((example) => example.id === selectedId) ?? items[0];
	const Preview = selected ? previewModules[selected.id as keyof typeof previewModules] : null;
	const source = selected ? (sourceById.get(selected.id as keyof typeof previewModules)?.source ?? '') : '';

	return (
		<div className='not-prose wg-examples-workbench flex flex-col gap-4'>
			<div className='flex flex-col gap-2 border-b border-fd-border pb-3'>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div className='text-sm font-medium text-fd-muted-foreground'>{items.length} package-backed examples</div>
					<div className='rounded-md border border-fd-border px-2 py-1 text-xs text-fd-muted-foreground'>packages/examples</div>
				</div>
				<div className='wg-example-rail flex gap-2 overflow-x-auto pb-1'>
					{items.map((example) => {
						const isSelected = example.id === selected?.id;
						return (
							<button
								key={example.id}
								type='button'
								onClick={() => {
									setSelectedId(example.id);
									setMode('preview');
								}}
								className={`group flex min-w-fit items-center gap-2 rounded-md border px-3 py-2 text-left transition ${
									isSelected
										? 'border-sky-500/70 bg-sky-500/10 text-fd-foreground shadow-[0_0_0_1px_rgba(14,165,233,0.2)]'
										: 'border-fd-border bg-fd-card/80 text-fd-card-foreground hover:border-sky-500/45 hover:bg-fd-muted/60'
								}`}
							>
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
							<div className='wg-grid-preview wg-example-stage'>
								<Preview />
							</div>
						) : (
							<CodeViewer source={source} sourcePath={selected.sourcePath} />
						)}
					</div>
				</section>
			) : null}
		</div>
	);
}
