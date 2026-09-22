import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterFetchParams, FilterFetchResult, FilterSelectOption } from '@eregister/wit-grid-core';

export interface UseFilterFetchOptions<TValue> {
	fetchOptions: (params: FilterFetchParams, signal: AbortSignal) => Promise<FilterFetchResult<TValue>>;
	selectedValues: unknown[];
	fetchParams?: Record<string, unknown>;
	debounceMs?: number;
	minQueryLength?: number;
}

export interface UseFilterFetchResult<TValue> {
	options: FilterSelectOption<TValue>[];
	loading: boolean;
	error: string | null;
	totalCount: number | undefined;
	query: string;
	setQuery: (q: string) => void;
}

export function useFilterFetch<TValue = unknown>({
	fetchOptions,
	selectedValues,
	fetchParams = {},
	debounceMs = 250,
	minQueryLength = 0,
}: UseFilterFetchOptions<TValue>): UseFilterFetchResult<TValue> {
	const [query, setQuery] = useState('');
	const [options, setOptions] = useState<FilterSelectOption<TValue>[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [totalCount, setTotalCount] = useState<number | undefined>(undefined);

	const abortRef = useRef<AbortController | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fetchRef = useRef(fetchOptions);
	fetchRef.current = fetchOptions;

	const doFetch = useCallback(
		(q: string) => {
			if (q.length < minQueryLength) {
				setOptions([]);
				setLoading(false);
				setError(null);
				return;
			}
			if (abortRef.current) abortRef.current.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			setLoading(true);
			setError(null);
			fetchRef
				.current({ query: q, selectedValues, params: fetchParams }, ctrl.signal)
				.then((res) => {
					if (ctrl.signal.aborted) return;
					setOptions(res.options);
					setTotalCount(res.totalCount);
					setLoading(false);
				})
				.catch((err: unknown) => {
					if (ctrl.signal.aborted) return;
					setError(err instanceof Error ? err.message : 'Failed to load options');
					setLoading(false);
				});
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[minQueryLength, fetchParams]
	);

	// Initial load
	useEffect(() => {
		doFetch('');
		return () => {
			abortRef.current?.abort();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Debounced query changes
	const handleQueryChange = useCallback(
		(q: string) => {
			setQuery(q);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => doFetch(q), debounceMs);
		},
		[doFetch, debounceMs]
	);

	return { options, loading, error, totalCount, query, setQuery: handleQueryChange };
}
