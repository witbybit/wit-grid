'use client';

import dynamic from 'next/dynamic';
import examples from '@/generated/next/examples.json';

const previewModules = {
	'basic-grid': dynamic(() => import('@/examples/basic-grid/source'), { ssr: false }),
	'editable-grid': dynamic(() => import('@/examples/editable-grid/source'), { ssr: false }),
	persistence: dynamic(() => import('@/examples/persistence/source'), { ssr: false }),
};

type ExampleDoc = {
	id: keyof typeof previewModules;
	title: string;
	description: string;
	source: string;
};

export function ExampleGallery() {
	return (
		<div className='flex flex-col gap-10'>
			{(examples.examples as ExampleDoc[]).map((example) => {
				const Preview = previewModules[example.id];
				return (
					<section key={example.id} className='flex flex-col gap-4'>
						<div>
							<h2>{example.title}</h2>
							<p className='text-fd-muted-foreground'>{example.description}</p>
						</div>
						<div className='wg-grid-preview'>
							<Preview />
						</div>
						<div className='wg-code'>
							<pre>{example.source}</pre>
						</div>
					</section>
				);
			})}
		</div>
	);
}
