/**
 * Query: conditions across columns in nested All / Any groups, edited as a draft and applied
 * with Apply. Each condition picks a column and edits it with that column's filter editor.
 */
import { createCellListbox } from '../../cells/listbox.js';
import { openCellPopover, type CellPopover } from '../../cells/popover.js';
import type { ColumnFilter } from '../../filterModel.js';
import { resolveColumnFilterDef, type DomFilterEditorHandle } from '../../filters/filterDef.js';
import {
	countQueryNodes,
	createEmptyQueryModel,
	type GridQueryCondition,
	type GridQueryGroup,
	type GridQueryModel,
	type GridQueryNode,
} from '../../query/GridQueryModel.js';
import { disposables, el, emptyState, icon, iconButton, textButton } from '../panelKit.js';
import type { SidebarPanel } from '../sidebarTypes.js';

/** Groups nest this deep at most. */
const MAX_DEPTH = 2;
let nextId = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

function updateNode(group: GridQueryGroup, id: string, update: (node: GridQueryNode) => GridQueryNode | null): GridQueryGroup {
	const children: GridQueryNode[] = [];
	for (const child of group.children) {
		if (child.id === id) {
			const next = update(child);
			if (next) children.push(next);
		} else children.push(child.kind === 'group' ? updateNode(child, id, update) : child);
	}
	return { ...group, children };
}

