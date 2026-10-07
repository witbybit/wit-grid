// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomCellRenderer } from '../columnDef.js';
import { selectColumnType } from './cellTypes.js';
import { createSelectEditor } from './editors.js';
import { createCellListbox, type CellOption } from './listbox.js';
import { createCellOptionsStore, type CellOptionsPage, type CellOptionsQuery } from './optionsStore.js';
import { createSelectRenderer } from './renderers.js';

const CITIES: CellOption[] = Array.from({ length: 7 }, (_, i) => ({ value: `c${i}`, label: `City ${i}` }));

/** A loader whose pages the test settles by hand. */
function manualLoader() {
	const calls: { query: CellOptionsQuery; resolve: (page: CellOptionsPage) => void; reject: (error: unknown) => void }[] = [];
	const load = vi.fn(
		(query: CellOptionsQuery) =>
			new Promise<CellOptionsPage>((resolve, reject) => {
				calls.push({ query, resolve, reject });
			})
	);
	return { load, calls };
}

/** A page of CITIES for a query, three at a time. */
function pageFor(query: { search: string; offset: number }): CellOptionsPage {
	const hits = CITIES.filter((city) => city.label!.toLowerCase().includes(query.search.toLowerCase()));
	return { options: hits.slice(query.offset, query.offset + 3), hasMore: query.offset + 3 < hits.length, total: hits.length };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function key(target: Element, k: string) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

function labels(root: Element): string[] {
	return [...root.querySelectorAll('.og-ct-option-label')].map((el) => el.textContent ?? '');
}

afterEach(() => {
	document.body.textContent = '';
});

describe('createCellOptionsStore', () => {
	it('batches lookups of unknown values into one call and never asks twice', async () => {
		const resolveOptions = vi.fn(async (values: string[]) => CITIES.filter((city) => values.includes(city.value)));
		const store = createCellOptionsStore([], { resolveOptions });
		const a = store.ensure(['c1']);
		const b = store.ensure(['c2', 'c1', 'missing']);
		expect(store.isPending('c1')).toBe(true);
		await Promise.all([a, b]);
		expect(resolveOptions).toHaveBeenCalledTimes(1);
		expect(resolveOptions).toHaveBeenCalledWith(['c1', 'c2', 'missing']);
		expect(store.get('c2')?.label).toBe('City 2');
		expect(store.isPending('c1')).toBe(false);
		expect(store.ensure(['c1', 'missing'])).toBeNull();
	});

	it('remembers loaded pages, so their labels show everywhere', async () => {
		const store = createCellOptionsStore([], { loadOptions: async (query) => pageFor(query) });
		const page = await store.fetch!({ search: '', offset: 0, limit: 3, signal: new AbortController().signal });
		expect(page.options).toHaveLength(3);
		expect(store.get('c0')?.label).toBe('City 0');
	});
});

describe('createCellListbox with a loader', () => {
	it('loads the first page, then the next one past the last option', async () => {
		const { load, calls } = manualLoader();
		const lb = createCellListbox({ options: [], selected: [], load: (search, offset, signal) => load({ search, offset, limit: 3, signal }) });
		document.body.appendChild(lb.element);
		const input = lb.element.querySelector('input')!;
		expect(lb.element.querySelector('.og-ct-list-status')?.textContent).toContain('Loading');
		expect(lb.element.querySelector('[role=listbox]')!.getAttribute('aria-busy')).toBe('true');

		calls[0].resolve(pageFor(calls[0].query));
		await flush();
		expect(labels(lb.element)).toEqual(['City 0', 'City 1', 'City 2']);
		expect(lb.element.querySelector('.og-ct-list-status')?.textContent).toBe('3 of 7');

		key(input, 'ArrowDown');
		key(input, 'ArrowDown');
		expect(load).toHaveBeenCalledTimes(1);
		key(input, 'ArrowDown'); // already on the last option
		expect(load).toHaveBeenCalledTimes(2);
		expect(calls[1].query.offset).toBe(3);
		calls[1].resolve(pageFor(calls[1].query));
		await flush();
		expect(labels(lb.element)).toEqual(['City 0', 'City 1', 'City 2', 'City 3', 'City 4', 'City 5']);
		// The place in the list is kept across the new page.
		expect(lb.element.querySelector('.og-ct-option[data-active] .og-ct-option-label')?.textContent).toBe('City 2');
	});

	it('keeps one search in flight: newer searches wait, and only the latest runs', async () => {
		const { load, calls } = manualLoader();
		const lb = createCellListbox({ options: [], selected: [], load: (search, offset, signal) => load({ search, offset, limit: 3, signal }) });
		const input = lb.element.querySelector('input')!;
		input.value = 'City 1';
		input.dispatchEvent(new Event('input'));
		input.value = 'City 6';
		input.dispatchEvent(new Event('input'));
		// The first page is still loading: the typed searches wait for it.
		expect(calls.map((call) => call.query.search)).toEqual(['']);
		calls[0].resolve(pageFor(calls[0].query));
		await flush();
		// Its result is stale: dropped, and only the latest search is sent.
		expect(calls.map((call) => call.query.search)).toEqual(['', 'City 6']);
		calls[1].resolve(pageFor(calls[1].query));
		await flush();
		expect(labels(lb.element)).toEqual(['City 6']);
	});

	it('waits out the debounce through the grid scheduler, and skips searches below the minimum length', async () => {
		vi.useFakeTimers();
		try {
			const { load, calls } = manualLoader();
			const lb = createCellListbox({
				options: [],
				selected: [],
				debounceMs: 250,
				minQueryLength: 2,
				load: (search, offset, signal) => load({ search, offset, limit: 3, signal }),
			});
			calls[0].resolve(pageFor(calls[0].query));
			await vi.advanceTimersByTimeAsync(0);
			const input = lb.element.querySelector('input')!;
			input.value = 'C';
			input.dispatchEvent(new Event('input'));
			expect(lb.element.querySelector('.og-ct-list-status')?.textContent).toBe('Type 2 or more characters');
			input.value = 'Ci';
			input.dispatchEvent(new Event('input'));
			input.value = 'City 4';
			input.dispatchEvent(new Event('input'));
			await vi.advanceTimersByTimeAsync(200);
			expect(calls).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(60);
			expect(calls.map((call) => call.query.search)).toEqual(['', 'City 4']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('offers Retry when a page fails', async () => {
		const { load, calls } = manualLoader();
		const lb = createCellListbox({ options: [], selected: [], load: (search, offset, signal) => load({ search, offset, limit: 3, signal }) });
		calls[0].reject(new Error('offline'));
		await flush();
		const status = lb.element.querySelector('.og-ct-list-status')!;
		expect(status.textContent).toContain('Couldn’t load options.');
		status.querySelector('button')!.click();
		expect(load).toHaveBeenCalledTimes(2);
		calls[1].resolve(pageFor(calls[1].query));
		await flush();
		expect(labels(lb.element)).toHaveLength(3);
	});

	it('loads more as the list scrolls near its end', async () => {
		const { load, calls } = manualLoader();
		const lb = createCellListbox({ options: [], selected: [], load: (search, offset, signal) => load({ search, offset, limit: 3, signal }) });
		const list = lb.element.querySelector<HTMLElement>('[role=listbox]')!;
		calls[0].resolve(pageFor(calls[0].query));
		await flush();
		Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
		Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 400 });
		list.scrollTop = 10;
		list.dispatchEvent(new Event('scroll'));
		expect(load).toHaveBeenCalledTimes(1);
		list.scrollTop = 260;
		list.dispatchEvent(new Event('scroll'));
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe('async select columns', () => {
	it('cells show a placeholder until resolveOptions returns the label', async () => {
		const resolveOptions = vi.fn(async (values: string[]) => CITIES.filter((city) => values.includes(city.value)));
		const store = createCellOptionsStore([], { resolveOptions });
		const container = document.createElement('div');
		const renderer: DomCellRenderer<any> = createSelectRenderer(store);
		renderer.mount(container, { container, value: 'c4', node: { id: 'r1', data: {} }, col: { field: 'f', header: 'F' }, api: {} } as any);
		expect(container.querySelector('.og-ct-skeleton')).not.toBeNull();
		await flush();
		expect(container.querySelector('.og-ct-skeleton')).toBeNull();
		expect(container.querySelector('.og-ct-badge')!.textContent).toBe('City 4');
	});

	it('the editor pages from the loader and passes the cell; the filter shares its options', async () => {
		const loadOptions = vi.fn(async (query: CellOptionsQuery) => pageFor(query));
		const type = selectColumnType([], { loadOptions });
		// The column's filter lists the same store: its loaded options label filters too.
		expect(type.filterDef?.type).toBe('select');
		expect(type.filterDef?.options).toBeDefined();

		const container = document.createElement('div');
		document.body.appendChild(container);
		const onCommit = vi.fn();
		const editor = (type.cellEditor as { editor: ReturnType<typeof createSelectEditor> }).editor;
		editor.mount(container, {
			rowId: 'r9',
			colField: 'city',
			value: null,
			onChange: vi.fn(),
			onCommit,
			onCancel: vi.fn(),
			api: {} as any,
			col: { field: 'city', header: 'City' },
		});
		await flush();
		expect(loadOptions).toHaveBeenLastCalledWith(expect.objectContaining({ rowId: 'r9', colField: 'city', offset: 0, limit: 50 }));
		const popover = document.querySelector('.og-ct-popover')!;
		expect(labels(popover)).toEqual(['City 0', 'City 1', 'City 2']);
		key(popover.querySelector('input')!, 'Enter');
		expect(onCommit).toHaveBeenCalledWith('c0');
		// What the editor loaded now labels the value elsewhere.
		expect(type.valueFormatter!({ value: 'c0' } as any)).toBe('City 0');
	});
});
