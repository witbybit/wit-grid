/**
 * Low-frequency React cells (ticker avatar, rating stars, status badge) and the custom group
 * renderer. Everything that updates at feed speed is a DOM renderer instead (domRenderers.ts).
 */
import React, { memo, useRef } from 'react';
import { GroupCount, GroupToggle, type CellRendererProps, type GroupRenderContext } from '@eregister/wit-grid-react';
import type { MarketRow } from './data';
import { fmtPct, fmtSignedUsd } from './format';

const AVATAR_PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];

function avatarColorFor(symbol: string): string {
	let hash = 0;
	for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
	return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function TickerAvatarInner({ value }: CellRendererProps<MarketRow>) {
	const symbol = String(value ?? '');
	return (
		<div className='md-avatar'>
			<span className='md-avatar-dot' style={{ background: avatarColorFor(symbol) }}>
				{symbol.slice(0, 2)}
			</span>
			<span className='md-avatar-sym'>{symbol}</span>
		</div>
	);
}
export const TickerAvatarCell = memo(TickerAvatarInner);

function RatingStarsInner({ value }: CellRendererProps<MarketRow>) {
	const rating = Number(value) || 0;
	return (
		<span className='md-stars' title={`${rating} / 5`}>
			{[1, 2, 3, 4, 5].map((n) => (
				<span key={n} className={n <= rating ? 'md-star-on' : 'md-star-off'}>
					★
				</span>
			))}
		</span>
	);
}
export const RatingStarsCell = memo(RatingStarsInner);

function StatusBadgeInner({ value }: CellRendererProps<MarketRow>) {
	const status = String(value ?? 'active');
	return (
		<div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
			<span className='md-badge' data-status={status}>
				<i />
				{status}
			</span>
		</div>
	);
}
export const StatusBadgeCell = memo(StatusBadgeInner);

// ─── Group renderer ───────────────────────────────────────────────────────────

/** Largest |P&L| seen per level, so the mini bar has a scale that follows the live numbers. */
const levelScale: number[] = [1, 1, 1, 1];

function useShare(level: number, pnl: number): number {
	const abs = Math.abs(pnl);
	if (abs > levelScale[level]) levelScale[level] = abs;
	return Math.max(0.04, abs / levelScale[level]);
}

const stop = (fn: () => void) => (e: React.MouseEvent) => {
	e.stopPropagation();
	fn();
};

function GroupBody({ ctx, actions }: { ctx: GroupRenderContext<MarketRow>; actions: boolean }) {
	const pnl = Number(ctx.aggregates?.unrealizedPnl) || 0;
	const pct = Number(ctx.aggregates?.changePct);
	const share = useShare(Math.min(ctx.level, 3), pnl);
	const dir = pnl > 0 ? 'up' : pnl < 0 ? 'down' : '';
	// The bar tweens while this cell keeps showing the same group; one reused for another group snaps.
	const shownId = useRef(ctx.id);
	const tween = shownId.current === ctx.id;
	shownId.current = ctx.id;

	// The hierarchy column also holds the instrument rows: nothing to show there.
	if (ctx.kind === 'data') return null;

	if (ctx.isTotal) {
		return (
			<div className='md-grp md-grp-total' style={{ paddingLeft: ctx.indentPx + 10 }}>
				<span className='md-grp-label'>{ctx.label}</span>
				<span className='md-grp-pnl' data-dir={dir}>
					{fmtSignedUsd(pnl)}
				</span>
			</div>
		);
	}

	const stuck = ctx.isStuck;
	return (
		<div className={`md-grp${stuck ? ' md-grp-stuck' : ''}`} style={{ paddingLeft: ctx.indentPx + 8 }}>
			<GroupToggle ctx={ctx} />
			<span className='md-grp-label'>{ctx.label}</span>
			{!stuck && (
				<span className='md-grp-count'>
					<GroupCount ctx={ctx} />
				</span>
			)}
			{!stuck && (
				<span className='md-grp-bar' title='Share of the largest group P&L at this level'>
					<i
						data-dir={dir || 'up'}
						className={tween ? 'md-tween' : undefined}
						style={{ transform: `scaleX(${dir === 'down' ? -share : share})` }}
					/>
				</span>
			)}
			<span className='md-grp-pnl' data-dir={dir}>
				{fmtSignedUsd(pnl)}
			</span>
			{!stuck && Number.isFinite(pct) && <span className='md-grp-count md-grp-pct'>{fmtPct(pct)}</span>}
			{actions && !stuck && (
				<span className='md-grp-actions'>
					<button type='button' className='md-grp-btn' onClick={stop(ctx.expandAll)}>
						Expand
					</button>
					<button type='button' className='md-grp-btn' onClick={stop(ctx.collapseAll)}>
						Collapse
					</button>
				</span>
			)}
		</div>
	);
}

/** Group cell inside the hierarchy column (display: 'column'): label, count, P&L and its share. */
export function GroupCellRenderer(ctx: GroupRenderContext<MarketRow>) {
	return <GroupBody ctx={ctx} actions={false} />;
}

/** Full-width group row (display: 'row') with expand / collapse actions. */
export function GroupRowRenderer(ctx: GroupRenderContext<MarketRow>) {
	return <GroupBody ctx={ctx} actions />;
}
