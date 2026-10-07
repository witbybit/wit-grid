export type CellContentMode = 'text' | 'portal' | 'loading' | 'empty' | 'fallback' | 'pending' | 'custom';

import type { CellRendererHandle, CellPlacement } from './cellRendererHandle.js';
import { isMountedCellVisuallyFresh } from './visualFreshness.js';
import type { ColumnDef, ColumnInstanceId } from '../columnDef.js';
import { createCellInstanceRendererKey } from './identityKeys.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import type { CellCtrl, CellCtrlAccessibilityState } from './controllers/CellCtrl.js';
import type { HierarchyCellParts } from './hierarchyCell.js';
import {
	CellSlotLifecycleEvent,
	CellSlotLifecycleState,
	isLegalCellSlotLifecycleTransition,
	transitionCellSlotLifecycle,
} from './cellSlotLifecycle.js';

/** The store side of CellSlot → CellCtrl ownership — see RowCtrlStore.releaseDetachedCellCtrl. */
export interface CellCtrlOwner {
	releaseDetachedCellCtrl(cellCtrl: CellCtrl, slotInstanceId: string): boolean;
}

export interface CellSlotMountedVisualVersions {
	insightVersion: number;
	styleVersion: number;
	loadingVersion: number;
	selectionVersion: number;
}

// Monotonic counter — advances once per CellSlot construction.
// A cell that is destroyed and recreated at the same position gets a strictly
// larger id, so stale portal keys from the destroyed instance never match the
// new instance's keys.
let _cellInstanceCounter = 0;

/**
 * Authoritative identity record for a bound cell slot.
 * Logic must read identity from CellSlot.binding, not from element.dataset.
 * Dataset attributes mirror binding for debug/DevTools inspection only.
 */
export interface CellBinding {
	rowSlotId: string;
	rowId: string;
	rowIndex: number;
	colId: string;
	colIndex: number;
	cellKey: string;
	contentMode: CellContentMode;
}

// Intern common pixel strings — avoids a string allocation on every DOM write.
// Covers all practical column widths and left offsets (0–2000 px).
const _PX = Array.from({ length: 2001 }, (_, i) => `${i}px`);
export const toPx = (n: number): string => (n >= 0 && n < _PX.length ? _PX[n] : `${n}px`);

// DOM write stats shared across all CellSlot instances for performance instrumentation.
export const cellSlotWriteStats = {
	cellTextWrites: 0,
	cellClassWrites: 0,
	cellTransformWrites: 0,
	cellWidthWrites: 0,
	cellLeftWrites: 0,
	cellDomReadsAvoided: 0,
	/** Ownership events on a destroyed slot (a stray bind or release after destroy); always a bug. */
	cellSlotLifecycleViolations: 0,
};

export function resetCellSlotWriteStats(): void {
	cellSlotWriteStats.cellTextWrites = 0;
	cellSlotWriteStats.cellClassWrites = 0;
	cellSlotWriteStats.cellTransformWrites = 0;
	cellSlotWriteStats.cellWidthWrites = 0;
	cellSlotWriteStats.cellLeftWrites = 0;
	cellSlotWriteStats.cellDomReadsAvoided = 0;
	cellSlotWriteStats.cellSlotLifecycleViolations = 0;
}

export function recordCellSlotMountedVisualVersions(cellSlot: CellSlot, versions: CellSlotMountedVisualVersions): void {
	cellSlot.lastMountedInsightVersion = versions.insightVersion;
	cellSlot.lastMountedStyleVersion = versions.styleVersion;
	cellSlot.lastMountedLoadingVersion = versions.loadingVersion;
	cellSlot.lastMountedSelectionVersion = versions.selectionVersion;
}

export function matchesCellSlotMountedVisualVersions(cellSlot: CellSlot, versions: CellSlotMountedVisualVersions): boolean {
	return (
		cellSlot.lastMountedInsightVersion === versions.insightVersion &&
		cellSlot.lastMountedStyleVersion === versions.styleVersion &&
		cellSlot.lastMountedLoadingVersion === versions.loadingVersion &&
		cellSlot.lastMountedSelectionVersion === versions.selectionVersion
	);
}

