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

type ApiDoc = {
	exports: string[];
	interfaces: InterfaceDoc[];
};

function loadApiDoc(version: string): ApiDoc {
	const target = path.join(process.cwd(), 'generated', version, 'api.json');
	const fallback = path.join(process.cwd(), 'generated', 'next', 'api.json');
	const source = existsSync(target) ? target : fallback;
	return JSON.parse(readFileSync(source, 'utf8')) as ApiDoc;
}

export function ApiReference({ version = 'next' }: { version?: string }) {
	const api = loadApiDoc(version);

	return (
		<div className='flex flex-col gap-10'>
			<div className='wg-sr-only'>
				<h2>Searchable API Summary</h2>
				<p>Public exports: {api.exports.join(' ')}</p>
				{api.interfaces.map((item) => (
					<p key={item.name}>
						{item.name} props: {item.props.map((prop) => `${prop.name} ${prop.type} ${prop.description ?? ''}`).join(' ')}
					</p>
				))}
			</div>
			<section>
				<h2>Public Exports</h2>
				<div className='wg-code'>
					<pre>{api.exports.join('\n')}</pre>
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
