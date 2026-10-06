/**
 * The built-in cell editors, as DOM editors any adapter can host. Select-style editors open their
 * list in a popover at once, so one double-click (or Enter) on a cell goes straight to choosing.
 */
import type { DomCellEditor, DomCellEditorParams } from '../columnDef.js';
import { createCellCalendar } from './calendar.js';
import { cellIconSvg, createCellIcon } from './icons.js';
import { createCellListbox, type CellOption } from './listbox.js';
import { openCellPopover, type CellPopover } from './popover.js';
import { createAvatar, createOptionBadge, toOptionsStore, type BadgeVariant, type CellOptionsInput, type PersonOption } from './renderers.js';
import type { CellOptionsStore } from './optionsStore.js';
import {
	parseCellDate,
	parseCellNumber,
	parseMultiValue,
	toIsoDay,
	toIsoTime,
	writeMultiValue,
	type DateCellOptions,
	type NumberCellOptions,
} from './format.js';

type Params = DomCellEditorParams<any>;

function editorShell(container: HTMLElement): HTMLDivElement {
	const root = document.createElement('div');
	root.className = 'og-cell-editor og-ct-editor';
	container.appendChild(root);
	return root;
}

/**
 * The end of an edit, and focus while it lasts.
 *
 * - `hold(focus)` focuses the editor and keeps focus there: the grid may restore focus to the cell
 *   just after the editor mounts (keyboard-started edits), which would swallow the first keys. Focus
 *   landing on the editing cell itself goes back to the editor; focus anywhere else is the user's.
 * - `commit` / `cancel` end the edit exactly once. Focus then returns to the cell (it may be in a
 *   popover on <body>) so the keyboard keeps driving the grid; not after a press elsewhere.
 */
function editSession(params: Params, container: HTMLElement) {
	const cell = container.closest<HTMLElement>('.og-cell');
	let done = false;
	let focusEditor: (() => void) | null = null;
	const onCellFocus = (event: FocusEvent) => {
		if (!done && event.target === cell) focusEditor?.();
	};
	const release = () => cell?.removeEventListener('focus', onCellFocus);
	const finish = (byPointer: boolean) => {
		done = true;
		release();
		// Focus may be in the editor's own input inside the cell, which is about to be removed: move it
		// to the cell itself.
		if (!byPointer && cell?.isConnected && document.activeElement !== cell) cell.focus({ preventScroll: true });
	};
	return {
		hold(focus: () => void) {
			focusEditor = focus;
			focus();
			cell?.addEventListener('focus', onCellFocus);
		},
		/** `byPointer`: the edit ended by a press elsewhere, which owns focus now. */
		commit(value: unknown, byPointer = false) {
			if (done) return;
			finish(byPointer);
			params.onCommit(value);
		},
		cancel(byPointer = false) {
			if (done) return;
			finish(byPointer);
			params.onCancel();
		},
		release,
	};
}

// ─── Number ───────────────────────────────────────────────────────────────────

export function createNumberEditor(options: NumberCellOptions = {}): DomCellEditor<any> {
	const step = options.step ?? 1;
	const clamp = (n: number) => Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, n));
	const round = (n: number) => (options.decimals === undefined ? n : Number(n.toFixed(options.decimals)));
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			const input = document.createElement('input');
			input.type = 'text';
			input.inputMode = 'decimal';
			input.setAttribute('data-numeric', '');
			const initial = parseCellNumber(params.value);
			input.value = initial === null ? '' : String(initial);
			const parsed = (): number | null => {
				const n = parseCellNumber(input.value);
				return n === null ? null : round(clamp(n));
			};
			const nudge = (direction: 1 | -1) => {
				const next = round(clamp((parseCellNumber(input.value) ?? 0) + direction * step));
				input.value = String(next);
				params.onChange(next);
			};
			input.addEventListener('input', () => params.onChange(parsed()));
			input.addEventListener('keydown', (event) => {
				if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
					event.preventDefault();
					event.stopPropagation();
					nudge(event.key === 'ArrowUp' ? 1 : -1);
				} else if (event.key === 'Enter' || event.key === 'Tab') {
					event.preventDefault();
					event.stopPropagation();
					end.commit(parsed());
				}
			});
			// No commit on blur: the grid may take focus back just after mounting the editor (which
			// the session's hold returns), and a click elsewhere already commits the draft.

			const stepper = document.createElement('span');
			stepper.className = 'og-ct-stepper';
			for (const [icon, direction] of [
				['chevronUp', 1],
				['chevronDown', -1],
			] as const) {
				const button = document.createElement('button');
				button.type = 'button';
				button.tabIndex = -1;
				button.setAttribute('aria-label', direction === 1 ? 'Increment' : 'Decrement');
				button.innerHTML = cellIconSvg(icon, 11);
				// Keep focus (and the edit) in the field.
				button.addEventListener('mousedown', (event) => event.preventDefault());
				button.addEventListener('click', () => nudge(direction));
				stepper.appendChild(button);
			}
			if (options.prefix)
				root.appendChild(Object.assign(document.createElement('span'), { className: 'og-ct-placeholder', textContent: options.prefix }));
			root.appendChild(input);
			root.appendChild(stepper);
			end.hold(() => {
				input.focus({ preventScroll: true });
				input.select();
			});
			return { destroy: end.release };
		},
	};
}

