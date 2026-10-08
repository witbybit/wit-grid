import type { ColumnDef } from '../../columnDef.js';
import type { GalleryViewConfig } from '../../views.js';
import { defaultGridScheduler } from '../gridScheduler.js';
import { fieldText, viewColour, ViewField, type GridViewContext, type GridViewInstance, type ViewRow } from './viewContext.js';

const GAP = 14;
const TITLE_H = 40;
const FIELD_H = 30;
const PADDING = 14;
const OVERSCAN_ROWS = 2;

interface Card<TRowData> {
	element: HTMLElement;
	band: HTMLElement;
	title: HTMLElement;
	fields: ViewField<TRowData>[];
	rowId: string | null;
}

/**
 * The displayed rows as cards: a title, a colour band and a few fields drawn by their columns' own
 * renderers. Virtualized: only the cards in view exist, recycled as the gallery scrolls.
 * Double-click a card to open its row in the table.
 */
export function createGalleryView<TRowData>(host: HTMLElement, context: GridViewContext<TRowData>, config: GalleryViewConfig<TRowData>): GridViewInstance {
	const scroller = document.createElement('div');
	scroller.className = 'og-view-gallery';
	const sizer = document.createElement('div');
	sizer.className = 'og-view-gallery-sizer';
	scroller.appendChild(sizer);
	host.appendChild(scroller);

	const columns = context.columns();
	const titleCol: ColumnDef<TRowData> | undefined = columns.find((c) => c.field === config.titleField) ?? columns[0];
	const fieldCols = (config.fields ?? columns.filter((c) => c !== titleCol).slice(0, 4).map((c) => c.field))
		.map((field) => columns.find((c) => c.field === field))
		.filter((c): c is ColumnDef<TRowData> => !!c && c !== titleCol);
	const cardHeight = TITLE_H + fieldCols.length * FIELD_H + PADDING;
	const minWidth = config.cardWidth ?? 260;

	const pool: Card<TRowData>[] = [];
	let rows: readonly ViewRow<TRowData>[] = [];
	let frame = 0;

	const makeCard = (): Card<TRowData> => {
		const element = document.createElement('div');
		element.className = 'og-view-card';
		const band = document.createElement('div');
		band.className = 'og-view-card-band';
		const title = document.createElement('div');
		title.className = 'og-view-card-title';
		element.append(band, title);
		const fields = fieldCols.map((col) => {
			const line = document.createElement('div');
			line.className = 'og-view-field';
			const label = document.createElement('span');
			label.className = 'og-view-field-label';
			label.textContent = col.header ?? col.field;
			const field = new ViewField(col, context.api);
			line.append(label, field.element);
			element.appendChild(line);
			return field;
		});
		sizer.appendChild(element);
		return { element, band, title, fields, rowId: null };
	};

	const layout = () => {
		const width = scroller.clientWidth;
		const columnsCount = Math.max(1, Math.floor((width - GAP) / (minWidth + GAP)));
		const cardWidth = Math.max(120, (width - GAP * (columnsCount + 1)) / columnsCount);
		return { columnsCount, cardWidth };
	};

	const draw = () => {
		frame = 0;
		const { columnsCount, cardWidth } = layout();
		const rowCount = Math.ceil(rows.length / columnsCount);
		const pitch = cardHeight + GAP;
		sizer.style.height = `${rowCount * pitch + GAP}px`;
		const first = Math.max(0, Math.floor(scroller.scrollTop / pitch) - OVERSCAN_ROWS);
		const last = Math.min(rowCount - 1, Math.ceil((scroller.scrollTop + scroller.clientHeight) / pitch) + OVERSCAN_ROWS);
		const start = first * columnsCount;
		const end = Math.min(rows.length, (last + 1) * columnsCount);
		const needed = Math.max(0, end - start);
		while (pool.length < needed) pool.push(makeCard());
		for (let i = 0; i < pool.length; i++) {
			const card = pool[i];
			const index = start + i;
			if (i >= needed) {
				card.element.hidden = true;
				card.rowId = null;
				continue;
			}
			const row = rows[index];
			const r = Math.floor(index / columnsCount);
			const c = index % columnsCount;
			card.element.hidden = false;
			card.element.style.transform = `translate(${GAP + c * (cardWidth + GAP)}px, ${GAP + r * pitch}px)`;
			card.element.style.width = `${cardWidth}px`;
			card.element.style.height = `${cardHeight}px`;
			card.rowId = row.id;
			card.element.dataset.rowId = row.id;
			const title = fieldText(titleCol, row);
			if (card.title.textContent !== title) card.title.textContent = title;
			const colour = viewColour(config.color?.(row.data));
			card.band.style.background = colour ?? '';
			card.band.hidden = !colour;
			for (const field of card.fields) field.show(row);
		}
	};

	const schedule = () => {
		// Scroll redraws coalesce to one per frame.
		if (!frame) frame = defaultGridScheduler.raf(draw);
	};
	const onDoubleClick = (event: MouseEvent) => {
		const card = (event.target as Element).closest<HTMLElement>('.og-view-card');
		if (card?.dataset.rowId) context.openInTable(card.dataset.rowId);
	};
	scroller.addEventListener('scroll', schedule, { passive: true });
	scroller.addEventListener('dblclick', onDoubleClick);

	return {
		render() {
			rows = context.rows();
			draw();
		},
		destroy() {
			if (frame) defaultGridScheduler.cancelRaf(frame);
			scroller.removeEventListener('scroll', schedule);
			scroller.removeEventListener('dblclick', onDoubleClick);
			for (const card of pool) for (const field of card.fields) field.destroy();
			scroller.remove();
		},
	};
}
