/**
 * The built-in filter editors: one per filter type, each in two sizes (full for popovers, menus,
 * the sidebar and the query builder; compact for the floating filter row). Built from the cell
 * primitives (popover, listbox, calendar), so filters look and behave like the cell editors.
 */
import { createCascadeStore, type CascadeOption, type CascadeStore } from '../cells/cascade.js';
import { createCellCalendar } from '../cells/calendar.js';
import { normalizeHexColor } from '../cells/color.js';
import { parseCellDate, toIsoDay } from '../cells/format.js';
import { cellIconSvg, createCellIcon } from '../cells/icons.js';
import { createCellListbox, optionLabel, type CellOption } from '../cells/listbox.js';
import { createCellOptionsStore, isCellOptionsStore, type CellOptionsStore } from '../cells/optionsStore.js';
import { openCellPopover, type CellPopover } from '../cells/popover.js';
import type { ColumnFilter, DateFilterCondition, FilterCondition, SelectFilterCondition } from '../filterModel.js';
import { defaultOpForType, getOpMeta, getOpsForType, summarizeFilter, type OpOption } from '../filterOperations.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';
import type { ColumnFilterDef, DomFilterEditor, DomFilterEditorHandle, DomFilterEditorParams } from './filterDef.js';
import { DATE_PERIODS, RELATIVE_DATE_UNITS, type DatePeriod, type RelativeDateUnit } from './relativeDates.js';

/** Typing applies after this pause (Enter applies at once). */
const TYPING_DEBOUNCE_MS = 300;
/** Stands for blank cells in option lists (real values are never this). */
const BLANK = '\u0000blank';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
	const b = el('button', className, text);
	b.type = 'button';
	b.addEventListener('mousedown', (event) => event.preventDefault());
	b.addEventListener('click', onClick);
	return b;
}

/** Runs the latest call after a pause, through the grid scheduler. */
function debouncer(ms: number) {
	let timer: ReturnType<GridScheduler['timeout']> | null = null;
	const cancel = () => {
		if (timer !== null) defaultGridScheduler.clearTimeout(timer);
		timer = null;
	};
	return {
		run(fn: () => void) {
			cancel();
			timer = defaultGridScheduler.timeout(() => {
				timer = null;
				fn();
			}, ms);
		},
		cancel,
	};
}

/** A segmented control: one press picks. */
function segmented<T extends string>(choices: readonly { value: T; label: string }[], value: T, onPick: (value: T) => void, small = false) {
	const group = el('div', small ? 'og-flt-seg og-flt-seg-sm' : 'og-flt-seg');
	group.setAttribute('role', 'radiogroup');
	const buttons = choices.map((choice) => {
		const b = button('og-flt-seg-btn', choice.label, () => {
			set(choice.value);
			onPick(choice.value);
		});
		b.setAttribute('role', 'radio');
		b.dataset.value = choice.value;
		group.appendChild(b);
		return b;
	});
	const set = (next: T) => {
		for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === next));
	};
	set(value);
	return { element: group, set };
}

// ─── Operator picker ──────────────────────────────────────────────────────────

/** A themed operator dropdown (our listbox, not a native select); compact shows the symbol. */
function operatorPicker(ops: OpOption[], value: string, compact: boolean, onPick: (op: string) => void) {
	let current = value;
	const trigger = el('button', compact ? 'og-flt-op og-flt-op-compact' : 'og-flt-op');
	trigger.type = 'button';
	trigger.setAttribute('aria-haspopup', 'listbox');
	const draw = () => {
		const meta = ops.find((op) => op.value === current) ?? ops[0];
		trigger.innerHTML = '';
		trigger.title = meta.label;
		trigger.append(el('span', 'og-flt-op-label', compact ? meta.symbol : meta.label));
		if (!compact) trigger.appendChild(createCellIcon('chevronDown', 13, 'og-ct-chevron'));
	};
	draw();
	let popover: CellPopover | null = null;
	trigger.addEventListener('mousedown', (event) => event.preventDefault());
	trigger.addEventListener('click', () => {
		if (popover) {
			popover.close();
			popover = null;
			return;
		}
		const listbox = createCellListbox({
			options: ops.map((op) => ({ value: op.value, label: op.label })),
			selected: [current],
			searchable: false,
			onSelect: (next) => {
				if (next) {
					current = next;
					draw();
					onPick(next);
				}
				popover?.close();
				popover = null;
				trigger.focus({ preventScroll: true });
			},
		});
		popover = openCellPopover({ anchor: trigger, content: listbox.element, label: 'Operator', onDismiss: () => (popover = null) });
		listbox.focus();
	});
	return {
		element: trigger,
		get value() {
			return current;
		},
		set(next: string) {
			current = next;
			draw();
		},
		close: () => popover?.close(),
	};
}

