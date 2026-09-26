import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { SITE_URL } from '@/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
	const docPages = source.getPages().map((page) => ({
		url: `${SITE_URL}${page.url}`,
		lastModified: new Date(),
	}));

	return [{ url: SITE_URL, lastModified: new Date() }, ...docPages];
}
