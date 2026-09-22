import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			'@eregister/wit-grid-core/experimental': resolve(__dirname, '../core/src/experimental.ts'),
			'@eregister/wit-grid-core/internal': resolve(__dirname, '../core/src/internal.ts'),
			'@eregister/wit-grid-core': resolve(__dirname, '../core/src/index.ts'),
		},
	},
	test: {
		environment: 'jsdom',
	},
});