// ─── Value inputs ─────────────────────────────────────────────────────────────

/** A date field: ISO text, with a calendar popover from its icon. */
function dateInput(value: string, placeholder: string, onInput: (immediate: boolean) => void) {
	const wrap = el('div', 'og-flt-field og-flt-date');
	const input = el('input', 'og-flt-input');
	input.type = 'text';
	input.placeholder = placeholder;
	input.value = value;
	input.spellcheck = false;
	const open = el('button', 'og-flt-icon-btn');
	open.type = 'button';
	open.title = 'Choose a date';
	open.innerHTML = cellIconSvg('calendar', 14);
	let popover: CellPopover | null = null;
	open.addEventListener('mousedown', (event) => event.preventDefault());
	open.addEventListener('click', () => {
		if (popover) {
			popover.close();
			popover = null;
			return;
		}
		const calendar = createCellCalendar({
			value: parseCellDate(input.value),
			onSelect: (date) => {
				input.value = toIsoDay(date);
				popover?.close();
				popover = null;
				onInput(true);
				input.focus({ preventScroll: true });
			},
			onClear: () => {
				input.value = '';
				popover?.close();
				popover = null;
				onInput(true);
			},
		});
		popover = openCellPopover({ anchor: wrap, content: calendar.element, label: 'Choose a date', onDismiss: () => (popover = null) });
		calendar.focus();
	});
	input.addEventListener('input', () => onInput(false));
	wrap.append(input, open);
	return { element: wrap, input, close: () => popover?.close() };
}

type ValueKind = 'text' | 'number' | 'date';

/** Numbers are typed as shown: a percent column takes 25 for 0.25. */
function numberScale(def: ColumnFilterDef): number {
	return def.format?.format === 'percent' ? 100 : 1;
}

const toShown = (n: number, scale: number) => String(scale === 1 ? n : Math.round(n * scale * 1e6) / 1e6);

/** The value inputs for an operator: none, one, or two (between). */
/** A relative date: an amount and a unit (in the last / next N days, weeks…). */
function relativeAmountInputs(first: DateFilterCondition | null, onInput: (immediate: boolean) => void) {
	const amount = el('input', 'og-flt-input');
	amount.type = 'text';
	amount.inputMode = 'numeric';
	amount.setAttribute('data-numeric', '');
	amount.setAttribute('aria-label', 'How many');
	amount.value = String(first?.amount ?? 7);
	amount.addEventListener('input', () => onInput(false));
	const unit = el('select', 'og-flt-input og-flt-select');
	unit.setAttribute('aria-label', 'Unit');
	for (const u of RELATIVE_DATE_UNITS) unit.appendChild(new Option(u.plural, u.value));
	unit.value = first?.unit ?? 'day';
	unit.addEventListener('change', () => onInput(true));
	const amountField = el('div', 'og-flt-field og-flt-amount');
	amountField.appendChild(amount);
	const unitField = el('div', 'og-flt-field');
	unitField.appendChild(unit);
	return { fields: [amountField, unitField], inputs: [amount, unit] };
}

/** A named period: chips in the full editor, a select in the compact one. */
function periodInput(first: DateFilterCondition | null, compact: boolean, onInput: (immediate: boolean) => void) {
	if (compact) {
		const select = el('select', 'og-flt-input og-flt-select');
		select.setAttribute('aria-label', 'Period');
		select.appendChild(new Option('Pick…', ''));
		for (const p of DATE_PERIODS) select.appendChild(new Option(p.label, p.value));
		select.value = first?.period ?? '';
		select.addEventListener('change', () => onInput(true));
		const field = el('div', 'og-flt-field');
		field.appendChild(select);
		return { element: field, input: select as HTMLInputElement | HTMLSelectElement };
	}
	const chosen = el('input');
	chosen.type = 'hidden';
	chosen.value = first?.period ?? '';
	const grid = el('div', 'og-flt-periods');
	grid.setAttribute('role', 'radiogroup');
	grid.setAttribute('aria-label', 'Period');
	for (const p of DATE_PERIODS) {
		const chip = button('og-flt-period', p.label, () => {
			chosen.value = chosen.value === p.value ? '' : p.value;
			for (const other of grid.querySelectorAll('.og-flt-period'))
				other.setAttribute('aria-checked', String(other === chip && chosen.value !== ''));
			onInput(true);
		});
		chip.setAttribute('role', 'radio');
		chip.setAttribute('aria-checked', String(chosen.value === p.value));
		grid.appendChild(chip);
	}
	grid.appendChild(chosen);
	return { element: grid, input: chosen as HTMLInputElement | HTMLSelectElement };
}

