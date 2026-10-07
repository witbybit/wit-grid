import { describe, expect, it } from 'vitest';
import {
	assertValidCellPresentationState,
	createCellPresentationTransition,
	getCellPresentationRoute,
	getPresentationPortalKey,
	planCellPresentationTransitionInto,
	classifyPostScrollRepairLane,
	presentationNeedsPostScrollRepair,
	type CellPresentationState,
} from './cellPresentationStateMachine.js';

function presentation(kind: CellPresentationState['kind'], overrides: Partial<CellPresentationState> = {}): CellPresentationState {
	return {
		kind,
		className: 'og-cell',
		needsPostScrollRepair: false,
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

	it('plans an impossible state without throwing: records the violation and never honours the disallowed key', () => {
		const planned = plan('held', presentation('primitive', { portalKey: 'stale' }));
		expect(planned.violation).toContain('cannot own a portal key');
		expect(planned.nextPortalKey).toBeUndefined();
		expect(planned.releasePortalKey).toBe('held');
		expect(plan(undefined, presentation('primitive')).violation).toBeNull();
	});

	it('rejects portal ownership on a primitive state', () => {
		expect(() => assertValidCellPresentationState(presentation('primitive', { portalKey: 'stale' }))).toThrow('cannot own a portal key');
	});

	it.each([
		['primitive', true, true],
		['primitive', false, false],
		['checkbox-selector', true, true],
		['checkbox-selector', false, false],
		['frozen-portal', true, true],
		['frozen-portal', false, false],
		['stand-in', false, true],
		['live-renderer', false, true],
		['dom-update', true, false],
		['buffered', true, false],
		['loading', true, false],
	] as const)('%s with markDirty=%s needs post-scroll repair: %s', (kind, dirty, needsRepair) => {
		expect(presentationNeedsPostScrollRepair(kind, dirty)).toBe(needsRepair);
	});

	it('classifies the repair lane from the column and what the slot currently presents', () => {
		expect(classifyPostScrollRepairLane({ hasCustomRenderer: false, isCheckbox: false, contentMode: 'text' })).toBe('motion');
		expect(classifyPostScrollRepairLane({ hasCustomRenderer: false, isCheckbox: false, contentMode: 'empty' })).toBe('motion');
		expect(classifyPostScrollRepairLane({ hasCustomRenderer: true, isCheckbox: false, contentMode: 'fallback' })).toBe('fidelity');
		expect(classifyPostScrollRepairLane({ hasCustomRenderer: false, isCheckbox: true, contentMode: 'text' })).toBe('fidelity');
		expect(classifyPostScrollRepairLane({ hasCustomRenderer: false, isCheckbox: false, contentMode: 'portal' })).toBe('fidelity');
		expect(classifyPostScrollRepairLane({ hasCustomRenderer: false, isCheckbox: false, contentMode: 'custom' })).toBe('fidelity');
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
