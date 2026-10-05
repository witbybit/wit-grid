import type { CellCtrl } from './CellCtrl.js';
import type { RowCtrl } from './RowCtrl.js';
import type { ViewportPlan } from '../viewportPlanner.js';
import type { CellDisplaySnapshot } from '../cellDisplaySnapshot.js';
import type { VisualFreshness } from '../visualFreshness.js';
import {
	resolveScrollCellPresentation,
	type ScrollCellPresentation,
	type ScrollCellPresentationDeps,
	type ScrollCellPresentationInput,
} from '../scrollCellPresentation.js';
import { resolveCellPresentationRepair } from '../cellPresentationStateMachine.js';

export type CellCtrlBindPhase = 'scroll' | 'full-bind' | 'prewarm' | 'fidelity';

export interface CellCtrlResolveContext<TRowData = unknown> {
	scroll?: {
		deps: ScrollCellPresentationDeps;
		input: ScrollCellPresentationInput<TRowData>;
	};
	fullBind?: {
		className: string;
		title: string | null;
		validationError?: string;
		contentMode: 'portal' | 'text' | 'empty' | 'loading' | 'fallback' | 'custom';
		presentationKind?: CellCtrl['presentationState']['kind'];
		formattedValue: string;
		portalKey?: string;
		freshness: VisualFreshness;
		value: unknown;
	};
}

function snapshotFreshness(snapshot: CellDisplaySnapshot): VisualFreshness {
	return {
		rowVersion: snapshot.rowVersion,
		globalVersion: snapshot.globalVersion,
		insightVersion: snapshot.insightVersion,
		styleVersion: snapshot.styleVersion,
		loadingVersion: snapshot.loadingVersion,
		selectionVersion: snapshot.selectionVersion,
	};
}

/** Scroll-frame freshness used when a presentation carries no snapshot/version stamp of its own.
 *  Built lazily — most presentations record their own versions, so this is rarely allocated. */
function scrollFallbackFreshness<TRowData>(input: ScrollCellPresentationInput<TRowData>): VisualFreshness {
	return {
		rowVersion: input.rowVersion,
		globalVersion: input.ctx.globalVersion,
		insightVersion: input.ctx.insightVersion,
		styleVersion: input.ctx.styleVersion,
		loadingVersion: input.ctx.loadingVersion,
		selectionVersion: input.ctx.selectionVersion,
	};
}

function resolvePresentationFreshness<TRowData>(presentation: ScrollCellPresentation, input: ScrollCellPresentationInput<TRowData>): VisualFreshness {
	switch (presentation.kind) {
		case 'buffered':
			if (presentation.recordVersionsFrom && 'rowVersion' in presentation.recordVersionsFrom) return presentation.recordVersionsFrom;
			return presentation.recordVersionsFrom ? snapshotFreshness(presentation.recordVersionsFrom) : scrollFallbackFreshness(input);
		case 'primitive':
		case 'live-renderer':
		case 'frozen-portal':
			return presentation.recordVersionsFrom ? snapshotFreshness(presentation.recordVersionsFrom) : scrollFallbackFreshness(input);
		case 'stand-in':
			return presentation.recordVersions;
		case 'dom-update':
			return 'rowVersion' in presentation.recordVersions ? presentation.recordVersions : snapshotFreshness(presentation.recordVersions);
		case 'checkbox-selector':
			return scrollFallbackFreshness(input);
	}
}

function getPresentationTitle(presentation: ScrollCellPresentation): string | null {
	return 'title' in presentation ? (presentation.title ?? null) : null;
}

function getPresentationValidationError(presentation: ScrollCellPresentation): string | undefined {
	return 'validationError' in presentation ? presentation.validationError : undefined;
}