/** The five non-row version stamps a scroll frame judges mounted state against — satisfied
 *  structurally by ScrollRenderContext, so callers can pass the context itself. */
export interface CellSlotFrameVersions {
	globalVersion: number;
	insightVersion: number;
	styleVersion: number;
	loadingVersion: number;
	selectionVersion: number;
}

/**
 * Allocation-free form of matchesCellSlotMountedFreshness for the per-cell scroll path — the same
 * predicate as isMountedCellVisuallyFresh (a never-stamped slot is always stale), over scalars.
 */
export function isCellSlotMountedFreshAt(cellSlot: CellSlot, rowVersion: number, versions: CellSlotFrameVersions): boolean {
	if (cellSlot.lastMountedRowVersion === -1 && cellSlot.lastMountedGlobalVersion === -1) return false;
	return (
		cellSlot.lastMountedRowVersion === rowVersion &&
		cellSlot.lastMountedGlobalVersion === versions.globalVersion &&
		cellSlot.lastMountedInsightVersion === versions.insightVersion &&
		cellSlot.lastMountedStyleVersion === versions.styleVersion &&
		cellSlot.lastMountedLoadingVersion === versions.loadingVersion &&
		cellSlot.lastMountedSelectionVersion === versions.selectionVersion
	);
}

export function matchesCellSlotMountedFreshness(
	cellSlot: CellSlot,
	request: {
		rowVersion: number;
		globalVersion: number;
		visualVersions: CellSlotMountedVisualVersions;
	}
): boolean {
	return isMountedCellVisuallyFresh(cellSlot, {
		rowVersion: request.rowVersion,
		globalVersion: request.globalVersion,
		insightVersion: request.visualVersions.insightVersion,
		styleVersion: request.visualVersions.styleVersion,
		loadingVersion: request.visualVersions.loadingVersion,
		selectionVersion: request.visualVersions.selectionVersion,
	});
}

/**
 * Writes a cell's text. When the element already holds exactly one Text node, updating its
 * nodeValue avoids the node replacement (and allocation) that `textContent =` performs. Empty
 * text still goes through textContent so the element ends up with no child, as before.
 */
function setCellText(element: HTMLElement, text: string): void {
	const first = element.firstChild;
	if (text !== '' && first !== null && first === element.lastChild && first.nodeType === 3) {
		first.nodeValue = text;
		return;
	}
	element.textContent = text;
}

/**
 * Whether a column's cells hold their text directly (`data-text-cell`), without the
 * `.og-cell-content` wrapper. True for columns with no custom renderer and no row-selection
 * checkbox: their cells only ever show text, so the wrapper — which exists to let a cell swap
 * between text and a renderer by flipping one attribute — is pure cost there: one more element to
 * style-match and one more layout object to re-lay out whenever the text changes.
 * A CellSlot belongs to one column for its whole life, so the choice never changes for a slot.
 */
export function isDirectTextColumn(
	col: Pick<ColumnDef<unknown>, 'checkboxSelection' | 'field'> & { cellRenderer?: unknown; aggregateRenderer?: unknown }
): boolean {
	// An aggregate renderer mounts into the content wrapper on group / total rows.
	return !col.cellRenderer && !col.checkboxSelection && !isHierarchyColumn(col) && !col.aggregateRenderer;
}

