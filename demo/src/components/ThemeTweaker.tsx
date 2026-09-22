import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BUILT_IN_THEMES, BUILT_IN_THEME_ORDER, BUILT_IN_THEME_METADATA, type BuiltInThemeName, type ThemeTokens } from '@eregister/wit-grid-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TweakerApi {
	switchTheme(name: string): void;
	mergeTheme(partial: Partial<ThemeTokens>): void;
	getTheme(): ThemeTokens;
}

interface ThemeTweakerProps {
	api: TweakerApi | null;
}

// ── Color helpers ──────────────────────────────────────────────────────────────

function toHex(color: string | undefined): string {
	if (!color) return '#000000';
	if (color.startsWith('#')) {
		if (color.length === 4) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
		return color.slice(0, 7);
	}
	const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (m) return '#' + [m[1], m[2], m[3]].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('');
	return '#888888';
}

function parsePx(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const n = parseFloat(value);
	return isNaN(n) ? fallback : n;
}

// ── Token layout ───────────────────────────────────────────────────────────────

const COLOR_SECTIONS: { section: string; tokens: { key: keyof ThemeTokens; label: string }[] }[] = [
	{
		section: 'Base',
		tokens: [
			{ key: 'bgColor', label: 'Background' },
			{ key: 'textColor', label: 'Text' },
			{ key: 'borderColor', label: 'Border' },
		],
	},
	{
		section: 'Header',
		tokens: [
			{ key: 'headerBg', label: 'Header BG' },
			{ key: 'headerText', label: 'Header Text' },
		],
	},
	{
		section: 'Rows',
		tokens: [
			{ key: 'rowHoverBg', label: 'Row Hover' },
			{ key: 'cellBorder', label: 'Cell Border' },
		],
	},
	{
		section: 'Accent & Focus',
		tokens: [
			{ key: 'focusRing', label: 'Accent / Focus' },
			{ key: 'selectionBg', label: 'Selection Fill' },
			{ key: 'selectionBorder', label: 'Selection Border' },
		],
	},
	{
		section: 'Groups',
		tokens: [
			{ key: 'groupRowBg', label: 'Group Row BG' },
			{ key: 'groupBadgeBg', label: 'Badge BG' },
			{ key: 'groupBadgeText', label: 'Badge Text' },
		],
	},
	{
		section: 'Popovers',
		tokens: [
			{ key: 'popoverBg', label: 'Popover BG' },
			{ key: 'popoverText', label: 'Popover Text' },
			{ key: 'popoverItemHoverBg', label: 'Hover Item BG' },
		],
	},
	{
		section: 'Status',
		tokens: [{ key: 'error', label: 'Error' }],
	},
];

