// Single source of truth for the site's public origin — used by metadataBase, sitemap.ts, and
// robots.ts. Set NEXT_PUBLIC_SITE_URL in the production deployment's environment; falls back to
// the local dev origin so `pnpm build`/`pnpm dev` work without it configured.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:5174';
