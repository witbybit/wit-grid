/**
 * FastRenderers — showcase of the three renderer protocols:
 *
 *  1. SparklineRenderer   — DomCellRenderer (zero React overhead, direct canvas/DOM)
 *  2. LivePriceRenderer   — imperative React renderer (forwardRef + useImperativeHandle,
 *                           updates bypass React scheduler via ref.current.update())
 *  3. HeavyAnalyticsCell  — standard React renderer (memo), shown as contrast
 */
import React, { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { DomCellRenderer, ImperativeCellHandle, CellRendererProps } from '@eregister/wit-grid-react';

export interface DashboardStockRow {
	id: string;
	symbol: string;
	name: string;
	price: string;
	change: string;
	volume: string;
	risk: 'low' | 'medium' | 'high';
}

// ─── 1. Sparkline DOM Renderer ────────────────────────────────────────────────

// Shared per-row price history — survives slot recycling
const priceHistory = new Map<string, number[]>();

function addTick(rowId: string, price: number, maxLen = 24): void {
	let hist = priceHistory.get(rowId);
	if (!hist) {
		hist = [];
		priceHistory.set(rowId, hist);
	}
	hist.push(price);
	if (hist.length > maxLen) hist.shift();
}

function drawSparkline(ctx: CanvasRenderingContext2D, hist: number[], w: number, h: number): void {
	ctx.clearRect(0, 0, w, h);
	if (hist.length < 2) return;

	const min = Math.min(...hist);
	const max = Math.max(...hist);
	const range = max - min || 1;
	const isUp = hist[hist.length - 1] >= hist[0];
	const color = isUp ? '#10b981' : '#ef4444';

	ctx.beginPath();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	ctx.lineJoin = 'round';

	hist.forEach((p, i) => {
		const x = (i / (hist.length - 1)) * w;
		const y = h - ((p - min) / range) * h * 0.8 - h * 0.1;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	});
	ctx.stroke();

	// Dot at end
	const lastX = w;
	const lastY = h - ((hist[hist.length - 1] - min) / range) * h * 0.8 - h * 0.1;
	ctx.beginPath();
	ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

/**
 * Zero-React-overhead sparkline + price cell.
 * Grid calls mount() once per slot, update() on every tick — no React, no scheduler.
 * Per-row price history is persisted across slot recycling via the shared priceHistory map.
 */
export const SparklineRenderer: DomCellRenderer<DashboardStockRow> = {
	mount(container, params) {
		container.style.cssText =
			'display:flex;flex-direction:column;align-items:flex-start;justify-content:center;' +
			'padding:0 6px;gap:1px;width:100%;height:100%;box-sizing:border-box;';

		const valueEl = document.createElement('span');
		valueEl.style.cssText =
			'font-family:ui-monospace,monospace;font-weight:700;font-size:11px;' + 'color:#e2e8f0;line-height:1;white-space:nowrap;';

		const canvas = document.createElement('canvas');
		const DPR = window.devicePixelRatio || 1;
		const W = 96,
			H = 16;
		canvas.width = W * DPR;
		canvas.height = H * DPR;
		canvas.style.cssText = `display:block;width:${W}px;height:${H}px;`;

		container.appendChild(valueEl);
		container.appendChild(canvas);

		const ctx = canvas.getContext('2d')!;
		ctx.scale(DPR, DPR);

		let currentRowId = params.node.id;

		function render(rowId: string, value: unknown) {
			const price = parseFloat(String(value));
			if (!isNaN(price)) addTick(rowId, price);
			valueEl.textContent = `$${typeof value === 'string' ? value : String(value)}`;
			const hist = priceHistory.get(rowId) ?? [];
			drawSparkline(ctx, hist, W, H);
		}

		render(currentRowId, params.value);

		return {
			update(p) {
				currentRowId = p.node.id;
				render(currentRowId, p.value);
			},
			destroy() {
				container.innerHTML = '';
			},
		};
	},
};

// ─── 2. Live Price Renderer (imperative React) ────────────────────────────────

/**
 * Imperative React renderer for real-time price changes.
 * Grid calls ref.current.update() directly — bypasses React's scheduler entirely.
 * Updates are pure DOM mutations (span.textContent + span.style.color) — zero vDOM diff.
 *
 * To use: set cellRendererCapabilities.imperativeUpdate = true on the column.
 */
export const LivePriceRenderer = forwardRef<ImperativeCellHandle<DashboardStockRow>, CellRendererProps<DashboardStockRow>>(function LivePriceRenderer(
	{ value },
	ref
) {
	const spanRef = useRef<HTMLSpanElement>(null);
	const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevValueRef = useRef(value);

	useImperativeHandle(
		ref,
		() => ({
			update(params) {
				const span = spanRef.current;
				if (!span) return;
				const prev = parseFloat(String(prevValueRef.current));
				const next = parseFloat(String(params.value));
				prevValueRef.current = params.value;
				const raw = params.value;
				span.textContent = `${typeof raw === 'string' ? raw : String(raw)}%`;
				if (next !== prev) {
					const flashColor = next > prev ? '#10b981' : '#ef4444';
					span.style.color = flashColor;
					span.style.fontWeight = '800';
					if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
					flashTimerRef.current = setTimeout(() => {
						if (spanRef.current) {
							spanRef.current.style.color = next > prev ? '#34d399' : '#f87171';
							spanRef.current.style.fontWeight = '700';
						}
					}, 350);
				}
			},
		}),
		[]
	);

	useEffect(
		() => () => {
			if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
		},
		[]
	);

	const raw = value;
	const numVal = parseFloat(String(raw));
	const initialColor = numVal >= 0 ? '#34d399' : '#f87171';

	return (
		<span
			ref={spanRef}
			style={{
				fontFamily: 'ui-monospace,monospace',
				fontWeight: 700,
				fontSize: '12px',
				color: initialColor,
				transition: 'color 0.35s ease',
				display: 'inline-block',
			}}
		>
			{typeof raw === 'string' ? raw : String(raw)}%
		</span>
	);
});
LivePriceRenderer.displayName = 'LivePriceRenderer';

// ─── 3. Heavy Analytics Renderer (standard React, memo) ──────────────────────

/**
 * A deliberately expensive React renderer — simulates a component with complex derived state.
 * Uses React.memo so it only re-renders when props change, but it still goes through the
 * full React scheduler → reconciler → render pipeline on each update.
 *
 * Compare against LivePriceRenderer (imperative) and SparklineRenderer (DOM) to see the
 * scheduler overhead difference when many cells update simultaneously.
 */
function HeavyAnalyticsCellInner({ value, row }: CellRendererProps<DashboardStockRow>) {
	const stockRow = row as DashboardStockRow;
	const volume = parseFloat(String(value));
	const changeVal = parseFloat(stockRow.change || '0');
	const price = parseFloat(stockRow.price || '0');

	// Derived risk score — simulated multi-step calculation
	const riskScore = useMemo(() => {
		const volatility = Math.abs(changeVal) / (price || 1);
		const liquidityFactor = volume > 50 ? 0.8 : volume > 20 ? 1.0 : 1.3;
		const raw = volatility * liquidityFactor * 100;
		return Math.min(Math.max(raw, 0), 10).toFixed(2);
	}, [price, changeVal, volume]);

	const riskColor = parseFloat(riskScore) > 4 ? '#ef4444' : parseFloat(riskScore) > 2 ? '#f59e0b' : '#10b981';

	return (
		<div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 4px', lineHeight: 1.2 }}>
			<span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: '11px', color: '#e2e8f0' }}>{volume.toFixed(1)}M</span>
			<span style={{ fontSize: '9px', color: riskColor, fontWeight: 600 }}>risk {riskScore}</span>
		</div>
	);
}

export const HeavyAnalyticsCell = memo(HeavyAnalyticsCellInner);
HeavyAnalyticsCell.displayName = 'HeavyAnalyticsCell';
