import React, { useCallback, useRef, useState } from 'react';
import { Grid, GridEventName, type GridApi, type GridReadyEvent } from '@eregister/wit-grid-react';

interface Product {
	id: string;
	name: string;
	category: string;
	price: number;
	stock: number;
	revenue: number;
}

const ROWS: Product[] = [
	{ id: '1', name: 'Mechanical Keyboard', category: 'Peripherals', price: 149.99, stock: 42, revenue: 6299.58 },
	{ id: '2', name: 'Ultrawide Monitor', category: 'Displays', price: 699.0, stock: 17, revenue: 11883.0 },
	{ id: '3', name: 'Wireless Mouse', category: 'Peripherals', price: 59.99, stock: 105, revenue: 6298.95 },
	{ id: '4', name: 'USB-C Hub', category: 'Accessories', price: 39.99, stock: 230, revenue: 9197.7 },
	{ id: '5', name: 'Webcam 4K', category: 'Video', price: 199.0, stock: 28, revenue: 5572.0 },
	{ id: '6', name: 'Headset Pro', category: 'Audio', price: 129.0, stock: 64, revenue: 8256.0 },
	{ id: '7', name: 'Standing Desk Mat', category: 'Accessories', price: 49.99, stock: 89, revenue: 4449.11 },
	{ id: '8', name: 'Cable Management Kit', category: 'Accessories', price: 19.99, stock: 312, revenue: 6236.88 },
];

const COLUMNS = [
	{ field: 'id', header: 'ID', width: 60 },
	{ field: 'name', header: 'Product Name', width: 200 },
	{ field: 'category', header: 'Category', width: 130 },
	{
		field: 'price',
		header: 'Price',
		width: 100,
		valueFormatter: ({ value }: { value: unknown }) => (value != null ? `$${Number(value).toFixed(2)}` : ''),
		onCopy: ({ value }: { value: unknown }) => String(Number(value).toFixed(2)),
	},
	{ field: 'stock', header: 'Stock', width: 90 },
	{
		field: 'revenue',
		header: 'Revenue',
		width: 120,
		valueFormatter: ({ value }: { value: unknown }) =>
			value != null ? `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
	},
];

type LogEntry = { kind: 'copy' | 'paste'; text: string; time: string };

interface Props {
	/** Hides the copy/paste event log panel, keeping just the toolbar and grid. */
	compact?: boolean;
}

export default function ClipboardDemo({ compact = false }: Props = {}) {
	const apiRef = useRef<GridApi<Product> | null>(null);
	const [log, setLog] = useState<LogEntry[]>([]);
	const [status, setStatus] = useState<string>('Select cells, then use Ctrl+C / Ctrl+V');

	const addLog = useCallback((entry: LogEntry) => {
		setLog((prev) => [entry, ...prev].slice(0, 20));
	}, []);

	const handleGridReady = useCallback(
		(e: GridReadyEvent<Product>) => {
			apiRef.current = e.api;

			e.api.addEventListener(GridEventName.cellsCopied, (event) => {
				const { rowCount, colCount, text } = event.payload;
				addLog({
					kind: 'copy',
					text: `${rowCount}×${colCount} cells — "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
					time: new Date().toLocaleTimeString(),
				});
				setStatus(`Copied ${rowCount}×${colCount} cells to clipboard`);
			});

			e.api.addEventListener(GridEventName.cellsPasted, (event) => {
				const { rowCount, colCount } = event.payload;
				addLog({
					kind: 'paste',
					text: `Pasted ${rowCount}×${colCount} cells`,
					time: new Date().toLocaleTimeString(),
				});
				setStatus(`Pasted ${rowCount}×${colCount} cells`);
			});
		},
		[addLog]
	);

	const handleCopyAll = useCallback(() => {
		if (!apiRef.current) return;
		const rowCount = ROWS.length;
		const colCount = COLUMNS.length - 1; // skip ID
		void apiRef.current.copyRange(0, rowCount - 1, 1, colCount);
	}, []);

	const handleCopySelected = useCallback(() => {
		void apiRef.current?.copySelectedRange();
	}, []);

	const handlePaste = useCallback(() => {
		void apiRef.current?.pasteFromClipboard();
	}, []);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12, padding: 16 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
				<span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginRight: 4 }}>Clipboard</span>
				<button
					onClick={handleCopySelected}
					style={{
						padding: '5px 12px',
						borderRadius: 6,
						border: '1px solid rgba(148, 163, 184, 0.3)',
						background: 'rgba(30, 41, 59, 0.6)',
						color: '#e2e8f0',
						cursor: 'pointer',
						fontSize: 12,
					}}
				>
					Copy Selected (Ctrl+C)
				</button>
				<button
					onClick={handleCopyAll}
					style={{
						padding: '5px 12px',
						borderRadius: 6,
						border: '1px solid rgba(148, 163, 184, 0.3)',
						background: 'rgba(30, 41, 59, 0.6)',
						color: '#e2e8f0',
						cursor: 'pointer',
						fontSize: 12,
					}}
				>
					Copy All (name→revenue)
				</button>
				<button
					onClick={handlePaste}
					style={{
						padding: '5px 12px',
						borderRadius: 6,
						border: '1px solid rgba(148, 163, 184, 0.3)',
						background: 'rgba(30, 41, 59, 0.6)',
						color: '#e2e8f0',
						cursor: 'pointer',
						fontSize: 12,
					}}
				>
					Paste (Ctrl+V)
				</button>
				<span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>{status}</span>
			</div>

			<div style={{ flex: 1, minHeight: 0 }}>
				<Grid<Product> rowModelType='client' columns={COLUMNS} rows={ROWS} getRowId={(row) => row.id} onGridReady={handleGridReady} />
			</div>

			{!compact && log.length > 0 && (
				<div
					style={{
						height: 120,
						overflowY: 'auto',
						borderRadius: 6,
						border: '1px solid rgba(148, 163, 184, 0.2)',
						background: 'rgba(15, 23, 42, 0.6)',
						fontSize: 11,
						fontFamily: 'monospace',
						padding: '6px 10px',
						flexShrink: 0,
					}}
				>
					{log.map((entry, i) => (
						<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
							<span style={{ color: '#64748b', minWidth: 60 }}>{entry.time}</span>
							<span
								style={{
									color: entry.kind === 'copy' ? '#38bdf8' : '#34d399',
									minWidth: 40,
									fontWeight: 600,
								}}
							>
								{entry.kind === 'copy' ? '↑ COPY' : '↓ PASTE'}
							</span>
							<span style={{ color: '#cbd5e1' }}>{entry.text}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
