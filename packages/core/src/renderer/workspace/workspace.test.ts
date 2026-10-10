// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientGrid } from '../../createGrid.js';
import { mountGridHost } from '../../gridHost.js';
import { dateRangeColumnType, personColumnType, progressColumnType, selectColumnType, currencyColumnType } from '../../cells/cellTypes.js';
import type { ColumnDef } from '../../columnDef.js';
import type { GridViewConfig, GridWorkspaceOptions } from '../../views.js';
import { fuzzyScore } from './commandPalette.js';
import { packWeek } from './views/calendarView.js';

interface Task {
	id: string;
	title: string;
	status: string;
	team: string;
	owner: string;
	plan: { start: string; end: string } | null;
	progress: number;
	budget: number;
	deps: string[];
	parent: string | null;
}

const STATUS = [
	{ value: 'todo', label: 'To do', color: 'blue' },
	{ value: 'doing', label: 'Doing', color: 'amber' },
	{ value: 'done', label: 'Done', color: 'green' },
];

const columns: ColumnDef<Task>[] = [
	{ field: 'title', header: 'Title' },
	{ field: 'status', header: 'Status', ...selectColumnType(STATUS) },
	{ field: 'team', header: 'Team', ...selectColumnType(['FE', 'BE']) },
	{ field: 'owner', header: 'Owner', ...personColumnType({ people: [{ value: 'ava', label: 'Ava' }] }) },
	{ field: 'plan', header: 'Plan', ...dateRangeColumnType() },
	{ field: 'progress', header: 'Progress', ...progressColumnType() },
	{ field: 'budget', header: 'Budget', ...currencyColumnType() },
	{ field: 'deps', header: 'Depends on' },
	{ field: 'parent', header: 'Parent' },
];

const task = (id: string, status: string, plan: [string, string] | null, extra: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
	status,
	team: 'FE',
	owner: 'ava',
	plan: plan ? { start: plan[0], end: plan[1] } : null,
	progress: 0,
	budget: 100,
	deps: [],
	parent: null,
	...extra,
});

function rows(): Task[] {
	return [
		task('p', 'doing', null, { title: 'Project' }),
		task('a', 'todo', ['2026-10-05', '2026-10-09'], { parent: 'p' }),
		task('b', 'todo', ['2026-10-12', '2026-10-16'], { parent: 'p', deps: ['a'], team: 'BE' }),
		task('c', 'done', ['2026-10-19', '2026-10-21'], { parent: 'p', deps: ['b'] }),
		task('d', 'doing', ['2026-10-01', '2026-10-02'], { budget: 250 }),
	];
}

// The first test pays the cold transform of the whole workspace module graph (lazy imports), which
// under a full parallel run can exceed the default 5s.
vi.setConfig({ testTimeout: 20_000 });

/** Waits that cover a lazy import (the workspace, a view module): a cold module graph under a full run is slow. */
const LOAD = { timeout: 8000 };

// Frames run when the test flushes them (a synchronous stub would starve re-scheduled frames).
let frames: FrameRequestCallback[] = [];
const flushFrames = (rounds = 4) => {
	for (let i = 0; i < rounds; i++) {
		const queue = frames;
		frames = [];
		for (const callback of queue) callback(0);
	}
};

class TestResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	frames = [];
	vi.stubGlobal('ResizeObserver', TestResizeObserver);
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function mount(options: GridWorkspaceOptions<Task> | null = {}, extra: { createRecord?: boolean } = {}) {
	const api = createClientGrid<Task>({ rows: rows(), columns, getRowId: (row) => row.id, rowSelection: { mode: 'multiple' } });
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 1200,
		bottom: 800,
		width: 1200,
		height: 800,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	const workspace =
		options === null
			? undefined
			: {
					records: { title: 'title', dependencies: 'deps', parent: 'parent', schedule: 'plan' },
					...(extra.createRecord
						? {
								createRecord: (values: Record<string, unknown>) => ({
									...task(`n${Math.random().toString(36).slice(2, 6)}`, 'todo', null),
									...values,
								}),
							}
						: {}),
					...options,
				};
	const host = mountGridHost(api, container, workspace ? { workspace } : {});
	const ws = () => container.querySelector<HTMLElement>('.og-ws');
	await vi.waitFor(() => expect(ws()).not.toBeNull(), LOAD);
	flushFrames();
	return { api, container, host, ws: () => ws()! };
}

