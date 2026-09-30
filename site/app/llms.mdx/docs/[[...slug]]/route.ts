import { notFound } from 'next/navigation';
import { docsLlms, source } from '@/lib/source';

export const revalidate = false;

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
	const { slug } = await params;
	// generateStaticParams appends a trailing `content.md` segment (see below) so the URL a reader
	// requests (`/docs/foo.md`, rewritten to this route) maps onto the slug of the real doc page.
	const slugs = slug?.slice(0, -1) ?? [];

	const page = source.getPage(slugs);
	if (!page) notFound();

	return new Response(await docsLlms.page(page), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
}

export function generateStaticParams() {
	return source.generateParams().map((item) => ({
		...item,
		slug: [...(item.slug ?? []), 'content.md'],
	}));
}
