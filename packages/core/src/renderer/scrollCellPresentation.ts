import { getColumnInstanceIdentity, type InternalColumnDef, type ColumnDef, type ColumnInstanceId } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import { createEditRendererKey } from './identityKeys.js';
import type { CellSlot, CellContentMode } from './cellSlot.js';
import type { CellDisplaySnapshot } from './cellDisplaySnapshot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { hasMountedDataVersionDrifted, type VisualFreshness } from './visualFreshness.js';
import { getCellScrollPresentation } from './scrollPresentationMode.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';

/**
 * Narrow, purpose-built dependency surface for the scroll presentation resolver — deliberately
 * NOT `RowCellBinderDeps` (the full binder dependency bag). The resolver only ever needs
 * read-only inspection of these three things; it must never gain access to the broader bag,
 * which would make it easy to accidentally reach for a semantic read or a mount call. Testable
 * without constructing the full binder.
 */
export interface ScrollCellPresentationDeps {
	/** Read-only: does this cell currently have a portal host element mounted? */
	getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null;
	/** Read-only: the geometry-computed row height for the given row index, if known. */
	getRowHeight(rowIndex: number): number | undefined;
	/** Read-only: the compiled-plan column width for the given column index, if known. */
	getColWidth(colIndex: number): number | undefined;
	/** Read-only: a cached cheap display value for the synthetic-impostor fallback — already
	 *  exempt from the no-semantic-read counters (it's a cache lookup, not a value computation). */
	getCheapDisplayValue(rowId: string, colField: string): string | undefined;
	/** Read-only: a previously-captured frozen HTML clone for this exact cell identity, freshness-
	 *  and size-gated — see htmlScrollSnapshotStore.ts. Returns undefined if nothing was captured, the
	 *  row's data has changed since, or the row/column has been resized since capture. */
	getFrozenHtmlSnapshot(
		rowId: string,
		columnInstanceId: ColumnInstanceId,
		expected: VisualFreshness,
		rowHeight: number | undefined,
		colWidth: number | undefined
	): { html: string } | undefined;
	/** Read-only: grid-level defaults for the html-snapshot mode's missing-capture behavior — see
	 *  GridRendererOptions.htmlSnapshot. Column-level `htmlSnapshot` capabilities take priority.
	 *  Omitted defaults to `{ allowShellWhenMissing: true, allowTextFallbackWhenMissing: false }`. */
	getHtmlSnapshotDefaults?(): { allowShellWhenMissing: boolean; allowTextFallbackWhenMissing: boolean };
	/** Read-only: whether (rowId, colField) is a formula cell. Lets a plain primitive column (no
	 *  valueGetter/formatter/renderer) show its raw field value during scroll instead of the "..."
	 *  placeholder. Omitted means unknown — the placeholder is kept. */
	hasFormula?(rowId: string, colField: string): boolean;
}

/**
 * Direct display text for a plain `mode: 'primitive'` column — a single own-field read of the row
 * object, the same value the full bind would show (String(raw), no formatter involved). Returns
 * undefined whenever that equivalence can't be guaranteed cheaply: nested field paths, formula
 * cells, or no row data — callers keep their placeholder then.
 */
function readPrimitiveDisplayText<TRowData>(deps: ScrollCellPresentationDeps, node: RowNode<TRowData>, colField: string): string | undefined {
	if (!deps.hasFormula || !node.data || colField.indexOf('.') !== -1) return undefined;
	if (deps.hasFormula(node.id, colField)) return undefined;
	const raw = (node.data as Record<string, unknown>)[colField];
	if (typeof raw === 'string' && raw.startsWith('=')) return undefined;
	return raw == null ? '' : String(raw);
}

export function isPrimitiveSnapshotContent(snapshot: CellDisplaySnapshot | undefined): snapshot is CellDisplaySnapshot {
	return !!snapshot && (snapshot.contentMode === 'text' || snapshot.contentMode === 'empty' || snapshot.contentMode === 'fallback');
}

