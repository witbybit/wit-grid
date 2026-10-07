export type CellPopoverDismissReason = 'outside' | 'escape';

export interface CellPopoverOptions {
	/** What the popover hangs from; clicks on it do not dismiss. */
	anchor: HTMLElement;
	content: HTMLElement;
	/** Called once when the user dismisses it (click outside, Escape). Not called for close(). */
	onDismiss?: (reason: CellPopoverDismissReason) => void;
	/** At least as wide as the anchor (selects); else its content width. */
	matchAnchorWidth?: boolean;
	className?: string;
	/** Accessible label for the dialog. */
	label?: string;
}

export interface CellPopover {
	readonly element: HTMLDivElement;
	/** Re-place against the anchor (content resized, anchor moved). */
	reposition(): void;
	close(): void;
}

/** Popovers opened from inside other popovers, and the close functions of each popover's children. */
const parentOf = new WeakMap<Element, HTMLElement>();
const childrenOf = new WeakMap<Element, Set<() => void>>();

const GAP = 4;
const MARGIN = 8;

/**
 * A floating panel for cell editors: appended to <body> so no grid clip or stacking context hides
 * it, carrying the grid's theme scope so it reads the grid's theme. It sits below the anchor, flips
 * above when there is no room and stays in the viewport; it follows the anchor through scrolls.
 */
export function openCellPopover(options: CellPopoverOptions): CellPopover {
	const { anchor, content } = options;
	const element = document.createElement('div');
	element.className = options.className ? `og-ct-popover ${options.className}` : 'og-ct-popover';
	element.setAttribute('role', 'dialog');
	if (options.label) element.setAttribute('aria-label', options.label);
	const scope = anchor.closest<HTMLElement>('[data-og-theme-scope]')?.dataset.ogThemeScope;
	if (scope) element.dataset.ogThemeScope = scope;
	// Keep the grid from treating presses inside as clicks on its cells.
	element.addEventListener('mousedown', (event) => event.stopPropagation());
	element.appendChild(content);
	document.body.appendChild(element);
	// A popover opened from inside another (an operator list, a calendar) is its child: presses in it
	// are presses in the parent, and closing the parent closes it.
	const parent = anchor.closest<HTMLElement>('.og-ct-popover');
	if (parent) {
		parentOf.set(element, parent);
		let siblings = childrenOf.get(parent);
		if (!siblings) childrenOf.set(parent, (siblings = new Set()));
		siblings.add(close);
	}

	let closed = false;
	const reposition = () => {
		if (closed) return;
		const rect = anchor.getBoundingClientRect();
		const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
		const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
		if (options.matchAnchorWidth) element.style.minWidth = `${Math.round(rect.width)}px`;
		// Measure at natural height: a max-height from an earlier placement must not decide this one.
		element.style.maxHeight = '';
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		const below = viewportHeight - rect.bottom - GAP - MARGIN;
		const above = rect.top - GAP - MARGIN;
		const top = height <= below || below >= above ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - height);
		const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, viewportWidth - width - MARGIN));
		element.style.top = `${Math.round(top)}px`;
		element.style.left = `${Math.round(left)}px`;
		element.style.maxHeight = `${Math.max(120, Math.round(top > rect.top ? below : above))}px`;
	};

	const dismiss = (reason: CellPopoverDismissReason) => {
		if (closed) return;
		close();
		options.onDismiss?.(reason);
	};
	const onPointerDown = (event: MouseEvent) => {
		const target = event.target as Node | null;
		if (target && (element.contains(target) || anchor.contains(target))) return;
		// Inside one of this popover's child popovers (at any depth).
		for (let node = (target as Element | null)?.closest?.('.og-ct-popover') ?? null; node; node = parentOf.get(node) ?? null) {
			if (node === element) return;
		}
		dismiss('outside');
	};
	const onKeyDown = (event: KeyboardEvent) => {
		// Keys typed in the popover are its own: the grid must not also navigate or end the edit on them.
		event.stopPropagation();
		if (event.key !== 'Escape') return;
		event.preventDefault();
		dismiss('escape');
	};
	const onScroll = (event: Event) => {
		// Scrolling the popover's own list must not move it.
		if (event.target instanceof Node && element.contains(event.target)) return;
		reposition();
	};
	document.addEventListener('mousedown', onPointerDown, true);
	element.addEventListener('keydown', onKeyDown);
	window.addEventListener('scroll', onScroll, true);
	window.addEventListener('resize', reposition);

	// The grid moves cells without events the popover hears (bringing a cell into view, re-laying
	// columns out), and content resizes as a list filters: observe both.
	const stopWatchingAnchor = watchElementMoves(anchor, reposition);
	const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => reposition()) : null;
	resizeObserver?.observe(content);

	function close() {
		if (closed) return;
		closed = true;
		const children = childrenOf.get(element);
		if (children) for (const closeChild of [...children]) closeChild();
		childrenOf.delete(element);
		if (parent) childrenOf.get(parent)?.delete(close);
		document.removeEventListener('mousedown', onPointerDown, true);
		window.removeEventListener('scroll', onScroll, true);
		window.removeEventListener('resize', reposition);
		stopWatchingAnchor();
		resizeObserver?.disconnect();
		element.remove();
	}

	reposition();
	return { element, reposition, close };
}

const THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100);

/**
 * Calls `onMove` when an element moves on screen, from layout or scrolling alike. An intersection
 * observer whose root is clipped to the element's current box sees any move as a change in how much
 * of the element is inside it; after each move the box is re-taken. Event-driven: no polling.
 */
function watchElementMoves(target: Element, onMove: () => void): () => void {
	if (typeof IntersectionObserver !== 'function') return () => {};
	let observer: IntersectionObserver | null = null;
	const observe = () => {
		observer?.disconnect();
		observer = null;
		const rect = target.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return;
		const root = document.documentElement;
		const inset = [
			Math.max(0, Math.floor(rect.top)),
			Math.max(0, Math.floor(root.clientWidth - rect.right)),
			Math.max(0, Math.floor(root.clientHeight - rect.bottom)),
			Math.max(0, Math.floor(rect.left)),
		];
		let baseline: number | null = null;
		observer = new IntersectionObserver(
			(entries) => {
				const ratio = entries[entries.length - 1].intersectionRatio;
				if (baseline === null) {
					baseline = ratio;
					return;
				}
				if (Math.abs(ratio - baseline) < 0.005) return;
				onMove();
				observe();
			},
			{ rootMargin: inset.map((px) => `${-px}px`).join(' '), threshold: THRESHOLDS }
		);
		observer.observe(target);
	};
	observe();
	return () => observer?.disconnect();
}