async function showView(env: Awaited<ReturnType<typeof mount>>, view: GridViewConfig<Task>) {
	env.api.setView(view);
	await vi.waitFor(() => expect(env.container.querySelector(`.og-ws-view-${view.kind}`)).not.toBeNull(), LOAD);
	flushFrames();
}

const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
const key = (el: Element, keyName: string, init: KeyboardEventInit = {}) =>
	el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init }));

describe('workspace host', () => {
	it('loads no workspace code for a table-only grid until a view is asked for', async () => {
		const api = createClientGrid<Task>({ rows: rows(), columns, getRowId: (row) => row.id });
		const container = document.createElement('div');
		document.body.appendChild(container);
		const host = mountGridHost(api, container);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(container.querySelector('.og-ws')).toBeNull();
		api.setView({ kind: 'kanban' });
		await vi.waitFor(() => expect(container.querySelector('.og-ws-view-kanban')).not.toBeNull(), LOAD);
		api.setView(null);
		await vi.waitFor(() => expect(container.querySelector<HTMLElement>('.og-layer-view')?.hidden).toBe(true));
		host.destroy();
	});

	it('offers the views the records support, and switches with the tabs', async () => {
		const env = await mount();
		const tabs = [...env.ws().querySelectorAll<HTMLElement>('.og-ws-tab')].map((tab) => tab.textContent);
		expect(tabs).toEqual(['Table', 'Gallery', 'Calendar', 'Kanban', 'Gantt']);
		click(env.ws().querySelectorAll('.og-ws-tab')[3]);
		await vi.waitFor(() => expect(env.api.getView()?.kind).toBe('kanban'));
		await vi.waitFor(() => expect(env.container.querySelector('.og-ws-board')).not.toBeNull(), LOAD);
		expect(env.ws().dataset.kind).toBe('kanban');
		env.host.destroy();
	});

	it('keeps selection and the inspected record across view switches', async () => {
		const env = await mount();
		await showView(env, { kind: 'kanban' });
		const card = env.container.querySelector<HTMLElement>('[data-record-id="b"]')!;
		click(card);
		expect(env.api.getSelectedRowIds()).toEqual(['b']);
		const inspector = env.container.querySelector<HTMLElement>('.og-ws-inspector')!;
		expect(inspector.hidden).toBe(false);
		expect(inspector.querySelector('.og-ws-inspector-title')?.textContent).toBe('Task b');
		await showView(env, { kind: 'gantt' });
		expect(env.api.getSelectedRowIds()).toEqual(['b']);
		expect(inspector.hidden).toBe(false);
		expect(inspector.querySelector('.og-ws-inspector-title')?.textContent).toBe('Task b');
		// The schedule adds its own inspector tabs.
		expect([...inspector.querySelectorAll('.og-ws-inspector-tab')].map((tab) => tab.textContent)).toEqual(
			expect.arrayContaining(['Activity', 'Schedule', 'Dependencies2', 'Resources'])
		);
		env.host.destroy();
	});

	it('ctrl/shift click extend the selection in the view’s order', async () => {
		const env = await mount();
		await showView(env, { kind: 'gantt' });
		const row = (id: string) => env.container.querySelector<HTMLElement>(`.og-ws-gantt-row[data-record-id="${id}"]`)!;
		click(row('a'));
		click(row('c'), { shiftKey: true });
		expect(env.api.getSelectedRowIds().sort()).toEqual(['a', 'b', 'c']);
		click(row('b'), { ctrlKey: true });
		expect(env.api.getSelectedRowIds().sort()).toEqual(['a', 'c']);
		env.host.destroy();
	});

	it('records edits made anywhere as the record’s activity', async () => {
		const env = await mount();
		await showView(env, { kind: 'kanban' });
		env.api.transaction({ cells: [{ rowId: 'a', colField: 'status', value: 'doing' }] });
		flushFrames();
		click(env.container.querySelector('[data-record-id="a"]')!);
		const activityTab = [...env.container.querySelectorAll<HTMLElement>('.og-ws-inspector-tab')].find((tab) => tab.textContent === 'Activity')!;
		click(activityTab);
		expect(env.container.querySelector('.og-ws-timeline')?.textContent).toMatch(/changed Status from To do to Doing/);
		env.host.destroy();
	});
});

