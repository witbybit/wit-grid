import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, memo, createElement, type ComponentType } from 'react';
import {
	ColumnDef,
	doesCanonicalCellPointerMatchColumn,
	GridApi,
	VisualRow,
	type ActiveEditState,
	type CellRendererPhase,
	type ImperativeCellHandle,
	isDomCellRenderer,
} from '@eregister/wit-grid-core';
import { hasImperativeRendererCapability } from './reactHostBridge.js';
import { useGridApi } from './hooks.js';
import { GridAdapterContext } from './gridContext.js';
import type { PortalCellProps, PortalData, PortalStore } from './gridPortalTypes.js';

// ─── ActiveCellEditor ────────────────────────────────────────────────────────
// Mounted ONLY when a cell is actively being edited. Keeping the activeEdit
// subscription here means 0 cells subscribe when nothing is being edited,
// and exactly 1 subscribes during an edit — instead of every visible cell.

interface ActiveCellEditorProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	colId: string;
	columnInstanceId?: string;
	value: unknown;
	col: ColumnDef<TRowData>;
	api: GridApi<TRowData>;
}

function ActiveCellEditorInner<TRowData = unknown>({ rowId, colField, colId, columnInstanceId, value, col, api }: ActiveCellEditorProps<TRowData>) {
	const [localValue, setLocalValue] = useState<unknown>(value);
	const localValueRef = useRef(localValue);
	localValueRef.current = localValue;
	const editColumnKey = columnInstanceId ?? colId ?? colField;

	useEffect(() => {
		setLocalValue(value);
	}, [value]);

	// activeEdit subscription lives here — only this mounted instance subscribes, not every cell
	// Memoize the getSnapshot function to cache the activeEdit state and avoid infinite loops
	const updateGenRef = useRef(0);
	const cacheRef = useRef<{ gen: number; value: ActiveEditState | null }>({ gen: -1, value: null });

	const activeEditState = useSyncExternalStore(
		useCallback(
			(cb) =>
				api.subscribeToKey('activeEdit', () => {
					updateGenRef.current++;
					cb();
				}),
			[api]
		),
		useCallback(() => {
			const currentGen = updateGenRef.current;
			const cache = cacheRef.current;

			// If subscription hasn't fired since last call, return cached value
			if (cache.gen === currentGen && cache.gen !== -1) {
				return cache.value;
			}

			// Recompute value
			const value = api.getStateSnapshot().activeEdit as ActiveEditState | null;

			// Cache and return
			cacheRef.current = { gen: currentGen, value };
			return value;
		}, [api])
	);
	const validationError =
		activeEditState != null && doesCanonicalCellPointerMatchColumn(activeEditState, rowId, col)
			? (activeEditState.validationError ?? null)
			: null;

	const handleCommit = useCallback(
		(finalValue?: unknown) => {
			const isEvent = finalValue && typeof finalValue === 'object' && ('nativeEvent' in finalValue || 'target' in finalValue);
			const valToCommit = finalValue !== undefined && !isEvent ? finalValue : localValueRef.current;
			void api.commitEdit(rowId, editColumnKey, valToCommit);
		},
		[api, rowId, editColumnKey]
	);

	const handleCancel = useCallback(() => {
		api.stopEditing(true);
	}, [api]);

	const CustomEditor = col?.cellEditor as ComponentType<Record<string, unknown>> | undefined;

	return (
		<>
			{CustomEditor ? (
				<div
					style={{ width: '100%', height: '100%' }}
					onMouseDown={(e) => e.stopPropagation()}
					onDoubleClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.defaultPrevented) return;
						if (e.key === 'Enter') {
							e.stopPropagation();
							handleCommit();
						} else if (e.key === 'Escape') {
							e.stopPropagation();
							handleCancel();
						}
					}}
				>
					{createElement(CustomEditor, {
						rowId,
						colField,
						colId,
						columnInstanceId,
						value: localValue,
						onChange: (val: unknown) => {
							setLocalValue(val);
							localValueRef.current = val;
							api.updateEditDraft(rowId, editColumnKey, val);
						},
						api,
						onCommit: handleCommit,
						onCancel: handleCancel,
					})}
				</div>
			) : (
				<input
					autoFocus
					className='og-cell-editor'
					value={typeof localValue === 'string' || typeof localValue === 'number' ? String(localValue) : ''}
					onChange={(e) => {
						setLocalValue(e.target.value);
						localValueRef.current = e.target.value;
						api.updateEditDraft(rowId, editColumnKey, e.target.value);
					}}
					onMouseDown={(e) => e.stopPropagation()}
					onDoubleClick={(e) => e.stopPropagation()}
					onBlur={() => handleCommit()}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.stopPropagation();
							handleCommit();
						} else if (e.key === 'Escape') {
							e.stopPropagation();
							handleCancel();
						}
					}}
				/>
			)}
			{validationError && (
				<div
					className='og-cell-validation-error'
					style={{
						position: 'absolute',
						top: '100%',
						left: 0,
						right: 0,
						zIndex: 10,
						background: 'var(--og-validation-error-bg, #fff0f0)',
						color: 'var(--og-validation-error-color, #c00)',
						fontSize: '11px',
						padding: '2px 6px',
						border: '1px solid var(--og-validation-error-border, #f5a5a5)',
						borderTop: 'none',
						borderRadius: '0 0 4px 4px',
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					}}
					role='alert'
				>
					{validationError}
				</div>
			)}
		</>
	);
}

