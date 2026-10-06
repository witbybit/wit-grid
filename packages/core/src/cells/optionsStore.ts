import type { CellOption } from './listbox.js';

/** What an options loader is asked for: one page of options matching a search. */
export interface CellOptionsQuery {
	/** The search typed in the editor; empty when browsing. */
	search: string;
	/** How many options the editor already has for this search: the page starts here. */
	offset: number;
	/** The page size the editor would like (the store's `pageSize`). */
	limit: number;
	/** Aborted when the search changes or the editor closes: stop work, the result is dropped. */
	signal: AbortSignal;
	/** The cell being edited, for options that depend on the row. Absent for filter lists. */
	rowId?: string;
	colField?: string;
}

/** One page of options. Leave `hasMore` unset (or false) on the last page. */
export interface CellOptionsPage {
	options: readonly CellOption[];
	hasMore?: boolean;
	/** All matches for the search, when known: the list shows “50 of 1,204”. */
	total?: number;
}

/** Loads options a page at a time. Returning a plain array means there are no more pages. */
export type CellOptionsLoader = (query: CellOptionsQuery) => Promise<CellOptionsPage | readonly CellOption[]>;

/** Looks up the options for values (labels and colours for cells showing values not loaded yet). */
export type CellOptionsResolver = (values: string[]) => Promise<readonly CellOption[]>;

export interface CellOptionsSourceConfig {
	/** Options fetched from a server page by page, searched there. */
	loadOptions?: CellOptionsLoader;
	/** Options for values the store has not seen (cells drawn before any list was opened). */
	resolveOptions?: CellOptionsResolver;
	/** Page size asked of `loadOptions`. Default 50. */
	pageSize?: number;
}

/**
 * The options of a column, shared by its renderer, editor, formatter and filter: the static ones
 * plus every option a loader or resolver has returned, so a value shows its label wherever it was
 * learnt. Lookups of unknown values are batched into one `resolveOptions` call per microtask, and
 * a value is never asked for twice.
 */
export interface CellOptionsStore {
	/** The options given up front (all of them, for a column without a loader). */
	readonly options: readonly CellOption[];
	readonly pageSize: number;
	/** Present when options come from `loadOptions`. */
	readonly fetch?: (query: CellOptionsQuery) => Promise<CellOptionsPage>;
	get(value: string): CellOption | undefined;
	/** Adds options learnt elsewhere (created values, a page loaded outside the store). */
	remember(options: readonly CellOption[]): void;
	/**
	 * Settles once the given values are known or known to be unknown; null when there is nothing
	 * to wait for (all known, or no resolver).
	 */
	ensure(values: readonly string[]): Promise<void> | null;
	/** A value is being resolved: show a placeholder rather than the raw value. */
	isPending(value: string): boolean;
}

export function isCellOptionsStore(value: unknown): value is CellOptionsStore {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as CellOptionsStore).get === 'function';
}

export function createCellOptionsStore(options: readonly CellOption[], config: CellOptionsSourceConfig = {}): CellOptionsStore {
	const index = new Map<string, CellOption>();
	for (const option of options) index.set(option.value, option);
	// Values a resolver was asked for and did not return (or failed on): never asked again.
	const unknown = new Set<string>();
	const pending = new Map<string, Promise<void>>();
	let batch: { values: Set<string>; promise: Promise<void> } | null = null;

	const remember = (learnt: readonly CellOption[]) => {
		for (const option of learnt) {
			index.set(option.value, option);
			unknown.delete(option.value);
		}
	};

	const resolver = config.resolveOptions;
	const startBatch = () => {
		let settle!: () => void;
		const promise = new Promise<void>((resolve) => (settle = resolve));
		const current = { values: new Set<string>(), promise };
		// Every lookup made in this task joins one request.
		queueMicrotask(() => {
			batch = null;
			const values = [...current.values];
			resolver!(values)
				.then(
					(found) => remember(found),
					() => undefined
				)
				.finally(() => {
					for (const value of values) {
						if (!index.has(value)) unknown.add(value);
						pending.delete(value);
					}
					settle();
				});
		});
		return current;
	};

	const loader = config.loadOptions;
	const pageSize = config.pageSize ?? 50;
	return {
		options,
		pageSize,
		fetch: loader
			? async (query) => {
					const result = await loader(query);
					const page: CellOptionsPage = Array.isArray(result) ? { options: result as readonly CellOption[] } : (result as CellOptionsPage);
					remember(page.options);
					return page;
				}
			: undefined,
		get: (value) => index.get(value),
		remember,
		isPending: (value) => pending.has(value),
		ensure(values) {
			if (!resolver) return null;
			const waits: Promise<void>[] = [];
			for (const value of values) {
				if (index.has(value) || unknown.has(value)) continue;
				const inFlight = pending.get(value);
				if (inFlight) {
					waits.push(inFlight);
					continue;
				}
				batch ??= startBatch();
				batch.values.add(value);
				pending.set(value, batch.promise);
				waits.push(batch.promise);
			}
			if (waits.length === 0) return null;
			return Promise.all(waits).then(() => undefined);
		},
	};
}
