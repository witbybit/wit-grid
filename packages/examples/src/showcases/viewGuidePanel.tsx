import { useEffect, useState } from 'react';
import type { GridApi } from '@eregister/wit-grid-react';

type ViewKind = 'table' | 'gallery' | 'calendar';

interface Guide {
	title: string;
	steps: { name: string; text: string }[];
	note: string;
}

/** What each view does and how to use it, step by step. */
const GUIDES: Record<ViewKind, Guide> = {
	table: {
		title: 'The team workspace',
		steps: [
			{ name: 'Native cells', text: 'Status, people, dates, ranges, ratings and more are drawn by the grid core. Double-click or press Enter to edit.' },
			{ name: 'Teammates, live', text: 'Ava, Leo and Mia move between cells and land edits; their cursors glide and the cells they change flash.' },
			{ name: 'Rows slide', text: 'Sorted by velocity, so an edit that changes it slides the row to its new place under the heat scale.' },
			{ name: 'Timeline', text: 'Drag a bar to move a task, or an end to resize it. Every bar shares one time scale.' },
			{ name: 'Gallery and calendar', text: 'Switch views above the grid: the same filtered, sorted rows as cards or on a calendar.' },
		],
		note: 'The strip beside the scrollbar is the minimap: selection, recent edits and issues across every row.',
	},
	calendar: {
		title: 'How the calendar works',
		steps: [
			{ name: 'Same rows, by date', text: 'Every task sits on its due day. Filters, sort and search apply here exactly as in the table.' },
			{ name: 'Click an entry', text: 'A card opens with its dates, status, priority and owner, and buttons to nudge it a day or a week.' },
			{ name: 'Drag to reschedule', text: 'Grab an entry and drop it on another day. The days it will cover light up and a tag shows the new date; Esc cancels.' },
			{ name: 'Double-click', text: 'Opens the task in the table, scrolled to the middle and flashed, so you can edit every field.' },
			{ name: 'Ranges span days', text: 'Point the calendar at a { start, end } field (like Timeline) and entries stretch across the days they cover.' },
		],
		note: 'Moves write through the normal API: sort order, conditional formats, the minimap and teammates all react, and undo works.',
	},
	gallery: {
		title: 'How the gallery works',
		steps: [
			{ name: 'Cards, not rows', text: 'Each task is a card: its title, a status-coloured band and the fields you choose.' },
			{ name: 'Native fields', text: 'Status pills, avatars, progress and currency are drawn by the same cell renderers as the table.' },
			{ name: 'Virtualized', text: 'Only the cards in view exist; they are recycled as you scroll, so 100k rows stay smooth.' },
			{ name: 'Double-click a card', text: 'Opens the task in the table, scrolled into view and flashed.' },
		],
		note: 'Filters, sort and search from the sidebar and the chips apply to the gallery too.',
	},
};

const kindOf = (api: GridApi<any>): ViewKind => api.getView()?.kind ?? 'table';

/**
 * A custom sidebar panel: the guide for whichever view the grid is showing, following view switches.
 * Styled with the grid's theme variables, so it matches every theme.
 */
export function ViewGuidePanel({ api }: { api: GridApi<any> }) {
	const [kind, setKind] = useState<ViewKind>(() => kindOf(api));
	useEffect(() => api.subscribeToKey('view', () => setKind(kindOf(api))), [api]);
	const guide = GUIDES[kind];
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px' }}>
			<div style={{ fontSize: 13, fontWeight: 600, color: 'var(--og-text-color)' }}>{guide.title}</div>
			<ol style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
				{guide.steps.map((step, i) => (
					<li key={step.name} style={{ display: 'flex', gap: 10 }}>
						<span
							style={{
								flex: 'none',
								width: 18,
								height: 18,
								borderRadius: 999,
								display: 'grid',
								placeItems: 'center',
								fontSize: 10,
								fontWeight: 700,
								color: 'var(--og-focus-ring)',
								background: 'color-mix(in srgb, var(--og-focus-ring) 18%, transparent)',
							}}
						>
							{i + 1}
						</span>
						<span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
							<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--og-text-color)' }}>{step.name}</span>
							<span className='og-sb-hint' style={{ padding: 0 }}>
								{step.text}
							</span>
						</span>
					</li>
				))}
			</ol>
			<p className='og-sb-hint' style={{ margin: 0, paddingTop: 12, borderTop: '1px solid var(--og-cell-border)' }}>
				{guide.note}
			</p>
		</div>
	);
}

/** Rail icon: an open book (24×24, currentColor strokes). */
export const GUIDE_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H3.5A1.5 1.5 0 0 1 2 16z"/><path d="M22 5.5A1.5 1.5 0 0 0 20.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h6a1.5 1.5 0 0 0 1.5-1.5z"/></svg>';
