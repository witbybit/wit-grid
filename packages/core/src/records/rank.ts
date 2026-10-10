/**
 * Fractional ranks: strings that sort between any two others, so a card dropped between two
 * neighbours takes one write (its own rank) instead of renumbering the column.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/** A rank strictly between `before` and `after` (null = unbounded on that side). */
export function rankBetween(before: string | null | undefined, after: string | null | undefined): string {
	const a = before ?? '';
	let b: string | null = after ?? null;
	if (b !== null && a >= b) b = null; // out of order: rank after `before` only
	let result = '';
	for (let i = 0; ; i++) {
		// Both exhausted (only possible with a trailing-zero `after`): nothing bounds us above.
		if (i >= a.length && b !== null && i >= b.length) b = null;
		const da = i < a.length ? DIGITS.indexOf(a[i]) : 0;
		const db = b === null ? BASE : i < b.length ? DIGITS.indexOf(b[i]) : 0;
		if (da === db) {
			result += DIGITS[da];
			continue;
		}
		const mid = (da + db) >> 1;
		if (mid > da) return result + DIGITS[mid];
		// Adjacent digits: keep `before`'s and look for room after it, unbounded above.
		result += DIGITS[da];
		b = null;
	}
}

/** `count` ascending ranks between two neighbours, spread evenly (balanced, so they stay short). */
export function ranksBetween(before: string | null | undefined, after: string | null | undefined, count: number): string[] {
	const ranks: string[] = [];
	const fill = (low: string | null, high: string | null, n: number) => {
		if (n <= 0) return;
		const middle = rankBetween(low, high);
		const left = (n - 1) >> 1;
		fill(low, middle, left);
		ranks.push(middle);
		fill(middle, high, n - 1 - left);
	};
	fill(before ?? null, after ?? null, count);
	return ranks;
}
