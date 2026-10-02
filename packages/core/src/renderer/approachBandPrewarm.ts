import type { GridScheduler } from './gridScheduler.js';
import type { RenderWindow } from './renderWindow.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import type { RowRenderer } from './rowRenderer.js';
import { isVisualFresh } from './visualFreshness.js';
import { compileStyleRules, evaluateCellStyleRules } from '../styling/styleRules.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import { collectCellDecorationSnapshotMetadata, createCellDisplaySnapshot, mergeCellSnapshotTitle } from './cellDisplaySnapshot.js';
import type { CanonicalGridCellPointer, GridCellRangeBounds } from '../api/GridApi.js';
import { getColumnInstanceIdentity, type ColumnDef, type ColumnInstanceId } from '../columnDef.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { RowNode } from '../rowNode.js';

/**
 * Mirrors rowCellBinder's (module-private) applyValueFormatter, with the same params shape, for
 * idle prewarm snapshots of columns that declare a valueFormatter.
 */
function formatPrewarmValue<TRowData>(col: ColumnDef<TRowData>, value: unknown, node: RowNode<TRowData>): string {
	return col.valueFormatter!({ value, rowData: node.data as TRowData, colDef: col, rowId: node.id });
}

function isCellSelected(rowIndex: number, colIndex: number, selectionBounds: GridCellRangeBounds | null | undefined): boolean {
	return (
		!!selectionBounds &&
		rowIndex >= selectionBounds.minRow &&
		rowIndex <= selectionBounds.maxRow &&
		colIndex >= selectionBounds.minCol &&
		colIndex <= selectionBounds.maxCol
	);
}

function isCellFocused<TRowData>(
	rowId: string,
	column: Pick<ColumnDef<TRowData>, 'field'> & { instanceId?: ColumnInstanceId },
	focusedCell: CanonicalGridCellPointer | null | undefined
): boolean {
	return doesCanonicalCellPointerMatchColumn(focusedCell, rowId, column);
}

type PrewarmRequest = { visibleRowStart: number; visibleRowEnd: number; visibleColStart: number; visibleColEnd: number };

export interface ApproachBandPrewarmerDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	gridScheduler: GridScheduler;
	renderStats: RenderRuntimeStats;
}

export interface ApproachBandPrewarmerOptions {
	/** Cell snapshots built per idle slice. */
	budget?: number;
	/** Rows and columns around the visible window to prewarm (doubled on the leading edge). */
	rowPadding?: number;
	colPadding?: number;
}

/**
 * Builds cell display snapshots for the band just outside the visible window, in idle time
 * during scroll, so cells arriving on the next frames paint from a fresh snapshot instead of
 * computing their display values, classes and tooltips inside a scroll frame.
 */
export class ApproachBandPrewarmer<TRowData = unknown> {
	private prewarmScheduled = false;
	private prewarmTimer: number | null = null;
	private prewarmRequest: PrewarmRequest | null = null;
	private lastPrewarmRequest: PrewarmRequest | null = null;
	private readonly budget: number;
	private readonly rowPadding: number;
	private readonly colPadding: number;

	constructor(
		private readonly deps: ApproachBandPrewarmerDeps<TRowData>,
		options: ApproachBandPrewarmerOptions = {}
	) {
		this.budget = options.budget ?? 48;
		this.rowPadding = options.rowPadding ?? 2;
		this.colPadding = options.colPadding ?? 2;
	}

	public schedule(nextWindow: RenderWindow): void {
		if (!this.deps.gridScheduler.supportsIdle()) return;
		this.prewarmRequest = {
			visibleRowStart: nextWindow.visibleRowStart ?? nextWindow.rowStart,
			visibleRowEnd: nextWindow.visibleRowEnd ?? nextWindow.rowEnd,
			visibleColStart: nextWindow.visibleColStart ?? nextWindow.colStart,
			visibleColEnd: nextWindow.visibleColEnd ?? nextWindow.colEnd,
		};
		if (this.prewarmScheduled) return;
		this.prewarmScheduled = true;
		this.prewarmTimer = this.deps.gridScheduler.idle((deadline) => {
			this.prewarmTimer = null;
			this.prewarmScheduled = false;
			this.deps.renderStats.prewarmPasses++;
			this.run(deadline);
		});
	}

