// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridApi } from '../api/GridApi.js';
import type { ColumnFilter } from '../filterModel.js';
import { createClientGrid } from '../createGrid.js';
import { GridSidebar } from './gridSidebar.js';
import type { GridSidebarConfig } from './sidebarTypes.js';

interface Row {
	id: string;
	name: string;
	age: number;
}

/** The last draft editor's change callback (query conditions). */
let draftChange: ((filter: ColumnFilter | null) => void) | null = null;

function setup(
	config: GridSidebarConfig<Row>,
	mountPanel = vi.fn(() => () => {}),
	wrap?: (api: GridApi<Row>) => GridApi<Row>,
	gridOptions: Partial<Parameters<typeof createClientGrid<Row>>[0]> = {}
) {
	const api = createClientGrid<Row>({
		...gridOptions,
		rows: [
			{ id: '1', name: 'Ava', age: 31 },
			{ id: '2', name: 'Liam', age: 24 },
		],
		columns: [
			{ field: 'name', header: 'Name' },
			{ field: 'age', header: 'Age', filterDef: { type: 'number' } },
		],
	});
	const sidebar = new GridSidebar(wrap ? wrap(api) : api, config, {
		mountFilterEditor: () => null,
		mountDraftEditor: (_container, _field, _surface, _filter, onChange) => {
			draftChange = onChange;
			return {};
		},
		mountPanel,
	});
	document.body.appendChild(sidebar.element);
	const tab = (id: string) => sidebar.element.querySelector<HTMLButtonElement>(`.og-sb-tab[data-panel="${id}"]`)!;
	const body = () => sidebar.element.querySelector('.og-sb-body')!;
	const byText = (text: string) =>
		[...sidebar.element.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === text)!;
	return { api, sidebar, tab, body, byText, mountPanel };
}

afterEach(() => {
	document.body.textContent = '';
});

