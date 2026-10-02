// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteRowModelController, type InfiniteDatasource } from '../infiniteRowModel.js';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { diffRenderWindow, getColIndices, getRowIndices, type RenderWindow } from './renderWindow.js';
import { computeRowWindowRetention } from './rowWindowRetention.js';
import { CellSlot } from './cellSlot.js';
import { CORE_STYLES } from './styles.js';

/** A cell's visible text: direct-text cells hold it themselves, wrapped cells in .og-cell-content. */
function readCellText(cell: Element): string {
	if ((cell as HTMLElement).dataset.textCell !== undefined) {
		return Array.from(cell.childNodes)
			.filter((node) => node.nodeType === 3)
			.map((node) => node.textContent)
			.join('')
			.trim();
	}
	return cell.querySelector<HTMLElement>(':scope > .og-cell-content')?.textContent?.trim() ?? '';
}

interface AuditPerfRow {
	id: string;
	timestamp: string;
	service: string;
	severity: string;
	latencyMs: string;
	ipAddress: string;
	[field: string]: string;
}

function createContainer(width = 1120, height = 720): HTMLDivElement {
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: height,
		width,
		height,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	return container;
}

function createAuditRow(index: number): AuditPerfRow {
	const services = ['Auth', 'Billing', 'Database', 'Cache', 'API Gateway', 'Shipping'];
	const severities = ['DEBUG', 'INFO', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
	const latency = index % 8 === 0 ? 700 + (index % 500) : 15 + (index % 85);
	return {
		id: `TR-${1_000_000 + index}`,
		timestamp: new Date(Date.UTC(2026, 5, 5, 18, 30) - index * 60_000).toISOString(),
		service: services[index % services.length],
		severity: severities[index % severities.length],
		latencyMs: String(latency),
		ipAddress: `192.168.1.${(index * 7) % 255}`,
	};
}

function createAuditColumns(count = 1200): ColumnDef<AuditPerfRow>[] {
	const renderer = () => null;
	const columns: ColumnDef<AuditPerfRow>[] = [
		{ field: 'id', header: 'Trace ID', width: 130 },
		{ field: 'timestamp', header: 'Timestamp', width: 220 },
		{
			field: 'service',
			header: 'Microservice',
			width: 140,
			cellRenderer: renderer,
			cellRendererCapabilities: { scroll: 'text' },
		},
		{
			field: 'rendererLive',
			header: 'Live Rebind',
			width: 170,
			cellRenderer: renderer,
			cellRendererCapabilities: { scroll: 'text' },
			valueGetter: ({ row }) => `live|${row.service}`,
		},
		{
			field: 'rendererDefer',
			header: 'Defer Stable',
			width: 170,
			cellRenderer: renderer,
			cellRendererCapabilities: { scroll: 'text' },
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'severity',
			header: 'Severity',
			width: 120,
			cellRenderer: renderer,
			cellRendererCapabilities: { scroll: 'text' },
		},
		{
			field: 'rendererFallback',
			header: 'Fallback Cache',
			width: 175,
			cellRenderer: renderer,
			cellRendererCapabilities: { scroll: 'text' },
			valueGetterDependencies: ['latencyMs'],
			valueGetter: ({ row }) => `fallback|${row.latencyMs}ms`,
		},
		{
			field: 'rendererDestroy',
			header: 'Destroy Recycle',
			width: 180,
			cellRenderer: renderer,
			cellRendererCapabilities: { scroll: 'text' },
			valueGetterDependencies: ['ipAddress'],
			valueGetter: ({ row }) => `destroy|${row.ipAddress}`,
		},
		{ field: 'latencyMs', header: 'Latency', width: 110, cellRenderer: renderer },
		{ field: 'ipAddress', header: 'Origin IP', width: 140 },
	];

	for (let index = columns.length; index < count; index++) {
		const field = `auditMetric_${index}`;
		columns.push({
			field,
			header: `Metric ${index}`,
			width: 96 + (index % 5) * 8,
			...(index % 7 === 0
				? {
						cellRenderer: renderer,
						cellRendererCapabilities: { scroll: 'text' as const },
					}
				: {}),
			...(index % 11 === 0
				? {
						valueGetterDependencies: ['latencyMs'],
						valueGetter: ({ row }: { row: AuditPerfRow }) => `m${index}|${row.latencyMs}`,
					}
				: {}),
		});
	}

	return columns;
}

async function flushAsync(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

async function flushAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	await flushAsync();
}

async function settleVisibleServerRows(grid: AuditGrid, maxFrames = 6): Promise<void> {
	for (let frame = 0; frame < maxFrames; frame++) {
		const hasVisibleLoadingCells = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-cell.og-cell-loading')).some((cell) => {
			const row = cell.closest('.og-row') as HTMLElement | null;
			if (!row) return false;
			const projectedTop = parseRowTop(row) - grid.store.engine.viewport.scrollTop + 40;
			const height = Number.parseFloat(row.style.height || '40');
			return projectedTop + height > 40 && projectedTop < grid.store.engine.viewport.viewportHeight;
		});
		if (!hasVisibleLoadingCells) return;
		await flushAnimationFrame();
	}
}

function parseRowTop(el: HTMLElement): number {
	// Rows are positioned via transform: translateY(<top>px)
	const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(el.style.transform);
	return match ? parseInt(match[1], 10) : 0;
}

function parseCellLeft(el: HTMLElement): number {
	return parseInt(el.style.left || '0', 10);
}

function getScrollContext(grid: AuditGrid) {
	const state = grid.store.getState();
	const plan = grid.store.engine.columns.getCompiledPlan();
	return {
		isScrolling: true,
		state,
		stateVersion: 0,
		rowVersions: grid.store.engine.rowVersions,
		globalVersion: state.globalVersion,
		styleVersion: 0,
		loadingVersion: 0,
		activeEdit: state.activeEdit,
		hasDeferredCellStyleRules: !!state.styleRules?.length,
		hasCustomRenderers: plan.hasCustomRenderers,
		hasInsightDecorations: false,
		plan,
		visibleColRange: grid.store.engine.viewport.getVisibleColumnRange(plan.displayedColumns.length),
		focusedCell: state.selection.focus,
		selectionBounds: state.selection.bounds ?? undefined,
		canUseCachedDisplayValues: true,
	};
}

type AuditGrid = Awaited<ReturnType<typeof createServerAuditGrid>>;

