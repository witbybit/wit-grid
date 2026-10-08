/** Small DOM helpers shared by the built-in sidebar panels. */
import { sidebarIconSvg, type SidebarIconName } from './sidebarIcons.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function icon(name: SidebarIconName, size = 16): HTMLSpanElement {
	const span = el('span', 'og-sb-icon');
	span.innerHTML = sidebarIconSvg(name, size);
	return span;
}

/** A text button (`variant`: ghost, primary, danger). */
export function textButton(label: string, onClick: () => void, variant: 'ghost' | 'primary' | 'subtle' = 'ghost', iconName?: SidebarIconName) {
	const b = el('button', 'og-sb-btn');
	b.type = 'button';
	b.dataset.variant = variant;
	if (iconName) b.appendChild(icon(iconName, 14));
	b.appendChild(el('span', undefined, label));
	b.addEventListener('click', onClick);
	return b;
}

/** A square icon button with an accessible label. */
export function iconButton(name: SidebarIconName, label: string, onClick: (event: MouseEvent) => void, size = 15) {
	const b = el('button', 'og-sb-icon-btn');
	b.type = 'button';
	b.title = label;
	b.setAttribute('aria-label', label);
	b.innerHTML = sidebarIconSvg(name, size);
	b.addEventListener('click', onClick);
	return b;
}

/** An empty state: icon, title and a line of help. */
export function emptyState(iconName: SidebarIconName, title: string, hint?: string): HTMLDivElement {
	const box = el('div', 'og-sb-empty');
	const badge = el('div', 'og-sb-empty-icon');
	badge.appendChild(icon(iconName, 20));
	box.append(badge, el('div', 'og-sb-empty-title', title));
	if (hint) box.appendChild(el('div', 'og-sb-empty-hint', hint));
	return box;
}

/** A search field; `onInput` runs as the user types. */
export function searchField(placeholder: string, onInput: (query: string) => void) {
	const wrap = el('label', 'og-sb-search');
	wrap.appendChild(icon('search', 14));
	const input = el('input');
	input.type = 'search';
	input.placeholder = placeholder;
	input.spellcheck = false;
	input.addEventListener('input', () => onInput(input.value.trim().toLowerCase()));
	wrap.appendChild(input);
	return { element: wrap, input };
}

/** Collects teardown functions. */
export function disposables() {
	const list: (() => void)[] = [];
	return {
		add(fn: () => void) {
			list.push(fn);
		},
		dispose() {
			for (const fn of list.splice(0)) fn();
		},
	};
}

/** A checkbox in the cell editors' style (a button with role="checkbox"). */
export function checkbox(label: string, checked: boolean, onToggle: () => void): HTMLButtonElement {
	const box = el('button', 'og-ct-checkbox og-sb-checkbox');
	box.type = 'button';
	box.setAttribute('role', 'checkbox');
	box.setAttribute('aria-label', label);
	box.setAttribute('aria-checked', String(checked));
	box.toggleAttribute('data-checked', checked);
	box.innerHTML = sidebarIconSvg('check', 12);
	box.addEventListener('click', onToggle);
	return box;
}

/** A labelled switch row. */
export function switchRow(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLButtonElement {
	const row = el('button', 'og-sb-switch-row');
	row.type = 'button';
	row.setAttribute('role', 'switch');
	row.setAttribute('aria-checked', String(checked));
	const control = el('span', 'og-ct-switch');
	control.toggleAttribute('data-checked', checked);
	control.appendChild(el('i'));
	row.append(el('span', 'og-sb-switch-label', label), control);
	row.addEventListener('click', () => onChange(!checked));
	return row;
}