export const queryPanel: SidebarPanel<any> = {
	mount(container, { api, actions, mountFilterEditor }) {
		const d = disposables();
		const editors: DomFilterEditorHandle[] = [];
		let picker: CellPopover | null = null;
		const applied = () => (api.getStateSnapshot().queryModel as GridQueryModel | null) ?? null;
		let draft: GridQueryModel = applied() ?? createEmptyQueryModel();
		const isDirty = () => JSON.stringify(draft.root) !== JSON.stringify((applied() ?? createEmptyQueryModel()).root);

		const root = el('div', 'og-sb-query');
		const tree = el('div', 'og-sb-stack');
		const footer = el('div', 'og-sb-footer');
		const status = el('span', 'og-sb-footer-status');
		const reset = textButton('Reset', () => {
			draft = applied() ?? createEmptyQueryModel();
			render();
		});
		const apply = textButton('Apply', () => {
			api.setQueryModel(countQueryNodes(draft.root).conditions > 0 ? draft : null);
			syncFooter();
		}, 'primary');
		footer.append(status, reset, apply);
		root.append(tree, footer);
		container.appendChild(root);
		const clear = textButton('Clear', () => {
			api.setQueryModel(null);
			draft = createEmptyQueryModel();
			render();
		});
		actions.appendChild(clear);

		const columns = () => api.getColumns().filter((c) => resolveColumnFilterDef(c) !== null);
		const labelOf = (field: string) => {
			const column = api.getColumns().find((c) => c.field === field);
			return column ? column.header || column.field : null;
		};
		const setRoot = (next: GridQueryGroup, rerender = true) => {
			draft = { ...draft, root: next };
			if (rerender) render();
			else syncFooter();
		};
		const newCondition = (): GridQueryCondition => ({ kind: 'condition', id: newId('c'), columnId: columns()[0]?.field ?? '', filter: null });

		const syncFooter = () => {
			const { conditions } = countQueryNodes(draft.root);
			const dirty = isDirty();
			const live = applied();
			status.textContent = dirty
				? `${conditions} condition${conditions === 1 ? '' : 's'} · not applied`
				: live
					? `Applied · ${conditions} condition${conditions === 1 ? '' : 's'}`
					: '';
			status.toggleAttribute('data-dirty', dirty);
			apply.disabled = !dirty;
			reset.hidden = !dirty;
			clear.hidden = !live;
			footer.hidden = conditions === 0 && !dirty;
		};

		const pickColumn = (anchor: HTMLElement, condition: GridQueryCondition) => {
			picker?.close();
			const options = columns().map((c) => ({ value: c.field, label: c.header || c.field }));
			const listbox = createCellListbox({
				options,
				selected: [condition.columnId],
				searchable: options.length > 6,
				searchPlaceholder: 'Find a column…',
				onSelect: (value) => {
					picker?.close();
					if (value && value !== condition.columnId) setRoot(updateNode(draft.root, condition.id, (node) => ({ ...node, columnId: value, filter: null }) as GridQueryNode));
				},
			});
			picker = openCellPopover({ anchor, content: listbox.element, label: 'Column', matchAnchorWidth: true, onDismiss: () => (picker = null) });
			listbox.focus();
		};

		const conditionCard = (condition: GridQueryCondition) => {
			const card = el('div', 'og-sb-qcond');
			const head = el('div', 'og-sb-qcond-head');
			const label = labelOf(condition.columnId);
			const choose = el('button', 'og-sb-select');
			choose.type = 'button';
			choose.setAttribute('aria-label', 'Column');
			choose.setAttribute('aria-haspopup', 'listbox');
			choose.append(el('span', 'og-sb-select-label', label ?? condition.columnId), icon('chevronRight', 14));
			choose.addEventListener('click', () => pickColumn(choose, condition));
			head.append(choose, iconButton('x', 'Remove condition', () => setRoot(updateNode(draft.root, condition.id, () => null)), 14));
			card.appendChild(head);
			if (!label) {
				const warn = el('div', 'og-sb-warn');
				warn.append(icon('alert', 14), el('span', undefined, `“${condition.columnId}” is not a column any more. Pick another or remove this condition.`));
				card.appendChild(warn);
				return card;
			}
			const host = el('div', 'og-sb-qcond-body');
			card.appendChild(host);
			const editor = mountFilterEditor(host, condition.columnId, {
				surface: 'query',
				draft: {
					filter: condition.filter,
					// Edits update the draft without rebuilding (the field keeps focus).
					onChange: (filter: ColumnFilter | null) =>
						setRoot(
							updateNode(draft.root, condition.id, (node) => ({ ...node, filter }) as GridQueryNode),
							false
						),
				},
			});
			if (editor) editors.push(editor);
			return card;
		};

		const groupCard = (group: GridQueryGroup, depth: number): HTMLElement => {
			const card = el('div', depth === 0 ? 'og-sb-qgroup og-sb-qgroup-root' : 'og-sb-qgroup');
			card.dataset.depth = String(depth);
			const head = el('div', 'og-sb-qgroup-head');
			head.appendChild(el('span', 'og-sb-qgroup-text', depth === 0 ? 'Rows where' : 'Where'));
			const seg = el('div', 'og-sb-seg og-sb-seg-sm');
			seg.setAttribute('role', 'radiogroup');
			seg.setAttribute('aria-label', 'Combine with');
			for (const [value, text] of [
				['and', 'All'],
				['or', 'Any'],
			] as const) {
				const b = el('button', 'og-sb-seg-btn', text);
				b.type = 'button';
				b.setAttribute('role', 'radio');
				b.setAttribute('aria-checked', String(group.operator === value));
				b.addEventListener('click', () => {
					if (group.operator === value) return;
					setRoot(depth === 0 ? { ...draft.root, operator: value } : updateNode(draft.root, group.id, (node) => ({ ...node, operator: value }) as GridQueryNode));
				});
				seg.appendChild(b);
			}
			head.append(seg, el('span', 'og-sb-qgroup-text', 'of these match'));
			if (depth > 0) head.appendChild(iconButton('x', 'Remove group', () => setRoot(updateNode(draft.root, group.id, () => null)), 14));
			card.appendChild(head);

			const body = el('div', 'og-sb-qgroup-body');
			group.children.forEach((child, index) => {
				if (index > 0) body.appendChild(el('div', 'og-sb-qjoin', group.operator === 'and' ? 'and' : 'or'));
				body.appendChild(child.kind === 'group' ? groupCard(child, depth + 1) : conditionCard(child));
			});
			card.appendChild(body);

			const add = el('div', 'og-sb-qgroup-add');
			const append = (node: GridQueryNode) =>
				setRoot(depth === 0 ? { ...draft.root, children: [...draft.root.children, node] } : updateNode(draft.root, group.id, (g) => ({ ...(g as GridQueryGroup), children: [...(g as GridQueryGroup).children, node] })));
			add.appendChild(textButton('Condition', () => append(newCondition()), 'ghost', 'plus'));
			if (depth < MAX_DEPTH)
				add.appendChild(
					textButton('Group', () => append({ kind: 'group', id: newId('g'), operator: group.operator === 'and' ? 'or' : 'and', children: [newCondition()] }), 'ghost', 'plus')
				);
			card.appendChild(add);
			return card;
		};

		const render = () => {
			picker?.close();
			for (const editor of editors.splice(0)) editor.destroy?.();
			tree.textContent = '';
			if (columns().length === 0) {
				tree.appendChild(emptyState('query', 'Nothing to query', 'None of the columns are filterable.'));
			} else if (draft.root.children.length === 0) {
				tree.appendChild(emptyState('query', 'No query yet', 'Combine conditions across columns with all / any, and nest groups for the rest.'));
				const start = textButton('Add a condition', () => setRoot({ ...draft.root, children: [newCondition()] }), 'subtle', 'plus');
				start.classList.add('og-sb-add');
				tree.appendChild(start);
			} else {
				tree.appendChild(groupCard(draft.root, 0));
			}
			syncFooter();
		};

		render();
		// The applied query changed elsewhere (a view, the api): follow it unless the draft has edits.
		let lastApplied = applied();
		d.add(
			api.subscribeToKey('queryModel', () => {
				const next = applied();
				const followed = JSON.stringify(draft.root) === JSON.stringify((lastApplied ?? createEmptyQueryModel()).root);
				lastApplied = next;
				if (followed) {
					draft = next ?? createEmptyQueryModel();
					render();
				} else syncFooter();
			})
		);
		d.add(api.subscribeToKey('columns', render));
		return {
			destroy() {
				picker?.close();
				for (const editor of editors.splice(0)) editor.destroy?.();
				d.dispose();
			},
		};
	},
};
