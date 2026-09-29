export class GeometryModel {
	// Row Geometry arrays
	public rowTops = new Float64Array(0);
	public rowHeights = new Float64Array(0);
	private rowCapacity = 0;
	private rowCount = 0;

	// Column Geometry arrays
	public colLefts = new Float64Array(0);
	public colWidths = new Float64Array(0);
	private colCapacity = 0;
	private colCount = 0;
	private allInvalid = false;
	private invalidRows = new Set<string>();
	private invalidColumns = new Set<string>();

	public init(): void {}

	public invalidateAll(): void {
		this.allInvalid = true;
	}

	public invalidateRows(rowIds: string[]): void {
		for (const rowId of rowIds) {
			this.invalidRows.add(rowId);
		}
	}

	public invalidateColumns(colIds: string[]): void {
		for (const colId of colIds) {
			this.invalidColumns.add(colId);
		}
	}

	public recomputeIfNeeded(): boolean {
		const changed = this.allInvalid || this.invalidRows.size > 0 || this.invalidColumns.size > 0;
		this.allInvalid = false;
		this.invalidRows.clear();
		this.invalidColumns.clear();
		return changed;
	}

	public updateColumns(widths: number[], defaultColWidth: number): void {
		const len = widths.length;
		if (len > this.colCapacity) {
			this.colCapacity = Math.max(len, this.colCapacity * 2);
			this.colWidths = new Float64Array(this.colCapacity);
			this.colLefts = new Float64Array(this.colCapacity);
		}
		this.colCount = len;

		let left = 0;
		for (let i = 0; i < len; i++) {
			const w = widths[i] !== undefined ? widths[i] : defaultColWidth;
			this.colWidths[i] = w;
			this.colLefts[i] = left;
			left += w;
		}
	}

	/** Convenience wrapper over {@link syncRows} for callers that already hold a height list. */
	public updateRows(heights: readonly number[], defaultRowHeight: number): void {
		this.syncRows(heights.length, (i) => (heights[i] !== undefined ? heights[i] : defaultRowHeight));
	}

	/**
	 * Brings row geometry in line with `count` rows whose heights are read by `readHeight`.
	 *
	 * Heights are written straight into the typed arrays (no intermediate list) and only
	 * rows whose height actually differs are written. Prefix sums are recomputed from the
	 * first changed index onward, so an unchanged sync costs one read pass and zero writes,
	 * and a single-row resize near the bottom touches only the rows below it.
	 *
	 * `fromIndex` lets a caller that knows rows before it are unchanged (e.g. a live
	 * reorder that reports its first moved index) skip reading them entirely.
	 *
	 * Returns the first index whose top/height changed, or -1 when nothing changed.
	 */
	public syncRows(count: number, readHeight: (index: number) => number, fromIndex = 0): number {
		const prevCount = this.rowCount;
		if (count > this.rowCapacity) {
			const nextCapacity = Math.max(count, this.rowCapacity * 2);
			const nextHeights = new Float64Array(nextCapacity);
			const nextTops = new Float64Array(nextCapacity);
			// Keep the still-valid prefix so the incremental prefix-sum pass below stays correct.
			nextHeights.set(this.rowHeights.subarray(0, prevCount));
			nextTops.set(this.rowTops.subarray(0, prevCount));
			this.rowCapacity = nextCapacity;
			this.rowHeights = nextHeights;
			this.rowTops = nextTops;
		}
		this.rowCount = count;

		const heights = this.rowHeights;
		let firstChanged = -1;
		const start = Math.max(0, Math.min(fromIndex, prevCount, count));
		for (let i = start; i < count; i++) {
			const h = readHeight(i);
			if (i >= prevCount || heights[i] !== h) {
				heights[i] = h;
				if (firstChanged < 0) firstChanged = i;
			}
		}
		if (firstChanged < 0) {
			// Pure truncation keeps every surviving top valid; only the count changed.
			return count !== prevCount ? count : -1;
		}

		const tops = this.rowTops;
		let top = firstChanged > 0 ? tops[firstChanged - 1] + heights[firstChanged - 1] : 0;
		for (let i = firstChanged; i < count; i++) {
			tops[i] = top;
			top += heights[i];
		}
		return firstChanged;
	}

	public getRowTop(rowIdx: number, defaultRowHeight: number): number {
		if (rowIdx >= 0 && rowIdx < this.rowCount) {
			return this.rowTops[rowIdx];
		}
		return rowIdx * defaultRowHeight;
	}

	public getRowHeight(rowIdx: number, defaultRowHeight: number): number {
		if (rowIdx >= 0 && rowIdx < this.rowCount) {
			return this.rowHeights[rowIdx];
		}
		return defaultRowHeight;
	}

	/** Returns the pixel offset of the bottom edge of a row. */
	public getRowBottom(rowIdx: number, defaultRowHeight: number): number {
		if (rowIdx >= 0 && rowIdx < this.rowCount) {
			return this.rowTops[rowIdx] + this.rowHeights[rowIdx];
		}
		return (rowIdx + 1) * defaultRowHeight;
	}

	/** Alias for getRowTop — pixel-first API consistency. */
	public getRowOffset(rowIdx: number, defaultRowHeight: number): number {
		return this.getRowTop(rowIdx, defaultRowHeight);
	}

	public getTotalHeight(defaultRowHeight: number): number {
		if (this.rowCount === 0) return 0;
		const lastIdx = this.rowCount - 1;
		return this.rowTops[lastIdx] + this.rowHeights[lastIdx];
	}

	public getRowCount(): number {
		return this.rowCount;
	}

	public getColLeft(colIdx: number, defaultColWidth: number): number {
		if (colIdx >= 0 && colIdx < this.colCount) {
			return this.colLefts[colIdx];
		}
		return colIdx * defaultColWidth;
	}

	public getColWidth(colIdx: number, defaultColWidth: number): number {
		if (colIdx >= 0 && colIdx < this.colCount) {
			return this.colWidths[colIdx];
		}
		return defaultColWidth;
	}

	public getTotalWidth(defaultColWidth: number): number {
		if (this.colCount === 0) return 0;
		const lastIdx = this.colCount - 1;
		return this.colLefts[lastIdx] + this.colWidths[lastIdx];
	}

	public getColumnCount(): number {
		return this.colCount;
	}

	/**
	 * Maps pixel offsets to row and column indexes with binary search.
	 */
	public getRowIndexAtOffset(offset: number): number {
		const len = this.rowCount;
		if (len === 0) return 0;

		let low = 0;
		let high = len - 1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const pos = this.rowTops[mid];

			if (pos <= offset) {
				if (mid === len - 1 || this.rowTops[mid + 1] > offset) {
					return mid;
				}
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		return 0;
	}

	public getColIndexAtOffset(offset: number): number {
		const len = this.colCount;
		if (len === 0) return 0;

		let low = 0;
		let high = len - 1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const pos = this.colLefts[mid];

			if (pos <= offset) {
				if (mid === len - 1 || this.colLefts[mid + 1] > offset) {
					return mid;
				}
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		return 0;
	}
}
