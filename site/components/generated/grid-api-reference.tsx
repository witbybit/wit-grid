import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type GridApiMemberDoc = {
	name: string;
	optional: boolean;
	signature: string;
	description?: string;
	deprecated?: string | boolean;
};

type GridApiGroupDoc = {
	title: string;
	interfaceName: string;
	methods: GridApiMemberDoc[];
};

type GridApiReferenceDoc = {
	groups: GridApiGroupDoc[];
};

function loadGridApiDoc(version: string): GridApiReferenceDoc {
	const target = path.join(process.cwd(), 'generated', version, 'grid-api.json');
	const fallback = path.join(process.cwd(), 'generated', 'next', 'grid-api.json');
	const source = existsSync(target) ? target : fallback;
	return JSON.parse(readFileSync(source, 'utf8')) as GridApiReferenceDoc;
}

export function GridApiReference({ version = 'next' }: { version?: string }) {
	const doc = loadGridApiDoc(version);

	return (
		<div className='flex flex-col gap-10'>
			<div className='wg-sr-only'>
				<h2>Searchable Grid API Summary</h2>
				{doc.groups.map((group) => (
					<p key={group.interfaceName}>
						{group.title}: {group.methods.map((method) => `${method.name} ${method.signature} ${method.description ?? ''}`).join(' ')}
					</p>
				))}
			</div>
			{doc.groups.map((group) => (
				<section key={group.interfaceName}>
					<h2>{group.title}</h2>
					<table className='wg-reference-table'>
						<thead>
							<tr>
								<th>Method / Property</th>
								<th>Signature</th>
								<th>Description</th>
							</tr>
						</thead>
						<tbody>
							{group.methods.map((method) => (
								<tr key={method.name}>
									<td>
										<code>
											{method.name}
											{method.optional ? '?' : ''}
										</code>
									</td>
									<td>
										<code>{method.signature}</code>
									</td>
									<td>
										{method.deprecated ? <p className='mb-2 font-medium text-fd-muted-foreground'>Deprecated</p> : null}
										{method.description ?? ''}
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
