import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(siteRoot, '..');
const docsRoot = path.join(siteRoot, 'content', 'docs');
const snippetRoot = path.join(siteRoot, '.tmp', 'docs-snippets');
const reactApi = JSON.parse(readFileSync(path.join(siteRoot, 'generated', 'next', 'api.json'), 'utf8'));
const errors = [];

function walkFiles(dir, predicate, files = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(fullPath, predicate, files);
		else if (predicate(fullPath)) files.push(fullPath);
	}
	return files;
}

function toPosix(value) {
	return value.split(path.sep).join('/');
}

function routeForDoc(file) {
	const relative = toPosix(path.relative(docsRoot, file));
	const withoutExt = relative.replace(/\.mdx$/, '');
	return `/docs/${withoutExt.endsWith('/index') ? withoutExt.slice(0, -'/index'.length) : withoutExt}`;
}

function mdxFiles() {
	return walkFiles(docsRoot, (file) => file.endsWith('.mdx'));
}

function lineForOffset(source, offset) {
	return source.slice(0, offset).split(/\r?\n/).length;
}

function resolveAliasImport(specifier) {
	if (!specifier.startsWith('@/')) return null;
	const base = path.join(siteRoot, specifier.slice(2));
	const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function exportedReactSymbols() {
	const names = new Set();
	for (const statement of reactApi.exports) {
		for (const match of statement.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
			const name = match[0];
			if (['export', 'type', 'from', 'as'].includes(name)) continue;
			names.add(name);
		}
	}
	return names;
}

function validateLinks(file, source, routes) {
	for (const match of source.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)]+)?\)/g)) {
		const href = match[1].replace(/\/$/, '');
		if (!routes.has(href)) {
			errors.push(`${file}:${lineForOffset(source, match.index ?? 0)} links to missing docs route ${href}`);
		}
	}
}

function validateMdxImports(file, source) {
	for (const match of source.matchAll(/^\s*import\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/gm)) {
		const specifier = match[1];
		if (specifier.startsWith('@/') && !resolveAliasImport(specifier)) {
			errors.push(`${file}:${lineForOffset(source, match.index ?? 0)} imports missing module ${specifier}`);
		}
	}
}

function validateReactImports(file, source, exportedSymbols) {
	for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]@eregister\/wit-grid-react['"]/g)) {
		for (const rawName of match[1].split(',')) {
			const name = rawName
				.replace(/\btype\b/g, '')
				.trim()
				.split(/\s+as\s+/)[0]
				?.trim();
			if (!name) continue;
			if (!exportedSymbols.has(name)) {
				errors.push(
					`${file}:${lineForOffset(source, match.index ?? 0)} imports ${name} from @eregister/wit-grid-react, but it is not in generated public exports`
				);
			}
		}
	}
}

function extractSnippets(file, source) {
	const snippets = [];
	for (const match of source.matchAll(/```(tsx|ts)\n([\s\S]*?)```/g)) {
		snippets.push({
			lang: match[1],
			code: match[2],
			line: lineForOffset(source, match.index ?? 0),
			file,
		});
	}
	return snippets;
}

function hasNamedImport(code, name) {
	return new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+['"]@eregister/wit-grid-react['"]`).test(code);
}

function snippetModule(snippet) {
	const imports = [];
	if (!hasNamedImport(snippet.code, 'Grid') && /\bGrid\b/.test(snippet.code)) {
		imports.push("import { Grid } from '@eregister/wit-grid-react';");
	}
	for (const name of ['ColumnDef', 'InfiniteDatasource', 'ServerSideDatasource']) {
		if (new RegExp(`\\b${name}\\b`).test(snippet.code) && !hasNamedImport(snippet.code, name)) {
			imports.push(`import type { ${name} } from '@eregister/wit-grid-react';`);
		}
	}

	const declarations = [];
	if (!/\btype\s+Person\b/.test(snippet.code))
		declarations.push('type Person = { id: string; name: string; team: string; score: number; status?: string };');
	if (!/\btype\s+Order\b/.test(snippet.code)) declarations.push('type Order = { id: string; customer: string; total: number };');
	if (!/\b(?:const|let|var)\s+rows\b/.test(snippet.code)) declarations.push('declare const rows: Array<{ id: string }>;');
	if (!/\b(?:const|let|var)\s+columns\b/.test(snippet.code)) declarations.push('declare const columns: any[];');
	if (!/\b(?:const|let|var)\s+datasource\b/.test(snippet.code)) declarations.push('declare const datasource: any;');
	if (!/\b(?:const|let|var|function|class)\s+TeamBadge\b/.test(snippet.code)) declarations.push('declare const TeamBadge: any;');
	if (!/\b(?:const|let|var|function|class)\s+TeamEditor\b/.test(snippet.code)) declarations.push('declare const TeamEditor: any;');
	if (/\bServerSideGroupMetadata\b/.test(snippet.code) && !/ServerSideGroupMetadata/.test(imports.join('\n'))) {
		declarations.push('type ServerSideGroupMetadata = any;');
	}
	const prelude = declarations.join('\n');

	return `// Source: ${toPosix(path.relative(siteRoot, snippet.file))}:${snippet.line}
${imports.join('\n')}
${snippet.code}
${prelude}
export {};
`;
}

function writeSnippetHarness(snippets) {
	if (existsSync(snippetRoot)) {
		const resolved = path.resolve(snippetRoot);
		if (!resolved.startsWith(path.join(siteRoot, '.tmp'))) throw new Error(`Refusing to remove unexpected path ${resolved}`);
		rmSync(resolved, { recursive: true, force: true });
	}
	mkdirSync(snippetRoot, { recursive: true });

	snippets.forEach((snippet, index) => {
		const ext = snippet.lang === 'tsx' ? 'tsx' : 'ts';
		writeFileSync(path.join(snippetRoot, `snippet-${index + 1}.${ext}`), snippetModule(snippet));
	});
	writeFileSync(
		path.join(snippetRoot, 'tsconfig.json'),
		`${JSON.stringify(
			{
				extends: '../../tsconfig.json',
				compilerOptions: {
					noEmit: true,
					declaration: false,
					declarationMap: false,
					jsx: 'react-jsx',
					strict: false,
					types: ['node', 'react'],
				},
				include: ['./*.ts', './*.tsx'],
			},
			null,
			'\t'
		)}\n`
	);
}

function typecheckSnippets(snippets) {
	if (snippets.length === 0) return;
	writeSnippetHarness(snippets);
	const result = spawnSync(
		'node',
		[path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(snippetRoot, 'tsconfig.json')],
		{
			cwd: siteRoot,
			encoding: 'utf8',
		}
	);
	if (result.status !== 0) {
		errors.push(`TypeScript snippet check failed:\n${result.stdout}${result.stderr}`);
	}
}

const files = mdxFiles();
const routes = new Set(files.map(routeForDoc));
const exportedSymbols = exportedReactSymbols();
const snippets = [];

for (const file of files) {
	const source = readFileSync(file, 'utf8');
	validateLinks(file, source, routes);
	validateMdxImports(file, source);
	validateReactImports(file, source, exportedSymbols);
	snippets.push(...extractSnippets(file, source));
}

typecheckSnippets(snippets);

if (errors.length > 0) {
	console.error(errors.join('\n\n'));
	process.exit(1);
}

console.log(`Docs lint passed (${files.length} pages, ${snippets.length} snippets).`);
