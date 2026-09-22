import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GridApi, ColumnDef } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const GripIcon = () => (
	<svg width='10' height='14' viewBox='0 0 10 14' fill='currentColor'>
		<circle cx='3' cy='2.5' r='1.2' />
		<circle cx='7' cy='2.5' r='1.2' />
		<circle cx='3' cy='7' r='1.2' />
		<circle cx='7' cy='7' r='1.2' />
		<circle cx='3' cy='11.5' r='1.2' />
		<circle cx='7' cy='11.5' r='1.2' />
	</svg>
);

const EyeOpenIcon = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<path d='M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4Z' />
		<circle cx='7' cy='7' r='1.8' />
	</svg>
);

const EyeClosedIcon = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<path d='M1.5 1.5l11 11' />
		<path d='M5.5 5.6A2 2 0 008.4 8.5' />
		<path d='M3 3.7C1.8 4.7 1 6 1 6s2 4 6 4c.8 0 1.6-.2 2.3-.4' />
		<path d='M7 3c.4 0 .9.1 1.3.2C11 4 13 6 13 6s-.5.9-1.3 1.7' />
	</svg>
);

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const GroupIcon = () => (
	<svg width='13' height='13' viewBox='0 0 13 13' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='1' y='1' width='11' height='4' rx='1.2' />
		<rect x='3' y='8' width='7' height='4' rx='1.2' />
		<path d='M6.5 5v3' />
	</svg>
);

const FooterIcon = () => (
	<svg width='13' height='13' viewBox='0 0 13 13' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='1' y='1' width='11' height='11' rx='1.5' />
		<path d='M1 9h11' />
		<path d='M4 11V9' />
	</svg>
);

const StickyIcon = () => (
	<svg width='13' height='13' viewBox='0 0 13 13' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M1 3h11' />
		<path d='M1 6h7' />
		<path d='M1 9h5' />
		<path d='M10 7v5M8.5 10.5l1.5 1.5 1.5-1.5' />
	</svg>
);

const PinIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M8 1L11 4L7.5 7.5L7 10L5.5 8.5L3 11L2 10L4.5 7.5L3 6L6.5 5L8 1Z' />
	</svg>
);

