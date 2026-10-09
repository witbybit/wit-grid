/** Themes: a card per built-in theme with a miniature of the grid in its colours. */
import { BUILT_IN_THEME_METADATA, getBuiltInTheme, type BuiltInThemeName } from '../../renderer/themes.js';
import { disposables, el, icon } from '../panelKit.js';
import type { SidebarPanel } from '../sidebarTypes.js';

function preview(name: BuiltInThemeName): HTMLDivElement {
	const theme = getBuiltInTheme(name);
	const box = el('div', 'og-sb-theme-preview');
	box.style.background = theme.bgColor;
	box.style.borderColor = theme.borderColor;
	const header = el('div', 'og-sb-theme-header');
	header.style.background = theme.headerBg;
	header.style.borderColor = theme.borderColor;
	for (const width of [38, 26, 20]) {
		const bar = el('span');
		bar.style.width = `${width}%`;
		bar.style.background = theme.headerText;
		header.appendChild(bar);
	}
	box.appendChild(header);
	for (let row = 0; row < 3; row++) {
		const line = el('div', 'og-sb-theme-row');
		line.style.borderColor = theme.cellBorder ?? theme.borderColor;
		if (row === 1) {
			line.style.background = theme.selectionBg;
			line.style.boxShadow = `inset 2px 0 0 ${theme.focusRing}`;
		}
		for (const width of [44, 22]) {
			const bar = el('span');
			bar.style.width = `${width}%`;
			bar.style.background = theme.textColor;
			line.appendChild(bar);
		}
		const pill = el('span', 'og-sb-theme-pill');
		pill.style.background = theme.focusRing;
		line.appendChild(pill);
		box.appendChild(line);
	}
	return box;
}

export const themesPanel: SidebarPanel<any> = {
	mount(container, { api }) {
		const d = disposables();
		const grid = el('div', 'og-sb-themes');
		grid.setAttribute('role', 'radiogroup');
		grid.setAttribute('aria-label', 'Theme');
		container.appendChild(grid);
		const cards = new Map<string, HTMLButtonElement>();
		for (const name of api.getAvailableThemes() as BuiltInThemeName[]) {
			const meta = BUILT_IN_THEME_METADATA[name];
			const card = el('button', 'og-sb-theme');
			card.type = 'button';
			card.setAttribute('role', 'radio');
			card.title = meta?.description ?? name;
			const check = el('span', 'og-sb-theme-check');
			check.appendChild(icon('check', 12));
			const caption = el('div', 'og-sb-theme-caption');
			// The name in the theme's own font, the font named under it.
			const label = el('span', 'og-sb-theme-name', meta?.label ?? name);
			label.style.fontFamily = getBuiltInTheme(name).fontFamily;
			caption.append(
				label,
				el('span', 'og-sb-theme-mode', [meta?.appearance === 'light' ? 'Light' : 'Dark', meta?.font].filter(Boolean).join(' · '))
			);
			card.append(preview(name), caption, check);
			card.addEventListener('click', () => api.switchTheme(name));
			grid.appendChild(card);
			cards.set(name, card);
		}
		const sync = () => {
			const active = api.getStateSnapshot().themeName;
			for (const [name, card] of cards) card.setAttribute('aria-checked', String(name === active));
		};
		sync();
		d.add(api.subscribeToKey('themeName', sync));
		return { destroy: () => d.dispose() };
	},
};
