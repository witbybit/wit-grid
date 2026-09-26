'use client';

import { Grid } from '@eregister/wit-grid-react';

const rows = [
	{ id: 'row-1', name: 'Ada Lovelace', team: 'Compute', status: 'Active' },
	{ id: 'row-2', name: 'Grace Hopper', team: 'Compiler', status: 'Active' },
	{ id: 'row-3', name: 'Katherine Johnson', team: 'Flight', status: 'Review' },
	{ id: 'row-4', name: 'Dorothy Vaughan', team: 'Systems', status: 'Active' },
];

const columns = [
	{ field: 'name', header: 'Name', width: 180 },
	{ field: 'team', header: 'Team', width: 160 },
	{ field: 'status', header: 'Status', width: 140 },
];

export default function BasicGridExample() {
	return <Grid rows={rows} columns={columns} getRowId={(row) => row.id} showStatusBar />;
}