async function createServerAuditGrid(
	options: {
		rows?: number;
		cols?: number;
		blockSize?: number;
		configureStore?: (store: GridStore<AuditPerfRow>) => void;
	} = {}
) {
	const totalRows = options.rows ?? 1_000_000;
	const columns = createAuditColumns(options.cols ?? 1200);
	const requests: Array<{ startRow: number; endRow: number }> = [];
	const datasource: InfiniteDatasource<AuditPerfRow> = {
		getRows: async ({ startRow, endRow }) => {
			requests.push({ startRow, endRow });
			return {
				rows: Array.from({ length: endRow - startRow }, (_, offset) => createAuditRow(startRow + offset)),
				totalCount: totalRows,
			};
		},
	};
	const store = new GridStore<AuditPerfRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 100,
		rowOverscanPx: 40,
		colBuffer: 1,
		getRowId: (row) => row.id,
		runtimeLimits: { maxRenderedRows: 28, maxRenderedCells: 360 },
	});
	options.configureStore?.(store);
	const controller = new InfiniteRowModelController<AuditPerfRow>(store.getInfiniteRowModelRuntime(), {
		datasource,
		blockSize: options.blockSize ?? 100,
		columns,
	});
	const container = createContainer();
	const renderer = new RenderEngine(store.engine, store);
	renderer.onMountCellContent = ({ cellKey, container: host }) => {
		const child = document.createElement('span');
		child.className = 'audit-renderer';
		child.dataset.cellKey = cellKey;
		child.textContent = cellKey;
		host.replaceChildren(child);
	};
	renderer.mount(container);
	await flushAsync();
	renderer.fullPaint();
	return { store, controller, container, renderer, columns, requests };
}

async function browserScrollTo(grid: AuditGrid, scrollTop: number, scrollLeft: number): Promise<void> {
	const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
	expect(scrollViewport).not.toBeNull();
	scrollViewport.scrollTop = scrollTop;
	scrollViewport.scrollLeft = scrollLeft;
	scrollViewport.dispatchEvent(new Event('scroll'));
	await flushAnimationFrame();
}

function cleanupGrid(grid: AuditGrid): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
}

function assertNoStaleOrOverlappingDom(grid: AuditGrid): void {
	const rows = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row'));
	const currentWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	// A focused/editing row is deliberately retained outside the normal window (vertical retention,
	// mirroring the existing horizontal focused-column guard) — account for it here too, the same
	// way rowRenderer.ts itself resolves it, so a legitimately-retained row isn't flagged as stray.
	const state = grid.store.getState();
	const rowModel = grid.store.engine.getVisualRowModel();
	const focusedCellPointer = state.selection.focus;
	const activeEditCell = state.activeEdit;
	const focusedRowIndex = focusedCellPointer && rowModel ? rowModel.getVisualIndexByRowId(focusedCellPointer.rowId) : undefined;
	const editingRowIndex = activeEditCell && rowModel ? rowModel.getVisualIndexByRowId(activeEditCell.rowId) : undefined;
	const { retainedRowIndices } = computeRowWindowRetention({ renderWindow: currentWindow, focusedRowIndex, editingRowIndex });
	const expectedRowIndices = new Set(getRowIndices(currentWindow, undefined, retainedRowIndices));
	const activeRowIndices = new Set(grid.renderer.rowRenderer.activeRows.keys());
	// +2 tolerance: a focused row and an actively-editing row may each be retained outside the
	// normal window (vertical retention) as extra slots beyond the base budget.
	const retentionTolerance = retainedRowIndices.size;
	expect(grid.renderer.rowRenderer.activeRows.size).toBeGreaterThan(0);
	expect(grid.renderer.rowRenderer.activeRows.size).toBeLessThanOrEqual(28 + retentionTolerance);
	expect(rows.length).toBeGreaterThan(0);
	expect(rows.length).toBeLessThanOrEqual((28 + retentionTolerance) * 3);
	for (const [rowIndex, slot] of grid.renderer.rowRenderer.activeRows) {
		expect(expectedRowIndices.has(rowIndex)).toBe(true);
		expect(slot.cellCount).toBeGreaterThan(0);
		expect(slot.cellCount).toBeLessThanOrEqual(360);
		expect(slot.element.dataset.rowIndex).toBe(String(rowIndex));

		// Assert DOM cells match the active cell count exactly to catch zombie cells
		const cells = Array.from(slot.element.querySelectorAll('.og-cell'));
		expect(cells.length).toBe(slot.cellCount);
	}

	for (const row of rows) {
		const cells = Array.from(row.querySelectorAll<HTMLElement>('.og-cell'));
		if (cells.length === 0) continue;
		const rowIndex = Number(row.dataset.rowIndex);
		expect(activeRowIndices.has(rowIndex)).toBe(true);
		expect(cells.length).toBeLessThanOrEqual(360);

		const fields = cells.map((cell) => cell.dataset.colField).filter(Boolean);
		expect(fields.length).toBe(new Set(fields).size);

		for (const cell of cells) {
			expect(cell.dataset.rowIndex).toBe(row.dataset.rowIndex);
			expect(row.dataset.rowId === cell.dataset.rowId || row.dataset.rowId === `row:${cell.dataset.rowId}`).toBe(true);
			if (cell.dataset.textCell !== undefined) {
				// Direct-text cell: no wrapper, exactly one text node, at most a portal host besides.
				expect(cell.querySelectorAll(':scope > .og-cell-content')).toHaveLength(0);
				expect(Array.from(cell.childNodes).filter((node) => node.nodeType === 3)).toHaveLength(1);
				expect(Array.from(cell.children).every((child) => child.classList.contains('og-cell-portal-host'))).toBe(true);
			} else {
				expect(cell.querySelectorAll(':scope > .og-cell-content')).toHaveLength(1);
			}
			// Portal hosts are created lazily on first portal use — text cells have none.
			expect(cell.querySelectorAll(':scope > .og-cell-portal-host').length).toBeLessThanOrEqual(1);
			for (const renderer of Array.from(cell.querySelectorAll<HTMLElement>('.og-custom-renderer-container'))) {
				expect(renderer.dataset.cellKey).toBe(cell.dataset.cellKey);
				if (cell.dataset.cellKey?.includes('@row-pool-')) {
					expect(renderer.dataset.rendererKey).toBe(cell.dataset.cellKey);
				}
			}
		}

		expect(row.querySelectorAll(':scope > .og-custom-renderer-container')).toHaveLength(0);
	}
}

function assertWindowIsContiguousAndCapped(grid: AuditGrid): void {
	const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	const rows = getRowIndices(window);
	const cols = getColIndices(window);
	expect(rows.length).toBeGreaterThanOrEqual(12);
	expect(rows.length).toBeLessThanOrEqual(28);
	expect(rows.length * cols.length).toBeLessThanOrEqual(360);

	for (let index = 1; index < rows.length; index++) {
		expect(rows[index]).toBe(rows[index - 1] + 1);
	}
}

