/** Deterministic instrument universe for the markets desk. */

export type AssetClass = 'Equities' | 'ETFs' | 'FX' | 'Crypto' | 'Futures' | 'Rates';
export type Region = 'Americas' | 'EMEA' | 'APAC';
export type InstrumentStatus = 'active' | 'halted' | 'auction';

export interface MarketRow {
	id: string;
	symbol: string;
	name: string;
	assetClass: AssetClass;
	sector: string;
	region: Region;
	exchange: string;
	desk: string;
	trader: string;
	currency: string;
	price: number;
	prevClose: number;
	open: number;
	bid: number;
	ask: number;
	spread: number;
	change: number;
	changePct: number;
	dayHigh: number;
	dayLow: number;
	vwap: number;
	volume: number;
	/** Typical full-day volume, the scale for the relative-volume bar. */
	avgVolume: number;
	position: number;
	avgCost: number;
	notional: number;
	unrealizedPnl: number;
	realizedPnl: number;
	/** Annualised volatility, percent. */
	volatility: number;
	beta: number;
	rating: number;
	status: InstrumentStatus;
	/** The last 40 prices, oldest first. */
	history: number[];
	lastTickAt: number;
	/** Display decimals for prices. */
	dp: number;
	/** Half-spread as a fraction of price. */
	spreadFrac: number;
}

export const HISTORY_LENGTH = 40;
export const ASSET_CLASSES: AssetClass[] = ['Equities', 'ETFs', 'FX', 'Crypto', 'Futures', 'Rates'];
export const DESKS = ['Flow', 'Prop', 'Macro', 'Systematic', 'Market Making', 'Treasury'];
const TRADERS = [
	'A. Rivera',
	'B. Okafor',
	'C. Lindqvist',
	'D. Tanaka',
	'E. Haddad',
	'F. Moreau',
	'G. Novak',
	'H. Patel',
	'I. Kowalski',
	'J. Chen',
	'K. Mbeki',
	'L. Duarte',
	'M. Fischer',
	'N. Rossi',
	'O. Sato',
	'P. Alvarez',
	'Q. Brennan',
	'R. Iyer',
	'S. Holm',
	'T. Nakamura',
];
const EXCHANGES: Record<Region, string[]> = {
	Americas: ['NYSE', 'NASDAQ', 'CME', 'CBOE'],
	EMEA: ['LSE', 'XETRA', 'EURONEXT', 'ICE EU'],
	APAC: ['TSE', 'HKEX', 'SGX', 'ASX'],
};
const REGION_CCY: Record<Region, string[]> = { Americas: ['USD', 'CAD', 'BRL'], EMEA: ['EUR', 'GBP', 'CHF'], APAC: ['JPY', 'HKD', 'AUD'] };
const REGIONS: Region[] = ['Americas', 'EMEA', 'APAC'];

interface ClassConfig {
	weight: number;
	sectors: string[];
	minPrice: number;
	maxPrice: number;
	spreadBps: number;
	vol: [number, number];
	avgVolume: [number, number];
	/** Typical position size in USD, as a power-of-ten range. */
	posExp: [number, number];
}

// Sector names are unique across asset classes so a sector filter is unambiguous.
const CLASSES: Record<AssetClass, ClassConfig> = {
	Equities: {
		weight: 0.55,
		sectors: ['Technology', 'Financials', 'Healthcare', 'Energy', 'Consumer', 'Industrials', 'Utilities', 'Materials'],
		minPrice: 6,
		maxPrice: 900,
		spreadBps: 2,
		vol: [18, 70],
		avgVolume: [3e5, 2e7],
		posExp: [4.3, 6.8],
	},
	ETFs: {
		weight: 0.12,
		sectors: ['Broad Market', 'Sector ETF', 'Fixed Income ETF', 'Commodity ETF'],
		minPrice: 18,
		maxPrice: 520,
		spreadBps: 1.5,
		vol: [10, 34],
		avgVolume: [1e6, 6e7],
		posExp: [4.8, 7],
	},
	FX: {
		weight: 0.1,
		sectors: ['G10', 'Emerging', 'Crosses'],
		minPrice: 0.6,
		maxPrice: 1.7,
		spreadBps: 0.6,
		vol: [5, 14],
		avgVolume: [5e7, 4e9],
		posExp: [5.5, 7.4],
	},
	Crypto: {
		weight: 0.08,
		sectors: ['Layer 1', 'DeFi', 'Payments'],
		minPrice: 0.05,
		maxPrice: 62000,
		spreadBps: 6,
		vol: [50, 120],
		avgVolume: [2e5, 3e8],
		posExp: [3.8, 6.4],
	},
	Futures: {
		weight: 0.1,
		sectors: ['Index Futures', 'Energy Futures', 'Metals', 'Agriculture'],
		minPrice: 40,
		maxPrice: 6200,
		spreadBps: 1.2,
		vol: [14, 46],
		avgVolume: [2e4, 1.5e6],
		posExp: [5, 7.2],
	},
	Rates: {
		weight: 0.05,
		sectors: ['Government', 'Corporate Credit', 'Swaps'],
		minPrice: 88,
		maxPrice: 112,
		spreadBps: 0.4,
		vol: [3, 9],
		avgVolume: [1e6, 5e7],
		posExp: [5.5, 7.6],
	},
};

