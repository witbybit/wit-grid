import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { MarkdownCopyButton, ViewOptionsPopover } from 'fumadocs-ui/layouts/docs/page';
import { getMDXComponents } from '@/mdx-components';
import { source } from '@/lib/source';
import { currentDocsVersion } from '@/lib/versions';
import { SITE_URL } from '@/lib/site-url';

const GITHUB_OWNER = 'witbybit';
const GITHUB_REPO = 'open-grid';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
	const { slug } = await params;
	if (!slug || slug.length === 0) redirect(`/docs/${currentDocsVersion}`);
	const page = source.getPage(slug);
	if (!page) notFound();

	const MDX = page.data.body;
	const repoPath = `site/content/docs/${page.path}`;
	// Matches the rewrite in next.config.mjs (`/docs/:slug*.md` → the llms.mdx route),
	// so this is a real URL a reader or agent can fetch, not just a label.
	const markdownUrl = `${SITE_URL}${page.url}.md`;
	const lastUpdate = page.data.lastModified;

	return (
		<DocsPage
			toc={page.data.toc}
			full={page.data.full}
			editOnGithub={{ owner: GITHUB_OWNER, repo: GITHUB_REPO, sha: 'main', path: repoPath }}
			lastUpdate={lastUpdate}
		>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<div className='flex flex-wrap items-center gap-2 mb-4'>
				<MarkdownCopyButton markdownUrl={markdownUrl} />
				<ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/main/${repoPath}`} />
			</div>
			<DocsBody>
				<MDX components={getMDXComponents()} />
			</DocsBody>
			<script
				type='application/ld+json'
				// eslint-disable-next-line react/no-danger
				dangerouslySetInnerHTML={{
					__html: JSON.stringify({
						'@context': 'https://schema.org',
						'@type': 'TechArticle',
						headline: page.data.title,
						description: page.data.description,
						url: `${SITE_URL}${page.url}`,
						...(lastUpdate ? { dateModified: lastUpdate.toISOString() } : {}),
						publisher: { '@type': 'Organization', name: 'Wit By Bit' },
					}),
				}}
			/>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
	const { slug } = await params;
	const page = source.getPage(slug);
	if (!page) notFound();

	// `next` tracks unreleased docs and is near-identical to the latest archived version once
	// nothing has diverged yet — keep it crawlable (readers can still find it) but out of search
	// results, so it doesn't dilute ranking for the version people actually install.
	const isUnreleased = page.slugs[0] === currentDocsVersion;

	return {
		title: page.data.title,
		description: page.data.description,
		alternates: { canonical: page.url },
		robots: isUnreleased ? { index: false, follow: true } : undefined,
	};
}
