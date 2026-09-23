'use client';

import { Grid } from '@eregister/wit-grid-react';

const rows = Array.from({ length: 24 }, (_, index) => ({
	id: `asset-${index + 1}`,
	symbol: `WG-${String(index + 1).padStart(3, '0')}`,
	latency: `${3 + (index % 5)}ms`,
	region: ['iad', 'bom', 'fra', 'sin'][index % 4],
}));

const columns = [
	{ field: 'symbol', header: 'Symbol', width: 130 },
	{ field: 'region', header: 'Region', width: 120 },
	{ field: 'latency', header: 'Latency', width: 120 },
];

export default function PersistenceExample() {
	return <Grid rows={rows} columns={columns} getRowId={(row) => row.id} persistence='wit-grid-docs-persistence' showStatusBar />;
}
