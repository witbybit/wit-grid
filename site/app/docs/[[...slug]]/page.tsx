import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { getMDXComponents } from '@/mdx-components';
import { source } from '@/lib/source';
import { currentDocsVersion } from '@/lib/versions';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
	const { slug } = await params;
	if (!slug || slug.length === 0) redirect(`/docs/${currentDocsVersion}`);
	const page = source.getPage(slug);
	if (!page) notFound();

	const MDX = page.data.body;

	return (
		<DocsPage toc={page.data.toc} full={page.data.full}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDX components={getMDXComponents()} />
			</DocsBody>
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

	return {
		title: page.data.title,
		description: page.data.description,
	};
}
