import { useCallback, useEffect, useRef, useState, useSyncExternalStore, memo, createElement, type ComponentType } from 'react';
import {
	ColumnDef,
	doesCanonicalCellPointerMatchColumn,
	GridApi,
	type ActiveEditState,
	type CellRendererPhase,
	type CellRendererProps,
	type ImperativeCellHandle,
	isDomCellRenderer,
} from '@eregister/wit-grid-core';
import { hasImperativeRendererCapability } from './reactHostBridge.js';
import { useGridApi } from './hooks.js';
import type { PortalCellProps, PortalData, PortalRowNodeLike, PortalStore } from './gridPortalTypes.js';

// Static inline styles hoisted to module scope so cell renders don't allocate a fresh object each time.
const FILL_STYLE = { width: '100%', height: '100%' } as const;
const CELL_FLEX_STYLE = { width: '100%', height: '100%', display: 'flex', alignItems: 'center' } as const;
const CELL_FLEX_RELATIVE_STYLE = { width: '100%', height: '100%', display: 'flex', alignItems: 'center', position: 'relative' } as const;
const LOADING_CELL_STYLE = { width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '0 12px' } as const;
const LOADING_SKELETON_STYLE = { height: '16px', width: '80%', borderRadius: '4px' } as const;
const VALIDATION_ERROR_STYLE = {
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
} as const;

/** Column ids passed to renderers: the user/API `colId` (falling back to `field`) and the instance id. */
function getRendererColumnIds<TRowData>(col: ColumnDef<TRowData>): { colId: string; columnInstanceId: CellRendererProps['columnInstanceId'] } {
	return {
		colId: col.colId ?? col.field,
		columnInstanceId: 'instanceId' in col ? (col.instanceId as CellRendererProps['columnInstanceId']) : undefined,
	};
}

/**
 * The `formattedValue` renderer prop: the column's `valueFormatter` output, otherwise the value as a
 * string (`''` for null/undefined), matching the text the grid's default cell renderer shows.
 */
function formatCellValue<TRowData>(col: ColumnDef<TRowData>, value: unknown, node: PortalRowNodeLike<TRowData>): string {
	if (col.valueFormatter) return col.valueFormatter({ value, rowData: node.data, colDef: col, rowId: node.id });
	return value == null ? '' : String(value);
}

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
					style={FILL_STYLE}
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
				<div className='og-cell-validation-error' style={VALIDATION_ERROR_STYLE} role='alert'>
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
			<div style={LOADING_CELL_STYLE}>
				<div className='og-cell-loading-skeleton' style={LOADING_SKELETON_STYLE} />
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
	const { colId, columnInstanceId } = getRendererColumnIds(col);

	return (
		<div style={CELL_FLEX_RELATIVE_STYLE}>
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
					formattedValue: formatCellValue(col, value, node),
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
			rowVersion={effectiveData.rowVersion}
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
		store.registerImperativeUpdater(cellKey, ({ value, node, col, isEditing, phase, isScrolling, isFocused, isSelected }) => {
			const handle = imperativeRef.current;
			if (!handle) return false;
			const { colId, columnInstanceId } = getRendererColumnIds(col);
			handle.update({
				value,
				computedValue: value,
				formattedValue: formatCellValue(col, value, node),
				row: node.data as TRowData,
				rowId: node.id,
				colField: col.field,
				colId,
				columnInstanceId,
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
	const { colId, columnInstanceId } = getRendererColumnIds(effectiveData.col);

	return (
		<div style={CELL_FLEX_STYLE}>
			<CustomRenderer
				ref={imperativeRef as React.Ref<unknown>}
				value={effectiveData.value}
				computedValue={effectiveData.value}
				formattedValue={formatCellValue(effectiveData.col, effectiveData.value, effectiveData.node)}
				row={rowData as Record<string, unknown>}
				rowId={effectiveData.node.id}
				colField={effectiveData.col.field}
				colId={colId}
				columnInstanceId={columnInstanceId}
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
