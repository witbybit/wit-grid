/**
 * Built-in select filter components.
 *
 * All components receive CustomFilterRendererParams and emit SelectFilterCondition | null.
 * They share FilterPrimitives and the useFilterFetch / useFilterPage hooks.
 */
import React, { useMemo } from 'react';
import type { ThemeTokens } from '@eregister/open-grid-core';
import type {
	ColumnFilterDef,
	CustomFilterRendererParams,
	FilterSelectOption,
	FilterSurface,
	SelectFilterCondition,
} from '@eregister/open-grid-core';
import { FilterOptionList, FilterSearchInput, FilterSelectAll, FilterStatusBar, LoadMoreButton, optionKey } from './FilterPrimitives.js';
import { useFilterFetch } from './useFilterFetch.js';
import { useFilterPage } from './useFilterPage.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function getSelectedKeys(filter: SelectFilterCondition | null): Set<string> {
	if (!filter || filter.values.length === 0) return new Set();
	return new Set(filter.values.map((v) => (v === null ? '\0null' : String(v))));
}

function getDisplayHeight(surface: FilterSurface, maxHeight?: number): number {
	if (surface === 'floating') return 160;
	return maxHeight ?? 240;
}

function buildFilter(opt: FilterSelectOption<unknown>, currentFilter: SelectFilterCondition | null, multi: boolean): SelectFilterCondition | null {
	const key = optionKey(opt);
	const rawValue = key === '\0null' ? null : (opt.value as string | number | null);
	const label = opt.label;

	if (!multi) {
		// Single select: toggle off if already selected, else set to just this one
		const alreadySelected = currentFilter?.values.length === 1 && String(currentFilter.values[0] ?? '\0null') === key;
		if (alreadySelected) return null;
		return { type: 'select', values: [rawValue as string | number | null], labels: [label] };
	}

	// Multi select
	const existing = currentFilter ?? { type: 'select' as const, values: [], labels: [] };
	const existingKeys = new Set(existing.values.map((v) => (v === null ? '\0null' : String(v))));

	if (existingKeys.has(key)) {
		// Remove
		const next = existing.values.filter((v) => (v === null ? '\0null' : String(v)) !== key);
		const nextLabels = (existing.labels ?? []).filter((_, i) => (existing.values[i] === null ? '\0null' : String(existing.values[i])) !== key);
		return next.length === 0 ? null : { type: 'select', values: next, labels: nextLabels };
	} else {
		// Add
		return {
			type: 'select',
			values: [...existing.values, rawValue as string | number | null],
			labels: [...(existing.labels ?? []), label],
		};
	}
}

function buildAllFilter(options: FilterSelectOption<unknown>[]): SelectFilterCondition | null {
	if (options.length === 0) return null;
	return {
		type: 'select',
		values: options.map((o) => (optionKey(o) === '\0null' ? null : (o.value as string | number | null))),
		labels: options.map((o) => o.label),
	};
}

// ── StaticSelectFilter ────────────────────────────────────────────────────────

export function StaticSelectFilter({
	params,
	filterDef,
	theme,
	multi,
}: {
	params: CustomFilterRendererParams;
	filterDef: ColumnFilterDef;
	theme: ThemeTokens;
	multi: boolean;
}) {
	const surface = params.surface;
	const currentFilter = params.value?.type === 'select' ? (params.value as SelectFilterCondition) : null;
	const selectedKeys = useMemo(() => getSelectedKeys(currentFilter), [currentFilter]);
	const maxHeight = getDisplayHeight(surface, filterDef.maxHeight);

	// Resolve options
	const allOptions = useMemo((): FilterSelectOption<unknown>[] => {
		const rawOpts = filterDef.options;
		if (!rawOpts) return [];
		return typeof rawOpts === 'function' ? rawOpts([]) : (rawOpts as FilterSelectOption<unknown>[]);
	}, [filterDef.options]);

	// Client-side search
	const [search, setSearch] = React.useState('');
	const showSearch = filterDef.searchable ?? allOptions.length > 8;
	const filtered = useMemo(
		() => (search === '' ? allOptions : allOptions.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))),
		[allOptions, search]
	);

	const handleToggle = (opt: FilterSelectOption<unknown>) => {
		const next = buildFilter(opt, currentFilter, multi);
		params.onCommit(next);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
			{showSearch && <FilterSearchInput value={search} onChange={setSearch} placeholder={filterDef.placeholder} theme={theme} />}
			{multi && filterDef.showSelectAll !== false && (
				<FilterSelectAll
					onSelectAll={() => params.onCommit(buildAllFilter(allOptions))}
					onClearAll={() => params.onCommit(null)}
					theme={theme}
				/>
			)}
			<FilterStatusBar shownCount={filtered.length} emptyLabel={filterDef.emptyLabel} theme={theme} />
			<FilterOptionList
				options={filtered}
				selectedKeys={selectedKeys}
				onToggle={handleToggle}
				theme={theme}
				multi={multi}
				maxHeight={maxHeight}
			/>
		</div>
	);
}

