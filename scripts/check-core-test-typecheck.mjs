import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const configPath = path.join(workspaceRoot, 'packages/core/tsconfig.test-typecheck.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const diagnostics = ts
	.getPreEmitDiagnostics(program)
	.map((diagnostic) => {
		const file = diagnostic.file ? path.relative(workspaceRoot, diagnostic.file.fileName).replaceAll('\\', '/') : '<config>';
		// Deliberately exclude line numbers: formatting-only edits move diagnostics
		// without changing the legacy typing debt this characterization gate tracks.
		return `${file}:TS${diagnostic.code}:${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
	})
	.sort();
const signature = createHash('sha256').update(diagnostics.join('\n')).digest('hex');

// Characterization baseline for legacy tests. Source diagnostics are never hidden:
// `@eregister/open-grid-core typecheck` first runs `tsc --noEmit` against the production project.
const baseline = { count: 444, signature: 'd66dd57d325aa4df2e0a4b5a191da451daa1d055a9bc4137c4bb16bf7eb616a7' };

if (process.argv.includes('--report')) {
	console.log(JSON.stringify({ count: diagnostics.length, signature }, null, 2));
	process.exit(0);
}
if (diagnostics.length !== baseline.count || signature !== baseline.signature) {
	console.error(
		`Core test typecheck baseline changed: expected ${baseline.count}/${baseline.signature}, received ${diagnostics.length}/${signature}.`
	);
	console.error(diagnostics.slice(0, 20).join('\n'));
	process.exit(1);
}
