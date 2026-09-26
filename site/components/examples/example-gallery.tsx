'use client';

import dynamic from 'next/dynamic';
import examples from '@/generated/next/examples.json';
import { showcaseExamples, type WitGridExampleMeta } from '@eregister/wit-grid-examples/showcase';

const previewModules = {
	'basic-grid': dynamic(() => import('@eregister/wit-grid-examples/basic-grid').then((module) => module.Component), { ssr: false }),
	'row-selection': dynamic(() => import('@eregister/wit-grid-examples/row-selection').then((module) => module.Component), { ssr: false }),
	persistence: dynamic(() => import('@eregister/wit-grid-examples/persistence').then((module) => module.Component), { ssr: false }),
};

type ExampleDoc = {
	id: keyof typeof previewModules;
	title: string;
	description: string;
	source: string;
};

export function ExampleGallery() {
	const sourceById = new Map((examples.examples as ExampleDoc[]).map((example) => [example.id, example]));

	return (
		<div className='flex flex-col gap-10'>
			{(showcaseExamples as WitGridExampleMeta[]).map((example) => {
				const Preview = previewModules[example.id as keyof typeof previewModules];
				const source = sourceById.get(example.id as keyof typeof previewModules)?.source ?? '';
				return (
					<section key={example.id} className='flex flex-col gap-4'>
						<div>
							<h2>{example.title}</h2>
							<p className='text-fd-muted-foreground'>{example.description}</p>
							<div className='mt-3 flex flex-wrap gap-2'>
								{example.tags.map((tag) => (
									<span key={tag} className='rounded-md border border-fd-border px-2 py-1 text-xs text-fd-muted-foreground'>
										{tag}
									</span>
								))}
							</div>
						</div>
						<div className='wg-grid-preview'>
							<Preview />
						</div>
						<div className='wg-code'>
							<pre>{source}</pre>
						</div>
					</section>
				);
			})}
		</div>
	);
}
