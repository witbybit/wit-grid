import { getColumnInstanceIdentity, type InternalColumnDef, type ColumnDef } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import { createEditRendererKey } from './identityKeys.js';
import type { CellSlot, CellContentMode } from './cellSlot.js';
import type { CellDisplaySnapshot } from './cellDisplaySnapshot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { hasMountedDataVersionDrifted, type VisualFreshness } from './visualFreshness.js';
import { getCellScrollPresentation } from './cellScrollMode.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';

/**
 * Narrow, purpose-built dependency surface for the scroll presentation resolver — deliberately
 * NOT `RowCellBinderDeps` (the full binder dependency bag). The resolver only ever needs
 * read-only inspection of these things; it must never gain access to the broader bag,
 * which would make it easy to accidentally reach for a semantic read or a mount call. Testable
 * without constructing the full binder.
 */
export interface ScrollCellPresentationDeps {
	/** Read-only: does this cell currently have a portal host element mounted? */
	getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null;
	/** Read-only: a cached cheap display value for the stand-in text — already
	 *  exempt from the no-semantic-read counters (it's a cache lookup, not a value computation). */
	getCheapDisplayValue(rowId: string, colField: string): string | undefined;
	/** A getter/formula cell's display text computed (and cached) within the frame's budget; undefined when over it. */
	primeDisplayValue?(rowId: string, colField: string): string | undefined;
	/** The raw cached value behind a primed getter/formula cell, for its valueFormatter. */
	getCachedCellValue?(rowId: string, colField: string): unknown;
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

/**
 * Display text the scroll path can produce without a semantic read: a plain column's own field, or
 * a plain field through its valueFormatter — exactly what the full bind writes for it, so a cell
 * shows its final text during scroll instead of a '...' placeholder. Getters and formulas still
 * wait for the full bind.
 */
function readScrollDisplayText<TRowData>(
	deps: ScrollCellPresentationDeps,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	mode: string | undefined
): string | undefined {
	if (mode === 'primitive') return readPrimitiveDisplayText(deps, node, col.field);
	if (mode !== 'primitive-formatted' || col.valueGetter || !col.valueFormatter) return undefined;
	if (!deps.hasFormula || !node.data || col.field.indexOf('.') !== -1 || deps.hasFormula(node.id, col.field)) return undefined;
	const value = (node.data as Record<string, unknown>)[col.field];
	if (typeof value === 'string' && value.startsWith('=')) return undefined;
	try {
		return col.valueFormatter({ value, rowData: node.data as TRowData, colDef: col, rowId: node.id }) ?? '';
	} catch {
		return undefined;
	}
}

/**
 * Stand-in text for a cell during scroll: its cheap display text, or — for a visible getter/formula
 * cell with nothing cached yet — the computed value, within the frame's budget. Without it such a
 * cell was blank until scrolling settled.
 */
function readStandInText<TRowData>(
	deps: ScrollCellPresentationDeps,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	isInVisibleContent: boolean
): string {
	const cheap = deps.getCheapDisplayValue(node.id, col.field) ?? '';
	if (cheap !== '') return cheap;
	// Nothing cached yet (a row the grid has not drawn before): a plain field is its own text.
	if (!col.valueGetter) {
		const own = readPrimitiveDisplayText(deps, node, col.field);
		if (own !== undefined) return own;
	}
	if (!isInVisibleContent || !deps.primeDisplayValue) return cheap;
	if (!col.valueGetter && !deps.hasFormula?.(node.id, col.field)) return cheap;
	return deps.primeDisplayValue(node.id, col.field) ?? '';
}

/**
 * A renderer column's stand-in text: its `scrollText` applied to the generic cheap text (handed the
 * real value when it is a direct field read, as the full bind does), else the generic text itself.
 */
function applyScrollText<TRowData>(deps: ScrollCellPresentationDeps, node: RowNode<TRowData>, col: ColumnDef<TRowData>, generic: string): string {
	const scrollText = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollText;
	if (!scrollText) return generic;
	const value =
		!col.valueGetter && readPrimitiveDisplayText(deps, node, col.field) !== undefined
			? (node.data as Record<string, unknown>)[col.field]
			: undefined;
	return scrollText({ value, formattedValue: generic }) || generic;
}

/** A visible getter/formula text cell's final text, computed within the frame's budget (then formatted, as the full bind does). */
function readPrimedGetterText<TRowData>(deps: ScrollCellPresentationDeps, node: RowNode<TRowData>, col: ColumnDef<TRowData>): string | undefined {
	if (!deps.primeDisplayValue || (!col.valueGetter && !deps.hasFormula?.(node.id, col.field))) return undefined;
	const primed = deps.primeDisplayValue(node.id, col.field);
	if (primed === undefined || !col.valueFormatter) return primed;
	try {
		const value = deps.getCachedCellValue?.(node.id, col.field);
		return col.valueFormatter({ value, rowData: node.data as TRowData, colDef: col, rowId: node.id }) ?? '';
	} catch {
		return undefined;
	}
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
 * instead of replacing it with an stand-in. Warm DOM (`lastPortalKey`, the portal host's own
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
	// The slot's own identity always matches here (mustClearSlotForControllerChange is false by
	// construction), so freezing only needs the held portal to be the one this cell expects.
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
/**
 * Warm text a stand-in may reuse: text the slot actually showed for this identity. An overscan
 * row's portal cell is buffered empty, so reusing its "fresh" empty text would leave the cell blank
 * on entry until the real renderer mounts; the current cheap value is shown instead.
 */
function isShownWarmText(
	warm: { formattedValue: string; contentMode: CellContentMode } | undefined
): warm is { formattedValue: string; contentMode: CellContentMode } {
	return !!warm && (warm.contentMode === 'text' || warm.contentMode === 'fallback');
}

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
			title: string | null;
			validationError: string | undefined;
			/** A snapshot, or this frame's freshness when the cell was filled with its final direct text. */
			recordVersionsFrom: CellDisplaySnapshot | VisualFreshness | undefined;
	  }
	| {
			kind: 'primitive';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			markDirty: boolean;
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
			keepVersionFresh: boolean;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
	  }
	| {
			/**
			 * The real renderer mounts/updates this scroll frame: a React `scroll: 'live'` cell
			 * (`forceLiveInteractive: false`, counted under `liveReactMountsDuringScroll`), or a 'text'
			 * cell the user is editing or focused on (`forceLiveInteractive: true`, counted separately
			 * so a regression that makes it fire for ordinary cells is visible).
			 */
			kind: 'live-renderer';
			className: string;
			portalCellKey: string;
			isEditing: boolean;
			isFocused: boolean;
			forceLiveInteractive: boolean;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			/**
			 * `scroll: 'live'` on a DOM renderer: the cell's DOM renderer is updated in place
			 * this frame, within the frame's DOM-update budget, and recorded fresh so scroll-end does
			 * not redo it. `formattedValue` is the stand-in shown only if the budget refuses the update.
			 */
			kind: 'dom-update';
			className: string;
			portalCellKey: string;
			formattedValue: string;
			isFocused: boolean;
			recordVersions: CellDisplaySnapshot | VisualFreshness;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'stand-in';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			recordVersions: VisualFreshness;
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
	/** Cell style-rule classes evaluated for this frame, when the cell has no fresh snapshot or warm class. */
	styleRuleClass: string | undefined;
}

function buildCellPinClass(lane: 'left' | 'center' | 'right'): string {
	if (lane === 'left') return 'og-cell og-cell-pinned-left';
	if (lane === 'right') return 'og-cell og-cell-pinned-right';
	return 'og-cell';
}

/**
 * What a cell shows during scroll, decided in this one place, in this order (first match wins):
 *
 * | # | Cell                                                        | Result                                   |
 * | - | ----------------------------------------------------------- | ---------------------------------------- |
 * | 1 | row-selection checkbox                                      | `checkbox-selector`                      |
 * | 2 | outside the visible area, not `live`                        | `buffered` (kept content or direct text) |
 * | 3 | plain column (no renderer, not editing, row loaded)         | `primitive` (snapshot, warm or direct text) |
 * | 4 | React renderer, `live`                                      | `live-renderer`                          |
 * | 5 | DOM renderer, `live`, not editing                           | `frozen-portal` if unchanged, else `dom-update` |
 * | 6 | `text` holding its own mounted renderer (see below)         | `frozen-portal`                          |
 * | 7 | React `text` whose prewarm snapshot holds stand-in text     | `primitive` (replays it)                 |
 * | 8 | editing or focused                                          | `live-renderer` (interactive exception)  |
 * | 9 | anything else (`text` entering view)                        | `stand-in` (stand-in text)               |
 *
 * Results that are not final (`markDirty`, stand-in text, over-budget live cells) are completed
 * by the settle repair once scrolling stops; the binders only execute the result.
 *
 * Pure decision function for the scroll hot path. Given the current mounted slot state, a fresh
 * (possibly absent) display snapshot, and renderer capability metadata, decides what the cell
 * should show — never performs a DOM write, portal mount/release, or a semantic read (no
 * getCellValue/valueGetter/formula/style-rule/integrity call). `deps` is only used for read-only
 * inspection: checking whether a portal host already has live content, and reading the column's
 * cheap-display-value cache for the synthetic-stand-in fallback (both already exempt from the
 * no-semantic-read counters — see runtimePerformance.test.ts).
 */
export function resolveScrollCellPresentation<TRowData>(
	deps: ScrollCellPresentationDeps,
	input: ScrollCellPresentationInput<TRowData>
): ScrollCellPresentation {
	const { cellSlot, node, colIndex, col, lane, ctx, isRowRebind, isRowLoading, isInVisibleContent, snapshot, isWarmBindingVersionFresh, cellKey } =
		input;

	if (col.checkboxSelection) {
		// The checkbox binder writes the checked state on every scroll frame; nothing to repair later.
		return { kind: 'checkbox-selector', className: buildCellPinClass(lane) + ' og-cell-row-selector', markDirty: false };
	}

	const compiledPlan = ctx.plan.columnPlans[colIndex];
	const isEditing = doesCanonicalCellPointerMatchColumn(ctx.activeEdit, node.id, col);
	const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading ? 'loading' : isEditing || compiledPlan?.isCustom ? 'portal' : 'primitive';
	const scrollMode = compiledPlan?.mode;
	const isDomRenderer = scrollMode === 'custom-dom';
	const presentation = getCellScrollPresentation(col);

	let cellClassName = buildCellPinClass(lane);
	if (rendererKind === 'loading') cellClassName += ' og-cell-loading';
	if (snapshot?.className) {
		cellClassName = snapshot.className;
	} else if (isWarmBindingVersionFresh && cellSlot.lastClassName) {
		cellClassName = cellSlot.lastClassName;
	} else if (input.styleRuleClass) {
		cellClassName += ' ' + input.styleRuleClass;
	}

	// 'live' cells in the overscan band mount/update too (within budget), so they are already
	// drawn when they reach the viewport.
	if (!isInVisibleContent && presentation !== 'live') {
		const primitiveSnapshot = isPrimitiveSnapshotContent(snapshot) ? snapshot : undefined;
		const canReuseSnapshotContent = !!primitiveSnapshot;
		const canReuseSnapshotPortal =
			snapshot?.contentMode === 'portal' && hasAuthoritativePortalHostContent(deps, cellSlot, cellSlot.lastPortalKey);
		// A plain primitive column's text is a direct field read: fill the buffered cell with it rather
		// than clearing it, so the row enters the viewport already correct. Clearing meant a second
		// write, a text-node replacement and a content-mode flip (a style recalc) per cell on entry.
		const directText =
			!canReuseSnapshotPortal && !canReuseSnapshotContent && rendererKind === 'primitive'
				? readScrollDisplayText(deps, node, col, compiledPlan?.mode)
				: undefined;
		// A renderer cell with nothing to reuse gets its text stand-in, as the visible band would give it:
		// left empty, a row scrolling in showed blank cells for a frame before its next bind.
		const standIn =
			!canReuseSnapshotPortal && !canReuseSnapshotContent && directText === undefined && rendererKind !== 'loading'
				? applyScrollText(deps, node, col, readStandInText(deps, node, col, false))
				: '';
		const preservedContentMode: CellContentMode = canReuseSnapshotPortal
			? 'portal'
			: canReuseSnapshotContent
				? primitiveSnapshot.contentMode
				: directText
					? 'text'
					: rendererKind === 'loading'
						? 'loading'
						: standIn !== ''
							? 'fallback'
							: 'empty';
		return {
			kind: 'buffered',
			className: cellClassName,
			contentMode: preservedContentMode,
			formattedValue:
				canReuseSnapshotContent && (preservedContentMode === 'text' || preservedContentMode === 'fallback')
					? primitiveSnapshot.formattedValue
					: (directText ?? standIn),
			portalKey: preservedContentMode === 'portal' && canReuseSnapshotPortal ? cellSlot.lastPortalKey : undefined,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			// Direct text is the cell's final content: record it as fresh, so the row entering the
			// viewport can keep it instead of binding every cell a second time.
			recordVersionsFrom:
				snapshot ??
				(directText !== undefined && preservedContentMode === 'text'
					? {
							rowVersion: input.rowVersion,
							globalVersion: ctx.globalVersion,
							insightVersion: ctx.insightVersion,
							styleVersion: ctx.styleVersion,
							loadingVersion: ctx.loadingVersion,
							selectionVersion: ctx.selectionVersion,
						}
					: undefined),
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
			const directText = readScrollDisplayText(deps, node, col, compiledPlan?.mode);
			const primedText = directText === undefined && isInVisibleContent ? readPrimedGetterText(deps, node, col) : undefined;
			const text = directText ?? primedText;
			if (text !== undefined) {
				formattedValue = text;
				contentMode = text === '' ? 'empty' : 'text';
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

	// 'live' React renderers mount/update on every scroll frame (the binder budgets it). This must
	// come before every other decision below: no freeze, no stand-in.
	if (presentation === 'live' && !isDomRenderer) {
		return {
			kind: 'live-renderer',
			className: cellClassName,
			portalCellKey,
			isEditing,
			isFocused,
			forceLiveInteractive: false,
			recordVersionsFrom: snapshot,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	// 'live' DOM renderers update in place. An editor is a React portal, so an editing cell takes
	// the interactive path below instead. A slot still holding this cell's current content needs
	// nothing; anything else (a row rebind, or data that changed) updates within the frame budget.
	if (presentation === 'live' && !isEditing) {
		if (canFreezeExistingPortalForIdentity(deps, cellSlot, portalCellKey, isRowRebind)) {
			const { globalChanged, rowChanged } = hasMountedDataVersionDrifted(cellSlot, {
				rowVersion: input.rowVersion,
				globalVersion: ctx.globalVersion,
			});
			if (!globalChanged && !rowChanged) {
				return {
					kind: 'frozen-portal',
					className: cellClassName,
					portalCellKey,
					title: snapshot?.title || null,
					validationError: snapshot?.validationError,
					markDirty: false,
					keepVersionFresh: false,
					recordVersionsFrom: snapshot,
				};
			}
		}
		return {
			kind: 'dom-update',
			className: cellClassName,
			portalCellKey,
			formattedValue: applyScrollText(deps, node, col, deps.getCheapDisplayValue(node.id, col.field) ?? ''),
			isFocused,
			recordVersions: snapshot ?? versionsFromCtx(),
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	// From here on the cell is a 'text' column, or a DOM renderer being edited/focused. A DOM renderer
	// manages its own mount/update lifecycle without React portal overhead, so it never takes the
	// freeze path.

	// Keep the mounted renderer in place when the slot already shows this exact row+key's portal,
	// rather than replacing it with stand-in text (no portal -> text -> portal flash). A row rebind
	// never keeps it: the slot's content belongs to the previous row. A prewarm snapshot holding
	// stand-in text ('fallback') takes precedence. A React 'text' cell keeps its renderer only while
	// not focused or edited; a DOM renderer, or a focused/edited cell, keeps it only when its
	// snapshot confirms live portal content, and is then repaired once scrolling settles.
	const snapshotHoldsStandIn = snapshot?.contentMode === 'fallback';
	const holdsOwnPortal = !snapshotHoldsStandIn && canFreezeExistingPortalForIdentity(deps, cellSlot, portalCellKey, isRowRebind);
	const isPlainTextReactCell = !isDomRenderer && !isEditing && !isFocused;
	if (holdsOwnPortal && (isPlainTextReactCell || (isPortalSnapshotContent(snapshot) && snapshot.contentKind === 'portal-live'))) {
		const { globalChanged, rowChanged } = hasMountedDataVersionDrifted(cellSlot, {
			rowVersion: input.rowVersion,
			globalVersion: ctx.globalVersion,
		});
		const decorationsUncovered = ctx.hasInsightDecorations && !snapshot;
		const deferredStylesStale =
			ctx.hasDeferredCellStyleRules &&
			(!snapshot || ctx.styleChangedDuringScroll || ctx.selectionChangedDuringScroll || ctx.loadingChangedDuringScroll);
		return {
			kind: 'frozen-portal',
			className: cellClassName,
			portalCellKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			markDirty: globalChanged || rowChanged || decorationsUncovered || deferredStylesStale || isFocused || isEditing,
			keepVersionFresh: false,
			recordVersionsFrom: snapshot,
		};
	}

	// The prewarm snapshot already holds this cell's stand-in text: replay it as plain text.
	if (!isDomRenderer && !isEditing && !isFocused && snapshotHoldsStandIn) {
		return {
			kind: 'primitive',
			className: cellClassName,
			contentMode: snapshot.contentMode,
			formattedValue: snapshot.formattedValue,
			markDirty: true,
			title: snapshot.title || null,
			validationError: snapshot.validationError,
			recordVersionsFrom: snapshot,
		};
	}

	// Normal scroll must NEVER reach a live mount for a non-interactive cell — the only legitimate
	// reason is that the cell is actively being edited or focused (stand-in text would visibly lie
	// to the user mid-interaction). Everything else shows stand-in text and waits for the fidelity
	// lane to mount the real renderer.
	if (isEditing || isFocused) {
		return {
			kind: 'live-renderer',
			className: cellClassName,
			portalCellKey,
			isEditing,
			isFocused,
			forceLiveInteractive: true,
			recordVersionsFrom: snapshot,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	const genericCheap = applyScrollText(deps, node, col, readStandInText(deps, node, col, isInVisibleContent));
	const warmText = canReuseWarmTextForIdentity(cellSlot, isWarmBindingVersionFresh);
	const standIn = isShownWarmText(warmText) ? warmText.formattedValue : genericCheap;
	return {
		kind: 'stand-in',
		className: cellClassName,
		contentMode: standIn !== '' ? 'fallback' : 'empty',
		formattedValue: standIn,
		recordVersions: snapshot ?? versionsFromCtx(),
		title: snapshot?.title || null,
		validationError: snapshot?.validationError,
	};
}
