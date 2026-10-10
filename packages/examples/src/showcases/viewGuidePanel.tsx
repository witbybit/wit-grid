import { useEffect, useState } from 'react';
import type { GridApi } from '@eregister/wit-grid-react';

type ViewKind = 'table' | 'gallery' | 'calendar' | 'kanban' | 'gantt';

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
			{
				name: 'Native cells',
				text: 'Status, people, dates, ranges, ratings and more are drawn by the grid core. Double-click or press Enter to edit.',
			},
			{
				name: 'Teammates, live',
				text: 'Ava, Leo and Mia move between cells and land edits; their cursors glide and the cells they change flash.',
			},
			{ name: 'Rows slide', text: 'Sorted by velocity, so an edit that changes it slides the row to its new place under the heat scale.' },
			{ name: 'Timeline', text: 'Drag a bar to move a task, or an end to resize it. Every bar shares one time scale.' },
			{
				name: 'Views',
				text: 'Switch views above the grid: the same filtered, sorted rows as cards, a calendar, a Kanban board or Gantt timeline.',
			},
		],
		note: 'The strip beside the scrollbar is the minimap: selection, recent edits and issues across every row.',
	},
	calendar: {
		title: 'How the calendar works',
		steps: [
			{ name: 'Same rows, by date', text: 'Every task sits on its due day. Filters, sort and search apply here exactly as in the table.' },
			{
				name: 'Click an entry',
				text: 'Select a record. Ctrl/Cmd-click toggles selection; Shift-click selects a range. Selection stays with you across views.',
			},
			{
				name: 'Drag to reschedule',
				text: 'Grab an entry and drop it on another day. The days it will cover light up and a tag shows the new date; Esc cancels.',
			},
			{ name: 'Double-click', text: 'Opens record details beside the view. Edit fields here, or choose Open in grid for tabular work.' },
			{
				name: 'Ranges span days',
				text: 'Point the calendar at a { start, end } field (like Timeline) and entries stretch across the days they cover.',
			},
		],
		note: 'Moves write through the normal API: sort order, conditional formats, the minimap and teammates all react, and undo works.',
	},
	gallery: {
		title: 'How the gallery works',
		steps: [
			{ name: 'Cards, not rows', text: 'Each task is a card: its title, a status-coloured band and the fields you choose.' },
			{ name: 'Native fields', text: 'Status pills, avatars, progress and currency are drawn by the same cell renderers as the table.' },
			{ name: 'Virtualized', text: 'Only the cards in view exist; they are recycled as you scroll, so 100k rows stay smooth.' },
			{ name: 'Double-click a card', text: 'Opens record details beside the view. Enter does the same; right-click for contextual actions.' },
		],
		note: 'Filters, sort and search from the sidebar and the chips apply to the gallery too.',
	},
	kanban: {
		title: 'How the Kanban board works',
		steps: [
			{
				name: 'Status columns',
				text: 'Every status option is a column, with its count and total. The board follows the grid’s filters, sort and search.',
			},
			{
				name: 'Move work',
				text: 'Drag a card — or the whole selection — to another column. Alt + arrows move the focused card. One undo step each.',
			},
			{ name: 'Swimlanes', text: 'Group (in the toolbar) splits every column into lanes by team, owner or priority.' },
			{ name: 'Inspect', text: 'Click a card: the inspector edits every field with its column’s own editor. Ctrl/⌘ K opens every command.' },
		],
		note: 'A card waiting on unfinished work after its planned start is marked blocked.',
	},
	gantt: {
		title: 'How the Gantt schedule works',
		steps: [
			{ name: 'One outline, one timeline', text: 'Task names and bars share rows and scrolling; summaries roll up their children.' },
			{
				name: 'Move and resize',
				text: 'Drag a bar to move it, an end to resize it, the knob to set progress. Successors follow, after you see the impact.',
			},
			{ name: 'Link', text: 'Drag the round handle onto another bar to make it wait on this one. Cycles are refused.' },
			{ name: 'Scale', text: 'Days to years, Today and Fit in the toolbar; critical path, baselines and workload toggle there too.' },
		],
		note: 'The inspector gains Schedule, Dependencies and Resources tabs for the selected task.',
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