const ActiveCellEditor = memo(ActiveCellEditorInner) as typeof ActiveCellEditorInner;

// ─── PortalCell ───────────────────────────────────────────────────────────────

function PortalCellInner<TRowData = unknown>({
	rowId,
	colField,
	value,
	col,
	node,
	isEditing,
	isLoading,
	phase,
	isScrolling,
	isFocused,
	isSelected,
}: PortalCellProps<TRowData>) {
	const api = useGridApi<TRowData>();

	if (isLoading) {
		return (
			<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
				<div className='og-cell-loading-skeleton' style={{ height: '16px', width: '80%', borderRadius: '4px' }} />
			</div>
		);
	}

	const rowData = node?.data;

	// DomCellRenderer is an object ({mount}), memo/forwardRef are exotic objects — use isDomCellRenderer guard
	const iCol = col as ColumnDef<TRowData> & { cellRenderer?: unknown };
	const CustomRenderer =
		iCol?.cellRenderer && !isDomCellRenderer(iCol.cellRenderer)
			? (iCol.cellRenderer as unknown as ComponentType<Record<string, unknown>>)
			: undefined;
	const colId = col.colId ?? col.field;
	const columnInstanceId = 'instanceId' in col ? (col.instanceId as string | undefined) : undefined;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', position: 'relative' }}>
			{isEditing ? (
				<ActiveCellEditor<TRowData>
					rowId={rowId}
					colField={colField}
					colId={colId}
					columnInstanceId={columnInstanceId}
					value={value}
					col={col}
					api={api}
				/>
			) : CustomRenderer && rowData ? (
				createElement(CustomRenderer, {
					value,
					computedValue: value,
					row: rowData,
					rowId,
					colField,
					colId,
					columnInstanceId,
					isScrolling: !!isScrolling,
					phase: phase ?? 'initial',
					isFocused: !!isFocused,
					isEditing,
					isSelected: !!isSelected,
					api,
				})
			) : null}
		</div>
	);
}

export const PortalCell = memo(PortalCellInner) as typeof PortalCellInner;

// ─── Default row renderers ────────────────────────────────────────────────────

