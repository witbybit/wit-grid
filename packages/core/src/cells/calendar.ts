import { cellIconSvg } from './icons.js';

export interface CellCalendarOptions {
	value: Date | null;
	/** 0 Sunday … 6 Saturday. Default 1. */
	weekStartsOn?: number;
	locale?: string;
	onSelect: (date: Date) => void;
	/** Shows a Clear button. */
	onClear?: () => void;
}

export interface CellCalendar {
	readonly element: HTMLDivElement;
	focus(): void;
	/** Show and highlight a date (typed into the editor's field). */
	setValue(date: Date | null): void;
}

function sameDay(a: Date | null, b: Date | null): boolean {
	return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Same day-of-month in another month, clamped to that month's length. */
function addMonths(date: Date, months: number): Date {
	const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
	const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
}

/**
 * A month grid date picker: arrows move by day / week, PageUp / PageDown by month (with Shift by
 * year), Home / End to the week's ends, Enter picks. Today is outlined, the value filled.
 */
export function createCellCalendar(config: CellCalendarOptions): CellCalendar {
	const weekStartsOn = config.weekStartsOn ?? 1;
	const element = document.createElement('div');
	element.className = 'og-ct-calendar';

	const head = document.createElement('div');
	head.className = 'og-ct-cal-head';
	const navButton = (icon: 'chevronLeft' | 'chevronRight', label: string) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'og-ct-cal-nav';
		button.setAttribute('aria-label', label);
		button.innerHTML = cellIconSvg(icon, 15);
		button.addEventListener('mousedown', (event) => event.preventDefault());
		return button;
	};
	const prev = navButton('chevronLeft', 'Previous month');
	const next = navButton('chevronRight', 'Next month');
	const title = document.createElement('div');
	title.setAttribute('aria-live', 'polite');
	head.append(prev, title, next);

	const grid = document.createElement('div');
	grid.className = 'og-ct-cal-grid';
	grid.setAttribute('role', 'grid');
	grid.tabIndex = 0;
	element.append(head, grid);

	const foot = document.createElement('div');
	foot.className = 'og-ct-cal-foot';
	const today = document.createElement('button');
	today.type = 'button';
	today.className = 'og-ct-btn';
	today.textContent = 'Today';
	foot.appendChild(today);
	if (config.onClear) {
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'og-ct-btn';
		clear.setAttribute('data-ghost', '');
		clear.textContent = 'Clear';
		clear.addEventListener('click', () => config.onClear!());
		foot.appendChild(clear);
	}
	element.appendChild(foot);

	const monthTitle = new Intl.DateTimeFormat(config.locale, { month: 'long', year: 'numeric' });
	const dayLabel = new Intl.DateTimeFormat(config.locale, { dateStyle: 'full' });
	const weekday = new Intl.DateTimeFormat(config.locale, { weekday: 'short' });

	let value = config.value;
	let cursor = value ?? new Date();

	function render() {
		title.textContent = monthTitle.format(cursor);
		grid.textContent = '';
		// Weekday headers from a known week (2024-01-07 was a Sunday).
		for (let i = 0; i < 7; i++) {
			const dow = document.createElement('div');
			dow.className = 'og-ct-cal-dow';
			dow.textContent = weekday.format(new Date(2024, 0, 7 + ((weekStartsOn + i) % 7))).slice(0, 2);
			grid.appendChild(dow);
		}
		const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
		const start = addDays(first, -((first.getDay() - weekStartsOn + 7) % 7));
		const now = new Date();
		for (let i = 0; i < 42; i++) {
			const date = addDays(start, i);
			const day = document.createElement('button');
			day.type = 'button';
			day.tabIndex = -1;
			day.className = 'og-ct-cal-day';
			day.textContent = String(date.getDate());
			day.setAttribute('aria-label', dayLabel.format(date));
			day.setAttribute('aria-selected', String(sameDay(date, value)));
			if (date.getMonth() !== cursor.getMonth()) day.setAttribute('data-outside', '');
			if (sameDay(date, now)) day.setAttribute('data-today', '');
			if (sameDay(date, cursor)) day.setAttribute('data-active', '');
			day.addEventListener('mousedown', (event) => event.preventDefault());
			day.addEventListener('click', () => config.onSelect(date));
			grid.appendChild(day);
		}
	}

	prev.addEventListener('click', () => {
		cursor = addMonths(cursor, -1);
		render();
	});
	next.addEventListener('click', () => {
		cursor = addMonths(cursor, 1);
		render();
	});
	today.addEventListener('click', () => config.onSelect(new Date()));

	grid.addEventListener('keydown', (event) => {
		let moved: Date | null = null;
		switch (event.key) {
			case 'ArrowLeft':
				moved = addDays(cursor, -1);
				break;
			case 'ArrowRight':
				moved = addDays(cursor, 1);
				break;
			case 'ArrowUp':
				moved = addDays(cursor, -7);
				break;
			case 'ArrowDown':
				moved = addDays(cursor, 7);
				break;
			case 'PageUp':
				moved = addMonths(cursor, event.shiftKey ? -12 : -1);
				break;
			case 'PageDown':
				moved = addMonths(cursor, event.shiftKey ? 12 : 1);
				break;
			case 'Home':
				moved = addDays(cursor, -((cursor.getDay() - weekStartsOn + 7) % 7));
				break;
			case 'End':
				moved = addDays(cursor, 6 - ((cursor.getDay() - weekStartsOn + 7) % 7));
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				event.stopPropagation();
				config.onSelect(cursor);
				return;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		cursor = moved;
		render();
	});

	render();
	return {
		element,
		focus: () => grid.focus({ preventScroll: true }),
		setValue(date) {
			value = date;
			if (date) cursor = date;
			render();
		},
	};
}
