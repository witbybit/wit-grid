import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';
import { codeToTokens } from 'shiki';

// Examples are highlighted once here, at build time, and shipped as pre-computed token arrays —
// the Examples page renders them directly instead of re-implementing syntax highlighting client-side.
const EXAMPLE_HIGHLIGHT_THEME = 'github-dark';

async function highlightSource(source) {
	const { tokens } = await codeToTokens(source, { lang: 'tsx', theme: EXAMPLE_HIGHLIGHT_THEME });
	return tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color })));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(siteRoot, '..');
const check = process.argv.includes('--check');

const eventCategories = new Map([
	['aggDefsChanged', 'Aggregation'],
	['cellClicked', 'Cells'],
	['cellInvalidated', 'Cells'],
	['cellsCopied', 'Clipboard'],
	['cellsPasted', 'Clipboard'],
	['cellValueChanged', 'Editing'],
	['writeBlocked', 'Editing'],
	['columnOrderChanged', 'Columns'],
	['columnReorderToggled', 'Columns'],
	['columnResized', 'Columns'],
	['columnsChanged', 'Columns'],
	['editStarted', 'Editing'],
	['editStopped', 'Editing'],
	['enableStickyGroupRowsChanged', 'Rows'],
	['filterChanged', 'Filtering'],
	['quickFilterChanged', 'Filtering'],
	['focusChanged', 'Navigation'],
	['groupByChanged', 'Grouping'],
	['groupColumnAdded', 'Grouping'],
	['groupColumnRemoved', 'Grouping'],
	['groupColumnMoved', 'Grouping'],
	['layoutTransitionCaptureRequested', 'Rendering'],
	['renderInvalidated', 'Rendering'],
	['rowResized', 'Rows'],
	['rowSelectionChanged', 'Selection'],
	['rowsUpdated', 'Rows'],
	['runtimeFault', 'Diagnostics'],
	['selectionChanged', 'Selection'],
	['paginationChanged', 'Pagination'],
	['infiniteBlockLoaded', 'Infinite row model'],
	['infiniteBlockLoadFailed', 'Infinite row model'],
	['serverSideStateChanged', 'Server row model'],
	['showGroupFooterChanged', 'Grouping'],
	['sortChanged', 'Sorting'],
	['cellValidationChanged', 'Validation'],
	['gridValidated', 'Validation'],
	['rowDragStart', 'Row drag'],
	['rowDragMove', 'Row drag'],
	['rowDragEnd', 'Row drag'],
	['rowDragCancelled', 'Row drag'],
	['rowOrderChanged', 'Row drag'],
	['queryModelChanged', 'Query model'],
	['viewSaved', 'Workspace'],
	['viewApplied', 'Workspace'],
	['viewDeleted', 'Workspace'],
	['viewRenamed', 'Workspace'],
	['workspaceStateChanged', 'Workspace'],
]);

