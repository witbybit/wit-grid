/**
 * Cascading select: a value is a path through a tree (Country → State → City), shown as
 * “India › Karnataka › Bengaluru” and picked in a popover with one column per level. Levels can
 * be given up front or loaded as they open; search finds paths across the tree.
 */
import type { DomCellEditor, DomCellRenderer } from '../columnDef.js';
import { editSession, editorShell } from './editors.js';
import { cellIconSvg, createCellIcon } from './icons.js';
import { createOptionMarker, optionLabel, type CellOption } from './listbox.js';
import { openCellPopover } from './popover.js';
import { valueRenderer } from './renderers.js';

/** A node of the tree. Give `children`, or for levels loaded on demand mark leaves `isLeaf: true`. */
export interface CascadeOption extends CellOption {
	children?: readonly CascadeOption[];
	isLeaf?: boolean;
}

export interface CascadeCellOptions {
	/** The whole tree, when it is known up front. */
	options?: readonly CascadeOption[];
	/** Children of a node (`path` holds its ancestors' values and its own; `[]` for the roots). */
	loadChildren?: (path: string[], signal: AbortSignal) => Promise<readonly CascadeOption[]>;
	/** The nodes along stored paths, for cells drawn before their levels were loaded. */
	resolvePath?: (path: string[]) => Promise<readonly CellOption[]>;
	/** Search paths on a server; without it, search covers the levels loaded so far. */
	searchPaths?: (query: string, signal: AbortSignal) => Promise<readonly (readonly CascadeOption[])[]>;
	/** Pick any level, not just leaves (a state as well as a city). Default false. */
	changeOnSelect?: boolean;
	/** Open a level on hover as well as click. Default 'click'. */
	expandTrigger?: 'click' | 'hover';
	/** Between levels in the cell. Default ' › '. */
	separator?: string;
	/** Between values when the cell stores a string. Default '/'. */
	valueSeparator?: string;
	/** Show only the last level in the cell (the full path in its tooltip). Default false. */
	lastLevelOnly?: boolean;
	searchable?: boolean;
	searchPlaceholder?: string;
	placeholder?: string;
}

const KEY = '\u0000';
const keyOf = (path: readonly string[]) => path.join(KEY);

/** The tree as known so far, shared by a column's renderer and editor. */
export interface CascadeStore {
	readonly config: CascadeCellOptions;
	node(path: readonly string[]): CascadeOption | undefined;
	/** Children of a node if known; undefined when they must be loaded. */
	children(path: readonly string[]): readonly CascadeOption[] | undefined;
	loadChildren(path: string[], signal: AbortSignal): Promise<readonly CascadeOption[]>;
	isLeaf(path: readonly string[]): boolean;
	/** Labels along a path; settles once missing nodes are resolved (null when nothing to wait for). */
	ensurePath(path: string[]): Promise<void> | null;
	isPending(path: readonly string[]): boolean;
	remember(path: readonly string[], option: CascadeOption): void;
	/** Every known path whose labels match a query (leaves only unless changeOnSelect). */
	search(query: string, limit?: number): CascadeOption[][];
}

