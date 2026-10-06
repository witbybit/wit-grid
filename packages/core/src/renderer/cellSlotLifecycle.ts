export const CellSlotLifecycleState = {
	Vacant: 0,
	Bound: 1,
	Destroyed: 2,
} as const;

export type CellSlotLifecycleState = (typeof CellSlotLifecycleState)[keyof typeof CellSlotLifecycleState];

export const CellSlotLifecycleEvent = {
	Bind: 0,
	HotRelease: 1,
	ColdRelease: 2,
	Destroy: 3,
} as const;

export type CellSlotLifecycleEvent = (typeof CellSlotLifecycleEvent)[keyof typeof CellSlotLifecycleEvent];

/** Destroy is accepted from any state (idempotent); nothing else may leave Destroyed. */
export function isLegalCellSlotLifecycleTransition(state: CellSlotLifecycleState, event: CellSlotLifecycleEvent): boolean {
	return event === CellSlotLifecycleEvent.Destroy || state !== CellSlotLifecycleState.Destroyed;
}

/**
 * Pure lifecycle transition used by CellSlot at ownership boundaries, never per steady-state write.
 * Destroyed is absorbing: an illegal event leaves the slot destroyed. Callers detect the violation
 * with isLegalCellSlotLifecycleTransition and count it, so a stray bind on a detached slot is
 * surfaced in telemetry and tests without throwing out of a frame.
 */
export function transitionCellSlotLifecycle(state: CellSlotLifecycleState, event: CellSlotLifecycleEvent): CellSlotLifecycleState {
	if (event === CellSlotLifecycleEvent.Destroy || state === CellSlotLifecycleState.Destroyed) return CellSlotLifecycleState.Destroyed;
	return event === CellSlotLifecycleEvent.Bind ? CellSlotLifecycleState.Bound : CellSlotLifecycleState.Vacant;
}

export interface CellSlotLifecycleSnapshot {
	state: CellSlotLifecycleState;
	rowIndex: number;
	rowId: string;
	binding: unknown | null;
	renderer: unknown | null;
	boundCellCtrl: unknown | null;
}

/** Cold-path assertion for tests and diagnostics; it is deliberately absent from bind loops. */
export function assertCellSlotLifecycleInvariants(slot: CellSlotLifecycleSnapshot): void {
	if (slot.state === CellSlotLifecycleState.Bound) {
		if (slot.rowIndex < 0 || slot.rowId === '') throw new Error('Bound cell slot must own a row identity.');
		return;
	}
	if (slot.binding !== null) throw new Error('Unbound cell slot cannot retain authoritative binding identity.');
	if (slot.state === CellSlotLifecycleState.Destroyed && (slot.renderer !== null || slot.boundCellCtrl !== null)) {
		throw new Error('Destroyed cell slot cannot retain renderer or controller ownership.');
	}
}
