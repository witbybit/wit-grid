import React, { useCallback, useId, useRef, useState } from 'react';
import type { GridApi, GridQueryModel, GridQueryGroup, GridQueryCondition, GridQueryNode, ColumnDef } from '../../types.js';
import { createEmptyQueryModel } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';
import { resolveColumnFilterDef, type ThemeTokens } from '@eregister/wit-grid-core';
import { CoreFilterEditor } from '../../filters/CoreFilterEditor.js';

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
	api: GridApi<unknown>;
	condition: GridQueryCondition;
	columns: ColumnDef<any>[];
	theme: ThemeTokens;
	onChange: (updated: GridQueryCondition) => void;
	onRemove: () => void;
}

/** One condition: a column, and that column's own filter editor (as the header and sidebar show it). */
function ConditionRow({ api, condition, columns, theme, onChange, onRemove }: ConditionRowProps) {
	const column = columns.find((c) => c.field === condition.columnId);
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
			<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
				<select
					value={condition.columnId}
					aria-label='Column'
					onChange={(e) => onChange({ ...condition, columnId: e.target.value, filter: null })}
					style={{
						flex: 1,
						minWidth: 0,
						height: 28,
						padding: '0 6px',
						fontSize: 12,
						background: theme.headerBg,
						border: `1px solid ${theme.borderColor}`,
						borderRadius: 6,
						color: theme.textColor,
						cursor: 'pointer',
					}}
				>
					{columns.map((c) => (
						<option key={c.field} value={c.field}>
							{c.header || c.field}
						</option>
					))}
				</select>
				<button
					onClick={onRemove}
					title='Remove condition'
					style={{
						padding: 4,
						background: 'none',
						border: 'none',
						color: theme.headerText,
						cursor: 'pointer',
						opacity: 0.6,
						flexShrink: 0,
					}}
				>
					<TrashIcon />
				</button>
			</div>
			{column && (
				<CoreFilterEditor
					api={api as GridApi<any>}
					column={column}
					surface='query'
					filter={condition.filter}
					onChange={(filter) => onChange({ ...condition, filter })}
				/>
			)}
		</div>
	);
}

// ── Query group ───────────────────────────────────────────────────────────────

interface QueryGroupProps {
	api: GridApi<unknown>;
	group: GridQueryGroup;
	depth: number;
	columns: ColumnDef<any>[];
	theme: ThemeTokens;
	isRoot: boolean;
	onUpdate: (updated: GridQueryGroup) => void;
	onRemove?: () => void;
}

function QueryGroup({ api, group, depth, columns, theme, isRoot, onUpdate, onRemove }: QueryGroupProps) {
	const firstCol = columns[0];

	const addCondition = () => {
		if (!firstCol) return;
		const newCond: GridQueryCondition = { kind: 'condition', id: nextId(), columnId: firstCol.field, filter: null };
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
					disabled={columns.length === 0}
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
						api={api}
						condition={child}
						columns={columns}
						theme={theme}
						onChange={(updated) => updateChild(updated)}
						onRemove={() => removeChild(child.id)}
					/>
				) : (
					<QueryGroup
						key={child.id}
						api={api}
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
	// Columns that filter, each with its own filter editor.
	const columns = (api.getColumns() as ColumnDef<any>[]).filter((c) => resolveColumnFilterDef(c) !== null);
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
					api={api}
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
