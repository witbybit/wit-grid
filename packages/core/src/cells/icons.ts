/** Small stroke icons (lucide geometry) for cells, editors and popovers. They draw in currentColor. */
const PATHS = {
	check: '<path d="M20 6 9 17l-5-5"/>',
	chevronDown: '<path d="m6 9 6 6 6-6"/>',
	chevronUp: '<path d="m18 15-6-6-6 6"/>',
	chevronLeft: '<path d="m15 18-6-6 6-6"/>',
	chevronRight: '<path d="m9 18 6-6-6-6"/>',
	calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
	clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
	search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
	star: '<path d="M11.5 2.3a.6.6 0 0 1 1 0l2.6 5.4 5.9.9a.6.6 0 0 1 .3 1l-4.3 4.2 1 5.9a.6.6 0 0 1-.8.6L12 17.5l-5.3 2.8a.6.6 0 0 1-.8-.6l1-5.9-4.3-4.2a.6.6 0 0 1 .3-1l5.9-.9z"/>',
	external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
	plus: '<path d="M5 12h14M12 5v14"/>',
	minus: '<path d="M5 12h14"/>',
	user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
	mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
	pipette:
		'<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
	text: '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/>',
} as const;

export type CellIconName = keyof typeof PATHS;

/** SVG markup for an icon; `filled` fills the shape too (a lit star). */
export function cellIconSvg(name: CellIconName, size = 14, filled = false): string {
	const fill = filled ? 'currentColor' : 'none';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** An icon in its own span, ready to append. */
export function createCellIcon(name: CellIconName, size = 14, className = 'og-ct-icon', filled = false): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = className;
	span.innerHTML = cellIconSvg(name, size, filled);
	return span;
}
