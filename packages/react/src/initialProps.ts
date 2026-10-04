/**
 * Initial-only props are read once, when the grid is created. React code passes them inline (a new
 * object or arrow function every render), so identity says nothing about whether they changed: two
 * values are the same when their data is, and functions inside them count as equal (an inline
 * `isMaster: (row) => …` is the same option every render).
 */
export function sameInitialValue(a: unknown, b: unknown, depth = 0): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a === 'function' && typeof b === 'function') return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	// Class instances (adapters, stores) and very deep values compare by identity.
	if (depth > 8 || !isPlainData(a) || !isPlainData(b)) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
		if (!sameInitialValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1)) return false;
	}
	return true;
}

function isPlainData(value: object): boolean {
	if (Array.isArray(value)) return true;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

declare const process: { env: { NODE_ENV?: string } } | undefined;

/** Bundlers replace `process.env.NODE_ENV`; anywhere it is missing counts as development. */
export function isProductionBuild(): boolean {
	try {
		return process!.env.NODE_ENV === 'production';
	} catch {
		return false;
	}
}