describe('GridSidebar', () => {
	it('a rail button per panel opens and closes it, with the title and selection in step', () => {
		const { api, sidebar, tab } = setup({ panels: ['filters', 'sort', 'themes'] });
		expect([...sidebar.element.querySelectorAll('.og-sb-tab')].map((t) => t.getAttribute('aria-label'))).toEqual(['Filters', 'Sort', 'Themes']);
		tab('sort').click();
		expect(api.getOpenPanel()).toBe('sort');
		expect(sidebar.element.hasAttribute('data-open')).toBe(true);
		expect(sidebar.element.querySelector('.og-sb-title')!.textContent).toBe('Sort');
		expect(tab('sort').getAttribute('aria-selected')).toBe('true');
		tab('sort').click();
		expect(api.getOpenPanel()).toBeNull();
		expect(sidebar.element.hasAttribute('data-open')).toBe(false);
	});

	it('opens `defaultOpen`, shows counts on the rail, and Escape closes', () => {
		const { api, sidebar, tab } = setup({ panels: ['filters', 'sort'], defaultOpen: 'filters' });
		expect(api.getOpenPanel()).toBe('filters');
		api.setSortModel([
			{ colId: 'name', sort: 'asc' },
			{ colId: 'age', sort: 'desc' },
		]);
		expect(tab('sort').querySelector('.og-sb-badge')!.textContent).toBe('2');
		expect(tab('filters').hasAttribute('data-badged')).toBe(false);
		sidebar.element.querySelector('.og-sb-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(api.getOpenPanel()).toBeNull();
	});

	it('adapter panels mount through the host bridge and unmount when another opens', () => {
		const unmount = vi.fn();
		const mountPanel = vi.fn(() => unmount);
		const renderPanel = vi.fn();
		const { tab } = setup({ panels: [{ id: 'notes', label: 'Notes', renderPanel }, 'sort'] }, mountPanel);
		tab('notes').click();
		expect(mountPanel).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Function), expect.objectContaining({ close: expect.any(Function) }));
		tab('sort').click();
		expect(unmount).toHaveBeenCalled();
	});

	it('a new render for the open adapter panel updates it in place (same host, no unmount)', () => {
		const unmount = vi.fn();
		const mountPanel = vi.fn(() => unmount);
		const { sidebar, tab } = setup({ panels: [{ id: 'log', label: 'Log', renderPanel: () => 'v1' }] }, mountPanel);
		tab('log').click();
		const host = (mountPanel.mock.calls[0] as unknown[])[0];
		const next = () => 'v2';
		sidebar.setConfig({ panels: [{ id: 'log', label: 'Log', renderPanel: next }] });
		expect(mountPanel).toHaveBeenLastCalledWith(host, next, expect.anything());
		expect(unmount).not.toHaveBeenCalled();
	});

	it('sort: add from the column list, flip direction, reorder with the keyboard, remove', () => {
		const { api, tab, body, byText } = setup({ panels: ['sort'] });
		tab('sort').click();
		expect(body().textContent).toContain('No sorting');
		byText('Add a sort').click();
		const option = [...document.querySelectorAll<HTMLElement>('.og-ct-option')].find((o) => o.textContent?.includes('Age'))!;
		option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		option.click();
		expect(api.getStateSnapshot().sortModel).toEqual([{ colId: 'age', sort: 'asc' }]);
		// Number columns read 1 → 9.
		byText('9 → 1').click();
		expect(api.getStateSnapshot().sortModel).toEqual([{ colId: 'age', sort: 'desc' }]);
		api.setSortModel([
			{ colId: 'age', sort: 'desc' },
			{ colId: 'name', sort: 'asc' },
		]);
		body().querySelectorAll<HTMLElement>('.og-sb-grip')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(api.getStateSnapshot().sortModel).toEqual([
			{ colId: 'name', sort: 'asc' },
			{ colId: 'age', sort: 'desc' },
		]);
		body().querySelector<HTMLElement>('[aria-label="Remove Name sort"]')!.click();
		expect(api.getStateSnapshot().sortModel).toEqual([{ colId: 'age', sort: 'desc' }]);
	});

	it('columns: hide, group from a row or the pills, pin from the menu, reorder within a lane', () => {
		const { api, tab, body } = setup({ panels: ['columns'] });
		tab('columns').click();
		const rowOf = (name: string) =>
			[...body().querySelectorAll<HTMLElement>('.og-sb-col')].find((r) => r.querySelector('.og-sb-col-name')!.textContent === name)!;
		rowOf('Age').querySelector<HTMLElement>('.og-sb-checkbox')!.click();
		expect(api.getColumns().find((c) => c.field === 'age')!.hide).toBe(true);
		rowOf('Age').querySelector<HTMLElement>('.og-sb-checkbox')!.click();
		expect(api.getColumns().find((c) => c.field === 'age')!.hide).toBeFalsy();

		rowOf('Name').querySelector<HTMLElement>('[aria-label="Group by Name"]')!.click();
		expect(api.getGroupBy()).toEqual(['name']);
		expect(body().querySelector('.og-sb-pill-label')!.textContent).toBe('Name');
		body().querySelector<HTMLElement>('.og-sb-pill [aria-label="Stop grouping by Name"]')!.click();
		expect(api.getGroupBy()).toEqual([]);

		rowOf('Age').querySelector<HTMLElement>('[aria-label="Pin Age"]')!.click();
		[...document.querySelectorAll<HTMLElement>('.og-sb-menu-item')].find((b) => b.textContent?.includes('Pin left'))!.click();
		expect(api.getPinnedColumns().left).toBe(1);
		expect(api.getDisplayedColumns()[0].field).toBe('age');
		expect(body().querySelector('.og-sb-lane-title')!.textContent).toBe('Pinned left');

		rowOf('Age').querySelector<HTMLElement>('[aria-label="Pin Age"]')!.click();
		[...document.querySelectorAll<HTMLElement>('.og-sb-menu-item')].find((b) => b.textContent?.includes('No pin'))!.click();
		expect(api.getPinnedColumns().left).toBe(0);

		// Drag Name below Age (both in the scrolling lane).
		const drag = (type: string, target: HTMLElement) => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientY: 1000 }));
		drag('dragstart', rowOf('Name'));
		drag('dragover', rowOf('Age'));
		drag('drop', rowOf('Age'));
		expect(api.getDisplayedColumns().map((c) => c.field)).toEqual(['age', 'name']);
	});

	it('query: a draft of conditions in All / Any groups, applied with Apply', () => {
		const { api, tab, body, byText } = setup({ panels: ['query'] });
		tab('query').click();
		byText('Add a condition').click();
		expect(body().querySelector('.og-sb-select')!.textContent).toBe('Name');
		draftChange!({ type: 'text', operator: 'contains', value: 'Av' });
		expect(api.getStateSnapshot().queryModel ?? null).toBeNull();
		expect(body().querySelector('.og-sb-footer-status')!.textContent).toBe('1 condition · not applied');
		byText('Group').click();
		draftChange!({ type: 'text', operator: 'equals', value: 'Liam' });
		byText('Any').click();
		byText('Apply').click();
		const root = api.getStateSnapshot().queryModel!.root;
		expect(root.operator).toBe('or');
		expect(root.children[0]).toMatchObject({ kind: 'condition', columnId: 'name', filter: { value: 'Av' } });
		expect(root.children[1]).toMatchObject({ kind: 'group', children: [{ kind: 'condition', filter: { value: 'Liam' } }] });
		expect(api.rows().getAll().map((r) => r.name)).toEqual(['Ava', 'Liam']);
		// A query set elsewhere shows in the panel.
		api.setQueryModel(null);
		expect(body().textContent).toContain('No query yet');
	});

	it('data integrity: status, issues by severity (click goes to the cell), and an empty diff', () => {
		const { api, tab, body, byText } = setup({ panels: ['dataIntegrity'] }, undefined, undefined, { dataIntegrity: { validation: true } });
		tab('dataIntegrity').click();
		expect(body().querySelector('.og-sb-health-label')!.textContent).toBe('All clear');
		const issue = (id: string, severity: 'error' | 'warning', blocking = false) => ({
			id,
			source: 'validation' as const,
			type: 'invalidValue' as const,
			severity,
			blocking,
			rowId: '2',
			colField: 'age',
			message: `${id} message`,
			createdAt: 1,
		});
		api.integrity.publishIssues('validation', [issue('a', 'error', true), issue('b', 'warning')]);
		expect(body().querySelector('.og-sb-health')!.getAttribute('data-status')).toBe('blocked');
		expect(body().querySelectorAll('.og-sb-issue')).toHaveLength(2);
		byText('Warnings 1').click();
		expect([...body().querySelectorAll('.og-sb-issue-message')].map((m) => m.textContent)).toEqual(['b message']);
		body().querySelector<HTMLElement>('.og-sb-issue')!.click();
		expect(api.getStateSnapshot().selection?.ranges?.[0] ?? api.getStateSnapshot().selection).toBeTruthy();
		[...body().querySelectorAll<HTMLElement>('.og-sb-tabs-btn')].find((t) => t.textContent?.startsWith('Changes'))!.click();
		expect(body().textContent).toContain('No comparison');
	});

	it('themes: a card per theme; picking one switches the grid', () => {
		const switchTheme = vi.fn();
		// The api is frozen: spy on a child of it.
		const spy = (api: GridApi<Row>): GridApi<Row> => Object.create(api, { switchTheme: { value: switchTheme } });
		const { api, tab, body } = setup({ panels: ['themes'] }, undefined, spy);
		tab('themes').click();
		const cards = body().querySelectorAll<HTMLElement>('.og-sb-theme');
		expect(cards.length).toBe(api.getAvailableThemes().length);
		cards[1].click();
		expect(switchTheme).toHaveBeenCalledWith(api.getAvailableThemes()[1]);
	});
});
