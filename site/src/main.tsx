import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, BookOpen, Check, ChevronRight, Code2, Github, Grid3X3, Layers3, Search } from 'lucide-react';
import { apiEntries, docSections, type DocSection } from './content/docs';
import { eventDocs, eventUsageCode } from './content/events';
import { liveExamples, type LiveExample } from './content/examples';
import './styles.css';

const navGroups = Array.from(new Set(docSections.map((section) => section.group)));
const defaultDoc = docSections[0];

function cx(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(' ');
}

function usePathname() {
	const [pathname, setPathname] = useState(() => window.location.pathname);
	useEffect(() => {
		const handlePopState = () => setPathname(window.location.pathname);
		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	}, []);
	return pathname;
}

function navigate(path: string) {
	if (window.location.pathname === path) return;
	window.history.pushState(null, '', path);
	window.dispatchEvent(new PopStateEvent('popstate'));
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function AppLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
	return (
		<a
			className={className}
			href={href}
			onClick={(event) => {
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				event.preventDefault();
				navigate(href);
			}}
		>
			{children}
		</a>
	);
}

function Hero({ onPrimary }: { onPrimary: () => void }) {
	return (
		<section className='hero' id='overview'>
			<div className='hero-copy'>
				<div className='eyebrow'>
					<span className='status-dot' />
					Alpha docs foundation
				</div>
				<h1>Wit Grid</h1>
				<p className='hero-lede'>Documentation for the Wit Grid React adapter and framework-agnostic core engine.</p>
				<div className='hero-actions'>
					<button className='button primary' onClick={onPrimary}>
						Get started
						<ArrowRight size={16} />
					</button>
					<AppLink className='button secondary' href='/api/reference'>
						API reference
						<BookOpen size={16} />
					</AppLink>
				</div>
			</div>
			<div className='hero-panel' aria-label='Wit Grid documentation preview'>
				<div className='browser-bar'>
					<span />
					<span />
					<span />
				</div>
				<div className='preview-grid'>
					<div className='preview-sidebar'>
						<div className='preview-pill active'>Quick Start</div>
						<div className='preview-pill'>Columns</div>
						<div className='preview-pill'>Events</div>
						<div className='preview-pill'>Theming</div>
					</div>
					<div className='preview-content'>
						<div className='preview-title'>Editable Orders Grid</div>
						<div className='mini-grid'>
							{['Order', 'Customer', 'Status', 'Total'].map((label) => (
								<div className='mini-cell head' key={label}>
									{label}
								</div>
							))}
							{[
								'#1042',
								'Aster Labs',
								'Ready',
								'$12,940',
								'#1043',
								'Northstar',
								'Review',
								'$8,120',
								'#1044',
								'Rivet Co',
								'Live',
								'$21,300',
							].map((label) => (
								<div className='mini-cell' key={label}>
									{label}
								</div>
							))}
						</div>
						<div className='preview-code'>onCellValueChanged =&gt; audit.log(change)</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function DocsNav({ activePath }: { activePath: string }) {
	return (
		<aside className='docs-nav' aria-label='Documentation navigation'>
			<div className='nav-title'>Documentation</div>
			{navGroups.map((group) => (
				<div className='nav-group' key={group}>
					<div className='nav-group-title'>{group}</div>
					{docSections
						.filter((section) => section.group === group)
						.map((section) => (
							<AppLink className={cx('nav-link', activePath === section.path && 'active')} href={section.path} key={section.id}>
								<ChevronRight size={14} />
								{section.title}
							</AppLink>
						))}
				</div>
			))}
		</aside>
	);
}

function CodeBlock({ code }: { code: string }) {
	return (
		<pre className='code-block'>
			<code>{code}</code>
		</pre>
	);
}

function ExampleNav({ activePath }: { activePath: string }) {
	return (
		<aside className='docs-nav' aria-label='Examples navigation'>
			<div className='nav-title'>Examples</div>
			{liveExamples.map((example) => (
				<AppLink className={cx('nav-link', activePath === example.path && 'active')} href={example.path} key={example.id}>
					<ChevronRight size={14} />
					{example.title}
				</AppLink>
			))}
		</aside>
	);
}

function DocArticle({ section }: { section: DocSection }) {
	if (section.id === 'events') return <EventsArticle section={section} />;
	return (
		<article className='doc-article' id={section.id}>
			<div className='article-kicker'>{section.group}</div>
			<h2>{section.title}</h2>
			<p className='article-description'>{section.description}</p>
			{section.body.map((paragraph) => (
				<p key={paragraph}>{paragraph}</p>
			))}
			{section.checklist ? (
				<div className='check-grid'>
					{section.checklist.map((item) => (
						<div className='check-item' key={item}>
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

function EventsArticle({ section }: { section: DocSection }) {
	const categories = Array.from(new Set(eventDocs.map((event) => event.category)));
	return (
		<article className='doc-article' id={section.id}>
			<div className='article-kicker'>{section.group}</div>
			<h2>{section.title}</h2>
			<p className='article-description'>{section.description}</p>
			{section.body.map((paragraph) => (
				<p key={paragraph}>{paragraph}</p>
			))}
			<div className='event-callout'>
				<strong>Use React callbacks for common UI hooks.</strong>
				<p>
					Use `api.addEventListener(GridEventName.*, listener)` when you need the full event surface, cleanup control, or integration with
					analytics and persistence code.
				</p>
			</div>
			<CodeBlock code={eventUsageCode} />
			<div className='event-category-list'>
				{categories.map((category) => (
					<section className='event-category' key={category}>
						<h3>{category}</h3>
						<div className='event-table'>
							{eventDocs
								.filter((event) => event.category === category)
								.map((event) => (
									<div className='event-row' key={event.name}>
										<div>
											<code>{event.name}</code>
											{event.reactCallback ? <span className='react-callback'>React callback</span> : null}
										</div>
										<p>{event.when}</p>
										<code>{event.payload}</code>
									</div>
								))}
						</div>
					</section>
				))}
			</div>
		</article>
	);
}

function DocsLayout({ section, activePath }: { section: DocSection; activePath: string }) {
	return (
		<section className='docs-shell' id='docs'>
			<DocsNav activePath={activePath} />
			<DocArticle section={section} />
			<aside className='toc' aria-label='On this page'>
				<div className='toc-title'>On This Page</div>
				<a href={`#${section.id}`}>{section.title}</a>
				<AppLink href='/api/reference'>API Reference</AppLink>
				<AppLink href='/examples'>Examples</AppLink>
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
		<section className='reference-section' id='api-reference'>
			<div className='section-heading'>
				<div>
					<div className='article-kicker'>Reference</div>
					<h2>API Reference</h2>
					<p>Curated first, generated next. This table is the foundation for package, type, event, and method pages.</p>
				</div>
				<label className='search-box'>
					<Search size={16} />
					<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search API...' />
				</label>
			</div>
			<div className='api-table'>
				{filtered.map((entry) => (
					<div className='api-row' key={`${entry.kind}-${entry.name}`}>
						<div>
							<div className='api-name'>{entry.name}</div>
							<div className='api-package'>{entry.packageName}</div>
						</div>
						<span className='api-kind'>{entry.kind}</span>
						<p>{entry.description}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function ExamplesSection() {
	return (
		<section className='examples-section' id='examples'>
			<div className='section-heading'>
				<div>
					<div className='article-kicker'>Examples</div>
					<h2>Production Patterns</h2>
					<p>Common implementation patterns for React applications using Wit Grid.</p>
				</div>
				<a className='button secondary' href='/demo/'>
					Open demo
					<Grid3X3 size={16} />
				</a>
			</div>
			<div className='examples-grid'>
				{liveExamples.map((example) => (
					<article className='example-card' key={example.title}>
						<div className='example-tags'>
							{example.tags.map((tag) => (
								<span key={tag}>{tag}</span>
							))}
						</div>
						<h3>{example.title}</h3>
						<p>{example.description}</p>
						<AppLink className='example-link' href={example.path}>
							View example
							<ArrowRight size={15} />
						</AppLink>
					</article>
				))}
			</div>
		</section>
	);
}

function ExampleDetail({ example }: { example: LiveExample }) {
	const Preview = example.Preview;
	return (
		<section className='example-shell'>
			<ExampleNav activePath={example.path} />
			<article className='example-detail'>
				<div className='article-kicker'>Example</div>
				<h2>{example.title}</h2>
				<p className='article-description'>{example.description}</p>
				<div className='example-tags detail-tags'>
					{example.tags.map((tag) => (
						<span key={tag}>{tag}</span>
					))}
				</div>
				<div className='live-preview' id='preview'>
					<div className='preview-heading'>
						<span>Preview</span>
						<Grid3X3 size={16} />
					</div>
					<Suspense fallback={<div className='live-preview-loading'>Loading preview...</div>}>
						<Preview />
					</Suspense>
				</div>
				<div className='example-notes'>
					<h3>Notes</h3>
					<ul>
						{example.notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</div>
				<div className='code-heading' id='source'>
					<span>Source</span>
					<Code2 size={16} />
				</div>
				<CodeBlock code={example.code} />
			</article>
			<aside className='toc' aria-label='Example contents'>
				<div className='toc-title'>On This Page</div>
				<a href='#preview'>Preview</a>
				<a href='#source'>Source</a>
				<AppLink href='/examples'>All Examples</AppLink>
			</aside>
		</section>
	);
}

function SiteHeader({ activePath }: { activePath: string }) {
	return (
		<header className='site-header'>
			<AppLink className='brand' href='/' aria-label='Wit Grid home'>
				<span className='brand-mark'>
					<Layers3 size={18} />
				</span>
				Wit Grid
			</AppLink>
			<nav className='top-nav' aria-label='Primary navigation'>
				<AppLink className={cx(activePath.startsWith('/docs') && 'active')} href='/docs/introduction'>
					Docs
				</AppLink>
				<AppLink className={cx(activePath.startsWith('/api') && 'active')} href='/api/reference'>
					API
				</AppLink>
				<AppLink className={cx(activePath === '/examples' && 'active')} href='/examples'>
					Examples
				</AppLink>
			</nav>
			<a className='github-link' href='https://github.com' aria-label='GitHub'>
				<Github size={18} />
			</a>
		</header>
	);
}

function HomePage() {
	return (
		<>
			<Hero onPrimary={() => navigate('/docs/quick-start')} />
			<DocsLayout section={docSections.find((section) => section.id === 'quick-start') ?? defaultDoc} activePath='/docs/quick-start' />
			<ApiReference />
			<ExamplesSection />
		</>
	);
}

function App() {
	const pathname = usePathname();
	const normalizedPath = pathname === '/docs' ? '/docs/introduction' : pathname;
	const activeDoc = docSections.find((section) => section.path === normalizedPath);
	const activeExample = liveExamples.find((example) => example.path === normalizedPath);
	const isApi = normalizedPath === '/api/reference';
	const isExamples = normalizedPath === '/examples';
	const isHome = normalizedPath === '/';

	return (
		<div className='app'>
			<SiteHeader activePath={normalizedPath} />
			<main>
				{isHome ? <HomePage /> : null}
				{activeDoc ? <DocsLayout section={activeDoc} activePath={activeDoc.path} /> : null}
				{activeExample ? <ExampleDetail example={activeExample} /> : null}
				{isApi ? <ApiReference /> : null}
				{isExamples ? <ExamplesSection /> : null}
				{!isHome && !activeDoc && !activeExample && !isApi && !isExamples ? (
					<DocsLayout section={defaultDoc} activePath={defaultDoc.path} />
				) : null}
			</main>
		</div>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
