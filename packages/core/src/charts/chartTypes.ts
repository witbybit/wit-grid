export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';

export type ChartAggregate = 'sum' | 'avg' | 'count' | 'min' | 'max';

/** What a chart plots: the selected cells, or a column's values aggregated per category. */
export type ChartSource =
	| {
			kind: 'range';
			/** Series per row instead of per column. */
			transposed?: boolean;
	  }
	| {
			kind: 'aggregate';
			/** The column whose values are the categories. */
			category: string;
			/** The measures: a number column and how to combine it (`count` needs no field). */
			measures: readonly { field?: string; aggregate: ChartAggregate; label?: string }[];
			/** Order categories by the first measure (default) or by their label. */
			sort?: 'value' | 'label';
			/** Keep the largest N categories; the rest fold into “Other”. Default 24. */
			limit?: number;
	  };

export interface ChartSpec {
	type: ChartType;
	source: ChartSource;
	title?: string;
	/** Columns, bars and areas pile up instead of standing side by side. */
	stacked?: boolean;
	/** Lines and areas curve through their points. */
	smooth?: boolean;
	/** Values on the marks. */
	labels?: boolean;
	/** Default true. */
	legend?: boolean;
	/** The value axis starts at zero. Default true. */
	zeroBased?: boolean;
	/** Clicking a category filters the grid to it (a click again clears). Default true. */
	crossFilter?: boolean;
	/** Series colours; defaults follow the grid theme's accent. */
	palette?: readonly string[];
}

export interface ChartSeries {
	name: string;
	values: number[];
	color: string;
}

export interface ChartData {
	categories: string[];
	series: ChartSeries[];
	/** The column categories come from, when there is one (cross-filtering filters it). */
	categoryField: string | null;
	/** Raw category values, parallel to `categories` (what a cross-filter selects). */
	categoryValues: (string | number | null)[];
}