export function isPortalSnapshotContent(snapshot: CellDisplaySnapshot | undefined): snapshot is CellDisplaySnapshot {
	return !!snapshot && snapshot.contentMode === 'portal';
}

export function hasAuthoritativePortalHostContent<TRowData>(
	deps: ScrollCellPresentationDeps,
	cellSlot: CellSlot<TRowData>,
	portalKey: string | undefined
): boolean {
	if (!portalKey || cellSlot.lastContentMode !== 'portal') return false;
	const portalHost = deps.getCellPortalHost(cellSlot.element);
	if (!portalHost || portalHost.childElementCount === 0) return false;
	return true;
}

/**
 * Composite identity guard for freezing an already-mounted live portal in place during scroll
 * instead of replacing it with an impostor. Warm DOM (`lastPortalKey`, the portal host's own
 * child content) may gate this decision only through this exact three-part check — a row rebind
 * means the warm content belongs to the OLD row identity and must never be trusted, and a
 * mismatched portal key means the warm content belongs to a different cell/edit session.
 */
export function canFreezeExistingPortalForIdentity<TRowData>(
	deps: ScrollCellPresentationDeps,
	cellSlot: CellSlot<TRowData>,
	expectedPortalKey: string,
	isRowRebind: boolean
): boolean {
	if (isRowRebind) return false;
	// Equivalent to canFreezePortalForCellCtrl against a controller synthesized from the slot's own
	// identity (row/column/slot instance all match by construction, so mustClearSlotForControllerChange
	// is always false) — evaluated directly over the fields instead of allocating that controller.
	if (!expectedPortalKey) return false;
	if (cellSlot.lastContentMode !== 'portal' || cellSlot.lastPortalKey !== expectedPortalKey) return false;
	return hasAuthoritativePortalHostContent(deps, cellSlot, expectedPortalKey);
}

/**
 * Identity+freshness guard for reusing a cell's own previously-rendered text as a scroll-time
 * stand-in. Warm text (`lastFormattedValue`/`lastContentMode`) is only trustworthy at all when the
 * slot's warm binding version is still fresh AND it actually has a cached value — that base check
 * lives here so no call site probes `lastFormattedValue`/`isWarmBindingVersionFresh` directly.
 * Callers apply their own additional content-mode filter on the returned `contentMode` (the
 * acceptable mode set genuinely differs per call site — e.g. exactly text/fallback vs. merely
 * not-portal), so this deliberately does not make that filtering decision itself.
 */
export function canReuseWarmTextForIdentity<TRowData>(
	cellSlot: Pick<CellSlot<TRowData>, 'lastContentMode' | 'lastFormattedValue'>,
	isWarmBindingVersionFresh: boolean
): { formattedValue: string; contentMode: CellContentMode } | undefined {
	if (!isWarmBindingVersionFresh || cellSlot.lastFormattedValue == null) return undefined;
	return { formattedValue: cellSlot.lastFormattedValue, contentMode: cellSlot.lastContentMode };
}

/**
 * The full set of outcomes bindCellDuringScroll can resolve a cell to. Each variant carries
 * exactly the data its corresponding apply step in bindCellDuringScroll needs — the DOM writes,
 * portal mount/release calls, snapshot-store writes, and telemetry increments all stay in the
 * binder. This type must never grow a variant that requires calling getCellValue, a valueGetter,
 * the formula engine, a style-rule evaluator, the integrity/insights engine, or mounting a React
 * portal — those are exactly the semantic reads/mounts the scroll hot path must never perform.
 */
