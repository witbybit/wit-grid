import type { CellDisplaySnapshot } from './cellDisplaySnapshot.js';
import type { CellContentMode } from './cellSlot.js';
import type { VisualFreshness } from './visualFreshness.js';

/** Canonical resolved presentation owned by a CellCtrl and consumed by the physical renderer. */
export interface CellPresentationState {
	kind: 'buffered' | 'primitive' | 'loading' | 'checkbox-selector' | 'live-renderer' | 'dom-update' | 'frozen-portal' | 'stand-in';
	className: string;
	title?: string | null;
	validationError?: string;
	contentMode?: CellContentMode;
	formattedValue?: string;
	portalKey?: string;
	repair: CellPresentationRepair;
	isEditing?: boolean;
	isFocused?: boolean;
	forceLiveInteractive?: boolean;
	keepVersionFresh?: boolean;
	recordVersions?: VisualFreshness | CellDisplaySnapshot;
	freshness: VisualFreshness;
}

export type CellPresentationRepair = 'none' | 'motion' | 'fidelity';

/**
 * Allocation-free causality carried by deferred post-scroll repairs. Multiple causes may be
 * combined on one physical slot while it remains queued.
 */
export const PostScrollRepairReason = {
	Presentation: 1,
	Style: 2,
	Budget: 4,
	WarmCell: 8,
	Loading: 16,
} as const;

export type PostScrollRepairReason = (typeof PostScrollRepairReason)[keyof typeof PostScrollRepairReason];

export function isPostScrollRepairCurrent(rowBindingGeneration: number, repairBindingGeneration: number): boolean {
	return repairBindingGeneration === rowBindingGeneration;
}

/** Classifies repair intent at enqueue time for paths that do not resolve a CellPresentationState. */
export function resolvePostScrollRepair(input: {
	hasCustomRenderer: boolean;
	isCheckbox: boolean;
	contentMode: CellContentMode;
}): Exclude<CellPresentationRepair, 'none'> {
	return input.hasCustomRenderer || input.isCheckbox || input.contentMode === 'portal' || input.contentMode === 'custom' ? 'fidelity' : 'motion';
}

export function resolveCellPresentationRepair(kind: CellPresentationState['kind'], markDirty: boolean): CellPresentationRepair {
	switch (kind) {
		case 'primitive':
			return markDirty ? 'motion' : 'none';
		case 'checkbox-selector':
		case 'frozen-portal':
			return markDirty ? 'fidelity' : 'none';
		case 'stand-in':
		case 'live-renderer':
			return 'fidelity';
		default:
			return 'none';
	}
}

/** The physical presentation lanes supported by the renderer. */
export type CellPresentationRoute = 'text' | 'live' | 'snapshot' | 'checkbox';

export interface CellPresentationTransition {
	previousPortalKey?: string;
	nextKind: CellPresentationState['kind'];
	nextRoute: CellPresentationRoute;
	nextPortalKey?: string;
	releasePortalKey?: string;
	portalOwnership: 'none' | 'acquire' | 'preserve' | 'release' | 'replace';
}

const ROUTE_BY_KIND: Record<CellPresentationState['kind'], CellPresentationRoute> = {
	buffered: 'text',
	primitive: 'text',
	loading: 'text',
	'stand-in': 'text',
	'live-renderer': 'live',
	'dom-update': 'live',
	'frozen-portal': 'snapshot',
	'checkbox-selector': 'checkbox',
};

export function getCellPresentationRoute(kind: CellPresentationState['kind']): CellPresentationRoute {
	return ROUTE_BY_KIND[kind];
}

/** Returns the portal the resolved presentation is allowed to retain. */
export function getPresentationPortalKey(presentation: CellPresentationState): string | undefined {
	switch (presentation.kind) {
		case 'live-renderer':
		case 'dom-update':
		case 'frozen-portal':
			return presentation.portalKey;
		case 'buffered':
			return presentation.contentMode === 'portal' ? presentation.portalKey : undefined;
		default:
			return undefined;
	}
}

/** Fails at the physical-render boundary when a resolver emits an impossible state. */
export function assertValidCellPresentationState(presentation: CellPresentationState): void {
	const portalKey = getPresentationPortalKey(presentation);
	switch (presentation.kind) {
		case 'live-renderer':
		case 'dom-update':
		case 'frozen-portal':
			if (!portalKey) throw new Error(`Cell presentation '${presentation.kind}' requires a portal key.`);
			return;
		case 'buffered':
			if (presentation.contentMode === 'portal' && !portalKey) throw new Error('Buffered portal presentation requires a portal key.');
			if (presentation.contentMode !== 'portal' && presentation.portalKey) {
				throw new Error('Buffered non-portal presentation cannot retain a portal key.');
			}
			return;
		default:
			if (presentation.portalKey) throw new Error(`Cell presentation '${presentation.kind}' cannot own a portal key.`);
	}
}

/**
 * Pure transition planner for the physical presentation boundary. It does not mount, release, or
 * write DOM; it makes portal ownership and binder routing explicit so every fast path follows the
 * same transition rules.
 */
export function createCellPresentationTransition(): CellPresentationTransition {
	return {
		nextKind: 'primitive',
		nextRoute: 'text',
		portalOwnership: 'none',
	};
}

export function planCellPresentationTransitionInto(
	transition: CellPresentationTransition,
	previousPortalKey: string | undefined,
	presentation: CellPresentationState
): void {
	assertValidCellPresentationState(presentation);
	const nextPortalKey = getPresentationPortalKey(presentation);
	const releasePortalKey = previousPortalKey && previousPortalKey !== nextPortalKey ? previousPortalKey : undefined;
	let portalOwnership: CellPresentationTransition['portalOwnership'];
	if (previousPortalKey === nextPortalKey) portalOwnership = previousPortalKey ? 'preserve' : 'none';
	else if (previousPortalKey && nextPortalKey) portalOwnership = 'replace';
	else if (previousPortalKey) portalOwnership = 'release';
	else portalOwnership = 'acquire';

	transition.previousPortalKey = previousPortalKey;
	transition.nextKind = presentation.kind;
	transition.nextRoute = getCellPresentationRoute(presentation.kind);
	transition.nextPortalKey = nextPortalKey;
	transition.releasePortalKey = releasePortalKey;
	transition.portalOwnership = portalOwnership;
}