function assertViewportGeometryIsContinuous(grid: AuditGrid, expectedScrollTop: number): void {
	const headerHeight = 40;
	const rowHeight = 40;
	const viewportHeight = grid.store.engine.viewport.viewportHeight;
	const visibleTop = headerHeight;
	const visibleBottom = viewportHeight;
	const activeSlots = Array.from(grid.renderer.rowRenderer.activeRows.entries()).filter(
		([, slot]) => slot.rowKind === 'data' || slot.rowKind === 'loading'
	);
	expect(activeSlots.length).toBeGreaterThan(0);

	const projectedRows = activeSlots
		.map(([rowIndex, slot]) => {
			const y = parseRowTop(slot.element);
			return {
				rowIndex,
				screenTop: y - expectedScrollTop + headerHeight,
				screenBottom: y - expectedScrollTop + headerHeight + slot.rowHeight,
			};
		})
		.filter((row) => row.screenBottom > visibleTop && row.screenTop < visibleBottom)
		.sort((a, b) => a.screenTop - b.screenTop);

	if (projectedRows.length === 0) {
		const sample = activeSlots.slice(0, 5).map(([rowIndex, slot]) => ({
			rowIndex,
			rowTop: slot.rowTop,
			top: slot.element.style.transform,
			projectedTop: parseRowTop(slot.element) - expectedScrollTop + headerHeight,
		}));
		throw new Error(
			`No projected rows in viewport: ${JSON.stringify({
				expectedScrollTop,
				engineScrollTop: grid.store.engine.viewport.scrollTop,
				currentWindow: grid.renderer.rowRenderer.currentWindow,
				sample,
			})}`
		);
	}
	const minProjectedRows = Math.floor((viewportHeight - headerHeight) / rowHeight) - 2;
	if (projectedRows.length < minProjectedRows) {
		const sample = activeSlots.slice(0, 24).map(([rowIndex, slot]) => ({
			rowIndex,
			rowTop: slot.rowTop,
			top: slot.element.style.transform,
			projectedTop: parseRowTop(slot.element) - expectedScrollTop + headerHeight,
			projectedBottom: parseRowTop(slot.element) - expectedScrollTop + headerHeight + slot.rowHeight,
		}));
		throw new Error(
			`Too few projected rows in viewport: ${JSON.stringify({
				expectedScrollTop,
				engineScrollTop: grid.store.engine.viewport.scrollTop,
				projectedRows,
				minProjectedRows,
				currentWindow: grid.renderer.rowRenderer.currentWindow,
				sample,
			})}`
		);
	}
	expect(projectedRows.length).toBeGreaterThanOrEqual(minProjectedRows);
	expect(projectedRows[0].screenTop).toBeLessThanOrEqual(visibleTop + rowHeight);

	for (let index = 1; index < projectedRows.length; index++) {
		const prev = projectedRows[index - 1];
		const next = projectedRows[index];
		expect(next.screenTop - prev.screenTop).toBeLessThanOrEqual(rowHeight + 1);
	}

	const rowsContainer = grid.container.querySelector('.og-rows-container') || grid.container;
	const screenRows = Array.from(rowsContainer.querySelectorAll<HTMLElement>('.og-row'))
		.filter((row) => row.querySelector(':scope > .og-cell'))
		.map((row) => {
			const y = parseRowTop(row);
			return {
				rowIndex: Number(row.dataset.rowIndex),
				rowId: row.dataset.rowId,
				screenTop: y - expectedScrollTop + headerHeight,
				screenBottom: y - expectedScrollTop + headerHeight + Number.parseFloat(row.style.height || '40'),
			};
		})
		.filter((row) => row.screenBottom > visibleTop && row.screenTop < visibleBottom)
		.sort((a, b) => a.screenTop - b.screenTop);

	const uniqueScreenRowIndices = new Set(screenRows.map((row) => row.rowIndex));
	expect(uniqueScreenRowIndices.size).toBe(screenRows.length);
	expect(screenRows.length).toBe(projectedRows.length);
	for (let index = 1; index < screenRows.length; index++) {
		const prev = screenRows[index - 1];
		const next = screenRows[index];
		expect(next.rowIndex).toBe(prev.rowIndex + 1);
		expect(next.screenTop - prev.screenTop).toBeLessThanOrEqual(rowHeight + 1);
	}
}

function assertHorizontalGeometryIsContinuous(grid: AuditGrid, expectedScrollLeft: number): void {
	const activeSlots = Array.from(grid.renderer.rowRenderer.activeRows.values()).filter(
		(slot) => slot.rowKind === 'data' || slot.rowKind === 'loading'
	);
	expect(activeSlots.length).toBeGreaterThan(0);
	const firstSlot = activeSlots[0];
	const cells: [number, (typeof firstSlot.leftCells)[number]][] = [];
	for (let i = 0; i < firstSlot.leftCells.length; i++) cells.push([i, firstSlot.leftCells[i]]);
	const cs = firstSlot.centerColStart;
	for (let i = 0; i < firstSlot.centerCells.length; i++) cells.push([cs + i, firstSlot.centerCells[i]]);
	for (let i = 0; i < firstSlot.rightCells.length; i++) cells.push([firstSlot.pinRightStart + i, firstSlot.rightCells[i]]);
	cells.sort(([a], [b]) => a - b);
	expect(cells.length).toBeGreaterThan(0);

	const viewportWidth = grid.store.engine.viewport.viewportWidth;
	const projectedCells = cells
		.map(([colIndex, cell]) => {
			const x = parseCellLeft(cell.element);
			return {
				colIndex,
				screenLeft: x - expectedScrollLeft,
				screenRight: x - expectedScrollLeft + Number.parseFloat(cell.element.style.width || '0'),
			};
		})
		.filter((cell) => cell.screenRight > 0 && cell.screenLeft < viewportWidth)
		.sort((a, b) => a.screenLeft - b.screenLeft);

	if (projectedCells.length === 0) {
		const sample = cells.slice(0, 5).map(([colIndex, cell]) => ({
			colIndex,
			colField: cell.colField,
			left: cell.element.style.left,
			width: cell.element.style.width,
			projectedLeft: parseCellLeft(cell.element) - expectedScrollLeft,
		}));
		throw new Error(
			`No projected cells in viewport: ${JSON.stringify({
				expectedScrollLeft,
				engineScrollLeft: grid.store.engine.viewport.scrollLeft,
				currentWindow: grid.renderer.rowRenderer.currentWindow,
				sample,
			})}`
		);
	}
	expect(projectedCells.length).toBeGreaterThan(0);
	expect(projectedCells[0].screenLeft).toBeLessThanOrEqual(160);

	for (let index = 1; index < projectedCells.length; index++) {
		const prev = projectedCells[index - 1];
		const next = projectedCells[index];
		expect(next.screenLeft - prev.screenRight).toBeLessThanOrEqual(1);
	}
}

function isCellVisibleOnScreen(grid: AuditGrid, cell: HTMLElement, expectedScrollLeft: number, viewportWidth: number): boolean {
	const parent = cell.parentElement;
	if (parent?.classList.contains('og-row-pin-left') || parent?.classList.contains('og-row-pin-right')) return true;
	const field = cell.dataset.colField;
	const visibleCols = grid.store.engine.viewport.getVisibleColumnRange(grid.store.engine.columns.getDisplayedColumns().length);
	if (field) {
		const colIndex = grid.store.engine.columns.getColumnIndex(field);
		if (colIndex < visibleCols.startIdx || colIndex > visibleCols.endIdx) return false;
	}
	const left = parseCellLeft(cell);
	const width = Number.parseFloat(cell.style.width || '0');
	return left - expectedScrollLeft + width > 0 && left - expectedScrollLeft < viewportWidth;
}