function valueInputs(
	kind: ValueKind,
	def: ColumnFilterDef,
	condition: FilterCondition | null,
	onInput: (immediate: boolean) => void,
	compact = false
) {
	const box = el('div', 'og-flt-values');
	let inputs: (HTMLInputElement | HTMLSelectElement)[] = [];
	const closers: (() => void)[] = [];
	const first = condition && condition.type === kind ? condition : null;
	const initial = (i: number): string => {
		if (!first) return '';
		if (first.type === 'date') return (i === 0 ? first.dateFrom : first.dateTo) ?? '';
		if (first.type === 'number') {
			const n = i === 0 ? first.value : first.valueTo;
			return n === undefined || !Number.isFinite(n) ? '' : toShown(n, numberScale(def));
		}
		if (first.type === 'text') return first.value ?? '';
		return '';
	};
	const build = (op: string) => {
		box.textContent = '';
		inputs = [];
		closers.length = 0;
		const meta = getOpMeta(kind, op);
		if (meta.noValue) return;
		const relativeFirst = first?.type === 'date' && first.operator === op ? first : null;
		if (meta.relative === 'amount') {
			const relative = relativeAmountInputs(relativeFirst, onInput);
			box.append(...relative.fields);
			inputs = relative.inputs;
			return;
		}
		if (meta.relative === 'period') {
			const period = periodInput(relativeFirst, compact, onInput);
			box.appendChild(period.element);
			box.toggleAttribute('data-wrap', !compact);
			inputs = [period.input];
			return;
		}
		const count = meta.range ? 2 : 1;
		for (let i = 0; i < count; i++) {
			if (i === 1) box.appendChild(el('span', 'og-flt-dash', '–'));
			if (kind === 'date') {
				const field = dateInput(initial(i), i === 0 ? (meta.range ? 'From' : 'YYYY-MM-DD') : 'To', onInput);
				box.appendChild(field.element);
				inputs.push(field.input);
				closers.push(field.close);
			} else {
				const input = el('input', 'og-flt-input');
				input.type = 'text';
				if (kind === 'number') {
					input.inputMode = 'decimal';
					input.setAttribute('data-numeric', '');
					input.placeholder = (meta.range ? (i === 0 ? 'Min' : 'Max') : 'Value') + (numberScale(def) === 100 ? ' %' : '');
				} else input.placeholder = 'Value…';
				input.value = initial(i);
				input.addEventListener('input', () => onInput(false));
				const field = el('div', 'og-flt-field');
				field.appendChild(input);
				box.appendChild(field);
				inputs.push(input);
			}
		}
	};
	return {
		element: box,
		build,
		values: () => inputs.map((input) => input.value.trim()),
		focus: () => inputs[0]?.focus({ preventScroll: true }),
		close: () => closers.forEach((close) => close()),
	};
}

function buildCondition(kind: ValueKind, op: string, values: string[], def: ColumnFilterDef): FilterCondition | null {
	const meta = getOpMeta(kind, op);
	if (kind === 'text') {
		if (meta.noValue) return { type: 'text', operator: op as 'blank', value: '' };
		return values[0] ? { type: 'text', operator: op as 'contains', value: values[0] } : null;
	}
	if (kind === 'number') {
		if (meta.noValue) return { type: 'number', operator: op as 'blank', value: 0 };
		const scale = numberScale(def);
		const read = (text: string) => Number(text.replace(/[,\s%]/g, '')) / scale;
		const a = values[0] === '' ? NaN : read(values[0]);
		const b = values[1] === undefined || values[1] === '' ? undefined : read(values[1]);
		if (Number.isNaN(a) && !(meta.range && b !== undefined)) return null;
		if (meta.range) return { type: 'number', operator: 'inRange', value: Number.isNaN(a) ? (def.min ?? -Infinity) : a, valueTo: b };
		return { type: 'number', operator: op as 'equals', value: a };
	}
	if (meta.noValue) return { type: 'date', operator: op as 'blank', dateFrom: '' };
	if (meta.relative === 'amount') {
		const amount = Number(values[0]);
		if (!Number.isFinite(amount) || amount < 1) return null;
		return { type: 'date', operator: op as 'inLast', dateFrom: '', amount: Math.floor(amount), unit: values[1] as RelativeDateUnit };
	}
	if (meta.relative === 'period') return values[0] ? { type: 'date', operator: 'period', dateFrom: '', period: values[0] as DatePeriod } : null;
	const from = parseCellDate(values[0]);
	if (!from) return null;
	const to = meta.range && values[1] ? parseCellDate(values[1]) : null;
	return { type: 'date', operator: op as 'equals', dateFrom: toIsoDay(from), dateTo: to ? toIsoDay(to) : undefined };
}

// ─── Text, number, date ───────────────────────────────────────────────────────

