import { configDefaults, defineConfig } from 'vitest/config';

// Stress suites that measure the grid under sustained load. They are slow (about a third of the
// suite's time) and wall-clock sensitive, so they run on their own: `pnpm test:perf`
// (vitest --mode perf). Every other default is unchanged.
const PERF_SUITES = ['src/perf/longSessionResilience.test.ts', 'src/renderer/serverRuntimePerformance.test.ts'];

export default defineConfig(({ mode }) => ({
	test: {
		exclude: mode === 'perf' ? configDefaults.exclude : [...configDefaults.exclude, ...PERF_SUITES],
	},
}));