function hydrateCellCtrlFromScrollDecision<TRowData>(
	cellCtrl: CellCtrl,
	presentation: ScrollCellPresentation,
	input: ScrollCellPresentationInput<TRowData>
): CellCtrl {
	const freshness = resolvePresentationFreshness(presentation, input);
	const title = getPresentationTitle(presentation);
	const validationError = getPresentationValidationError(presentation);
	const portalKey = 'portalCellKey' in presentation ? presentation.portalCellKey : 'portalKey' in presentation ? presentation.portalKey : undefined;
	const formattedValue = 'formattedValue' in presentation ? presentation.formattedValue : undefined;
	cellCtrl.freshness = freshness;
	// Written in place: presentationState is owned by exactly one CellCtrl and only ever read
	// through `cellCtrl.presentationState` at dispatch time, so reusing the object (every field is
	// overwritten below) is equivalent to replacing it and saves a ~20-field allocation per cell.
	const state = cellCtrl.presentationState;
	state.kind = presentation.kind;
	state.className = presentation.className;
	state.title = title;
	state.validationError = validationError;
	state.repair = resolveCellPresentationRepair(presentation.kind, 'markDirty' in presentation ? presentation.markDirty : false);
	state.freshness = freshness;
	state.contentMode = 'contentMode' in presentation ? presentation.contentMode : undefined;
	state.formattedValue = formattedValue;
	state.portalKey = portalKey;
	state.isEditing = 'isEditing' in presentation ? presentation.isEditing : cellCtrl.visualState.editing;
	state.isFocused = 'isFocused' in presentation ? presentation.isFocused : cellCtrl.visualState.focused;
	state.forceLiveInteractive = 'forceLiveInteractive' in presentation ? presentation.forceLiveInteractive : undefined;
	state.keepVersionFresh = 'keepVersionFresh' in presentation ? presentation.keepVersionFresh : undefined;
	state.recordVersions =
		'recordVersionsFrom' in presentation
			? presentation.recordVersionsFrom
			: 'recordVersions' in presentation
				? presentation.recordVersions
				: undefined;
	cellCtrl.visualState.className = presentation.className;
	cellCtrl.visualState.title = title;
	cellCtrl.visualState.validationError = validationError;
	cellCtrl.visualState.focused = 'isFocused' in presentation ? presentation.isFocused : cellCtrl.visualState.focused;
	cellCtrl.visualState.editing = 'isEditing' in presentation ? presentation.isEditing : cellCtrl.visualState.editing;
	cellCtrl.visualState.readOnly = presentation.className.includes('og-cell-readonly');
	cellCtrl.valueState.formattedValue = formattedValue ?? '';
	cellCtrl.valueState.displayText = cellCtrl.valueState.formattedValue;
	cellCtrl.valueState.loading = false;
	cellCtrl.valueState.empty = !cellCtrl.valueState.formattedValue;
	return cellCtrl;
}

function hydrateCellCtrlFromFullBind(cellCtrl: CellCtrl, context: NonNullable<CellCtrlResolveContext['fullBind']>): CellCtrl {
	cellCtrl.freshness = context.freshness;
	cellCtrl.visualState.className = context.className;
	cellCtrl.visualState.title = context.title;
	cellCtrl.visualState.validationError = context.validationError;
	cellCtrl.visualState.readOnly = context.className.includes('og-cell-readonly');
	cellCtrl.valueState.value = context.value;
	cellCtrl.valueState.formattedValue = context.formattedValue;
	cellCtrl.valueState.displayText = context.formattedValue;
	cellCtrl.valueState.loading = context.contentMode === 'loading';
	cellCtrl.valueState.empty = !context.formattedValue;
	cellCtrl.presentationState = {
		kind:
			context.presentationKind ??
			(context.contentMode === 'portal' ? 'live-renderer' : context.contentMode === 'loading' ? 'loading' : 'primitive'),
		className: context.className,
		title: context.title,
		validationError: context.validationError,
		repair: 'none',
		freshness: context.freshness,
		contentMode: context.contentMode,
		formattedValue: context.formattedValue,
		portalKey: context.portalKey,
	};
	return cellCtrl;
}

/**
 * Scroll-phase resolve without the generic wrapper objects — the per-cell scroll bind path calls
 * this directly. Neither `deps` nor `input` is retained, so callers may pass reused scratch objects.
 */
export function resolveCellCtrlScrollDecisionState<TRowData>(
	cellCtrl: CellCtrl,
	deps: ScrollCellPresentationDeps,
	input: ScrollCellPresentationInput<TRowData>
): CellCtrl {
	return hydrateCellCtrlFromScrollDecision(cellCtrl, resolveScrollCellPresentation(deps, input), input);
}

export function resolveCellCtrlPresentationState<TRowData>(input: {
	cellCtrl: CellCtrl;
	rowCtrl: RowCtrl;
	viewportPlan: ViewportPlan | null;
	phase: CellCtrlBindPhase;
	context: CellCtrlResolveContext<TRowData>;
}): CellCtrl {
	const { cellCtrl, context } = input;
	if (context.scroll) {
		return resolveCellCtrlScrollDecisionState(cellCtrl, context.scroll.deps, context.scroll.input);
	}
	if (context.fullBind) {
		return hydrateCellCtrlFromFullBind(cellCtrl, context.fullBind);
	}
	return cellCtrl;
}