function DefaultGroupRowRendererInner<TRowData = unknown>({ visualRow, api }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'group') return null;
	const expanded = visualRow.expanded;
	const depth = visualRow.depth;

	// Memoize getSnapshot to cache selectedRowIds and avoid infinite loops
	const selRowIdUpdateGenRef = useRef(0);
	const selRowIdCacheRef = useRef<{ gen: number; value: readonly string[] }>({ gen: -1, value: [] });

	const selectedRowIds = useSyncExternalStore(
		useCallback(
			(onStoreChange) =>
				api.subscribeToKey('selectedRowIds', () => {
					selRowIdUpdateGenRef.current++;
					onStoreChange();
				}),
			[api]
		),
		useCallback(() => {
			const currentGen = selRowIdUpdateGenRef.current;
			const cache = selRowIdCacheRef.current;

			// If subscription hasn't fired since last call, return cached value
			if (cache.gen === currentGen && cache.gen !== -1) {
				return cache.value;
			}

			// Recompute value
			const value = api.getStateSnapshot().selectedRowIds;

			// Cache and return
			selRowIdCacheRef.current = { gen: currentGen, value };
			return value;
		}, [api])
	);
	const adapterHandle = useContext(GridAdapterContext);
	const descendantIds = adapterHandle?.getGroupVisibleDescendantRowIds(visualRow.groupId) ?? [];
	const selectedSet = new Set(selectedRowIds);
	const selectedDescendantCount = descendantIds.reduce((count, rowId) => count + (selectedSet.has(rowId) ? 1 : 0), 0);
	const allDescendantsSelected = descendantIds.length > 0 && selectedDescendantCount === descendantIds.length;
	const someDescendantsSelected = selectedDescendantCount > 0 && selectedDescendantCount < descendantIds.length;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		api.toggleGroupExpanded(visualRow.id);
	};

	const handleGroupSelection = (e: React.MouseEvent<HTMLInputElement>) => {
		e.stopPropagation();
		if (descendantIds.length === 0) return;
		if (allDescendantsSelected) api.deselectRows(descendantIds);
		else api.selectRows(descendantIds);
	};

	return (
		<div className='og-group-row-content' style={{ paddingLeft: `${depth * 20 + 8}px` }} onClick={handleToggle}>
			<input
				type='checkbox'
				className='og-group-row-checkbox'
				checked={allDescendantsSelected}
				ref={(input) => {
					if (input) input.indeterminate = someDescendantsSelected;
				}}
				onClick={handleGroupSelection}
				onChange={() => undefined}
				aria-label={allDescendantsSelected ? 'Deselect group rows' : 'Select group rows'}
				title={
					selectedDescendantCount > 0
						? `${selectedDescendantCount} of ${descendantIds.length} visible rows selected`
						: `Select ${descendantIds.length} visible rows`
				}
			/>
			<span className={`og-group-row-toggle ${expanded ? 'og-group-row-toggle-expanded' : ''}`}>▶</span>
			<span className='og-group-row-label-prefix'>{visualRow.field}:</span>
			<span className='og-group-row-value'>{String(visualRow.key)}</span>
			<span className='og-group-count'>{visualRow.leafCount ?? visualRow.childCount} rows</span>
			{visualRow.aggregateValues &&
				Object.entries(visualRow.aggregateValues)
					.slice(0, 3)
					.map(([field, value]) =>
						value != null ? (
							<span key={field} className='og-group-aggregate'>
								<span>{field}</span>
								<strong>{String(value)}</strong>
							</span>
						) : null
					)}
		</div>
	);
}

export const DefaultGroupRowRenderer = memo(DefaultGroupRowRendererInner) as typeof DefaultGroupRowRendererInner;

function DefaultDetailRowRendererInner<TRowData = unknown>({ visualRow }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'detail') return null;
	return <div className='og-detail-row-content'>Nested detail view for parent row: {visualRow.parentId}</div>;
}

export const DefaultDetailRowRenderer = memo(DefaultDetailRowRendererInner) as typeof DefaultDetailRowRendererInner;

