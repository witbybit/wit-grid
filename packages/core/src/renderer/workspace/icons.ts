/** Workspace icons: 24×24, `currentColor` strokes, drawn at 16px by default. */
const PATHS = {
	table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
	gallery:
		'<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
	calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
	kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M5.5 7h1M11.5 7h1M17.5 7h1"/>',
	gantt: '<path d="M3 4v16h18"/><rect x="6" y="6" width="8" height="3" rx="1"/><rect x="10" y="11" width="9" height="3" rx="1"/><rect x="7" y="16" width="6" height="2.5" rx="1"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
	filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
	sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
	group: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/>',
	fields: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="17" r="3"/>',
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
	redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
	close: '<path d="M6 6l12 12M18 6 6 18"/>',
	chevronDown: '<path d="m6 9 6 6 6-6"/>',
	chevronRight: '<path d="m9 6 6 6-6 6"/>',
	chevronLeft: '<path d="m15 6-6 6 6 6"/>',
	link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
	comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>',
	paperclip: '<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
	flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
	diamond: '<path d="M12 3 21 12 12 21 3 12z"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5a6 6 0 1 1-6 6"/>',
	users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
	tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
	dependency:
		'<rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/><path d="M6.5 9v4a4 4 0 0 0 4 4H14"/>',
	alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>',
	blocked: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
	lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	check: '<path d="m5 12 5 5L20 7"/>',
	progress: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/>',
	zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>',
	zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
	today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.6"/>',
	fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
	command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
	history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
	external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
	inspector: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M16.5 8h2M16.5 11h2"/>',
	star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
	sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
	collapse: '<path d="m7 15 5-5 5 5"/>',
	expand: '<path d="m7 9 5 5 5-5"/>',
	drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
	copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
	critical: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
	baseline: '<path d="M3 17h18"/><rect x="5" y="7" width="12" height="5" rx="1.5"/>',
	image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
	send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
	at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
	smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>',
	layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
	resource: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M12 14v3"/>',
	settings:
		'<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
	keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
} as const;

export type WorkspaceIconName = keyof typeof PATHS;

export function iconSvg(name: WorkspaceIconName, size = 16): string {
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

export function icon(name: WorkspaceIconName, size = 16): HTMLElement {
	const span = document.createElement('span');
	span.className = 'og-ws-icon';
	span.innerHTML = iconSvg(name, size);
	return span;
}
