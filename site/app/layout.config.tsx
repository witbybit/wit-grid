import { WitGridWordmark } from '@/components/brand/wit-grid-mark';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
	nav: {
		title: (
			<span className='wg-nav-brand'>
				<WitGridWordmark />
			</span>
		),
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
		{
			text: 'GitHub',
			url: 'https://github.com/witbybit/open-grid',
			external: true,
		},
	],
};
