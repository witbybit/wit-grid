/**
 * @eregister/wit-grid-react — Built-in High-Fidelity Cell Renderers & Editors
 *
 * Zero external dependencies. Pure inline styles + a single lazily-injected
 * `<style>` tag (for :hover, :focus, scrollbar, and keyframe animations).
 *
 * Theme system: all colours are CSS custom properties with dark-mode defaults.
 * Light-mode users override these on `:root` or any ancestor element:
 *
 * ```css
 * [data-theme="light"] {
 *   --og-ct-bg:          #ffffff;
 *   --og-ct-surface:     #f8fafc;
 *   --og-ct-overlay:     #f1f5f9;
 *   --og-ct-border:      rgba(226,232,240,1);
 *   --og-ct-border-focus:#6366f1;
 *   --og-ct-text:        #1e293b;
 *   --og-ct-text-muted:  #94a3b8;
 *   --og-ct-accent:      #6366f1;
 *   --og-ct-accent-bg:   rgba(99,102,241,0.1);
 * }
 * ```
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import type { CellRendererProps, CellEditorProps } from '../types.js';

// ─── CSS token constants ──────────────────────────────────────────────────────
// Each resolves a CSS variable with a dark-theme fallback.

const T = {
	bg: 'var(--og-ct-bg, #0d1117)',
	surface: 'var(--og-ct-surface, #030712)',
	overlay: 'var(--og-ct-overlay, rgba(30,41,59,0.8))',
	overlayActive: 'var(--og-ct-overlay-active, rgba(30,41,59,1))',
	border: 'var(--og-ct-border, rgba(30,41,59,0.9))',
	borderHover: 'var(--og-ct-border-hover, rgba(71,85,105,0.6))',
	borderFocus: 'var(--og-ct-border-focus, #6366f1)',
	text: 'var(--og-ct-text, #e2e8f0)',
	textMuted: 'var(--og-ct-text-muted, #64748b)',
	textSubtle: 'var(--og-ct-text-subtle, #94a3b8)',
	accent: 'var(--og-ct-accent, #6366f1)',
	accentBg: 'var(--og-ct-accent-bg, rgba(99,102,241,0.15))',
	accentHover: 'var(--og-ct-accent-hover, #818cf8)',
	accentText: 'var(--og-ct-accent-text, #c7d2fe)',
	dangerText: 'var(--og-ct-danger-text, #f87171)',
	dangerBg: 'var(--og-ct-danger-bg, rgba(239,68,68,0.1))',
	successText: 'var(--og-ct-success-text, #34d399)',
	warningText: 'var(--og-ct-warning-text, #fbbf24)',
};

// Tag colour palettes (8 options, index-stable)
const TAG_PALETTES: ReadonlyArray<{ bg: string; border: string; text: string }> = [
	{ bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.35)', text: '#a5b4fc' }, // indigo
	{ bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.35)', text: '#d8b4fe' }, // purple
	{ bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.35)', text: '#67e8f9' }, // cyan
	{ bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', text: '#6ee7b7' }, // emerald
	{ bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', text: '#fcd34d' }, // amber
	{ bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.35)', text: '#fda4af' }, // rose
	{ bg: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.35)', text: '#7dd3fc' }, // sky
	{ bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)', text: '#5eead4' }, // teal
] as const;

// ─── One-time style injection ─────────────────────────────────────────────────

let _stylesInjected = false;

function ensureStyles() {
	if (_stylesInjected || typeof document === 'undefined') return;
	_stylesInjected = true;

	const el = document.createElement('style');
	el.id = 'og-cell-types';
	el.textContent = `
/* ── og cell types ── */
@keyframes og-ct-fade-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)   scale(1);    }
}
.og-ct-panel { width: 400px; animation: og-ct-fade-in 0.14s cubic-bezier(0.16,1,0.3,1) both; }

/* scrollable list inside dropdown */
.og-ct-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(100,116,139,0.25) transparent;
}
.og-ct-scroll::-webkit-scrollbar { width: 3px; }
.og-ct-scroll::-webkit-scrollbar-track { background: transparent; }
.og-ct-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.25); border-radius: 2px; }

/* option rows — hover handled via CSS so we don't need per-row React state */
.og-ct-option { transition: background 0.08s ease; }
.og-ct-option:hover { background: var(--og-ct-overlay, rgba(30,41,59,0.8)) !important; }