// ── AsyncSelectFilter ─────────────────────────────────────────────────────────

export function AsyncSelectFilter({
	params,
	filterDef,
	theme,
	multi,
}: {
	params: CustomFilterRendererParams;
	filterDef: ColumnFilterDef;
	theme: ThemeTokens;
	multi: boolean;
}) {
	const surface = params.surface;
	const currentFilter = params.value?.type === 'select' ? (params.value as SelectFilterCondition) : null;
	const selectedKeys = useMemo(() => getSelectedKeys(currentFilter), [currentFilter]);
	const maxHeight = getDisplayHeight(surface, filterDef.maxHeight);

	const { options, loading, error, totalCount, query, setQuery } = useFilterFetch({
		fetchOptions: filterDef.fetchOptions!,
		selectedValues: currentFilter?.values ?? [],
		fetchParams: filterDef.fetchParams,
		debounceMs: filterDef.debounceMs,
		minQueryLength: filterDef.minQueryLength,
	});

	const handleToggle = (opt: FilterSelectOption<unknown>) => {
		const next = buildFilter(opt, currentFilter, multi);
		params.onCommit(next);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
			<FilterSearchInput
				value={query}
				onChange={setQuery}
				placeholder={filterDef.placeholder}
				theme={theme}
				autoFocus={surface !== 'floating'}
			/>
			{multi && filterDef.showSelectAll !== false && !loading && (
				<FilterSelectAll
					onSelectAll={() => params.onCommit(buildAllFilter(options))}
					onClearAll={() => params.onCommit(null)}
					theme={theme}
				/>
			)}
			<FilterStatusBar
				loading={loading}
				error={error}
				shownCount={loading ? undefined : options.length}
				totalCount={totalCount}
				emptyLabel={filterDef.emptyLabel}
				loadingLabel={filterDef.loadingLabel}
				theme={theme}
			/>
			{!loading && !error && (
				<FilterOptionList
					options={options}
					selectedKeys={selectedKeys}
					onToggle={handleToggle}
					theme={theme}
					multi={multi}
					maxHeight={maxHeight}
				/>
			)}
		</div>
	);
}

// ── InfiniteSelectFilter ──────────────────────────────────────────────────────

export function InfiniteSelectFilter({
	params,
	filterDef,
	theme,
}: {
	params: CustomFilterRendererParams;
	filterDef: ColumnFilterDef;
	theme: ThemeTokens;
}) {
	const surface = params.surface;
	const currentFilter = params.value?.type === 'select' ? (params.value as SelectFilterCondition) : null;
	const selectedKeys = useMemo(() => getSelectedKeys(currentFilter), [currentFilter]);
	const maxHeight = getDisplayHeight(surface, filterDef.maxHeight);

	const { options, loading, loadingMore, error, hasMore, totalCount, query, setQuery, loadMore } = useFilterPage({
		fetchPage: filterDef.fetchPage!,
		selectedValues: currentFilter?.values ?? [],
		fetchParams: filterDef.fetchParams,
		debounceMs: filterDef.debounceMs,
		minQueryLength: filterDef.minQueryLength,
		pageSize: filterDef.pageSize,
	});

	const handleToggle = (opt: FilterSelectOption<unknown>) => {
		const next = buildFilter(opt, currentFilter, true);
		params.onCommit(next);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
			<FilterSearchInput
				value={query}
				onChange={setQuery}
				placeholder={filterDef.placeholder}
				theme={theme}
				autoFocus={surface !== 'floating'}
			/>
			{filterDef.showSelectAll !== false && !loading && (
				<FilterSelectAll
					onSelectAll={() => params.onCommit(buildAllFilter(options))}
					onClearAll={() => params.onCommit(null)}
					theme={theme}
				/>
			)}
			<FilterStatusBar
				loading={loading}
				error={error}
				shownCount={loading ? undefined : options.length}
				totalCount={totalCount}
				emptyLabel={filterDef.emptyLabel}
				loadingLabel={filterDef.loadingLabel}
				theme={theme}
			/>
			{!loading && !error && (
				<FilterOptionList
					options={options}
					selectedKeys={selectedKeys}
					onToggle={handleToggle}
					theme={theme}
					multi={true}
					maxHeight={maxHeight}
					onScrolledToBottom={hasMore ? loadMore : undefined}
				/>
			)}
			{hasMore && !loading && <LoadMoreButton loading={loadingMore} onClick={loadMore} theme={theme} />}
		</div>
	);
}