function DefaultFooterRowRendererInner<TRowData = unknown>({ visualRow }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'footer') return null;
	const agg = visualRow.aggregateValues;
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				height: '100%',
				paddingLeft: 12,
				gap: 12,
				fontSize: 11,
				color: 'var(--og-header-text)',
				fontWeight: 600,
			}}
		>
			<span style={{ color: 'rgba(167,139,250,0.6)', fontWeight: 700, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
				Subtotal
			</span>
			{agg &&
				Object.entries(agg).map(([field, value]) =>
					value != null ? (
						<span key={field} style={{ color: '#94a3b8' }}>
							<span style={{ opacity: 0.6 }}>{field}: </span>
							<span style={{ color: '#e2e8f0' }}>
								{typeof value === 'number' && value > 1000 ? `$${value.toLocaleString()}` : String(value)}
							</span>
						</span>
					) : null
				)}
		</div>
	);
}

export const DefaultFooterRowRenderer = memo(DefaultFooterRowRendererInner) as typeof DefaultFooterRowRendererInner;

function DefaultFailedRowRendererInner<TRowData = unknown>({ visualRow }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'failed') return null;
	return (
		<div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: 12, color: '#fca5a5', fontWeight: 600 }}>
			{visualRow.error}
		</div>
	);
}

export const DefaultFailedRowRenderer = memo(DefaultFailedRowRendererInner) as typeof DefaultFailedRowRendererInner;

function DefaultPlaceholderRowRendererInner<TRowData = unknown>({ visualRow }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'placeholder') return null;
	return (
		<div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: 12, color: '#94a3b8', fontWeight: 500 }}>
			{visualRow.reason ?? 'Unavailable'}
		</div>
	);
}

export const DefaultPlaceholderRowRenderer = memo(DefaultPlaceholderRowRendererInner) as typeof DefaultPlaceholderRowRendererInner;

// ─── PortalCellWrapper ────────────────────────────────────────────────────────

interface PortalCellWrapperProps<TRowData = unknown> {
	cellKey: string;
	store: PortalStore<TRowData>;
}

/**
 * Slot-pinned cell adapter. Stays mounted for the lifetime of the cell slot.
 *
 * Data updates flow through useState + useEffect rather than useSyncExternalStore.
 * This has two key benefits:
 *
 *   1. No synchronous React re-renders during scroll frames — React 18 automatic
 *      batching defers all post-scroll setData calls into a single reconciliation
 *      cycle, keeping the animation loop free of React scheduler overhead.
 *
 *   2. lastKnownRef prevents blank-cell flashes: if the store data is transiently
 *      undefined during a concurrent-mode render pass (structural change in flight,
 *      slot-reassignment race, etc.) the last known good data is rendered instead of
 *      returning null and briefly blanking the cell.
 */
function PortalCellWrapperInner<TRowData = unknown>({ cellKey, store }: PortalCellWrapperProps<TRowData>) {
	// Initialise synchronously from the store so the very first render has real data.
	const [data, setData] = useState<PortalData<TRowData> | undefined>(() => store.getCellData?.(cellKey));

	// Preserve the last non-undefined snapshot. Rendered when data is momentarily
	// absent so the cell never goes blank during transitions.
	const lastKnownRef = useRef(data);
	if (data !== undefined) lastKnownRef.current = data;

	useEffect(() => {
		// Cover the render→effect gap: sync with the store in case it was mutated
		// between the initial render and this effect running (rare under concurrent mode).
		const current = store.getCellData?.(cellKey);
		if (current !== lastKnownRef.current) {
			setData(current);
		}
		// Subscribe to all future data-only updates for this cell key.
		if (!store.subscribeToCell) return;
		return store.subscribeToCell(cellKey, () => {
			setData(store.getCellData?.(cellKey));
		});
	}, [cellKey, store]); // cellKey and store are both stable for this component's lifetime

	const effectiveData = data ?? lastKnownRef.current;
	if (!effectiveData) return null;

	return (
		<PortalCell<TRowData>
			rowId={effectiveData.node.id}
			colField={effectiveData.col.field}
			value={effectiveData.value}
			col={effectiveData.col}
			node={effectiveData.node}
			isEditing={effectiveData.isEditing}
			isLoading={effectiveData.isLoading}
			phase={effectiveData.phase}
			isScrolling={effectiveData.isScrolling}
			isFocused={effectiveData.isFocused}
			isSelected={effectiveData.isSelected}
		/>
	);
}

