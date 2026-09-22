import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [
			{
				find: '@eregister/wit-grid-core/experimental',
				replacement: resolve(__dirname, '../packages/core/src/experimental.ts'),
			},
			{
				find: '@eregister/wit-grid-core/internal',
				replacement: resolve(__dirname, '../packages/core/src/internal.ts'),
			},
			{
				find: '@eregister/wit-grid-core',
				replacement: resolve(__dirname, '../packages/core/src/index.ts'),
			},
			{
				find: '@eregister/wit-grid-react/experimental',
				replacement: resolve(__dirname, '../packages/react/src/experimental.ts'),
			},
			{
				find: '@eregister/wit-grid-react',
				replacement: resolve(__dirname, '../packages/react/src/index.ts'),
			},
		],
		dedupe: ['react', 'react-dom'],
	},
	server: {
		port: 5174,
	},
});