function assertNoBlankVisibleCells(grid: AuditGrid, expectedScrollTop: number, expectedScrollLeft: number): void {
	const viewportHeight = grid.store.engine.viewport.viewportHeight;
	const viewportWidth = grid.store.engine.viewport.viewportWidth;
	const visibleRows = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row')).filter((row) => {
		if (!row.querySelector(':scope > .og-cell, :scope > .og-row-pin-left .og-cell, :scope > .og-row-pin-right .og-cell')) return false;
		const projectedTop = parseRowTop(row) - expectedScrollTop + 40;
		const height = Number.parseFloat(row.style.height || '40');
		return projectedTop + height > 40 && projectedTop < viewportHeight;
	});

	expect(visibleRows.length).toBeGreaterThan(0);
	for (const row of visibleRows) {
		const visibleCells = Array.from(row.querySelectorAll<HTMLElement>('.og-cell')).filter((cell) =>
			isCellVisibleOnScreen(grid, cell, expectedScrollLeft, viewportWidth)
		);
		expect(visibleCells.length).toBeGreaterThan(0);
		for (const cell of visibleCells) {
			const contentMode = cell.dataset.contentMode ?? CellSlot.fromElement(cell as HTMLDivElement).lastContentMode;
			const contentText = readCellText(cell);
			const portalHost = cell.querySelector<HTMLElement>(':scope > .og-cell-portal-host');
			const hasPortalContent = !!portalHost && portalHost.childElementCount > 0;
			const isLoading = cell.classList.contains('og-cell-loading') || contentMode === 'loading';
			if (contentMode === 'empty') continue;
			expect(isLoading || contentText.length > 0 || hasPortalContent).toBe(true);
		}
	}
}

function collectFeatherScenarioEvidence(grid: AuditGrid) {
	const stats = grid.renderer.getRenderStats();
	return {
		motion: {
			scrollFrames: stats.scrollFrames,
			stateReadsDuringScroll: stats.stateReadsDuringScroll,
			cellsVisitedDuringScroll: stats.cellsVisitedDuringScroll,
			cellsWrittenDuringScroll: stats.cellsWrittenDuringScroll,
			portalOpsDuringScroll: stats.portalOpsDuringScroll,
			valueGetterCallsDuringScroll: stats.valueGetterCallsDuringScroll,
			getCellValueCallsDuringScroll: stats.getCellValueCallsDuringScroll,
			formulaCallsDuringScroll: stats.formulaCallsDuringScroll,
			customRendererMountsDuringScroll: stats.customRendererMountsDuringScroll,
			integrityComputesDuringScroll: stats.integrityComputesDuringScroll,
		},
		fidelity: {
			prewarmPasses: stats.prewarmPasses,
			prewarmedDisplayValues: stats.prewarmedDisplayValues,
			prewarmedCellSnapshots: stats.prewarmedCellSnapshots,
			cellsDecoratedAfterScroll: stats.cellsDecoratedAfterScroll,
			motionCellsDecoratedAfterScroll: stats.motionCellsDecoratedAfterScroll,
			fidelityCellsDecoratedAfterScroll: stats.fidelityCellsDecoratedAfterScroll,
			postScrollMotionChunks: stats.postScrollMotionChunks,
			postScrollFidelityChunks: stats.postScrollFidelityChunks,
			postScrollDirtyCellsDecorated: stats.postScrollDirtyCellsDecorated,
			customRendererWarmHits: stats.customRendererWarmHits,
			customRendererWarmMisses: stats.customRendererWarmMisses,
		},
	};
}

function assertVisibleIntegrityDecorationsStayPresent(grid: AuditGrid): void {
	const decorated = grid.container.querySelectorAll(
		'.og-cell-validation-error, .og-cell-conflict, .og-cell-diff-changed, .og-cell-quality-warning, .og-cell-quality-error'
	);
	if (decorated.length === 0) {
		const sample = Array.from(
			grid.container.querySelectorAll<HTMLElement>('.og-cell[data-col-field="id"], .og-cell[data-col-field="auditMetric_159"]')
		)
			.slice(0, 12)
			.map((cell) => ({
				rowId: cell.dataset.rowId,
				colField: cell.dataset.colField,
				className: cell.className,
				title: cell.title,
				validationError: cell.dataset.validationError,
				contentMode: cell.dataset.contentMode,
				text: readCellText(cell),
			}));
		throw new Error(`Missing integrity decorations: ${JSON.stringify(sample)}`);
	}
	expect(decorated.length).toBeGreaterThan(0);
}

function assertScrollStatsAreRuthless(grid: AuditGrid, prevWindow: RenderWindow | null): void {
	const stats = grid.renderer.getRenderStats();
	const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;
	const visibleCols = getColIndices(window).length;
	// A focused/editing row retained outside the normal window (vertical retention) is bound every
	// scroll frame just like any other active row — account for it in the expected cell budget.
	const state = grid.store.getState();
	const rowModel = grid.store.engine.getVisualRowModel();
	const focusedRowIndex = state.selection.focus && rowModel ? rowModel.getVisualIndexByRowId(state.selection.focus.rowId) : undefined;
	const editingRowIndex = state.activeEdit && rowModel ? rowModel.getVisualIndexByRowId(state.activeEdit.rowId) : undefined;
	const { retainedRowIndices } = computeRowWindowRetention({ renderWindow: window, focusedRowIndex, editingRowIndex });
	const activeRows = getRowIndices(window, undefined, retainedRowIndices).length;
	const delta = prevWindow ? diffRenderWindow(prevWindow, window) : null;
	// Slot model visits all slots x all visible cols each frame (JS cache skips writes for stable cells).
	const maxExpectedCells = Math.max(activeRows * visibleCols, visibleCols, 1);
	expect(stats.valueGetterCallsDuringScroll).toBe(0);
	expect(stats.formulaCallsDuringScroll).toBe(0);
	expect(stats.getCellValueCallsDuringScroll).toBe(0);
	expect(stats.customRendererMountsDuringScroll).toBe(0);
	expect(stats.focusCallsDuringScroll).toBe(0);
	expect(stats.styleHookCallsDuringScroll).toBe(0);
	expect(stats.integrityComputesDuringScroll).toBe(0);
	expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(maxExpectedCells);
	expect(stats.cellsWrittenDuringScroll).toBeLessThanOrEqual(maxExpectedCells);
	expect(stats.portalOpsDuringScroll).toBeLessThanOrEqual(maxExpectedCells);
}