export class CellSlot<TRowData = unknown> {
	public lifecycleState: CellSlotLifecycleState = CellSlotLifecycleState.Vacant;
	public readonly element: HTMLDivElement;
	/** Text lives directly in `element` (a text-only column); there is no content wrapper. */
	public readonly directText: boolean;
	private readonly wrapper: HTMLDivElement | null;
	/** Direct-text cells: the cell's single text node, written in place. */
	private readonly textNode: Text | null;
	/**
	 * Unique identity for this physical CellSlot object. Assigned once at construction
	 * and never changes — not even across row rebinds or lane relocations.
	 * Used as the basis for portal cellKeys so that a stale deferred release keyed to a
	 * destroyed cell can never affect a newly created cell at the same row/column position.
	 */
	public readonly cellInstanceId: string;
	/**
	 * Stable string identifier for the portal host of this cell. Derived from cellInstanceId —
	 * never changes for the CellSlot's lifetime. Passed with every portal mount so the React
	 * adapter can verify it is rendering into the correct physical host.
	 */
	public readonly portalHostId: string;
	/**
	 * Lazily created on first portal use (getOrCreatePortalHost). Plain-text columns —
	 * the common case — never pay the extra DOM node (+50% viewport node count).
	 */
	public portalHostElement: HTMLDivElement | null = null;
	/**
	 * Incremented each time this cell is hot-unbound (recycled to a different logical row).
	 * Consumers can capture this at mount time and compare later to detect stale deferred
	 * operations against a cell that has since been rebound to another row.
	 * Unlike slot.generation (which is per-slot), this is per-cell.
	 */
	public rowBindingGeneration = 0;
	/**
	 * Stable column association. Set once by reconcileTopology when the cell is first
	 * created for a column. Never changes across row rebinds or lane relocations —
	 * this cell is permanently associated with this column instance for its lifetime.
	 * Renderer/topology lifecycle identity — see ColumnInstanceId. `colField` (below) mirrors the
	 * display/DOM field name; this is the identity that decides cell reuse.
	 */
	public columnInstanceId: ColumnInstanceId | '' = '';
	/**
	 * Active renderer handle. Null when the cell is unbound or showing no content.
	 * Set by the bind loop when content mode changes; destroy() is called on the
	 * old handle before replacing it with a new one.
	 */
	public renderer: CellRendererHandle<TRowData> | null = null;
	/**
	 * Current lane placement. Set by the bind loop each frame and used by relocate-aware
	 * code paths (e.g. DOM renderers that need to know their position context).
	 */
	public placement: CellPlacement | null = null;

	/**
	 * Authoritative identity for this bound slot.
	 * Null when the slot is unbound. Logic that needs cell identity (portal key, row/col
	 * association) must read from binding, not from element.dataset.
	 */
	public binding: Readonly<CellBinding> | null = null;
	private bindingRecord: CellBinding | null = null;

	// Position — also reflected in binding when bound
	public colIndex = -1;
	public colField = '';
	public rowIndex = -1;
	public rowId = '';

	// Cached DOM states — integers are faster to compare than strings
	public lastRawValue: unknown = undefined;
	public lastFormattedValue: string | undefined = undefined;
	/** The element's title and data-validation-error as last written (see applyCellTitlesAndValidation),
	 *  so binds compare against these instead of reading the DOM per cell. */
	public writtenTitle = '';
	public writtenValidationError: string | undefined = undefined;
	public lastLeft = -1; // absolute left px for center and pin-left cells
	public lastRight = -1; // distance-from-right px for pin-right cells (-1 = not set)
	public lastWidth = -1; // column width px
	public lastShift = 0; // live column-reorder preview offset px; 0 = none
	public lastAriaSelected: boolean | undefined = undefined; // ARIA selection state cache
	public lastAriaReadOnly: boolean | undefined = undefined;
	public lastAriaInvalid: boolean | undefined = undefined;
	public lastClassName = '';
	public lastContentMode: CellContentMode = 'empty';
	/** Diagnostics bitset (PostScrollRepairReason) of why this cell is queued for post-scroll repair. */
	public postScrollRepairReasons = 0;
	public lastPortalKey: string | undefined = undefined;
	// Cached so unbindHot can skip the hasAttribute DOM read in the hot path.
	public hasTabIndex = false;
	// Per-row and global versions recorded when this cell's portal was last mounted.
	// During scroll: if rowVersions.get(rowId) !== lastMountedRowVersion the row data changed
	// (only that row thaws); if globalVersion !== lastMountedGlobalVersion everything thaws.
	public lastMountedRowVersion = -1;
	public lastMountedGlobalVersion = -1;
	public lastMountedInsightVersion = -1;
	public lastMountedStyleVersion = -1;
	public lastMountedLoadingVersion = -1;
	public lastMountedSelectionVersion = -1;

