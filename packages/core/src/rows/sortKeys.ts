/**
 * Canonical client-side sort comparison shared by the flat sort, the tree/group sort stage
 * and the incremental relocation paths.
 *
 * Order: identical values tie; nullish sorts first; two numbers compare numerically;
 * values that both coerce to numbers compare numerically; everything else compares as strings.
 */
export function compareSortValues(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a == null) return -1;
	if (b == null) return 1;

	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}

	const aNumber = Number(a);
	const bNumber = Number(b);
	if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
		return aNumber - bNumber;
	}

	const aStr = String(a);
	const bStr = String(b);
	if (aStr < bStr) return -1;
	if (aStr > bStr) return 1;
	return 0;
}

/**
 * A sort value with its coercions precomputed once, so a comparator running O(n log n) times
 * does not re-run `Number()` / `String()` per comparison. `compareSortKeys` returns exactly
 * what `compareSortValues` returns for the underlying values.
 */
export interface SortKey {
	readonly value: unknown;
	readonly isNumber: boolean;
	/** `Number(value)`; NaN for nullish and symbol values. */
	readonly num: number;
	/** `String(value)`, computed lazily — only mixed/non-numeric pairs need it. */
	str: string | undefined;
}

export function toSortKey(value: unknown): SortKey {
	const isNumber = typeof value === 'number';
	return {
		value,
		isNumber,
		// Symbols cannot be coerced by Number(); treat them as non-numeric rather than throwing.
		num: isNumber ? (value as number) : value == null || typeof value === 'symbol' ? NaN : Number(value),
		str: undefined,
	};
}

export function compareSortKeys(a: SortKey, b: SortKey): number {
	const av = a.value;
	const bv = b.value;
	if (av === bv) return 0;
	if (av == null) return -1;
	if (bv == null) return 1;

	if (a.isNumber && b.isNumber) {
		return (av as number) - (bv as number);
	}

	if (!Number.isNaN(a.num) && !Number.isNaN(b.num)) {
		return a.num - b.num;
	}

	const aStr = (a.str ??= String(av));
	const bStr = (b.str ??= String(bv));
	if (aStr < bStr) return -1;
	if (aStr > bStr) return 1;
	return 0;
}

/** A column's sort reader: its value reader, mapped through `sortValue` when the column has one. */
export function sortReaderOf<TNode>(column: { sortValue?: (value: unknown) => unknown } | undefined, read: (node: TNode) => unknown): (node: TNode) => unknown {
	const sortValue = column?.sortValue;
	return sortValue ? (node) => sortValue(read(node)) : read;
}
