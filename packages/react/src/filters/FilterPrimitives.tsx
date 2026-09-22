/**
 * Shared primitive components used by all built-in filter types.
 * All components are theme-aware via ThemeTokens.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ThemeTokens } from '@eregister/wit-grid-core';
import type { FilterSelectOption } from '@eregister/wit-grid-core';

// ── FilterSearchInput ─────────────────────────────────────────────────────────

export function FilterSearchInput({
	value,
	onChange,
	placeholder,
	theme,
	autoFocus,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	theme: ThemeTokens;
	autoFocus?: boolean;
}) {
	const [focused, setFocused] = useState(false);
	return (
		<div style={{ padding: '6px 8px 4px', position: 'relative' }}>
			<div
				style={{
					position: 'absolute',
					left: 16,
					top: '50%',
					transform: 'translateY(-50%)',
					pointerEvents: 'none',
					color: theme.headerText,
					fontSize: 11,
					lineHeight: 1,
				}}
			>
				<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
					<circle cx='4.5' cy='4.5' r='3.5' />
					<line x1='7.5' y1='7.5' x2='10' y2='10' />
				</svg>
			</div>
			<input
				autoFocus={autoFocus}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				placeholder={placeholder ?? 'Search…'}
				style={{
					width: '100%',
					height: 26,
					paddingLeft: 24,
					paddingRight: 8,
					fontSize: 11,
					background: theme.headerBg,
					border: `1px solid ${focused ? theme.focusRing : theme.borderColor}`,
					borderRadius: 5,
					color: theme.textColor,
					outline: 'none',
					boxSizing: 'border-box',
					transition: 'border-color 0.12s',
				}}
			/>
		</div>
	);
}

// ── FilterSelectAll ───────────────────────────────────────────────────────────

export function FilterSelectAll({ onSelectAll, onClearAll, theme }: { onSelectAll: () => void; onClearAll: () => void; theme: ThemeTokens }) {
	return (
		<div style={{ display: 'flex', gap: 4, padding: '2px 8px 4px' }}>
			<button onClick={onSelectAll} style={chipBtnStyle(theme)}>
				Select all
			</button>
			<button onClick={onClearAll} style={chipBtnStyle(theme)}>
				Clear
			</button>
		</div>
	);
}

function chipBtnStyle(theme: ThemeTokens): React.CSSProperties {
	return {
		fontSize: 10,
		fontWeight: 600,
		color: theme.focusRing,
		background: theme.selectionBg,
		border: `1px solid ${theme.selectionBorder}`,
		borderRadius: 4,
		padding: '2px 7px',
		cursor: 'pointer',
	};
}

// ── FilterStatusBar ───────────────────────────────────────────────────────────

export function FilterStatusBar({
	loading,
	error,
	totalCount,
	shownCount,
	theme,
	emptyLabel,
	loadingLabel,
}: {
	loading?: boolean;
	error?: string | null;
	totalCount?: number;
	shownCount?: number;
	theme: ThemeTokens;
	emptyLabel?: string;
	loadingLabel?: string;
}) {
	if (loading) {
		return <div style={{ padding: '6px 10px', fontSize: 10, color: theme.headerText, fontStyle: 'italic' }}>{loadingLabel ?? 'Loading…'}</div>;
	}
	if (error) {
		return <div style={{ padding: '6px 10px', fontSize: 10, color: '#ef4444' }}>{error}</div>;
	}
	if (shownCount === 0) {
		return <div style={{ padding: '6px 10px', fontSize: 10, color: theme.headerText }}>{emptyLabel ?? 'No options'}</div>;
	}
	if (totalCount !== undefined && shownCount !== undefined && totalCount > shownCount) {
		return (
			<div style={{ padding: '2px 10px', fontSize: 10, color: theme.headerText }}>
				Showing {shownCount} of {totalCount}
			</div>
		);
	}
	return null;
}

// ── FilterOptionItem ──────────────────────────────────────────────────────────

export function FilterOptionItem<TValue>({
	option,
	checked,
	onToggle,
	theme,
	multi,
	isLast,
}: {
	option: FilterSelectOption<TValue>;
	checked: boolean;
	onToggle: (opt: FilterSelectOption<TValue>) => void;
	theme: ThemeTokens;
	multi: boolean;
	isLast: boolean;
}) {
	return (
		<label
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 7,
				padding: '5px 10px',
				cursor: option.disabled ? 'default' : 'pointer',
				fontSize: 11,
				color: option.disabled ? theme.headerText : checked ? theme.textColor : theme.textColor,
				background: checked ? theme.selectionBg : 'transparent',
				borderBottom: isLast ? 'none' : `1px solid ${theme.borderColor}`,
				opacity: option.disabled ? 0.5 : 1,
				minHeight: 28,
			}}
		>
			<input
				type={multi ? 'checkbox' : 'radio'}
				checked={checked}
				disabled={option.disabled}
				onChange={() => !option.disabled && onToggle(option)}
				style={{ cursor: option.disabled ? 'default' : 'pointer', accentColor: theme.focusRing, flexShrink: 0 }}
			/>
			<span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
				<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
				{option.description && (
					<span style={{ fontSize: 10, color: theme.headerText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{option.description}
					</span>
				)}
			</span>
			{option.count !== undefined && (
				<span
					style={{
						fontSize: 10,
						fontWeight: 600,
						color: theme.headerText,
						background: theme.headerBg,
						border: `1px solid ${theme.borderColor}`,
						borderRadius: 10,
						padding: '0 5px',
						flexShrink: 0,
					}}
				>
					{option.count}
				</span>
			)}
		</label>
	);
}

// ── FilterOptionList ──────────────────────────────────────────────────────────

export function FilterOptionList<TValue>({
	options,
	selectedKeys,
	onToggle,
	theme,
	multi,
	maxHeight,
	onScrolledToBottom,
}: {
	options: FilterSelectOption<TValue>[];
	selectedKeys: Set<string>;
	onToggle: (opt: FilterSelectOption<TValue>) => void;
	theme: ThemeTokens;
	multi: boolean;
	maxHeight?: number;
	onScrolledToBottom?: () => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!onScrolledToBottom) return;
		const el = containerRef.current;
		if (!el) return;
		const handleScroll = () => {
			if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
				onScrolledToBottom?.();
			}
		};
		el.addEventListener('scroll', handleScroll, { passive: true });
		return () => el.removeEventListener('scroll', handleScroll);
	}, [onScrolledToBottom]);

	return (
		<div
			ref={containerRef}
			style={{
				overflowY: 'auto',
				maxHeight: maxHeight ?? 240,
				border: `1px solid ${theme.borderColor}`,
				borderRadius: 5,
				margin: '0 8px',
			}}
		>
			{options.map((opt, i) => {
				const key = optionKey(opt);
				return (
					<FilterOptionItem
						key={key}
						option={opt}
						checked={selectedKeys.has(key)}
						onToggle={onToggle}
						theme={theme}
						multi={multi}
						isLast={i === options.length - 1}
					/>
				);
			})}
		</div>
	);
}

export function optionKey<TValue>(opt: FilterSelectOption<TValue>): string {
	const v = opt.value;
	if (v === null || v === undefined) return '\0null';
	if (typeof v === 'string' || typeof v === 'number') return String(v);
	return JSON.stringify(v);
}

// ── LoadMoreButton ────────────────────────────────────────────────────────────

export function LoadMoreButton({ loading, onClick, theme }: { loading: boolean; onClick: () => void; theme: ThemeTokens }) {
	return (
		<div style={{ padding: '4px 8px 6px', textAlign: 'center' }}>
			<button
				onClick={onClick}
				disabled={loading}
				style={{
					fontSize: 10,
					fontWeight: 600,
					color: theme.focusRing,
					background: 'transparent',
					border: 'none',
					cursor: loading ? 'default' : 'pointer',
					opacity: loading ? 0.6 : 1,
				}}
			>
				{loading ? 'Loading…' : 'Load more'}
			</button>
		</div>
	);
}