	/**
	 * The CellCtrl this slot is currently presenting, and the store that owns it. When the slot
	 * attaches a different controller (row rebind) or is cold-unbound, the previous one is handed
	 * back to its owner so CellCtrl lifetime stays bounded by the physical slot pool.
	 */
	public boundCellCtrl: CellCtrl | null = null;
	public boundCellCtrlOwner: CellCtrlOwner | null = null;

	/** Horizontal-retention recency stamp (see cellSlotRetention.ts); larger = touched more recently. */
	public retentionStamp = 0;

	/** The selection checkbox in a checkbox-selection column (row or group) — see checkboxCellBinder.ts. */
	public rowCheckbox: HTMLInputElement | null = null;
	/** rowIndex * 4 + checked state the checkbox's aria-label was last written for; -1 = never. */
	public rowCheckboxLabelKey = -1;
	/**
	 * The cell's text was written for a group / total row (an aggregate). A data bind clears it first:
	 * renderer cells keep their text as the scroll-time placeholder, which must be the row's own.
	 */
	public hasAggregateText = false;
	/** A renderer mounted in this cell by core (an aggregate renderer, or the hierarchy column's renderer), and what it last drew. */
	// Typed loosely: only the binder, which knows the row type, calls into it.
	public contentMount: {
		renderer: unknown;
		handle: { update?(params: never): void; destroy?(): void };
		rowId: string;
		value: unknown;
		/** Hierarchy cell renderers: the context last drawn. */
		context?: unknown;
	} | null = null;

	/** Destroys the mounted renderer and clears its content. */
	public releaseContentMount(): void {
		const mount = this.contentMount;
		if (!mount) return;
		this.contentMount = null;
		try {
			mount.handle.destroy?.();
		} finally {
			this.contentElement.textContent = '';
			this.lastFormattedValue = '';
		}
	}
	/** Hierarchy-column cells: their parts, reused across rebinds (see hierarchyCell.ts). */
	public hierarchyParts: HierarchyCellParts | null = null;

	// JS-side mirrors of DOM state, so steady-state binds never read the DOM back.

	private lastDatasetColumnInstanceId: string | undefined = undefined;
	private rendererKeyColumnInstanceId: string | undefined = undefined;
	private rendererKey = '';

	constructor(element: HTMLDivElement) {
		this.cellInstanceId = `ci${++_cellInstanceCounter}`;
		this.portalHostId = `${this.cellInstanceId}-ph`;
		this.element = element;
		if (!element.id) element.id = `og-cell-${this.cellInstanceId}`;
		(element as any).__cellSlot = this;
		this.writtenTitle = element.title;
		this.writtenValidationError = element.dataset.validationError;
		// ARIA grid semantics — role is static per element; positional/state attrs are
		// written (guarded) in update().
		if (element.getAttribute('role') !== 'gridcell') element.setAttribute('role', 'gridcell');
		this.directText = element.dataset.textCell !== undefined;
		if (this.directText) {
			const first = element.firstChild;
			let textNode = first !== null && first.nodeType === 3 ? (first as Text) : null;
			if (!textNode) {
				textNode = document.createTextNode('');
				element.insertBefore(textNode, element.firstChild);
			}
			this.textNode = textNode;
			this.wrapper = null;
		} else {
			let content = element.querySelector('.og-cell-content') as HTMLDivElement;
			if (!content) {
				content = document.createElement('div');
				content.className = 'og-cell-content';
				element.appendChild(content);
			}
			this.wrapper = content;
			this.textNode = null;
		}
		// Adopt an existing portal host (recycled element); otherwise create lazily.
		this.portalHostElement = element.querySelector('.og-cell-portal-host') as HTMLDivElement | null;
	}