// ─── Date ─────────────────────────────────────────────────────────────────────

/** The value to write for a picked date, in the shape the cell held. */
function writeDate(previous: unknown, date: Date | null, withTime: boolean): unknown {
	if (!date) return null;
	if (previous instanceof Date) return date;
	if (typeof previous === 'number') return date.getTime();
	return withTime ? `${toIsoDay(date)}T${toIsoTime(date)}` : toIsoDay(date);
}

function dateText(date: Date | null, withTime: boolean): string {
	if (!date) return '';
	return withTime ? `${toIsoDay(date)} ${toIsoTime(date)}` : toIsoDay(date);
}

export function createDateEditor(options: DateCellOptions = {}): DomCellEditor<any> {
	const withTime = !!options.withTime;
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			root.appendChild(createCellIcon(withTime ? 'clock' : 'calendar', 13));
			const input = document.createElement('input');
			input.type = 'text';
			input.placeholder = withTime ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD';
			const initial = parseCellDate(params.value);
			input.value = dateText(initial, withTime);
			root.appendChild(input);

			const typed = (): Date | null | undefined => {
				const text = input.value.trim();
				if (!text) return null;
				const date = parseCellDate(text.replace(' ', 'T'));
				return date ?? undefined; // undefined: not a date (yet)
			};
			const commitTyped = (byPointer = false) => {
				const date = typed();
				if (date === undefined) end.cancel(byPointer);
				else end.commit(writeDate(params.value, date, withTime), byPointer);
			};
			const pick = (date: Date) => {
				// Picking a day keeps the time of day the cell had.
				if (withTime) {
					const base = typed() ?? initial;
					if (base) date = new Date(date.getFullYear(), date.getMonth(), date.getDate(), base.getHours(), base.getMinutes());
				}
				end.commit(writeDate(params.value, date, withTime));
			};

			const calendar = createCellCalendar({
				value: initial,
				weekStartsOn: options.weekStartsOn,
				locale: options.locale,
				onSelect: pick,
				onClear: () => end.commit(null),
			});
			const popover = openCellPopover({
				anchor: root,
				content: calendar.element,
				label: 'Choose a date',
				onDismiss: (reason) => (reason === 'escape' ? end.cancel() : commitTyped(true)),
			});

			input.addEventListener('input', () => {
				const date = typed();
				if (date !== undefined) {
					calendar.setValue(date);
					params.onChange(writeDate(params.value, date, withTime));
				}
			});
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === 'Tab') {
					event.preventDefault();
					event.stopPropagation();
					commitTyped();
				} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					event.stopPropagation();
					calendar.focus();
				}
			});
			end.hold(() => {
				input.focus({ preventScroll: true });
				input.select();
			});
			return {
				destroy() {
					end.release();
					popover.close();
				},
			};
		},
	};
}

// ─── Select, multi-select, combobox, person ──────────────────────────────────

export interface SelectEditorOptions {
	/** Search field: default on for more than 7 options. */
	searchable?: boolean;
	searchPlaceholder?: string;
	/** Allow values that are not in the list (“Create …”). */
	creatable?: boolean;
	/** Single select: a first entry that clears the cell, e.g. “No status”. */
	noneLabel?: string;
	emptyText?: string;
	/** How the current value shows in the cell while editing. */
	variant?: BadgeVariant;
	placeholder?: string;
	/** Status texts for options loaded from a server. */
	loadingText?: string;
	errorText?: string;
}

interface ListEditorSetup {
	store: CellOptionsStore;
	config: SelectEditorOptions;
	multiple: boolean;
	leading?: (option: CellOption) => HTMLElement | null;
	/** Draws the value in the cell behind the popover. */
	drawValue: (target: HTMLElement, values: string[], store: CellOptionsStore) => void;
}

