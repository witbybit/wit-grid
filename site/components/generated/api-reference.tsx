import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type PropDoc = {
	name: string;
	optional: boolean;
	type: string;
	description?: string;
	deprecated?: string | boolean;
};

type InterfaceDoc = {
	name: string;
	props: PropDoc[];
};

type ExportDoc = {
	name: string;
	kind: 'value' | 'type';
	source: string | null;
};

type ApiDoc = {
	exports: ExportDoc[];
	interfaces: InterfaceDoc[];
};

function loadApiDoc(version: string): ApiDoc {
	const target = path.join(process.cwd(), 'generated', version, 'api.json');
	const fallback = path.join(process.cwd(), 'generated', 'next', 'api.json');
	const source = existsSync(target) ? target : fallback;
	return JSON.parse(readFileSync(source, 'utf8')) as ApiDoc;
}

function ExportChipList({ items }: { items: ExportDoc[] }) {
	return (
		<div className='flex flex-wrap gap-2'>
			{items.map((item) => (
				<code
					key={`${item.source ?? ''}:${item.name}`}
					title={item.source ?? undefined}
					className='rounded-md border border-fd-border bg-fd-muted/30 px-2 py-1 text-xs text-fd-foreground'
				>
					{item.name}
				</code>
			))}
		</div>
	);
}

export function ApiReference({ version = 'next' }: { version?: string }) {
	const api = loadApiDoc(version);
	const values = api.exports.filter((item) => item.kind === 'value');
	const types = api.exports.filter((item) => item.kind === 'type');

	return (
		<div className='flex flex-col gap-10'>
			<div className='wg-sr-only'>
				<h2>Searchable API Summary</h2>
				<p>Public exports: {api.exports.map((item) => item.name).join(' ')}</p>
				{api.interfaces.map((item) => (
					<p key={item.name}>
						{item.name} props: {item.props.map((prop) => `${prop.name} ${prop.type} ${prop.description ?? ''}`).join(' ')}
					</p>
				))}
			</div>
			<section className='flex flex-col gap-6'>
				<div>
					<h2>Public Exports</h2>
					<p className='mt-1 text-sm text-fd-muted-foreground'>
						Every named export from <code>@eregister/wit-grid-react</code>'s entry point — {values.length} runtime values (components,
						hooks, functions) and {types.length} types. Hover a chip to see which internal module it comes from.
					</p>
				</div>
				<div>
					<h3 className='text-sm font-semibold text-fd-muted-foreground'>Values ({values.length})</h3>
					<div className='mt-2'>
						<ExportChipList items={values} />
					</div>
				</div>
				<div>
					<h3 className='text-sm font-semibold text-fd-muted-foreground'>Types ({types.length})</h3>
					<div className='mt-2'>
						<ExportChipList items={types} />
					</div>
				</div>
			</section>
			{(api.interfaces as InterfaceDoc[]).map((item) => (
				<section key={item.name}>
					<h2>{item.name}</h2>
					<table className='wg-reference-table'>
						<thead>
							<tr>
								<th>Prop</th>
								<th>Required</th>
								<th>Type</th>
								<th>Description</th>
							</tr>
						</thead>
						<tbody>
							{item.props.map((prop) => (
								<tr key={prop.name}>
									<td>
										<code>{prop.name}</code>
									</td>
									<td>{prop.optional ? 'No' : 'Yes'}</td>
									<td>
										<code>{prop.type}</code>
									</td>
									<td>
										{prop.deprecated ? <p className='mb-2 font-medium text-fd-muted-foreground'>Deprecated</p> : null}
										{prop.description ?? ''}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			))}
		</div>
	);
}
