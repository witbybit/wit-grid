import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	resolve: {
		// One React copy: the workspace also installs React 19 for the docs site.
		dedupe: ['react', 'react-dom'],
		alias: {
			'@eregister/wit-grid-core/experimental': resolve(__dirname, '../core/src/experimental.ts'),
			'@eregister/wit-grid-core/internal': resolve(__dirname, '../core/src/internal.ts'),
			'@eregister/wit-grid-core': resolve(__dirname, '../core/src/index.ts'),
			'@eregister/wit-grid-react/experimental': resolve(__dirname, '../react/src/experimental.ts'),
			'@eregister/wit-grid-react': resolve(__dirname, '../react/src/index.ts'),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.{ts,tsx}'],
		testTimeout: 120_000,
	},
});