function readRepo(relativePath) {
	return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function stripCommentMarkers(lines) {
	return lines
		.join('\n')
		.replace(/^\/\*\*\s*/m, '')
		.replace(/\s*\*\/$/m, '')
		.split('\n')
		.map((line) => line.replace(/^\s*\*\s?/, '').trim())
		.filter(Boolean)
		.join(' ');
}

function normalizeType(type) {
	return type
		.replace(/\s+/g, ' ')
		.replace(/\s*;\s*$/, '')
		.trim();
}

function extractInterface(source, name) {
	const start = source.search(new RegExp(`(?:export\\s+)?interface\\s+${name}\\b`));
	if (start < 0) return null;
	const bodyStart = source.indexOf('{', start);
	let depth = 0;
	for (let index = bodyStart; index < source.length; index++) {
		const char = source[index];
		if (char === '{') depth++;
		if (char === '}') depth--;
		if (depth === 0) return source.slice(bodyStart + 1, index);
	}
	return null;
}

function parseEvents() {
	const sourcePath = 'packages/core/src/api/GridEvents.ts';
	const source = readRepo(sourcePath);
	const enumBody = extractInterface(source.replace('export enum GridEventName', 'interface GridEventName'), 'GridEventName');
	const events = [];

	for (const match of enumBody.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)) {
		events.push({
			name: match[1],
			value: match[2],
			payload: 'unknown',
			category: eventCategories.get(match[1]) ?? 'Grid',
		});
	}

	const payloadBody = extractInterface(source, 'GridEventPayloadMap');
	if (payloadBody) {
		const lines = payloadBody.split('\n');
		const payloads = new Map();
		let currentName = null;
		let current = [];

		for (const line of lines) {
			const start = line.match(/\[GridEventName\.([A-Za-z_$][\w$]*)\]:\s*(.*)/);
			if (start) {
				if (currentName) payloads.set(currentName, normalizeType(current.join(' ')));
				currentName = start[1];
				current = [start[2]];
				continue;
			}
			if (currentName) current.push(line.trim());
		}
		if (currentName) payloads.set(currentName, normalizeType(current.join(' ')));

		for (const event of events) {
			event.payload = payloads.get(event.name) ?? 'unknown';
		}
	}

	return {
		generatedAt: 'build',
		source: sourcePath,
		events,
	};
}

const project = new Project({
	tsConfigFilePath: path.join(repoRoot, 'tsconfig.json'),
	skipAddingFilesFromTsConfig: true,
});

function createSource(relativePath) {
	return project.addSourceFileAtPath(path.join(repoRoot, relativePath));
}

function getNodeDocs(node) {
	const jsDocs = typeof node.getJsDocs === 'function' ? node.getJsDocs() : [];
	const comment = jsDocs
		.map((doc) => doc.getCommentText() ?? '')
		.filter(Boolean)
		.join('\n')
		.trim();
	const deprecated = jsDocs.flatMap((doc) => doc.getTags()).find((tag) => tag.getTagName() === 'deprecated');
	return {
		description: comment || undefined,
		deprecated: deprecated ? deprecated.getCommentText() || true : undefined,
	};
}

function parseInterfaceProps(sourceFile, interfaces, name, seen = new Set()) {
	const node = interfaces.get(name);
	if (!node || seen.has(name)) return [];
	seen.add(name);

	const inherited = [];
	for (const type of node.getExtends()) {
		const expression = type.getExpression().getText();
		if (interfaces.has(expression)) {
			inherited.push(...parseInterfaceProps(sourceFile, interfaces, expression, seen));
		}
	}

	const own = node
		.getMembers()
		.filter((member) => member.getKind() === SyntaxKind.PropertySignature)
		.map((member) => {
			const docs = getNodeDocs(member);
			return {
				name: member.getName(),
				optional: member.hasQuestionToken(),
				type: normalizeType(member.getTypeNode()?.getText() ?? 'unknown'),
				...docs,
			};
		});

	const byName = new Map();
	for (const prop of [...inherited, ...own]) byName.set(prop.name, prop);
	return [...byName.values()];
}

function parseInterfaceDoc(sourceFile, interfaces, name) {
	return {
		name,
		props: parseInterfaceProps(sourceFile, interfaces, name),
	};
}

function parseExports(sourceFile) {
	const exports = [];
	for (const statement of sourceFile.getStatements()) {
		if (statement.getKind() !== SyntaxKind.ExportDeclaration) continue;
		const moduleSpecifier = statement.getModuleSpecifierValue() ?? null;
		const declarationIsTypeOnly = statement.isTypeOnly();
		for (const specifier of statement.getNamedExports()) {
			const name = specifier.getAliasNode()?.getText() ?? specifier.getName();
			const isType = declarationIsTypeOnly || specifier.isTypeOnly();
			exports.push({ name, kind: isType ? 'type' : 'value', source: moduleSpecifier });
		}
	}
	exports.sort((a, b) => a.name.localeCompare(b.name));
	return exports;
}

