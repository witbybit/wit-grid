/**
 * Native Cell Types Showcase
 *
 * All renderers/editors are imported directly from @eregister/wit-grid-react —
 * they ship inside the package, not here in the demo.
 */
import React, { useMemo, useState } from 'react';
import { Grid, multiSelectColumnType, dropdownColumnType, numberColumnType } from '@eregister/wit-grid-react';
import type { ColumnDef, ColumnTypeDefinition, DropdownOption, GridReadyEvent } from '@eregister/wit-grid-react';
import { CheckSquare, Tag, Calendar, List, Hash, Film, Sparkles, Code2, ChevronRight, Box } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface SkaterRow {
	id: string;
	skaterName: string;
	tricks: string;
	yearsSkating: string;
	skatedSince: string;
	isPro: string;
	level: string;
	media: string;
}

// ─── Options (defined once, module-level) ────────────────────────────────────

const TRICKS_OPTIONS = [
	'Kickflip',
	'Heelflip',
	'Tre Flip',
	'Hardflip',
	'Varial Flip',
	'360 Flip',
	'Ollie',
	'Nollie',
	'Pop Shove-it',
	'FS Boardslide',
	'BS Boardslide',
	'Crooked Grind',
	'Smith Grind',
	'Bluntslide',
	'Nosegrind',
	'50-50 Grind',
];

const LEVEL_OPTIONS: DropdownOption[] = [
	{ value: 'Beginner', color: 'default' },
	{ value: 'Amateur', color: 'blue' },
	{ value: 'Intermediate', color: 'cyan' },
	{ value: 'Advanced', color: 'yellow' },
	{ value: 'Expert', color: 'orange' },
	{ value: 'Pro', color: 'purple' },
	{ value: 'Legend', color: 'rose' },
];

// ─── Column types registry ────────────────────────────────────────────────────
// All cell types are registered here. Built-in helpers (multiSelectColumnType,
// dropdownColumnType, numberColumnType) create stable renderer+editor pairs.

const SKATER_COLUMN_TYPES: Record<string, ColumnTypeDefinition<SkaterRow>> = {
	tricks: multiSelectColumnType(TRICKS_OPTIONS, 2),
	level: dropdownColumnType(LEVEL_OPTIONS),
	'years-number': numberColumnType({ suffix: ' yrs', min: 0, max: 80, step: 1 }),
};

// ─── Media renderer (demo-only, for file columns) ─────────────────────────────

const EXT_ICONS: Record<string, string> = {
	mp4: '🎬',
	mov: '🎬',
	avi: '🎬',
	jpg: '🖼',
	jpeg: '🖼',
	png: '🖼',
	gif: '🖼',
	webp: '🖼',
	pdf: '📄',
	doc: '📝',
	docx: '📝',
	zip: '📦',
};

