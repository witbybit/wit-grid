import { createServerSideGrid, type ColumnDef, type ServerSideDatasource } from '@eregister/open-grid-core';

interface Row {
	id: string;
	name: string;
}

const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
const datasource: ServerSideDatasource<Row> = {
	async getRows() {
		return { rows: [], rowCount: 0 };
	},
};

const api = createServerSideGrid<Row>({ columns, datasource, getRowId: (row) => row.id });
api.destroy();
