import React, { useState } from 'react';
import { applyFilterToModel, resolveColumnFilterDef, summarizeFilter, type ThemeTokens } from '@eregister/wit-grid-core';
import type { GridApi, ColumnDef, FilterModel, ColumnFilter } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';
import { CoreFilterEditor } from '../../filters/CoreFilterEditor.js';

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const Chevron = ({ open }: { open: boolean }) => (
	<svg
		width='12'
		height='12'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease', flexShrink: 0 }}
	>
		<path d='m9 18 6-6-6-6' />
	</svg>
);

interface FiltersPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

/**
 * The sidebar's Filters panel: every filterable column with its filter editor (the grid's own,
 * from the column's `filterDef`), its current filter summarized when collapsed.
 */
export function FiltersPanel({ api, onClose }: FiltersPanelProps) {
	useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const filterModel = useGridKeySelector<FilterModel | null>('filterModel', (s) => s.filterModel);
	useGridKeySelector('themeName', (s) => s.themeName);
	const theme = api.getTheme();
	const columns = api.getDisplayedColumns().filter((col) => resolveColumnFilterDef(col) !== null);
	const activeCount = filterModel ? Object.keys(filterModel).length : 0;
	// Filtered columns start open; the rest open on demand.
	const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(filterModel ?? {}).map((f) => [f, true])));

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: theme.bgColor }}>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0 12px',
					height: 44,
					flexShrink: 0,
					background: theme.headerBg,
					borderBottom: `1px solid ${theme.borderColor}`,
					gap: 8,
				}}
			>
				<span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.textColor }}>
					Filters
				</span>
				{activeCount > 0 && (
					<button
						onClick={() => api.setFilterModel(null)}
						style={{
							fontSize: 10,
							fontWeight: 600,
							color: theme.focusRing,
							background: theme.selectionBg,
							border: `1px solid ${theme.selectionBorder}`,
							borderRadius: 4,
							padding: '2px 7px',
							cursor: 'pointer',
						}}
					>
						Clear {activeCount}
					</button>
				)}
				<button onClick={onClose} aria-label='Close filters' style={iconButton(theme.headerText)}>
					<CloseIcon />
				</button>
			</div>

			<div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 12px' }}>
				{columns.length === 0 && (
					<div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 11, color: theme.headerText }}>No columns to filter</div>
				)}
				{columns.map((col) => {
					const filter = (filterModel?.[col.field] as ColumnFilter | undefined) ?? null;
					const isOpen = !!open[col.field];
					return (
						<FilterSection
							key={col.field}
							api={api}
							column={col}
							filter={filter}
							open={isOpen}
							theme={theme}
							onToggle={() => setOpen((prev) => ({ ...prev, [col.field]: !isOpen }))}
						/>
					);
				})}
			</div>
		</div>
	);
}

function FilterSection({
	api,
	column,
	filter,
	open,
	theme,
	onToggle,
}: {
	api: GridApi<any>;
	column: ColumnDef<any>;
	filter: ColumnFilter | null;
	open: boolean;
	theme: ThemeTokens;
	onToggle: () => void;
}) {
	const apply = (next: ColumnFilter | null) => {
		const model = (api.getStateSnapshot().filterModel as FilterModel | null) ?? null;
		api.setFilterModel(applyFilterToModel(column.field, next, model));
	};
	const def = resolveColumnFilterDef(column);
	return (
		<div style={{ borderBottom: `1px solid ${theme.borderColor}` }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 12px' }}>
				<button
					onClick={onToggle}
					aria-expanded={open}
					style={{
						flex: 1,
						minWidth: 0,
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						height: 38,
						background: 'none',
						border: 'none',
						padding: 0,
						cursor: 'pointer',
						color: filter ? theme.focusRing : theme.textColor,
						textAlign: 'left',
					}}
				>
					<Chevron open={open} />
					<span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
						{column.header || column.field}
					</span>
					{filter && !open && (
						<span
							style={{
								fontSize: 11,
								color: theme.headerText,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								minWidth: 0,
							}}
						>
							{summarizeFilter(filter, def)}
						</span>
					)}
				</button>
				{filter && (
					<button
						onClick={() => apply(null)}
						aria-label={`Clear ${column.header || column.field} filter`}
						style={iconButton(theme.headerText)}
					>
						<CloseIcon />
					</button>
				)}
			</div>
			{open && (
				<div style={{ padding: '0 12px 12px' }}>
					<CoreFilterEditor api={api} column={column} surface='sidebar' filter={filter} onChange={apply} />
				</div>
			)}
		</div>
	);
}

function iconButton(color: string): React.CSSProperties {
	return {
		width: 24,
		height: 24,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 5,
		border: 'none',
		background: 'transparent',
		cursor: 'pointer',
		color,
		padding: 0,
		flexShrink: 0,
	};
}