describe('kanban', () => {
	it('lays out every status option as a column, with totals and swimlanes', async () => {
		const env = await mount();
		await showView(env, { kind: 'kanban', swimlaneField: 'team' });
		const heads = [...env.container.querySelectorAll<HTMLElement>('.og-ws-col-head')].map((head) => head.dataset.column);
		expect(heads).toEqual(['todo', 'doing', 'done']);
		expect(env.container.querySelectorAll('.og-ws-lane-head')).toHaveLength(2);
		expect(env.container.querySelector('.og-ws-col-head[data-column="doing"] .og-ws-col-total')?.textContent).toMatch(/350/);
		env.host.destroy();
	});

	it('moves cards with Alt+arrows as one undoable write', async () => {
		const env = await mount();
		await showView(env, { kind: 'kanban' });
		const card = env.container.querySelector<HTMLElement>('[data-record-id="a"]')!;
		click(card);
		key(card, 'ArrowRight', { altKey: true });
		expect(env.api.getCellValue('a', 'status')).toBe('doing');
		env.api.undo();
		expect(env.api.getCellValue('a', 'status')).toBe('todo');
		env.host.destroy();
	});

	it('refuses a move past a hard WIP limit and says why', async () => {
		const env = await mount();
		await showView(env, { kind: 'kanban', wipLimits: { doing: 2 }, wipPolicy: 'block' });
		const card = env.container.querySelector<HTMLElement>('[data-record-id="a"]')!;
		click(card);
		key(card, 'ArrowRight', { altKey: true });
		expect(env.api.getCellValue('a', 'status')).toBe('todo');
		expect(env.container.querySelector('.og-ws-toast')?.textContent).toMatch(/limited to 2/);
		env.host.destroy();
	});

	it('moves the whole selection together', async () => {
		const env = await mount();
		await showView(env, { kind: 'kanban' });
		env.api.selectRows(['a', 'b'], { mode: 'replace' });
		const card = env.container.querySelector<HTMLElement>('[data-record-id="a"]')!;
		key(card, 'ArrowRight', { altKey: true });
		expect([env.api.getCellValue('a', 'status'), env.api.getCellValue('b', 'status')]).toEqual(['doing', 'doing']);
		env.api.undo();
		expect([env.api.getCellValue('a', 'status'), env.api.getCellValue('b', 'status')]).toEqual(['todo', 'todo']);
		env.host.destroy();
	});
});

