import React, { useCallback, useId, useRef, useState } from 'react';
import type { GridApi, GridQueryModel, GridQueryGroup, GridQueryCondition, GridQueryNode } from '../../types.js';
import { createEmptyQueryModel, getQueryOperatorsForType } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';
import type { ThemeTokens } from '@eregister/wit-grid-core';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const PlusIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round'>
		<path d='M5.5 1v9M1 5.5h9' />
	</svg>
);

const TrashIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M1.5 3h8M4 3V2h3v1M2.5 3l.5 6h5l.5-6' />
	</svg>
);

const QueryIcon = () => (
	<svg width='14' height='14' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<circle cx='7.5' cy='7.5' r='6' />
		<path d='M5.5 6a2 2 0 1 1 2 2v1' />
		<circle cx='7.5' cy='11' r='0.5' fill='currentColor' />
	</svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idSeq = 0;
function nextId(): string {
	return `qn-${++_idSeq}`;
}

function columnTypeForField(field: string, columns: Array<{ field: string; filterType?: string | null }>): string {
	const col = columns.find((c) => c.field === field);
	return (col?.filterType as string | undefined) ?? 'text';
}

function updateNodeInTree(root: GridQueryGroup, id: string, updater: (node: GridQueryNode) => GridQueryNode): GridQueryGroup {
	function visit(node: GridQueryNode): GridQueryNode {
		if (node.id === id) return updater(node);
		if (node.kind === 'group') {
			return { ...node, children: node.children.map(visit) };
		}
		return node;
	}
	return visit(root) as GridQueryGroup;
}

function removeNodeFromTree(root: GridQueryGroup, id: string): GridQueryGroup {
	function visit(node: GridQueryNode): GridQueryNode {
		if (node.kind === 'group') {
			return { ...node, children: node.children.filter((c) => c.id !== id).map(visit) };
		}
		return node;
	}
	return visit(root) as GridQueryGroup;
}

function addNodeToGroup(root: GridQueryGroup, groupId: string, node: GridQueryNode): GridQueryGroup {
	function visit(n: GridQueryNode): GridQueryNode {
		if (n.kind === 'group' && n.id === groupId) {
			return { ...n, children: [...n.children, node] };
		}
		if (n.kind === 'group') {
			return { ...n, children: n.children.map(visit) };
		}
		return n;
	}
	return visit(root) as GridQueryGroup;
}

// ── Condition row ─────────────────────────────────────────────────────────────

interface ConditionRowProps {
	condition: GridQueryCondition;
	columns: Array<{ field: string; header?: string | null; filterType?: string | null }>;
	theme: ThemeTokens;
	onChange: (updated: GridQueryCondition) => void;
	onRemove: () => void;
}

function ConditionRow({ condition, columns, theme, onChange, onRemove }: ConditionRowProps) {
	const filterableCols = columns.filter((c) => c.filterType !== 'none' && c.filterType !== undefined);
	const colType = columnTypeForField(condition.columnId, columns);
	const operators = getQueryOperatorsForType(colType);
	const opDef = operators.find((o) => o.id === condition.operator);

	const inputStyle: React.CSSProperties = {
		flex: 1,
		height: 26,
		padding: '0 8px',
		fontSize: 11,
		background: theme.headerBg,
		border: `1px solid ${theme.borderColor}`,
		borderRadius: 4,
		color: theme.headerText,
		outline: 'none',
		minWidth: 0,
	};

	const selectStyle: React.CSSProperties = {
		...inputStyle,
		padding: '0 4px',
		cursor: 'pointer',
		appearance: 'none' as const,
	};

	return (
		<div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
			{/* Column selector */}
			<select
				value={condition.columnId}
				onChange={(e) => {
					const newColId = e.target.value;
					const newType = columnTypeForField(newColId, columns);
					const newOps = getQueryOperatorsForType(newType);
					onChange({ ...condition, columnId: newColId, operator: newOps[0]?.id ?? 'contains', value: undefined, valueTo: undefined });
				}}
				style={{ ...selectStyle, flex: '0 0 auto', maxWidth: 110 }}
			>
				{filterableCols.map((c) => (
					<option key={c.field} value={c.field}>
						{(c.header as string | undefined) ?? c.field}
					</option>
				))}
			</select>

			{/* Operator selector */}
			<select
				value={condition.operator}
				onChange={(e) => onChange({ ...condition, operator: e.target.value, value: undefined, valueTo: undefined })}
				style={{ ...selectStyle, flex: '0 0 auto', maxWidth: 90 }}
			>
				{operators.map((op) => (
					<option key={op.id} value={op.id}>
						{op.label}
					</option>
				))}
			</select>

			{/* Value input(s) */}
			{opDef && opDef.valueArity !== 0 && (
				<input
					type={colType === 'number' ? 'number' : colType === 'date' ? 'date' : 'text'}
					value={condition.value == null ? '' : String(condition.value)}
					placeholder='Value'
					onChange={(e) => {
						const raw = e.target.value;
						const v = colType === 'number' ? (raw === '' ? undefined : Number(raw)) : raw === '' ? undefined : raw;
						onChange({ ...condition, value: v });
					}}
					style={inputStyle}
				/>
			)}
			{opDef && opDef.valueArity === 2 && (
				<input
					type={colType === 'number' ? 'number' : colType === 'date' ? 'date' : 'text'}
					value={condition.valueTo == null ? '' : String(condition.valueTo)}
					placeholder='To'
					onChange={(e) => {
						const raw = e.target.value;
						const v = colType === 'number' ? (raw === '' ? undefined : Number(raw)) : raw === '' ? undefined : raw;
						onChange({ ...condition, valueTo: v });
					}}
					style={{ ...inputStyle, flex: '0 0 60px', minWidth: 0 }}
				/>
			)}

			<button
				onClick={onRemove}
				title='Remove condition'
				style={{
					padding: '4px',
					background: 'none',
					border: 'none',
					color: theme.headerText,
					cursor: 'pointer',
					opacity: 0.5,
					flexShrink: 0,
				}}
			>
				<TrashIcon />
			</button>
		</div>
	);
}

// ── Query group ───────────────────────────────────────────────────────────────

interface QueryGroupProps {
	group: GridQueryGroup;
	depth: number;
	columns: Array<{ field: string; header?: string | null; filterType?: string | null }>;
	theme: ThemeTokens;
	isRoot: boolean;
	onUpdate: (updated: GridQueryGroup) => void;
	onRemove?: () => void;
}

function QueryGroup({ group, depth, columns, theme, isRoot, onUpdate, onRemove }: QueryGroupProps) {
	const filterableCols = columns.filter((c) => c.filterType !== 'none' && c.filterType !== undefined);
	const firstCol = filterableCols[0];

	const addCondition = () => {
		if (!firstCol) return;
		const colType = columnTypeForField(firstCol.field, columns);
		const ops = getQueryOperatorsForType(colType);
		const newCond: GridQueryCondition = {
			kind: 'condition',
			id: nextId(),
			columnId: firstCol.field,
			operator: ops[0]?.id ?? 'contains',
		};
		onUpdate({ ...group, children: [...group.children, newCond] });
	};

	const addGroup = () => {
		const newGroup: GridQueryGroup = {
			kind: 'group',
			id: nextId(),
			operator: 'and',
			children: [],
		};
		onUpdate({ ...group, children: [...group.children, newGroup] });
	};

	const removeChild = (id: string) => {
		onUpdate({ ...group, children: group.children.filter((c) => c.id !== id) });
	};

	const updateChild = (updated: GridQueryNode) => {
		onUpdate({ ...group, children: group.children.map((c) => (c.id === updated.id ? updated : c)) });
	};

	const toggleOp = () => {
		onUpdate({ ...group, operator: group.operator === 'and' ? 'or' : 'and' });
	};

	const borderColor = depth % 2 === 0 ? `${theme.selectionBorder}60` : `${theme.focusRing}40`;

	return (
		<div
			style={{
				borderLeft: `2px solid ${borderColor}`,
				paddingLeft: 8,
				marginLeft: depth > 0 ? 4 : 0,
				marginBottom: depth > 0 ? 4 : 0,
			}}
		>
			{/* Group header */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
				{group.children.length >= 2 && (
					<button
						onClick={toggleOp}
						style={{
							padding: '2px 7px',
							fontSize: 10,
							fontWeight: 700,
							letterSpacing: '0.04em',
							background: group.operator === 'and' ? theme.selectionBg : `${theme.focusRing}22`,
							border: `1px solid ${group.operator === 'and' ? theme.selectionBorder : theme.focusRing}`,
							borderRadius: 4,
							color: group.operator === 'and' ? theme.focusRing : theme.focusRing,
							cursor: 'pointer',
						}}
					>
						{group.operator.toUpperCase()}
					</button>
				)}
				{group.children.length < 2 && (
					<span style={{ fontSize: 10, color: theme.headerText, opacity: 0.4, fontWeight: 600 }}>
						{isRoot ? 'WHERE' : group.operator.toUpperCase()}
					</span>
				)}
				<div style={{ flex: 1 }} />
				<button
					onClick={addCondition}
					title='Add condition'
					disabled={filterableCols.length === 0}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 3,
						padding: '2px 6px',
						fontSize: 10,
						background: 'none',
						border: `1px solid ${theme.borderColor}`,
						borderRadius: 4,
						color: theme.headerText,
						cursor: 'pointer',
					}}
				>
					<PlusIcon /> Condition
				</button>
				<button
					onClick={addGroup}
					title='Add group'
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 3,
						padding: '2px 6px',
						fontSize: 10,
						background: 'none',
						border: `1px solid ${theme.borderColor}`,
						borderRadius: 4,
						color: theme.headerText,
						cursor: 'pointer',
					}}
				>
					<PlusIcon /> Group
				</button>
				{!isRoot && onRemove && (
					<button
						onClick={onRemove}
						title='Remove group'
						style={{ padding: '3px', background: 'none', border: 'none', color: theme.headerText, cursor: 'pointer', opacity: 0.4 }}
					>
						<TrashIcon />
					</button>
				)}
			</div>

			{/* Children */}
			{group.children.length === 0 && (
				<div style={{ fontSize: 11, color: theme.headerText, opacity: 0.35, padding: '4px 0 8px', fontStyle: 'italic' }}>
					No conditions — click "+ Condition" to add one.
				</div>
			)}
			{group.children.map((child) =>
				child.kind === 'condition' ? (
					<ConditionRow
						key={child.id}
						condition={child}
						columns={columns}
						theme={theme}
						onChange={(updated) => updateChild(updated)}
						onRemove={() => removeChild(child.id)}
					/>
				) : (
					<QueryGroup
						key={child.id}
						group={child}
						depth={depth + 1}
						columns={columns}
						theme={theme}
						isRoot={false}
						onUpdate={(updated) => updateChild(updated)}
						onRemove={() => removeChild(child.id)}
					/>
				)
			)}
		</div>
	);
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function QueryPanel({ api, onClose }: { api: GridApi<unknown>; onClose: () => void }) {
	const theme = api.getTheme();
	const columns = api.getColumns() as Array<{ field: string; header?: string | null; filterType?: string | null }>;
	const activeQueryModel = useGridKeySelector<GridQueryModel | null>(
		'queryModel',
		(s) => (s as { queryModel?: GridQueryModel | null }).queryModel ?? null
	);

	const [draft, setDraft] = useState<GridQueryModel>(() => activeQueryModel ?? createEmptyQueryModel());
	const [applied, setApplied] = useState(false);

	const isDirty = JSON.stringify(draft.root) !== JSON.stringify(activeQueryModel?.root ?? createEmptyQueryModel().root);

	const handleApply = useCallback(() => {
		const hasConditions = draft.root.children.length > 0;
		api.setQueryModel(hasConditions ? draft : null);
		setApplied(true);
		setTimeout(() => setApplied(false), 1200);
	}, [api, draft]);

	const handleClear = useCallback(() => {
		const empty = createEmptyQueryModel();
		setDraft(empty);
		api.clearQueryModel();
	}, [api]);

	const conditionCount = countConditions(draft.root);

	const sectionLabel: React.CSSProperties = {
		fontSize: 10,
		fontWeight: 700,
		letterSpacing: '0.06em',
		color: theme.headerText,
		opacity: 0.5,
		textTransform: 'uppercase' as const,
		marginBottom: 6,
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					padding: '10px 12px',
					borderBottom: `1px solid ${theme.borderColor}`,
					flexShrink: 0,
				}}
			>
				<span style={{ color: theme.focusRing, display: 'flex' }}>
					<QueryIcon />
				</span>
				<span style={{ fontSize: 13, fontWeight: 600, color: theme.headerText, flex: 1 }}>Query Builder</span>
				{conditionCount > 0 && (
					<span
						style={{
							fontSize: 10,
							fontWeight: 700,
							background: theme.selectionBg,
							color: theme.focusRing,
							border: `1px solid ${theme.selectionBorder}`,
							borderRadius: 999,
							padding: '1px 7px',
						}}
					>
						{conditionCount}
					</span>
				)}
				<button
					onClick={onClose}
					style={{
						padding: 4,
						background: 'none',
						border: 'none',
						color: theme.headerText,
						cursor: 'pointer',
						display: 'flex',
						opacity: 0.6,
					}}
				>
					<CloseIcon />
				</button>
			</div>

			{/* Body — scrollable */}
			<div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 12px' }}>
				<div style={sectionLabel}>Conditions</div>
				<QueryGroup
					group={draft.root}
					depth={0}
					columns={columns}
					theme={theme}
					isRoot={true}
					onUpdate={(updatedRoot) => setDraft({ ...draft, root: updatedRoot })}
				/>
			</div>

			{/* Footer — apply / clear */}
			<div
				style={{
					display: 'flex',
					gap: 8,
					padding: '10px 12px',
					borderTop: `1px solid ${theme.borderColor}`,
					flexShrink: 0,
				}}
			>
				<button
					onClick={handleClear}
					disabled={conditionCount === 0 && !activeQueryModel}
					style={{
						flex: 1,
						height: 30,
						fontSize: 12,
						fontWeight: 500,
						background: 'none',
						border: `1px solid ${theme.borderColor}`,
						borderRadius: 5,
						color: theme.headerText,
						cursor: 'pointer',
						opacity: conditionCount === 0 && !activeQueryModel ? 0.35 : 1,
					}}
				>
					Clear
				</button>
				<button
					onClick={handleApply}
					disabled={!isDirty && !applied}
					style={{
						flex: 2,
						height: 30,
						fontSize: 12,
						fontWeight: 600,
						background: applied ? '#22c55e22' : isDirty ? theme.selectionBg : theme.headerBg,
						border: `1px solid ${applied ? '#22c55e' : isDirty ? theme.selectionBorder : theme.borderColor}`,
						borderRadius: 5,
						color: applied ? '#22c55e' : isDirty ? theme.focusRing : theme.headerText,
						cursor: isDirty ? 'pointer' : 'default',
						transition: 'all 0.15s ease',
					}}
				>
					{applied ? '✓ Applied' : isDirty ? 'Apply query' : 'Up to date'}
				</button>
			</div>
		</div>
	);
}

function countConditions(group: GridQueryGroup): number {
	let n = 0;
	for (const child of group.children) {
		if (child.kind === 'condition') n++;
		else n += countConditions(child);
	}
	return n;
}
