import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { SITE_URL } from '@/lib/site-url';
import { currentDocsVersion } from '@/lib/versions';

export default function sitemap(): MetadataRoute.Sitemap {
	// `next` pages are noindexed (see app/docs/[[...slug]]/page.tsx) — omit them here too, a
	// sitemap listing noindexed URLs is a contradiction search engines flag.
	const docPages = source
		.getPages()
		.filter((page) => page.slugs[0] !== currentDocsVersion)
		.map((page) => ({
			url: `${SITE_URL}${page.url}`,
			lastModified: new Date(),
		}));

	return [{ url: SITE_URL, lastModified: new Date() }, ...docPages];
}