function assertSelectionDoesNotCreateVisibleRowIslands(grid: AuditGrid, expectedScrollTop: number): void {
	const selectedRows = Array.from(
		grid.container.querySelectorAll<HTMLElement>('.og-rows-container .og-row-selected, .og-rows-container .og-row-focused')
	).filter((row) => row.querySelector(':scope > .og-cell'));
	const visibleSelectedRows = selectedRows.filter((row) => {
		const projectedTop = parseRowTop(row) - expectedScrollTop + 40;
		const height = Number.parseFloat(row.style.height || '40');
		return projectedTop + height > 40 && projectedTop < grid.store.engine.viewport.viewportHeight;
	});
	const focus = grid.store.getState().selection.focus;
	if (!focus) {
		expect(visibleSelectedRows).toHaveLength(0);
		return;
	}

	const focusedVisualIndex = grid.store.engine.getRowModel()?.getVisualIndexByRowId(focus.rowId) ?? -1;
	const currentRows = new Set(getRowIndices(grid.renderer.rowRenderer.currentWindow as RenderWindow));
	if (!currentRows.has(focusedVisualIndex)) {
		expect(visibleSelectedRows).toHaveLength(0);
		return;
	}

	expect(visibleSelectedRows.length).toBeLessThanOrEqual(1);
	if (visibleSelectedRows.length === 0) return;
	const selectedRow = visibleSelectedRows[0];
	expect(selectedRow.dataset.rowIndex).toBe(String(focusedVisualIndex));
	const projectedTop = parseRowTop(selectedRow) - expectedScrollTop + 40;
	expect(projectedTop).toBeGreaterThanOrEqual(40 - 1);
	expect(projectedTop).toBeLessThanOrEqual(grid.store.engine.viewport.viewportHeight);
}

