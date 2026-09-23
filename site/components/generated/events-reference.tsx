import events from '@/generated/next/events.json';

type EventDoc = {
	name: string;
	value: string;
	payload: string;
	category: string;
};

export function EventsReference() {
	return (
		<table className='wg-reference-table'>
			<thead>
				<tr>
					<th>Event</th>
					<th>Payload</th>
					<th>Category</th>
				</tr>
			</thead>
			<tbody>
				{(events.events as EventDoc[]).map((event) => (
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
	);
}
