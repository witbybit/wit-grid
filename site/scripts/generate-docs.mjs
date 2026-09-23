import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function parseProps(source, name) {
	const body = extractInterface(source, name);
	if (!body) return { name, props: [] };

	const props = [];
	const lines = body.split('\n');
	let pendingComment = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith('/**')) {
			pendingComment = [trimmed];
			continue;
		}
		if (pendingComment.length > 0) {
			pendingComment.push(trimmed);
			if (!trimmed.endsWith('*/')) continue;
		}

		const match = trimmed.match(/^([A-Za-z_$][\w$]*)\??:\s*(.+?);?$/);
		if (!match) continue;
		props.push({
			name: match[1],
			optional: trimmed.includes('?:'),
			type: normalizeType(match[2]),
			description: pendingComment.length > 0 ? stripCommentMarkers(pendingComment) : undefined,
		});
		pendingComment = [];
	}

	return { name, props };
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

function parseApi() {
	const gridSource = readRepo('packages/react/src/Grid.tsx');
	const gridViewSource = readRepo('packages/react/src/GridView.tsx');
	const indexSource = readRepo('packages/react/src/index.ts');
	const exports = indexSource
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('export '))
		.map((line) => line.replace(/;$/, ''));

	return {
		generatedAt: 'build',
		source: 'packages/react/src',
		exports,
		interfaces: [
			parseProps(gridSource, 'GridClientProps'),
			parseProps(gridSource, 'GridInfiniteProps'),
			parseProps(gridSource, 'GridServerSideProps'),
			parseProps(gridViewSource, 'GridViewProps'),
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
	const exampleDirs = ['basic-grid', 'editable-grid', 'persistence'];
	const examples = exampleDirs.map((dir) => {
		const meta = parseMeta(readFileSync(path.join(siteRoot, 'examples', dir, 'meta.ts'), 'utf8'));
		const source = readFileSync(path.join(siteRoot, 'examples', dir, 'source.tsx'), 'utf8');
		return {
			...meta,
			sourcePath: `site/examples/${dir}/source.tsx`,
			source,
		};
	});

	return {
		generatedAt: 'build',
		source: 'site/examples',
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
