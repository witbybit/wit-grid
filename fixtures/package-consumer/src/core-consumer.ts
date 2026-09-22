import { createClientGrid, type ColumnDef } from '@eregister/wit-grid-core';

interface Row {
	id: string;
	name: string;
}

const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];

const api = createClientGrid<Row>({
	rows: [{ id: '1', name: 'Ada' }],
	columns,
	getRowId: (row) => row.id,
});

api.setCellValue('1', 'name', 'Grace');
api.destroy();
