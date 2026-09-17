import { createInfiniteGrid, type ColumnDef, type InfiniteDatasource } from '@eregister/open-grid-core';

interface Row {
	id: string;
	name: string;
}

const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
const datasource: InfiniteDatasource<Row> = {
	async getRows() {
		return { rows: [], totalCount: 0 };
	},
};

const api = createInfiniteGrid<Row>({ columns, datasource, getRowId: (row) => row.id });
api.destroy();
