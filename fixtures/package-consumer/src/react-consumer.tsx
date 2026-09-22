import { Grid, type ColumnDef } from '@eregister/wit-grid-react';

interface Row {
	id: string;
	name: string;
}

const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
const rows: Row[] = [{ id: '1', name: 'Ada' }];

export function FixtureGrid() {
	return <Grid rowModelType='client' rows={rows} columns={columns} getRowId={(row: Row) => row.id} />;
}
