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
		case 'primitive':
		case 'live-renderer':
		case 'frozen-portal':
			return presentation.recordVersionsFrom ? snapshotFreshness(presentation.recordVersionsFrom) : scrollFallbackFreshness(input);
		case 'html-snapshot':
			return 'rowVersion' in presentation.recordVersionsFrom
				? presentation.recordVersionsFrom
				: snapshotFreshness(presentation.recordVersionsFrom);
		case 'text-impostor':
			return 'recordVersionsFrom' in presentation
				? 'rowVersion' in presentation.recordVersionsFrom
					? presentation.recordVersionsFrom
					: snapshotFreshness(presentation.recordVersionsFrom)
				: presentation.recordVersions;
		case 'html-pending':
		case 'shell':
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

function hydrateCellCtrlFromScrollPresentation<TRowData>(
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
	state.requiresFidelity =
		presentation.kind === 'primitive' ||
		presentation.kind === 'frozen-portal' ||
		presentation.kind === 'shell' ||
		presentation.kind === 'text-impostor' ||
		presentation.kind === 'html-pending' ||
		presentation.kind === 'html-snapshot';
	state.freshness = freshness;
	state.contentMode = 'contentMode' in presentation ? presentation.contentMode : undefined;
	state.formattedValue = formattedValue;
	state.portalKey = portalKey;
	state.html = 'frozenHtml' in presentation ? presentation.frozenHtml : undefined;
	state.markDirty = 'markDirty' in presentation ? presentation.markDirty : undefined;
	state.isEditing = 'isEditing' in presentation ? presentation.isEditing : cellCtrl.visualState.editing;
	state.isFocused = 'isFocused' in presentation ? presentation.isFocused : cellCtrl.visualState.focused;
	state.forceLiveInteractive = 'forceLiveInteractive' in presentation ? presentation.forceLiveInteractive : undefined;
	state.keepVersionFresh = 'keepVersionFresh' in presentation ? presentation.keepVersionFresh : undefined;
	state.captureFrozenHtml = 'captureFrozenHtml' in presentation ? presentation.captureFrozenHtml : undefined;
	state.textImpostorSource = 'source' in presentation ? presentation.source : undefined;
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
	cellCtrl.valueState.loading = presentation.kind === 'html-pending';
	cellCtrl.valueState.empty = !cellCtrl.valueState.formattedValue;
	cellCtrl.rendererState.portalKey = portalKey;
	// The controller key is exactly createCellControllerKey(rowId, columnInstanceId) — reuse it.
	cellCtrl.rendererState.htmlSnapshotKey = presentation.kind === 'html-snapshot' || presentation.kind === 'html-pending' ? cellCtrl.key : undefined;
	cellCtrl.rendererState.mode =
		presentation.kind === 'live-renderer' || presentation.kind === 'dom-update'
			? 'live'
			: presentation.kind === 'frozen-portal'
				? 'frozen'
				: presentation.kind === 'text-impostor' || presentation.kind === 'shell'
					? 'text-impostor'
					: presentation.kind === 'html-snapshot'
						? 'html-snapshot'
						: presentation.kind === 'html-pending'
							? 'html-pending'
							: presentation.kind === 'checkbox-selector'
								? 'none'
								: 'primitive';
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
	cellCtrl.rendererState.portalKey = context.portalKey;
	cellCtrl.rendererState.mode =
		context.contentMode === 'portal'
			? 'live'
			: context.contentMode === 'loading'
				? 'loading'
				: context.contentMode === 'custom'
					? 'none'
					: context.contentMode === 'fallback'
						? 'text-impostor'
						: 'primitive';
	cellCtrl.presentationState = {
		kind:
			context.presentationKind ??
			(context.contentMode === 'portal' ? 'live-renderer' : context.contentMode === 'loading' ? 'loading' : 'primitive'),
		className: context.className,
		title: context.title,
		validationError: context.validationError,
		requiresFidelity: false,
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
export function resolveCellCtrlScrollPresentationState<TRowData>(
	cellCtrl: CellCtrl,
	deps: ScrollCellPresentationDeps,
	input: ScrollCellPresentationInput<TRowData>
): CellCtrl {
	return hydrateCellCtrlFromScrollPresentation(cellCtrl, resolveScrollCellPresentation(deps, input), input);
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
		return resolveCellCtrlScrollPresentationState(cellCtrl, context.scroll.deps, context.scroll.input);
	}
	if (context.fullBind) {
		return hydrateCellCtrlFromFullBind(cellCtrl, context.fullBind);
	}
	return cellCtrl;
}
