import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_BASE = path.join(ROOT, '.tmp');
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function run(command, args, cwd, env = {}) {
	const executable = command === 'npm' ? process.execPath : command;
	const finalArgs = command === 'npm' ? [NPM_CLI, ...args] : args;
	const result = spawnSync(executable, finalArgs, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
		shell: false,
		env: { ...process.env, ...env },
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
		throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${details}`);
	}

	return result.stdout.trim();
}

function packPackage(packageDir, destinationDir, env) {
	const output = run('npm', ['pack', '--json', '--pack-destination', destinationDir], packageDir, env);
	const packed = JSON.parse(output);
	if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== 'string') {
		throw new Error(`npm pack did not report one tarball for ${packageDir}`);
	}
	return { path: path.join(destinationDir, packed[0].filename), files: new Set(packed[0].files.map((file) => file.path)) };
}

function assertTarballContents(tarball, packageName, requiredFiles) {
	for (const file of requiredFiles) {
		if (!tarball.files.has(file)) {
			throw new Error(`${packageName} tarball is missing required published file ${file}`);
		}
	}
}

function copyWorkspacePackage(sourceSegments, destinationSegments) {
	const candidates = [path.join(ROOT, 'node_modules', ...sourceSegments), path.join(ROOT, 'packages', 'react', 'node_modules', ...sourceSegments)];
	const source = candidates.find((candidate) => existsSync(candidate));
	if (!source) {
		throw new Error(`Unable to locate workspace package ${sourceSegments.join('/')}`);
	}
	const destination = path.join(...destinationSegments);
	mkdirSync(path.dirname(destination), { recursive: true });
	cpSync(source, destination, { recursive: true, dereference: true });
}

function main() {
	mkdirSync(TMP_BASE, { recursive: true });
	const tmpRoot = mkdtempSync(path.join(TMP_BASE, 'open-grid-pack-verify-'));
	const tarballDir = path.join(tmpRoot, 'tarballs');
	const fixtureTemplateDir = path.join(ROOT, 'fixtures', 'package-consumer');
	const fixtureDir = path.join(tmpRoot, 'package-consumer');
	const npmCacheDir = path.join(tmpRoot, 'npm-cache');
	const npmEnv = { npm_config_cache: npmCacheDir };

	mkdirSync(tarballDir, { recursive: true });
	mkdirSync(npmCacheDir, { recursive: true });

	try {
		// Pack only freshly compiled declarations: this is a type-level consumer gate,
		// not a check against a potentially stale local dist directory.
		run('npm', ['run', 'build'], path.join(ROOT, 'packages', 'core'), npmEnv);
		run('npm', ['run', 'build'], path.join(ROOT, 'packages', 'react'), npmEnv);

		const coreTarball = packPackage(path.join(ROOT, 'packages', 'core'), tarballDir, npmEnv);
		const reactTarball = packPackage(path.join(ROOT, 'packages', 'react'), tarballDir, npmEnv);
		assertTarballContents(coreTarball, '@eregister/open-grid-core', [
			'README.md',
			'dist/index.js',
			'dist/index.d.ts',
			'dist/experimental.js',
			'dist/experimental.d.ts',
			'dist/internal.js',
			'dist/internal.d.ts',
		]);
		assertTarballContents(reactTarball, '@eregister/open-grid-react', [
			'dist/index.js',
			'dist/index.d.ts',
			'dist/experimental.js',
			'dist/experimental.d.ts',
		]);

		cpSync(fixtureTemplateDir, fixtureDir, { recursive: true });

		const packageJsonPath = path.join(fixtureDir, 'package.json');
		const packageJson = readFileSync(packageJsonPath, 'utf8')
			.replace('__CORE_TARBALL__', coreTarball.path.replace(/\\/g, '/'))
			.replace('__REACT_TARBALL__', reactTarball.path.replace(/\\/g, '/'));
		writeFileSync(packageJsonPath, packageJson);

		run('npm', ['install', '--no-save', '--ignore-scripts', '--legacy-peer-deps', coreTarball.path, reactTarball.path], fixtureDir, npmEnv);
		copyWorkspacePackage(['react'], [fixtureDir, 'node_modules', 'react']);
		copyWorkspacePackage(['react-dom'], [fixtureDir, 'node_modules', 'react-dom']);
		copyWorkspacePackage(['@types', 'react'], [fixtureDir, 'node_modules', '@types', 'react']);
		copyWorkspacePackage(['@types', 'react-dom'], [fixtureDir, 'node_modules', '@types', 'react-dom']);
		run(
			process.execPath,
			[path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', path.join(fixtureDir, 'tsconfig.json')],
			ROOT
		);

		process.stdout.write(`pack:verify succeeded using fixture ${fixtureDir}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.stderr.write(`pack:verify workspace preserved at ${tmpRoot}\n`);
		process.exitCode = 1;
		return;
	}

	rmSync(tmpRoot, { recursive: true, force: true });
}

main();