const NAME_A = [
	'Apex',
	'Nova',
	'Quantum',
	'Helix',
	'Vertex',
	'Orion',
	'Atlas',
	'Zenith',
	'Cobalt',
	'Summit',
	'Argent',
	'Lumen',
	'Meridian',
	'Pinnacle',
	'Sable',
	'Tidal',
];
const NAME_B = [
	'Systems',
	'Holdings',
	'Dynamics',
	'Capital',
	'Industries',
	'Labs',
	'Networks',
	'Partners',
	'Materials',
	'Energy',
	'Logistics',
	'Therapeutics',
];
const NAME_C = ['Inc.', 'Corp.', 'plc', 'AG', 'Ltd.', 'SA', 'NV'];
const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NOK', 'SEK', 'NZD'];
const MONTH_CODES = 'FGHJKMNQUVXZ';
const FX_TENORS = ['SPT', '1W', '1M', '3M', '6M', '1Y'];
const CRYPTO_NAMES = ['Coin', 'Chain', 'Swap', 'Pay', 'Net', 'Token'];

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Roughly standard normal from three uniforms: cheap and good enough for a demo feed. */
export const gauss = (rand: () => number): number => (rand() + rand() + rand() - 1.5) * 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const logLerp = (a: number, b: number, t: number) => a * Math.exp(Math.log(b / a) * t);

/** A bijective scramble of the index into letters, so symbols look arbitrary yet never collide. */
function letters(index: number, count: number): string {
	let code = (Math.imul(index + 7, 100003) >>> 0) % 456976;
	let out = '';
	for (let i = 0; i < count; i++) {
		out += String.fromCharCode(65 + (code % 26));
		code = Math.floor(code / 26);
	}
	return out;
}

function pickClass(r: number): AssetClass {
	let acc = 0;
	for (const cls of ASSET_CLASSES) {
		acc += CLASSES[cls].weight;
		if (r < acc) return cls;
	}
	return 'Equities';
}

export function priceDecimals(assetClass: AssetClass, price: number): number {
	if (assetClass === 'FX') return price > 20 ? 2 : 4;
	if (assetClass === 'Rates') return 3;
	if (assetClass === 'Crypto') return price < 1 ? 4 : price < 100 ? 3 : 2;
	return 2;
}