/** One condition: operator and value inputs. */
function conditionRow(
	kind: ValueKind,
	def: ColumnFilterDef,
	condition: FilterCondition | null,
	compact: boolean,
	onInput: (immediate: boolean) => void
) {
	const ops = getOpsForType(kind, def);
	const startOp = condition && condition.type === kind && 'operator' in condition ? condition.operator : defaultOpForType(kind, def);
	const row = el('div', 'og-flt-row');
	const inputs = valueInputs(kind, def, condition, onInput, compact);
	const picker = operatorPicker(ops, startOp, compact, (op) => {
		inputs.build(op);
		onInput(true);
		inputs.focus();
	});
	inputs.build(startOp);
	row.append(picker.element, inputs.element);
	return {
		element: row,
		condition: () => buildCondition(kind, picker.value, inputs.values(), def),
		focus: () => inputs.focus(),
		close() {
			picker.close();
			inputs.close();
		},
	};
}

function createConditionEditor(kind: ValueKind): DomFilterEditor {
	return {
		mount(container, params) {
			const compact = params.surface === 'floating';
			const root = el('div', compact ? 'og-flt og-flt-compact' : 'og-flt');
			const existing = params.filter;
			const firstCondition = existing?.type === 'compound' ? existing.conditions[0] : existing;
			const secondCondition = existing?.type === 'compound' ? existing.conditions[1] : null;
			const typing = debouncer(TYPING_DEBOUNCE_MS);
			let joiner: 'AND' | 'OR' = existing?.type === 'compound' ? existing.operator : 'AND';

			const emit = () => {
				typing.cancel();
				const a = first.condition();
				const b = second?.condition() ?? null;
				params.onChange(a && b ? { type: 'compound', operator: joiner, conditions: [a, b] } : (a ?? b));
			};
			const onInput = (immediate: boolean) => (immediate ? emit() : typing.run(emit));

			const first = conditionRow(kind, params.filterDef, firstCondition, compact, onInput);
			root.appendChild(first.element);

			let second: ReturnType<typeof conditionRow> | null = null;
			if (!compact) {
				const more = el('div', 'og-flt-more');
				const addSecond = (condition: FilterCondition | null) => {
					more.textContent = '';
					const join = segmented(
						[
							{ value: 'AND', label: 'And' },
							{ value: 'OR', label: 'Or' },
						],
						joiner,
						(value) => {
							joiner = value as 'AND' | 'OR';
							emit();
						},
						true
					);
					const remove = button('og-flt-link', 'Remove', () => {
						second?.close();
						second = null;
						more.textContent = '';
						more.appendChild(add);
						emit();
					});
					const head = el('div', 'og-flt-join');
					head.append(join.element, remove);
					second = conditionRow(kind, params.filterDef, condition, false, onInput);
					more.append(head, second.element);
					return second;
				};
				const add = button('og-flt-link', '+ Add condition', () => addSecond(null).focus());
				if (secondCondition) addSecond(secondCondition);
				else more.appendChild(add);
				root.appendChild(more);
			}

			root.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
					event.preventDefault();
					emit();
					params.onClose?.();
				}
			});
			container.appendChild(root);
			return {
				focus: () => first.focus(),
				destroy() {
					typing.cancel();
					first.close();
					second?.close();
				},
			};
		},
	};
}

// ─── Stars (rating) ───────────────────────────────────────────────────────────

const starsEditor: DomFilterEditor = {
	mount(container, params) {
		const max = params.filterDef.stars ?? 5;
		const current = params.filter?.type === 'number' && params.filter.operator === 'gte' ? params.filter.value : 0;
		const root = el('div', params.surface === 'floating' ? 'og-flt og-flt-compact' : 'og-flt');
		const row = el('div', 'og-flt-stars');
		if (params.surface !== 'floating') row.appendChild(el('span', 'og-flt-hint', 'At least'));
		const stars: HTMLButtonElement[] = [];
		const draw = (n: number) => stars.forEach((star, i) => star.toggleAttribute('data-on', i < n));
		for (let i = 1; i <= max; i++) {
			const star = el('button', 'og-flt-star');
			star.type = 'button';
			star.title = `${i} or more`;
			star.innerHTML = cellIconSvg('star', 16, true);
			star.addEventListener('mousedown', (event) => event.preventDefault());
			star.addEventListener('mouseenter', () => draw(i));
			star.addEventListener('click', () => {
				const value = params.filter?.type === 'number' && params.filter.value === i ? 0 : i;
				params.onChange(value ? { type: 'number', operator: 'gte', value } : null);
			});
			stars.push(star);
			row.appendChild(star);
		}
		row.addEventListener('mouseleave', () => draw(current));
		draw(current);
		root.appendChild(row);
		container.appendChild(root);
		return { focus: () => stars[0]?.focus({ preventScroll: true }) };
	},
};

// ─── Boolean ──────────────────────────────────────────────────────────────────

