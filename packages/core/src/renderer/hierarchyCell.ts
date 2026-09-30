import type { DescendantSelectionState } from '../rows/hierarchyIndex.js';
import type { HierarchyCellModel } from '../rows/hierarchyCellModel.js';

export { resolveHierarchyCellModel, type HierarchyCellModel, type HierarchyCellDeps, type HierarchyCellInputs } from '../rows/hierarchyCellModel.js';

/** The cell's parts, created once per cell and reused across rebinds. */
export interface HierarchyCellParts {
	root: HTMLDivElement;
	toggle: HTMLSpanElement;
	checkbox: HTMLInputElement | null;
	label: HTMLSpanElement;
	count: HTMLSpanElement;
	last: {
		indentPx: number;
		toggle: HierarchyCellModel['toggle'] | undefined;
		targetId: string;
		checkbox: DescendantSelectionState | null | undefined;
		label: string;
		count: string | null | undefined;
	};
}

function createParts(content: HTMLElement): HierarchyCellParts {
	content.textContent = '';
	const root = document.createElement('div');
	root.className = 'og-hierarchy';
	const toggle = document.createElement('span');
	toggle.className = 'og-hierarchy-toggle';
	const label = document.createElement('span');
	label.className = 'og-hierarchy-label';
	const count = document.createElement('span');
	count.className = 'og-hierarchy-count';
	root.append(toggle, label, count);
	content.appendChild(root);
	return {
		root,
		toggle,
		checkbox: null,
		label,
		count,
		last: { indentPx: -1, toggle: undefined, targetId: '', checkbox: undefined, label: '', count: undefined },
	};
}

/**
 * Writes a hierarchy cell, touching only what changed since the last write. Returns the parts to
 * keep on the cell. Cheap enough for every scroll frame: at most a handful of attribute and text
 * writes, no allocation after the first bind.
 */
export function writeHierarchyCell(content: HTMLElement, existing: HierarchyCellParts | null, model: HierarchyCellModel): HierarchyCellParts {
	const parts = existing && existing.root.parentNode === content ? existing : createParts(content);
	const last = parts.last;

	if (last.indentPx !== model.indentPx) {
		parts.root.style.paddingLeft = `${model.indentPx}px`;
		last.indentPx = model.indentPx;
	}
	if (last.targetId !== model.targetId) {
		parts.toggle.dataset.ogHierarchyToggle = model.targetId;
		if (parts.checkbox) parts.checkbox.dataset.ogHierarchySelect = model.targetId;
		last.targetId = model.targetId;
	}
	if (last.toggle !== model.toggle) {
		parts.toggle.className =
			model.toggle === null ? 'og-hierarchy-toggle og-hierarchy-toggle-none' : `og-hierarchy-toggle og-hierarchy-toggle-${model.toggle}`;
		if (model.toggle === null) {
			parts.toggle.removeAttribute('role');
			parts.toggle.removeAttribute('aria-expanded');
			parts.toggle.textContent = '';
		} else {
			parts.toggle.setAttribute('role', 'button');
			parts.toggle.setAttribute('aria-expanded', String(model.toggle === 'open'));
			parts.toggle.setAttribute('aria-label', model.toggle === 'open' ? 'Collapse' : 'Expand');
		}
		last.toggle = model.toggle;
	}
	if (last.checkbox !== model.checkbox) {
		if (model.checkbox === null) {
			parts.checkbox?.remove();
			parts.checkbox = null;
		} else {
			if (!parts.checkbox) {
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.className = 'og-hierarchy-checkbox';
				checkbox.tabIndex = -1;
				checkbox.dataset.ogHierarchySelect = model.targetId;
				parts.root.insertBefore(checkbox, parts.label);
				parts.checkbox = checkbox;
			}
			parts.checkbox.checked = model.checkbox === 'all';
			parts.checkbox.indeterminate = model.checkbox === 'some';
		}
		last.checkbox = model.checkbox;
	}
	if (last.label !== model.label) {
		parts.label.textContent = model.label;
		last.label = model.label;
	}
	if (last.count !== model.count) {
		parts.count.textContent = model.count ?? '';
		parts.count.hidden = model.count === null;
		last.count = model.count;
	}
	return parts;
}
