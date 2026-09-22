/**
 * ColumnFilterRenderer — dispatches to the right filter component based on filterDef.type.
 *
 * Accepts CustomFilterRendererParams + filterDef + theme.
 * Used by FiltersPanel, header menu bridge, and floating filter bridge.
 */
import React from 'react';
import type { ThemeTokens } from '@eregister/wit-grid-core';
import type { ColumnFilterDef, CustomFilterRendererParams } from '@eregister/wit-grid-core';
import { AsyncSelectFilter, InfiniteSelectFilter, StaticSelectFilter } from './SelectFilterComponents.js';

interface ColumnFilterRendererProps {
	params: CustomFilterRendererParams;
	filterDef: ColumnFilterDef;
	theme: ThemeTokens;
}

export function ColumnFilterRenderer({ params, filterDef, theme }: ColumnFilterRendererProps) {
	const { type } = filterDef;

	switch (type) {
		case 'multi-select':
			return <StaticSelectFilter params={params} filterDef={filterDef} theme={theme} multi={true} />;

		case 'single-select':
			return <StaticSelectFilter params={params} filterDef={filterDef} theme={theme} multi={false} />;

		case 'async-multi-select':
			if (!filterDef.fetchOptions) return <MissingConfig label='async-multi-select requires fetchOptions' theme={theme} />;
			return <AsyncSelectFilter params={params} filterDef={filterDef} theme={theme} multi={true} />;

		case 'async-single-select':
			if (!filterDef.fetchOptions) return <MissingConfig label='async-single-select requires fetchOptions' theme={theme} />;
			return <AsyncSelectFilter params={params} filterDef={filterDef} theme={theme} multi={false} />;

		case 'infinite-multi-select':
			if (!filterDef.fetchPage) return <MissingConfig label='infinite-multi-select requires fetchPage' theme={theme} />;
			return <InfiniteSelectFilter params={params} filterDef={filterDef} theme={theme} />;

		case 'custom': {
			if (!filterDef.renderFilter) return <MissingConfig label='custom filter requires renderFilter' theme={theme} />;
			const el = filterDef.renderFilter(params as CustomFilterRendererParams<unknown>);
			return <>{el as React.ReactNode}</>;
		}

		default:
			return null;
	}
}

function MissingConfig({ label, theme }: { label: string; theme: ThemeTokens }) {
	return <div style={{ padding: '8px 10px', fontSize: 10, color: '#ef4444', fontStyle: 'italic' }}>{label}</div>;
}