const booleanEditor: DomFilterEditor = {
	mount(container, params) {
		const root = el('div', params.surface === 'floating' ? 'og-flt og-flt-compact' : 'og-flt');
		const current = params.filter?.type === 'boolean' ? (params.filter.value ? 'yes' : 'no') : 'all';
		const control = segmented(
			[
				{ value: 'all', label: 'All' },
				{ value: 'yes', label: 'Yes' },
				{ value: 'no', label: 'No' },
			],
			current,
			(value) => params.onChange(value === 'all' ? null : { type: 'boolean', value: value === 'yes' }),
			params.surface === 'floating'
		);
		root.appendChild(control.element);
		container.appendChild(root);
		return { focus: () => (control.element.querySelector('[aria-checked=true]') as HTMLElement | null)?.focus({ preventScroll: true }) };
	},
};

// ─── Select (and list cells, colour swatches) ─────────────────────────────────

/** The column's choices: a store from its options or loader, else its distinct values. */
function storeFor(def: ColumnFilterDef, params: DomFilterEditorParams): { store: CellOptionsStore; counts: Map<string, number>; hasBlank: boolean } {
	const counts = new Map<string, number>();
	let hasBlank = false;
	const distinct = params.distinctValues?.();
	distinct?.values.forEach((value, i) => {
		if (value === null) hasBlank = true;
		const key = value === null ? BLANK : String(value);
		if (distinct.counts) counts.set(key, distinct.counts[i]);
	});
	if (isCellOptionsStore(def.options)) return { store: def.options, counts, hasBlank };
	if (def.options || def.loadOptions) {
		return {
			store: createCellOptionsStore(def.options ?? [], {
				loadOptions: def.loadOptions,
				resolveOptions: def.resolveOptions,
				pageSize: def.pageSize,
				debounceMs: def.debounceMs,
				minQueryLength: def.minQueryLength,
			}),
			counts,
			hasBlank,
		};
	}
	const options: CellOption[] = (distinct?.values ?? []).filter((v): v is string | number => v !== null).map((v) => ({ value: String(v) }));
	return { store: createCellOptionsStore(options), counts, hasBlank };
}

function selectCondition(values: string[], store: CellOptionsStore, mode: 'any' | 'all' | 'none'): SelectFilterCondition | null {
	if (values.length === 0) return null;
	const real = values.map((v) => (v === BLANK ? null : v));
	const labels = real.map((v) => {
		if (v === null) return '(Blanks)';
		const option = store.get(v);
		return option ? optionLabel(option) : v;
	});
	return { type: 'select', values: real, labels, ...(mode !== 'any' ? { matchMode: mode } : {}) };
}

function selectedOf(filter: ColumnFilter | null): { values: string[]; mode: 'any' | 'all' | 'none' } {
	if (filter?.type !== 'select') return { values: [], mode: 'any' };
	return { values: filter.values.map((v) => (v === null ? BLANK : String(v))), mode: filter.matchMode ?? 'any' };
}

const selectListEditor: DomFilterEditor = {
	mount(container, params) {
		const def = params.filterDef;
		const { store, counts, hasBlank } = storeFor(def, params);
		const multiple = def.multiple ?? true;
		const initial = selectedOf(params.filter);
		let mode = initial.mode;
		let chosen = initial.values;
		const root = el('div', 'og-flt og-flt-select');
		const emit = () => params.onChange(selectCondition(chosen, store, mode));

		const toolbar = el('div', 'og-flt-toolbar');
		if (def.listValues && multiple) {
			const modes = segmented(
				[
					{ value: 'any', label: 'Any of' },
					{ value: 'all', label: 'All of' },
					{ value: 'none', label: 'None of' },
				],
				mode,
				(value) => {
					mode = value as typeof mode;
					emit();
				},
				true
			);
			toolbar.appendChild(modes.element);
		}
		const showCounts = def.showCounts ?? true;
		const options = store.fetch ? store.options : hasBlank ? [{ value: BLANK, label: '(Blanks)' }, ...store.options] : store.options;
		const listbox = createCellListbox({
			options,
			selected: chosen,
			multiple,
			searchable: def.searchable,
			searchPlaceholder: def.placeholder ?? 'Search…',
			emptyText: def.emptyText,
			debounceMs: store.debounceMs,
			minQueryLength: store.minQueryLength,
			load: store.fetch
				? (search, offset, signal) => store.fetch!({ search, offset, limit: store.pageSize, signal, colField: params.colField })
				: undefined,
			trailing:
				showCounts && counts.size > 0
					? (option) => (counts.has(option.value) ? counts.get(option.value)!.toLocaleString() : null)
					: undefined,
			onChange: (values) => {
				chosen = values;
				emit();
			},
			onSelect: (value) => {
				chosen = value === null ? [] : [value];
				emit();
				params.onClose?.();
			},
		});
		if (multiple) {
			const actions = el('div', 'og-flt-actions');
			actions.append(
				button('og-flt-link', 'Select all', () => {
					chosen = [...new Set([...chosen, ...listbox.visibleValues()])];
					listbox.setSelected(chosen);
					emit();
				}),
				button('og-flt-link', 'Clear', () => {
					chosen = [];
					listbox.setSelected(chosen);
					emit();
				})
			);
			toolbar.appendChild(actions);
		}
		root.append(listbox.element, toolbar);
		// Values chosen earlier that the store has not seen yet get their labels.
		store.ensure(chosen.filter((v) => v !== BLANK));
		container.appendChild(root);
		return { focus: () => listbox.focus(), destroy: () => listbox.destroy() };
	},
};

