// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridApi } from '../api/GridApi.js';
import { createClientGrid } from '../createGrid.js';
import { GridSidebar } from './gridSidebar.js';
import type { GridSidebarConfig } from './sidebarTypes.js';

interface Row {
	id: string;
	name: string;
	age: number;
}

function setup(config: GridSidebarConfig<Row>, mountPanel = vi.fn(() => () => {}), wrap?: (api: GridApi<Row>) => GridApi<Row>) {
	const api = createClientGrid<Row>({
		rows: [
			{ id: '1', name: 'Ava', age: 31 },
			{ id: '2', name: 'Liam', age: 24 },
		],
		columns: [
			{ field: 'name', header: 'Name' },
			{ field: 'age', header: 'Age', filterDef: { type: 'number' } },
		],
	});
	const sidebar = new GridSidebar(wrap ? wrap(api) : api, config, { mountFilterEditor: () => null, mountPanel });
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