function MediaCell({ value }: { value: unknown }) {
	const files = String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (!files.length) return <span style={{ color: '#475569', fontSize: 11, fontStyle: 'italic' }}>—</span>;
	const first = files[0];
	const ext = first.split('.').pop()?.toLowerCase() ?? '';
	const icon = EXT_ICONS[ext] ?? '📎';
	const overflow = files.length - 1;
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', height: '100%' }}>
			<span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
			<span
				style={{
					fontSize: 11,
					color: '#cbd5e1',
					fontFamily: 'ui-monospace,monospace',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{first}
			</span>
			{overflow > 0 && (
				<span
					style={{
						fontSize: 9,
						fontWeight: 700,
						color: '#64748b',
						border: '1px solid rgba(30,41,59,0.9)',
						background: 'rgba(30,41,59,0.5)',
						padding: '2px 5px',
						borderRadius: 4,
						flexShrink: 0,
					}}
				>
					+{overflow}
				</span>
			)}
		</div>
	);
}

// ─── Column definitions ───────────────────────────────────────────────────────

const SKATER_COLUMNS: ColumnDef<SkaterRow>[] = [
	{ field: 'id', header: 'Skater ID', width: 100 },
	{ field: 'skaterName', header: 'Name', width: 160, sortable: true },
	{ field: 'tricks', header: 'Tricks', width: 250, type: 'tricks' },
	{ field: 'yearsSkating', header: 'Years Skating', width: 130, type: 'years-number', sortable: true },
	{ field: 'skatedSince', header: 'Skating Since', width: 145, type: 'date', sortable: true },
	{ field: 'isPro', header: 'Pro', width: 68, type: 'checkbox' },
	{ field: 'level', header: 'Level', width: 130, type: 'level', sortable: true },
	{
		field: 'media',
		header: 'Media',
		width: 180,
		renderer: {
			kind: 'react',
			component: ({ value }: any) => <MediaCell value={value} />,
			capabilities: { scrollPresentation: 'freeze' },
		},
	},
];

// ─── Seed data ────────────────────────────────────────────────────────────────

const NAMES = [
	'Tony Hawk',
	'Rodney Mullen',
	'Nyjah Huston',
	'Ryan Sheckler',
	'Bam Margera',
	'Chad Muska',
	'Eric Koston',
	'Steve Caballero',
	'Mark Gonzales',
	'Daewon Song',
	'Chris Cole',
	'Jamie Thomas',
	'Andrew Reynolds',
	'Geoff Rowley',
	'PJ Ladd',
	'Zered Bassett',
	'Dylan Rieder',
	'Mikey Taylor',
	'Greg Lutzka',
	'Bastien Salabanzi',
];

const TRICK_SEEDS = [
	'Crooked Grind,Heelflip,Nollie',
	'360 Flip,Ollie,Heelflip,Tre Flip',
	'Heelflip,Nollie,Hardflip',
	'Smith Grind,Hardflip,360 Flip,FS Boardslide,BS Boardslide',
	'Hardflip,FS Boardslide,Kickflip',
	'50-50 Grind,Nosegrind,Bluntslide',
	'Ollie,Pop Shove-it',
	'Kickflip,360 Flip,Varial Flip',
	'Nosegrind,FS Boardslide,Tre Flip',
	'Smith Grind,Heelflip,Nollie,Ollie',
];

const DATES = [
	'2017-01-19',
	'2000-08-23',
	'2018-11-01',
	'2011-09-04',
	'2016-03-19',
	'2016-03-30',
	'2008-08-16',
	'2015-12-08',
	'2012-07-02',
	'2004-02-11',
	'2008-04-30',
	'2020-08-18',
	'2003-07-21',
	'2010-12-02',
	'1999-05-17',
	'2007-03-14',
	'2013-06-25',
	'2001-11-08',
	'2014-09-03',
	'2005-06-28',
];

const MEDIA = [
	'skate_edit.mp4',
	'photo_2.jpg',
	'',
	'sponsor_contrac...,release_form.pdf',
	'trick_clip.mp4',
	'',
	'',
	'session_log.pdf',
	'',
	'highlight.mp4',
];

const LEVELS = LEVEL_OPTIONS.map((o) => o.value);

function generateSkaterRows(count: number): SkaterRow[] {
	return Array.from({ length: count }, (_, i) => {
		const years = Math.max(1, 28 - ((i * 7) % 27));
		const levelIdx = Math.min(LEVELS.length - 1, Math.floor(years / 5));
		return {
			id: `SKT-${1000 + i}`,
			skaterName: i < NAMES.length ? NAMES[i] : `${NAMES[i % NAMES.length]} Jr.`,
			tricks: TRICK_SEEDS[i % TRICK_SEEDS.length],
			yearsSkating: String(years),
			skatedSince: DATES[i % DATES.length],
			isPro: String(i % 4 !== 0),
			level: LEVELS[levelIdx],
			media: MEDIA[i % MEDIA.length],
		};
	});
}

// ─── Cell type reference data ─────────────────────────────────────────────────

const CELL_TYPES = [
	{
		icon: CheckSquare,
		accent: '#818cf8',
		accentBg: 'rgba(99,102,241,0.12)',
		accentBorder: 'rgba(99,102,241,0.3)',
		label: 'Checkbox',
		field: 'isPro',
		tagline: 'Zero-editor toggle',
		description: 'Click toggles value directly. No editor mounted — just api.setCellValue on mousedown.',
		renderer: 'CheckboxCellRenderer',
		editor: '(none needed)',
	},
	{
		icon: Tag,
		accent: '#c084fc',
		accentBg: 'rgba(168,85,247,0.12)',
		accentBorder: 'rgba(168,85,247,0.3)',
		label: 'Multi-select',
		field: 'tricks',
		tagline: 'Portal dropdown + search',
		description: 'Pill tags with stable palette. Dropdown renders in document.body portal to escape overflow:hidden.',
		renderer: 'createMultiSelectCellRenderer(OPTIONS)',
		editor: 'createMultiSelectCellEditor(OPTIONS)',
	},
	{
		icon: Calendar,
		accent: '#22d3ee',
		accentBg: 'rgba(6,182,212,0.12)',
		accentBorder: 'rgba(6,182,212,0.3)',
		label: 'Date',
		field: 'skatedSince',
		tagline: 'YYYY-MM-DD ↔ DD/MM/YYYY',
		description: 'Stores ISO dates. Displays as DD/MM/YYYY. Native date picker with dark-mode styling on edit.',
		renderer: 'DateCellRenderer',
		editor: 'DateCellEditor',
	},
	{
		icon: List,
		accent: '#fbbf24',
		accentBg: 'rgba(245,158,11,0.12)',
		accentBorder: 'rgba(245,158,11,0.3)',
		label: 'Dropdown',
		field: 'level',
		tagline: '14 colour tokens',
		description: 'Enum badge with semantic colour per option. Factory pattern keeps renderer identity stable.',
		renderer: 'createDropdownCellRenderer(OPTIONS)',
		editor: 'createDropdownCellEditor(OPTIONS)',
	},
	{
		icon: Hash,
		accent: '#34d399',
		accentBg: 'rgba(16,185,129,0.12)',
		accentBorder: 'rgba(16,185,129,0.3)',
		label: 'Number',
		field: 'yearsSkating',
		tagline: 'Stepper + bounds + format',
		description: 'Formatted display with prefix/suffix. Custom stepper buttons, min/max, step, Arrow↑↓ keyboard.',
		renderer: 'createNumberCellRenderer({ suffix })',
		editor: 'createNumberCellEditor({ min, max, step })',
	},
	{
		icon: Film,
		accent: '#fb7185',
		accentBg: 'rgba(244,63,94,0.12)',
		accentBorder: 'rgba(244,63,94,0.3)',
		label: 'Media / Tags',
		field: 'media',
		tagline: 'Comma-separated files',
		description: 'Read-only. Extension-based icon, overflow count. Use TagsCellRenderer for generic tag display.',
		renderer: 'TagsCellRenderer (or custom)',
		editor: '(read-only)',
	},
];

const SNIPPET = `// Import directly from @eregister/wit-grid-react — no extra packages needed
import {
  CheckboxCellRenderer,
  createMultiSelectCellRenderer,
  createMultiSelectCellEditor,
  DateCellRenderer,
  DateCellEditor,
  createDropdownCellRenderer,
  createDropdownCellEditor,
  createNumberCellRenderer,
  createNumberCellEditor,
} from '@eregister/wit-grid-react';

// Create instances ONCE at module level (stable identity)
const TricksRenderer = createMultiSelectCellRenderer(TRICKS);
const TricksEditor   = createMultiSelectCellEditor(TRICKS);
const LevelRenderer  = createDropdownCellRenderer(LEVEL_OPTIONS);
const YearsEditor    = createNumberCellEditor({ min: 0, max: 80 });

// Use in colDef
const columns: ColumnDef<Row>[] = [
  {
    field: 'isActive',
    renderer: { kind: 'react', component: CheckboxCellRenderer,
      capabilities: { scrollPresentation: 'freeze' } },
  },
  {
    field: 'tricks',
    renderer: { kind: 'react', component: TricksRenderer },
    cellEditor: TricksEditor,
  },
  {
    field: 'startDate',
    renderer: { kind: 'react', component: DateCellRenderer },
    cellEditor: DateCellEditor,
  },
];

// Theme — override any CSS variable on :root or a container:
// --og-ct-accent, --og-ct-bg, --og-ct-text, --og-ct-border, …`;

// ─── Page component ───────────────────────────────────────────────────────────

function NativeCellTypesDemoInner({ rows, onGridReady }: { rows: SkaterRow[]; onGridReady?: (event: GridReadyEvent<SkaterRow>) => void }) {
	const [activeType, setActiveType] = useState<number | null>(null);
	const [showSnippet, setShowSnippet] = useState(false);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* ── Grid panel ── */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				{/* Header */}
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-purple-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2.5'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-pulse shrink-0' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Box className='w-4 h-4 text-purple-400' />
							Native Cell Types from <span className='text-purple-300 font-mono'>@eregister/wit-grid-react</span>
							<span className='text-slate-600 font-normal'>— double-click any cell to edit</span>
						</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded shrink-0'>
						50 rows · 8 cols · 6 cell types
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={SKATER_COLUMNS}
						columnTypes={SKATER_COLUMN_TYPES}
						navigationOptions={{ editTrigger: 'doubleClick' }}
						pinLeftColumns={1}
						onGridReady={onGridReady}
					/>
				</div>
			</div>

			{/* ── Info sidebar ── */}
			<div className='w-full xl:w-[308px] flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* Cell type reference */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-0.5'>
						<Tag className='w-3.5 h-3.5 text-purple-400' />
						Cell Type Reference
					</h3>

					{CELL_TYPES.map((ct, idx) => {
						const Icon = ct.icon;
						const isOpen = activeType === idx;
						return (
							<div
								key={ct.field}
								className='rounded-lg border cursor-pointer transition-all duration-150'
								style={{
									border: isOpen ? `1px solid ${ct.accentBorder}` : '1px solid rgba(30,41,59,0.7)',
									background: isOpen ? ct.accentBg : 'rgba(3,7,18,0.3)',
								}}
								onClick={() => setActiveType(isOpen ? null : idx)}
							>
								<div className='flex items-center gap-2.5 px-3 py-2.5'>
									<span
										className='p-1.5 rounded-md'
										style={{
											background: isOpen ? ct.accentBg : 'rgba(15,23,42,0.6)',
											border: `1px solid ${isOpen ? ct.accentBorder : 'rgba(30,41,59,0.8)'}`,
										}}
									>
										<Icon className='w-3 h-3' style={{ color: ct.accent }} />
									</span>
									<div className='flex-1 min-w-0'>
										<div className='text-[11px] font-bold leading-tight' style={{ color: isOpen ? ct.accent : '#cbd5e1' }}>
											{ct.label}
										</div>
										{!isOpen && <div className='text-[9px] text-slate-500 font-medium leading-tight mt-0.5'>{ct.tagline}</div>}
									</div>
									<ChevronRight
										className='w-3 h-3 shrink-0 transition-transform duration-150'
										style={{ color: isOpen ? ct.accent : '#475569', transform: isOpen ? 'rotate(90deg)' : 'none' }}
									/>
								</div>

								{isOpen && (
									<div className='px-3 pb-3 flex flex-col gap-2'>
										<p className='text-[10px] leading-relaxed' style={{ color: '#94a3b8' }}>
											{ct.description}
										</p>
										<div
											className='rounded-md p-2 flex flex-col gap-1.5 font-mono'
											style={{ background: 'rgba(3,7,18,0.5)', border: '1px solid rgba(30,41,59,0.8)' }}
										>
											<div className='flex items-start gap-2 text-[9px]'>
												<span className='text-slate-500 uppercase font-bold tracking-wider shrink-0 pt-0.5 w-3'>R</span>
												<span className='text-slate-300 break-all'>{ct.renderer}</span>
											</div>
											<div className='flex items-start gap-2 text-[9px]'>
												<span className='text-slate-500 uppercase font-bold tracking-wider shrink-0 pt-0.5 w-3'>E</span>
												<span className='text-slate-400 break-all'>{ct.editor}</span>
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>

				{/* Architecture notes */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-0.5'>
						<Sparkles className='w-3.5 h-3.5 text-indigo-400' />
						Design Notes
					</h3>
					{[
						{ dot: 'bg-indigo-500', t: 'All renderers are memo-wrapped — React bails out when props are unchanged' },
						{ dot: 'bg-purple-500', t: 'Multi-select dropdown uses createPortal — escapes grid overflow:hidden entirely' },
						{ dot: 'bg-cyan-500', t: 'Checkbox toggles via api directly on mousedown — zero editor overhead' },
						{ dot: 'bg-emerald-500', t: 'Factory functions create stable renderer identity — never inside a component' },
						{ dot: 'bg-amber-500', t: 'Theme via CSS vars: override --og-ct-* on any ancestor element' },
						{
							dot: 'bg-rose-500',
							t: "scrollPresentation: 'freeze' freezes the portal during scroll — re-renders only when data version changes",
						},
					].map((n, i) => (
						<div key={i} className='flex items-start gap-2 text-[10px] text-slate-500 leading-relaxed'>
							<span className={`w-1.5 h-1.5 rounded-full ${n.dot} mt-1 shrink-0`} />
							{n.t}
						</div>
					))}
				</div>

				{/* Usage snippet */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<button className='flex items-center justify-between w-full text-left' onClick={() => setShowSnippet((v) => !v)}>
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Code2 className='w-3.5 h-3.5 text-emerald-400' />
							Usage Snippet
						</h3>
						<ChevronRight
							className='w-3 h-3 text-slate-500 transition-transform duration-150'
							style={{ transform: showSnippet ? 'rotate(90deg)' : 'none' }}
						/>
					</button>
					{showSnippet && (
						<pre className='text-[9px] text-slate-400 font-mono leading-relaxed bg-slate-950/80 border border-slate-900 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap'>
							{SNIPPET}
						</pre>
					)}
				</div>
			</div>
		</div>
	);
}

interface NativeCellTypesDemoProps {
	onGridReady?: (event: GridReadyEvent<SkaterRow>) => void;
}

export default function NativeCellTypesDemo({ onGridReady }: NativeCellTypesDemoProps) {
	const rows = useMemo(() => generateSkaterRows(50), []);

	return <NativeCellTypesDemoInner rows={rows} onGridReady={onGridReady} />;
}