const swatchEditor: DomFilterEditor = {
	mount(container, params) {
		const distinct = params.distinctValues?.();
		const colours = [...new Set((distinct?.values ?? []).map((v) => normalizeHexColor(v)).filter((v): v is string => !!v))];
		let chosen = new Set(selectedOf(params.filter).values.map((v) => normalizeHexColor(v) ?? v));
		const root = el('div', 'og-flt og-flt-swatches');
		const grid = el('div', 'og-ct-swatches');
		for (const colour of colours) {
			const swatch = el('button', 'og-ct-swatch-button');
			swatch.type = 'button';
			swatch.style.background = colour;
			swatch.title = colour.toUpperCase();
			swatch.setAttribute('aria-selected', String(chosen.has(colour)));
			swatch.addEventListener('mousedown', (event) => event.preventDefault());
			swatch.addEventListener('click', () => {
				if (chosen.has(colour)) chosen.delete(colour);
				else chosen.add(colour);
				swatch.setAttribute('aria-selected', String(chosen.has(colour)));
				const values = [...chosen];
				params.onChange(values.length ? { type: 'select', values, labels: values.map((v) => v.toUpperCase()) } : null);
			});
			grid.appendChild(swatch);
		}
		if (colours.length === 0) grid.appendChild(el('div', 'og-ct-list-empty', 'No colours yet.'));
		root.appendChild(grid);
		root.appendChild(
			button('og-flt-link', 'Clear', () => {
				chosen = new Set();
				grid.querySelectorAll('[aria-selected]').forEach((s) => s.setAttribute('aria-selected', 'false'));
				params.onChange(null);
			})
		);
		container.appendChild(root);
		return {};
	},
};

// ─── Date range ───────────────────────────────────────────────────────────────

const dateRangeEditor: DomFilterEditor = {
	mount(container, params) {
		const compact = params.surface === 'floating';
		const existing = params.filter?.type === 'dateRange' ? params.filter : null;
		const root = el('div', compact ? 'og-flt og-flt-compact' : 'og-flt');
		const row = el('div', 'og-flt-row');
		const box = el('div', 'og-flt-values');
		let from: ReturnType<typeof dateInput> | null = null;
		let to: ReturnType<typeof dateInput> | null = null;
		const typing = debouncer(TYPING_DEBOUNCE_MS);
		const emit = () => {
			typing.cancel();
			const a = parseCellDate(from?.input.value);
			const b = to ? parseCellDate(to.input.value) : null;
			const operator = picker.value as 'overlaps' | 'within' | 'contains';
			if (!a || (operator !== 'contains' && !b)) {
				if (!from?.input.value && !to?.input.value) params.onChange(null);
				return;
			}
			params.onChange({ type: 'dateRange', operator, dateFrom: toIsoDay(a), dateTo: b && operator !== 'contains' ? toIsoDay(b) : undefined });
		};
		const onInput = (immediate: boolean) => (immediate ? emit() : typing.run(emit));
		const build = (op: string) => {
			box.textContent = '';
			from = dateInput(existing?.dateFrom ?? '', op === 'contains' ? 'Date' : 'From', onInput);
			box.appendChild(from.element);
			to = null;
			if (op !== 'contains') {
				box.appendChild(el('span', 'og-flt-dash', '–'));
				to = dateInput(existing?.dateTo ?? '', 'To', onInput);
				box.appendChild(to.element);
			}
		};
		const picker = operatorPicker(getOpsForType('dateRange', params.filterDef), existing?.operator ?? 'overlaps', compact, (op) => {
			build(op);
			emit();
		});
		build(picker.value);
		row.append(picker.element, box);
		root.appendChild(row);
		root.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
				event.preventDefault();
				emit();
				params.onClose?.();
			}
		});
		container.appendChild(root);
		return {
			focus: () => from?.input.focus({ preventScroll: true }),
			destroy() {
				typing.cancel();
				picker.close();
				from?.close();
				to?.close();
			},
		};
	},
};

// ─── Path (cascading select) ──────────────────────────────────────────────────

const KEY = '\u0000';

