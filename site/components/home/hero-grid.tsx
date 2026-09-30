'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';

const RealtimeDashboard = dynamic(() => import('@eregister/wit-grid-examples/realtime-dashboard'), {
	ssr: false,
	loading: () => <div className='flex h-full items-center justify-center text-sm text-fd-muted-foreground'>Loading live grid…</div>,
});

export function HeroGrid() {
	const { resolvedTheme } = useTheme();
	return (
		<div className='wg-hero-grid'>
			<RealtimeDashboard compact theme={resolvedTheme === 'light' ? 'light' : 'dark'} />
		</div>
	);
}
