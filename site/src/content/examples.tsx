import { lazy, type LazyExoticComponent } from 'react';

export type LiveExample = {
	id: string;
	path: string;
	title: string;
	description: string;
	tags: string[];
	Preview: LazyExoticComponent<() => JSX.Element>;
	code: string;
	notes: string[];
};

const BasicGridPreview = lazy(() => import('../examples/LivePreviews').then((module) => ({ default: module.BasicGridPreview })));
const EditableCellsPreview = lazy(() => import('../examples/LivePreviews').then((module) => ({ default: module.EditableCellsPreview })));
const CustomRendererPreview = lazy(() => import('../examples/LivePreviews').then((module) => ({ default: module.CustomRendererPreview })));

export const liveExamples: LiveExample[] = [
	{
		id: 'basic-grid',
		path: '/examples/basic-grid',
		title: 'Basic Grid',
		description: 'Render local rows with typed column definitions and explicit row identity.',
		tags: ['React', 'Client rows'],
		Preview: BasicGridPreview,
		notes: [
			'Use stable column definitions.',
			'Pass getRowId when rows have durable application ids.',
			'Omit rowModelType for the default client row model.',
		],
		code: `import { useMemo } from 'react';
import { Grid, type ColumnDef } from '@eregister/wit-grid-react';

type OrderRow = {
  id: string;
  customer: string;
  status: 'Draft' | 'Review' | 'Ready';
  amount: number;
  owner: string;
};

export function OrdersGrid({ rows }: { rows: OrderRow[] }) {
  const columns = useMemo<ColumnDef<OrderRow>[]>(() => [
    { field: 'id', header: 'Order', width: 130 },
    { field: 'customer', header: 'Customer', width: 180 },
    { field: 'status', header: 'Status', width: 130 },
    {
      field: 'amount',
      header: 'Amount',
      width: 130,
      valueFormatter: ({ value }) => \`$\${Number(value).toLocaleString()}\`,
    },
    { field: 'owner', header: 'Owner', width: 120 },
  ], []);

  return <Grid columns={columns} rows={rows} getRowId={(row) => row.id} />;
}`,
	},
	{
		id: 'editable-cells',
		path: '/examples/editable-cells',
		title: 'Editable Cells',
		description: 'Use built-in renderers and editors for common business fields.',
		tags: ['Editing', 'Cell types'],
		Preview: EditableCellsPreview,
		notes: [
			'Create renderer/editor factories inside a stable memo.',
			'Use valueSetter when edits need custom normalization.',
			'Start with built-in cell types before writing custom editors.',
		],
		code: `import {
  Grid,
  createDropdownCellEditor,
  createDropdownCellRenderer,
  createNumberCellEditor,
  createNumberCellRenderer,
  type ColumnDef,
} from '@eregister/wit-grid-react';

const statusOptions = [
  { label: 'Draft', value: 'Draft', color: 'gray' },
  { label: 'Review', value: 'Review', color: 'amber' },
  { label: 'Ready', value: 'Ready', color: 'green' },
];

const columns: ColumnDef<OrderRow>[] = [
  {
    field: 'status',
    header: 'Status',
    renderer: { kind: 'react', component: createDropdownCellRenderer(statusOptions) },
    cellEditor: createDropdownCellEditor(statusOptions),
  },
  {
    field: 'amount',
    header: 'Amount',
    renderer: { kind: 'react', component: createNumberCellRenderer({ prefix: '$', decimals: 2, locale: true }) },
    cellEditor: createNumberCellEditor({ min: 0 }),
    valueSetter: ({ row, value }) => {
      row.amount = Number(value);
      return true;
    },
  },
];`,
	},
	{
		id: 'custom-renderer',
		path: '/examples/custom-renderer',
		title: 'Custom Renderer',
		description: 'Render application-specific cell UI while keeping the grid responsible for layout and lifecycle.',
		tags: ['Renderers', 'React'],
		Preview: CustomRendererPreview,
		notes: [
			'Custom renderers receive value, row, rowId, column field, and the GridApi.',
			'Keep renderers cheap for large scrolling surfaces.',
			'Use formatted primitive cells when a custom component is not needed.',
		],
		code: `import { Grid, type CellRendererProps, type ColumnDef } from '@eregister/wit-grid-react';

function StatusRenderer({ value }: CellRendererProps<OrderRow, OrderRow['status']>) {
  const tone = value === 'Ready' ? 'green' : value === 'Review' ? 'amber' : 'slate';
  return <span className={\`status-badge \${tone}\`}>{value}</span>;
}

const columns: ColumnDef<OrderRow>[] = [
  { field: 'id', header: 'Order', width: 130 },
  { field: 'customer', header: 'Customer', width: 180 },
  {
    field: 'status',
    header: 'Status',
    width: 140,
    renderer: { kind: 'react', component: StatusRenderer },
  },
];`,
	},
];