function cascadeStoreOf(def: ColumnFilterDef): CascadeStore {
	const cascade = def.cascade;
	if (cascade && 'config' in cascade) return cascade;
	return createCascadeStore(cascade ?? {});
}

/** A tree checklist: ticking a node chooses everything under it. Levels load as they open. */
const pathEditor: DomFilterEditor = {
	mount(container, params) {
		const store = cascadeStoreOf(params.filterDef);
		const chosen = new Map<string, string[]>();
		if (params.filter?.type === 'path') for (const path of params.filter.paths) chosen.set(path.join(KEY), path);
		const open = new Set<string>();
		const loading = new Set<string>();
		const root = el('div', 'og-flt og-flt-tree');
		const search = el('div', 'og-ct-search');
		search.innerHTML = cellIconSvg('search', 15);
		const input = el('input');
		input.type = 'text';
		input.placeholder = params.filterDef.placeholder ?? 'Search…';
		search.appendChild(input);
		const tree = el('div', 'og-ct-list og-flt-tree-list');
		tree.setAttribute('role', 'tree');
		root.append(search, tree);

		const labelOf = (path: string[]) =>
			path.map((v, i) => {
				const node = store.node(path.slice(0, i + 1));
				return node ? optionLabel(node) : v;
			});
		const emit = () => {
			const paths = [...chosen.values()];
			params.onChange(paths.length ? { type: 'path', paths, labels: paths.map((p) => labelOf(p).join(' › ')) } : null);
		};
		// A node is covered when it or an ancestor is chosen.
		const covered = (path: string[]) => path.some((_, i) => chosen.has(path.slice(0, i + 1).join(KEY)));
		const toggle = (path: string[]) => {
			const key = path.join(KEY);
			if (chosen.has(key)) chosen.delete(key);
			else {
				// Choosing a node replaces choices beneath it.
				for (const k of [...chosen.keys()]) if (k.startsWith(key + KEY)) chosen.delete(k);
				chosen.set(key, path);
			}
			emit();
			render();
		};
		const ensure = (path: string[]) => {
			const key = path.join(KEY);
			if (store.children(path) || loading.has(key)) return;
			loading.add(key);
			store.loadChildren(path, new AbortController().signal).finally(() => {
				loading.delete(key);
				render();
			});
		};
		const row = (option: CascadeOption, path: string[], depth: number) => {
			const key = path.join(KEY);
			const leaf = store.isLeaf(path);
			const item = el('div', 'og-ct-option og-flt-tree-row');
			item.setAttribute('role', 'treeitem');
			item.style.paddingLeft = `${8 + depth * 16}px`;
			const caret = el('span', 'og-flt-caret');
			if (!leaf) {
				caret.innerHTML = cellIconSvg(open.has(key) ? 'chevronDown' : 'chevronRight', 13);
				caret.addEventListener('mousedown', (event) => event.preventDefault());
				caret.addEventListener('click', (event) => {
					event.stopPropagation();
					if (open.has(key)) open.delete(key);
					else {
						open.add(key);
						ensure(path);
					}
					render();
				});
				item.setAttribute('aria-expanded', String(open.has(key)));
			}
			const box = el('span', 'og-ct-checkbox');
			box.innerHTML = cellIconSvg('check', 12);
			const on = covered(path);
			if (on) box.setAttribute('data-checked', '');
			// An ancestor's choice covers this node: shown, not separately toggleable.
			const inherited = on && !chosen.has(key);
			if (inherited) item.setAttribute('aria-disabled', 'true');
			else if (!on && [...chosen.keys()].some((k) => k.startsWith(key + KEY))) box.setAttribute('data-partial', '');
			const label = el('span', 'og-ct-option-label', optionLabel(option));
			item.append(caret, box, label);
			item.addEventListener('mousedown', (event) => event.preventDefault());
			item.addEventListener('click', () => !inherited && toggle(path));
			return item;
		};
		function renderLevel(parent: string[], depth: number) {
			const list = store.children(parent);
			if (!list) {
				ensure(parent);
				const status = el('div', 'og-ct-list-status');
				status.style.paddingLeft = `${8 + depth * 16}px`;
				status.innerHTML = '<span class="og-ct-spinner" aria-hidden="true"></span>';
				status.append('Loading…');
				tree.appendChild(status);
				return;
			}
			for (const option of list) {
				const path = [...parent, option.value];
				tree.appendChild(row(option, path, depth));
				if (open.has(path.join(KEY)) && !store.isLeaf(path)) renderLevel(path, depth + 1);
			}
		}
		function render() {
			tree.textContent = '';
			const q = input.value.trim().toLowerCase();
			if (!q) {
				renderLevel([], 0);
				return;
			}
			// Search: every known node whose label matches, shown with its path.
			const hits: { option: CascadeOption; path: string[] }[] = [];
			const walk = (parent: string[]) => {
				for (const option of store.children(parent) ?? []) {
					const path = [...parent, option.value];
					if (optionLabel(option).toLowerCase().includes(q)) hits.push({ option, path });
					if (!store.isLeaf(path)) walk(path);
				}
			};
			walk([]);
			for (const { option, path } of hits.slice(0, 200)) {
				const item = row({ ...option, label: labelOf(path).join(' › ') }, path, 0);
				tree.appendChild(item);
			}
			if (hits.length === 0) tree.appendChild(el('div', 'og-ct-list-empty', 'No results found.'));
		}
		input.addEventListener('input', render);
		// Open the levels down to each chosen path.
		for (const path of chosen.values()) for (let i = 1; i < path.length; i++) open.add(path.slice(0, i).join(KEY));
		render();
		container.appendChild(root);
		return { focus: () => input.focus({ preventScroll: true }) };
	},
};

