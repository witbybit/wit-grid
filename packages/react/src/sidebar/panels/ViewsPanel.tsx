import React, { useEffect, useRef, useState } from 'react';
import type { GridApi, GridViewDefinition, GridWorkspaceState, PersistenceStatus } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const SaveIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M2 1h7l2 2v8a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z' />
		<path d='M4 1v3h5V1' />
		<rect x='3' y='7' width='6' height='4' rx='0.5' />
	</svg>
);

const ViewsIcon = () => (
	<svg width='14' height='14' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='1.5' y='1.5' width='12' height='12' rx='2' />
		<path d='M1.5 5.5h12' />
		<path d='M5.5 5.5v8' />
	</svg>
);

const ApplyIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M2 6l3 3 5-5' />
	</svg>
);

const EditIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M8.5 1.5l2 2-7 7H1.5v-2l7-7z' />
	</svg>
);

const CopyIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='4' y='4' width='7' height='7' rx='1' />
		<path d='M1 8V2a1 1 0 011-1h6' />
	</svg>
);

const TrashIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M1.5 3h9M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M10 3l-.7 7.5A1 1 0 018.3 11H3.7a1 1 0 01-1-.5L2 3' />
	</svg>
);

const StarIcon = ({ filled }: { filled: boolean }) => (
	<svg
		width='12'
		height='12'
		viewBox='0 0 12 12'
		fill={filled ? 'currentColor' : 'none'}
		stroke='currentColor'
		strokeWidth='1.4'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M6 1l1.4 2.9 3.1.4-2.3 2.2.6 3.2L6 8.2l-2.8 1.5.6-3.2L1.5 4.3l3.1-.4L6 1z' />
	</svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const SUCCESS = '#22c55e';
const WARN = '#f59e0b';

function makeIconBtnStyle(color: string, hoverBg?: string): React.CSSProperties {
	return {
		width: 22,
		height: 22,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 4,
		border: 'none',
		background: hoverBg ?? 'transparent',
		cursor: 'pointer',
		color,
		padding: 0,
		flexShrink: 0,
	};
}

// ── Sub-components ────────────────────────────────────────────────────────────

import type { ThemeTokens } from '@eregister/wit-grid-core';

function SectionHeader({ label, theme }: { label: string; theme: ThemeTokens }) {
	return (
		<div
			style={{
				fontSize: 9,
				fontWeight: 700,
				letterSpacing: '0.08em',
				textTransform: 'uppercase',
				color: theme.headerText,
				padding: '10px 12px 6px',
			}}
		>
			{label}
		</div>
	);
}

function ToggleRow({
	icon,
	label,
	description,
	checked,
	onChange,
	theme,
}: {
	icon: React.ReactNode;
	label: string;
	description: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	theme: ThemeTokens;
}) {
	return (
		<div
			onClick={() => onChange(!checked)}
			title={description}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 7,
				padding: '5px 6px',
				borderRadius: 5,
				cursor: 'pointer',
				background: checked ? theme.selectionBg : 'transparent',
				border: checked ? `1px solid ${theme.selectionBorder}` : '1px solid transparent',
				transition: 'background 0.1s, border-color 0.1s',
				userSelect: 'none',
			}}
		>
			<span style={{ color: checked ? theme.focusRing : '#64748b', display: 'flex', flexShrink: 0 }}>{icon}</span>
			<span style={{ flex: 1, fontSize: 10, fontWeight: 600, color: checked ? theme.focusRing : '#64748b' }}>{label}</span>
			<div
				style={{
					width: 28,
					height: 15,
					borderRadius: 999,
					background: checked ? theme.focusRing : 'rgba(30,41,59,0.8)',
					border: checked ? `1px solid ${theme.focusRing}` : '1px solid rgba(51,65,85,0.8)',
					position: 'relative',
					flexShrink: 0,
					transition: 'background 0.15s, border-color 0.15s',
				}}
			>
				<div
					style={{
						position: 'absolute',
						top: 2,
						left: checked ? 14 : 2,
						width: 9,
						height: 9,
						borderRadius: '50%',
						background: checked ? '#fff' : '#475569',
						transition: 'left 0.15s',
					}}
				/>
			</div>
		</div>
	);
}

