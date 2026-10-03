import type { AggregationDef, ColumnDef } from '@eregister/wit-grid-react';
import type { MarketRow } from './data';
import {
	changeHeatRenderer,
	coloredAggregate,
	dayRangeRenderer,
	pnlRenderer,
	priceRenderer,
	quoteRenderer,
	sparklineRenderer,
	volatilityRenderer,
	volumeRenderer,
} from './domRenderers';
import { fmtAgo, fmtCompact, fmtPct, fmtSignedUsd, fmtUsd } from './format';
import { RatingStarsCell, StatusBadgeCell, TickerAvatarCell } from './reactCells';

const num = (v: unknown) => Number(v);

/**
 * The desk's columns. Header groups: Instrument / Market / Position / Risk / Activity.
 * Pinned left: ticker and name (name only in the full desk); pinned right: unrealised P&L.
 */
export function createColumns(compact: boolean): ColumnDef<MarketRow>[] {
	return [
		{
			field: 'symbol',
			header: 'Ticker',
			width: 128,
			pinned: 'left',
			headerGroup: 'Instrument',
			renderer: { kind: 'react', component: TickerAvatarCell },
		},
		{ field: 'name', header: 'Name', width: 170, pinned: compact ? undefined : 'left', headerGroup: 'Instrument' },
		{ field: 'assetClass', header: 'Class', width: 92, headerGroup: 'Instrument' },
		{ field: 'sector', header: 'Sector', width: 130, headerGroup: 'Instrument' },
		{ field: 'region', header: 'Region', width: 90, headerGroup: 'Instrument' },
		{ field: 'exchange', header: 'Exchange', width: 92, headerGroup: 'Instrument' },

		{ field: 'price', header: 'Price', width: 108, headerGroup: 'Market', renderer: { kind: 'dom', renderer: priceRenderer } },
		{
			field: 'changePct',
			header: 'Change %',
			width: 138,
			headerGroup: 'Market',
			renderer: { kind: 'dom', renderer: changeHeatRenderer },
			valueFormatter: ({ value }) => (Number.isFinite(num(value)) ? fmtPct(num(value)) : ''),
			aggregateRenderer: coloredAggregate((v) => fmtPct(v)),
		},
		{
			field: 'history',
			colId: 'trend',
			header: 'Trend (40)',
			width: 112,
			headerGroup: 'Market',
			renderer: { kind: 'dom', renderer: sparklineRenderer },
		},
		{
			field: 'bid',
			colId: 'quote',
			header: 'Bid / Spread / Ask',
			width: 200,
			headerGroup: 'Market',
			renderer: { kind: 'dom', renderer: quoteRenderer },
		},
		{
			field: 'price',
			colId: 'range',
			header: 'Day range (VWAP|)',
			width: 210,
			headerGroup: 'Market',
			renderer: { kind: 'dom', renderer: dayRangeRenderer },
		},
		{
			field: 'volume',
			header: 'Volume',
			width: 140,
			headerGroup: 'Market',
			renderer: { kind: 'dom', renderer: volumeRenderer },
			valueFormatter: ({ value }) => fmtCompact(num(value)),
		},

		{
			field: 'position',
			header: 'Position',
			width: 104,
			headerGroup: 'Position',
			type: 'number',
			valueFormatter: ({ value }) => fmtCompact(num(value)),
		},
		{ field: 'notional', header: 'Notional', width: 108, headerGroup: 'Position', valueFormatter: ({ value }) => fmtUsd(num(value)) },
		{
			field: 'realizedPnl',
			header: 'Realized P&L',
			width: 116,
			headerGroup: 'Position',
			valueFormatter: ({ value }) => fmtSignedUsd(num(value)),
		},

		{
			field: 'volatility',
			header: 'Volatility',
			width: 126,
			headerGroup: 'Risk',
			renderer: { kind: 'dom', renderer: volatilityRenderer },
			valueFormatter: ({ value }) => `${num(value).toFixed(0)}%`,
		},
		{ field: 'beta', header: 'Beta', width: 70, headerGroup: 'Risk', valueFormatter: ({ value }) => num(value).toFixed(2) },
		{ field: 'rating', header: 'Rating', width: 100, headerGroup: 'Risk', renderer: { kind: 'react', component: RatingStarsCell } },
		{ field: 'status', header: 'Status', width: 104, headerGroup: 'Risk', renderer: { kind: 'react', component: StatusBadgeCell } },

		{ field: 'desk', header: 'Desk', width: 120, headerGroup: 'Activity' },
		{ field: 'trader', header: 'Trader', width: 116, headerGroup: 'Activity' },
		{ field: 'lastTickAt', header: 'Last tick', width: 84, headerGroup: 'Activity', valueFormatter: ({ value }) => fmtAgo(num(value)) },

		{
			field: 'unrealizedPnl',
			header: 'Unrealized P&L',
			width: 150,
			pinned: 'right',
			headerGroup: 'Position',
			renderer: { kind: 'dom', renderer: pnlRenderer },
			valueFormatter: ({ value }) => fmtSignedUsd(num(value)),
			aggregateRenderer: coloredAggregate((v) => fmtSignedUsd(v)),
		},
	];
}

/** Per group: count, sum notional, sum unrealised P&L, sum volume, avg change %, max volatility. */
export const AGGREGATES: AggregationDef<MarketRow>[] = [
	{ colId: 'symbol', aggFunc: 'count' },
	{ colId: 'notional', aggFunc: 'sum' },
	{ colId: 'unrealizedPnl', aggFunc: 'sum' },
	{ colId: 'volume', aggFunc: 'sum' },
	{ colId: 'changePct', aggFunc: 'avg' },
	{ colId: 'volatility', aggFunc: 'max' },
];