export const PortalCellWrapper = memo(PortalCellWrapperInner) as typeof PortalCellWrapperInner;

// ─── ImperativePortalCellWrapper ──────────────────────────────────────────────

/**
 * Like PortalCellWrapper, but renders the renderer as a JSX element (not a function call)
 * so forwardRef works. Registers an imperative updater in the portal store — subsequent
 * data updates call ref.current.update() directly, bypassing React's scheduler entirely.
 *
 * Uses the same useState + lastKnownRef pattern as PortalCellWrapper: async-batched updates
 * and no blank-cell flashes. In practice notifyCellData is rarely called for imperative cells
 * (tryImperativeUpdate short-circuits it) so the subscription is mostly a safety net.
 */
function ImperativePortalCellWrapperInner<TRowData = unknown>({ cellKey, store }: PortalCellWrapperProps<TRowData>) {
	const api = useGridApi<TRowData>();
	const imperativeRef = useRef<ImperativeCellHandle<TRowData> | null>(null);
	// Keep api ref current without causing re-subscription
	const apiRef = useRef(api);
	apiRef.current = api;

	// useState + lastKnownRef: same blank-prevention & batching strategy as PortalCellWrapper.
	const [data, setData] = useState<PortalData<TRowData> | undefined>(() => store.getCellData?.(cellKey));
	const lastKnownRef = useRef(data);
	if (data !== undefined) lastKnownRef.current = data;

	useEffect(() => {
		const current = store.getCellData?.(cellKey);
		if (current !== lastKnownRef.current) setData(current);
		if (!store.subscribeToCell) return;
		return store.subscribeToCell(cellKey, () => setData(store.getCellData?.(cellKey)));
	}, [cellKey, store]);

	// Register imperative updater — called by the grid view instead of mountCell on data-only updates
	useEffect(() => {
		if (!store.registerImperativeUpdater) return;
		store.registerImperativeUpdater(cellKey, (value, node, col, isEditing, _isLoading, phase, isScrolling, isFocused, isSelected) => {
			const handle = imperativeRef.current;
			if (!handle) return false;
			handle.update({
				value,
				computedValue: value,
				row: node.data as TRowData,
				rowId: node.id,
				colField: col.field,
				colId: col.field,
				isScrolling: isScrolling ?? false,
				phase: phase ?? 'initial',
				isFocused: isFocused ?? false,
				isEditing,
				isSelected: isSelected ?? false,
				api: apiRef.current,
			});
			return true;
		});
		return () => {
			store.unregisterImperativeUpdater?.(cellKey);
		};
	}, [store, cellKey]);

	const effectiveData = data ?? lastKnownRef.current;
	if (!effectiveData) return null;

	const iColData = effectiveData.col as ColumnDef<TRowData> & { cellRenderer?: unknown };
	const CustomRenderer = iColData.cellRenderer as unknown as React.ForwardRefExoticComponent<
		Record<string, unknown> & React.RefAttributes<unknown>
	>;
	const rowData = effectiveData.node?.data;

	if (!CustomRenderer || isDomCellRenderer(iColData.cellRenderer) || !rowData) return null;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			<CustomRenderer
				ref={imperativeRef as React.Ref<unknown>}
				value={effectiveData.value}
				computedValue={effectiveData.value}
				row={rowData as Record<string, unknown>}
				rowId={effectiveData.node.id}
				colField={effectiveData.col.field}
				colId={effectiveData.col.field}
				isScrolling={effectiveData.isScrolling ?? false}
				phase={effectiveData.phase ?? 'initial'}
				isFocused={effectiveData.isFocused ?? false}
				isEditing={effectiveData.isEditing}
				isSelected={effectiveData.isSelected ?? false}
				api={api as unknown as Record<string, unknown>}
			/>
		</div>
	);
}

export const ImperativePortalCellWrapper = memo(ImperativePortalCellWrapperInner) as typeof ImperativePortalCellWrapperInner;
