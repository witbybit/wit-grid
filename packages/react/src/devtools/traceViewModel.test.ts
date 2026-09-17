import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GridCausalTraceSnapshot } from '@eregister/open-grid-core/experimental';
import { describe, expect, it } from 'vitest';
import { buildFrameDistribution, filterTraceEvents, groupTimeline, SLOW_FRAME_THRESHOLD_MS, tracePrivacyLabel } from './traceViewModel.js';

const snapshot: GridCausalTraceSnapshot = {
	v: 1,
	sessionId: 's',
	active: true,
	dropped: 2,
	events: [
		{ v: 1, sessionId: 's', sequence: 0, timestamp: 0, event: { type: 'commit-request', attemptId: 3, reason: 'edit' } },
		{
			v: 1,
			sessionId: 's',
			sequence: 0.5,
			timestamp: 0,
			event: { type: 'commit-outcome', attemptId: 3, changeId: 7, outcome: 'accepted', domains: ['rows'] },
		},
		{ v: 1, sessionId: 's', sequence: 1, timestamp: 1, event: { type: 'cell-change', changeId: 7, cell: { rowId: 'r:雪', colField: 'price' } } },
		{
			v: 1,
			sessionId: 's',
			sequence: 2,
			timestamp: 2,
			event: { type: 'frame', changeIds: [7], correlation: 'render-request', kind: 'full', rowsVisited: 4, cellsWritten: 8 },
		},
		{ v: 1, sessionId: 's', sequence: 3, timestamp: 3, event: { type: 'fault', source: 'renderer', operation: 'paint', message: 'safe' } },
	],
};

describe('flight recorder view models', () => {
	it('filters exact event types and Unicode search text', () => {
		expect(filterTraceEvents(snapshot, 'cell-change', '雪')).toHaveLength(1);
		expect(filterTraceEvents(snapshot, 'fault', '雪')).toHaveLength(0);
	});
	it('retains the complete attempt when search matches only its request', () => {
		const causalSnapshot: GridCausalTraceSnapshot = {
			...snapshot,
			events: [
				{ v: 1, sessionId: 's', sequence: 10, timestamp: 10, event: { type: 'commit-request', attemptId: 8, reason: 'editing:validation' } },
				{
					v: 1,
					sessionId: 's',
					sequence: 11,
					timestamp: 11,
					event: { type: 'commit-outcome', attemptId: 8, outcome: 'validation-rejected', domains: [] },
				},
				{ v: 1, sessionId: 's', sequence: 12, timestamp: 12, event: { type: 'fault', source: 'renderer', operation: 'paint' } },
			],
		};

		expect(filterTraceEvents(causalSnapshot, 'all', 'editing:validation').map((entry) => entry.event.type)).toEqual([
			'commit-request',
			'commit-outcome',
		]);
	});
	it('groups only explicit causal IDs', () => {
		const groups = groupTimeline(snapshot.events);
		expect(groups[0]?.events.map((entry) => entry.sequence)).toEqual([0, 0.5, 1, 2]);
		expect(groups[1]?.key).toBe('event:3');
	});
	it('reports honest frame metrics and unknowns', () => {
		expect(buildFrameDistribution(snapshot)).toMatchObject({ maxCellsWritten: 8, maxRowsVisited: 4, unknownMetrics: 0 });
		expect(tracePrivacyLabel(snapshot)).toBe('No values captured');
	});
	it('uses nearest-rank p95 and labels slow and unknown frame durations', () => {
		const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 20, undefined];
		const timed: GridCausalTraceSnapshot = {
			...snapshot,
			events: durations.map((duration, index) => ({
				v: 1,
				sessionId: 's',
				sequence: index,
				timestamp: index,
				event: {
					type: 'frame',
					changeIds: [],
					correlation: 'uncorrelated',
					kind: 'full',
					...(duration === undefined ? {} : { durationMs: duration }),
				} as const,
			})),
		};
		expect(buildFrameDistribution(timed)).toMatchObject({
			maxDurationMs: 20,
			p95DurationMs: 20,
			slowFrameCount: 1,
			unknownDurations: 1,
		});
		expect(SLOW_FRAME_THRESHOLD_MS).toBe(16.7);
	});
	it('keeps DevTools source UTF-8 without mojibake markers', () => {
		const directory = dirname(fileURLToPath(import.meta.url));
		const source = readdirSync(directory)
			.filter((file) => /\.(ts|tsx|css)$/.test(file))
			.map((file) => readFileSync(resolve(directory, file), 'utf8'))
			.join('\n');
		const suspiciousLeadCodePoints = new Set([0xfffd, 0x00c3, 0x00c2, 0x00e2]);
		expect([...source].some((character) => suspiciousLeadCodePoints.has(character.codePointAt(0) ?? 0))).toBe(false);
	});
});
