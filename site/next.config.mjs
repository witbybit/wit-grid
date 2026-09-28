import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	transpilePackages: ['@eregister/wit-grid-examples'],
	async rewrites() {
		// Lets a reader or agent fetch `/docs/1.4/installation.md` and get the raw
		// Markdown for that page, served by app/llms.mdx/docs/[[...slug]]/route.ts.
		return [
			{
				source: '/docs/:slug*.md',
				destination: '/llms.mdx/docs/:slug*/content.md',
			},
		];
	},
};

export default withMDX(nextConfig);
