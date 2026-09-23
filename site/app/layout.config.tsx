import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
	nav: {
		title: 'Wit Grid',
	},
	links: [
		{
			text: 'Docs',
			url: '/docs/next',
			active: 'nested-url',
		},
		{
			text: 'Examples',
			url: '/docs/next/examples',
			active: 'nested-url',
		},
		{
			text: 'API',
			url: '/docs/next/api-reference',
			active: 'nested-url',
		},
	],
};