function PersistenceStatusBadge({ status }: { status: PersistenceStatus }) {
	let color: string;
	let label: string;
	if (!status.autoSave) {
		color = '#64748b';
		label = 'Off';
	} else if (status.status === 'saving') {
		color = WARN;
		label = 'Saving…';
	} else if (status.status === 'saved') {
		color = SUCCESS;
		label = 'Saved';
	} else if (status.status === 'error') {
		color = '#f87171';
		label = 'Error';
	} else {
		color = SUCCESS;
		label = 'Auto-save on';
	}
	return (
		<span
			style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color, fontWeight: 600 }}
			title={status.status === 'error' ? String(status.error) : undefined}
		>
			<span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0, transition: 'background 0.2s' }} />
			{label}
		</span>
	);
}

// ── ViewRow ───────────────────────────────────────────────────────────────────

interface ViewRowProps {
	view: GridViewDefinition;
	isActive: boolean;
	isDefault: boolean;
	onApply: () => void;
	onRename: (name: string) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onSetDefault: () => void;
	theme: ThemeTokens;
}

function ViewRow({ view, isActive, isDefault, onApply, onRename, onDuplicate, onDelete, onSetDefault, theme }: ViewRowProps) {
	const [renaming, setRenaming] = useState(false);
	const [nameInput, setNameInput] = useState(view.name);
	const [deleteConfirm, setDeleteConfirm] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (renaming && inputRef.current) inputRef.current.focus();
	}, [renaming]);

	useEffect(() => {
		return () => {
			if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
		};
	}, []);

	const commitRename = () => {
		const trimmed = nameInput.trim();
		if (trimmed && trimmed !== view.name) onRename(trimmed);
		else setNameInput(view.name);
		setRenaming(false);
	};

	const handleDelete = () => {
		if (!deleteConfirm) {
			setDeleteConfirm(true);
			deleteTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000);
			return;
		}
		if (deleteTimerRef.current) {
			clearTimeout(deleteTimerRef.current);
			deleteTimerRef.current = null;
		}
		onDelete();
	};

	const isSystem = view.scope === 'system';

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 4,
				padding: '5px 8px 5px 12px',
				background: isActive ? theme.selectionBg : 'transparent',
				borderLeft: isActive ? `2px solid ${theme.focusRing}` : '2px solid transparent',
				transition: 'background 0.1s',
			}}
		>
			{renaming ? (
				<input
					ref={inputRef}
					value={nameInput}
					onChange={(e) => setNameInput(e.target.value)}
					onBlur={commitRename}
					onKeyDown={(e) => {
						if (e.key === 'Enter') commitRename();
						if (e.key === 'Escape') {
							setNameInput(view.name);
							setRenaming(false);
						}
					}}
					style={{
						flex: 1,
						height: 22,
						fontSize: 11,
						fontWeight: 500,
						background: theme.headerBg,
						border: `1px solid ${theme.selectionBorder}`,
						borderRadius: 4,
						color: theme.textColor,
						padding: '0 6px',
						outline: 'none',
					}}
				/>
			) : (
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						style={{
							fontSize: 11,
							fontWeight: isActive ? 600 : 500,
							color: isActive ? theme.focusRing : theme.textColor,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						{view.name}
					</div>
					{view.scope !== 'personal' && (
						<div style={{ fontSize: 9, color: theme.headerText, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{view.scope}</div>
					)}
				</div>
			)}

			<button
				title={isDefault ? 'Default view' : 'Set as default'}
				onClick={onSetDefault}
				disabled={isSystem}
				style={{ ...makeIconBtnStyle(isDefault ? '#f59e0b' : theme.headerText), opacity: isSystem ? 0.4 : 1 }}
			>
				<StarIcon filled={isDefault} />
			</button>

			{!renaming && (
				<button title='Apply view' onClick={onApply} style={makeIconBtnStyle(isActive ? theme.focusRing : theme.headerText)}>
					<ApplyIcon />
				</button>
			)}

			{!isSystem && (
				<>
					{!renaming && (
						<button title='Rename' onClick={() => setRenaming(true)} style={makeIconBtnStyle(theme.headerText)}>
							<EditIcon />
						</button>
					)}
					<button title='Duplicate' onClick={onDuplicate} style={makeIconBtnStyle(theme.headerText)}>
						<CopyIcon />
					</button>
					<button
						title={deleteConfirm ? 'Click again to confirm delete' : 'Delete view'}
						onClick={handleDelete}
						style={makeIconBtnStyle(deleteConfirm ? '#f87171' : theme.headerText)}
					>
						<TrashIcon />
					</button>
				</>
			)}
		</div>
	);
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface ViewsPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function ViewsPanel({ api, onClose }: ViewsPanelProps) {
	useGridKeySelector('themeName', (s) => s.themeName);
	const theme = api.getTheme();

	const hasWorkspace = api.hasWorkspace();
	const hasPersistence = api.hasPersistence();

	const [wsState, setWsState] = useState<GridWorkspaceState>(() => api.getWorkspaceState());
	useEffect(() => {
		if (!hasWorkspace) return;
		return api.subscribeToWorkspaceState(setWsState);
	}, [api, hasWorkspace]);

	const [persistStatus, setPersistStatus] = useState<PersistenceStatus>(() => api.getPersistenceStatus());
	useEffect(() => {
		if (!hasPersistence) return;
		return api.subscribeToPersistenceStatus(setPersistStatus);
	}, [api, hasPersistence]);

	// Save-new form state
	const [savingNew, setSavingNew] = useState(false);
	const [newViewName, setNewViewName] = useState('');
	const saveInputRef = useRef<HTMLInputElement>(null);
	const [clearConfirm, setClearConfirm] = useState(false);
	const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
		};
	}, []);

	useEffect(() => {
		if (savingNew && saveInputRef.current) saveInputRef.current.focus();
	}, [savingNew]);

	const handleSaveNew = async () => {
		const trimmed = newViewName.trim();
		if (!trimmed) return;
		await api.saveView(trimmed).catch(console.error);
		setNewViewName('');
		setSavingNew(false);
	};

	const handleClearPersistence = () => {
		if (!clearConfirm) {
			setClearConfirm(true);
			clearTimerRef.current = setTimeout(() => setClearConfirm(false), 3000);
			return;
		}
		if (clearTimerRef.current) {
			clearTimeout(clearTimerRef.current);
			clearTimerRef.current = null;
		}
		const result = api.clearPersistedState();
		if (result instanceof Promise) result.catch(console.error);
		setClearConfirm(false);
	};

	const activeViewId = wsState.activeViewId;
	const defaultViewId = wsState.defaultViewId;
	const views = wsState.views;

	const activeView = activeViewId ? (views.find((v) => v.id === activeViewId) ?? null) : null;

	const lastSavedText = persistStatus.lastSavedAt
		? new Date(persistStatus.lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
		: null;

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.bgColor, color: theme.textColor }}>
			{/* Panel header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '14px 14px 12px',
					background: theme.headerBg,
					borderBottom: `1px solid ${theme.borderColor}`,
					flexShrink: 0,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<ViewsIcon />
					<span style={{ fontSize: 12, fontWeight: 700, color: theme.textColor }}>Views</span>
					{wsState.dirty && (
						<span
							style={{
								fontSize: 9,
								fontWeight: 700,
								color: WARN,
								background: 'rgba(245,158,11,0.12)',
								border: '1px solid rgba(245,158,11,0.3)',
								borderRadius: 3,
								padding: '1px 5px',
							}}
						>
							UNSAVED
						</span>
					)}
				</div>
				<button onClick={onClose} style={{ ...makeIconBtnStyle(theme.headerText), flexShrink: 0 }}>
					<CloseIcon />
				</button>
			</div>

			<div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
				{/* ── Active view section ──────────────────────────────── */}
				{hasWorkspace && (
					<>
						<SectionHeader label='Active View' theme={theme} />
						<div style={{ padding: '0 12px 8px' }}>
							<div
								style={{
									background: theme.headerBg,
									border: `1px solid ${theme.borderColor}`,
									borderRadius: 6,
									padding: '8px 10px',
								}}
							>
								<div style={{ fontSize: 12, fontWeight: 600, color: theme.textColor, marginBottom: 6 }}>
									{activeView ? activeView.name : 'Unsaved'}
								</div>

								<div style={{ display: 'flex', gap: 5 }}>
									{activeView && activeView.scope !== 'system' && (
										<button
											onClick={() => api.updateView(activeView.id).catch(console.error)}
											title='Update current view with the current grid state'
											style={{
												flex: 1,
												height: 24,
												fontSize: 10,
												fontWeight: 600,
												borderRadius: 4,
												border: `1px solid ${theme.selectionBorder}`,
												background: theme.selectionBg,
												color: theme.focusRing,
												cursor: 'pointer',
											}}
										>
											Update
										</button>
									)}
									<button
										onClick={() => setSavingNew(true)}
										title='Save current grid state as a new view'
										style={{
											flex: 1,
											height: 24,
											fontSize: 10,
											fontWeight: 600,
											borderRadius: 4,
											border: `1px solid ${theme.selectionBorder}`,
											background: theme.selectionBg,
											color: theme.focusRing,
											cursor: 'pointer',
										}}
									>
										Save as new
									</button>
									{activeView && (
										<button
											onClick={() => api.applyView(activeView.id).catch(console.error)}
											title='Discard unsaved changes and revert to the active view'
											style={{
												flex: 1,
												height: 24,
												fontSize: 10,
												fontWeight: 600,
												borderRadius: 4,
												border: '1px solid rgba(30,41,59,0.8)',
												background: 'rgba(180,190,213,0.5)',
												color: theme.headerText,
												cursor: 'pointer',
											}}
										>
											Reset
										</button>
									)}
								</div>

								{savingNew && (
									<div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
										<input
											ref={saveInputRef}
											value={newViewName}
											onChange={(e) => setNewViewName(e.target.value)}
											placeholder='View name…'
											onKeyDown={(e) => {
												if (e.key === 'Enter') handleSaveNew();
												if (e.key === 'Escape') {
													setSavingNew(false);
													setNewViewName('');
												}
											}}
											style={{
												flex: 1,
												height: 24,
												fontSize: 11,
												background: theme.bgColor,
												border: `1px solid ${theme.selectionBorder}`,
												borderRadius: 4,
												color: theme.textColor,
												padding: '0 8px',
												outline: 'none',
											}}
										/>
										<button
											onClick={handleSaveNew}
											disabled={!newViewName.trim()}
											style={{
												height: 24,
												padding: '0 10px',
												fontSize: 10,
												fontWeight: 600,
												borderRadius: 4,
												border: `1px solid ${theme.selectionBorder}`,
												background: newViewName.trim() ? theme.focusRing : theme.selectionBg,
												color: newViewName.trim() ? '#fff' : theme.headerText,
												cursor: newViewName.trim() ? 'pointer' : 'not-allowed',
											}}
										>
											Save
										</button>
										<button
											onClick={() => {
												setSavingNew(false);
												setNewViewName('');
											}}
											style={{
												height: 24,
												padding: '0 8px',
												fontSize: 10,
												fontWeight: 600,
												borderRadius: 4,
												border: '1px solid rgba(30,41,59,0.8)',
												background: 'transparent',
												color: theme.headerText,
												cursor: 'pointer',
											}}
										>
											Cancel
										</button>
									</div>
								)}
							</div>
						</div>

						{/* ── Saved views list ─────────────────────────────── */}
						<SectionHeader label={`Saved Views${views.length > 0 ? ` (${views.length})` : ''}`} theme={theme} />
						{wsState.loading ? (
							<div style={{ padding: '8px 12px', fontSize: 11, color: theme.headerText }}>Loading…</div>
						) : views.length === 0 ? (
							<div style={{ padding: '8px 12px', fontSize: 11, color: theme.headerText }}>No saved views yet.</div>
						) : (
							<div style={{ display: 'flex', flexDirection: 'column' }}>
								{[...views].map((view) => (
									<ViewRow
										key={view.id}
										view={view}
										isActive={view.id === activeViewId}
										isDefault={view.id === defaultViewId}
										onApply={() => api.applyView(view.id).catch(console.error)}
										onRename={(name) => api.renameView(view.id, name).catch(console.error)}
										onDuplicate={() => {
											const base = view.name.replace(/ \(\d+\)$/, '');
											const count = views.filter((v) => v.name.startsWith(base)).length;
											api.duplicateView(view.id, `${base} (${count + 1})`).catch(console.error);
										}}
										onDelete={() => api.deleteView(view.id).catch(console.error)}
										onSetDefault={() => api.setDefaultView(view.id === defaultViewId ? null : view.id).catch(console.error)}
										theme={theme}
									/>
								))}
							</div>
						)}

						{wsState.lastError && (
							<div
								style={{
									margin: '0 12px 8px',
									padding: '6px 8px',
									borderRadius: 5,
									background: 'rgba(239,68,68,0.08)',
									border: '1px solid rgba(239,68,68,0.25)',
									fontSize: 10,
									color: '#f87171',
								}}
							>
								{wsState.lastError}
							</div>
						)}
					</>
				)}

				{/* ── Persistence controls ─────────────────────────────── */}
				{hasPersistence && (
					<>
						<div style={{ borderTop: `1px solid ${theme.borderColor}`, marginTop: hasWorkspace ? 8 : 0 }} />
						<div style={{ padding: '8px 12px 10px' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
								<SaveIcon />
								<span
									style={{
										fontSize: 9,
										fontWeight: 700,
										letterSpacing: '0.08em',
										textTransform: 'uppercase',
										color: theme.headerText,
									}}
								>
									Saved Settings
								</span>
								<PersistenceStatusBadge status={persistStatus} />
							</div>

							<ToggleRow
								icon={<SaveIcon />}
								label='Auto-save'
								description='Automatically save settings after each change'
								checked={persistStatus.autoSave}
								onChange={(v) => api.setAutoSave(v)}
								theme={theme}
							/>

							{lastSavedText && (
								<div style={{ fontSize: 10, color: theme.headerText, margin: '4px 0 0', paddingLeft: 2 }}>
									Last saved {lastSavedText}
								</div>
							)}
							{persistStatus.status === 'error' && (
								<div style={{ fontSize: 10, color: '#f87171', margin: '4px 0 0', paddingLeft: 2 }}>
									Error: {String(persistStatus.error)}
								</div>
							)}

							<div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
								<button
									onClick={() => api.saveNow()}
									style={{
										flex: 1,
										height: 26,
										fontSize: 10,
										fontWeight: 600,
										letterSpacing: '0.04em',
										borderRadius: 5,
										border: `1px solid ${theme.selectionBorder}`,
										background: theme.selectionBg,
										color: theme.focusRing,
										cursor: 'pointer',
										transition: 'all 0.15s',
									}}
								>
									Save now
								</button>
								<button
									onClick={handleClearPersistence}
									style={{
										flex: 1,
										height: 26,
										fontSize: 10,
										fontWeight: 600,
										letterSpacing: '0.04em',
										borderRadius: 5,
										border: clearConfirm ? `1px solid rgba(239,68,68,0.5)` : `1px solid rgba(30,41,59,0.8)`,
										background: clearConfirm ? 'rgba(239,68,68,0.12)' : 'rgba(180, 190, 213, 0.5)',
										color: clearConfirm ? '#f87171' : theme.focusRing,
										cursor: 'pointer',
										transition: 'all 0.15s',
									}}
								>
									{clearConfirm ? 'Confirm reset' : 'Reset settings'}
								</button>
							</div>
						</div>
					</>
				)}

				{!hasWorkspace && !hasPersistence && (
					<div style={{ padding: '20px 12px', textAlign: 'center' }}>
						<div style={{ fontSize: 11, color: theme.headerText, lineHeight: 1.6 }}>
							Configure a <code>workspace</code> or <code>persistence</code> adapter to use this panel.
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
