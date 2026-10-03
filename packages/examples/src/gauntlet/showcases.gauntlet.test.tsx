// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { runGauntlet } from './harness.js';

import AdvancedFiltersDemo from '../showcases/AdvancedFiltersDemo.js';
import ClipboardDemo from '../showcases/ClipboardDemo.js';
import DataIntegrityLab from '../showcases/DataIntegrityLab.js';
import InfiniteServerScroll from '../showcases/InfiniteServerScroll.js';
import GroupingStickyDemo from '../showcases/GroupingStickyDemo.js';
import KanbanBoardDemo from '../showcases/KanbanBoardDemo.js';
import NativeCellTypesDemo from '../showcases/NativeCellTypesDemo.js';
import RealtimeDashboard from '../showcases/RealtimeDashboard.js';
import RealtimeGroupingDemo from '../showcases/RealtimeGroupingDemo.js';
import RowDragDemo from '../showcases/RowDragDemo.js';

const SHOWCASES: Record<string, ComponentType<Record<string, unknown>>> = {
	// jsdom is slow to repaint, so the gauntlet runs a small universe on a slow trickle of ticks.
	'realtime-dashboard': ((props: Record<string, unknown>) => <RealtimeDashboard {...props} rowCount={400} rate={5} />) as ComponentType<
		Record<string, unknown>
	>,
	'realtime-grouping': RealtimeGroupingDemo as ComponentType<Record<string, unknown>>,
	'native-cell-types': NativeCellTypesDemo as ComponentType<Record<string, unknown>>,
	'data-integrity': DataIntegrityLab as ComponentType<Record<string, unknown>>,
	'infinite-server-scroll': InfiniteServerScroll as ComponentType<Record<string, unknown>>,
	'advanced-filters': AdvancedFiltersDemo as ComponentType<Record<string, unknown>>,
	'kanban-board': KanbanBoardDemo as ComponentType<Record<string, unknown>>,
	'row-drag': RowDragDemo as ComponentType<Record<string, unknown>>,
	'grouping-sticky': GroupingStickyDemo as ComponentType<Record<string, unknown>>,
	clipboard: ClipboardDemo as ComponentType<Record<string, unknown>>,
};

// PR runs use a couple of fixed seeds; GAUNTLET_SEEDS / GAUNTLET_STEPS widen it for nightly runs,
// and GAUNTLET_SEED=<n> replays a single reported failure.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const seeds = env.GAUNTLET_SEED ? [Number(env.GAUNTLET_SEED)] : Array.from({ length: Number(env.GAUNTLET_SEEDS ?? 2) }, (_, i) => 1009 + i * 7919);
const steps = Number(env.GAUNTLET_STEPS ?? 40);

describe('showcase composition gauntlet', () => {
	for (const [name, Showcase] of Object.entries(SHOWCASES)) {
		for (const seed of seeds) {
			it(`${name} · seed ${seed}`, async () => {
				const result = await runGauntlet(Showcase, { seed, steps });
				const problems = [...result.faults, ...result.violations];
				expect(
					problems,
					`${name} seed ${seed} — replay with GAUNTLET_SEED=${seed}\nlast actions:\n${result.actions.slice(-12).join('\n')}`
				).toEqual([]);
			});
		}
	}
});
