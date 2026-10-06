import type { GridCellPointer } from '../api/GridApi.js';
import type { GridInteractionHandle } from './GridInteractionController.js';

export interface GridViewportInteractionRouterDeps {
	getInteraction(): GridInteractionHandle | null;
	resolveCellPointer(target: Element): GridCellPointer | null;
	/** The hierarchy cell's toggle was clicked (visual row id). */
	onHierarchyToggle?(id: string): void;
	/** The hierarchy cell's checkbox was clicked (visual row id). */
	onHierarchySelect?(id: string, selected: boolean): void;
}

export interface GridViewportInteractionRouter {
	handleViewportMouseDown(event: MouseEvent): void;
	handleViewportClick(event: MouseEvent): void;
}

export function createGridViewportInteractionRouter(deps: GridViewportInteractionRouterDeps): GridViewportInteractionRouter {
	return {
		handleViewportMouseDown(event) {
			deps.getInteraction()?.dispatchInput({ kind: 'viewport-mouse-down', event });
		},

		handleViewportClick(event) {
			const interaction = deps.getInteraction();
			if (!interaction || event.defaultPrevented || event.button !== 0) return;

			const target = event.target as HTMLElement | null;
			if (!target) return;

			const hierarchySelect = target.closest<HTMLInputElement>('input.og-hierarchy-checkbox');
			if (hierarchySelect?.dataset.ogHierarchySelect && deps.onHierarchySelect) {
				event.stopPropagation();
				deps.onHierarchySelect(hierarchySelect.dataset.ogHierarchySelect, hierarchySelect.checked);
				return;
			}
			const hierarchyToggle = target.closest<HTMLElement>('.og-hierarchy-toggle[data-og-hierarchy-toggle]');
			if (hierarchyToggle && !hierarchyToggle.classList.contains('og-hierarchy-toggle-none') && deps.onHierarchyToggle) {
				event.stopPropagation();
				deps.onHierarchyToggle(hierarchyToggle.dataset.ogHierarchyToggle!);
				return;
			}

			// Selection checkboxes carry no row identity of their own: the row comes from the cell's
			// current binding, so a checkbox in a recycled cell can never act on the row it showed before.
			const checkbox = target.closest<HTMLInputElement>('input.og-row-checkbox');
			if (checkbox) {
				event.stopPropagation();
				const rowId = deps.resolveCellPointer(checkbox)?.rowId;
				if (!rowId) return;
				if (checkbox.classList.contains('og-group-select-checkbox')) deps.onHierarchySelect?.(rowId, checkbox.checked);
				else interaction.dispatchInput({ kind: 'row-checkbox-click', rowId, checked: checkbox.checked, event });
				return;
			}

			if (interaction.isRowSelectionIgnoredTarget(target)) return;

			const pointer = deps.resolveCellPointer(target);
			if (!pointer) return;

			interaction.dispatchInput({ kind: 'data-row-click', pointer, event });
		},
	};
}
