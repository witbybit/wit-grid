import type { ColumnInstanceId } from '../columnDef.js';
import { isRowVersionFresh, isVisualFresh, type VisualFreshness } from './visualFreshness.js';

export type HtmlSnapshotPolicy = 'row-version-only' | 'visual';

export interface HtmlScrollSnapshot {
	readonly rowId: string;
	readonly columnInstanceId: ColumnInstanceId;
	readonly colField: string;
	readonly freshness: VisualFreshness;
	readonly rowHeight: number | undefined;
	readonly colWidth: number | undefined;
	readonly html: string;
	readonly estimatedBytes: number;
	readonly capturedAtEpoch: number;
	lastUsedEpoch: number;
	readonly capturedAtSequence?: number;
	lastUsedSequence?: number;
}

export interface HtmlScrollSnapshotStoreStats {
	readonly entries: number;
	readonly bytesRetained: number;
	readonly evictions: number;
}

export interface HtmlScrollSnapshotStoreOptions {
	maxEntries?: number;
	maxSingleEntryBytes?: number;
}

function buildKey(rowId: string, columnInstanceId: ColumnInstanceId | string): string {
	return `${rowId}\0${columnInstanceId}`;
}

function matchesFreshness(entry: VisualFreshness, expected: VisualFreshness, policy: HtmlSnapshotPolicy): boolean {
	return policy === 'row-version-only' ? isRowVersionFresh(entry.rowVersion, expected.rowVersion) : isVisualFresh(entry, expected);
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export class HtmlScrollSnapshotStore {
	private readonly entries = new Map<string, HtmlScrollSnapshot>();
	private bytesRetained = 0;
	private evictions = 0;
	private epoch = 0;
	private readonly maxEntries: number | undefined;
	private readonly maxSingleEntryBytes: number | undefined;

	constructor(
		private readonly maxBytes: number = DEFAULT_MAX_BYTES,
		options?: HtmlScrollSnapshotStoreOptions
	) {
		this.maxEntries = options?.maxEntries;
		this.maxSingleEntryBytes = options?.maxSingleEntryBytes;
	}

	public getFresh(input: {
		rowId: string;
		columnInstanceId: ColumnInstanceId;
		expectedFreshness: VisualFreshness;
		rowHeight?: number;
		colWidth?: number;
		policy: HtmlSnapshotPolicy;
	}): HtmlScrollSnapshot | undefined {
		const key = buildKey(input.rowId, input.columnInstanceId);
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (!entry.html) return undefined;
		if (!matchesFreshness(entry.freshness, input.expectedFreshness, input.policy)) return undefined;
		if (input.rowHeight !== undefined && entry.rowHeight !== undefined && input.rowHeight !== entry.rowHeight) return undefined;
		if (input.colWidth !== undefined && entry.colWidth !== undefined && input.colWidth !== entry.colWidth) return undefined;
		entry.lastUsedEpoch = ++this.epoch;
		entry.lastUsedSequence = entry.lastUsedEpoch;
		this.entries.delete(key);
		this.entries.set(key, entry);

		return entry;
	}

	public get(
		rowId: string,
		columnInstanceId: ColumnInstanceId | string,
		expectedFreshness: VisualFreshness,
		options?: { rowHeight?: number; colWidth?: number; mode?: HtmlSnapshotPolicy }
	): HtmlScrollSnapshot | undefined {
		return this.getFresh({
			rowId,
			columnInstanceId: columnInstanceId as ColumnInstanceId,
			expectedFreshness,
			rowHeight: options?.rowHeight,
			colWidth: options?.colWidth,
			policy: options?.mode ?? 'visual',
		});
	}

	public set(snapshot: HtmlScrollSnapshot): void;
	public set(
		rowId: string,
		columnInstanceId: ColumnInstanceId | string,
		html: string,
		freshness: VisualFreshness,
		rowHeight?: number,
		colWidth?: number
	): void;
	public set(
		snapshotOrRowId: HtmlScrollSnapshot | string,
		columnInstanceId?: ColumnInstanceId | string,
		html?: string,
		freshness?: VisualFreshness,
		rowHeight?: number,
		colWidth?: number
	): void {
		const snapshot =
			typeof snapshotOrRowId === 'string'
				? this.createSnapshot({
						rowId: snapshotOrRowId,
						columnInstanceId: columnInstanceId as ColumnInstanceId,
						colField: String(columnInstanceId),
						html: html ?? '',
						freshness: freshness!,
						rowHeight,
						colWidth,
					})
				: snapshotOrRowId;
		if (this.maxSingleEntryBytes !== undefined && snapshot.estimatedBytes > this.maxSingleEntryBytes) return;
		const key = buildKey(snapshot.rowId, snapshot.columnInstanceId);
		this.deleteByKey(key);
		this.entries.set(key, snapshot);
		this.bytesRetained += snapshot.estimatedBytes;
		this.evictWhileOverBudget();
	}

	public createSnapshot(input: {
		rowId: string;
		columnInstanceId: ColumnInstanceId;
		colField: string;
		html: string;
		freshness: VisualFreshness;
		rowHeight: number | undefined;
		colWidth: number | undefined;
	}): HtmlScrollSnapshot {
		const epoch = ++this.epoch;
		return {
			rowId: input.rowId,
			columnInstanceId: input.columnInstanceId,
			colField: input.colField,
			freshness: input.freshness,
			rowHeight: input.rowHeight,
			colWidth: input.colWidth,
			html: input.html,
			estimatedBytes: input.html.length,
			capturedAtEpoch: epoch,
			lastUsedEpoch: epoch,
			capturedAtSequence: epoch,
			lastUsedSequence: epoch,
		};
	}

	public delete(rowId: string, columnInstanceId: ColumnInstanceId | string): void {
		this.deleteByKey(buildKey(rowId, columnInstanceId));
	}

	public clear(): void {
		this.entries.clear();
		this.bytesRetained = 0;
	}

	public getStats(): HtmlScrollSnapshotStoreStats {
		return { entries: this.entries.size, bytesRetained: this.bytesRetained, evictions: this.evictions };
	}

	private deleteByKey(key: string): void {
		const existing = this.entries.get(key);
		if (!existing) return;
		this.bytesRetained -= existing.estimatedBytes;
		this.entries.delete(key);
	}

	private evictWhileOverBudget(): void {
		while (
			(this.bytesRetained > this.maxBytes || (this.maxEntries !== undefined && this.entries.size > this.maxEntries)) &&
			this.entries.size > 1
		) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			this.deleteByKey(oldestKey);
			this.evictions++;
		}
	}
}