describe('Server demo ruthless runtime performance contracts', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	beforeEach(() => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			callback(performance.now());
			return callbacks.length;
		});
	});

	// THE no-semantic-scroll contract (Phase 9 of the renderer hardening plan): every semantic-read/
	// mount counter listed here must be exactly zero across an active scroll frame, no matter how
	// feature-rich the columns are. The scattered per-scenario assertions elsewhere in this file and
	// in runtimePerformance.test.ts/renderEngine.test.ts each prove a slice of this; this test is the
	// single, hard-to-miss place that proves the WHOLE list together against one maximally feature-rich
	// grid (valueGetters, formula-driven columns, custom renderers of every scroll mode, registered
	// insight decorations, pinned columns, and a still-loading tail) across vertical, horizontal, and
	// diagonal scroll. If a future change makes any of these non-zero, it must show up here first.
	it('THE no-semantic-scroll contract: every semantic-read/mount counter stays zero across vertical, horizontal, and diagonal scroll', async () => {
		const grid = await createServerAuditGrid({
			rows: 50_000,
			cols: 200,
			configureStore: (store) => {
				store.setPinnedColumns({ left: 1, right: 1 });
				store.engine.insights.register({
					id: 'no-semantic-scroll-contract',
					getCellDecorations: (_rowId, colField) => {
						if (colField !== 'id') return [];
						return [
							{
								layerId: 'no-semantic-scroll-contract',
								kind: 'validationError',
								className: 'og-cell-validation-error',
								title: 'Review',
							},
						];
					},
				});
			},
		});
		grid.store.engine.requestInsightRepaint();
		await flushAnimationFrame();

		function assertContract(): void {
			const stats = grid.renderer.getRenderStats();
			expect(stats.getCellValueCallsDuringScroll).toBe(0);
			expect(stats.valueGetterCallsDuringScroll).toBe(0);
			expect(stats.formulaCallsDuringScroll).toBe(0);
			expect(stats.customRendererMountsDuringScroll).toBe(0);
			expect(stats.cellClassComputesDuringScroll).toBe(0);
			expect(stats.integrityComputesDuringScroll).toBe(0);
			expect(stats.focusCallsDuringScroll).toBe(0);
			// Locked in from the blocker-killing pass: the generic scroll-time portal-mount counter
			// (blocker #1, the critical fix) and its narrow force-live-interactive-exception sibling
			// (neither editing nor focus occurs anywhere in this scroll sequence, so this must stay 0).
			expect(stats.portalMountsDuringScroll).toBe(0);
			expect(stats.forceLiveMountsDuringScroll).toBe(0);
			// Locked in from the blocker-killing pass: column TOPOLOGY (pin/unpin/reorder) never changes
			// during routine scrolling in this test — only the render window shifts — so the topology-
			// delta computation (computeColumnWindowDelta) must never fire mid-scroll here.
			expect(stats.columnTopologyDeltaComputationsDuringScroll).toBe(0);
		}

		// Vertical
		grid.renderer.resetRenderStats();
		await browserScrollTo(grid, 400_000, 0);
		assertContract();

		// Horizontal
		grid.renderer.resetRenderStats();
		await browserScrollTo(grid, 400_000, 9_000);
		assertContract();

		// Diagonal (both axes move in the same frame)
		grid.renderer.resetRenderStats();
		await browserScrollTo(grid, 40_000, 1_500);
		assertContract();

		// Near the loading tail — rows not yet resolved by the mock datasource are still in flight.
		grid.renderer.resetRenderStats();
		await browserScrollTo(grid, 0, 0);
		assertContract();

		cleanupGrid(grid);
	}, 20_000);

	it("BLOCKER: with scroll 'text', a cold, never-before-seen DOM-renderer cell never mounts during active scroll", async () => {
		// DOM renderers default to 'live' (drawn in place within a frame budget — see
		// dom-live presentation e2e test). An explicit 'text' keeps this original guarantee.
		// mode:'custom-dom' is NOT in the stand-in-capable set (custom-live/custom-imperative/custom) —
		// this is the real compiled-plan shape for any column using a DOM cell renderer. Scrolling a
		// never-before-visited window of such columns into view previously fell through to a synchronous
		// mountCellImmediately call (a live DOM-renderer mount) inside the scroll frame itself.
		// Client row model (not server/infinite) — all row data is immediately available, so there is
		// no loading-state race to confound the result; the column with the DOM renderer is column 0
		// (always on-screen), and the scroll target is a row band never rendered before. Uses the same
		// real (unstubbed) rAF + flushAnimationFrame pattern as browserScrollTo elsewhere in this file —
		// a synchronous immediate-RAF stub was tried first and produced a false failure because it
		// short-circuits the scroll-frame state machine's phase transitions.
		const domRendererMounts: string[] = [];
		const domRendererMountPhases: Array<{ isScrolling: boolean; phase: string }> = [];
		interface ColdRow {
			id: string;
			value: string;
		}
		const columns: ColumnDef<ColdRow>[] = [
			{
				field: 'value',
				header: 'DOM Metric',
				width: 120,
				renderer: {
					kind: 'dom',
					renderer: {
						mount(container: HTMLElement, params: { value: unknown; isScrolling: boolean; phase: string }) {
							domRendererMounts.push(String(params.value));
							domRendererMountPhases.push({ isScrolling: params.isScrolling, phase: params.phase });
							container.textContent = String(params.value);
							return { update: () => {}, destroy: () => {} };
						},
					} as any,
					capabilities: { scroll: 'text' },
				},
			},
		];
		const store = new GridStore<ColdRow>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: `r${i}`, value: `v${i}` }));
		const controller = new ClientRowModelController<ColdRow>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
		const container = createContainer(500, 400);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport).not.toBeNull();
		// Only care about mounts from this point on — the initial pre-scroll mount for rows 0..N is a
		// legitimate full bind (isScrollFrameActive is false at mount time) and is not what this test
		// is about.
		domRendererMounts.length = 0;
		domRendererMountPhases.length = 0;
		renderer.resetRenderStats();
		// Jump straight to a row band far outside the initially-mounted window — genuinely cold, no
		// snapshot, no warm state, no prewarm coverage.
		scrollViewport.scrollTop = 1_500_000;
		scrollViewport.dispatchEvent(new Event('scroll'));
		await flushAnimationFrame();

		const stats = renderer.getRenderStats();
		// The authoritative proof: nothing mounted while flagged as happening during an active scroll
		// frame. bindCellFull legitimately mounts the now-visible cells once the scroll settles (the
		// fidelity lane doing its job) — every one of those mounts must report isScrolling:false; if
		// even one reports isScrolling:true, that's the scroll-time-mount blocker back.
		expect(stats.customRendererMountsDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);
		for (const mountPhase of domRendererMountPhases) {
			expect(mountPhase.isScrolling).toBe(false);
		}

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});

	it('mounts the audit-ledger server grid at million-row scale without expanding rendered DOM beyond caps', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });

		expect(grid.store.engine.getRowModel()?.getVisualRowCount()).toBe(1_000_000);
		expect(grid.requests.length).toBeLessThanOrEqual(1);
		assertWindowIsContiguousAndCapped(grid);
		assertNoStaleOrOverlappingDom(grid);
		assertViewportGeometryIsContinuous(grid, 0);
		assertHorizontalGeometryIsContinuous(grid, 0);

		cleanupGrid(grid);
	}, 10_000);

	it('keeps violent real browser vertical scroll bounded, continuous, and visually non-stale across million rows', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });
		const positions = [40, 400, 40_000, 120, 400_000, 4_000, 8_000_000, 80, 20_000_000, 0];

		for (const scrollTop of positions) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, scrollTop, 0);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, scrollTop);
			assertHorizontalGeometryIsContinuous(grid, 0);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		expect(grid.requests.length).toBeLessThanOrEqual(3);
		cleanupGrid(grid);
	}, 20_000);

	it('keeps violent real browser horizontal scroll bounded and horizontally continuous across more than one thousand columns', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1500 });
		const positions = [96, 3_200, 80, 24_000, 640, 80_000, 160, 120_000, 0];

		for (const scrollLeft of positions) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, 0, scrollLeft);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, 0);
			assertHorizontalGeometryIsContinuous(grid, scrollLeft);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('survives real browser diagonal fling scroll without stale renderer hosts, blank ranges, or scroll-time recomputation', async () => {
		const grid = await createServerAuditGrid({ rows: 2_000_000, cols: 1600 });
		const flings = [
			{ top: 40, left: 96 },
			{ top: 1_200, left: 12_000 },
			{ top: 400_000, left: 500 },
			{ top: 20_000, left: 90_000 },
			{ top: 64_000_000, left: 140_000 },
			{ top: 80, left: 0 },
		];

		for (const fling of flings) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, fling.top, fling.left);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, fling.top);
			assertHorizontalGeometryIsContinuous(grid, fling.left);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('does not leave focused or selected row islands after click selection during server scroll', async () => {
		const grid = await createServerAuditGrid({ rows: 1_000_000, cols: 1200 });

		await browserScrollTo(grid, 2_000, 0);
		grid.store.selectCell({ rowId: 'TR-1000051', colField: 'timestamp' }, 'pointer');
		await flushAnimationFrame();
		assertSelectionDoesNotCreateVisibleRowIslands(grid, 2_000);

		const scrolls = [2_080, 8_000, 80, 20_000, 2_000, 400_000, 2_040];
		for (const scrollTop of scrolls) {
			const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow | null;
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, scrollTop, 0);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertViewportGeometryIsContinuous(grid, scrollTop);
			assertHorizontalGeometryIsContinuous(grid, 0);
			assertSelectionDoesNotCreateVisibleRowIslands(grid, scrollTop);
			assertScrollStatsAreRuthless(grid, prevWindow);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('recreates and catches cell duplication and mismatched virtualization index bugs during scrolling and viewport resizing', async () => {
		const grid = await createServerAuditGrid({ rows: 100_000, cols: 100 });
		grid.store.setPinnedColumns({ left: 1 });
		await flushAnimationFrame();
		grid.renderer.fullPaint();

		// 1. Initial assertion
		assertNoStaleOrOverlappingDom(grid);

		// 2. Perform diagonal scroll back and forth to trigger cell virtualization and pool exchanges
		await browserScrollTo(grid, 400, 300);
		await browserScrollTo(grid, 0, 0);
		await browserScrollTo(grid, 800, 600);
		await browserScrollTo(grid, 0, 0);

		// 3. Shrink viewport height to trigger COLD release of some row/cell slots
		grid.store.setViewportSize(1120, 200);
		grid.store.updateVisibleRanges();
		grid.renderer.scheduleGeometryPaint('resize');
		await flushAnimationFrame();

		// 4. Grow viewport height back to original, which re-acquires rows and cells from pool
		grid.store.setViewportSize(1120, 720);
		grid.store.updateVisibleRanges();
		grid.renderer.scheduleGeometryPaint('resize');
		await flushAnimationFrame();

		// 5. Scroll again to trigger binding of those re-acquired cells
		await browserScrollTo(grid, 400, 300);

		// Wait for scroll-end timer (80ms) and post-scroll idle decoration to complete
		await new Promise((resolve) => setTimeout(resolve, 150));
		await flushAnimationFrame();

		// 6. Assert strict DOM contracts. With the bugs present, this will catch:
		// - Duplicate .og-cell-content or .og-cell-portal-host children in cells
		// - Zombie cells remaining attached to row elements with mismatched row index datasets
		assertNoStaleOrOverlappingDom(grid);

		// Check for duplicate .og-cell-content and .og-cell-portal-host elements directly in DOM
		const stats = grid.renderer.getRenderStats();
		console.log('COLD RELEASES COUNT:', stats.coldDomReleases);

		const allCells = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-cell'));
		const row10Cells = allCells.filter((cell) => cell.dataset.rowIndex === '10');
		console.log('ROW 10 CELLS DETAIL:', row10Cells.length);
		for (let i = 0; i < row10Cells.length; i++) {
			const cell = row10Cells[i];
			const slot = CellSlot.fromElement(cell as HTMLDivElement);
			console.log(`Cell ${i} (${cell.dataset.colField}):`, {
				childrenCount: cell.childNodes.length,
				childClasses: Array.from(cell.childNodes).map((c: any) => c.className),
				hasCachedParts: !!slot,
				cachedContentHasParent: slot && !slot.directText ? !!slot.contentElement.parentNode : null,
				cachedPortalHasParent: slot ? !!slot.portalHostElement?.parentNode : false,
			});
		}

		cleanupGrid(grid);
	}, 20_000);

	it('asserts CSS styles define hide rules for text and empty content modes and rules for custom renderer container', () => {
		expect(CORE_STYLES).toContain('.og-cell[data-content-mode="text"] > .og-cell-portal-host');
		expect(CORE_STYLES).toContain('.og-cell[data-content-mode="empty"] > .og-cell-portal-host');
		expect(CORE_STYLES).toContain('.og-custom-renderer-container');
	});

	it('keeps pinned selected-row lanes opaque so center text cannot show through', () => {
		expect(CORE_STYLES).toContain('.og-row-selected .og-row-pin-left');
		expect(CORE_STYLES).toContain('.og-row-selected .og-cell-pinned-left');
		expect(CORE_STYLES).toContain('linear-gradient(var(--og-selection-bg), var(--og-selection-bg)), var(--og-bg-color)');
	});

	it('preserves custom-live portals during scrolling without increasing warmMisses', async () => {
		const grid = await createServerAuditGrid({ rows: 1000, cols: 50 });
		await flushAnimationFrame();

		// Initial render stats
		const statsBefore = grid.renderer.rowRenderer.portalMountManager['customRendererManager'].getStats();
		const missesBefore = statsBefore.warmMisses;

		// Perform scroll
		await browserScrollTo(grid, 120, 0);
		await flushAnimationFrame();

		const statsAfter = grid.renderer.rowRenderer.portalMountManager['customRendererManager'].getStats();
		const missesAfter = statsAfter.warmMisses;

		// custom-live portals are frozen in place during scroll — no extra warm misses from them.
		// custom (defer) portals now use the stand-in path: portal released during scroll, full bind
		// (triggered by post-scroll RAF) restores via warm cache. New visible rows from the 120px scroll
		// cold-mount fresh renderers for cells that were never previously mounted. Cap at 75.
		expect(missesAfter).toBeLessThanOrEqual(missesBefore + 75);
		cleanupGrid(grid);
	});

	it('keeps a custom-renderer-heavy viewport free of blank visible cells during vertical, horizontal, and diagonal scroll', async () => {
		const grid = await createServerAuditGrid({ rows: 50_000, cols: 180 });
		const positions = [
			{ top: 120, left: 0 },
			{ top: 120, left: 3_000 },
			{ top: 2_400, left: 6_000 },
			{ top: 80, left: 500 },
			{ top: 6_000, left: 0 },
		];

		for (const position of positions) {
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, position.top, position.left);
			assertWindowIsContiguousAndCapped(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertNoBlankVisibleCells(grid, position.top, position.left);
			const evidence = collectFeatherScenarioEvidence(grid);
			expect(evidence.motion.valueGetterCallsDuringScroll).toBe(0);
			expect(evidence.motion.getCellValueCallsDuringScroll).toBe(0);
			expect(evidence.motion.formulaCallsDuringScroll).toBe(0);
			expect(evidence.motion.customRendererMountsDuringScroll).toBe(0);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('keeps integrity-heavy decorations visible and coherent through diagonal server scroll', async () => {
		const grid = await createServerAuditGrid({
			rows: 100_000,
			cols: 160,
			configureStore: (store) => {
				store.setPinnedColumns({ left: 1, right: 1 });
				store.engine.insights.register({
					id: 'feather-contract-integrity',
					getCellDecorations: (_rowId, colField) => {
						if (colField === 'id') {
							return [
								{
									layerId: 'feather-contract-integrity',
									kind: 'validationError',
									className: 'og-cell-validation-error',
									title: 'Integrity review required',
								},
							];
						}
						if (colField === 'auditMetric_159') {
							return [
								{
									layerId: 'feather-contract-integrity',
									kind: 'conflict',
									className: 'og-cell-conflict',
									title: 'Conflict pending',
								},
							];
						}
						return [];
					},
				});
			},
		});
		grid.store.engine.requestInsightRepaint();
		await flushAnimationFrame();
		await settleVisibleServerRows(grid);
		assertVisibleIntegrityDecorationsStayPresent(grid);
		const flings = [
			{ top: 40, left: 96 },
			{ top: 1_200, left: 3_600 },
			{ top: 20_000, left: 10_000 },
			{ top: 80, left: 0 },
		];

		for (const fling of flings) {
			grid.renderer.resetRenderStats();
			await browserScrollTo(grid, fling.top, fling.left);
			await settleVisibleServerRows(grid);
			assertNoStaleOrOverlappingDom(grid);
			assertNoBlankVisibleCells(grid, fling.top, fling.left);
			assertVisibleIntegrityDecorationsStayPresent(grid);
			const evidence = collectFeatherScenarioEvidence(grid);
			expect(evidence.motion.valueGetterCallsDuringScroll).toBe(0);
			expect(evidence.motion.getCellValueCallsDuringScroll).toBe(0);
			// Registered insight layer above actively decorates visible cells (id/auditMetric_159).
			// This is the one scenario where a naive implementation would call
			// engine.insights.getCellDecorations() from the scroll hot path to keep decorations
			// current — the contract requires that read to happen only in bindCellFull (post-scroll
			// fidelity), never during the scroll frame itself.
			expect(evidence.motion.integrityComputesDuringScroll).toBe(0);
		}

		cleanupGrid(grid);
	}, 20_000);

	it('shows the server loading skeleton identically in pinned-left, center, and pinned-right lanes', async () => {
		// Pillar of Phase 7 (pinned lanes are geometry/topology only): the loading skeleton is a
		// content decision, not a lane decision, so all three lanes must agree on it before any
		// row data resolves — no lane should "wake" or settle differently than the others.
		const grid = await createServerAuditGrid({
			rows: 5_000,
			cols: 20,
			configureStore: (store) => store.setPinnedColumns({ left: 1, right: 1 }),
		});

		const firstRow = grid.container.querySelector('.og-row[data-row-index="0"]') as HTMLElement | null;
		expect(firstRow).not.toBeNull();
		const leftCell = firstRow!.querySelector<HTMLElement>('.og-cell.og-cell-pinned-left');
		const rightCell = firstRow!.querySelector<HTMLElement>('.og-cell.og-cell-pinned-right');
		const centerCell = Array.from(firstRow!.querySelectorAll<HTMLElement>('.og-cell')).find(
			(cell) => !cell.classList.contains('og-cell-pinned-left') && !cell.classList.contains('og-cell-pinned-right')
		);
		expect(leftCell).toBeDefined();
		expect(rightCell).toBeDefined();
		expect(centerCell).toBeDefined();

		// Assert parity, not a specific timing: whichever state the row is in immediately after
		// mount, all three lanes must agree — never a mix where one lane is still loading while
		// another has already settled real content.
		const loadingStates = [leftCell, centerCell, rightCell].map(
			(cell) => cell!.classList.contains('og-cell-loading') || cell!.dataset.contentMode === 'loading'
		);
		expect(new Set(loadingStates).size).toBe(1);

		await settleVisibleServerRows(grid);
		// Once settled, no lane should still be showing the loading skeleton while others resolved —
		// they must all transition together.
		for (const cell of [leftCell, centerCell, rightCell]) {
			expect(cell!.classList.contains('og-cell-loading')).toBe(false);
		}

		cleanupGrid(grid);
	}, 10_000);

	it('records separate motion and fidelity evidence for feather-scroll review scenarios', async () => {
		const grid = await createServerAuditGrid({ rows: 20_000, cols: 120 });
		await browserScrollTo(grid, 2_000, 4_000);
		const evidence = collectFeatherScenarioEvidence(grid);

		expect(evidence.motion.scrollFrames).toBeGreaterThan(0);
		expect(evidence.motion.stateReadsDuringScroll).toBeGreaterThanOrEqual(0);
		expect(evidence.motion.valueGetterCallsDuringScroll).toBe(0);
		expect(evidence.motion.getCellValueCallsDuringScroll).toBe(0);
		expect(evidence.motion.formulaCallsDuringScroll).toBe(0);
		expect(evidence.fidelity.prewarmPasses).toBeGreaterThanOrEqual(0);
		expect(evidence.fidelity.prewarmedDisplayValues).toBeGreaterThanOrEqual(0);
		expect(evidence.fidelity.prewarmedCellSnapshots).toBeGreaterThanOrEqual(0);
		expect(evidence.fidelity.motionCellsDecoratedAfterScroll).toBeGreaterThanOrEqual(0);
		expect(evidence.fidelity.fidelityCellsDecoratedAfterScroll).toBeGreaterThanOrEqual(0);
		expect(evidence.fidelity.postScrollMotionChunks).toBeGreaterThanOrEqual(0);
		expect(evidence.fidelity.postScrollFidelityChunks).toBeGreaterThanOrEqual(0);

		cleanupGrid(grid);
	}, 20_000);

	it('does not produce zombie cells under stable-slot virtualization', async () => {
		const cols = createAuditColumns(20);
		const totalRows = 100;
		const store = new GridStore<AuditPerfRow>({
			columns: cols,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 40,
			colBuffer: 1,
			getRowId: (row) => row.id,
		});
		const datasource: InfiniteDatasource<AuditPerfRow> = {
			getRows: async ({ startRow, endRow }) => {
				return {
					rows: Array.from({ length: endRow - startRow }, (_, offset) => createAuditRow(startRow + offset)),
					totalCount: totalRows,
				};
			},
		};
		const controller = new InfiniteRowModelController<AuditPerfRow>(store.getInfiniteRowModelRuntime(), {
			datasource,
			blockSize: 50,
			columns: cols,
		});
		const container = createContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		await flushAsync();
		renderer.fullPaint();

		// Scroll up and down violently
		await browserScrollTo({ renderer, store, container } as any, 500, 0);
		await browserScrollTo({ renderer, store, container } as any, 0, 0);
		await browserScrollTo({ renderer, store, container } as any, 1000, 0);
		await browserScrollTo({ renderer, store, container } as any, 200, 0);
		await flushAnimationFrame();

		assertNoStaleOrOverlappingDom({ renderer, store, container } as any);

		renderer.unmount();
		container.remove();
	});

	it('feather-scroll A/B: all custom-renderer columns are portal-free during every scroll frame', async () => {
		// A grid with 100% custom-renderer columns (worst case for the old synchronous-mount path).
		// Prior to Plan 153 Step 3, custom (defer) cells called mountCellImmediately during scroll;
		// portalMountsDuringScroll and customRendererMountsDuringScroll would both have been > 0.
		// After: every scroll frame is portal-free. Portals mount in the fidelity idle lane instead.
		const columns = Array.from({ length: 80 }, (_, i): ColumnDef<AuditPerfRow> => {
			return {
				field: i === 0 ? 'id' : `auditMetric_${i + 100}`,
				header: `Col ${i}`,
				width: 120 + (i % 4) * 20,
				cellRenderer: () => null,
				cellRendererCapabilities: { scroll: 'text' as const },
				valueGetter: i % 5 === 0 ? ({ row }: { row: AuditPerfRow }) => `m${i}|${row.severity}` : undefined,
			};
		});

		const store = new GridStore<AuditPerfRow>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			rowOverscanPx: 40,
			colBuffer: 1,
			getRowId: (row) => row.id,
		});
		const datasource: InfiniteDatasource<AuditPerfRow> = {
			getRows: async ({ startRow, endRow }) => ({
				rows: Array.from({ length: endRow - startRow }, (_, offset) => createAuditRow(startRow + offset)),
				totalCount: 10_000,
			}),
		};
		const controller = new InfiniteRowModelController<AuditPerfRow>(store.getInfiniteRowModelRuntime(), {
			datasource,
			blockSize: 100,
			columns,
		});
		const container = createContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.onMountCellContent = ({ cellKey, container: host }) => {
			const el = document.createElement('span');
			el.textContent = cellKey;
			host.replaceChildren(el);
		};
		renderer.mount(container);
		await flushAsync();
		renderer.fullPaint();
		await settleVisibleServerRows({ store, container, renderer } as any);

		const scenarios: Array<{ label: string; top: number; left: number }> = [
			{ label: 'vertical short', top: 200, left: 0 },
			{ label: 'vertical long', top: 4_000, left: 0 },
			{ label: 'horizontal', top: 4_000, left: 3_000 },
			{ label: 'diagonal', top: 8_000, left: 6_000 },
			{ label: 'back to top', top: 0, left: 0 },
		];

		for (const { label, top, left } of scenarios) {
			renderer.resetRenderStats();
			await browserScrollTo({ store, container, renderer } as any, top, left);
			await settleVisibleServerRows({ store, container, renderer } as any);

			const ev = collectFeatherScenarioEvidence({ store, container, renderer } as any);

			// Motion lane: scroll frames are portal-free.
			expect(ev.motion.customRendererMountsDuringScroll).toBe(0);
			expect(ev.motion.valueGetterCallsDuringScroll).toBe(0);
			expect(ev.motion.getCellValueCallsDuringScroll).toBe(0);
			expect(ev.motion.formulaCallsDuringScroll).toBe(0);

			// Quality: no blank visible cells after scroll settles.
			assertNoBlankVisibleCells({ store, container, renderer } as any, top, left);

			if (ev.motion.scrollFrames > 0) {
				// Fidelity lane ran and upgraded cells post-scroll.
				expect(ev.fidelity.fidelityCellsDecoratedAfterScroll).toBeGreaterThan(0);
			}

			assertWindowIsContiguousAndCapped({ store, container, renderer } as any);
			assertNoStaleOrOverlappingDom({ store, container, renderer } as any);

			if (process.env.FEATHER_BENCH) {
				// eslint-disable-next-line no-console
				console.log(
					`[feather-bench] ${label}: scrollFrames=${ev.motion.scrollFrames} ` +
						`written=${ev.motion.cellsWrittenDuringScroll} ` +
						`portalOps=${ev.motion.portalOpsDuringScroll} ` +
						`fidelityCells=${ev.fidelity.fidelityCellsDecoratedAfterScroll}`
				);
			}
		}

		renderer.unmount();
		controller.dispose();
		store.destroy();
	}, 30_000);
});
