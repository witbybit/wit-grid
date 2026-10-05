import { GridEventName, type GridEventPayloadMap } from '../api/GridEvents.js';
import type { GridApi, GridCellClickParams, GridCellPointer } from '../api/GridApi.js';
import type { GridCellAccess } from '../api/GridApi.js';
import type { GridInteractionHandle } from './GridInteractionController.js';

export interface GridInteractionEventTarget<TRowData = unknown> {
	cellEl: HTMLElement;
	pointer: GridCellPointer;
	access: GridCellAccess<TRowData> | null;
}

export interface GridInteractionEventRouterDeps<TRowData = unknown> {
	getApi(): GridApi<TRowData>;
	getInteraction(): GridInteractionHandle | null;
	isEventWithinGrid(target: EventTarget | null): boolean;
	resolveCellTarget(event: MouseEvent): GridInteractionEventTarget<TRowData> | null;
	focusCellElement(cellEl: HTMLElement): void;
	isContextMenuEnabled(): boolean;
	showContextMenu(pointer: GridCellPointer, clientX: number, clientY: number): void;
	onCellClick?(params: GridCellClickParams<TRowData>): void;
}

export interface GridInteractionEventRouter {
	bind(container: HTMLElement, options?: { window?: Window; document?: Document }): () => void;
	handleWindowKeyDown(event: KeyboardEvent): void;
	handleDocumentClipboard(event: ClipboardEvent): void;
	handleWindowMouseUp(): void;
	handleDocumentMouseDown(event: MouseEvent): void;
	handleContainerFocusIn(event: FocusEvent): void;
	handleContainerFocusOut(event: FocusEvent): void;
	handleContainerMouseDown(event: MouseEvent): void;
	handleContainerMouseOver(event: MouseEvent): void;
	handleContainerClick(event: MouseEvent): void;
	handleContainerDoubleClick(event: MouseEvent): void;
	handleContainerContextMenu(event: MouseEvent): void;
}