/* search input focus ring */
.og-ct-search:focus {
  outline: none;
  border-color: var(--og-ct-border-focus, #6366f1) !important;
  box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
}

/* number input — hide native arrows so we can use our own */
.og-ct-number-input {
  -moz-appearance: textfield;
  appearance: textfield;
}
.og-ct-number-input::-webkit-inner-spin-button,
.og-ct-number-input::-webkit-outer-spin-button { display: none; }

/* date input dark chrome */
.og-ct-date-input { color-scheme: dark; }
.og-ct-date-input::-webkit-calendar-picker-indicator {
  opacity: 0.5;
  cursor: pointer;
  filter: invert(1);
}

/* stepper button hover */
.og-ct-step:hover { background: rgba(30,41,59,0.9) !important; color: var(--og-ct-text, #e2e8f0) !important; }

/* chip × button */
.og-ct-chip-x { opacity: 0.55; transition: opacity 0.1s; }
.og-ct-chip-x:hover { opacity: 1; }
`;
	document.head.appendChild(el);
}

// ─── Small shared SVGs ────────────────────────────────────────────────────────

const CheckSVG = () => (
	<svg width='10' height='10' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
		<path d='M2 6L5 9L10 3' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' />
	</svg>
);

const CalendarSVG = ({ size = 13 }: { size?: number }) => (
	<svg
		width={size}
		height={size}
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		aria-hidden='true'
	>
		<rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
		<line x1='16' y1='2' x2='16' y2='6' />
		<line x1='8' y1='2' x2='8' y2='6' />
		<line x1='3' y1='10' x2='21' y2='10' />
	</svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse comma-separated string or array into a string array. */
export function parseMultiValue(val: unknown): string[] {
	if (val == null || val === '') return [];
	if (Array.isArray(val)) return (val as unknown[]).map(String);
	return String(val)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function joinMultiValue(vals: string[]): string {
	return vals.join(',');
}

function paletteAt(idx: number) {
	return TAG_PALETTES[((idx % TAG_PALETTES.length) + TAG_PALETTES.length) % TAG_PALETTES.length];
}

function hashIndex(str: string): number {
	let h = 0;
	for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
	return h;
}

// ─── 1. Checkbox ──────────────────────────────────────────────────────────────

/**
 * High-fidelity inline checkbox renderer.
 *
 * Clicking the cell toggles the value directly via `api.setCellValue` — no
 * separate editor is needed. Set `cellEditor: undefined` (or omit it) on the
 * colDef when using this renderer.
 *
 * Stored value: any truthy string/boolean. Normalised to `'true'` / `'false'`
 * on write.
 *
 * @example
 * ```ts
 * import { CheckboxCellRenderer } from '@eregister/wit-grid-react';
 *
 * const columns: ColumnDef<MyRow>[] = [{
 *   field: 'isActive',
 *   header: 'Active',
 *   width: 70,
 *   renderer: {
 *     kind: 'react',
 *     component: CheckboxCellRenderer,
 *     capabilities: { scrollPresentation: 'freeze' },
 *   },
 * }];
 * ```
 */
export const CheckboxCellRenderer = memo(function CheckboxCellRenderer({ value, rowId, colField, api }: CellRendererProps<any>) {
	const checked = value === true || value === 'true' || value === 1 || value === '1';

	return (
		<div
			role='checkbox'
			aria-checked={checked}
			tabIndex={-1}
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: '100%',
				height: '100%',
				cursor: 'pointer',
				userSelect: 'none',
			}}
			onMouseDown={(e) => {
				e.stopPropagation();
				e.preventDefault();
				api.selectCell({ rowId, colField }, 'pointer');
				api.setCellValue(rowId, colField, String(!checked));
			}}
		>
			<div
				style={{
					width: 15,
					height: 15,
					borderRadius: 3,
					border: `2px solid ${checked ? T.accent : T.borderHover}`,
					background: checked ? T.accent : 'transparent',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					transition: 'background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease',
					boxShadow: checked ? `0 0 0 3px ${T.accentBg}` : 'none',
					flexShrink: 0,
					color: '#fff',
				}}
			>
				{checked && <CheckSVG />}
			</div>
		</div>
	);
});

// ─── 2. Multi-select tags renderer ───────────────────────────────────────────

/**
 * Renders a comma-separated value as colour-coded pill tags.
 * Use `createMultiSelectCellRenderer(options)` for stable palette mapping.
 */
export const MultiSelectCellRenderer = memo(function MultiSelectCellRenderer({
	value,
	allOptions,
	maxVisible = 2,
}: CellRendererProps<any> & { allOptions?: string[]; maxVisible?: number }) {
	const tags = parseMultiValue(value);
	if (tags.length === 0) {
		return <span style={{ color: T.textMuted, fontSize: 11, fontStyle: 'italic', userSelect: 'none' }}>—</span>;
	}

	const visible = tags.slice(0, maxVisible);
	const overflow = tags.length - maxVisible;

	const getPalette = (tag: string) => {
		if (allOptions) {
			const idx = allOptions.indexOf(tag);
			if (idx >= 0) return paletteAt(idx);
		}
		return paletteAt(hashIndex(tag));
	};

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 4, height: '100%', overflow: 'hidden' }}>
			{visible.map((tag) => {
				const p = getPalette(tag);
				return (
					<span
						key={tag}
						style={{
							padding: '2px 7px',
							borderRadius: 4,
							fontSize: 10,
							fontWeight: 600,
							border: `1px solid ${p.border}`,
							background: p.bg,
							color: p.text,
							lineHeight: '16px',
							whiteSpace: 'nowrap',
							flexShrink: 0,
							letterSpacing: '0.01em',
						}}
					>
						{tag}
					</span>
				);
			})}
			{overflow > 0 && (
				<span
					style={{
						padding: '2px 6px',
						borderRadius: 4,
						fontSize: 10,
						fontWeight: 700,
						border: `1px solid ${T.border}`,
						background: T.overlay,
						color: T.textMuted,
						lineHeight: '16px',
						flexShrink: 0,
					}}
				>
					+{overflow}
				</span>
			)}
		</div>
	);
});

/**
 * Factory — returns a multi-select renderer with stable colour assignment per option.
 *
 * Create the renderer **once outside the component** so its identity is stable.
 *
 * @example
 * ```ts
 * const TricksRenderer = createMultiSelectCellRenderer(TRICKS_OPTIONS);
 *
 * const columns: ColumnDef<Row>[] = [{
 *   field: 'tricks',
 *   renderer: { kind: 'react', component: TricksRenderer },
 *   cellEditor: createMultiSelectCellEditor(TRICKS_OPTIONS),
 * }];
 * ```
 */
export function createMultiSelectCellRenderer(allOptions: string[], maxVisible = 2) {
	const Renderer = memo(function MultiSelectRenderer(props: CellRendererProps<any>) {
		return <MultiSelectCellRenderer {...props} allOptions={allOptions} maxVisible={maxVisible} />;
	});
	Renderer.displayName = 'MultiSelectCellRenderer';
	return Renderer;
}

// ─── 2b. Multi-select editor ──────────────────────────────────────────────────

interface MultiSelectEditorCoreProps extends CellEditorProps<any> {
	options: string[];
}

function MultiSelectEditorCore({ value, onChange, onCommit, onCancel, options }: MultiSelectEditorCoreProps) {
	ensureStyles();

	const anchorRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({ visibility: 'hidden' as const });
	const [search, setSearch] = useState('');
	const [selected, setSelected] = useState<string[]>(() => parseMultiValue(value));

	// Stable refs so the outside-click handler never captures stale state
	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const onCommitRef = useRef(onCommit);
	onCommitRef.current = onCommit;

	useEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor) return;
		const r = anchor.getBoundingClientRect();
		// Fit below or above depending on available space
		const spaceBelow = window.innerHeight - r.bottom;
		const panelH = Math.min(340, options.length * 36 + 120);
		const top = spaceBelow >= panelH ? r.bottom + 4 : r.top - panelH - 4;

		setPanelStyle({
			position: 'fixed',
			top,
			left: r.left,
			minWidth: Math.max(r.width, 260),
			zIndex: 99999,
			visibility: 'visible',
		});

		// Focus search on next tick
		const timer = setTimeout(() => searchRef.current?.focus(), 20);

		const handleOutside = (e: MouseEvent) => {
			const t = e.target as Node;
			if (panelRef.current?.contains(t) || anchor.contains(t)) return;
			onCommitRef.current(joinMultiValue(selectedRef.current));
		};
		document.addEventListener('mousedown', handleOutside);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('mousedown', handleOutside);
		};
	}, []); // intentionally empty

	const filtered = search ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase())) : options;

	const toggleOption = (opt: string) => {
		const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
		setSelected(next);
		onChange(joinMultiValue(next));
	};

	const getPalette = (opt: string) => paletteAt(options.indexOf(opt));

	// ── panel markup ──
	const panel = (
		<div
			ref={panelRef}
			className='og-ct-panel'
			style={{
				...panelStyle,
				background: T.bg,
				border: `1px solid ${T.border}`,
				borderRadius: 10,
				boxShadow: '0 20px 48px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.4)',
				overflow: 'hidden',
				fontFamily: 'inherit',
			}}
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
		>
			{/* Selected chips row */}
			{selected.length > 0 && (
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						gap: 5,
						padding: '10px 10px 0',
						borderBottom: `1px solid ${T.border}`,
						paddingBottom: 8,
					}}
				>
					{selected.map((s) => {
						const p = getPalette(s);
						return (
							<span
								key={s}
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: 4,
									padding: '2px 6px 2px 8px',
									borderRadius: 5,
									fontSize: 10,
									fontWeight: 600,
									border: `1px solid ${p.border}`,
									background: p.bg,
									color: p.text,
									lineHeight: '17px',
								}}
							>
								{s}
								<button
									className='og-ct-chip-x'
									tabIndex={-1}
									onMouseDown={(e) => {
										e.stopPropagation();
										e.preventDefault();
										toggleOption(s);
									}}
									style={{
										display: 'flex',
										alignItems: 'center',
										background: 'none',
										border: 'none',
										cursor: 'pointer',
										padding: 0,
										color: 'inherit',
										fontSize: 13,
										lineHeight: 1,
									}}
									aria-label={`Remove ${s}`}
								>
									×
								</button>
							</span>
						);
					})}
				</div>
			)}

			{/* Search input */}
			<div style={{ padding: '8px 10px' }}>
				<input
					ref={searchRef}
					className='og-ct-search'
					type='text'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder='Search options…'
					style={{
						width: '100%',
						padding: '6px 10px',
						fontSize: 11,
						background: T.surface,
						border: `1px solid ${T.border}`,
						borderRadius: 6,
						color: T.text,
						outline: 'none',
						boxSizing: 'border-box',
						transition: 'border-color 0.1s',
					}}
					onKeyDown={(e) => {
						if (e.key === 'Escape') onCancel();
						if (e.key === 'Enter') onCommit(joinMultiValue(selected));
						e.stopPropagation();
					}}
				/>
			</div>

			{/* Option list */}
			<div className='og-ct-scroll' style={{ maxHeight: 220, overflowY: 'auto', padding: '0 6px 4px' }}>
				{filtered.length === 0 && (
					<div style={{ padding: '12px 10px', fontSize: 11, color: T.textMuted, textAlign: 'center' }}>No matches</div>
				)}
				{filtered.map((opt) => {
					const isSelected = selected.includes(opt);
					const p = getPalette(opt);
					return (
						<div
							key={opt}
							className='og-ct-option'
							role='option'
							aria-selected={isSelected}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 10,
								padding: '7px 8px',
								borderRadius: 6,
								cursor: 'pointer',
								userSelect: 'none',
								background: isSelected ? T.overlay : 'transparent',
							}}
							onMouseDown={(e) => {
								e.preventDefault();
								e.stopPropagation();
								toggleOption(opt);
							}}
						>
							{/* Custom checkbox */}
							<div
								style={{
									width: 14,
									height: 14,
									borderRadius: 3,
									border: `1.5px solid ${isSelected ? T.accent : T.borderHover}`,
									background: isSelected ? T.accent : 'transparent',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									flexShrink: 0,
									transition: 'all 0.1s ease',
									color: '#fff',
								}}
							>
								{isSelected && <CheckSVG />}
							</div>

							{/* Label */}
							<span
								style={{
									flex: 1,
									fontSize: 12,
									fontWeight: isSelected ? 600 : 400,
									color: isSelected ? T.text : T.textSubtle,
									letterSpacing: '0.01em',
								}}
							>
								{opt}
							</span>

							{/* Colour dot when selected */}
							{isSelected && (
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: '50%',
										background: p.text,
										flexShrink: 0,
										opacity: 0.8,
									}}
								/>
							)}
						</div>
					);
				})}
			</div>

			{/* Footer */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '8px 12px',
					borderTop: `1px solid ${T.border}`,
				}}
			>
				<button
					tabIndex={-1}
					onMouseDown={(e) => {
						e.stopPropagation();
						e.preventDefault();
						setSelected([]);
						onChange('');
					}}
					style={{
						background: 'none',
						border: 'none',
						fontSize: 10,
						fontWeight: 600,
						color: T.textMuted,
						cursor: 'pointer',
						padding: '2px 4px',
						letterSpacing: '0.04em',
					}}
				>
					Clear all
				</button>

				<div style={{ display: 'flex', gap: 6 }}>
					<button
						tabIndex={-1}
						onMouseDown={(e) => {
							e.stopPropagation();
							e.preventDefault();
							onCancel();
						}}
						style={{
							height: 26,
							padding: '0 10px',
							fontSize: 10,
							fontWeight: 600,
							borderRadius: 5,
							border: `1px solid ${T.border}`,
							background: 'transparent',
							color: T.textSubtle,
							cursor: 'pointer',
							letterSpacing: '0.04em',
						}}
					>
						Cancel
					</button>
					<button
						tabIndex={-1}
						onMouseDown={(e) => {
							e.stopPropagation();
							e.preventDefault();
							onCommit(joinMultiValue(selected));
						}}
						style={{
							height: 26,
							padding: '0 14px',
							fontSize: 10,
							fontWeight: 700,
							borderRadius: 5,
							border: `1px solid ${T.accent}`,
							background: T.accentBg,
							color: T.accentText,
							cursor: 'pointer',
							letterSpacing: '0.04em',
							transition: 'background 0.1s',
						}}
					>
						Apply
					</button>
				</div>
			</div>
		</div>
	);

	return (
		<>
			{/* Anchor element — we read its rect to position the portal */}
			<div
				ref={anchorRef}
				style={{
					position: 'absolute',
					inset: 0,
					border: `2px solid ${T.borderFocus}`,
					borderRadius: 1,
					pointerEvents: 'none',
					boxSizing: 'border-box',
				}}
			/>
			{createPortal(panel, document.body)}
		</>
	);
}

/**
 * Factory — returns a multi-select cell editor bound to a fixed option set.
 *
 * Create it **once outside the component** for stable identity.
 *
 * @example
 * ```ts
 * const TricksEditor = createMultiSelectCellEditor(TRICKS_OPTIONS);
 *
 * // colDef
 * { field: 'tricks', cellEditor: TricksEditor }
 * ```
 */
export function createMultiSelectCellEditor(options: string[]) {
	function MultiSelectEditor(props: CellEditorProps<any>) {
		return <MultiSelectEditorCore {...props} options={options} />;
	}
	MultiSelectEditor.displayName = 'MultiSelectCellEditor';
	return MultiSelectEditor;
}

// ─── 3. Date ──────────────────────────────────────────────────────────────────

/**
 * Renders an ISO date string (YYYY-MM-DD) as DD/MM/YYYY with a calendar icon.
 * Empty values show a dash.
 *
 * @example
 * ```ts
 * import { DateCellRenderer, DateCellEditor } from '@eregister/wit-grid-react';
 *
 * { field: 'startDate', renderer: { kind: 'react', component: DateCellRenderer }, cellEditor: DateCellEditor }
 * ```
 */
export const DateCellRenderer = memo(function DateCellRenderer({ value }: CellRendererProps<any>) {
	const raw = String(value ?? '');
	let display = '—';
	const isEmpty = !raw || raw === 'undefined' || raw === 'null';

	if (!isEmpty) {
		const parts = raw.split('-');
		if (parts.length === 3 && parts[0].length === 4) {
			display = `${parts[2]}/${parts[1]}/${parts[0]}`;
		} else {
			display = raw;
		}
	}

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				height: '100%',
				color: isEmpty ? T.textMuted : T.text,
			}}
		>
			<span style={{ color: T.textMuted, flexShrink: 0, display: 'flex' }}>
				<CalendarSVG size={12} />
			</span>
			<span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.02em' }}>{display}</span>
		</div>
	);
});

/**
 * Edits an ISO date (YYYY-MM-DD) using the native date picker.
 * Opens the picker immediately on focus. Commits on Enter or blur; cancels on Escape.
 */
export function DateCellEditor({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) {
	ensureStyles();
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		// showPicker() is optional (not available in all browsers)
		try {
			(el as any).showPicker?.();
		} catch {
			// ignore — some browsers throw if not triggered by user gesture
		}
	}, []);

	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				display: 'flex',
				alignItems: 'center',
				padding: '0 10px',
				background: T.bg,
				border: `2px solid ${T.borderFocus}`,
				boxSizing: 'border-box',
				gap: 6,
				zIndex: 20,
			}}
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
		>
			<span style={{ color: T.textMuted, display: 'flex', flexShrink: 0 }}>
				<CalendarSVG size={12} />
			</span>
			<input
				ref={inputRef}
				className='og-ct-date-input'
				type='date'
				defaultValue={String(value ?? '')}
				onChange={(e) => onChange(e.target.value)}
				onBlur={(e) => onCommit(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') onCommit((e.target as HTMLInputElement).value);
					if (e.key === 'Escape') onCancel();
					e.stopPropagation();
				}}
				style={{
					flex: 1,
					minWidth: 0,
					fontSize: 11,
					fontFamily: 'ui-monospace, monospace',
					background: 'transparent',
					border: 'none',
					outline: 'none',
					color: T.text,
					cursor: 'pointer',
					letterSpacing: '0.02em',
				}}
			/>
		</div>
	);
}

// ─── 4. Dropdown ──────────────────────────────────────────────────────────────

/** Semantic colour names mapped to dark-mode badge styles. */
export type DropdownOptionColor =
	| 'default'
	| 'green'
	| 'emerald'
	| 'yellow'
	| 'amber'
	| 'red'
	| 'rose'
	| 'blue'
	| 'indigo'
	| 'purple'
	| 'cyan'
	| 'sky'
	| 'orange'
	| 'teal';

export interface DropdownOption {
	/** Stored value (matched against the cell value). */
	value: string;
	/** Display label — defaults to `value` if omitted. */
	label?: string;
	/** Badge colour token. */
	color?: DropdownOptionColor;
}

const BADGE_STYLE: Record<DropdownOptionColor, { bg: string; border: string; text: string }> = {
	default: { bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.25)', text: '#94a3b8' },
	green: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.25)', text: '#4ade80' },
	emerald: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)', text: '#34d399' },
	yellow: { bg: 'rgba(234,179,8,0.1)', border: 'rgba(234,179,8,0.25)', text: '#facc15' },
	amber: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)', text: '#fbbf24' },
	red: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)', text: '#f87171' },
	rose: { bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.25)', text: '#fb7185' },
	blue: { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)', text: '#60a5fa' },
	indigo: { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.25)', text: '#818cf8' },
	purple: { bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.25)', text: '#c084fc' },
	cyan: { bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.25)', text: '#22d3ee' },
	sky: { bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.25)', text: '#38bdf8' },
	orange: { bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.25)', text: '#fb923c' },
	teal: { bg: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.25)', text: '#2dd4bf' },
};

/**
 * Factory — returns a badge renderer for a fixed set of enum options.
 * Each option can declare a semantic `color`.
 *
 * Create **once outside the component** for stable identity.
 *
 * @example
 * ```ts
 * const StatusRenderer = createDropdownCellRenderer([
 *   { value: 'Active',   color: 'emerald' },
 *   { value: 'Pending',  color: 'amber'   },
 *   { value: 'Inactive', color: 'default' },
 * ]);
 * ```
 */
export function createDropdownCellRenderer(options: DropdownOption[]) {
	const map = new Map(options.map((o) => [o.value, o]));

	const Renderer = memo(function DropdownCellRenderer({ value }: CellRendererProps<any>) {
		const opt = map.get(String(value ?? ''));
		if (!opt) return <span style={{ color: T.textMuted, fontSize: 11, fontStyle: 'italic' }}>—</span>;

		const { bg, border, text } = BADGE_STYLE[opt.color ?? 'default'];
		return (
			<span
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					padding: '2px 8px',
					borderRadius: 4,
					fontSize: 10,
					fontWeight: 700,
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
					border: `1px solid ${border}`,
					background: bg,
					color: text,
					lineHeight: '16px',
					userSelect: 'none',
				}}
			>
				{opt.label ?? opt.value}
			</span>
		);
	});
	Renderer.displayName = 'DropdownCellRenderer';
	return Renderer;
}

/**
 * Factory — returns a styled `<select>` editor for a fixed option set.
 * Commits on change or blur, cancels on Escape.
 *
 * Create **once outside the component** for stable identity.
 */
export function createDropdownCellEditor(options: DropdownOption[]) {
	ensureStyles();

	function DropdownEditor({ value, onCommit, onCancel }: CellEditorProps<any>) {
		return (
			<select
				autoFocus
				defaultValue={String(value ?? '')}
				onChange={(e) => onCommit(e.target.value)}
				onBlur={(e) => onCommit(e.target.value)}
				onMouseDown={(e) => e.stopPropagation()}
				onDoubleClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === 'Escape') onCancel();
					e.stopPropagation();
				}}
				style={{
					position: 'absolute',
					inset: 0,
					width: '100%',
					height: '100%',
					padding: '0 10px',
					fontSize: 12,
					fontWeight: 600,
					background: T.bg,
					color: T.text,
					border: `2px solid ${T.borderFocus}`,
					borderRadius: 0,
					outline: 'none',
					cursor: 'pointer',
					boxSizing: 'border-box',
					zIndex: 20,
					colorScheme: 'dark',
				}}
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label ?? opt.value}
					</option>
				))}
			</select>
		);
	}
	DropdownEditor.displayName = 'DropdownCellEditor';
	return DropdownEditor;
}

// ─── 5. Number ────────────────────────────────────────────────────────────────

export interface NumberCellRendererOptions {
	/** String prepended before the number (e.g. `'$'`). */
	prefix?: string;
	/** String appended after the number (e.g. `' yrs'`). */
	suffix?: string;
	/** Fixed decimal places. Omit to use the raw string value. */
	decimals?: number;
	/** Use `toLocaleString` formatting (thousands separator etc). */
	locale?: boolean;
}

/**
 * Factory — returns a number renderer with optional formatting.
 *
 * @example
 * ```ts
 * const YearsRenderer = createNumberCellRenderer({ suffix: ' yrs' });
 * const PriceRenderer  = createNumberCellRenderer({ prefix: '$', decimals: 2, locale: true });
 * ```
 */
export function createNumberCellRenderer(opts: NumberCellRendererOptions = {}) {
	const { prefix = '', suffix = '', decimals, locale = false } = opts;

	const Renderer = memo(function NumberCellRenderer({ value }: CellRendererProps<any>) {
		const num = parseFloat(String(value));
		if (isNaN(num)) return <span style={{ color: T.textMuted, fontSize: 11, fontStyle: 'italic' }}>—</span>;

		let formatted: string;
		if (decimals !== undefined) {
			formatted = locale ? num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : num.toFixed(decimals);
		} else {
			formatted = locale ? num.toLocaleString() : String(num);
		}

		return (
			<span
				style={{
					fontFamily: 'ui-monospace, monospace',
					fontSize: 11,
					color: T.text,
					letterSpacing: '0.02em',
				}}
			>
				{prefix}
				{formatted}
				{suffix}
			</span>
		);
	});
	Renderer.displayName = 'NumberCellRenderer';
	return Renderer;
}

export interface NumberCellEditorOptions {
	min?: number;
	max?: number;
	step?: number;
	prefix?: string;
	suffix?: string;
	decimals?: number;
}

/**
 * Factory — returns a number editor with stepper buttons and optional bounds.
 *
 * @example
 * ```ts
 * const YearsEditor = createNumberCellEditor({ min: 0, max: 80 });
 * const PriceEditor  = createNumberCellEditor({ min: 0, step: 0.01, prefix: '$', decimals: 2 });
 * ```
 */
export function createNumberCellEditor(opts: NumberCellEditorOptions = {}) {
	ensureStyles();
	const { min, max, step = 1, prefix, suffix } = opts;

	function NumberEditor({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) {
		const [localVal, setLocalVal] = useState(String(value ?? ''));

		const commit = (v: string) => {
			const num = parseFloat(v);
			const final = isNaN(num) ? v : String(num);
			onCommit(final);
		};

		const update = (v: string) => {
			setLocalVal(v);
			onChange(v);
		};

		const step_ = (delta: number) => {
			const cur = parseFloat(localVal) || 0;
			const prec = (step.toString().split('.')[1] ?? '').length;
			let next = parseFloat((cur + delta).toFixed(prec));
			if (min !== undefined) next = Math.max(min, next);
			if (max !== undefined) next = Math.min(max, next);
			update(String(next));
		};

		return (
			<div
				style={{
					position: 'absolute',
					inset: 0,
					display: 'flex',
					alignItems: 'center',
					background: T.bg,
					border: `2px solid ${T.borderFocus}`,
					boxSizing: 'border-box',
					overflow: 'hidden',
					zIndex: 20,
				}}
				onMouseDown={(e) => e.stopPropagation()}
				onDoubleClick={(e) => e.stopPropagation()}
			>
				{prefix && (
					<span
						style={{
							paddingLeft: 10,
							fontSize: 11,
							color: T.textMuted,
							fontFamily: 'ui-monospace, monospace',
							flexShrink: 0,
							userSelect: 'none',
						}}
					>
						{prefix}
					</span>
				)}

				<input
					autoFocus
					className='og-ct-number-input'
					type='number'
					value={localVal}
					min={min}
					max={max}
					step={step}
					onChange={(e) => update(e.target.value)}
					onBlur={() => commit(localVal)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') commit(localVal);
						if (e.key === 'Escape') onCancel();
						if (e.key === 'ArrowUp') {
							e.preventDefault();
							step_(step);
						}
						if (e.key === 'ArrowDown') {
							e.preventDefault();
							step_(-step);
						}
						e.stopPropagation();
					}}
					style={{
						flex: 1,
						minWidth: 0,
						paddingLeft: prefix ? 4 : 10,
						paddingRight: suffix ? 4 : 2,
						fontSize: 12,
						fontFamily: 'ui-monospace, monospace',
						background: 'transparent',
						border: 'none',
						outline: 'none',
						color: T.text,
						letterSpacing: '0.02em',
					}}
				/>

				{suffix && (
					<span
						style={{
							paddingRight: 4,
							fontSize: 11,
							color: T.textMuted,
							fontFamily: 'ui-monospace, monospace',
							flexShrink: 0,
							userSelect: 'none',
						}}
					>
						{suffix}
					</span>
				)}

				{/* Stepper */}
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignSelf: 'stretch',
						borderLeft: `1px solid ${T.border}`,
						flexShrink: 0,
					}}
				>
					{[step, -step].map((delta, i) => (
						<button
							key={i}
							className='og-ct-step'
							tabIndex={-1}
							onMouseDown={(e) => {
								e.stopPropagation();
								e.preventDefault();
								step_(delta);
							}}
							style={{
								flex: 1,
								width: 22,
								border: 'none',
								background: 'transparent',
								cursor: 'pointer',
								color: T.textMuted,
								fontSize: 8,
								lineHeight: 1,
								borderBottom: i === 0 ? `1px solid ${T.border}` : 'none',
								padding: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								transition: 'background 0.08s, color 0.08s',
							}}
							aria-label={delta > 0 ? 'Increment' : 'Decrement'}
						>
							{delta > 0 ? '▲' : '▼'}
						</button>
					))}
				</div>
			</div>
		);
	}
	NumberEditor.displayName = 'NumberCellEditor';
	return NumberEditor;
}

// ─── 6. Tags (read-only display) ──────────────────────────────────────────────

/**
 * Read-only renderer for a static set of tags / labels stored as a
 * comma-separated string. No editing. Useful for metadata columns.
 *
 * Use `createMultiSelectCellRenderer` + `createMultiSelectCellEditor` when you
 * need the full interactive multi-select experience.
 */
export const TagsCellRenderer = MultiSelectCellRenderer;

// ─── Column type registry ─────────────────────────────────────────────────────

import type { ColumnDef } from '../types.js';

export interface ColumnTypeDefinition<TRowData = unknown> {
	renderer?: ColumnDef<TRowData>['renderer'];
	cellEditor?: ColumnDef<TRowData>['cellEditor'];
}

// Singleton instances for built-in types — created once at module load, never re-created.
const _numberRenderer = createNumberCellRenderer();
const _numberEditor = createNumberCellEditor();

export const BUILTIN_COLUMN_TYPES: Record<string, ColumnTypeDefinition<any>> = {
	checkbox: {
		renderer: { kind: 'react', component: CheckboxCellRenderer },
	},
	date: {
		renderer: { kind: 'react', component: DateCellRenderer },
		cellEditor: DateCellEditor,
	},
	number: {
		renderer: { kind: 'react', component: _numberRenderer },
		cellEditor: _numberEditor,
	},
};

// ─── Column type helpers ──────────────────────────────────────────────────────

/**
 * Creates a column type definition for a number column.
 * Pass a single options object — fields overlap between renderer and editor.
 *
 * @example
 * ```ts
 * columnTypes: { 'usd': numberColumnType({ prefix: '$', decimals: 2, locale: true }) }
 * ```
 */
export function numberColumnType(opts?: NumberCellRendererOptions & NumberCellEditorOptions): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'react', component: createNumberCellRenderer(opts) },
		cellEditor: createNumberCellEditor(opts),
	};
}

/**
 * Creates a column type definition for a multi-select column.
 *
 * @example
 * ```ts
 * columnTypes: { 'skills': multiSelectColumnType(['React', 'TypeScript', 'Node']) }
 * ```
 */
export function multiSelectColumnType(options: string[], maxVisible = 2): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'react', component: createMultiSelectCellRenderer(options, maxVisible) },
		cellEditor: createMultiSelectCellEditor(options),
	};
}

/**
 * Creates a column type definition for a dropdown / enum-badge column.
 *
 * @example
 * ```ts
 * columnTypes: {
 *   'status': dropdownColumnType([
 *     { value: 'Active',  color: 'emerald' },
 *     { value: 'Pending', color: 'amber'   },
 *   ])
 * }
 * ```
 */
export function dropdownColumnType(options: DropdownOption[]): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'react', component: createDropdownCellRenderer(options) },
		cellEditor: createDropdownCellEditor(options),
	};
}