export function createCascadeStore(config: CascadeCellOptions = {}): CascadeStore {
	const nodes = new Map<string, CascadeOption>();
	const kids = new Map<string, readonly CascadeOption[]>();
	const pending = new Map<string, Promise<void>>();
	const failedResolve = new Set<string>();

	const index = (parent: readonly string[], list: readonly CascadeOption[]) => {
		kids.set(keyOf(parent), list);
		for (const option of list) {
			const path = [...parent, option.value];
			nodes.set(keyOf(path), option);
			if (option.children) index(path, option.children);
		}
	};
	if (config.options) index([], config.options);

	const store: CascadeStore = {
		config,
		node: (path) => nodes.get(keyOf(path)),
		children: (path) => kids.get(keyOf(path)) ?? store.node(path)?.children,
		async loadChildren(path, signal) {
			const known = store.children(path);
			if (known) return known;
			if (!config.loadChildren) return [];
			const list = await config.loadChildren(path, signal);
			index(path, list);
			return list;
		},
		isLeaf(path) {
			const node = store.node(path);
			if (!node) return true;
			if (node.isLeaf) return true;
			const list = store.children(path);
			if (list) return list.length === 0;
			return !config.loadChildren;
		},
		remember(path, option) {
			nodes.set(keyOf(path), option);
		},
		isPending: (path) => pending.has(keyOf(path)),
		ensurePath(path) {
			const missing = path.some((_, i) => !nodes.has(keyOf(path.slice(0, i + 1))));
			const key = keyOf(path);
			if (!missing || !config.resolvePath || failedResolve.has(key)) return null;
			let wait = pending.get(key);
			if (!wait) {
				wait = config
					.resolvePath(path)
					.then(
						(found) => {
							found.forEach((option, i) => {
								const at = path.slice(0, i + 1);
								if (!nodes.has(keyOf(at))) nodes.set(keyOf(at), option);
							});
						},
						() => undefined
					)
					.finally(() => {
						pending.delete(key);
						if (path.some((_, i) => !nodes.has(keyOf(path.slice(0, i + 1))))) failedResolve.add(key);
					});
				pending.set(key, wait);
			}
			return wait;
		},
		search(query, limit = 100) {
			const q = query.trim().toLowerCase();
			const out: CascadeOption[][] = [];
			if (!q) return out;
			const walk = (parent: string[], trail: CascadeOption[]) => {
				for (const option of store.children(parent) ?? []) {
					if (out.length >= limit) return;
					const path = [...parent, option.value];
					const nodesOnPath = [...trail, option];
					const leaf = store.isLeaf(path);
					if ((leaf || config.changeOnSelect) && nodesOnPath.some((n) => optionLabel(n).toLowerCase().includes(q))) out.push(nodesOnPath);
					if (!leaf) walk(path, nodesOnPath);
				}
			};
			walk([], []);
			return out;
		},
	};
	return store;
}