export type ScrollCellPresentation =
	| { kind: 'checkbox-selector'; className: string; markDirty: boolean }
	| {
			kind: 'buffered';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			portalKey: string | undefined;
			releaseStalePortal: boolean;
			title: string | null;
			validationError: string | undefined;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
	  }
	| {
			kind: 'primitive';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			markDirty: boolean;
			releaseStalePortal: boolean;
			title: string | null;
			validationError: string | undefined;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
	  }
	| {
			kind: 'frozen-portal';
			className: string;
			portalCellKey: string;
			title: string | null;
			validationError: string | undefined;
			markDirty: boolean;
			captureFrozenHtml: boolean;
			keepVersionFresh: boolean;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
	  }
	| {
			kind: 'html-snapshot';
			className: string;
			frozenHtml: string;
			releaseStalePortal: boolean;
			recordVersionsFrom: CellDisplaySnapshot | VisualFreshness;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'text-impostor';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			releaseStalePortal: boolean;
			recordVersionsFrom: CellDisplaySnapshot | VisualFreshness;
			title: string | null;
			validationError: string | undefined;
			source: 'fallback';
	  }
	| {
			/** The only mode allowed to use `capabilities.textImpostor.render` — an explicit, always-on
			 * text/chip stand-in for `scrollPresentation: 'text-impostor'` columns. Unlike `impostor-text`
			 * (freeze mode's implicit fallback), this fires unconditionally during scroll for this mode,
			 * regardless of whether a live portal is currently mounted. */
			kind: 'text-impostor';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			releaseStalePortal: boolean;
			recordVersions: VisualFreshness;
			title: string | null;
			validationError: string | undefined;
			source: 'explicit';
	  }
	| {
			/** `scrollPresentation: 'html-snapshot'` with no fresh capture available and
			 * `allowTextFallbackWhenMissing` not set — shows a stable shell/pending placeholder rather
			 * than raw text, per the html-snapshot contract. */
			kind: 'html-pending';
			className: string;
			releaseStalePortal: boolean;
			recordVersions: VisualFreshness;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			/**
			 * The real renderer is mounted/updated on every scroll frame — the entire point of
			 * `scrollPresentation: 'live'`. Counted under `liveReactMountsDuringScroll`, distinct from
			 * `force-live-interactive-exception` (which fires rarely, only for freeze-mode cells that
			 * are actively focused/editing).
			 */
			kind: 'live-renderer';
			className: string;
			portalCellKey: string;
			releasePriorPortal: boolean;
			isEditing: boolean;
			isFocused: boolean;
			forceLiveInteractive: boolean;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'shell';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			releaseStalePortal: boolean;
			recordVersions: VisualFreshness;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			/**
			 * The ONLY case allowed to mount a live renderer during active scroll: the cell is actively
			 * being edited or holds keyboard focus, so an impostor would be visibly wrong (the user is
			 * interacting with it right now). Must stay rare — every other portal-capable cell with no
			 * live content and no usable snapshot degrades to `impostor-synthetic` instead. Callers must
			 * count this separately (`forceLiveMountsDuringScroll`), never fold it into generic
			 * mount/portal counters, so a regression that makes this fire for normal cells is visible.
			 */
			kind: 'live-renderer';
			className: string;
			portalCellKey: string;
			releasePriorPortal: boolean;
			isEditing: boolean;
			isFocused: boolean;
			forceLiveInteractive: true;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
			title: string | null;
			validationError: string | undefined;
	  };

export interface ScrollCellPresentationInput<TRowData> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	ctx: ScrollRenderContext<TRowData>;
	isRowRebind: boolean;
	isRowLoading: boolean;
	isInVisibleContent: boolean;
	snapshot: CellDisplaySnapshot | undefined;
	isWarmBindingVersionFresh: boolean;
	rowVersion: number;
	cellKey: string;
}

function buildCellPinClass(lane: 'left' | 'center' | 'right'): string {
	if (lane === 'left') return 'og-cell og-cell-pinned-left';
	if (lane === 'right') return 'og-cell og-cell-pinned-right';
	return 'og-cell';
}

