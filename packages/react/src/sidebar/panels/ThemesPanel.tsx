import { BUILT_IN_THEME_METADATA, getBuiltInTheme } from '@eregister/wit-grid-core';
import React from 'react';
import type { GridApi } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';

interface ThemesPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

const SWATCH_KEYS = ['bgColor', 'headerBg', 'focusRing'] as const;

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const ThemeIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M7.5 1.5a6 6 0 1 0 6 6c0-.6-.1-1.1-.2-1.6a.9.9 0 0 0-1.3-.6 2.8 2.8 0 0 1-1.4.4 2.9 2.9 0 0 1-2.9-2.9c0-.5.1-1 .4-1.4A.9.9 0 0 0 7.5 1.5Z' />
	</svg>
);

export function ThemesPanel({ api, onClose }: ThemesPanelProps) {
	const themeName = useGridKeySelector('themeName', (state) => state.themeName);
	const theme = api.getTheme();
	const availableThemes = api.getAvailableThemes();

	return (
		<div
			style={{
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				background: theme.bgColor,
				color: theme.textColor,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '14px 14px 12px',
					background: theme.headerBg,
					borderBottom: `1px solid ${theme.borderColor}`,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<div
						style={{
							width: 28,
							height: 28,
							borderRadius: 9,
							display: 'grid',
							placeItems: 'center',
							background: theme.selectionBg,
							color: theme.focusRing,
							border: `1px solid ${theme.selectionBorder}`,
						}}
					>
						<ThemeIcon />
					</div>
					<div>
						<div style={{ fontSize: 14, fontWeight: 700 }}>Themes</div>
						<div style={{ fontSize: 11, color: theme.headerText }}>Built-in presets persisted with grid state.</div>
					</div>
				</div>
				<button
					onClick={onClose}
					aria-label='Close themes panel'
					style={{
						width: 28,
						height: 28,
						borderRadius: 8,
						border: `1px solid ${theme.borderColor}`,
						background: 'transparent',
						color: theme.headerText,
						display: 'grid',
						placeItems: 'center',
						cursor: 'pointer',
					}}
				>
					<CloseIcon />
				</button>
			</div>

			<div style={{ padding: 12, overflowY: 'auto', display: 'grid', gap: 10 }}>
				{availableThemes.map((id) => {
					const active = id === themeName;
					const meta = BUILT_IN_THEME_METADATA[id];
					const previewTheme = getBuiltInTheme(id);
					return (
						<button
							key={id}
							onClick={() => api.switchTheme(id)}
							style={{
								textAlign: 'left',
								borderRadius: 14,
								padding: 12,
								border: `1px solid ${active ? theme.focusRing : theme.borderColor}`,
								background: active ? theme.selectionBg : theme.headerBg,
								color: theme.textColor,
								cursor: 'pointer',
								display: 'grid',
								gap: 10,
							}}
						>
							<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
								<div>
									<div style={{ fontSize: 13, fontWeight: 700 }}>{meta.label}</div>
									<div style={{ fontSize: 11, color: theme.headerText }}>{meta.description}</div>
								</div>
								<div
									style={{
										fontSize: 10,
										fontWeight: 700,
										letterSpacing: 0.3,
										textTransform: 'uppercase',
										color: active ? theme.focusRing : theme.headerText,
									}}
								>
									{active ? 'Active' : meta.appearance}
								</div>
							</div>

							<div style={{ display: 'flex', gap: 8 }}>
								{SWATCH_KEYS.map((key) => {
									const preview = previewTheme[key];
									return (
										<span
											key={key}
											style={{
												height: 22,
												flex: 1,
												borderRadius: 999,
												background: preview,
												border: `1px solid ${theme.borderColor}`,
											}}
										/>
									);
								})}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