	/**
	 * The `.og-cell-content` wrapper of a cell that can show more than text (custom renderer or
	 * row-selection checkbox). Direct-text cells have none; asking for it is a programming error.
	 */
	public get contentElement(): HTMLDivElement {
		if (!this.wrapper) throw new Error('CellSlot: a direct-text cell has no content wrapper');
		return this.wrapper;
	}

	/** Writes the cell's text; callers keep lastFormattedValue in step. */
	private writeText(text: string): void {
		if (this.textNode) this.textNode.nodeValue = text;
		else setCellText(this.wrapper!, text);
	}

	/** Clears the text and the text cache together (loading skeletons, cold unbind). */
	public clearText(): void {
		if (this.lastFormattedValue === '') return;
		this.lastFormattedValue = '';
		this.writeText('');
	}

	/** Portal host accessor — creates the div on first use only. */
	public getOrCreatePortalHost(): HTMLDivElement {
		let host = this.portalHostElement;
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-cell-portal-host';
			this.element.appendChild(host);
			this.portalHostElement = host;
		}
		return host;
	}

	/**
	 * createCellInstanceRendererKey(this.cellInstanceId, columnInstanceId), memoized — the inputs
	 * never change for a given column, so the scroll path doesn't rebuild the string per bind.
	 */
	public getRendererKey(columnInstanceId: ColumnInstanceId): string {
		if (this.rendererKeyColumnInstanceId !== columnInstanceId) {
			this.rendererKeyColumnInstanceId = columnInstanceId;
			this.rendererKey = createCellInstanceRendererKey(this.cellInstanceId, columnInstanceId);
		}
		return this.rendererKey;
	}

	public static fromElement<TRowData = unknown>(element: HTMLDivElement): CellSlot<TRowData> {
		const existing = (element as any).__cellSlot as CellSlot<TRowData> | undefined;
		if (existing && existing.element === element) {
			return existing;
		}
		return new CellSlot<TRowData>(element);
	}

	public syncAccessibilityState(input: CellCtrlAccessibilityState): boolean {
		let domUpdated = false;

		if (this.lastAriaSelected !== input.selected) {
			this.lastAriaSelected = input.selected;
			if (input.selected) this.element.setAttribute('aria-selected', 'true');
			else this.element.removeAttribute('aria-selected');
			domUpdated = true;
		}

		if (this.lastAriaReadOnly !== input.readOnly) {
			this.lastAriaReadOnly = input.readOnly;
			if (input.readOnly) this.element.setAttribute('aria-readonly', 'true');
			else this.element.removeAttribute('aria-readonly');
			domUpdated = true;
		}

		if (this.lastAriaInvalid !== input.invalid) {
			this.lastAriaInvalid = input.invalid;
			if (input.invalid) this.element.setAttribute('aria-invalid', 'true');
			else this.element.removeAttribute('aria-invalid');
			domUpdated = true;
		}

		if (input.focused) {
			// hasTabIndex mirrors the attribute this method wrote; the only other writer
			// (gridHost focusCellElement) writes the same -1, so no DOM read-back is needed.
			if (!this.hasTabIndex) {
				this.element.tabIndex = -1;
				this.hasTabIndex = true;
				domUpdated = true;
			}
		} else if (this.hasTabIndex) {
			this.element.removeAttribute('tabindex');
			this.hasTabIndex = false;
			domUpdated = true;
		}

		return domUpdated;
	}

	/**
	 * Binds the cell slot to new parameters. Prevents DOM writes if values match.
	 *
	 * Center cells use content-space left offsets.
	 * Pinned cells use scroll-adjusted left offsets and stay absolute.
	 */
	public update(
		colIndex: number,
		colField: string,
		rowIndex: number,
		rowId: string,
		left: number,
		right: number,
		width: number,
		className: string,
		contentMode: CellContentMode,
		rawValue: unknown,
		formattedValue: string,
		portalKey?: string,
		dragShift = 0
	): boolean {
		let domUpdated = false;
		if (this.lifecycleState !== CellSlotLifecycleState.Bound) {
			this.transitionLifecycle(CellSlotLifecycleEvent.Bind);
		}

		if (this.colIndex !== colIndex) {
			this.colIndex = colIndex;
			this.element.setAttribute('aria-colindex', String(colIndex + 1)); // ARIA: 1-based
		}
		if (this.colField !== colField) {
			this.colField = colField;
			this.element.setAttribute('data-col-field', colField);
			domUpdated = true;
		}
		if (this.lastDatasetColumnInstanceId !== this.columnInstanceId) {
			this.lastDatasetColumnInstanceId = this.columnInstanceId;
			if (this.element.getAttribute('data-column-instance-id') !== this.columnInstanceId) {
				this.element.setAttribute('data-column-instance-id', this.columnInstanceId);
				domUpdated = true;
			}
		}
		if (this.rowIndex !== rowIndex) {
			this.rowIndex = rowIndex;
			this.element.setAttribute('data-row-index', String(rowIndex));
			domUpdated = true;
		}
		if (this.rowId !== rowId) {
			this.rowId = rowId;
			this.element.setAttribute('data-row-id', rowId);
			domUpdated = true;
			// Paths that draw a row without committing a binding (group, total and loading rows) must
			// not leave the previous row's identity behind for pointer resolution to find.
			if (this.binding !== null && this.binding.rowId !== rowId) this.binding = null;
			// A stale inline visibility can only be left over from before this identity was bound
			// (nothing sets it on a bound cell), so the style read is limited to rebinds.
			if (this.element.style.visibility) {
				this.element.style.visibility = '';
			}
		}

		// Position — one DOM write per changed axis, pin-right uses right, others use left
		if (right >= 0) {
			if (this.lastRight !== right) {
				this.lastRight = right;
				this.element.style.right = toPx(right);
				cellSlotWriteStats.cellLeftWrites++;
				domUpdated = true;
			}
			if (this.lastLeft !== -1) {
				this.lastLeft = -1;
				this.element.style.left = '';
			}
		} else {
			if (this.lastLeft !== left) {
				this.lastLeft = left;
				this.element.style.left = toPx(left);
				cellSlotWriteStats.cellLeftWrites++;
				domUpdated = true;
			}
			if (this.lastRight !== -1) {
				this.lastRight = -1;
				this.element.style.right = '';
			}
		}

		if (this.lastWidth !== width) {
			this.lastWidth = width;
			this.element.style.width = toPx(width);
			cellSlotWriteStats.cellWidthWrites++;
			domUpdated = true;
		}

		// Live column-reorder preview offset. Composes on top of the `left`/`right`
		// positioning above. Guarded by lastShift so steady-state binds (shift 0) never touch
		// transform — the per-cell hot path stays write-free outside an active header drag.
		if (dragShift !== this.lastShift) {
			this.lastShift = dragShift;
			this.element.style.transform = dragShift !== 0 ? `translateX(${toPx(dragShift)})` : '';
			cellSlotWriteStats.cellTransformWrites++;
			domUpdated = true;
		}

		if (this.lastClassName !== className) {
			this.lastClassName = className;
			this.element.className = className;
			cellSlotWriteStats.cellClassWrites++;
			domUpdated = true;
		}

		if (this.lastContentMode !== contentMode) {
			this.lastContentMode = contentMode;
			this.element.setAttribute('data-content-mode', contentMode);
			domUpdated = true;
		}

		if (this.lastPortalKey !== portalKey) {
			this.lastPortalKey = portalKey;
			if (portalKey) {
				this.element.setAttribute('data-cell-key', portalKey);
			} else {
				delete this.element.dataset.cellKey;
			}
			domUpdated = true;
		}

		this.lastRawValue = rawValue;

		// Compare against JS-side cache only — no DOM read.
		// lastFormattedValue is always kept in sync with contentElement.textContent.
		// 'custom' mode: content is managed externally (e.g. checkbox cells) — never touch textContent.
		if (contentMode !== 'custom') {
			if (contentMode === 'text' || contentMode === 'fallback') {
				if (this.lastFormattedValue !== formattedValue) {
					this.lastFormattedValue = formattedValue;
					this.writeText(formattedValue);
					cellSlotWriteStats.cellTextWrites++;
					domUpdated = true;
				} else {
					cellSlotWriteStats.cellDomReadsAvoided++;
				}
			} else if (contentMode !== 'portal' || this.directText) {
				// Wrapped cells in portal mode leave their text in the DOM — CSS hides .og-cell-content
				// via [data-content-mode="portal"] > .og-cell-content { display: none }, so a
				// text <-> renderer swap costs one attribute write. A direct-text cell only enters portal
				// mode to host an editor, and a bare text node cannot be hidden, so it clears its text.
				// Text is otherwise cleared lazily when the cell transitions to empty/loading/pending.
				if (this.lastFormattedValue !== '') {
					this.lastFormattedValue = '';
					this.writeText('');
					cellSlotWriteStats.cellTextWrites++;
					domUpdated = true;
				} else {
					cellSlotWriteStats.cellDomReadsAvoided++;
				}
			}
		}

		return domUpdated;
	}

	public updatePosition(left: number): boolean {
		let domUpdated = false;
		if (this.lastLeft !== left) {
			this.lastLeft = left;
			this.element.style.left = toPx(left);
			cellSlotWriteStats.cellLeftWrites++;
			domUpdated = true;
		}
		if (this.lastRight !== -1) {
			this.lastRight = -1;
			this.element.style.right = '';
			domUpdated = true;
		}
		return domUpdated;
	}

	/**
	 * Set the authoritative binding for this cell slot.
	 * Called by RowRenderer when it binds a cell to a new physical row slot.
	 * Dataset attributes remain as debug mirrors; logic must read from binding.
	 */
	public commitBinding(
		rowSlotId: string,
		rowId: string,
		rowIndex: number,
		colId: string,
		colIndex: number,
		cellKey: string,
		contentMode: CellContentMode
	): void {
		if (this.lifecycleState !== CellSlotLifecycleState.Bound) {
			this.transitionLifecycle(CellSlotLifecycleEvent.Bind);
		}
		let binding = this.bindingRecord;
		if (
			binding &&
			this.binding === binding &&
			binding.rowSlotId === rowSlotId &&
			binding.rowId === rowId &&
			binding.rowIndex === rowIndex &&
			binding.colId === colId &&
			binding.colIndex === colIndex &&
			binding.cellKey === cellKey &&
			binding.contentMode === contentMode
		) {
			return;
		}
		if (!binding) {
			binding = { rowSlotId, rowId, rowIndex, colId, colIndex, cellKey, contentMode };
			this.bindingRecord = binding;
		} else {
			binding.rowSlotId = rowSlotId;
			binding.rowId = rowId;
			binding.rowIndex = rowIndex;
			binding.colId = colId;
			binding.colIndex = colIndex;
			binding.cellKey = cellKey;
			binding.contentMode = contentMode;
		}
		this.binding = binding;
	}

	private transitionLifecycle(event: CellSlotLifecycleEvent): void {
		if (!isLegalCellSlotLifecycleTransition(this.lifecycleState, event)) cellSlotWriteStats.cellSlotLifecycleViolations++;
		this.lifecycleState = transitionCellSlotLifecycle(this.lifecycleState, event);
	}

	public unbindHot(): void {
		this.transitionLifecycle(CellSlotLifecycleEvent.HotRelease);
		this.rowBindingGeneration++;
		this.binding = null;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';
		this.lastRawValue = undefined;
		this.lastMountedRowVersion = -1;
		this.lastMountedGlobalVersion = -1;
		this.lastMountedInsightVersion = -1;
		this.lastMountedStyleVersion = -1;
		this.lastMountedLoadingVersion = -1;
		this.lastMountedSelectionVersion = -1;
		if (this.lastAriaSelected !== undefined) {
			this.lastAriaSelected = undefined;
			this.element.removeAttribute('aria-selected');
		}
		if (this.hasTabIndex) {
			this.element.removeAttribute('tabindex');
			this.hasTabIndex = false;
		}
		if (this.lastAriaReadOnly !== undefined) {
			this.lastAriaReadOnly = undefined;
			this.element.removeAttribute('aria-readonly');
		}
		if (this.lastAriaInvalid !== undefined) {
			this.lastAriaInvalid = undefined;
			this.element.removeAttribute('aria-invalid');
		}
		if (this.element.style.visibility) {
			this.element.style.visibility = '';
		}
	}

	/**
	 * Records `cellCtrl` as the controller this slot presents, releasing the previously bound one
	 * (if different) back to its owner. `owner` is null for test doubles without a RowCtrlStore.
	 */
	public attachCellCtrl(cellCtrl: CellCtrl, owner: CellCtrlOwner | null): void {
		const previous = this.boundCellCtrl;
		if (previous === cellCtrl) return;
		if (previous) this.boundCellCtrlOwner?.releaseDetachedCellCtrl(previous, this.cellInstanceId);
		this.boundCellCtrl = cellCtrl;
		this.boundCellCtrlOwner = owner;
	}

	/** Releases the bound controller (if any) back to its owner. */
	public detachCellCtrl(): void {
		const previous = this.boundCellCtrl;
		if (!previous) return;
		this.boundCellCtrl = null;
		this.boundCellCtrlOwner?.releaseDetachedCellCtrl(previous, this.cellInstanceId);
		this.boundCellCtrlOwner = null;
	}

	public releaseCold(): void {
		this.transitionLifecycle(CellSlotLifecycleEvent.ColdRelease);
		this.detachCellCtrl();
		this.releaseContentMount();
		if (this.renderer !== null) {
			this.renderer.destroy();
			this.renderer = null;
		}
		this.placement = null;
		this.binding = null;
		this.lastRawValue = undefined;
		this.lastFormattedValue = undefined;
		this.lastLeft = -1;
		this.lastRight = -1;
		this.lastWidth = -1;
		if (this.lastShift !== 0) {
			this.lastShift = 0;
			this.element.style.transform = '';
		}
		if (this.lastAriaSelected !== undefined) {
			this.lastAriaSelected = undefined;
			this.element.removeAttribute('aria-selected');
		}
		if (this.lastAriaReadOnly !== undefined) {
			this.lastAriaReadOnly = undefined;
			this.element.removeAttribute('aria-readonly');
		}
		if (this.lastAriaInvalid !== undefined) {
			this.lastAriaInvalid = undefined;
			this.element.removeAttribute('aria-invalid');
		}
		if (this.hasTabIndex) this.element.removeAttribute('tabindex');
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.postScrollRepairReasons = 0;
		this.lastPortalKey = undefined;
		this.hasTabIndex = false;
		this.lastMountedRowVersion = -1;
		this.lastMountedGlobalVersion = -1;
		this.lastMountedInsightVersion = -1;
		this.lastMountedStyleVersion = -1;
		this.lastMountedLoadingVersion = -1;
		this.lastMountedSelectionVersion = -1;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';

		this.writeText('');
		this.element.className = '';
		this.element.removeAttribute('style');
		delete this.element.dataset.colField;
		delete this.element.dataset.columnInstanceId;
		this.lastDatasetColumnInstanceId = undefined;
		delete this.element.dataset.rowIndex;
		delete this.element.dataset.rowId;
		delete this.element.dataset.cellKey;
		delete this.element.dataset.contentMode;
	}

	public destroy(): void {
		if (this.lifecycleState === CellSlotLifecycleState.Destroyed) return;
		this.releaseCold();
		this.transitionLifecycle(CellSlotLifecycleEvent.Destroy);
	}
}