// The interfaces GridApi is composed from, in display order, with a human-readable section title.
// If GridApi's own `extends` list ever drifts from this list, parseGridApi() throws at build time
// instead of silently omitting a surface — see the drift guard at the end of that function.
const GRID_API_GROUPS = [
	{ interfaceName: 'GridDataApi', title: 'State, Rows & Cells' },
	{ interfaceName: 'GridSelectionEditingApi', title: 'Selection & Editing' },
	{ interfaceName: 'GridStructureApi', title: 'Columns, Sort, Filter & Grouping' },
	{ interfaceName: 'GridRuntimeSubscriptionApi', title: 'Events, Subscriptions & Theming' },
	{ interfaceName: 'GridPersistenceWorkspaceApi', title: 'Persistence & Workspace Views' },
	{ interfaceName: 'GridDiagnosticsCapabilityApi', title: 'History, Panels & Capabilities' },
];

function memberSignature(member) {
	const name = member.getName();
	const optional = typeof member.hasQuestionToken === 'function' ? member.hasQuestionToken() : false;
	const text = member.getText().replace(/;\s*$/, '');
	let rest = text.slice(name.length);
	if (optional && rest.startsWith('?')) rest = rest.slice(1);
	rest = rest.replace(/^:\s*/, '');
	return { name, optional, signature: normalizeType(rest) };
}

function parseGridApi() {
	const surfacesSource = createSource('packages/core/src/api/GridApiSurfaces.ts');
	const surfaceInterfaces = new Map(surfacesSource.getInterfaces().map((item) => [item.getName(), item]));

	const groups = GRID_API_GROUPS.map(({ interfaceName, title }) => {
		const node = surfaceInterfaces.get(interfaceName);
		if (!node) throw new Error(`Could not find interface "${interfaceName}" in GridApiSurfaces.ts`);
		const methods = node
			.getMembers()
			.filter((member) => member.getKind() === SyntaxKind.MethodSignature || member.getKind() === SyntaxKind.PropertySignature)
			.map((member) => ({ ...memberSignature(member), ...getNodeDocs(member) }));
		return { title, interfaceName, methods };
	});

	// Drift guard: fail the build if GridApi's own `extends` clause ever adds, removes, or renames a
	// surface interface without GRID_API_GROUPS above being updated to match.
	const gridApiNode = surfaceInterfaces.get('GridApi');
	if (!gridApiNode) throw new Error('Could not find interface "GridApi" in GridApiSurfaces.ts');
	const actualExtends = gridApiNode.getExtends().map((clause) => clause.getExpression().getText());
	const expectedExtends = GRID_API_GROUPS.map((group) => group.interfaceName);
	const missing = expectedExtends.filter((name) => !actualExtends.includes(name));
	const extra = actualExtends.filter((name) => !expectedExtends.includes(name));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(
			`GridApi's "extends" list in GridApiSurfaces.ts no longer matches GRID_API_GROUPS in generate-docs.mjs. ` +
				`Missing from GRID_API_GROUPS: [${missing.join(', ')}]. No longer part of GridApi: [${extra.join(', ')}]. ` +
				`Update GRID_API_GROUPS to match.`
		);
	}

	return {
		generatedAt: 'build',
		source: 'packages/core/src/api/GridApiSurfaces.ts',
		groups,
	};
}

function parseApi() {
	const gridSource = createSource('packages/react/src/Grid.tsx');
	const gridViewSource = createSource('packages/react/src/GridView.tsx');
	const indexSource = createSource('packages/react/src/index.ts');
	const gridInterfaces = new Map(gridSource.getInterfaces().map((item) => [item.getName(), item]));
	const gridViewInterfaces = new Map(gridViewSource.getInterfaces().map((item) => [item.getName(), item]));

	return {
		generatedAt: 'build',
		source: 'packages/react/src',
		extraction: 'typescript-ast',
		exports: parseExports(indexSource),
		interfaces: [
			parseInterfaceDoc(gridSource, gridInterfaces, 'GridClientProps'),
			parseInterfaceDoc(gridSource, gridInterfaces, 'GridInfiniteProps'),
			parseInterfaceDoc(gridSource, gridInterfaces, 'GridServerSideProps'),
			parseInterfaceDoc(gridViewSource, gridViewInterfaces, 'GridViewProps'),
		],
	};
}

