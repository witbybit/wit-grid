import { llms } from 'fumadocs-core/source';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/plugins/lucide-icons';
import { docs } from '@/.source/server';

export const source = loader({
	baseUrl: '/docs',
	source: docs.toFumadocsSource(),
	plugins: [lucideIconsPlugin()],
});

// Powers /llms.txt, /llms-full.txt, and the per-page `.md` route — see app/llms.txt,
// app/llms-full.txt, and app/llms.mdx/docs/[[...slug]]/route.ts.
export const docsLlms = llms(source, {
	renderPage: async (page) => `# ${page.data.title} (${page.url})\n\n${await page.data.getText('processed')}`,
});