const FONT_FAMILIES = [
	{ label: 'Outfit / Inter (default)', value: "'Outfit', 'Inter', -apple-system, sans-serif" },
	{ label: 'Roboto / Segoe UI', value: "'Roboto', 'Segoe UI', -apple-system, sans-serif" },
	{ label: 'Inter', value: "'Inter', -apple-system, sans-serif" },
	{ label: 'System UI', value: 'system-ui, -apple-system, sans-serif' },
	{ label: 'JetBrains Mono', value: "'JetBrains Mono', 'Fira Code', monospace" },
	{ label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', serif" },
];

// ── Main component ─────────────────────────────────────────────────────────────

export function ThemeTweaker({ api }: ThemeTweakerProps) {
	const [activePreset, setActivePreset] = useState<BuiltInThemeName>('dark');
	const [tokens, setTokens] = useState<ThemeTokens>(() => ({ ...BUILT_IN_THEMES['dark'] }));

	const isDark = BUILT_IN_THEME_METADATA[activePreset]?.appearance === 'dark';

	// Palette derived from current tokens so the panel itself stays readable
	const p = {
		bg: isDark ? '#0d1117' : '#f8fafc',
		surface: isDark ? '#111827' : '#f1f5f9',
		surface2: isDark ? '#1a2233' : '#e8edf5',
		border: isDark ? '#1e2d45' : '#d1dae7',
		text: isDark ? '#e2e8f0' : '#1a202c',
		muted: isDark ? '#64748b' : '#64748b',
		accent: tokens.focusRing ?? '#3b82f6',
	};

	// Sync local tokens when api becomes available
	useEffect(() => {
		if (api) {
			try {
				const current = api.getTheme();
				if (current) setTokens({ ...current });
			} catch {}
		}
	}, [api]);

	const handlePreset = useCallback(
		(name: BuiltInThemeName) => {
			setActivePreset(name);
			const preset = BUILT_IN_THEMES[name];
			setTokens({ ...preset });
			api?.switchTheme(name);
		},
		[api]
	);

	const patch = useCallback(
		<K extends keyof ThemeTokens>(key: K, value: ThemeTokens[K]) => {
			setTokens((prev) => ({ ...prev, [key]: value }));
			api?.mergeTheme({ [key]: value } as Partial<ThemeTokens>);
		},
		[api]
	);

	const outerRadius = parsePx(tokens.outerBorderRadius, 8);
	const headerHeight = parsePx(tokens.leafHeaderHeight, 40);

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				background: p.bg,
				border: `1px solid ${p.border}`,
				borderRadius: 14,
				overflow: 'hidden',
				color: p.text,
				fontSize: 12,
				fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
			}}
		>
			{/* ── Header ── */}
			<div
				style={{
					padding: '14px 16px 12px',
					borderBottom: `1px solid ${p.border}`,
					background: p.surface,
				}}
			>
				<div
					style={{
						fontSize: 10,
						fontWeight: 700,
						letterSpacing: '0.1em',
						textTransform: 'uppercase',
						color: p.muted,
						marginBottom: 10,
					}}
				>
					Theme Studio
				</div>

				{/* Preset chips */}
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
					{BUILT_IN_THEME_ORDER.map((name) => {
						const meta = BUILT_IN_THEME_METADATA[name];
						const theme = BUILT_IN_THEMES[name];
						const isActive = activePreset === name;
						const accent = theme.focusRing ?? '#3b82f6';
						return (
							<button
								key={name}
								onClick={() => handlePreset(name)}
								title={meta.description}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 5,
									padding: '4px 10px',
									borderRadius: 6,
									border: `1px solid ${isActive ? accent : p.border}`,
									background: isActive ? `${accent}22` : 'transparent',
									color: isActive ? accent : p.muted,
									cursor: 'pointer',
									fontSize: 11,
									fontWeight: 600,
									transition: 'all 0.12s',
									outline: 'none',
								}}
							>
								<span
									style={{
										width: 7,
										height: 7,
										borderRadius: '50%',
										background: accent,
										display: 'inline-block',
										boxShadow: isActive ? `0 0 7px ${accent}99` : 'none',
										transition: 'box-shadow 0.12s',
									}}
								/>
								{meta.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* ── Scrollable body ── */}
			<div
				style={{
					flex: 1,
					overflowY: 'auto',
					padding: '14px 16px',
					display: 'flex',
					flexDirection: 'column',
					gap: 18,
				}}
			>
				{/* Shape & Layout */}
				<TweakSection title='Shape & Layout' palette={p}>
					<SliderRow
						label='Corner Radius'
						value={outerRadius}
						min={0}
						max={24}
						step={1}
						unit='px'
						accent={p.accent}
						palette={p}
						onChange={(v) => patch('outerBorderRadius', `${v}px`)}
					/>
					<SliderRow
						label='Header Height'
						value={headerHeight}
						min={28}
						max={64}
						step={2}
						unit='px'
						accent={p.accent}
						palette={p}
						onChange={(v) => {
							patch('leafHeaderHeight', `${v}px`);
						}}
					/>
				</TweakSection>

				{/* Typography */}
				<TweakSection title='Typography' palette={p}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
						<label style={{ fontSize: 11, color: p.muted, fontWeight: 500 }}>Font Family</label>
						<select
							value={FONT_FAMILIES.some((f) => f.value === tokens.fontFamily) ? tokens.fontFamily : ''}
							onChange={(e) => patch('fontFamily', e.target.value)}
							style={{
								background: p.surface2,
								border: `1px solid ${p.border}`,
								color: p.text,
								borderRadius: 6,
								padding: '5px 8px',
								fontSize: 11,
								cursor: 'pointer',
								outline: 'none',
								width: '100%',
							}}
						>
							{FONT_FAMILIES.map((f) => (
								<option key={f.value} value={f.value}>
									{f.label}
								</option>
							))}
						</select>
					</div>
				</TweakSection>

				{/* Color sections */}
				{COLOR_SECTIONS.map(({ section, tokens: sectionTokens }) => (
					<TweakSection key={section} title={section} palette={p}>
						{sectionTokens.map(({ key, label }) => (
							<ColorRow
								key={key}
								label={label}
								value={tokens[key] as string}
								palette={p}
								onChange={(v) => patch(key as keyof ThemeTokens, v as ThemeTokens[typeof key])}
							/>
						))}
					</TweakSection>
				))}

				{/* Skeleton tokens */}
				<TweakSection title='Skeleton Loading' palette={p}>
					<ColorRow label='Shimmer Start' value={tokens.skeletonStart} palette={p} onChange={(v) => patch('skeletonStart', v)} />
					<ColorRow label='Shimmer Mid' value={tokens.skeletonMid} palette={p} onChange={(v) => patch('skeletonMid', v)} />
					<SliderRow
						label='Skeleton Border Radius'
						value={parsePx(tokens.skeletonBorderRadius, 4)}
						min={0}
						max={12}
						step={1}
						unit='px'
						accent={p.accent}
						palette={p}
						onChange={(v) => patch('skeletonBorderRadius', `${v}px`)}
					/>
				</TweakSection>
			</div>
		</div>
	);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface Palette {
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	text: string;
	muted: string;
	accent: string;
}

function TweakSection({ title, palette: p, children }: { title: string; palette: Palette; children: React.ReactNode }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
			{/* Divider row with label */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<div style={{ flex: 1, height: 1, background: p.border }} />
				<span
					style={{
						fontSize: 9,
						fontWeight: 700,
						letterSpacing: '0.1em',
						textTransform: 'uppercase',
						color: p.muted,
						whiteSpace: 'nowrap',
					}}
				>
					{title}
				</span>
				<div style={{ flex: 1, height: 1, background: p.border }} />
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
		</div>
	);
}

function ColorRow({ label, value, palette: p, onChange }: { label: string; value: string | undefined; palette: Palette; onChange(v: string): void }) {
	const [text, setText] = useState(value ?? '');
	const prevValue = useRef(value);
	if (prevValue.current !== value) {
		prevValue.current = value;
		// sync text when controlled value changes (preset switch)
		if (text !== value) setText(value ?? '');
	}

	const hex = toHex(value);

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			<span style={{ flex: '0 0 92px', fontSize: 11, color: p.muted, fontWeight: 500 }}>{label}</span>

			{/* Swatch + native color picker overlay */}
			<div
				style={{
					position: 'relative',
					width: 26,
					height: 22,
					borderRadius: 5,
					overflow: 'hidden',
					border: `1px solid ${p.border}`,
					flexShrink: 0,
					cursor: 'pointer',
				}}
			>
				{/* Checkerboard for transparent colours */}
				<div
					style={{
						position: 'absolute',
						inset: 0,
						backgroundImage:
							'linear-gradient(45deg,#aaa 25%,transparent 25%),linear-gradient(-45deg,#aaa 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#aaa 75%),linear-gradient(-45deg,transparent 75%,#aaa 75%)',
						backgroundSize: '6px 6px',
						backgroundPosition: '0 0,0 3px,3px -3px,-3px 0',
					}}
				/>
				<div style={{ position: 'absolute', inset: 0, background: value ?? 'transparent', borderRadius: 4 }} />
				<input
					type='color'
					value={hex}
					onChange={(e) => {
						setText(e.target.value);
						onChange(e.target.value);
					}}
					style={{
						position: 'absolute',
						inset: 0,
						opacity: 0,
						cursor: 'pointer',
						width: '100%',
						height: '100%',
						padding: 0,
						border: 'none',
					}}
				/>
			</div>

			{/* Freeform text input (supports rgba, hex, etc.) */}
			<input
				type='text'
				value={text}
				onChange={(e) => setText(e.target.value)}
				onBlur={() => {
					if (text) onChange(text);
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && text) onChange(text);
				}}
				style={{
					flex: 1,
					background: p.surface2,
					border: `1px solid ${p.border}`,
					color: p.text,
					borderRadius: 5,
					padding: '3px 7px',
					fontSize: 10,
					fontFamily: "'JetBrains Mono','Fira Code',monospace",
					outline: 'none',
					minWidth: 0,
				}}
			/>
		</div>
	);
}

function SliderRow({
	label,
	value,
	min,
	max,
	step,
	unit,
	accent,
	palette: p,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	accent: string;
	palette: Palette;
	onChange(v: number): void;
}) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<span style={{ fontSize: 11, color: p.muted, fontWeight: 500 }}>{label}</span>
				<span style={{ fontSize: 11, color: p.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
					{value}
					{unit}
				</span>
			</div>
			<input
				type='range'
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				style={{ width: '100%', cursor: 'pointer', accentColor: accent }}
			/>
		</div>
	);
}