	private run(deadline?: { timeRemaining(): number }): void {
		const request = this.prewarmRequest;
		if (!request) return;
		const rowModel = this.deps.engine.getVisualRowModel();
		if (!rowModel) return;
		const state = this.deps.engine.stateManager.getState();
		const interaction = readInteractionState(state);
		const compiledPlan = this.deps.engine.columns.getCompiledPlan();
		const focusedCell = interaction.focus.cell;
		const selectionBounds = interaction.cellSelection.selection.bounds;
		const compiledStyleRules = compileStyleRules(state.styleRules);

		const columns = this.deps.engine.columns.getDisplayedColumns();
		const rowCount = rowModel.getVisualRowCount();
		const colCount = columns.length;
		if (rowCount === 0 || colCount === 0) return;

		// Bias the prewarm ring toward the direction of travel so fast scroll arrives at
		// prewarmed snapshots. The leading edge gets 2× the base padding; the trailing edge gets 1×.
		const base = this.rowPadding;
		const baseCol = this.colPadding;
		const prev = this.lastPrewarmRequest;
		const rowDelta = prev ? request.visibleRowStart - prev.visibleRowStart : 0;
		const colDelta = prev ? request.visibleColStart - prev.visibleColStart : 0;
		const rowBefore = rowDelta > 0 ? base : rowDelta < 0 ? base * 2 : base;
		const rowAfter = rowDelta > 0 ? base * 2 : rowDelta < 0 ? base : base;
		const colBefore = colDelta > 0 ? baseCol : colDelta < 0 ? baseCol * 2 : baseCol;
		const colAfter = colDelta > 0 ? baseCol * 2 : colDelta < 0 ? baseCol : baseCol;
		this.lastPrewarmRequest = { ...request };

		const leftColStart = Math.max(0, request.visibleColStart - colBefore);
		const leftColEnd = Math.max(-1, request.visibleColStart - 1);
		const rightColStart = Math.min(colCount, request.visibleColEnd + 1);
		const rightColEnd = Math.min(colCount - 1, request.visibleColEnd + colAfter);
		const topRowStart = Math.max(0, request.visibleRowStart - rowBefore);
		const topRowEnd = Math.max(-1, request.visibleRowStart - 1);
		const bottomRowStart = Math.min(rowCount, request.visibleRowEnd + 1);
		const bottomRowEnd = Math.min(rowCount - 1, request.visibleRowEnd + rowAfter);

		let workDone = 0;
		const budget = this.budget;
		const canContinue = (): boolean => {
			if (workDone >= budget) return false;
			if (!deadline) return true;
			return workDone === 0 || deadline.timeRemaining() > 1;
		};
		const recordWork = (): void => {
			workDone++;
		};
		const hasFreshSnapshot = (rowId: string, colField: string): boolean => {
			const snapshot = this.deps.engine.getCellDisplaySnapshot(rowId, colField);
			return isVisualFresh(snapshot, {
				rowVersion: this.deps.engine.rowVersions.get(rowId) ?? -1,
				globalVersion: state.globalVersion,
				insightVersion: this.deps.engine.insights.getVersion(),
				styleVersion: this.deps.rowRenderer.styleVersion,
				loadingVersion: this.deps.rowRenderer.loadingVersion,
				selectionVersion: this.deps.engine.selectionVersion,
			});
		};
		const visitApproachBand = (visit: (rowIndex: number, colIndex: number) => boolean): void => {
			for (let row = request.visibleRowStart; row <= request.visibleRowEnd && canContinue(); row++) {
				for (let col = leftColStart; col <= leftColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
				for (let col = rightColStart; col <= rightColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}

			for (let row = topRowStart; row <= topRowEnd && canContinue(); row++) {
				for (let col = request.visibleColStart; col <= request.visibleColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}

			for (let row = bottomRowStart; row <= bottomRowEnd && canContinue(); row++) {
				for (let col = request.visibleColStart; col <= request.visibleColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}

			// Corner cells: approach rows × approach columns — needed for diagonal scroll entry.
			for (let row = topRowStart; row <= topRowEnd && canContinue(); row++) {
				for (let col = leftColStart; col <= leftColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
				for (let col = rightColStart; col <= rightColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}
			for (let row = bottomRowStart; row <= bottomRowEnd && canContinue(); row++) {
				for (let col = leftColStart; col <= leftColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
				for (let col = rightColStart; col <= rightColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}
		};

		visitApproachBand((rowIndex, colIndex) => {
			if (!canContinue()) return false;
			const visualRow = rowModel.getVisualRow(rowIndex);
			if (visualRow?.kind !== 'data') return true;
			const col = columns[colIndex];
			if (!col) return true;
			const isStandInEligible = compiledPlan.columnPlans[colIndex]?.mode === 'custom';
			const rowId = visualRow.node.id;
			if (hasFreshSnapshot(rowId, col.field)) return true;
			const rawValue = col.valueGetter ? undefined : this.deps.engine.getRawCellValue(rowId, col.field);
			const shouldPrimeFormula = typeof rawValue === 'string' && rawValue.startsWith('=');
			const hasRegisteredFormula = this.deps.engine.hasFormula(rowId, col.field);
			const shouldPrimeDisplayValue = col.valueGetter || shouldPrimeFormula || hasRegisteredFormula || isStandInEligible;
			const cellDecorations = this.deps.engine.insights.getCellDecorations(rowId, col.field);
			const isFocused = isCellFocused(rowId, col, focusedCell);
			const isSelected = isCellSelected(rowIndex, colIndex, selectionBounds);
			const needsReadonlyEvaluation = col.canEdit !== undefined && visualRow.node.data !== null;
			const needsTooltipSnapshot = col.tooltip !== undefined && visualRow.node.data !== null;
			const needsStyleSnapshot = compiledStyleRules.hasCellRules && visualRow.node.data !== null;
			const cachedValue = this.deps.engine.getCachedDisplayValue(rowId, col.field);
			const primedValue = shouldPrimeDisplayValue
				? (col.valueGetter || hasRegisteredFormula) && cachedValue !== undefined
					? cachedValue
					: this.deps.engine.primeDisplayValue(rowId, col.field)
				: undefined;
			const displayValue = primedValue ?? cachedValue ?? this.deps.engine.getCheapDisplayValue(rowId, col.field);
			if (shouldPrimeDisplayValue && primedValue !== undefined) {
				this.deps.renderStats.prewarmedDisplayValues++;
			}
			recordWork();
			const decorationMetadata = collectCellDecorationSnapshotMetadata(cellDecorations);
			let stateClassName = '';
			if (isFocused) {
				stateClassName += stateClassName ? ' og-cell-focused' : 'og-cell-focused';
			}
			if (isSelected) {
				stateClassName += stateClassName ? ' og-cell-selected' : 'og-cell-selected';
			}
			if (needsReadonlyEvaluation) {
				const isEditable = normalizeCapabilityResult(
					col.canEdit!({ action: 'edit', row: visualRow.node.data, rowId, colField: col.field })
				).allowed;
				if (!isEditable) {
					stateClassName += stateClassName ? ' og-cell-readonly' : 'og-cell-readonly';
				}
			}
			if (needsStyleSnapshot) {
				const styleScratch = this.deps.rowRenderer.cellClassScratch;
				styleScratch.row = visualRow.node.data;
				styleScratch.rowId = rowId;
				styleScratch.rowIndex = rowIndex;
				styleScratch.col = col;
				styleScratch.colField = col.field;
				styleScratch.colIndex = colIndex;
				styleScratch.isFocused = isFocused;
				styleScratch.isRowFocused = focusedCell?.rowId === rowId;
				styleScratch.isRowSelected = isSelected;
				styleScratch.isSelected = isSelected;
				styleScratch.isEditing = false;
				styleScratch.value = displayValue;
				styleScratch.rawValue = rawValue ?? displayValue;
				styleScratch.isLoading = false;
				styleScratch.selection = interaction.cellSelection.selection;
				const customCellClass = evaluateCellStyleRules(compiledStyleRules, col, visualRow.node.data, styleScratch);
				if (customCellClass) stateClassName += stateClassName ? ` ${customCellClass}` : customCellClass;
			}
			const tooltipText =
				col.tooltip !== undefined && visualRow.node.data !== null
					? typeof col.tooltip === 'string'
						? col.tooltip
						: col.tooltip({
								row: visualRow.node.data,
								rowId,
								colField: col.field,
								value: rawValue ?? displayValue,
							})
					: null;
			// The snapshot's text is painted verbatim during scroll, so it must be the formatted text a
			// full bind would store — otherwise formatted columns flash raw values ("1234.5") until
			// post-scroll repair lands ("$1,234.50"). Plain fields format the raw value (the idle full
			// bind path); getter/formula fields format the cached display value (the scroll bind path).
			// A getter/formula value that is not cached yet stays unformatted, as in the scroll bind path.
			const formatterInput = shouldPrimeDisplayValue ? (primedValue ?? cachedValue) : rawValue;
			const snapshotText =
				col.valueFormatter && !isStandInEligible && visualRow.node.data !== null && (!shouldPrimeDisplayValue || formatterInput !== undefined)
					? formatPrewarmValue(col, formatterInput, visualRow.node)
					: displayValue;
			const snapshotContentKind = isStandInEligible && snapshotText !== '' ? 'stand-in' : snapshotText !== '' ? 'text' : 'empty';
			const snapshotContentMode = isStandInEligible && snapshotText !== '' ? 'fallback' : snapshotText !== '' ? 'text' : 'empty';
			this.deps.engine.cellDisplaySnapshots.set(
				createCellDisplaySnapshot({
					rowId,
					columnInstanceId: getColumnInstanceIdentity(col),
					colField: col.field,
					rowVersion: this.deps.engine.rowVersions.get(rowId) ?? -1,
					globalVersion: state.globalVersion,
					insightVersion: this.deps.engine.insights.getVersion(),
					styleVersion: this.deps.rowRenderer.styleVersion,
					loadingVersion: this.deps.rowRenderer.loadingVersion,
					selectionVersion: this.deps.engine.selectionVersion,
					baseClassName: 'og-cell',
					stateClassName,
					decorationClassName: decorationMetadata.classNameSuffix,
					contentKind: snapshotContentKind,
					contentMode: snapshotContentMode,
					formattedValue: snapshotText,
					title: mergeCellSnapshotTitle(tooltipText, decorationMetadata.insightTitle),
					validationError: decorationMetadata.validationError,
				})
			);
			this.deps.renderStats.prewarmedCellSnapshots++;
			return canContinue();
		});

		if (workDone >= budget && !this.prewarmScheduled && this.deps.gridScheduler.supportsIdle()) {
			this.prewarmScheduled = true;
			this.prewarmTimer = this.deps.gridScheduler.idle((nextDeadline) => {
				this.prewarmTimer = null;
				this.prewarmScheduled = false;
				this.deps.renderStats.prewarmPasses++;
				this.run(nextDeadline);
			});
		}
	}
}
