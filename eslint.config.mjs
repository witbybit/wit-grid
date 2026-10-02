import { tseslint } from '@eregister/wit-grid-eslint';

export default [
	{
		ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.vite/**'],
	},
	...tseslint.configs.recommended,
	{
		files: ['packages/core/src/**/*.{ts,tsx}'],
		rules: {
			// Controlled baseline (many public compatibility seams): 0 explicit-any checks.
			// The TypeScript ESLint parser and the remaining recommended correctness rules stay active.
			'@typescript-eslint/no-explicit-any': 'off',
			// Controlled baseline: 96 unused-symbol diagnostics and 2 prefer-const diagnostics.
			// Re-enable each rule as its mechanical backlog is retired; lint never writes source.
			'@typescript-eslint/no-unused-vars': 'off',
			'prefer-const': 'off',
			// Controlled baseline: `{}` compatibility types in internal generic utilities
			// (typescript-eslint 8 split this out of the former `ban-types` rule).
			'@typescript-eslint/no-empty-object-type': 'off',
		},
	},
	{
		files: ['packages/core/src/**/*.ts'],
		ignores: ['**/*.test.ts'],
		rules: {
			// Types come from top-level `import type`, never inline `import('...').Name` annotations.
			'@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: true, fixStyle: 'separate-type-imports' }],
		},
	},
];
