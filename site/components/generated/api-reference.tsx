import api from '@/generated/next/api.json';

type PropDoc = {
	name: string;
	optional: boolean;
	type: string;
	description?: string;
};

type InterfaceDoc = {
	name: string;
	props: PropDoc[];
};

export function ApiReference() {
	return (
		<div className='flex flex-col gap-10'>
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
									<td>{prop.description ?? ''}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			))}
		</div>
	);
}