// ─── Custom ───────────────────────────────────────────────────────────────────

/** Hosts a custom filter: a DOM editor, or an adapter component through the host's bridge. */
function customEditor(def: ColumnFilterDef, mountAdapter?: AdapterFilterMount): DomFilterEditor {
	return {
		mount(container, params) {
			if (def.editor) return def.editor.mount(container, params);
			if (def.renderFilter && mountAdapter) {
				const unmount = mountAdapter(container, def.renderFilter, params);
				return { destroy: unmount };
			}
			container.appendChild(el('div', 'og-ct-list-empty', 'This filter needs an editor.'));
			return {};
		},
	};
}

/** Renders an adapter component (a React `renderFilter`) into a container; returns its unmount. */
export type AdapterFilterMount = (
	container: HTMLElement,
	render: (params: DomFilterEditorParams) => unknown,
	params: DomFilterEditorParams
) => () => void;

// ─── Compact summary (popover kinds in the floating row) ──────────────────────

/** A chip showing the filter (or “All”) that opens the full editor in a popover. */
function summaryChip(full: DomFilterEditor): DomFilterEditor {
	return {
		mount(container, params) {
			const chip = el('button', 'og-flt-chip');
			chip.type = 'button';
			const draw = (filter: ColumnFilter | null) => {
				chip.textContent = '';
				chip.toggleAttribute('data-active', !!filter);
				chip.append(el('span', 'og-flt-chip-text', filter ? summarizeFilter(filter, params.filterDef) : 'All'));
				chip.appendChild(createCellIcon('chevronDown', 12, 'og-ct-chevron'));
			};
			draw(params.filter);
			let current = params.filter;
			let popover: CellPopover | null = null;
			let handle: DomFilterEditorHandle | null = null;
			const close = () => {
				handle?.destroy?.();
				handle = null;
				popover?.close();
				popover = null;
			};
			chip.addEventListener('mousedown', (event) => event.preventDefault());
			chip.addEventListener('click', () => {
				if (popover) return close();
				const content = el('div', 'og-flt-popover-body');
				popover = openCellPopover({
					anchor: chip,
					content,
					label: 'Filter',
					onDismiss: () => (handle?.destroy?.(), (handle = null), (popover = null)),
				});
				handle = full.mount(content, {
					...params,
					filter: current,
					surface: 'popover',
					onChange: (filter) => {
						current = filter;
						draw(filter);
						params.onChange(filter);
						popover?.reposition();
					},
					onClose: close,
				});
				handle.focus?.();
			});
			container.appendChild(chip);
			return { focus: () => chip.focus({ preventScroll: true }), destroy: close };
		},
	};
}

// ─── Resolution ───────────────────────────────────────────────────────────────

const textEditor = createConditionEditor('text');
const numberEditor = createConditionEditor('number');
const dateEditor = createConditionEditor('date');

/**
 * The filter editor for a definition and surface. Compact surfaces (the floating row) get inline
 * editors for typed values and a summary chip opening the full editor for lists, trees and ranges.
 */
export function createFilterEditor(
	def: ColumnFilterDef,
	surface: DomFilterEditorParams['surface'],
	mountAdapter?: AdapterFilterMount
): DomFilterEditor {
	let full: DomFilterEditor;
	let inline = false;
	switch (def.type) {
		case 'number':
			full = def.stars ? starsEditor : numberEditor;
			inline = true;
			break;
		case 'date':
			full = dateEditor;
			inline = true;
			break;
		case 'boolean':
			full = booleanEditor;
			inline = true;
			break;
		case 'select':
			full = def.swatches ? swatchEditor : selectListEditor;
			break;
		case 'dateRange':
			full = dateRangeEditor;
			break;
		case 'path':
			full = pathEditor;
			break;
		case 'custom':
			full = customEditor(def, mountAdapter);
			break;
		default:
			full = textEditor;
			inline = true;
	}
	return surface === 'floating' && !inline ? summaryChip(full) : full;
}
