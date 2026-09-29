/**
 * Plan 103 direct-write inventory.
 *
 * Entries here are the current production allowlist for raw StateManager/invalidation usage
 * while the remaining domains are converged onto GridChangeApplier. The list is intentionally
 * small and should shrink as follow-on work lands.
 */
export const GRID_DIRECT_WRITE_ALLOWLIST = [
	{
		file: 'engine/GridChangeApplier.ts',
		kind: 'canonical-commit',
		justification: 'Owns the authoritative logical commit path.',
	},
	{
		file: 'state/StateManager.ts',
		kind: 'state-kernel',
		justification: 'Owns low-level state storage and subscriber notification.',
	},
	{
		file: 'engine/GridEngine.ts',
		kind: 'bootstrap-derived',
		justification: 'Construction/bootstrap wiring remains here until the remaining facade splits are finished.',
	},
	{
		file: 'engine/CellNotificationController.ts',
		kind: 'derived-runtime',
		justification: 'Cell notifications emit renderer-local invalidations after data mutations.',
	},
	{
		file: 'renderer/renderPaintPipeline.ts',
		kind: 'renderer-local-consumer',
		justification:
			'Renderer-only listeners coordinate paint timing, scroll alignment, and local geometry caches after commit-owned invalidations are declared.',
	},
	{
		file: 'store.ts',
		kind: 'legacy-public-facade',
		justification: 'Public facade still carries a shrinking set of direct-write compatibility helpers pending Plan 109.',
	},
] as const;
