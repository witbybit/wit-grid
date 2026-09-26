import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';

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
		if (statement.getKind() !== SyntaxKind.ExportDeclaration && statement.getKind() !== SyntaxKind.ExportAssignment) continue;
		exports.push(statement.getText().replace(/;$/, ''));
	}
	return exports;
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

function parseExamples() {
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

	return {
		generatedAt: 'build',
		source: 'packages/examples/src/demos',
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
writeJson('generated/next/examples.json', parseExamples());

console.log(check ? 'Generated docs are up to date.' : 'Generated docs updated.');
