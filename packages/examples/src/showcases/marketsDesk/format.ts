/** Number formatting shared by the markets desk cells, panels and group renderer. */

function group(intStr: string): string {
	return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtPrice(value: number, dp: number): string {
	const s = value.toFixed(dp);
	if (value < 1000) return s;
	const dot = s.indexOf('.');
	return dot < 0 ? group(s) : group(s.slice(0, dot)) + s.slice(dot);
}

export function fmtCompact(value: number): string {
	const a = Math.abs(value);
	const sign = value < 0 ? '-' : '';
	if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}T`;
	if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
	if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
	if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(0)}K`;
	if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
	return `${sign}${a.toFixed(0)}`;
}

export const fmtUsd = (value: number): string => (value < 0 ? `-$${fmtCompact(-value)}` : `$${fmtCompact(value)}`);

export const fmtSignedUsd = (value: number): string => (value < 0 ? `-$${fmtCompact(-value)}` : `+$${fmtCompact(value)}`);

export const fmtPct = (value: number, digits = 2): string => `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;

export function fmtAgo(timestamp: number, now = Date.now()): string {
	const s = Math.max(0, (now - timestamp) / 1000);
	if (s < 1) return 'now';
	if (s < 60) return `${Math.floor(s)}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	return `${Math.floor(s / 3600)}h`;
}

export const fmtMs = (value: number): string => (value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2));
