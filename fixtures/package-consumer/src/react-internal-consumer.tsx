import { type GridHostWithAdapter } from '@eregister/open-grid-core/internal';
import { Grid, type ColumnDef } from '@eregister/open-grid-react';

interface Row {
	id: string;
	name: string;
}

const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
const rows: Row[] = [{ id: '1', name: 'Ada' }];

// The React package itself uses the narrow internal adapter contract. This
// external compilation proves that the published React types and that contract
// still resolve together, without importing any implementation deep paths.
const adapterHost: GridHostWithAdapter<Row> | undefined = undefined;
void adapterHost;

export function FixtureGridWithAdapterContract() {
	return <Grid rowModelType='client' rows={rows} columns={columns} getRowId={(row: Row) => row.id} />;
}
