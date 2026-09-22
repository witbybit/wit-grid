import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterPageParams, FilterPageResult, FilterSelectOption } from '@eregister/wit-grid-core';

export interface UseFilterPageOptions<TValue> {
	fetchPage: (params: FilterPageParams, signal: AbortSignal) => Promise<FilterPageResult<TValue>>;
	selectedValues: unknown[];
	fetchParams?: Record<string, unknown>;
	debounceMs?: number;
	minQueryLength?: number;
	pageSize?: number;
}

export interface UseFilterPageResult<TValue> {
	options: FilterSelectOption<TValue>[];
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	hasMore: boolean;
	totalCount: number | undefined;
	query: string;
	setQuery: (q: string) => void;
	loadMore: () => void;
}

export function useFilterPage<TValue = unknown>({
	fetchPage,
	selectedValues,
	fetchParams = {},
	debounceMs = 250,
	minQueryLength = 0,
	pageSize = 50,
}: UseFilterPageOptions<TValue>): UseFilterPageResult<TValue> {
	const [query, setQueryState] = useState('');
	const [options, setOptions] = useState<FilterSelectOption<TValue>[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
	const pageRef = useRef(0);
	const queryRef = useRef('');

	const abortRef = useRef<AbortController | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fetchRef = useRef(fetchPage);
	fetchRef.current = fetchPage;

	const fetchFirstPage = useCallback(
		(q: string) => {
			if (q.length < minQueryLength) {
				setOptions([]);
				setHasMore(false);
				setLoading(false);
				return;
			}
			if (abortRef.current) abortRef.current.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			pageRef.current = 0;
			queryRef.current = q;
			setLoading(true);
			setError(null);
			fetchRef
				.current({ query: q, selectedValues, params: fetchParams, page: 0, pageSize }, ctrl.signal)
				.then((res) => {
					if (ctrl.signal.aborted) return;
					setOptions(res.options);
					setHasMore(res.hasMore);
					setTotalCount(res.totalCount);
					setLoading(false);
					pageRef.current = 1;
				})
				.catch((err: unknown) => {
					if (ctrl.signal.aborted) return;
					setError(err instanceof Error ? err.message : 'Failed to load options');
					setLoading(false);
				});
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[minQueryLength, pageSize, fetchParams]
	);

	const loadMore = useCallback(() => {
		if (loadingMore || !hasMore) return;
		const ctrl = new AbortController();
		const page = pageRef.current;
		const q = queryRef.current;
		setLoadingMore(true);
		fetchRef
			.current({ query: q, selectedValues, params: fetchParams, page, pageSize }, ctrl.signal)
			.then((res) => {
				if (ctrl.signal.aborted) return;
				setOptions((prev) => [...prev, ...res.options]);
				setHasMore(res.hasMore);
				setTotalCount(res.totalCount);
				setLoadingMore(false);
				pageRef.current = page + 1;
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setError(err instanceof Error ? err.message : 'Failed to load more');
				setLoadingMore(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadingMore, hasMore, pageSize, fetchParams]);

	useEffect(() => {
		fetchFirstPage('');
		return () => {
			abortRef.current?.abort();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const setQuery = useCallback(
		(q: string) => {
			setQueryState(q);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => fetchFirstPage(q), debounceMs);
		},
		[fetchFirstPage, debounceMs]
	);

	return { options, loading, loadingMore, error, hasMore, totalCount, query, setQuery, loadMore };
}