describe('gantt', () => {
	it('draws one outline with WBS numbers, summary rollups and dependency links', async () => {
		const env = await mount();
		await showView(env, { kind: 'gantt' });
		const outline = [...env.container.querySelectorAll<HTMLElement>('.og-ws-gantt-row')]
			.sort((x, y) => parseFloat(x.style.transform.slice(11)) - parseFloat(y.style.transform.slice(11)))
			.map((row) => row.querySelector('.og-ws-gantt-c-wbs')?.textContent + ' ' + row.dataset.recordId);
		expect(outline).toEqual(['1 p', '1.1 a', '1.2 b', '1.3 c', '2 d']);
		expect(env.container.querySelector('.og-ws-gantt-bar[data-record-id="p"]')?.classList.contains('og-ws-gantt-summary')).toBe(true);
		expect(env.container.querySelectorAll('path.og-ws-gantt-link')).toHaveLength(2);
		env.host.destroy();
	});

	it('previews the knock-on of a move and writes it as one undo step', async () => {
		const env = await mount();
		await showView(env, { kind: 'gantt' });
		const row = env.container.querySelector<HTMLElement>('.og-ws-gantt-row[data-record-id="a"]')!;
		click(row);
		// Alt+→ moves a task a working day later; b and c have to follow.
		for (let i = 0; i < 3; i++) {
			key(row, 'ArrowRight', { altKey: true });
			const dialog = await vi.waitFor(() => {
				const found = env.container.querySelector<HTMLElement>('.og-ws-dialog');
				if (i < 2 && !found) return null;
				return found;
			});
			if (dialog) {
				expect(dialog.textContent).toMatch(/Reschedule 3 tasks/);
				click([...dialog.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Reschedule'))!);
				break;
			}
			flushFrames();
		}
		await vi.waitFor(() => expect((env.api.getCellValue('c', 'plan') as { start: string }).start).not.toBe('2026-10-19'));
		env.api.undo();
		expect(env.api.getCellValue('a', 'plan')).toEqual({ start: '2026-10-05', end: '2026-10-09' });
		expect(env.api.getCellValue('c', 'plan')).toEqual({ start: '2026-10-19', end: '2026-10-21' });
		env.host.destroy();
	});
});

describe('gallery', () => {
	it('groups cards into sections and adds records in place', async () => {
		const env = await mount({}, { createRecord: true });
		await showView(env, { kind: 'gallery' });
		const sections = [...env.container.querySelectorAll<HTMLElement>('.og-ws-gallery-section')].map((section) => section.dataset.section);
		expect(sections).toEqual(['todo', 'doing', 'done']);
		const add = env.container.querySelector<HTMLElement>('.og-ws-gallery-add[data-add="done"]')!;
		click(add);
		await vi.waitFor(() => expect(env.api.getDisplayedColumns().length).toBeGreaterThan(0));
		await vi.waitFor(() => expect(env.api.rows().count?.() ?? env.api.getRowOrder().length).toBe(6));
		const added = env.api.getRowOrder().find((id) => !['p', 'a', 'b', 'c', 'd'].includes(id))!;
		expect(env.api.getCellValue(added, 'status')).toBe('done');
		env.host.destroy();
	});
});

describe('calendar', () => {
	it('packs a week’s entries into lanes so multi-day bars stay on one line', () => {
		const row = (id: string) => ({ id, data: {} });
		const placed = packWeek(
			[
				{ row: row('long'), span: { start: 0, end: 4 } },
				{ row: row('a'), span: { start: 1, end: 1 } },
				{ row: row('b'), span: { start: 5, end: 6 } },
				{ row: row('spill'), span: { start: -3, end: 2 } },
			],
			0
		);
		const lane = Object.fromEntries(placed.map((item) => [item.row.id, [item.lane, item.from, item.to]]));
		expect(lane.spill).toEqual([0, 0, 2]);
		expect(lane.long).toEqual([1, 0, 4]);
		expect(lane.a).toEqual([2, 1, 1]);
		expect(lane.b).toEqual([0, 5, 6]);
	});
});

describe('command palette', () => {
	it('ranks word starts and runs above scattered matches', () => {
		expect(fuzzyScore('sk', 'Switch to Kanban')).toBeGreaterThan(fuzzyScore('sk', 'Ask questions'));
		expect(fuzzyScore('gantt', 'Switch to Gantt')).toBeGreaterThan(0);
		expect(fuzzyScore('zz', 'Switch to Gantt')).toBe(-1);
	});

	it('opens with Ctrl+K and runs the chosen command', async () => {
		const env = await mount();
		key(env.ws(), 'k', { ctrlKey: true });
		const input = env.container.querySelector<HTMLInputElement>('.og-ws-palette-input')!;
		expect(input).not.toBeNull();
		input.value = 'switch kanban';
		input.dispatchEvent(new Event('input'));
		key(input, 'Enter');
		await vi.waitFor(() => expect(env.api.getView()?.kind).toBe('kanban'));
		expect(env.container.querySelector('.og-ws-palette')).toBeNull();
		env.host.destroy();
	});
});

describe('views as saved, shareable tabs', () => {
	function memoryAdapter() {
		const views = new Map<string, import('../../workspace/workspaceTypes.js').GridViewDefinition>();
		return {
			listViews: async () => [...views.values()],
			getView: async (id: string) => views.get(id) ?? null,
			saveView: async (view: import('../../workspace/workspaceTypes.js').GridViewDefinition) => void views.set(view.id, view),
			deleteView: async (id: string) => void views.delete(id),
		};
	}

	async function mountSaved() {
		const api = createClientGrid<Task>({ rows: rows(), columns, getRowId: (row) => row.id, workspace: memoryAdapter() });
		const container = document.createElement('div');
		document.body.appendChild(container);
		const host = mountGridHost(api, container, {
			workspace: { records: { title: 'title', schedule: 'plan', dependencies: 'deps', parent: 'parent' } },
		});
		await vi.waitFor(() => expect(container.querySelector('.og-ws-tab')).not.toBeNull(), LOAD);
		await vi.waitFor(() => expect(api.getWorkspaceState().loading).toBe(false));
		flushFrames();
		return { api, container, host };
	}

	it('creates a view from the dialog, saves it, and opens it as a tab', async () => {
		const { api, container, host } = await mountSaved();
		click(container.querySelector('.og-ws-tab-add')!);
		const dialog = container.querySelector<HTMLElement>('.og-ws-dialog')!;
		click([...dialog.querySelectorAll<HTMLElement>('.og-ws-kind')].find((kind) => kind.textContent?.startsWith('Kanban'))!);
		const name = dialog.querySelector<HTMLInputElement>('input[aria-label="View name"]')!;
		name.value = 'Team board';
		const lanes = dialog.querySelector<HTMLSelectElement>('select[aria-label="Swimlanes"]')!;
		lanes.value = 'team';
		dialog.querySelector<HTMLSelectElement>('select[aria-label="Who sees it"]')!.value = 'team';
		click([...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Create view')!);
		await vi.waitFor(() => expect(api.getWorkspaceState().views.map((view) => view.name)).toEqual(['Team board']));
		const saved = api.getWorkspaceState().views[0];
		expect(saved.scope).toBe('team');
		expect(saved.state.state.view).toMatchObject({ kind: 'kanban', swimlaneField: 'team' });
		flushFrames();
		const tab = container.querySelector<HTMLElement>(`.og-ws-tab[data-tab="saved:${saved.id}"]`)!;
		expect(tab.getAttribute('aria-selected')).toBe('true');
		host.destroy();
	});

	it('reopens a saved view with its configuration, and saves changes to it', async () => {
		const { api, container, host } = await mountSaved();
		api.setView({ kind: 'kanban', swimlaneField: 'team' });
		const saved = await api.saveView('Board');
		api.setView(null);
		await vi.waitFor(() => expect(container.querySelector('.og-ws')?.getAttribute('data-kind')).toBe('table'));
		flushFrames();
		click(container.querySelector(`.og-ws-tab[data-tab="saved:${saved.id}"]`)!);
		await vi.waitFor(() => expect(api.getView()).toMatchObject({ kind: 'kanban', swimlaneField: 'team' }));
		// A change marks the view dirty; Save view writes it back.
		api.setSortModel([{ colId: 'title', sort: 'desc' }]);
		await vi.waitFor(() => expect(api.getWorkspaceState().dirty).toBe(true));
		flushFrames();
		const save = container.querySelector<HTMLButtonElement>('.og-ws-save')!;
		expect(save.hidden).toBe(false);
		click(save);
		await vi.waitFor(() => expect(api.getWorkspaceState().dirty).toBe(false));
		expect(api.getWorkspaceState().views[0].state.state.sortModel).toEqual([{ colId: 'title', sort: 'desc' }]);
		host.destroy();
	});
});