const SearchIcon = () => (
	<svg width='13' height='13' viewBox='0 0 13 13' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<circle cx='5.8' cy='5.8' r='4.2' />
		<path d='M9 9l3 3' />
	</svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────
type ColumnViewMode = 'all' | 'groupable' | 'hidden';

// ── Component ─────────────────────────────────────────────────────────────────

interface ColumnsPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

// Stable fallback so useSyncExternalStore never sees a new reference when groupBy is undefined.
const EMPTY_GROUP_BY: string[] = [];

export function ColumnsPanel({ api, onClose }: ColumnsPanelProps) {
	const stateColumns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const stateGroupBy = useGridKeySelector<string[] | undefined>('groupBy', (s) => (s.groupBy ? [...s.groupBy] : undefined));
	const showGroupFooter = useGridKeySelector<boolean>('showGroupFooter', (s) => !!s.showGroupFooter);
	const enableStickyGroupRows = useGridKeySelector<boolean>('enableStickyGroupRows', (s) => !!s.enableStickyGroupRows);
	// Subscribe to themeName so the panel re-renders when the theme changes.
	useGridKeySelector('themeName', (s) => s.themeName);
	const theme = api.getTheme();

	const allCols = api.getColumns();
	const groupBy: string[] = stateGroupBy ?? EMPTY_GROUP_BY;
	const visibleCount = allCols.filter((c) => !c.hide).length;

	const [columnQuery, setColumnQuery] = useState('');
	const [columnView, setColumnView] = useState<ColumnViewMode>('all');
	// Drag-to-reorder for column list
	const dragFromIdx = useRef<number | null>(null);
	const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

	// Drag-to-reorder for group pills
	const groupDragFromIdx = useRef<number | null>(null);
	const [groupDropTargetIdx, setGroupDropTargetIdx] = useState<number | null>(null);
	const [groupDropZoneActive, setGroupDropZoneActive] = useState(false);

	// ── Column list drag handlers ──────────────────────────────────────────────

	const handleDragStart = (e: React.DragEvent, index: number) => {
		dragFromIdx.current = index;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('column-field', allCols[index].field);
		(e.currentTarget as HTMLElement).style.opacity = '0.35';
	};

	const handleDragEnd = (e: React.DragEvent) => {
		(e.currentTarget as HTMLElement).style.opacity = '';
		dragFromIdx.current = null;
		setDropTargetIdx(null);
		setGroupDropZoneActive(false);
	};

	const handleDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (dropTargetIdx !== index) setDropTargetIdx(index);
	};

	const handleDrop = (e: React.DragEvent, toIndex: number) => {
		e.preventDefault();
		const fromIndex = dragFromIdx.current;
		setDropTargetIdx(null);
		if (fromIndex === null || fromIndex === toIndex) return;

		const cols = api.getColumns();
		const reordered = [...cols];
		const [moved] = reordered.splice(fromIndex, 1);
		reordered.splice(toIndex, 0, moved);
		api.setColumnOrder(reordered.map((c) => c.field));
	};

	// ── Visibility handlers ────────────────────────────────────────────────────

	const handleToggle = (field: string, isHidden: boolean) => {
		api.setColumnVisible(field, isHidden);
	};

	const handleShowAll = () =>
		api.setColumnsVisible(
			allCols.map((c) => c.field),
			true
		);
	const handleHideAll = () => {
		if (allCols.length > 1)
			api.setColumnsVisible(
				allCols.slice(1).map((c) => c.field),
				false
			);
	};

	// ── Grouping handlers ──────────────────────────────────────────────────────

	const isGrouped = (field: string) => groupBy.includes(field);
	const canGroup = (col: ColumnDef<any>) => col.enableRowGroup !== false && (api.can?.('group', { colField: col.field })?.allowed ?? true);

	const toggleGroup = (field: string) => {
		const next = isGrouped(field) ? groupBy.filter((f) => f !== field) : [...groupBy, field];
		api.setGroupBy?.(next);
	};

	const removeGroup = (field: string) => {
		api.setGroupBy?.(groupBy.filter((f) => f !== field));
	};

	const clearAllGroups = () => api.setGroupBy?.([]);

	const handleGroupPillDragStart = (e: React.DragEvent, index: number) => {
		groupDragFromIdx.current = index;
		e.dataTransfer.effectAllowed = 'move';
		e.stopPropagation();
	};

	const handleGroupPillDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		if (groupDropTargetIdx !== index) setGroupDropTargetIdx(index);
	};

	const handleGroupPillDrop = (e: React.DragEvent, toIndex: number) => {
		e.preventDefault();
		e.stopPropagation();
		const fromIndex = groupDragFromIdx.current;
		setGroupDropTargetIdx(null);
		if (fromIndex === null || fromIndex === toIndex) return;
		const next = [...groupBy];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		api.setGroupBy?.(next);
	};

	const handleGroupZoneDragOver = (e: React.DragEvent) => {
		if (dragFromIdx.current === null) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		setGroupDropZoneActive(true);
	};

	const handleGroupZoneDragLeave = () => setGroupDropZoneActive(false);

	const handleGroupZoneDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setGroupDropZoneActive(false);
		const field = e.dataTransfer.getData('column-field');
		if (!field || isGrouped(field)) return;
		const col = allCols.find((c) => c.field === field);
		if (!col || !canGroup(col)) return;
		api.setGroupBy?.([...groupBy, field]);
	};

	// ── Pin handlers ──────────────────────────────────────────────────────────

	const handleTogglePinLeft = (colField: string) => {
		if (api.can && !api.can('pin', { colField }).allowed) return;
		const displayedCols = api.getDisplayedColumns();
		const { left, right } = api.getPinnedColumns();
		const colIdx = displayedCols.findIndex((c) => c.field === colField);
		if (colIdx < 0) return; // hidden column — cannot pin
		const isPinned = colIdx < left;
		if (isPinned) {
			// Move column to just after the pin zone, then shrink pin count
			api.moveColumn(colField, left);
			api.setPinnedColumns({ left: left - 1, right });
		} else {
			// Move column to the end of the pin zone, then grow pin count
			api.moveColumn(colField, left);
			api.setPinnedColumns({ left: left + 1, right });
		}
	};

	const handleTogglePinRight = (colField: string) => {
		if (api.can && !api.can('pin', { colField }).allowed) return;
		const displayedCols = api.getDisplayedColumns();
		const { left, right } = api.getPinnedColumns();
		const colIdx = displayedCols.findIndex((c) => c.field === colField);
		if (colIdx < 0) return;
		const firstRight = Math.max(left, displayedCols.length - right);
		const isPinned = colIdx >= firstRight;
		if (isPinned) {
			const nextRight = Math.max(0, right - 1);
			const nextFirstRight = displayedCols.length - nextRight;
			if (colIdx >= nextFirstRight) {
				api.moveColumn(colField, Math.max(left, nextFirstRight - 1));
			}
			api.setPinnedColumns({ left, right: nextRight });
		} else {
			api.moveColumn(colField, firstRight);
			api.setPinnedColumns({ left, right: right + 1 });
		}
	};

	void stateColumns;

	// Read pin state at render time — pin operations via sidebar also trigger a columns state change
	// so the panel re-renders and gets fresh values from getPinnedColumns().
	const pins = api.getPinnedColumns();
	const displayedCols = api.getDisplayedColumns();

	const groupableCols = allCols.filter(canGroup);
	const hasGroups = groupBy.length > 0;
	const normalizedQuery = columnQuery.trim().toLowerCase();
	const filteredCols = useMemo(() => {
		let next = allCols;
		if (columnView === 'groupable') next = next.filter(canGroup);
		if (columnView === 'hidden') next = next.filter((col) => !!col.hide);
		if (!normalizedQuery) return next;
		return next.filter((col) => `${col.header ?? ''} ${col.field}`.toLowerCase().includes(normalizedQuery));
	}, [allCols, columnView, normalizedQuery]);
	const ungroupedGroupableCount = groupableCols.filter((col) => !isGrouped(col.field)).length;
	const hiddenCount = allCols.length - visibleCount;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: theme.bgColor }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0 12px',
					height: 44,
					flexShrink: 0,
					background: theme.headerBg,
					borderBottom: `1px solid ${theme.borderColor}`,
					gap: 8,
				}}
			>
				<span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.textColor }}>
					Columns
				</span>
				<span style={{ fontSize: 10, color: theme.headerText, fontWeight: 600 }}>
					{visibleCount}/{allCols.length}
				</span>
				<button onClick={onClose} style={makeIconBtnStyle(theme.headerText)}>
					<CloseIcon />
				</button>
			</div>

			{/* Quick-action bar */}
			<div
				style={{
					display: 'flex',
					gap: 6,
					padding: '7px 12px',
					borderBottom: `1px solid ${theme.borderColor}`,
					flexShrink: 0,
				}}
			>
				<button onClick={handleShowAll} style={pillBtnStyle(false, theme)}>
					Show all
				</button>
				<button onClick={handleHideAll} style={pillBtnStyle(false, theme)}>
					Hide all
				</button>
			</div>

			<div style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0 }}>
				<label
					style={{
						height: 28,
						display: 'flex',
						alignItems: 'center',
						gap: 7,
						padding: '0 8px',
						borderRadius: 6,
						border: `1px solid ${theme.borderColor}`,
						background: theme.headerBg,
						color: theme.headerText,
					}}
				>
					<SearchIcon />
					<input
						value={columnQuery}
						onChange={(e) => setColumnQuery(e.target.value)}
						placeholder='Find columns'
						style={{
							flex: 1,
							minWidth: 0,
							border: 'none',
							outline: 'none',
							background: 'transparent',
							color: theme.textColor,
							fontSize: 11,
							fontWeight: 600,
							letterSpacing: 0,
						}}
					/>
					{columnQuery && (
						<button
							onClick={() => setColumnQuery('')}
							style={{ ...makeIconBtnStyle(theme.headerText), width: 18, height: 18 }}
							title='Clear search'
						>
							<CloseIcon />
						</button>
					)}
				</label>
			</div>

			<div style={{ display: 'flex', gap: 4, padding: '7px 12px', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0 }}>
				<SegmentButton active={columnView === 'all'} label={`All ${allCols.length}`} onClick={() => setColumnView('all')} theme={theme} />
				<SegmentButton
					active={columnView === 'groupable'}
					label={`Groupable ${groupableCols.length}`}
					onClick={() => setColumnView('groupable')}
					theme={theme}
				/>
				<SegmentButton
					active={columnView === 'hidden'}
					label={`Hidden ${hiddenCount}`}
					onClick={() => setColumnView('hidden')}
					theme={theme}
				/>
			</div>

			{/* Scrollable body */}
			<div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
				{/* ── Row Groups Section ────────────────────────────────── */}
				{groupableCols.length > 0 && (
					<div style={{ flexShrink: 0 }}>
						<div
							style={{
								display: 'flex',
								alignItems: 'flex-start',
								justifyContent: 'space-between',
								padding: '8px 12px 4px',
								flexDirection: 'column',
							}}
						>
							<div
								style={{
									width: '100%',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
								}}
							>
								<span
									style={{
										fontSize: 10,
										fontWeight: 700,
										letterSpacing: '0.08em',
										textTransform: 'uppercase',
										color: theme.focusRing,
										display: 'flex',
										alignItems: 'center',
										gap: 5,
									}}
								>
									<GroupIcon />
									Row Groups
								</span>
								<span style={{ fontSize: 10, color: theme.headerText, fontWeight: 700 }}>
									{groupBy.length} active / {ungroupedGroupableCount} available
								</span>
							</div>

							{hasGroups && (
								<div
									style={{
										width: '100%',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'space-between',
									}}
								>
									<button
										onClick={() => api.expandAllGroups?.()}
										style={{ ...makeIconBtnStyle(theme.headerText), fontSize: 11, width: 'auto', padding: '0 4px' }}
										title='Expand all groups'
									>
										Expand
									</button>
									<button
										onClick={() => api.collapseAllGroups?.()}
										style={{ ...makeIconBtnStyle(theme.headerText), fontSize: 11, width: 'auto', padding: '0 4px' }}
										title='Collapse all groups'
									>
										Collapse
									</button>
									<button
										onClick={clearAllGroups}
										style={{ ...makeIconBtnStyle(theme.headerText), fontSize: 11, width: 'auto', padding: '0 4px' }}
										title='Clear all groups'
									>
										Clear
									</button>
								</div>
							)}
						</div>

						{/* Drop zone / pills */}
						<div
							onDragOver={handleGroupZoneDragOver}
							onDragLeave={handleGroupZoneDragLeave}
							onDrop={handleGroupZoneDrop}
							style={{
								minHeight: 36,
								margin: '0 12px 8px',
								padding: hasGroups ? '4px' : '6px 8px',
								borderRadius: 6,
								border: groupDropZoneActive
									? `1.5px dashed ${theme.focusRing}`
									: hasGroups
										? `1px solid ${theme.selectionBorder}`
										: `1.5px dashed rgba(167,139,250,0.2)`,
								background: groupDropZoneActive ? theme.selectionBg : hasGroups ? 'rgba(167,139,250,0.05)' : 'transparent',
								transition: 'border-color 0.12s, background 0.12s',
								display: 'flex',
								flexWrap: 'wrap',
								gap: 4,
								alignItems: 'center',
							}}
						>
							{!hasGroups && !groupDropZoneActive && (
								<span style={{ fontSize: 10, color: theme.headerText, userSelect: 'none' }}>Drag a column here to group</span>
							)}
							{groupBy.map((field, idx) => {
								const col = allCols.find((c) => c.field === field);
								const label = col?.header ?? field;
								const isDragTarget = groupDropTargetIdx === idx;
								return (
									<div
										key={field}
										draggable
										onDragStart={(e) => handleGroupPillDragStart(e, idx)}
										onDragOver={(e) => handleGroupPillDragOver(e, idx)}
										onDrop={(e) => handleGroupPillDrop(e, idx)}
										onDragEnd={() => {
											groupDragFromIdx.current = null;
											setGroupDropTargetIdx(null);
										}}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 4,
											padding: '3px 6px 3px 4px',
											borderRadius: 4,
											background: isDragTarget ? 'rgba(167,139,250,0.25)' : 'rgba(167,139,250,0.15)',
											border: isDragTarget ? `1px solid ${theme.focusRing}` : `1px solid ${theme.selectionBorder}`,
											cursor: 'grab',
											userSelect: 'none',
											transition: 'background 0.08s',
										}}
									>
										<span style={{ color: '#6b5fa0', display: 'flex', flexShrink: 0 }}>
											<GripIcon />
										</span>
										<span
											style={{
												fontSize: 10,
												fontWeight: 600,
												letterSpacing: '0.04em',
												textTransform: 'uppercase',
												color: theme.focusRing,
												maxWidth: 80,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{label}
										</span>
										<button
											onClick={() => removeGroup(field)}
											style={{
												...makeIconBtnStyle(theme.focusRing),
												width: 14,
												height: 14,
												opacity: 0.7,
											}}
											title={`Remove ${label} group`}
										>
											<CloseIcon />
										</button>
									</div>
								);
							})}
						</div>

						{/* ── Group Options ─────────────────────────────────── */}
						{groupableCols.length > 0 && (
							<div style={{ padding: '4px 12px 8px' }}>
								<div
									style={{
										fontSize: 9,
										fontWeight: 700,
										letterSpacing: '0.08em',
										textTransform: 'uppercase',
										color: theme.headerText,
										marginBottom: 5,
									}}
								>
									Group Options
								</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
									<ToggleRow
										icon={<FooterIcon />}
										label='Show subtotals'
										description='Footer row with aggregates below each leaf group'
										checked={showGroupFooter}
										onChange={(v) => api.setShowGroupFooter(v)}
										theme={theme}
									/>
									<ToggleRow
										icon={<StickyIcon />}
										label='Sticky group headers'
										description='Group header rows stay visible while scrolling'
										checked={enableStickyGroupRows}
										onChange={(v) => api.setStickyGroupRows(v)}
										theme={theme}
									/>
								</div>
							</div>
						)}

						<div style={{ height: 1, background: theme.borderColor, margin: '0 0 4px' }} />
					</div>
				)}

				{/* ── Column list ───────────────────────────────────────── */}
				<div style={{ padding: '4px 0' }}>
					{filteredCols.map((col) => {
						const index = allCols.findIndex((c) => c.field === col.field);
						const isHidden = !!col.hide;
						const isDragTarget = dropTargetIdx === index;
						const grouped = isGrouped(col.field);
						const groupable = canGroup(col);
						const displayedIdx = displayedCols.findIndex((c) => c.field === col.field);
						const isPinnedLeft = !isHidden && displayedIdx >= 0 && displayedIdx < pins.left;
						const firstRightPinIdx = Math.max(pins.left, displayedCols.length - pins.right);
						const isPinnedRight = !isHidden && displayedIdx >= 0 && displayedIdx >= firstRightPinIdx;
						return (
							<div
								key={col.field}
								draggable
								onDragStart={(e) => handleDragStart(e, index)}
								onDragEnd={handleDragEnd}
								onDragOver={(e) => handleDragOver(e, index)}
								onDrop={(e) => handleDrop(e, index)}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 6,
									padding: '5px 12px',
									cursor: 'grab',
									userSelect: 'none',
									opacity: isHidden ? 0.42 : 1,
									background: isDragTarget ? theme.rowHoverBg : grouped ? theme.selectionBg : 'transparent',
									borderTop: isDragTarget ? `1.5px solid ${theme.focusRing}` : '1.5px solid transparent',
									transition: 'background 0.08s, opacity 0.1s',
								}}
							>
								<span style={{ color: theme.headerText, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
									<GripIcon />
								</span>
								<span
									style={{
										flex: 1,
										fontSize: 11,
										fontWeight: 600,
										letterSpacing: '0.04em',
										textTransform: 'uppercase',
										color: grouped ? theme.focusRing : isHidden ? theme.headerText : theme.textColor,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
								>
									{col.header || col.field}
								</span>
								{groupable && (
									<button
										onClick={() => toggleGroup(col.field)}
										title={grouped ? `Remove "${col.header}" from groups` : `Group by "${col.header}"`}
										style={{
											...makeIconBtnStyle(grouped ? theme.focusRing : theme.headerText),
											background: grouped ? theme.selectionBg : 'transparent',
											borderRadius: 4,
											border: grouped ? `1px solid ${theme.selectionBorder}` : '1px solid transparent',
										}}
									>
										<GroupIcon />
									</button>
								)}
								<button
									onClick={() => !isHidden && handleTogglePinLeft(col.field)}
									title={isHidden ? 'Show column to pin' : isPinnedLeft ? 'Unpin column' : 'Pin column left'}
									style={{
										...makeIconBtnStyle(isPinnedLeft ? theme.focusRing : theme.headerText),
										opacity: isHidden ? 0.3 : 1,
										cursor: isHidden ? 'default' : 'pointer',
									}}
								>
									<PinIcon />
								</button>
								<button
									onClick={() => !isHidden && handleTogglePinRight(col.field)}
									title={isHidden ? 'Show column to pin' : isPinnedRight ? 'Unpin right' : 'Pin column right'}
									style={{
										...makeIconBtnStyle(isPinnedRight ? theme.focusRing : theme.headerText),
										opacity: isHidden ? 0.3 : 1,
										cursor: isHidden ? 'default' : 'pointer',
										transform: 'scaleX(-1)',
									}}
								>
									<PinIcon />
								</button>
								<button
									onClick={() => handleToggle(col.field, isHidden)}
									title={isHidden ? 'Show column' : 'Hide column'}
									style={{
										...makeIconBtnStyle(isHidden ? theme.headerText : theme.focusRing),
									}}
								>
									{isHidden ? <EyeClosedIcon /> : <EyeOpenIcon />}
								</button>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// ── Toggle row component ──────────────────────────────────────────────────────

function SegmentButton({ active, label, onClick, theme }: { active: boolean; label: string; onClick: () => void; theme: ThemeTokens }) {
	return (
		<button
			onClick={onClick}
			style={{
				flex: 1,
				minWidth: 0,
				height: 24,
				borderRadius: 5,
				border: active ? `1px solid ${theme.selectionBorder}` : `1px solid ${theme.borderColor}`,
				background: active ? theme.selectionBg : theme.headerBg,
				color: active ? theme.focusRing : theme.headerText,
				cursor: 'pointer',
				fontSize: 9,
				fontWeight: 800,
				letterSpacing: 0,
				overflow: 'hidden',
				padding: '0 4px',
				textOverflow: 'ellipsis',
				textTransform: 'uppercase',
				whiteSpace: 'nowrap',
			}}
		>
			{label}
		</button>
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
			<span
				style={{
					flex: 1,
					fontSize: 10,
					fontWeight: 600,
					color: checked ? theme.focusRing : '#64748b',
				}}
			>
				{label}
			</span>
			{/* Toggle pill */}
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

// ── Shared mini-style helpers ─────────────────────────────────────────────────

import type { ThemeTokens } from '@eregister/wit-grid-core';
function makeIconBtnStyle(color: string): React.CSSProperties {
	return {
		width: 24,
		height: 24,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 5,
		border: 'none',
		background: 'transparent',
		cursor: 'pointer',
		color,
		padding: 0,
		flexShrink: 0,
	};
}

function pillBtnStyle(active: boolean, theme: ThemeTokens): React.CSSProperties {
	return {
		flex: 1,
		height: 26,
		fontSize: 10,
		fontWeight: 600,
		letterSpacing: '0.04em',
		textTransform: 'uppercase',
		borderRadius: 5,
		border: active ? `1px solid ${theme.selectionBorder}` : `1px solid ${theme.borderColor}`,
		background: active ? theme.selectionBg : theme.headerBg,
		color: active ? theme.focusRing : theme.headerText,
		cursor: 'pointer',
		padding: 0,
	};
}