export function createGridInteractionEventRouter<TRowData>(deps: GridInteractionEventRouterDeps<TRowData>): GridInteractionEventRouter {
	let isGridActive = false;

	const buildCellClickParams = (target: GridInteractionEventTarget<TRowData>, event: MouseEvent): GridCellClickParams<TRowData> | null => {
		const { access, pointer } = target;
		if (!access) return null;
		return {
			rowId: access.rowId,
			rowIndex: access.rowIndex,
			row: access.row,
			node: access.node,
			colField: access.colField,
			colIndex: access.colIndex,
			column: access.column,
			value: access.value,
			api: deps.getApi(),
			event,
		};
	};

	const dispatchCellClick = (target: GridInteractionEventTarget<TRowData>, event: MouseEvent): void => {
		const params = buildCellClickParams(target, event);
		if (!params) return;
		deps.onCellClick?.(params);
		deps.getApi().dispatchEvent(GridEventName.cellClicked, params as GridEventPayloadMap<TRowData>[GridEventName.cellClicked]);
	};

	return {
		bind(container, options = {}) {
			const targetWindow = options.window ?? window;
			const targetDocument = options.document ?? document;
			container.addEventListener('focusin', this.handleContainerFocusIn);
			container.addEventListener('focusout', this.handleContainerFocusOut);
			container.addEventListener('mousedown', this.handleContainerMouseDown);
			container.addEventListener('mouseover', this.handleContainerMouseOver);
			container.addEventListener('click', this.handleContainerClick);
			container.addEventListener('dblclick', this.handleContainerDoubleClick);
			container.addEventListener('contextmenu', this.handleContainerContextMenu);
			targetWindow.addEventListener('keydown', this.handleWindowKeyDown);
			for (const type of ['copy', 'cut', 'paste'] as const) targetDocument.addEventListener(type, this.handleDocumentClipboard);
			targetWindow.addEventListener('mouseup', this.handleWindowMouseUp);
			targetDocument.addEventListener('mousedown', this.handleDocumentMouseDown, true);
			return () => {
				targetWindow.removeEventListener('keydown', this.handleWindowKeyDown);
				for (const type of ['copy', 'cut', 'paste'] as const) targetDocument.removeEventListener(type, this.handleDocumentClipboard);
				targetWindow.removeEventListener('mouseup', this.handleWindowMouseUp);
				targetDocument.removeEventListener('mousedown', this.handleDocumentMouseDown, true);
				container.removeEventListener('focusin', this.handleContainerFocusIn);
				container.removeEventListener('focusout', this.handleContainerFocusOut);
				container.removeEventListener('mousedown', this.handleContainerMouseDown);
				container.removeEventListener('mouseover', this.handleContainerMouseOver);
				container.removeEventListener('click', this.handleContainerClick);
				container.removeEventListener('dblclick', this.handleContainerDoubleClick);
				container.removeEventListener('contextmenu', this.handleContainerContextMenu);
			};
		},

		handleWindowKeyDown(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
			if (deps.isEventWithinGrid(activeEl) || isGridActive) {
				interaction.dispatchInput({ kind: 'key-down', event });
			}
		},

		handleDocumentClipboard(event) {
			const interaction = deps.getInteraction();
			if (!interaction || event.defaultPrevented) return;
			const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
			const withinGrid = deps.isEventWithinGrid(activeEl);
			if (!withinGrid && !isGridActive) return;
			// Text fields outside the grid keep their own copy/paste, even right after a grid click.
			if (!withinGrid && activeEl instanceof HTMLElement && (activeEl.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(activeEl.tagName)))
				return;
			interaction.dispatchInput({ kind: 'clipboard', event });
		},

		handleWindowMouseUp() {
			deps.getInteraction()?.dispatchInput({ kind: 'mouse-up' });
		},

		handleDocumentMouseDown(event) {
			isGridActive = deps.isEventWithinGrid(event.target);
		},

		handleContainerFocusIn(event) {
			if (deps.isEventWithinGrid(event.target)) {
				isGridActive = true;
			}
		},

		handleContainerFocusOut(event) {
			if (!deps.isEventWithinGrid(event.relatedTarget)) {
				isGridActive = false;
			}
		},

		handleContainerMouseDown(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;

			isGridActive = true;
			if (interaction.isEditingCell(target.pointer)) return;

			const colDef = target.access?.column;
			if (colDef && (colDef.canDrag !== undefined || colDef.disableCellRangeSelection)) return;

			deps.focusCellElement(target.cellEl);
			interaction.dispatchInput({ kind: 'mouse-down-cell', pointer: target.pointer, event });
		},

		handleContainerMouseOver(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;
			if (event.relatedTarget && target.cellEl.contains(event.relatedTarget as Node)) return;
			interaction.dispatchInput({ kind: 'cell-enter', pointer: target.pointer });
		},

		handleContainerClick(event) {
			const target = deps.resolveCellTarget(event);
			if (!target) return;
			dispatchCellClick(target, event);

			const interaction = deps.getInteraction();
			if (!interaction) return;
			if (interaction.isEditingCell(target.pointer)) return;
			interaction.dispatchInput({ kind: 'cell-click', pointer: target.pointer, event });
		},

		handleContainerDoubleClick(event) {
			const interaction = deps.getInteraction();
			if (!interaction) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;

			if (interaction.isEditingCell(target.pointer)) return;
			if (!target.pointer.columnInstanceId) return;
			interaction.dispatchInput({
				kind: 'set-cell-editing',
				rowId: target.pointer.rowId,
				colFieldOrInstanceId: target.pointer.columnInstanceId,
				isEditing: true,
				source: 'mouse',
			});
		},

		handleContainerContextMenu(event) {
			if (!deps.isContextMenuEnabled()) return;
			const target = deps.resolveCellTarget(event);
			if (!target) return;
			event.preventDefault();
			deps.showContextMenu(target.pointer, event.clientX, event.clientY);
		},
	};
}