/**
 * Pure decision function for the scroll hot path. Given the current mounted slot state, a fresh
 * (possibly absent) display snapshot, and renderer capability metadata, decides what the cell
 * should show — never performs a DOM write, portal mount/release, or a semantic read (no
 * getCellValue/valueGetter/formula/style-rule/integrity call). `deps` is only used for read-only
 * inspection: checking whether a portal host already has live content, and reading the column's
 * cheap-display-value cache for the synthetic-impostor fallback (both already exempt from the
 * no-semantic-read counters — see runtimePerformance.test.ts).
 */
export function resolveScrollCellPresentation<TRowData>(
	deps: ScrollCellPresentationDeps,
	input: ScrollCellPresentationInput<TRowData>
): ScrollCellPresentation {
	const {
		cellSlot,
		node,
		rowIndex,
		colIndex,
		col,
		lane,
		ctx,
		isRowRebind,
		isRowLoading,
		isInVisibleContent,
		snapshot,
		isWarmBindingVersionFresh,
		cellKey,
	} = input;

	if (col.checkboxSelection) {
		return { kind: 'checkbox-selector', className: buildCellPinClass(lane) + ' og-cell-row-selector', markDirty: isInVisibleContent };
	}

	const compiledPlan = ctx.plan.columnPlans[colIndex];
	const isEditing = doesCanonicalCellPointerMatchColumn(ctx.activeEdit, node.id, col);
	const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading ? 'loading' : isEditing || compiledPlan?.isCustom ? 'portal' : 'primitive';
	const scrollMode = compiledPlan?.mode;
	const isDomRenderer = scrollMode === 'custom-dom';
	// DOM renderers default to 'freeze' during scroll. An explicit `scrollPresentation: 'live'`
	// is honoured: DomCellRendererHandle.update() is cheap enough to run in the paint loop.
	const columnPresentation = getCellScrollPresentation(col);
	const presentation = isDomRenderer && columnPresentation !== 'live' ? 'freeze' : columnPresentation;

	let cellClassName = buildCellPinClass(lane);
	if (rendererKind === 'loading') cellClassName += ' og-cell-loading';
	if (snapshot?.className) {
		cellClassName = snapshot.className;
	} else if (isWarmBindingVersionFresh && cellSlot.lastClassName) {
		cellClassName = cellSlot.lastClassName;
	}

	if (!isInVisibleContent && presentation !== 'live') {
		const primitiveSnapshot = isPrimitiveSnapshotContent(snapshot) ? snapshot : undefined;
		const canReuseSnapshotContent = !!primitiveSnapshot;
		const canReuseSnapshotPortal =
			snapshot?.contentMode === 'portal' && hasAuthoritativePortalHostContent(deps, cellSlot, cellSlot.lastPortalKey);
		const preservedContentMode: CellContentMode = canReuseSnapshotPortal
			? 'portal'
			: canReuseSnapshotContent
				? primitiveSnapshot.contentMode
				: rendererKind === 'loading'
					? 'loading'
					: 'empty';
		return {
			kind: 'buffered',
			className: cellClassName,
			contentMode: preservedContentMode,
			formattedValue:
				canReuseSnapshotContent && (preservedContentMode === 'text' || preservedContentMode === 'fallback')
					? primitiveSnapshot.formattedValue
					: '',
			portalKey: preservedContentMode === 'portal' && canReuseSnapshotPortal ? cellSlot.lastPortalKey : undefined,
			releaseStalePortal: !canReuseSnapshotPortal && !!cellSlot.lastPortalKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			recordVersionsFrom: snapshot,
		};
	}

	if (rendererKind !== 'portal' && rendererKind !== 'loading') {
		let contentMode: CellContentMode;
		let formattedValue: string;
		let markDirty = false;
		const warmText = canReuseWarmTextForIdentity(cellSlot, isWarmBindingVersionFresh);
		if (isPrimitiveSnapshotContent(snapshot)) {
			formattedValue = snapshot.formattedValue;
			contentMode = snapshot.contentMode;
		} else if (warmText && (warmText.contentMode === 'text' || warmText.contentMode === 'fallback')) {
			formattedValue = warmText.formattedValue;
			contentMode = warmText.contentMode;
			markDirty = true;
		} else {
			// A plain primitive column's value is a direct field read — show it rather than a
			// placeholder. Anything needing a valueGetter/formatter/formula keeps the placeholder.
			const directText = compiledPlan?.mode === 'primitive' ? readPrimitiveDisplayText(deps, node, col.field) : undefined;
			if (directText !== undefined) {
				formattedValue = directText;
				contentMode = directText === '' ? 'empty' : 'text';
			} else {
				formattedValue = '...';
				contentMode = 'text';
			}
			markDirty = true;
		}
		return {
			kind: 'primitive',
			className: cellClassName,
			contentMode,
			formattedValue,
			markDirty,
			releaseStalePortal: !!cellSlot.lastPortalKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			recordVersionsFrom: snapshot,
		};
	}

	// rendererKind is 'portal' or 'loading' from here on — both go through the portal decision
	// tree. A loading row with a custom-renderer column lets that renderer show its own loading
	// state via portal mount (isLoading is threaded into the mount request below).
	const portalCellKey = isEditing ? createEditRendererKey(node.id, getColumnInstanceIdentity(col)) : cellKey;
	const isFocused = doesCanonicalCellPointerMatchColumn(ctx.focusedCell, node.id, col);

	const versionsFromCtx = (): VisualFreshness => ({
		rowVersion: input.rowVersion,
		globalVersion: ctx.globalVersion,
		insightVersion: ctx.insightVersion,
		styleVersion: ctx.styleVersion,
		loadingVersion: ctx.loadingVersion,
		selectionVersion: ctx.selectionVersion,
	});

	// 'live' — the real renderer is mounted/updated on every scroll frame, unconditionally. No
	// freeze, no impostor, no snapshot fallback: this must come before every other decision below.
	if (presentation === 'live') {
		return {
			kind: 'live-renderer',
			className: cellClassName,
			portalCellKey,
			releasePriorPortal: !!cellSlot.lastPortalKey && cellSlot.lastPortalKey !== portalCellKey,
			isEditing,
			isFocused,
			forceLiveInteractive: false,
			recordVersionsFrom: snapshot,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	// 'text-impostor' — always shows the explicit text/chip stand-in during scroll, regardless of
	// whether a live portal happens to be mounted. The only mode allowed to use textImpostor.render.
	if (presentation === 'text-impostor') {
		let cheapValue: string;
		if (snapshot?.contentMode === 'fallback' && !isEditing) {
			// The full bind already rendered this cell's impostor text for these exact versions —
			// reuse it so scroll and rest show identical output (no flicker between the two).
			cheapValue = snapshot.formattedValue;
		} else {
			const genericCheap = deps.getCheapDisplayValue(node.id, col.field) ?? '';
			const renderFn = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.textImpostor?.render;
			// Hand the renderer the real value when it is a direct field read, as the full bind does.
			const value =
				renderFn != null && !(col as InternalColumnDef<TRowData>).valueGetter && readPrimitiveDisplayText(deps, node, col.field) !== undefined
					? (node.data as Record<string, unknown>)[col.field]
					: undefined;
			cheapValue = renderFn != null ? renderFn({ value, formattedValue: genericCheap }) || genericCheap : genericCheap;
		}
		const syntheticMode: CellContentMode = cheapValue !== '' ? 'fallback' : 'empty';
		return {
			kind: 'text-impostor',
			className: cellClassName,
			contentMode: syntheticMode,
			formattedValue: cheapValue,
			releaseStalePortal: !!cellSlot.lastPortalKey,
			recordVersions: snapshot ?? versionsFromCtx(),
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			source: 'explicit',
		};
	}

	// From here on, presentation is 'freeze' or 'html-snapshot' (or the cell is a DOM renderer,
	// which is excluded from the freeze/impostor mechanism entirely — DomCellRenderer manages its
	// own mount/update lifecycle without React portal overhead).
	const isHtmlSnapshotMode = presentation === 'html-snapshot';
	const htmlSnapshotCaps = isHtmlSnapshotMode ? (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.htmlSnapshot : undefined;
	const htmlSnapshotDefaults = deps.getHtmlSnapshotDefaults?.() ?? { allowShellWhenMissing: true, allowTextFallbackWhenMissing: false };
	const allowTextFallbackWhenMissing = htmlSnapshotCaps?.allowTextFallbackWhenMissing ?? htmlSnapshotDefaults.allowTextFallbackWhenMissing;

	// Compute live-content guard BEFORE any impostor path. If the cell is already showing rendered
	// portal content for this exact row+key, freeze it in place during scroll rather than replacing
	// it with a text impostor. This prevents the portal→text→portal flash that occurs on cells
	// that were already visible and rendered when the scroll began.
	// A row rebind (different row reusing this slot) is excluded — existing content belongs to the
	// old row identity and must never bleed into the incoming row.
	const hasExistingLivePortalContent = canFreezeExistingPortalForIdentity(deps, cellSlot, portalCellKey, isRowRebind);

	// A prewarm snapshot that explicitly says 'fallback' (impostor) takes authority over the freeze
	// path, except for html-snapshot columns, where the freeze moment is the only reliable place to
	// capture committed React DOM as frozenHtml.
	const snapshotDemandsImpostor = snapshot?.contentMode === 'fallback';

	if (!isDomRenderer && hasExistingLivePortalContent && !isEditing && !isFocused && (!snapshotDemandsImpostor || isHtmlSnapshotMode)) {
		const { globalChanged, rowChanged } = hasMountedDataVersionDrifted(cellSlot, {
			rowVersion: input.rowVersion,
			globalVersion: ctx.globalVersion,
		});
		const hasSnapshotCoverageForDecorations = !ctx.hasInsightDecorations || !!snapshot;
		const shouldDirtyFrozen =
			globalChanged ||
			rowChanged ||
			!hasSnapshotCoverageForDecorations ||
			(ctx.hasDeferredCellStyleRules &&
				(!snapshot || ctx.styleChangedDuringScroll || ctx.selectionChangedDuringScroll || ctx.loadingChangedDuringScroll));
		return {
			kind: 'frozen-portal',
			className: cellClassName,
			portalCellKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			markDirty: shouldDirtyFrozen,
			captureFrozenHtml: isHtmlSnapshotMode,
			keepVersionFresh: false,
			recordVersionsFrom: snapshot,
		};
	}

	// Impostor paths — only reached when the slot has no live portal content for the current row/key.
	const portalImpostorSnapshot =
		!isDomRenderer && !isEditing && !isFocused && snapshot && snapshot.contentMode === 'fallback' ? snapshot : undefined;
	if (portalImpostorSnapshot) {
		if (isHtmlSnapshotMode) {
			const frozenHtml = deps.getFrozenHtmlSnapshot(
				node.id,
				getColumnInstanceIdentity(col),
				versionsFromCtx(),
				deps.getRowHeight(rowIndex),
				deps.getColWidth(colIndex)
			);
			const releaseStalePortal = !!cellSlot.lastPortalKey;
			if (frozenHtml) {
				return {
					kind: 'html-snapshot',
					className: cellClassName,
					frozenHtml: frozenHtml.html,
					releaseStalePortal,
					recordVersionsFrom: portalImpostorSnapshot,
					title: portalImpostorSnapshot.title || null,
					validationError: portalImpostorSnapshot.validationError,
				};
			}
			if (allowTextFallbackWhenMissing) {
				return {
					kind: 'text-impostor',
					className: cellClassName,
					contentMode: portalImpostorSnapshot.contentMode,
					formattedValue: portalImpostorSnapshot.formattedValue,
					releaseStalePortal,
					recordVersionsFrom: portalImpostorSnapshot,
					title: portalImpostorSnapshot.title || null,
					validationError: portalImpostorSnapshot.validationError,
					source: 'fallback',
				};
			}
			return {
				kind: 'html-pending',
				className: cellClassName,
				releaseStalePortal,
				recordVersions: portalImpostorSnapshot,
				title: portalImpostorSnapshot.title || null,
				validationError: portalImpostorSnapshot.validationError,
			};
		}
		return {
			kind: 'text-impostor',
			className: cellClassName,
			contentMode: portalImpostorSnapshot.contentMode,
			formattedValue: portalImpostorSnapshot.formattedValue,
			releaseStalePortal: !!cellSlot.lastPortalKey,
			recordVersionsFrom: portalImpostorSnapshot,
			title: portalImpostorSnapshot.title || null,
			validationError: portalImpostorSnapshot.validationError,
			source: 'fallback',
		};
	}

	// A row rebind never freezes: the slot's mounted portal content belongs to the previous row
	// (portal keys are per cell instance, not per row), so it must not stay visible for the new one.
	const canFreezePortal =
		!isRowRebind &&
		isPortalSnapshotContent(snapshot) &&
		cellSlot.lastPortalKey === portalCellKey &&
		(snapshot.contentKind === 'portal-live' || snapshot.contentKind === 'portal-frozen') &&
		hasAuthoritativePortalHostContent(deps, cellSlot, portalCellKey);

	// Synthesis impostor: no snapshot, no live content, no freeze path — show a stand-in so the
	// scroll frame stays portal-free. Fidelity lane mounts the real portal post-scroll.
	if (!isDomRenderer && !isEditing && !isFocused && !canFreezePortal) {
		if (isHtmlSnapshotMode) {
			const frozenHtml = deps.getFrozenHtmlSnapshot(
				node.id,
				getColumnInstanceIdentity(col),
				versionsFromCtx(),
				deps.getRowHeight(rowIndex),
				deps.getColWidth(colIndex)
			);
			const releaseStalePortal = !!cellSlot.lastPortalKey;
			if (frozenHtml) {
				return {
					kind: 'html-snapshot',
					className: cellClassName,
					frozenHtml: frozenHtml.html,
					releaseStalePortal,
					recordVersionsFrom: snapshot ?? versionsFromCtx(),
					title: snapshot?.title || null,
					validationError: snapshot?.validationError,
				};
			}
			if (allowTextFallbackWhenMissing) {
				const genericCheap = deps.getCheapDisplayValue(node.id, col.field) ?? '';
				const warmSyntheticText = canReuseWarmTextForIdentity(cellSlot, isWarmBindingVersionFresh);
				const cheapValue = warmSyntheticText && warmSyntheticText.contentMode !== 'portal' ? warmSyntheticText.formattedValue : genericCheap;
				return {
					kind: 'text-impostor',
					className: cellClassName,
					contentMode: cheapValue !== '' ? 'fallback' : 'empty',
					formattedValue: cheapValue,
					releaseStalePortal,
					recordVersionsFrom: snapshot ?? versionsFromCtx(),
					title: snapshot?.title || null,
					validationError: snapshot?.validationError,
					source: 'fallback',
				};
			}
			return {
				kind: 'html-pending',
				className: cellClassName,
				releaseStalePortal,
				recordVersions: snapshot ?? versionsFromCtx(),
				title: snapshot?.title || null,
				validationError: snapshot?.validationError,
			};
		}
		const genericCheap = deps.getCheapDisplayValue(node.id, col.field) ?? '';
		const warmSyntheticText = canReuseWarmTextForIdentity(cellSlot, isWarmBindingVersionFresh);
		const cheapValue = warmSyntheticText && warmSyntheticText.contentMode !== 'portal' ? warmSyntheticText.formattedValue : genericCheap;
		const syntheticMode: CellContentMode = cheapValue !== '' ? 'fallback' : 'empty';
		return {
			kind: 'shell',
			className: cellClassName,
			contentMode: syntheticMode,
			formattedValue: cheapValue,
			releaseStalePortal: !!cellSlot.lastPortalKey,
			recordVersions: snapshot ?? versionsFromCtx(),
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	const { globalChanged, rowChanged } = hasMountedDataVersionDrifted(cellSlot, { rowVersion: input.rowVersion, globalVersion: ctx.globalVersion });
	const isDataStale = !isRowRebind && canFreezePortal && (globalChanged || rowChanged);
	const isPortalFrozen =
		!isRowRebind && canFreezePortal && (!isDataStale || (isPortalSnapshotContent(snapshot) && snapshot.contentKind === 'portal-frozen'));
	const isStaleFrozen = isDataStale && canFreezePortal;

	const hasSnapshotCoverageForDecorations = !ctx.hasInsightDecorations || !!snapshot;
	const shouldDirtyFrozenPortal =
		isFocused ||
		isEditing ||
		!hasSnapshotCoverageForDecorations ||
		(ctx.hasDeferredCellStyleRules &&
			(!snapshot || ctx.styleChangedDuringScroll || ctx.selectionChangedDuringScroll || ctx.loadingChangedDuringScroll));

	if (isPortalFrozen || isStaleFrozen) {
		return {
			kind: 'frozen-portal',
			className: cellClassName,
			portalCellKey,
			markDirty: !isPortalFrozen || shouldDirtyFrozenPortal,
			keepVersionFresh: false,
			captureFrozenHtml: false,
			recordVersionsFrom: snapshot,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	// Normal scroll must NEVER reach here with a live mount for a non-interactive cell — the only
	// legitimate reason to still be here with no snapshot, no live content, and no frozen portal is
	// that the cell is actively being edited or focused (an impostor would visibly lie to the user
	// mid-interaction). That is the sole exception; everything else degrades to a deterministic
	// placeholder and waits for the fidelity lane.
	if (isEditing || isFocused) {
		return {
			kind: 'live-renderer',
			className: cellClassName,
			portalCellKey,
			releasePriorPortal: !!cellSlot.lastPortalKey && cellSlot.lastPortalKey !== portalCellKey,
			isEditing,
			isFocused,
			forceLiveInteractive: true,
			recordVersionsFrom: snapshot,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	// Not editing, not focused, no snapshot, no live content to freeze — only reachable for
	// DOM renderers, which sit outside the freeze/impostor mechanism entirely (isDomRenderer above).
	// This is exactly the case that used to fall through to a synchronous cold mount. Show the same
	// cheap deterministic stand-in the freeze path already uses, and let the fidelity lane mount the
	// real renderer later.
	const genericCheap = deps.getCheapDisplayValue(node.id, col.field) ?? '';
	const warmFallbackText = canReuseWarmTextForIdentity(cellSlot, isWarmBindingVersionFresh);
	const fallbackCheapValue = warmFallbackText && warmFallbackText.contentMode !== 'portal' ? warmFallbackText.formattedValue : genericCheap;
	const fallbackSyntheticMode: CellContentMode = fallbackCheapValue !== '' ? 'fallback' : 'empty';
	return {
		kind: 'shell',
		className: cellClassName,
		contentMode: fallbackSyntheticMode,
		formattedValue: fallbackCheapValue,
		releaseStalePortal: !!cellSlot.lastPortalKey,
		recordVersions: snapshot ?? {
			rowVersion: input.rowVersion,
			globalVersion: ctx.globalVersion,
			insightVersion: ctx.insightVersion,
			styleVersion: ctx.styleVersion,
			loadingVersion: ctx.loadingVersion,
			selectionVersion: ctx.selectionVersion,
		},
		title: snapshot?.title || null,
		validationError: snapshot?.validationError,
	};
}
