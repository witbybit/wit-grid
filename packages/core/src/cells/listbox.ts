import { resolveCellColor, type CellColor } from './palette.js';
import { cellIconSvg, createCellIcon, type CellIconName } from './icons.js';
import type { CellOptionsPage } from './optionsStore.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';

/** One choice of a select, multi-select or combobox column. */
export interface CellOption {
	value: string;
	/** Shown text; defaults to the value. */
	label?: string;
	/** Palette name or CSS colour for the badge / dot. */
	color?: CellColor;
	icon?: CellIconName;
	/** Second line in the list. */
	description?: string;
	/** Heading the option is listed under. */
	group?: string;
	disabled?: boolean;
}

export interface CellListboxOptions {
	options: readonly CellOption[];
	selected: readonly string[];
	multiple?: boolean;
	/** Show a search field; defaults to more than 7 options. */
	searchable?: boolean;
	searchPlaceholder?: string;
	/** Offer “Create …” for a search that matches no label. */
	creatable?: boolean;
	/** Single mode: a first option that clears the value, with this label (e.g. “No category”). */
	noneLabel?: string;
	emptyText?: string;
	/** Single mode: an option (or none: null) was picked. */
	onSelect?: (value: string | null) => void;
	/** Multiple mode: the selection changed. */
	onChange?: (values: string[]) => void;
	/** A typed value to create; resolves to the value to select. */
	onCreate?: (label: string) => string;
	/** The element before each option's label; defaults to its icon or colour dot. */
	leading?: (option: CellOption) => HTMLElement | null;
	/** Tab pressed (editors commit on it). */
	onTab?: (shift: boolean) => void;
	/**
	 * Options from a server, a page at a time. The list then searches there instead of filtering
	 * `options` (shown only while browsing, ahead of the loaded pages), loads the next page as the
	 * list scrolls near its end, and aborts a page that a newer search makes stale.
	 */
	load?: (search: string, offset: number, signal: AbortSignal) => Promise<CellOptionsPage>;
	/** Wait this long after typing before searching the server (through the grid scheduler). */
	debounceMs?: number;
	/** Search the server only once this many characters are typed (an empty search still loads). */
	minQueryLength?: number;
	loadingText?: string;
	errorText?: string;
	/** Text at the end of an option's row (a row count in filters). */
	trailing?: (option: CellOption) => string | null;
}

export interface CellListbox {
	readonly element: HTMLDivElement;
	focus(): void;
	/** Replaces the chosen values (Select all / Clear in filters). */
	setSelected(values: readonly string[]): void;
	/** The values of the options listed now (after search). */
	visibleValues(): string[];
	/** Aborts a page still loading. */
	destroy(): void;
}

type Item =
	| { kind: 'option'; option: CellOption; el: HTMLDivElement }
	| { kind: 'none'; el: HTMLDivElement }
	| { kind: 'create'; label: string; el: HTMLDivElement };

let nextListboxId = 0;

export function optionLabel(option: CellOption): string {
	return option.label ?? option.value;
}

/** The leading marker of an option: its icon, else a colour dot. */
export function createOptionMarker(option: CellOption): HTMLElement | null {
	if (option.icon) return createCellIcon(option.icon, 14, 'og-ct-option-icon');
	const color = resolveCellColor(option.color);
	if (!color) return null;
	const dot = document.createElement('span');
	dot.className = 'og-ct-dot';
	dot.style.setProperty('--og-ct-hue', color);
	return dot;
}

/**
 * A searchable, grouped option list for select-style editors (the shadcn combobox pattern): arrow
 * keys, Home / End, Enter, typeahead, a check on the chosen options, an optional “none” entry and
 * “Create …”. Focus stays in the search field (or the list when there is none), and the active
 * option is announced through aria-activedescendant.
 */
