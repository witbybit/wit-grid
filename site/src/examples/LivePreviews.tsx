import React, { useMemo } from 'react';
import {
	Grid,
	type CellRendererProps,
	type ColumnDef,
	createDropdownCellEditor,
	createDropdownCellRenderer,
	createNumberCellEditor,
	createNumberCellRenderer,
} from '@eregister/wit-grid-react';

type OrderRow = {
	id: string;
	customer: string;
	status: 'Draft' | 'Review' | 'Ready';
	amount: number;
	owner: string;
};

const orderRows: OrderRow[] = [
	{ id: 'ORD-1001', customer: 'Aster Labs', status: 'Ready', amount: 12940, owner: 'Mina' },
	{ id: 'ORD-1002', customer: 'Northstar', status: 'Review', amount: 8120, owner: 'Theo' },
	{ id: 'ORD-1003', customer: 'Rivet Co', status: 'Draft', amount: 21300, owner: 'Ira' },
	{ id: 'ORD-1004', customer: 'Kite Systems', status: 'Ready', amount: 5400, owner: 'Nora' },
	{ id: 'ORD-1005', customer: 'Blue Oak', status: 'Review', amount: 16680, owner: 'Sam' },
];

const statusOptions = [
	{ label: 'Draft', value: 'Draft', color: 'default' as const },
	{ label: 'Review', value: 'Review', color: 'amber' as const },
	{ label: 'Ready', value: 'Ready', color: 'green' as const },
];

function ExampleFrame({ children }: { children: React.ReactNode }) {
	return <div className='live-grid-frame'>{children}</div>;
}

export function BasicGridPreview() {
	const columns = useMemo<ColumnDef<OrderRow>[]>(
		() => [
			{ field: 'id', header: 'Order', width: 130 },
			{ field: 'customer', header: 'Customer', width: 180 },
			{ field: 'status', header: 'Status', width: 130 },
			{
				field: 'amount',
				header: 'Amount',
				width: 130,
				valueFormatter: ({ value }) => `$${Number(value).toLocaleString()}`,
			},
			{ field: 'owner', header: 'Owner', width: 120 },
		],
		[]
	);
	return (
		<ExampleFrame>
			<Grid columns={columns} rows={orderRows} getRowId={(row) => row.id} initialState={{ defaultRowHeight: 38, defaultColWidth: 140 }} />
		</ExampleFrame>
	);
}

export function EditableCellsPreview() {
	const columns = useMemo<ColumnDef<OrderRow>[]>(
		() => [
			{ field: 'id', header: 'Order', width: 130 },
			{ field: 'customer', header: 'Customer', width: 180 },
			{
				field: 'status',
				header: 'Status',
				width: 140,
				renderer: { kind: 'react', component: createDropdownCellRenderer(statusOptions) },
				cellEditor: createDropdownCellEditor(statusOptions),
			},
			{
				field: 'amount',
				header: 'Amount',
				width: 140,
				renderer: { kind: 'react', component: createNumberCellRenderer({ prefix: '$', decimals: 2, locale: true }) },
				cellEditor: createNumberCellEditor({ min: 0 }),
				valueSetter: ({ row, value }) => {
					row.amount = Number(value);
					return true;
				},
			},
		],
		[]
	);
	return (
		<ExampleFrame>
			<Grid columns={columns} rows={orderRows} getRowId={(row) => row.id} initialState={{ defaultRowHeight: 40, defaultColWidth: 145 }} />
		</ExampleFrame>
	);
}

function StatusRenderer({ value }: CellRendererProps<OrderRow, OrderRow['status']>) {
	const tone = value === 'Ready' ? 'green' : value === 'Review' ? 'amber' : 'slate';
	return <span className={`status-badge ${tone}`}>{value}</span>;
}

export function CustomRendererPreview() {
	const columns = useMemo<ColumnDef<OrderRow>[]>(
		() => [
			{ field: 'id', header: 'Order', width: 130 },
			{ field: 'customer', header: 'Customer', width: 180 },
			{ field: 'status', header: 'Status', width: 140, renderer: { kind: 'react', component: StatusRenderer } },
			{
				field: 'amount',
				header: 'Amount',
				width: 140,
				valueFormatter: ({ value }) => `$${Number(value).toLocaleString()}`,
			},
		],
		[]
	);
	return (
		<ExampleFrame>
			<Grid columns={columns} rows={orderRows} getRowId={(row) => row.id} initialState={{ defaultRowHeight: 40, defaultColWidth: 145 }} />
		</ExampleFrame>
	);
}
