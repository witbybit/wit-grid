import { icon } from './icons.js';
import { h } from './ui.js';
import type { WorkspaceCommand } from './viewTypes.js';

/** Fuzzy score: every query character in order, rewarding word starts and runs. -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
	if (!query) return 0;
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	let score = 0;
	let ti = 0;
	let run = 0;
	for (const ch of q) {
		if (ch === ' ') continue;
		const found = t.indexOf(ch, ti);
		if (found < 0) return -1;
		const wordStart = found === 0 || /[\s\-_/·]/.test(t[found - 1]);
		run = found === ti ? run + 1 : 0;
		score += 1 + (wordStart ? 6 : 0) + run * 2 - Math.min(4, found - ti) * 0.25;
		ti = found + 1;
	}
	return score + (t.startsWith(q) ? 10 : 0);
}

/**
 * Ctrl/⌘+K: every workspace action in one searchable list — views, records, selection, the
 * active view's own commands (zoom, swimlanes, scheduling).
 */
export class CommandPalette {
	private element: HTMLElement | null = null;
	private previous: HTMLElement | null = null;

	constructor(
		private readonly root: HTMLElement,
		private readonly commands: () => WorkspaceCommand[]
	) {}

	isOpen(): boolean {
		return !!this.element;
	}

	open(): void {
		if (this.element) return;
		this.previous = document.activeElement as HTMLElement | null;
		const all = this.commands();
		const input = h('input', 'og-ws-palette-input', {
			type: 'text',
			placeholder: 'Type a command or search…',
			'aria-label': 'Command',
			role: 'combobox',
			'aria-expanded': 'true',
			'aria-controls': 'og-ws-palette-list',
		});
		const list = h('div', 'og-ws-palette-list', { role: 'listbox', id: 'og-ws-palette-list' });
		const panel = h(
			'div',
			'og-ws-palette',
			{ role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
			h('div', 'og-ws-palette-search', null, icon('search'), input, h('kbd', 'og-ws-kbd', null, 'Esc')),
			list
		);
		const scrim = h('div', 'og-ws-scrim og-ws-scrim-top', null, panel);
		let matches: WorkspaceCommand[] = [];
		let active = 0;
		const render = () => {
			const query = input.value.trim();
			matches = all
				.map((command) => ({
					command,
					score: Math.max(fuzzyScore(query, command.label), fuzzyScore(query, `${command.group} ${command.keywords ?? ''}`) - 4),
				}))
				.filter((entry) => entry.score >= 0)
				.sort((a, b) => (query ? b.score - a.score : 0))
				.map((entry) => entry.command)
				.slice(0, 60);
			active = Math.min(active, Math.max(0, matches.length - 1));
			list.replaceChildren();
			let group = '';
			matches.forEach((command, index) => {
				if (!query && command.group !== group) {
					group = command.group;
					list.append(h('div', 'og-ws-palette-group', null, group));
				}
				const item = h(
					'div',
					'og-ws-palette-item',
					{ role: 'option', id: `og-ws-cmd-${index}`, 'aria-selected': String(index === active) },
					command.icon ? icon(command.icon) : h('span', 'og-ws-icon'),
					h('span', 'og-ws-list-label', null, command.label)
				);
				if (query) item.append(h('span', 'og-ws-hint', null, command.group));
				if (command.hint) item.append(h('kbd', 'og-ws-kbd', null, command.hint));
				item.addEventListener('pointerdown', (event) => {
					event.preventDefault();
					run(command);
				});
				item.addEventListener('pointermove', () => {
					if (active === index) return;
					active = index;
					paint();
				});
				list.append(item);
			});
			if (!matches.length) list.append(h('div', 'og-ws-hint og-ws-palette-empty', null, 'No matching commands'));
			paint();
		};
		const paint = () => {
			for (const item of list.querySelectorAll<HTMLElement>('.og-ws-palette-item')) {
				const on = item.id === `og-ws-cmd-${active}`;
				item.setAttribute('aria-selected', String(on));
				if (on) item.scrollIntoView?.({ block: 'nearest' });
			}
			input.setAttribute('aria-activedescendant', `og-ws-cmd-${active}`);
		};
		const run = (command: WorkspaceCommand) => {
			this.close();
			command.run();
		};
		input.addEventListener('input', () => {
			active = 0;
			render();
		});
		input.addEventListener('keydown', (event) => {
			event.stopPropagation();
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
			} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				if (!matches.length) return;
				active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
				paint();
			} else if (event.key === 'Enter') {
				event.preventDefault();
				const command = matches[active];
				if (command) run(command);
			}
		});
		scrim.addEventListener('pointerdown', (event) => {
			if (event.target === scrim) this.close();
		});
		this.root.append(scrim);
		this.element = scrim;
		render();
		input.focus();
	}

	close(): void {
		this.element?.remove();
		this.element = null;
		this.previous?.focus?.({ preventScroll: true });
	}

	destroy(): void {
		this.element?.remove();
		this.element = null;
	}
}