export function generateMarket(count: number, seed = 2026): MarketRow[] {
	const rand = mulberry32(seed);
	const now = Date.now();
	const rows = new Array<MarketRow>(count);
	for (let i = 0; i < count; i++) {
		const assetClass = pickClass(rand());
		const cfg = CLASSES[assetClass];
		const sector = cfg.sectors[Math.floor(rand() * cfg.sectors.length)];
		const region = REGIONS[Math.floor(rand() * 3)];
		const exchange = EXCHANGES[region][Math.floor(rand() * 4)];
		const ccys = REGION_CCY[region];
		const currency = assetClass === 'Crypto' || assetClass === 'Futures' ? 'USD' : ccys[Math.floor(rand() * ccys.length)];

		let price = logLerp(cfg.minPrice, cfg.maxPrice, rand());
		let symbol: string;
		let name: string;
		if (assetClass === 'FX') {
			const a = CCYS[Math.floor(rand() * CCYS.length)];
			let b = CCYS[Math.floor(rand() * CCYS.length)];
			if (b === a) b = a === 'USD' ? 'EUR' : 'USD';
			const tenor = FX_TENORS[Math.floor(rand() * FX_TENORS.length)];
			symbol = `${a}${b}${tenor === 'SPT' ? '' : `.${tenor}`}`;
			name = `${a}/${b} ${tenor === 'SPT' ? 'spot' : `forward ${tenor}`}`;
			if (a === 'JPY' || b === 'JPY') price = lerp(95, 165, rand());
		} else if (assetClass === 'Crypto') {
			symbol = `${letters(i, 3)}-USD`;
			name = `${NAME_A[Math.floor(rand() * NAME_A.length)]} ${CRYPTO_NAMES[Math.floor(rand() * CRYPTO_NAMES.length)]}`;
		} else if (assetClass === 'Futures') {
			symbol = `${letters(i, 2)}${MONTH_CODES[Math.floor(rand() * 12)]}${6 + Math.floor(rand() * 2)}`;
			name = `${sector.replace(' Futures', '')} ${NAME_A[Math.floor(rand() * NAME_A.length)]} future`;
		} else if (assetClass === 'Rates') {
			const tenor = [2, 3, 5, 7, 10, 20, 30][Math.floor(rand() * 7)];
			symbol = `${letters(i, 2)}${tenor}Y`;
			name = `${sector} ${tenor}Y ${NAME_A[Math.floor(rand() * NAME_A.length)]}`;
		} else if (assetClass === 'ETFs') {
			symbol = letters(i, 3);
			name = `${NAME_A[Math.floor(rand() * NAME_A.length)]} ${sector.replace(' ETF', '')} ETF`;
		} else {
			symbol = letters(i, 4);
			name = `${NAME_A[Math.floor(rand() * NAME_A.length)]} ${NAME_B[Math.floor(rand() * NAME_B.length)]} ${NAME_C[Math.floor(rand() * NAME_C.length)]}`;
		}

		const dp = priceDecimals(assetClass, price);
		const volT = rand() * rand();
		const volatility = Math.round(lerp(cfg.vol[0], cfg.vol[1], Math.min(1, volT * 1.5)) * 10) / 10;
		const tickVol = (volatility / 40) * 0.0007;
		const move = gauss(rand) * 0.012 * (volatility / 40);
		const prevClose = price / (1 + move);
		const open = prevClose * (1 + move * 0.3 + gauss(rand) * 0.002);
		const dayHigh = Math.max(price, open) * (1 + rand() * 0.006 * (volatility / 40));
		const dayLow = Math.min(price, open) * (1 - rand() * 0.006 * (volatility / 40));
		const vwap = lerp(dayLow, dayHigh, 0.35 + rand() * 0.3);
		const spreadFrac = (cfg.spreadBps / 1e4) * (0.6 + rand() * 0.8);
		const spread = price * spreadFrac * 2;
		const avgVolume = logLerp(cfg.avgVolume[0], cfg.avgVolume[1], rand());
		const volume = avgVolume * (0.15 + rand() * 0.9);

		const history = new Array<number>(HISTORY_LENGTH);
		history[HISTORY_LENGTH - 1] = price;
		for (let k = HISTORY_LENGTH - 2; k >= 0; k--) history[k] = history[k + 1] * (1 - gauss(rand) * tickVol * 3);

		const targetNotional = Math.pow(10, lerp(cfg.posExp[0], cfg.posExp[1], rand()));
		const side = rand() < 0.62 ? 1 : -1;
		const position = side * Math.max(1, Math.round(targetNotional / price));
		const avgCost = price * (1 - move * 0.6 + gauss(rand) * 0.015);
		const roll = rand();
		const status: InstrumentStatus = roll < 0.004 ? 'halted' : roll < 0.012 ? 'auction' : 'active';

		rows[i] = {
			id: `i${i}`,
			symbol,
			name,
			assetClass,
			sector,
			region,
			exchange,
			desk: DESKS[Math.floor(rand() * DESKS.length)],
			trader: TRADERS[Math.floor(rand() * TRADERS.length)],
			currency,
			price,
			prevClose,
			open,
			bid: price - spread / 2,
			ask: price + spread / 2,
			spread,
			change: price - prevClose,
			changePct: (price / prevClose - 1) * 100,
			dayHigh,
			dayLow,
			vwap,
			volume,
			avgVolume,
			position,
			avgCost,
			notional: Math.abs(position) * price,
			unrealizedPnl: position * (price - avgCost),
			realizedPnl: (rand() - 0.42) * targetNotional * 0.04,
			volatility,
			beta: Math.round((assetClass === 'Crypto' ? 1.2 + rand() * 1.6 : 0.3 + rand() * 1.4) * 100) / 100,
			rating: 1 + Math.min(4, Math.floor(rand() * rand() * 5 + rand() * 1.4)),
			status,
			history,
			lastTickAt: now - Math.floor(rand() * 4000),
			dp,
			spreadFrac,
		};
	}
	return rows;
}
