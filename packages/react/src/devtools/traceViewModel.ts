import type { GridCausalEvent, GridCausalTraceEnvelope, GridCausalTraceSnapshot, GridCellExplanation } from '@eregister/open-grid-core/experimental';

export type TraceWorkspace = 'why' | 'timeline' | 'performance' | 'faults';
export type TraceFilter = 'all' | GridCausalEvent['type'];

export interface TimelineGroup {
	key: string;
	label: string;
	events: readonly GridCausalTraceEnvelope[];
}

export interface FrameDistribution {
	frames: readonly Extract<GridCausalEvent, { type: 'frame' }>[];
	maxDurationMs?: number;
	p95DurationMs?: number;
	slowFrameCount: number;
	unknownDurations: number;
	maxCellsWritten: number;
	maxRowsVisited: number;
	unknownMetrics: number;
}

type ExplanationRowField = 'lastChange' | 'commit' | 'invalidation' | 'frame';

export interface ExplanationRow {
	readonly field: ExplanationRowField;
	readonly evidence: GridCellExplanation[ExplanationRowField];
}

export const SLOW_FRAME_THRESHOLD_MS = 16.7;

const searchableText = (entry: GridCausalTraceEnvelope): string => JSON.stringify(entry.event).toLocaleLowerCase();

export function filterTraceEvents(snapshot: GridCausalTraceSnapshot, filter: TraceFilter, query: string): readonly GridCausalTraceEnvelope[] {
	const normalized = query.trim().toLocaleLowerCase();
	const matches = new Set(
		snapshot.events.filter(
			(entry) => (filter === 'all' || entry.event.type === filter) && (!normalized || searchableText(entry).includes(normalized))
		)
	);
	if (filter !== 'all') return [...matches];
	if (matches.size === snapshot.events.length) return snapshot.events;
	return groupTimeline(snapshot.events).flatMap((group) => (group.events.some((entry) => matches.has(entry)) ? group.events : []));
}

export function groupTimeline(events: readonly GridCausalTraceEnvelope[]): readonly TimelineGroup[] {
	const attemptByChange = new Map<number, number>();
	for (const entry of events)
		if (entry.event.type === 'commit-outcome' && entry.event.changeId !== undefined)
			attemptByChange.set(entry.event.changeId, entry.event.attemptId);
	const groups = new Map<string, GridCausalTraceEnvelope[]>();
	for (const entry of events) {
		const event = entry.event;
		const changeIds =
			event.type === 'frame' || event.type === 'fallback'
				? event.changeIds
				: 'changeId' in event && event.changeId !== undefined
					? [event.changeId]
					: [];
		const attempts = changeIds.map((changeId) => attemptByChange.get(changeId)).filter((attempt): attempt is number => attempt !== undefined);
		const key =
			event.type === 'commit-request' || event.type === 'commit-outcome'
				? `attempt:${event.attemptId}`
				: attempts.length
					? `attempt:${[...new Set(attempts)].join('+')}`
					: changeIds.length
						? `change:${changeIds.join('+')}`
						: `event:${entry.sequence}`;
		const group = groups.get(key) ?? [];
		group.push(entry);
		groups.set(key, group);
	}
	return [...groups].map(([key, entries]) => ({ key, label: key.replace(':', ' #'), events: entries }));
}

export function buildFrameDistribution(snapshot: GridCausalTraceSnapshot): FrameDistribution {
	const frames = snapshot.events.flatMap((entry) => (entry.event.type === 'frame' ? [entry.event] : []));
	const durations = frames.flatMap((frame) => (frame.durationMs === undefined ? [] : [frame.durationMs])).sort((a, b) => a - b);
	return {
		frames,
		maxDurationMs: durations.at(-1),
		// Nearest-rank percentile: the smallest observed value whose cumulative rank is at least 95%.
		p95DurationMs: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : undefined,
		slowFrameCount: durations.filter((duration) => duration >= SLOW_FRAME_THRESHOLD_MS).length,
		unknownDurations: frames.length - durations.length,
		maxCellsWritten: Math.max(0, ...frames.map((frame) => frame.cellsWritten ?? 0)),
		maxRowsVisited: Math.max(0, ...frames.map((frame) => frame.rowsVisited ?? 0)),
		unknownMetrics: frames.filter((frame) => frame.cellsWritten === undefined || frame.rowsVisited === undefined).length,
	};
}

export function explanationRows(explanation: GridCellExplanation | null): readonly ExplanationRow[] {
	if (!explanation) return [];
	return (['lastChange', 'commit', 'invalidation', 'frame'] as const).map((field) => ({ field, evidence: explanation[field] }));
}

export function tracePrivacyLabel(snapshot: GridCausalTraceSnapshot): string {
	const hasFull = snapshot.events.some((entry) => entry.event.type === 'cell-change' && entry.event.value?.mode === 'full');
	const hasMetadata = snapshot.events.some((entry) => entry.event.type === 'cell-change' && entry.event.value?.mode === 'metadata');
	return hasFull ? 'Full values captured' : hasMetadata ? 'Metadata only' : 'No values captured';
}
