import { Component as BasicGrid } from '@eregister/wit-grid-examples/basic-grid';
import { Component as Persistence } from '@eregister/wit-grid-examples/persistence';
import { Component as RowSelection } from '@eregister/wit-grid-examples/row-selection';
import { showcaseExamples } from '@eregister/wit-grid-examples/showcase';

const previews = {
	'basic-grid': BasicGrid,
	'row-selection': RowSelection,
	persistence: Persistence,
};

export default function DocsShowcase() {
	return (
		<div className='grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto pr-1 xl:grid-cols-3'>
			{showcaseExamples.map((example) => {
				const Preview = previews[example.id as keyof typeof previews];
				return (
					<section
						key={example.id}
						className='flex min-h-[360px] flex-col overflow-hidden rounded-xl border border-slate-850 bg-slate-950/65'
					>
						<div className='border-b border-slate-850 p-4'>
							<div className='flex items-center justify-between gap-3'>
								<h3 className='text-sm font-extrabold text-slate-100'>{example.title}</h3>
								<span className='rounded-md border border-slate-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400'>
									{example.level}
								</span>
							</div>
							<p className='mt-2 min-h-10 text-xs leading-5 text-slate-400'>{example.description}</p>
							<div className='mt-3 flex flex-wrap gap-2'>
								{example.tags.map((tag) => (
									<span key={tag} className='rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400'>
										{tag}
									</span>
								))}
							</div>
						</div>
						<div className='min-h-0 flex-1 p-3'>
							<div className='h-full min-h-[220px] overflow-hidden rounded-lg border border-slate-850 bg-slate-900/50 p-2'>
								<Preview />
							</div>
						</div>
					</section>
				);
			})}
		</div>
	);
}
