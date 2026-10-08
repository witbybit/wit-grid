/**
 * Other ways to see the grid's rows: the same displayed rows (filters, sort and search included)
 * drawn as a gallery of cards or on a calendar. `api.setView(config)` switches; `null` returns to
 * the table.
 */

export interface GalleryViewConfig<TRowData = unknown> {
	kind: 'gallery';
	/** The card's title. Default: the first displayed column. */
	titleField?: string;
	/** The fields on each card, drawn with their columns' own renderers. Default: the next four displayed columns. */
	fields?: string[];
	/** A colour band along the card's top (any CSS colour or palette name). */
	color?: (row: TRowData) => string | undefined;
	/** The narrowest a card gets; the gallery fits as many columns as it can. Default 260. */
	cardWidth?: number;
}

export interface CalendarViewConfig<TRowData = unknown> {
	kind: 'calendar';
	/** A date field, or a `{ start, end }` range field (as the date range and timeline types hold). */
	dateField: string;
	/** The entry's label. Default: the first displayed column. */
	titleField?: string;
	/** The entry's colour (any CSS colour or palette name). Default: the theme accent. */
	color?: (row: TRowData) => string | undefined;
	/** The month shown first. Default: today's. */
	initialDate?: string | Date;
	/** First day of the week, 0 = Sunday. Default 1 (Monday). */
	weekStartsOn?: number;
	/** Drag entries to another day. Default true. */
	editable?: boolean;
}

export type GridViewConfig<TRowData = unknown> = GalleryViewConfig<TRowData> | CalendarViewConfig<TRowData>;
