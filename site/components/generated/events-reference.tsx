import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type EventDoc = {
	name: string;
	value: string;
	payload: string;
	category: string;
};

type EventReferenceDoc = {
	events: EventDoc[];
};

function loadEventDoc(version: string): EventReferenceDoc {
	const target = path.join(process.cwd(), 'generated', version, 'events.json');
	const fallback = path.join(process.cwd(), 'generated', 'next', 'events.json');
	const source = existsSync(target) ? target : fallback;
	return JSON.parse(readFileSync(source, 'utf8')) as EventReferenceDoc;
}

export function EventsReference({ version = 'next' }: { version?: string }) {
	const events = loadEventDoc(version);

	return (
		<>
			<div className='wg-sr-only'>
				<h2>Searchable Events Summary</h2>
				<p>{events.events.map((event) => `${event.value} ${event.name} ${event.category} ${event.payload}`).join(' ')}</p>
			</div>
			<table className='wg-reference-table'>
				<thead>
					<tr>
						<th>Event</th>
						<th>Payload</th>
						<th>Category</th>
					</tr>
				</thead>
				<tbody>
					{events.events.map((event) => (
						<tr key={event.name}>
							<td>
								<code>{event.value}</code>
							</td>
							<td>
								<code>{event.payload}</code>
							</td>
							<td>{event.category}</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}