export function createCellListbox(config: CellListboxOptions): CellListbox {
	const id = `og-ct-lb-${++nextListboxId}`;
	const multiple = !!config.multiple;
	const selected = new Set(config.selected);
	const element = document.createElement('div');
	element.className = 'og-ct-listbox';

	const list = document.createElement('div');
	list.className = 'og-ct-list';
	list.id = id;
	list.setAttribute('role', 'listbox');
	if (multiple) list.setAttribute('aria-multiselectable', 'true');

	let input: HTMLInputElement | null = null;
	const load = config.load;
	if (config.searchable ?? (!!load || config.options.length > 7)) {
		const search = document.createElement('div');
		search.className = 'og-ct-search';
		search.innerHTML = cellIconSvg('search', 15);
		input = document.createElement('input');
		input.type = 'text';
		input.placeholder = config.searchPlaceholder ?? 'Search…';
		input.setAttribute('role', 'combobox');
		input.setAttribute('aria-controls', id);
		input.setAttribute('aria-expanded', 'true');
		input.setAttribute('aria-autocomplete', 'list');
		input.autocomplete = 'off';
		input.spellcheck = false;
		search.appendChild(input);
		element.appendChild(search);
		input.addEventListener('input', () => {
			if (load) searchServer();
			render(input!.value);
		});
	} else {
		list.tabIndex = 0;
	}
	element.appendChild(list);
	const focusTarget: HTMLElement = input ?? list;

	let items: Item[] = [];
	let active = -1;

	// Async source state: the pages loaded for the current search.
	let loaded: CellOption[] = [];
	let hasMore = false;
	let total: number | undefined;
	let loading = false;
	let failed = false;
	let request = 0;
	let controller: AbortController | null = null;
	const query = () => input?.value ?? '';

	let timer: ReturnType<GridScheduler['timeout']> | null = null;
	let inFlight: string | null = null;
	let tooShort = false;

	/** A new search typed: wait out the debounce, then fetch its first page. */
	function searchServer() {
		if (timer !== null) defaultGridScheduler.clearTimeout(timer);
		timer = null;
		const q = query().trim();
		tooShort = q.length > 0 && q.length < (config.minQueryLength ?? 0);
		loaded = [];
		hasMore = false;
		total = undefined;
		failed = false;
		if (tooShort) {
			loading = false;
			return;
		}
		loading = true;
		const wait = config.debounceMs ?? 0;
		if (wait > 0)
			timer = defaultGridScheduler.timeout(() => {
				timer = null;
				fetchPage(true);
			}, wait);
		else fetchPage(true);
	}

	function fetchPage(reset: boolean) {
		if (!load) return;
		const search = query();
		if (reset) {
			loaded = [];
			hasMore = false;
			total = undefined;
			// One search request at a time: a newer search waits for the one in flight, then runs.
			if (inFlight !== null) {
				loading = true;
				return;
			}
		}
		controller = new AbortController();
		const id = ++request;
		inFlight = search;
		loading = true;
		failed = false;
		list.setAttribute('aria-busy', 'true');
		load(search, loaded.length, controller.signal).then(
			(page) => {
				if (id !== request) return;
				inFlight = null;
				// The search changed while this page loaded: drop it and run the latest.
				if (search !== query()) {
					fetchPage(true);
					return;
				}
				const appended = loaded.length > 0;
				const seen = new Set(loaded.map((option) => option.value));
				for (const option of page.options) if (!seen.has(option.value)) loaded.push(option);
				hasMore = !!page.hasMore && page.options.length > 0;
				total = page.total;
				finish(appended);
			},
			() => {
				if (id !== request) return;
				inFlight = null;
				if (search !== query()) {
					fetchPage(true);
					return;
				}
				failed = true;
				finish(true);
			}
		);
		if (!reset) renderStatus();
	}

	function finish(preserve: boolean) {
		loading = false;
		list.removeAttribute('aria-busy');
		render(query(), preserve);
		maybeLoadMore();
	}

	/** Loads the next page when the list is scrolled near its end (or does not fill its height). */
	function maybeLoadMore(force = false) {
		if (!load || !hasMore || loading || failed) return;
		if (!force && (list.clientHeight === 0 || list.scrollTop + list.clientHeight < list.scrollHeight - 64)) return;
		fetchPage(false);
	}

	let status: HTMLDivElement | null = null;
	/** The row after the options: loading, a failed page with Retry, or how many of how many. */
	function renderStatus() {
		status?.remove();
		status = null;
		if (!load) return;
		const row = document.createElement('div');
		row.className = 'og-ct-list-status';
		if (tooShort) {
			row.textContent = `Type ${config.minQueryLength} or more characters`;
		} else if (loading) {
			row.innerHTML = '<span class="og-ct-spinner" aria-hidden="true"></span>';
			row.append(config.loadingText ?? 'Loading…');
		} else if (failed) {
			row.append(config.errorText ?? 'Couldn’t load options.');
			const retry = document.createElement('button');
			retry.type = 'button';
			retry.className = 'og-ct-btn';
			retry.textContent = 'Retry';
			retry.addEventListener('mousedown', (event) => event.preventDefault());
			retry.addEventListener('click', () => fetchPage(loaded.length === 0));
			row.appendChild(retry);
		} else if (total !== undefined && loaded.length > 0) {
			row.setAttribute('data-meta', '');
			row.textContent = `${loaded.length.toLocaleString()} of ${total.toLocaleString()}`;
		} else {
			return;
		}
		status = row;
		list.appendChild(row);
	}
	let typeahead = '';
	let typeaheadAt = 0;

	function setActive(index: number, scroll = true) {
		if (items[active]) items[active].el.removeAttribute('data-active');
		active = index;
		const item = items[index];
		if (!item) {
			focusTarget.removeAttribute('aria-activedescendant');
			return;
		}
		item.el.setAttribute('data-active', '');
		focusTarget.setAttribute('aria-activedescendant', item.el.id);
		if (scroll) item.el.scrollIntoView?.({ block: 'nearest' });
	}

	function isEnabled(item: Item | undefined): boolean {
		return !!item && !(item.kind === 'option' && item.option.disabled);
	}

	function step(from: number, delta: number): number {
		for (let i = from + delta; i >= 0 && i < items.length; i += delta) if (isEnabled(items[i])) return i;
		return from;
	}

	function makeRow(content: (row: HTMLDivElement) => void, isSelected: boolean, index: number): HTMLDivElement {
		const row = document.createElement('div');
		row.className = 'og-ct-option';
		row.id = `${id}-${index}`;
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(isSelected));
		if (multiple) {
			row.setAttribute('data-multiple', '');
			const box = document.createElement('span');
			box.className = 'og-ct-checkbox';
			box.innerHTML = cellIconSvg('check', 12);
			if (isSelected) box.setAttribute('data-checked', '');
			row.appendChild(box);
		}
		content(row);
		if (!multiple) {
			const check = createCellIcon('check', 15, 'og-ct-check');
			row.appendChild(check);
		}
		row.addEventListener('mousemove', () => {
			if (active !== index && isEnabled(items[index])) setActive(index, false);
		});
		// Keep focus in the search field.
		row.addEventListener('mousedown', (event) => event.preventDefault());
		row.addEventListener('click', () => choose(index));
		return row;
	}

	function body(row: HTMLElement, label: string, description?: string) {
		const wrap = document.createElement('span');
		wrap.className = 'og-ct-option-body';
		const text = document.createElement('span');
		text.className = 'og-ct-option-label';
		text.textContent = label;
		wrap.appendChild(text);
		if (description) {
			const desc = document.createElement('span');
			desc.className = 'og-ct-option-desc';
			desc.textContent = description;
			wrap.appendChild(desc);
		}
		row.appendChild(wrap);
	}

	function render(query: string, preserve = false) {
		const q = query.trim().toLowerCase();
		const keepValue = preserve ? activeKey() : null;
		const keepScroll = list.scrollTop;
		list.textContent = '';
		status = null;
		items = [];
		let matches: CellOption[];
		if (load) {
			// The server searched: show its pages, after the given options while browsing.
			const seen = new Set<string>();
			matches = [];
			for (const option of q ? loaded : [...config.options, ...loaded]) {
				if (seen.has(option.value)) continue;
				seen.add(option.value);
				matches.push(option);
			}
		} else {
			matches = config.options.filter((option) => {
				if (!q) return true;
				return (
					optionLabel(option).toLowerCase().includes(q) ||
					!!option.description?.toLowerCase().includes(q) ||
					!!option.group?.toLowerCase().includes(q)
				);
			});
		}

		if (!multiple && config.noneLabel && !q) {
			const index = items.length;
			const el = makeRow((row) => body(row, config.noneLabel!), selected.size === 0, index);
			el.setAttribute('data-muted', '');
			items.push({ kind: 'none', el });
			list.appendChild(el);
		}

		// Ungrouped options first, then each group in first-seen order.
		const groups = new Map<string, CellOption[]>();
		const ungrouped: CellOption[] = [];
		for (const option of matches) {
			if (!option.group) ungrouped.push(option);
			else {
				const members = groups.get(option.group);
				if (members) members.push(option);
				else groups.set(option.group, [option]);
			}
		}
		const appendOption = (option: CellOption, parent: HTMLElement) => {
			const index = items.length;
			const el = makeRow(
				(row) => {
					const marker = (config.leading ?? createOptionMarker)(option);
					if (marker) row.appendChild(marker);
					body(row, optionLabel(option), option.description);
					const trailing = config.trailing?.(option);
					if (trailing) {
						const tail = document.createElement('span');
						tail.className = 'og-ct-option-count';
						tail.textContent = trailing;
						row.appendChild(tail);
					}
				},
				selected.has(option.value),
				index
			);
			if (option.disabled) el.setAttribute('aria-disabled', 'true');
			items.push({ kind: 'option', option, el });
			parent.appendChild(el);
		};
		for (const option of ungrouped) appendOption(option, list);
		for (const [name, members] of groups) {
			const group = document.createElement('div');
			group.setAttribute('role', 'group');
			const heading = document.createElement('div');
			heading.className = 'og-ct-group';
			heading.id = `${id}-g-${list.childElementCount}`;
			heading.textContent = name;
			group.setAttribute('aria-labelledby', heading.id);
			group.appendChild(heading);
			for (const option of members) appendOption(option, group);
			list.appendChild(group);
		}

		const typed = query.trim();
		const lower = typed.toLowerCase();
		const exists = (option: CellOption) => optionLabel(option).toLowerCase() === lower;
		if (config.creatable && typed && !loading && !matches.some(exists) && !config.options.some(exists)) {
			if (items.length > 0) {
				const separator = document.createElement('div');
				separator.className = 'og-ct-separator';
				list.appendChild(separator);
			}
			const index = items.length;
			const el = makeRow(
				(row) => {
					row.appendChild(createCellIcon('plus', 14, 'og-ct-option-icon'));
					body(row, `Create “${typed}”`);
				},
				false,
				index
			);
			items.push({ kind: 'create', label: typed, el });
			list.appendChild(el);
		}

		if (items.length === 0 && !loading && !failed && !tooShort) {
			const empty = document.createElement('div');
			empty.className = 'og-ct-list-empty';
			empty.textContent = config.emptyText ?? 'No results found.';
			list.appendChild(empty);
		}
		renderStatus();

		if (preserve) {
			// A page arrived: keep the place the user was at.
			list.scrollTop = keepScroll;
			const keep = keepValue === null ? -1 : items.findIndex((item) => itemKey(item) === keepValue);
			if (keep >= 0) {
				setActive(keep, false);
				return;
			}
		}
		// Start on the (first) selected option when browsing, on the first match when searching.
		let start = -1;
		if (!q) start = items.findIndex((item) => item.el.getAttribute('aria-selected') === 'true' && isEnabled(item));
		if (start < 0) start = items.findIndex((item) => isEnabled(item));
		setActive(start);
	}

	function itemKey(item: Item): string {
		return item.kind === 'option' ? `o:${item.option.value}` : item.kind;
	}

	function activeKey(): string | null {
		return items[active] ? itemKey(items[active]) : null;
	}

	function choose(index: number) {
		const item = items[index];
		if (!isEnabled(item)) return;
		if (item.kind === 'none') {
			config.onSelect?.(null);
			return;
		}
		const value = item.kind === 'create' ? (config.onCreate ? config.onCreate(item.label) : item.label) : item.option.value;
		if (!multiple) {
			config.onSelect?.(value);
			return;
		}
		if (selected.has(value)) selected.delete(value);
		else selected.add(value);
		config.onChange?.([...selected]);
		if (item.kind === 'create') {
			if (input) input.value = '';
			render('');
			return;
		}
		const on = selected.has(value);
		item.el.setAttribute('aria-selected', String(on));
		const box = item.el.querySelector('.og-ct-checkbox');
		if (on) box?.setAttribute('data-checked', '');
		else box?.removeAttribute('data-checked');
	}

	focusTarget.addEventListener('keydown', (event) => {
		switch (event.key) {
			case 'ArrowDown': {
				event.preventDefault();
				const next = active < 0 ? step(-1, 1) : step(active, 1);
				// Already on the last loaded option: fetch the next page.
				if (next === active) maybeLoadMore(true);
				setActive(next);
				return;
			}
			case 'ArrowUp':
				event.preventDefault();
				setActive(active < 0 ? step(items.length, -1) : step(active, -1));
				return;
			case 'Home':
			case 'End':
				// Inside a search field Home/End move the caret.
				if (input && input.value) return;
				event.preventDefault();
				setActive(event.key === 'Home' ? step(-1, 1) : step(items.length, -1));
				return;
			case 'Enter':
				event.preventDefault();
				event.stopPropagation();
				if (active >= 0) choose(active);
				return;
			case 'Tab':
				if (config.onTab) {
					event.preventDefault();
					config.onTab(event.shiftKey);
				}
				return;
		}
		// Typeahead in a list with no search field.
		if (!input && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			// Keys within 600 ms of each other extend the match; a pause starts a new one.
			if (event.timeStamp - typeaheadAt > 600) typeahead = '';
			typeaheadAt = event.timeStamp;
			typeahead += event.key.toLowerCase();
			const match = items.findIndex(
				(item) => item.kind === 'option' && isEnabled(item) && optionLabel(item.option).toLowerCase().startsWith(typeahead)
			);
			if (match >= 0) setActive(match);
		}
	});

	list.addEventListener('scroll', () => maybeLoadMore());
	if (load) fetchPage(true);
	render('');
	return {
		element,
		focus: () => focusTarget.focus({ preventScroll: true }),
		setSelected(values) {
			selected.clear();
			for (const value of values) selected.add(value);
			render(query(), true);
		},
		visibleValues: () => items.flatMap((item) => (item.kind === 'option' ? [item.option.value] : [])),
		destroy() {
			request++;
			if (timer !== null) defaultGridScheduler.clearTimeout(timer);
			controller?.abort();
		},
	};
}
