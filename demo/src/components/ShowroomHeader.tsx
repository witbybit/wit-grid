import React from 'react';
import { Zap } from 'lucide-react';

export default function ShowroomHeader() {
	return (
		<header className='flex flex-col md:flex-row items-start md:items-center justify-between pb-5 border-b border-slate-900 gap-4 shrink-0'>
			<div>
				<div className='flex items-center gap-3'>
					<span className='p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20'>
						<Zap className='w-6 h-6 animate-pulse' />
					</span>
					<div>
						<h1 className='text-2xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent flex items-center gap-2'>
							Wit Grid Showcase
						</h1>
						<p className='text-xs text-slate-400 mt-1 max-w-2xl font-medium'>
							Explore our ultra high-performance coordinate-isolated row-store. Prove strict $O(1)$ calculations, inspect real-time
							logs, profile transaction latencies, and configure rich custom editors.
						</p>
					</div>
				</div>
			</div>
		</header>
	);
}