/** A path from an array or a string joined with the value separator. */
export function parseCascadeValue(value: unknown, valueSeparator = '/'): string[] {
	if (Array.isArray(value)) return value.filter((v) => v != null && v !== '').map(String);
	if (value == null || value === '') return [];
	return String(value)
		.split(valueSeparator)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Writes a path in the shape the cell held: a string stays a string, anything else becomes an array. */
export function writeCascadeValue(previous: unknown, path: string[], valueSeparator = '/'): string[] | string | null {
	if (path.length === 0) return null;
	return typeof previous === 'string' ? path.join(valueSeparator) : path;
}

function pathLabels(store: CascadeStore, path: string[]): string[] {
	return path.map((value, i) => {
		const node = store.node(path.slice(0, i + 1));
		return node ? optionLabel(node) : value;
	});
}

function drawPath(target: HTMLElement, store: CascadeStore, path: string[]) {
	const { separator = ' › ', lastLevelOnly } = store.config;
	const labels = pathLabels(store, path);
	target.textContent = '';
	target.title = labels.join(separator);
	const shown = lastLevelOnly ? labels.slice(-1) : labels;
	shown.forEach((label, i) => {
		if (i > 0) {
			const sep = document.createElement('span');
			sep.className = 'og-ct-path-sep';
			sep.textContent = separator;
			target.appendChild(sep);
		}
		const part = document.createElement('span');
		part.className = i === shown.length - 1 ? 'og-ct-path-leaf' : 'og-ct-path-part';
		part.textContent = label;
		target.appendChild(part);
	});
}

export function createCascadeRenderer(store: CascadeStore): DomCellRenderer<any> {
	const sep = store.config.valueSeparator;
	return valueRenderer((root) => {
		const text = document.createElement('span');
		text.className = 'og-ct-path';
		root.appendChild(text);
		let current: unknown;
		const draw = (value: unknown) => {
			const path = parseCascadeValue(value, sep);
			if (path.length > 0 && store.isPending(path)) {
				text.textContent = '';
				const bar = document.createElement('span');
				bar.className = 'og-ct-skeleton';
				text.appendChild(bar);
				return;
			}
			drawPath(text, store, path);
		};
		return (value) => {
			current = value;
			const waiting = store.ensurePath(parseCascadeValue(value, sep));
			draw(value);
			waiting?.then(() => {
				if (Object.is(current, value)) draw(value);
			});
		};
	});
}

/**
 * One column per level: ↑ ↓ move, → or Enter opens a level, ← goes back, Enter on a leaf picks it
 * (any level with `changeOnSelect`). Typing searches paths. Levels load as they open.
 */
export function createCascadeEditor(store: CascadeStore): DomCellEditor<any> {
	const config = store.config;
	const sep = config.valueSeparator;
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			const initial = parseCascadeValue(params.value, sep);
			const trigger = document.createElement('div');
			trigger.className = 'og-ct-trigger';
			const shown = document.createElement('span');
			shown.className = 'og-ct-path';
			trigger.append(shown, createCellIcon('chevronDown', 14, 'og-ct-chevron'));
			root.appendChild(trigger);
			const drawCell = (path: string[]) => {
				if (path.length) drawPath(shown, store, path);
				else {
					shown.textContent = config.placeholder ?? 'Select…';
					shown.className = 'og-ct-path og-ct-placeholder';
					return;
				}
				shown.className = 'og-ct-path';
			};
			drawCell(initial);

			const panel = document.createElement('div');
			panel.className = 'og-ct-cascade';
			let input: HTMLInputElement | null = null;
			if (config.searchable ?? true) {
				const search = document.createElement('div');
				search.className = 'og-ct-search';
				search.innerHTML = cellIconSvg('search', 15);
				input = document.createElement('input');
				input.type = 'text';
				input.placeholder = config.searchPlaceholder ?? 'Search…';
				input.autocomplete = 'off';
				input.spellcheck = false;
				search.appendChild(input);
				panel.appendChild(search);
			}
			const columnsEl = document.createElement('div');
			columnsEl.className = 'og-ct-cascade-columns';
			columnsEl.tabIndex = input ? -1 : 0;
			panel.appendChild(columnsEl);
			const focusTarget: HTMLElement = input ?? columnsEl;

			// The opened path, and which column / row the keyboard is on.
			let opened: string[] = [...initial];
			let focusCol = Math.max(0, initial.length - 1);
			const activeRow: number[] = [];
			const loading = new Set<string>();
			const failed = new Set<string>();
			const controllers = new Map<string, AbortController>();
			let results: CascadeOption[][] = [];
			let activeResult = 0;
			let draft: string[] = [...initial];

			const commit = (path: string[]) => end.commit(writeCascadeValue(params.value, path, sep));

			function ensureLoaded(path: string[]) {
				const key = keyOf(path);
				if (store.children(path) || loading.has(key) || !config.loadChildren) return;
				loading.add(key);
				failed.delete(key);
				const controller = new AbortController();
				controllers.set(key, controller);
				store.loadChildren(path, controller.signal).then(
					() => {
						loading.delete(key);
						render();
					},
					() => {
						loading.delete(key);
						if (!controller.signal.aborted) failed.add(key);
						render();
					}
				);
			}

			/** Opens `option` in column `col`: the next column shows its children. */
			function open(col: number, option: CascadeOption, viaKeyboard: boolean) {
				opened = [...opened.slice(0, col), option.value];
				const path = opened;
				if (!store.isLeaf(path)) ensureLoaded(path);
				if (config.changeOnSelect) {
					draft = [...path];
					params.onChange(writeCascadeValue(params.value, draft, sep));
					drawCell(draft);
				}
				if (viaKeyboard && !store.isLeaf(path)) {
					focusCol = col + 1;
					activeRow[focusCol] = 0;
				}
				render();
			}

			function choose(col: number, option: CascadeOption) {
				const path = [...opened.slice(0, col), option.value];
				if (store.isLeaf(path)) commit(path);
				else open(col, option, true);
			}

			function renderColumns() {
				columnsEl.textContent = '';
				for (let col = 0; col <= opened.length; col++) {
					const parent = opened.slice(0, col);
					if (col > 0 && store.isLeaf(parent)) break;
					const list = store.children(parent);
					const column = document.createElement('div');
					column.className = 'og-ct-cascade-column';
					column.setAttribute('role', 'listbox');
					const key = keyOf(parent);
					if (!list) {
						ensureLoaded(parent);
						const status = document.createElement('div');
						status.className = 'og-ct-list-status';
						if (failed.has(key)) {
							status.append('Couldn’t load.');
							const retry = document.createElement('button');
							retry.type = 'button';
							retry.className = 'og-ct-btn';
							retry.textContent = 'Retry';
							retry.addEventListener('mousedown', (event) => event.preventDefault());
							retry.addEventListener('click', () => {
								failed.delete(key);
								ensureLoaded(parent);
								render();
							});
							status.appendChild(retry);
						} else {
							status.innerHTML = '<span class="og-ct-spinner" aria-hidden="true"></span>';
							status.append('Loading…');
						}
						column.appendChild(status);
						columnsEl.appendChild(column);
						break;
					}
					if (activeRow[col] === undefined)
						activeRow[col] = Math.max(
							0,
							list.findIndex((o) => o.value === opened[col])
						);
					list.forEach((option, row) => {
						const path = [...parent, option.value];
						const el = document.createElement('div');
						el.className = 'og-ct-option';
						el.setAttribute('role', 'option');
						const onPath = opened[col] === option.value;
						const chosen = draft.length === path.length && keyOf(draft) === keyOf(path);
						el.setAttribute('aria-selected', String(chosen));
						if (onPath) el.setAttribute('data-open', '');
						if (col === focusCol && row === activeRow[col]) el.setAttribute('data-active', '');
						if (option.disabled) el.setAttribute('aria-disabled', 'true');
						const marker = createOptionMarker(option);
						if (marker) el.appendChild(marker);
						const label = document.createElement('span');
						label.className = 'og-ct-option-label';
						label.textContent = optionLabel(option);
						el.appendChild(label);
						const tail = document.createElement('span');
						tail.className = 'og-ct-cascade-tail';
						if (!store.isLeaf(path)) tail.innerHTML = cellIconSvg('chevronRight', 14);
						else if (chosen) tail.innerHTML = cellIconSvg('check', 14);
						el.appendChild(tail);
						el.addEventListener('mousedown', (event) => event.preventDefault());
						el.addEventListener('click', () => {
							if (option.disabled) return;
							focusCol = col;
							activeRow[col] = row;
							choose(col, option);
						});
						if (config.expandTrigger === 'hover') {
							el.addEventListener('mouseenter', () => {
								if (option.disabled || opened[col] === option.value || store.isLeaf(path)) return;
								open(col, option, false);
							});
						}
						column.appendChild(el);
					});
					if (list.length === 0) {
						const empty = document.createElement('div');
						empty.className = 'og-ct-list-empty';
						empty.textContent = 'Nothing here.';
						column.appendChild(empty);
					}
					columnsEl.appendChild(column);
				}
				// Keep the keyboard row in view in each column.
				columnsEl
					.querySelectorAll<HTMLElement>('.og-ct-option[data-active], .og-ct-option[data-open]')
					.forEach((el) => el.scrollIntoView?.({ block: 'nearest' }));
			}

			let searchController: AbortController | null = null;
			let searching = false;
			function runSearch(query: string) {
				results = store.search(query);
				activeResult = 0;
				searchController?.abort();
				if (config.searchPaths && query.trim()) {
					searchController = new AbortController();
					searching = true;
					const signal = searchController.signal;
					config.searchPaths(query, signal).then(
						(paths) => {
							if (signal.aborted) return;
							searching = false;
							const seen = new Set(results.map((p) => keyOf(p.map((n) => n.value))));
							for (const nodesOnPath of paths) {
								const values = nodesOnPath.map((n) => n.value);
								nodesOnPath.forEach((n, i) => store.remember(values.slice(0, i + 1), n));
								if (!seen.has(keyOf(values))) results.push([...nodesOnPath]);
							}
							render();
						},
						() => {
							if (!signal.aborted) searching = false;
							render();
						}
					);
				} else searching = false;
			}

			function renderResults() {
				columnsEl.textContent = '';
				const column = document.createElement('div');
				column.className = 'og-ct-cascade-column og-ct-cascade-results';
				column.setAttribute('role', 'listbox');
				results.forEach((nodesOnPath, i) => {
					const el = document.createElement('div');
					el.className = 'og-ct-option';
					el.setAttribute('role', 'option');
					if (i === activeResult) el.setAttribute('data-active', '');
					const label = document.createElement('span');
					label.className = 'og-ct-option-label og-ct-path';
					drawPath(
						label,
						store,
						nodesOnPath.map((n) => n.value)
					);
					el.appendChild(label);
					el.addEventListener('mousedown', (event) => event.preventDefault());
					el.addEventListener('click', () => commit(nodesOnPath.map((n) => n.value)));
					el.addEventListener('mousemove', () => {
						if (activeResult !== i) {
							activeResult = i;
							render();
						}
					});
					column.appendChild(el);
				});
				if (searching) {
					const status = document.createElement('div');
					status.className = 'og-ct-list-status';
					status.innerHTML = '<span class="og-ct-spinner" aria-hidden="true"></span>';
					status.append('Searching…');
					column.appendChild(status);
				} else if (results.length === 0) {
					const empty = document.createElement('div');
					empty.className = 'og-ct-list-empty';
					empty.textContent = 'No results found.';
					column.appendChild(empty);
				}
				columnsEl.appendChild(column);
				column.querySelector<HTMLElement>('[data-active]')?.scrollIntoView?.({ block: 'nearest' });
			}

			function render() {
				if (input?.value.trim()) renderResults();
				else renderColumns();
				popover?.reposition();
			}

			input?.addEventListener('input', () => {
				runSearch(input!.value);
				render();
			});

			focusTarget.addEventListener('keydown', (event) => {
				if (input?.value.trim()) {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						activeResult = Math.max(0, Math.min(results.length - 1, activeResult + (event.key === 'ArrowDown' ? 1 : -1)));
						render();
					} else if (event.key === 'Enter') {
						event.preventDefault();
						const pick = results[activeResult];
						if (pick) commit(pick.map((n) => n.value));
					}
					return;
				}
				const list = store.children(opened.slice(0, focusCol)) ?? [];
				const row = activeRow[focusCol] ?? 0;
				switch (event.key) {
					case 'ArrowDown':
					case 'ArrowUp': {
						event.preventDefault();
						const delta = event.key === 'ArrowDown' ? 1 : -1;
						let next = row;
						for (let i = row + delta; i >= 0 && i < list.length; i += delta) {
							if (!list[i].disabled) {
								next = i;
								break;
							}
						}
						activeRow[focusCol] = next;
						if (config.expandTrigger === 'hover' && list[next]) open(focusCol, list[next], false);
						else render();
						return;
					}
					case 'ArrowRight':
						if (input && input.selectionStart !== input.value.length) return;
						event.preventDefault();
						if (list[row] && !store.isLeaf([...opened.slice(0, focusCol), list[row].value])) open(focusCol, list[row], true);
						return;
					case 'ArrowLeft':
						if (input && input.value) return;
						event.preventDefault();
						if (focusCol > 0) {
							focusCol--;
							render();
						}
						return;
					case 'Enter': {
						event.preventDefault();
						const option = list[row];
						if (!option || option.disabled) return;
						const path = [...opened.slice(0, focusCol), option.value];
						if (store.isLeaf(path) || config.changeOnSelect) commit(path);
						else open(focusCol, option, true);
						return;
					}
					case 'Tab':
						event.preventDefault();
						if (config.changeOnSelect && draft.length) commit(draft);
						else end.cancel();
				}
			});

			const popover = openCellPopover({
				anchor: root,
				content: panel,
				className: 'og-ct-popover-wide',
				label: params.col.header,
				onDismiss: (reason) => {
					// With changeOnSelect, the level last opened is the pick; otherwise a click away keeps the cell.
					if (reason === 'outside' && config.changeOnSelect && keyOf(draft) !== keyOf(initial)) commit(draft);
					else end.cancel(reason === 'outside');
				},
			});
			// Labels for the stored path, and the levels along it.
			store.ensurePath(initial)?.then(() => {
				drawCell(draft);
				render();
			});
			render();
			trigger.addEventListener('mousedown', (event) => {
				event.preventDefault();
				focusTarget.focus();
			});
			end.hold(() => focusTarget.focus({ preventScroll: true }));
			return {
				destroy() {
					end.release();
					for (const controller of controllers.values()) controller.abort();
					searchController?.abort();
					popover.close();
				},
			};
		},
	};
}