function createListEditor(setup: ListEditorSetup): DomCellEditor<any> {
	const { store } = setup;
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			const values = parseMultiValue(params.value);
			// Values the cell holds that the list may not show (free tags, created values, options on a
			// page not loaded yet) stay listed and checked: after the given options, or first when the
			// rest comes from a server.
			const extras: CellOption[] = values
				.filter((value) => !store.options.some((o) => o.value === value))
				.map((value) => store.get(value) ?? { value });
			const options = store.fetch ? [...extras, ...store.options] : [...store.options, ...extras];
			let selected = setup.multiple ? values : values.slice(0, 1);

			const trigger = document.createElement('div');
			trigger.className = 'og-ct-trigger';
			const view = document.createElement('div');
			view.className = 'og-ct-cell og-ct-chips';
			const chevron = createCellIcon('chevronDown', 14, 'og-ct-chevron');
			trigger.append(view, chevron);
			root.appendChild(trigger);
			const draw = () => {
				view.textContent = '';
				if (selected.length === 0) {
					const placeholder = document.createElement('span');
					placeholder.className = 'og-ct-placeholder';
					placeholder.textContent = setup.config.placeholder ?? (setup.multiple ? 'Select…' : 'Select an option');
					view.appendChild(placeholder);
				} else {
					setup.drawValue(view, selected, store);
				}
			};
			draw();
			// Labels for values the store had not seen arrive later.
			store.ensure(values)?.then(() => {
				for (let i = 0; i < extras.length; i++) {
					const known = store.get(extras[i].value);
					if (known) options[options.indexOf(extras[i])] = extras[i] = known;
				}
				draw();
			});

			const write = () => (setup.multiple ? writeMultiValue(params.value, selected) : (selected[0] ?? null));
			let popover: CellPopover | null = null;
			const listbox = createCellListbox({
				options,
				selected,
				multiple: setup.multiple,
				searchable: setup.config.searchable,
				searchPlaceholder: setup.config.searchPlaceholder,
				creatable: setup.config.creatable,
				noneLabel: setup.config.noneLabel,
				emptyText: setup.config.emptyText,
				loadingText: setup.config.loadingText,
				errorText: setup.config.errorText,
				leading: setup.leading,
				load: store.fetch
					? (search, offset, signal) =>
							store.fetch!({ search, offset, limit: store.pageSize, signal, rowId: params.rowId, colField: params.colField })
					: undefined,
				onCreate: (label) => {
					if (!store.get(label)) {
						const option = { value: label };
						store.remember([option]);
						options.push(option);
					}
					return label;
				},
				onSelect: (value) => {
					selected = value === null ? [] : [value];
					end.commit(write());
				},
				onChange: (next) => {
					selected = next;
					draw();
					params.onChange(write());
					popover?.reposition();
				},
				onTab: () => (setup.multiple ? end.commit(write()) : end.cancel()),
			});
			popover = openCellPopover({
				anchor: root,
				content: listbox.element,
				matchAnchorWidth: true,
				label: params.col.header,
				// Escape abandons the edit; clicking away keeps a multi-select's picks.
				onDismiss: (reason) => {
					const byPointer = reason === 'outside';
					if (reason === 'escape' || !setup.multiple) end.cancel(byPointer);
					else end.commit(write(), byPointer);
				},
			});
			trigger.addEventListener('mousedown', (event) => {
				event.preventDefault();
				listbox.focus();
			});
			end.hold(() => listbox.focus());
			return {
				destroy() {
					end.release();
					listbox.destroy();
					popover?.close();
				},
			};
		},
	};
}

/** Same badges as the renderers: free values in a multi-select get palette colours, in a select none. */
function drawBadges(variant: BadgeVariant, autoColor: boolean) {
	return (target: HTMLElement, values: string[], store: CellOptionsStore) => {
		for (const value of values) target.appendChild(createOptionBadge(store.get(value), value, variant, autoColor));
	};
}

/**
 * Single choice: badge in the cell, searchable grouped list (a combobox) in the popover. Give a
 * store with `loadOptions` (see `createCellOptionsStore`) for options paged in from a server.
 */
export function createSelectEditor(options: CellOptionsInput, config: SelectEditorOptions = {}): DomCellEditor<any> {
	return createListEditor({ store: toOptionsStore(options), config, multiple: false, drawValue: drawBadges(config.variant ?? 'soft', false) });
}

/** Many choices: chips in the cell, checkbox list in the popover. */
export function createMultiSelectEditor(options: CellOptionsInput, config: SelectEditorOptions = {}): DomCellEditor<any> {
	return createListEditor({ store: toOptionsStore(options), config, multiple: true, drawValue: drawBadges(config.variant ?? 'soft', true) });
}

/** People picker: avatars in the list and the cell. */
export function createPersonEditor(
	people: readonly PersonOption[] | CellOptionsStore,
	config: SelectEditorOptions & { multiple?: boolean } = {}
): DomCellEditor<any> {
	const store = toOptionsStore(people);
	const person = (value: string) => store.get(value) as PersonOption | undefined;
	return createListEditor({
		store,
		config: { searchable: true, searchPlaceholder: 'Search people…', ...config },
		multiple: !!config.multiple,
		leading: (option) => createAvatar(option as PersonOption, option.value),
		drawValue: (target, values) => {
			for (const value of values) target.appendChild(createAvatar(person(value), value));
			if (values.length === 1) {
				const name = document.createElement('span');
				name.className = 'og-ct-text';
				name.textContent = person(values[0])?.label ?? values[0];
				target.appendChild(name);
			}
		},
	});
}