function parseMeta(source) {
	const id = source.match(/id:\s*'([^']+)'/)?.[1];
	const title = source.match(/title:\s*'([^']+)'/)?.[1];
	const description = source.match(/description:\s*'([^']+)'/)?.[1];
	if (!id || !title || !description) throw new Error('Example meta must export id, title, and description string literals.');
	return { id, title, description };
}

// Reads packages/examples/src/registry.ts's `promotedShowcases` array literal so the
// showcase metadata has exactly one source of truth (the shared examples package),
// instead of a second hand-maintained copy living in this script.
function parseRegistryShowcases() {
	const registryPath = 'packages/examples/src/registry.ts';
	const registrySource = createSource(registryPath);
	const declaration = registrySource.getVariableDeclarations().find((decl) => decl.getName() === 'promotedShowcases');
	if (!declaration) throw new Error(`Could not find "promotedShowcases" in ${registryPath}`);

	const arrayLiteral = declaration.getInitializerIfKind(SyntaxKind.SatisfiesExpression)?.getExpression() ?? declaration.getInitializer();
	if (!arrayLiteral || arrayLiteral.getKind() !== SyntaxKind.ArrayLiteralExpression) {
		throw new Error(`"promotedShowcases" in ${registryPath} must be an array literal.`);
	}

	return arrayLiteral.getElements().map((element) => {
		const entry = {};
		for (const property of element.getProperties()) {
			if (property.getKind() !== SyntaxKind.PropertyAssignment) continue;
			const key = property.getName();
			const initializer = property.getInitializer();
			const text = initializer?.getText() ?? '';
			if (initializer?.getKind() === SyntaxKind.ArrayLiteralExpression) {
				entry[key] = initializer.getElements().map((el) => el.getText().replace(/^['"]|['"]$/g, ''));
			} else {
				entry[key] = text.replace(/^['"]|['"]$/g, '');
			}
		}
		return entry;
	});
}

async function parseExamples() {
	const examplesRoot = path.join(repoRoot, 'packages', 'examples', 'src', 'demos');
	const exampleDirs = readdirSync(examplesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const examples = exampleDirs.map((dir) => {
		const meta = parseMeta(readFileSync(path.join(examplesRoot, dir, 'meta.ts'), 'utf8'));
		const sourcePath = `packages/examples/src/demos/${dir}/source.tsx`;
		const source = readRepo(sourcePath);
		return {
			...meta,
			sourcePath,
			source,
		};
	});

	for (const showcase of parseRegistryShowcases()) {
		examples.push({
			id: showcase.id,
			title: showcase.title,
			description: showcase.description,
			sourcePath: showcase.sourcePath,
			source: readRepo(showcase.sourcePath),
		});
	}

	for (const example of examples) {
		example.tokens = await highlightSource(example.source);
	}

	return {
		generatedAt: 'build',
		source: 'packages/examples/src',
		theme: EXAMPLE_HIGHLIGHT_THEME,
		examples,
	};
}

function writeJson(relativePath, data) {
	const target = path.join(siteRoot, relativePath);
	const body = `${JSON.stringify(data, null, '\t')}\n`;
	if (check) {
		if (!existsSync(target)) throw new Error(`${relativePath} is missing. Run pnpm --filter wit-grid-site docs:generate.`);
		const current = readFileSync(target, 'utf8');
		if (current !== body) throw new Error(`${relativePath} is stale. Run pnpm --filter wit-grid-site docs:generate.`);
		return;
	}
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, body);
}

writeJson('generated/next/events.json', parseEvents());
writeJson('generated/next/api.json', parseApi());
writeJson('generated/next/grid-api.json', parseGridApi());
writeJson('generated/next/examples.json', await parseExamples());

console.log(check ? 'Generated docs are up to date.' : 'Generated docs updated.');
