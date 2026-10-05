import { describe, expect, it } from 'vitest';
import {
	assertValidCellPresentationState,
	createCellPresentationTransition,
	getCellPresentationRoute,
	getPresentationPortalKey,
	isPostScrollRepairCurrent,
	planCellPresentationTransitionInto,
	resolveCellPresentationRepair,
	resolvePostScrollRepair,
	type CellPresentationState,
} from './cellPresentationStateMachine.js';

function presentation(kind: CellPresentationState['kind'], overrides: Partial<CellPresentationState> = {}): CellPresentationState {
	return {
		kind,
		className: 'og-cell',
		repair: 'none',
		freshness: {
			rowVersion: 1,
			globalVersion: 1,
			insightVersion: 1,
			styleVersion: 1,
			loadingVersion: 1,
			selectionVersion: 1,
		},
		...overrides,
	};
}

describe('cell presentation state machine', () => {
	const transition = createCellPresentationTransition();
	const plan = (previousPortalKey: string | undefined, next: CellPresentationState) => {
		planCellPresentationTransitionInto(transition, previousPortalKey, next);
		return transition;
	};

	it.each([
		['buffered', 'text'],
		['primitive', 'text'],
		['loading', 'text'],
		['stand-in', 'text'],
		['live-renderer', 'live'],
		['dom-update', 'live'],
		['frozen-portal', 'snapshot'],
		['checkbox-selector', 'checkbox'],
	] as const)('routes %s through the %s lane', (kind, route) => {
		expect(getCellPresentationRoute(kind)).toBe(route);
	});

	it('preserves a portal when the next state retains the same physical owner', () => {
		const result = plan('cell:r1:name', presentation('frozen-portal', { portalKey: 'cell:r1:name' }));

		expect(result).toMatchObject({
			portalOwnership: 'preserve',
			releasePortalKey: undefined,
			nextRoute: 'snapshot',
			nextPortalKey: 'cell:r1:name',
		});
	});

	it('replaces a portal when physical ownership changes', () => {
		const result = plan('cell:r1:name', presentation('live-renderer', { portalKey: 'cell:r2:name' }));

		expect(result).toMatchObject({
			portalOwnership: 'replace',
			releasePortalKey: 'cell:r1:name',
			nextRoute: 'live',
			nextPortalKey: 'cell:r2:name',
		});
	});

	it('releases a portal before entering a non-portal state', () => {
		const result = plan('cell:r1:name', presentation('primitive'));

		expect(result).toMatchObject({
			portalOwnership: 'release',
			releasePortalKey: 'cell:r1:name',
			nextRoute: 'text',
			nextPortalKey: undefined,
		});
	});

	it('treats a buffered portal as retained only when its content mode is portal', () => {
		const bufferedPortal = presentation('buffered', { contentMode: 'portal', portalKey: 'cell:r1:name' });
		const bufferedText = presentation('buffered', { contentMode: 'text', portalKey: 'cell:r1:name' });

		expect(getPresentationPortalKey(bufferedPortal)).toBe('cell:r1:name');
		expect(getPresentationPortalKey(bufferedText)).toBeUndefined();
	});

	it.each(['live-renderer', 'dom-update', 'frozen-portal'] as const)('rejects %s without a portal key', (kind) => {
		expect(() => assertValidCellPresentationState(presentation(kind))).toThrow('requires a portal key');
	});

	it('rejects portal ownership on a primitive state', () => {
		expect(() => assertValidCellPresentationState(presentation('primitive', { portalKey: 'stale' }))).toThrow('cannot own a portal key');
	});

	it.each([
		['primitive', true, 'motion'],
		['primitive', false, 'none'],
		['frozen-portal', true, 'fidelity'],
		['frozen-portal', false, 'none'],
		['stand-in', false, 'fidelity'],
		['live-renderer', false, 'fidelity'],
		['dom-update', true, 'none'],
	] as const)('resolves %s dirty=%s to %s repair', (kind, dirty, repair) => {
		expect(resolveCellPresentationRepair(kind, dirty)).toBe(repair);
	});

	it('classifies non-presentation enqueue paths once at their boundary', () => {
		expect(resolvePostScrollRepair({ hasCustomRenderer: false, isCheckbox: false, contentMode: 'text' })).toBe('motion');
		expect(resolvePostScrollRepair({ hasCustomRenderer: true, isCheckbox: false, contentMode: 'loading' })).toBe('fidelity');
		expect(resolvePostScrollRepair({ hasCustomRenderer: false, isCheckbox: true, contentMode: 'custom' })).toBe('fidelity');
	});

	it('rejects deferred work after its physical slot is rebound', () => {
		expect(isPostScrollRepairCurrent(7, 7)).toBe(true);
		expect(isPostScrollRepairCurrent(8, 7)).toBe(false);
	});

	it('matches an independent portal-ownership oracle across seeded transition sequences', () => {
		const kinds: CellPresentationState['kind'][] = [
			'buffered',
			'primitive',
			'loading',
			'checkbox-selector',
			'live-renderer',
			'dom-update',
			'frozen-portal',
			'stand-in',
		];
		const routeOracle: Record<CellPresentationState['kind'], 'text' | 'live' | 'snapshot' | 'checkbox'> = {
			buffered: 'text',
			primitive: 'text',
			loading: 'text',
			'checkbox-selector': 'checkbox',
			'live-renderer': 'live',
			'dom-update': 'live',
			'frozen-portal': 'snapshot',
			'stand-in': 'text',
		};

		for (let seed = 1; seed <= 32; seed++) {
			let random = seed;
			let heldPortalKey: string | undefined;
			for (let step = 0; step < 64; step++) {
				random = (random * 1664525 + 1013904223) >>> 0;
				const kind = kinds[random % kinds.length];
				const ownsPortal = kind === 'live-renderer' || kind === 'dom-update' || kind === 'frozen-portal' || kind === 'buffered';
				const nextPortalKey = ownsPortal ? `portal-${(random >>> 8) % 4}` : undefined;
				const next = presentation(kind, {
					contentMode: kind === 'buffered' ? 'portal' : undefined,
					portalKey: nextPortalKey,
				});

				const result = plan(heldPortalKey, next);
				const expectedOwnership =
					heldPortalKey === nextPortalKey
						? heldPortalKey
							? 'preserve'
							: 'none'
						: heldPortalKey && nextPortalKey
							? 'replace'
							: heldPortalKey
								? 'release'
								: 'acquire';

				expect(result.nextRoute, `seed ${seed}, step ${step}`).toBe(routeOracle[kind]);
				expect(result.nextPortalKey, `seed ${seed}, step ${step}`).toBe(nextPortalKey);
				expect(result.releasePortalKey, `seed ${seed}, step ${step}`).toBe(
					heldPortalKey && heldPortalKey !== nextPortalKey ? heldPortalKey : undefined
				);
				expect(result.portalOwnership, `seed ${seed}, step ${step}`).toBe(expectedOwnership);
				heldPortalKey = nextPortalKey;
			}
		}
	});
});
