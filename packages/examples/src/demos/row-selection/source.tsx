'use client';

import { Grid, type ColumnDef } from '@eregister/wit-grid-react';

type Row = {
	id: string;
	task: string;
	owner: string;
	priority: 'Low' | 'Medium' | 'High';
};

const rows: Row[] = [
	{ id: 'task-1', task: 'Publish migration notes', owner: 'Mira', priority: 'High' },
	{ id: 'task-2', task: 'Audit event payload docs', owner: 'Rey', priority: 'Medium' },
	{ id: 'task-3', task: 'Refresh example coverage', owner: 'Nia', priority: 'Low' },
];

const columns: ColumnDef<Row>[] = [
	{ field: 'task', header: 'Task', width: 240 },
	{ field: 'owner', header: 'Owner', width: 150 },
	{ field: 'priority', header: 'Priority', width: 140 },
];

export default function RowSelectionExample() {
	return <Grid rows={rows} columns={columns} getRowId={(row) => row.id} rowSelection='multiple' showStatusBar />;
}
