import type { GridEngine } from '../engine/GridEngine.js';
import type { InternalGridState } from '../state/GridState.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { VisualRow } from '../visualRow.js';
import { reportRendererFault } from './rendererFaults.js';
import { type CompiledStyleRules, evaluateDetailRowStyleRules, evaluateGroupRowStyleRules, evaluateRowStyleRules } from '../styling/styleRules.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';

// Precomputed base class strings for non-data row kinds — avoids string concat per row per frame.
const ROW_KIND_BASE: Record<string, string> = {
	loading: 'og-row og-row-loading',
	failed: 'og-row og-row-failed',
	placeholder: 'og-row og-row-placeholder',
	group: 'og-row og-row-group',
	detail: 'og-row og-row-detail',
	footer: 'og-row og-row-footer',
};

export interface RowPresentationResolverDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	selectionPaint: SelectionPaintManager<TRowData>;
}

export interface RowPresentationInput<TRowData = unknown> {
	visualRow: VisualRow<TRowData>;
	rowIndex: number;
	state: InternalGridState<TRowData>;
	compiledStyleRules: CompiledStyleRules<TRowData>;
	isScrollFrameActive: boolean;
	isRowRebind: boolean;
	/** Warm slot state — read-only inspection, never authoritative on its own (see visualFreshness
	 *  conventions elsewhere in the renderer): a warm className is only reused when the slot's last
	 *  bound row id and kind still match this row. */
	slotLastVisualRowId: string;
	slotRowKind: string;
	slotLastClassName: string;
	pinTopRows: number;
	pinBottomRows: number;
	rowCount: number;
	/** Precomputed by the caller from the active scroll context (selection/loading/style/insight
	 *  version changes) — whether a warm-reused row class should still get a fidelity re-check. */
	shouldDeferWarmRowVisualRefresh: boolean;
}

export interface RowPresentationResult {
	className: string;
	/** True when style-rule re-evaluation must be deferred to the post-scroll fidelity lane rather
	 *  than computed now (style rules read row data — a fidelity-lane concern during active scroll). */
	markDirtyAfterScroll: boolean;
}

/**
 * Resolves a row's className for the current frame. Pure with respect to its inputs — the only
 * side effect is `reportRendererFault` on a user style-rule hook throwing, which never affects the
 * returned className (the custom class is simply omitted on error).
 *
 * This is the canonical row-class computation for the scroll/recycle path. It intentionally does
 * NOT replace `SelectionPaintManager.updateRowClassNameSlot`, which serves the separate post-scroll
 * full-repaint path with different inputs (no warm-class preservation, no group/detail handling) —
 * unifying those is a follow-up. Both do apply insight row decorations, so a row painted here and
 * later repainted there (or vice versa) ends up with the same decoration classes.
 */
export function resolveRowPresentation<TRowData>(
	deps: RowPresentationResolverDeps<TRowData>,
	input: RowPresentationInput<TRowData>
): RowPresentationResult {
	const {
		visualRow,
		rowIndex: r,
		state,
		compiledStyleRules,
		isScrollFrameActive,
		isRowRebind,
		slotLastVisualRowId,
		slotRowKind,
		slotLastClassName,
		pinTopRows,
		pinBottomRows,
		rowCount,
		shouldDeferWarmRowVisualRefresh,
	} = input;

	let rowClassName = ROW_KIND_BASE[visualRow.kind] ?? 'og-row';
	let markDirtyAfterScroll = false;

	if (visualRow.kind === 'group') {
		if (compiledStyleRules.hasGroupRowRules) {
			try {
				const customClass = evaluateGroupRowStyleRules(compiledStyleRules, visualRow);
				if (customClass) rowClassName += ' ' + customClass;
			} catch (e) {
				reportRendererFault(deps.engine, 'group-row-class', e, { rowId: visualRow.id, rowIndex: r });
			}
		}
	} else if (visualRow.kind === 'detail') {
		if (compiledStyleRules.hasDetailRowRules) {
			try {
				const customClass = evaluateDetailRowStyleRules(compiledStyleRules, visualRow);
				if (customClass) rowClassName += ' ' + customClass;
			} catch (e) {
				reportRendererFault(deps.engine, 'detail-row-class', e, { rowId: visualRow.id, rowIndex: r });
			}
		}
	} else if (visualRow.kind === 'data') {
		const node = visualRow.node;
		const canPreserveWarmRowClass =
			isScrollFrameActive && !isRowRebind && slotLastVisualRowId === visualRow.id && slotRowKind === 'data' && slotLastClassName !== '';
		if (canPreserveWarmRowClass) {
			rowClassName = slotLastClassName;
			markDirtyAfterScroll = shouldDeferWarmRowVisualRefresh;
		} else {
			const interaction = readInteractionState(state);
			const bounds = interaction.cellSelection.selection.bounds;
			const focusedRowId = interaction.focus.cell?.rowId ?? null;
			const isFocusedRow = focusedRowId === node.id;
			const isSelectedRow = !!bounds && r >= bounds.minRow && r <= bounds.maxRow;
			const isLoadingRow = deps.engine.data.isRowLoading(node.id);

			if (r < pinTopRows) rowClassName += ' og-row-pinned-top';
			else if (r >= rowCount - pinBottomRows) rowClassName += ' og-row-pinned-bottom';

			if (deps.selectionPaint.hoveredRowIndex === r) rowClassName += ' og-row-hovered';
			if (isSelectedRow || isFocusedRow) rowClassName += ' og-row-selected';
			if (isFocusedRow) rowClassName += ' og-row-focused';
			if (deps.selectionPaint.selectedRowIdSet?.has(node.id)) rowClassName += ' og-row-node-selected';
			if (isLoadingRow) rowClassName += ' og-row-loading';

			if (isScrollFrameActive && compiledStyleRules.hasRowRules && node.data) {
				markDirtyAfterScroll = true;
			} else if (compiledStyleRules.hasRowRules && node.data) {
				try {
					const rs = deps.selectionPaint.rowClassScratchRef;
					rs.row = node.data;
					rs.rowId = node.id;
					rs.rowIndex = r;
					rs.isFocused = isFocusedRow;
					rs.isSelected = isSelectedRow || isFocusedRow;
					rs.isLoading = isLoadingRow;
					rs.selection = interaction.cellSelection.selection;
					const customRowClass = evaluateRowStyleRules(compiledStyleRules, node.data, rs);
					if (customRowClass) rowClassName += ' ' + customRowClass;
				} catch (e) {
					reportRendererFault(deps.engine, 'row-class', e, { rowId: node.id, rowIndex: r });
				}
			}

			// Insight row decorations — the same overlay SelectionPaintManager.updateRowClassNameSlot
			// appends, so a row painted here and later repainted there gets the same className. Like
			// row style rules, they're deferred to the post-scroll repaint (dirty row) during an active
			// scroll frame rather than computed on the hot path.
			const insights = deps.engine.insights;
			if (insights && insights.size > 0) {
				if (isScrollFrameActive) {
					markDirtyAfterScroll = true;
				} else {
					for (const d of insights.getRowDecorations(node.id)) {
						if (d.className) rowClassName += ' ' + d.className;
					}
				}
			}
		}
	}

	return { className: rowClassName, markDirtyAfterScroll };
}
