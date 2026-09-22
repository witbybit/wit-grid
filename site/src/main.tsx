import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
	ArrowRight,
	BookOpen,
	Braces,
	Check,
	ChevronRight,
	Code2,
	Gauge,
	Github,
	Grid3X3,
	Layers3,
	Library,
	MousePointer2,
	Search,
	Sparkles,
	TerminalSquare,
	Zap,
} from 'lucide-react';
import { apiEntries, docSections, examples, type DocSection } from './content/docs';
import './styles.css';

const navGroups = Array.from(new Set(docSections.map((section) => section.group)));

function cx(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(' ');
}

function Hero() {
	return (
		<section className="hero" id="overview">
			<div className="hero-copy">
				<div className="eyebrow">
					<span className="status-dot" />
					Alpha docs foundation
				</div>
				<h1>Wit Grid</h1>
				<p className="hero-lede">
					A high-performance data grid and spreadsheet engine with serious docs, live examples, and a public API surface developers can trust.
				</p>
				<div className="hero-actions">
					<a className="button primary" href="#quick-start">
						Get started
						<ArrowRight size={16} />
					</a>
					<a className="button secondary" href="#api-reference">
						API reference
						<BookOpen size={16} />
					</a>
				</div>
			</div>
			<div className="hero-panel" aria-label="Wit Grid documentation preview">
				<div className="browser-bar">
					<span />
					<span />
					<span />
				</div>
				<div className="preview-grid">
					<div className="preview-sidebar">
						<div className="preview-pill active">Quick Start</div>
						<div className="preview-pill">Columns</div>
						<div className="preview-pill">Events</div>
						<div className="preview-pill">Theming</div>
					</div>
					<div className="preview-content">
						<div className="preview-title">Editable Orders Grid</div>
						<div className="mini-grid">
							{['Order', 'Customer', 'Status', 'Total'].map((label) => (
								<div className="mini-cell head" key={label}>
									{label}
								</div>
							))}
							{['#1042', 'Aster Labs', 'Ready', '$12,940', '#1043', 'Northstar', 'Review', '$8,120', '#1044', 'Rivet Co', 'Live', '$21,300'].map((label) => (
								<div className="mini-cell" key={label}>
									{label}
								</div>
							))}
						</div>
						<div className="preview-code">onCellValueChanged =&gt; audit.log(change)</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function ValueCards() {
	const cards = [
		{
			icon: Gauge,
			title: 'Performance first',
			text: 'Document renderer budgets, virtualization guarantees, and long-session behavior with evidence.',
		},
		{
			icon: Braces,
			title: 'Reference quality',
			text: 'Give every public type, event, prop, and method a clear home with examples and stability labels.',
		},
		{
			icon: Sparkles,
			title: 'Polished examples',
			text: 'Turn the internal showcase into focused, copyable patterns that feel as refined as the product.',
		},
	];
	return (
		<section className="value-grid" aria-label="Site priorities">
			{cards.map((card) => {
				const Icon = card.icon;
				return (
					<article className="value-card" key={card.title}>
						<Icon size={22} />
						<h2>{card.title}</h2>
						<p>{card.text}</p>
					</article>
				);
			})}
		</section>
	);
}

function DocsNav({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
	return (
		<aside className="docs-nav" aria-label="Documentation navigation">
			<div className="nav-title">Documentation</div>
			{navGroups.map((group) => (
				<div className="nav-group" key={group}>
					<div className="nav-group-title">{group}</div>
					{docSections
						.filter((section) => section.group === group)
						.map((section) => (
							<button className={cx('nav-link', activeId === section.id && 'active')} key={section.id} onClick={() => onSelect(section.id)}>
								<ChevronRight size={14} />
								{section.title}
							</button>
						))}
				</div>
			))}
		</aside>
	);
}

function CodeBlock({ code }: { code: string }) {
	return (
		<pre className="code-block">
			<code>{code}</code>
		</pre>
	);
}

function DocArticle({ section }: { section: DocSection }) {
	return (
		<article className="doc-article" id={section.id}>
			<div className="article-kicker">{section.group}</div>
			<h2>{section.title}</h2>
			<p className="article-description">{section.description}</p>
			{section.body.map((paragraph) => (
				<p key={paragraph}>{paragraph}</p>
			))}
			{section.checklist ? (
				<div className="check-grid">
					{section.checklist.map((item) => (
						<div className="check-item" key={item}>
							<Check size={15} />
							{item}
						</div>
					))}
				</div>
			) : null}
			{section.code ? <CodeBlock code={section.code} /> : null}
		</article>
	);
}

function DocsExplorer() {
	const [activeId, setActiveId] = useState(docSections[0].id);
	const activeSection = docSections.find((section) => section.id === activeId) ?? docSections[0];
	return (
		<section className="docs-shell" id="docs">
			<DocsNav activeId={activeId} onSelect={setActiveId} />
			<DocArticle section={activeSection} />
			<aside className="toc" aria-label="On this page">
				<div className="toc-title">On This Page</div>
				<a href={`#${activeSection.id}`}>{activeSection.title}</a>
				<a href="#api-reference">API Reference</a>
				<a href="#examples">Examples</a>
				<a href="#roadmap">Docs Roadmap</a>
			</aside>
		</section>
	);
}

function ApiReference() {
	const [query, setQuery] = useState('');
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return apiEntries;
		return apiEntries.filter((entry) =>
			[entry.name, entry.kind, entry.packageName, entry.description].some((value) => value.toLowerCase().includes(normalized))
		);
	}, [query]);
	return (
		<section className="reference-section" id="api-reference">
			<div className="section-heading">
				<div>
					<div className="article-kicker">Reference</div>
					<h2>API Reference</h2>
					<p>Curated first, generated next. This table is the foundation for package, type, event, and method pages.</p>
				</div>
				<label className="search-box">
					<Search size={16} />
					<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search API..." />
				</label>
			</div>
			<div className="api-table">
				{filtered.map((entry) => (
					<div className="api-row" key={`${entry.kind}-${entry.name}`}>
						<div>
							<div className="api-name">{entry.name}</div>
							<div className="api-package">{entry.packageName}</div>
						</div>
						<span className="api-kind">{entry.kind}</span>
						<p>{entry.description}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function ExamplesSection() {
	return (
		<section className="examples-section" id="examples">
			<div className="section-heading">
				<div>
					<div className="article-kicker">Examples</div>
					<h2>Production Patterns</h2>
					<p>Focused examples should become the bridge between API docs and the full engineering showcase.</p>
				</div>
				<a className="button secondary" href="/demo/">
					Showcase app
					<Grid3X3 size={16} />
				</a>
			</div>
			<div className="examples-grid">
				{examples.map((example) => (
					<article className="example-card" key={example.title}>
						<div className="example-tags">
							{example.tags.map((tag) => (
								<span key={tag}>{tag}</span>
							))}
						</div>
						<h3>{example.title}</h3>
						<p>{example.description}</p>
						<CodeBlock code={example.code} />
					</article>
				))}
			</div>
		</section>
	);
}

function Roadmap() {
	const items = [
		['Content split', 'Move README and theming guide into proper docs pages with owner-friendly editing paths.'],
		['Generated reference', 'Extract public declarations into docs JSON for events, GridApi, props, hooks, and types.'],
		['Live examples', 'Mount runnable examples beside their code and keep the current demo as the advanced showcase.'],
		['Search and release polish', 'Add indexed search, version badges, canonical URLs, OpenGraph, sitemap, and CI docs builds.'],
	];
	return (
		<section className="roadmap-section" id="roadmap">
			<div className="section-heading">
				<div>
					<div className="article-kicker">Plan</div>
					<h2>Path To A Library-Grade Site</h2>
					<p>This first pass creates the product surface. The next passes make it complete, generated, and publishable.</p>
				</div>
			</div>
			<div className="roadmap-list">
				{items.map(([title, text], index) => (
					<div className="roadmap-item" key={title}>
						<div className="roadmap-index">{index + 1}</div>
						<div>
							<h3>{title}</h3>
							<p>{text}</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function SiteHeader() {
	return (
		<header className="site-header">
			<a className="brand" href="#overview" aria-label="Wit Grid home">
				<span className="brand-mark">
					<Layers3 size={18} />
				</span>
				Wit Grid
			</a>
			<nav className="top-nav" aria-label="Primary navigation">
				<a href="#docs">Docs</a>
				<a href="#api-reference">API</a>
				<a href="#examples">Examples</a>
				<a href="#roadmap">Roadmap</a>
			</nav>
			<a className="github-link" href="https://github.com" aria-label="GitHub">
				<Github size={18} />
			</a>
		</header>
	);
}

function App() {
	return (
		<div className="app">
			<SiteHeader />
			<main>
				<Hero />
				<ValueCards />
				<div className="feature-strip" aria-label="Documentation highlights">
					<div>
						<Library size={18} />
						Docs IA
					</div>
					<div>
						<TerminalSquare size={18} />
						Copyable code
					</div>
					<div>
						<MousePointer2 size={18} />
						Interactive examples
					</div>
					<div>
						<Code2 size={18} />
						Generated API ready
					</div>
					<div>
						<Zap size={18} />
						Performance proof
					</div>
				</div>
				<DocsExplorer />
				<ApiReference />
				<ExamplesSection />
				<Roadmap />
			</main>
		</div>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
