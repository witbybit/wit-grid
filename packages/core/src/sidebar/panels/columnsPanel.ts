/**
 * Columns: row grouping on top (drop a column on it, drag the pills to reorder), then every
 * column in its lane (pinned left, scrolling, pinned right). Tick to show or hide; drag within a
 * lane to reorder; group and pin from each row.
 */
import { openCellPopover, type CellPopover } from '../../cells/popover.js';
import type { ColumnDef } from '../../columnDef.js';
import { isHierarchyColumn } from '../../rows/hierarchyColumn.js';
import { checkbox, disposables, el, emptyState, icon, iconButton, searchField, switchRow, textButton } from '../panelKit.js';
import type { SidebarIconName } from '../sidebarIcons.js';
import type { SidebarPanel } from '../sidebarTypes.js';

type Lane = 'left' | 'center' | 'right';
type View = 'all' | 'visible' | 'hidden';

const LANE_TITLES: Record<Lane, string> = { left: 'Pinned left', center: 'Columns', right: 'Pinned right' };

export const columnsPanel: SidebarPanel<any> = {
	mount(container, { api }) {
		const d = disposables();
		let query = '';
		let view: View = 'all';
		let menu: CellPopover | null = null;
		/** What is being dragged: a column row (and its lane) or a group pill. */
		let drag: { kind: 'column'; field: string; lane: Lane } | { kind: 'group'; index: number } | null = null;

		const root = el('div', 'og-sb-stack');
		container.appendChild(root);
		const search = searchField('Find a column…', (q) => {
			query = q;
			renderColumns();
		});
		const groups = el('div', 'og-sb-groups');
		const toolbar = el('div', 'og-sb-toolbar');
		const lists = el('div', 'og-sb-lanes');
		root.append(groups, search.element, toolbar, lists);

		const columns = () => api.getColumns().filter((c) => !isHierarchyColumn(c) && !c.field.startsWith('__'));
		const labelOf = (c: ColumnDef<any>) => c.header || c.field;
		const groupBy = () => api.getGroupBy();
		const canGroup = (c: ColumnDef<any>) => c.enableRowGroup !== false && api.can('group', { colField: c.field }).allowed;
		const canPin = (field: string) => api.can('pin', { colField: field }).allowed;
		const laneOf = (field: string): Lane | null => {
			const shown = api.getDisplayedColumns();
			const index = shown.findIndex((c) => c.field === field);
			if (index < 0) return null;
			const { left, right } = api.getPinnedColumns();
			if (index < left) return 'left';
			if (index >= Math.max(left, shown.length - right)) return 'right';
			return 'center';
		};

		const pin = (field: string, to: Lane) => {
			if (!canPin(field)) return;
			const from = laneOf(field);
			if (from === null || from === to) return;
			const shown = api.getDisplayedColumns();
			const { left, right } = api.getPinnedColumns();
			// Out of its lane to the scrolling middle first, then into the target lane.
			let l = left;
			let r = right;
			if (from === 'left') {
				api.moveColumn(field, left);
				l = left - 1;
			} else if (from === 'right') {
				api.moveColumn(field, Math.max(left, shown.length - right));
				r = right - 1;
			}
			if (to === 'left') {
				api.moveColumn(field, l);
				l += 1;
			} else if (to === 'right') {
				api.moveColumn(field, Math.max(l, shown.length - r - 1));
				r += 1;
			}
			api.setPinnedColumns({ left: l, right: r });
		};

		const openPinMenu = (anchor: HTMLElement, field: string) => {
			menu?.close();
			const lane = laneOf(field);
			const list = el('div', 'og-sb-menu');
			list.setAttribute('role', 'menu');
			const item = (label: string, iconName: SidebarIconName, to: Lane) => {
				const b = el('button', 'og-sb-menu-item');
				b.type = 'button';
				b.setAttribute('role', 'menuitemradio');
				b.setAttribute('aria-checked', String(lane === to));
				b.append(icon(iconName, 14), el('span', undefined, label));
				if (lane === to) b.appendChild(icon('check', 14)).classList.add('og-sb-menu-check');
				b.addEventListener('click', () => {
					menu?.close();
					pin(field, to);
				});
				list.appendChild(b);
			};
			item('Pin left', 'pin', 'left');
			item('No pin', 'columns', 'center');
			item('Pin right', 'pin', 'right');
			menu = openCellPopover({ anchor, content: list, label: 'Pin column', onDismiss: () => (menu = null) });
			list.querySelector<HTMLElement>('button')?.focus();
		};

		const renderGroups = () => {
			const by = groupBy();
			const grouping = api.getStateSnapshot().grouping;
			groups.textContent = '';
			const head = el('div', 'og-sb-groups-head');
			head.append(icon('layers', 14), el('span', 'og-sb-groups-title', 'Row groups'));
			if (by.length > 0) {
				const tools = el('div', 'og-sb-groups-tools');
				tools.append(
					iconButton('expandAll', 'Expand all groups', () => api.expandAll(), 14),
					iconButton('collapseAll', 'Collapse all groups', () => api.collapseAll(), 14),
					iconButton('x', 'Ungroup', () => api.setGroupBy([]), 14)
				);
				head.appendChild(tools);
			}
			const zone = el('div', 'og-sb-dropzone');
			zone.toggleAttribute('data-empty', by.length === 0);
			if (by.length === 0) zone.appendChild(el('span', 'og-sb-dropzone-hint', 'Drag a column here, or use its group button, to group rows'));
			by.forEach((field, index) => {
				const column = columns().find((c) => c.field === field);
				const pill = el('div', 'og-sb-pill');
				pill.draggable = true;
				if (index > 0) zone.appendChild(el('span', 'og-sb-pill-sep', '›'));
				pill.append(el('span', 'og-sb-pill-label', column ? labelOf(column) : field));
				pill.appendChild(iconButton('x', `Stop grouping by ${column ? labelOf(column) : field}`, () => api.setGroupBy(by.filter((f) => f !== field)), 12));
				pill.addEventListener('dragstart', (event) => {
					drag = { kind: 'group', index };
					event.dataTransfer?.setData('text/plain', field);
				});
				pill.addEventListener('dragend', () => (drag = null));
				pill.addEventListener('dragover', (event) => {
					if (drag?.kind === 'group') event.preventDefault();
				});
				pill.addEventListener('drop', (event) => {
					if (drag?.kind !== 'group' || drag.index === index) return;
					event.preventDefault();
					event.stopPropagation();
					const next = [...by];
					const [moved] = next.splice(drag.index, 1);
					next.splice(index, 0, moved);
					api.setGroupBy(next);
				});
				zone.appendChild(pill);
			});
			zone.addEventListener('dragover', (event) => {
				if (drag?.kind !== 'column') return;
				const column = columns().find((c) => c.field === (drag as { field: string }).field);
				if (!column || !canGroup(column) || by.includes(column.field)) return;
				event.preventDefault();
				zone.setAttribute('data-over', '');
			});
			zone.addEventListener('dragleave', () => zone.removeAttribute('data-over'));
			zone.addEventListener('drop', (event) => {
				zone.removeAttribute('data-over');
				if (drag?.kind !== 'column' || by.includes(drag.field)) return;
				event.preventDefault();
				api.setGroupBy([...by, drag.field]);
			});
			groups.append(head, zone);
			if (by.length > 0) {
				const options = el('div', 'og-sb-group-options');
				options.append(
					switchRow('Subtotal rows', !!grouping?.totals?.groups, (on) => api.updateGrouping({ totals: { ...grouping?.totals, groups: on ? 'bottom' : false } })),
					switchRow('Sticky group headers', !!grouping?.stickyHeaders, (on) => api.updateGrouping({ stickyHeaders: on }))
				);
				groups.appendChild(options);
			}
		};

		const renderColumns = () => {
			const all = columns();
			const hiddenCount = all.filter((c) => c.hide).length;
			toolbar.textContent = '';
			const seg = el('div', 'og-sb-seg og-sb-seg-sm');
			seg.setAttribute('role', 'radiogroup');
			seg.setAttribute('aria-label', 'Show');
			for (const [value, label] of [
				['all', `All ${all.length}`],
				['visible', `Shown ${all.length - hiddenCount}`],
				['hidden', `Hidden ${hiddenCount}`],
			] as const) {
				const b = el('button', 'og-sb-seg-btn', label);
				b.type = 'button';
				b.setAttribute('role', 'radio');
				b.setAttribute('aria-checked', String(view === value));
				b.addEventListener('click', () => {
					view = value;
					renderColumns();
				});
				seg.appendChild(b);
			}
			toolbar.appendChild(seg);
			if (hiddenCount > 0) toolbar.appendChild(textButton('Show all', () => api.setColumnsVisible(all.map((c) => c.field), true)));

			lists.textContent = '';
			const shown = all.filter((c) => {
				if (view === 'visible' && c.hide) return false;
				if (view === 'hidden' && !c.hide) return false;
				return !query || `${c.header ?? ''} ${c.field}`.toLowerCase().includes(query);
			});
			if (shown.length === 0) {
				lists.appendChild(
					query ? emptyState('search', 'No columns match', `Nothing is called “${query}”.`) : emptyState('eyeOff', 'Nothing here', view === 'hidden' ? 'Every column is shown.' : 'Every column is hidden.')
				);
				return;
			}
			const by = groupBy();
			const lanes: Record<Lane, ColumnDef<any>[]> = { left: [], center: [], right: [] };
			// Display order for shown columns; hidden ones keep their place in the column order.
			const order = new Map(api.getDisplayedColumns().map((c, i) => [c.field, i]));
			const sorted = [...shown].sort((a, b) => (order.get(a.field) ?? Infinity) - (order.get(b.field) ?? Infinity));
			for (const column of sorted) lanes[laneOf(column.field) ?? 'center'].push(column);
			const showTitles = lanes.left.length > 0 || lanes.right.length > 0;
			for (const lane of ['left', 'center', 'right'] as const) {
				if (lanes[lane].length === 0) continue;
				const section = el('div', 'og-sb-lane');
				if (showTitles) {
					const title = el('div', 'og-sb-lane-title');
					if (lane !== 'center') title.appendChild(icon('pin', 12));
					title.appendChild(el('span', undefined, LANE_TITLES[lane]));
					section.appendChild(title);
				}
				const list = el('div', 'og-sb-col-list');
				list.setAttribute('role', 'list');
				for (const column of lanes[lane]) list.appendChild(row(column, lane, by.includes(column.field)));
				section.appendChild(list);
				lists.appendChild(section);
			}
		};

		const row = (column: ColumnDef<any>, lane: Lane, grouped: boolean) => {
			const label = labelOf(column);
			const item = el('div', 'og-sb-col');
			item.setAttribute('role', 'listitem');
			item.toggleAttribute('data-hidden', !!column.hide);
			const reorderable = !query && view === 'all';
			const grip = el('span', 'og-sb-col-grip');
			grip.appendChild(icon('grip', 14));
			item.draggable = true;
			const box = checkbox(`Show ${label}`, !column.hide, () => api.setColumnVisible(column.field, !!column.hide));
			const name = el('span', 'og-sb-col-name', label);
			name.title = label;
			const tools = el('div', 'og-sb-col-tools');
			if (canGroup(column)) {
				const groupButton = iconButton(
					'layers',
					grouped ? `Stop grouping by ${label}` : `Group by ${label}`,
					() => api.setGroupBy(grouped ? groupBy().filter((f) => f !== column.field) : [...groupBy(), column.field]),
					14
				);
				groupButton.toggleAttribute('data-on', grouped);
				tools.appendChild(groupButton);
			}
			if (!column.hide && canPin(column.field)) {
				const pinButton = iconButton('pin', `Pin ${label}`, () => openPinMenu(pinButton, column.field), 14);
				pinButton.toggleAttribute('data-on', lane !== 'center');
				tools.appendChild(pinButton);
			}
			item.append(grip, box, name, tools);
			if (!reorderable) grip.setAttribute('data-disabled', '');

			item.addEventListener('dragstart', (event) => {
				drag = { kind: 'column', field: column.field, lane };
				item.setAttribute('data-dragging', '');
				event.dataTransfer?.setData('text/plain', column.field);
				if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			});
			item.addEventListener('dragend', () => {
				drag = null;
				item.removeAttribute('data-dragging');
				lists.querySelectorAll('[data-drop]').forEach((node) => node.removeAttribute('data-drop'));
			});
			item.addEventListener('dragover', (event) => {
				// Reorder within a lane; pinning goes through the pin menu.
				if (!reorderable || drag?.kind !== 'column' || drag.lane !== lane || drag.field === column.field) return;
				event.preventDefault();
				lists.querySelectorAll('[data-drop]').forEach((node) => node.removeAttribute('data-drop'));
				const rect = item.getBoundingClientRect();
				item.setAttribute('data-drop', event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
			});
			item.addEventListener('drop', (event) => {
				if (drag?.kind !== 'column' || drag.lane !== lane || drag.field === column.field) return;
				event.preventDefault();
				const after = item.getAttribute('data-drop') === 'after';
				const fields = columns().map((c) => c.field);
				const from = fields.indexOf(drag.field);
				fields.splice(from, 1);
				const target = fields.indexOf(column.field) + (after ? 1 : 0);
				fields.splice(target, 0, drag.field);
				api.setColumnOrder(fields);
			});
			return item;
		};

		const render = () => {
			renderGroups();
			renderColumns();
		};
		render();
		d.add(api.subscribeToKey('columns', render));
		d.add(api.subscribeToKey('grouping', render));
		d.add(api.subscribeToKey('pinnedColumns', render));
		return {
			destroy() {
				menu?.close();
				d.dispose();
			},
		};
	},
};
