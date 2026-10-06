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
	/** The presentation is provisional during scroll and must be re-bound by post-scroll repair. */
	needsPostScrollRepair: boolean;
	isEditing?: boolean;
	isFocused?: boolean;
	forceLiveInteractive?: boolean;
	keepVersionFresh?: boolean;
	recordVersions?: VisualFreshness | CellDisplaySnapshot;
	freshness: VisualFreshness;
}

/** Which post-scroll budget repairs a queued cell: cheap text/visual work or rich renderer work. */
export type PostScrollRepairLaneKind = 'motion' | 'fidelity';

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

/**
 * Classifies a queued cell's lane from what the physical slot presents *when the queue drains*.
 * The lane is derived, never stored: the dirty queue holds physical elements that can be rebound
 * or cold-released while queued, and a stored copy would have to be kept in sync with a queue the
 * slot does not own.
 */
export function classifyPostScrollRepairLane(input: {
	hasCustomRenderer: boolean;
	isCheckbox: boolean;
	contentMode: CellContentMode;
}): PostScrollRepairLaneKind {
	return input.hasCustomRenderer || input.isCheckbox || input.contentMode === 'portal' || input.contentMode === 'custom' ? 'fidelity' : 'motion';
}

/** Whether a scroll-time presentation is provisional and must be queued for post-scroll repair. */
export function presentationNeedsPostScrollRepair(kind: CellPresentationState['kind'], markDirty: boolean): boolean {
	switch (kind) {
		case 'primitive':
		case 'checkbox-selector':
		case 'frozen-portal':
			return markDirty;
		case 'stand-in':
		case 'live-renderer':
			return true;
		default:
			return false;
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
	/** Why the resolved presentation was impossible, or null. Ownership was planned without the disallowed key. */
	violation: string | null;
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

/**
 * Returns why a resolved presentation is impossible, or null when it is valid. Allocation-free on
 * the valid path, so the dispatcher can check every bind. Ownership of a disallowed portal key is
 * never honoured (getPresentationPortalKey drops it), which is what makes reporting-and-continuing
 * safe in production.
 */
export function getCellPresentationStateViolation(presentation: CellPresentationState): string | null {
	return getViolationForPortalKey(presentation, getPresentationPortalKey(presentation));
}

function getViolationForPortalKey(presentation: CellPresentationState, portalKey: string | undefined): string | null {
	switch (presentation.kind) {
		case 'live-renderer':
		case 'dom-update':
		case 'frozen-portal':
			return portalKey ? null : `Cell presentation '${presentation.kind}' requires a portal key.`;
		case 'buffered':
			if (presentation.contentMode === 'portal' && !portalKey) return 'Buffered portal presentation requires a portal key.';
			if (presentation.contentMode !== 'portal' && presentation.portalKey)
				return 'Buffered non-portal presentation cannot retain a portal key.';
			return null;
		default:
			return presentation.portalKey ? `Cell presentation '${presentation.kind}' cannot own a portal key.` : null;
	}
}

/** Strict form for tests and diagnostics. */
export function assertValidCellPresentationState(presentation: CellPresentationState): void {
	const violation = getCellPresentationStateViolation(presentation);
	if (violation) throw new Error(violation);
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
		violation: null,
	};
}

export function planCellPresentationTransitionInto(
	transition: CellPresentationTransition,
	previousPortalKey: string | undefined,
	presentation: CellPresentationState
): void {
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
	transition.violation = getViolationForPortalKey(presentation, nextPortalKey);
}
