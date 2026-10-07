/**
 * The desk's grid. Memoised on primitive / module-constant props, so the 4 Hz panel updates and the
 * controls never re-render it; the grid is configured once (initial state) and every later change
 * (grouping depth, sector filter, theme) is applied through the api, never by remounting.
 * Only a change of group display ('column' | 'row') or row count remounts, as the grouping demo does.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type { GridApi, GridCapabilitiesConfig, GridInitialState, GridReadyEvent, RowAnimationOptions, StyleRule } from '@eregister/wit-grid-react';
import { AGGREGATES, createColumns } from './columns';
import type { MarketRow } from './data';
import type { FeedEngine } from './feed';
import { GroupCellRenderer, GroupRowRenderer } from './reactCells';

export type GroupBy = 'none' | 'class' | 'sector' | 'region';
export type GroupDisplay = 'column' | 'row';

export const GROUP_FIELDS = ['assetClass', 'sector', 'region'] as const;
const DEPTH: Record<GroupBy, number> = { none: 0, class: 1, sector: 2, region: 3 };

type GroupingConfig = NonNullable<Partial<GridInitialState<MarketRow>>['grouping']>;
type HierarchyConfig = NonNullable<Partial<GridInitialState<MarketRow>>['hierarchyColumn']>;

const GROUP_CELL = { kind: 'react', component: GroupCellRenderer } as const;
const GROUP_ROW = { kind: 'react', component: GroupRowRenderer } as const;

function buildGrouping(groupBy: GroupBy, display: GroupDisplay): GroupingConfig {
	return {
		by: GROUP_FIELDS.slice(0, DEPTH[groupBy]),
		display,
		defaultExpanded: true,
		rowHeight: 34,
		totals: { grand: 'bottom' },
		stickyHeaders: true,
		...(display === 'row' ? { rowRenderer: GROUP_ROW } : {}),
	};
}

function buildHierarchy(display: GroupDisplay, compact: boolean): HierarchyConfig {
	return {
		header: 'Group',
		width: compact ? 220 : 300,
		indentPerLevel: 16,
		show: { toggle: true, checkbox: false, count: true },
		...(display === 'row' ? {} : { renderer: GROUP_CELL }),
	};
}

const sectorFilterModel = (sector: string | null) => (sector ? { sector: { type: 'select' as const, values: [sector] } } : null);

// Stable rule objects (module scope): the grid never sees a new styleRules array.
const STYLE_RULES: StyleRule<MarketRow>[] = [
	{ kind: 'row', when: (row) => row.status === 'halted', rowClass: 'md-dim' },
	{ kind: 'cell', field: 'realizedPnl', when: (row) => row.realizedPnl > 0, cellClass: 'md-pos md-mono' },
	{ kind: 'cell', field: 'realizedPnl', when: (row) => row.realizedPnl < 0, cellClass: 'md-neg md-mono' },
	{ kind: 'cell', field: 'notional', when: () => true, cellClass: 'md-mono' },
	{ kind: 'cell', field: 'position', when: () => true, cellClass: 'md-mono' },
];

const getRowId = (row: MarketRow) => row.id;

// Market data is read-only; only the desk and trader assignments are editable.
const CAPABILITIES: GridCapabilitiesConfig<MarketRow> = { canEdit: ({ colField }) => colField === 'desk' || colField === 'trader' };

export interface DeskGridProps {
	engine: FeedEngine;
	display: GroupDisplay;
	groupBy: GroupBy;
	isLight: boolean;
	compact: boolean;
	sectorFilter: string | null;
	rowAnimation: RowAnimationOptions;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged?: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<MarketRow>) => void;
}

function DeskGridImpl({
	engine,
	display,
	groupBy,
	isLight,
	compact,
	sectorFilter,
	rowAnimation,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
}: DeskGridProps) {
	const [api, setApi] = useState<GridApi<MarketRow> | null>(null);
	const apiRef = useRef<GridApi<MarketRow> | null>(null);
	const latest = useRef({ groupBy, sectorFilter, isLight });
	latest.current = { groupBy, sectorFilter, isLight };
	const applied = useRef<{ groupBy: GroupBy; sectorFilter: string | null; display: GroupDisplay } | null>(null);

	const columns = useMemo(() => createColumns(compact), [compact]);
	// A fresh grid (first mount, display switch, new row count) starts from the engine's current rows.
	const rows = useMemo(() => engine.snapshotRows(), [engine, display]);
	const initialState = useMemo<Partial<GridInitialState<MarketRow>>>(() => {
		const { groupBy: g, sectorFilter: f, isLight: light } = latest.current;
		applied.current = { groupBy: g, sectorFilter: f, display };
		return {
			themeName: light ? 'spreadsheet' : 'dark',
			defaultRowHeight: 34,
			sortModel: [{ colId: 'changePct', sort: 'desc' }],
			grouping: buildGrouping(g, display),
			aggregation: { defs: AGGREGATES },
			hierarchyColumn: buildHierarchy(display, compact),
			...(f ? { filterModel: sectorFilterModel(f) ?? undefined } : {}),
		};
		// Initial-only: later changes go through the api in the effects below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine, display, compact]);

	const handleReady = useCallback(
		(event: GridReadyEvent<MarketRow>) => {
			apiRef.current = event.api;
			setApi(event.api);
			engine.attach(event.api);
			event.api.transaction({ pins: { bottom: latest.current.groupBy === 'none' ? 0 : 1 } });
			onGridReady?.(event);
		},
		[engine, onGridReady]
	);

	// (Re)attach the feed to the current grid on every mount — StrictMode and remounts run the
	// cleanup below, and onGridReady fires only once per grid — and detach from a grid that is going
	// away, unless a newer grid already took over.
	useEffect(() => {
		if (apiRef.current && engine.api !== apiRef.current) engine.attach(apiRef.current);
		return () => {
			if (engine.api && engine.api === apiRef.current) engine.attach(null);
		};
	}, [engine, display]);

	useEffect(() => {
		if (!api) return;
		api.switchTheme(isLight ? 'spreadsheet' : 'dark');
	}, [api, isLight]);

	useEffect(() => {
		if (!api || !applied.current || applied.current.display !== display) return;
		// A regroup or filter rebuilds every row: let the pressed control paint first (a frame, then a task),
		// so the click answers at once. A newer choice cancels a pending one.
		let cancelled = false;
		const frame = requestAnimationFrame(() =>
			setTimeout(() => {
				if (cancelled || !applied.current) return;
				if (applied.current.groupBy !== groupBy) {
					api.setGrouping(buildGrouping(groupBy, display));
					api.transaction({ pins: { bottom: groupBy === 'none' ? 0 : 1 } });
					applied.current.groupBy = groupBy;
				}
				if (applied.current.sectorFilter !== sectorFilter) {
					api.setFilterModel(sectorFilterModel(sectorFilter));
					applied.current.sectorFilter = sectorFilter;
				}
			}, 0)
		);
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	}, [api, display, groupBy, sectorFilter]);

	return (
		<Grid<MarketRow>
			// A new universe mounts a fresh grid (cheaper than diffing every row of the old one through setRows);
			// the dashboard keeps the old grid on screen until the new universe is built.
			key={`${engine.count}-${display}-${compact}`}
			rowModelType='client'
			rows={rows}
			columns={columns}
			getRowId={getRowId}
			styleRules={STYLE_RULES}
			capabilities={CAPABILITIES}
			rowAnimation={rowAnimation}
			pinBottomRows={groupBy === 'none' ? 0 : 1}
			showStatusBar={!compact}
			enableNavigation
			navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
			onCellValueChanged={onCellValueChanged}
			initialState={initialState}
			onGridReady={handleReady}
		/>
	);
}

export const DeskGrid = memo(DeskGridImpl);
