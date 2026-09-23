import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(siteRoot, '..');
const explicitVersion = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]);
const fromPackage = process.argv.includes('--from-package');
const fullVersion = process.argv.includes('--full');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

function versionFromPackage() {
	const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages', 'react', 'package.json'), 'utf8'));
	const raw = manifest.version;
	if (typeof raw !== 'string' || raw.length === 0) throw new Error('packages/react/package.json has no version.');
	if (fullVersion) return raw;
	const match = raw.match(/^(\d+\.\d+)/);
	if (!match) throw new Error(`Cannot derive major.minor docs version from package version "${raw}".`);
	return match[1];
}

const version = fromPackage ? versionFromPackage() : explicitVersion;

if (!version || version === 'next' || !/^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
	throw new Error('Usage: pnpm --filter wit-grid-site docs:release <version> [--force], or docs:release --from-package [--full] [--force]');
}

const docsSource = path.join(siteRoot, 'content', 'docs', 'next');
const docsTarget = path.join(siteRoot, 'content', 'docs', version);
const generatedSource = path.join(siteRoot, 'generated', 'next');
const generatedTarget = path.join(siteRoot, 'generated', version);

function ensureTarget(pathname) {
	if (!existsSync(pathname)) return;
	if (!force) throw new Error(`${path.relative(siteRoot, pathname)} already exists. Re-run with --force to replace it.`);
	if (dryRun) return;
	rmSync(pathname, { recursive: true, force: true });
}

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(siteRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, data) {
	writeFileSync(path.join(siteRoot, relativePath), `${JSON.stringify(data, null, '\t')}\n`);
}

function rewriteSnapshotMdx(dir) {
	for (const name of ['api-reference.mdx', 'events.mdx']) {
		const target = path.join(dir, name);
		if (!existsSync(target)) continue;
		const source = readFileSync(target, 'utf8')
			.replaceAll('<ApiReference />', `<ApiReference version="${version}" />`)
			.replaceAll('<EventsReference />', `<EventsReference version="${version}" />`);
		writeFileSync(target, source);
	}
}

function updateDocsMeta() {
	const meta = readJson('content/docs/meta.json');
	const pages = Array.isArray(meta.pages) ? meta.pages.filter((page) => page !== version) : ['next'];
	const nextIndex = pages.indexOf('next');
	if (nextIndex >= 0) pages.splice(nextIndex + 1, 0, version);
	else pages.unshift(version);
	meta.pages = pages;
	writeJson('content/docs/meta.json', meta);
}

function updateVersionRegistry() {
	const target = path.join(siteRoot, 'lib', 'versions.ts');
	const labels = readJson('content/docs/meta.json').pages;
	const versions = labels.map((slug) => ({
		label: slug === 'next' ? 'Next' : slug,
		slug,
		url: `/docs/${slug}`,
		status: slug === 'next' ? 'current' : 'archived',
	}));
	const body = `export type DocsVersion = {
\tlabel: string;
\tslug: string;
\turl: string;
\tstatus: 'current' | 'archived';
};

export const currentDocsVersion = 'next';

export const docsVersions: DocsVersion[] = ${JSON.stringify(versions, null, '\t')};

export function getVersionFromSlug(slug?: string[]): DocsVersion {
\tconst version = docsVersions.find((item) => item.slug === slug?.[0]);
\treturn version ?? docsVersions[0];
}
`;
	writeFileSync(target, body);
}

ensureTarget(docsTarget);
ensureTarget(generatedTarget);
if (dryRun) {
	console.log(`Would create docs snapshot for ${version}.`);
	console.log(`Docs: ${path.relative(siteRoot, docsSource)} -> ${path.relative(siteRoot, docsTarget)}`);
	console.log(`Generated refs: ${path.relative(siteRoot, generatedSource)} -> ${path.relative(siteRoot, generatedTarget)}`);
	process.exit(0);
}
mkdirSync(path.dirname(docsTarget), { recursive: true });
mkdirSync(path.dirname(generatedTarget), { recursive: true });
cpSync(docsSource, docsTarget, { recursive: true });
cpSync(generatedSource, generatedTarget, { recursive: true });
rewriteSnapshotMdx(docsTarget);
updateDocsMeta();
updateVersionRegistry();

console.log(`Created docs snapshot for ${version}.`);
