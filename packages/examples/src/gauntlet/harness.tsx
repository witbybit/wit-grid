/**
 * Composition gauntlet harness: renders a real showcase through the real React adapter, drives it
 * with a seeded, time-interleaved mix of scroll / edit / focus / sort / live-data actions, and
 * checks invariants after every step. Failures name the showcase + seed + recent actions, so they
 * replay exactly (the PRNG is the only source of randomness).
 *
 * jsdom cannot lay out or paint, so this proves lifecycle / state-machine correctness under
 * composition, not visual quality or frame timing.
 */
import React, { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { RuntimeFaultReporter } from '../../../core/src/diagnostics/RuntimeFaultReporter.js';
import { PortalMountManager } from '../../../core/src/renderer/portalMountManager.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** mulberry32 — small, fast, deterministic. */
export function createRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface GauntletOptions {
	seed: number;
	steps: number;
	/** Live-data timers (setInterval >= 500ms) run this many times faster, so ticks land mid-gesture. */
	timerSpeedup?: number;
}

export interface GauntletResult {
	faults: string[];
	violations: string[];
	actions: string[];
}

const VIEWPORT = { width: 1100, height: 520 };

function installEnvironment(timerSpeedup: number): () => void {
	const restores: Array<() => void> = [];
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: VIEWPORT.width,
		bottom: VIEWPORT.height,
		width: VIEWPORT.width,
		height: VIEWPORT.height,
		toJSON: () => ({}),
	} as DOMRect);
	// Canvas-backed renderers (sparklines) draw into a no-op 2D context.
	const noop: object = new Proxy(function () {}, {
		get: (_target, key) => (key === 'canvas' ? document.createElement('canvas') : noop),
		apply: () => noop,
		set: () => true,
	});
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(noop as never);
	const g = globalThis as Record<string, unknown>;
	const originals = {
		ResizeObserver: g.ResizeObserver,
		IntersectionObserver: g.IntersectionObserver,
		matchMedia: window.matchMedia,
		setInterval: g.setInterval,
	};
	class NoopObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	}
	g.ResizeObserver ??= NoopObserver;
	g.IntersectionObserver ??= NoopObserver;
	window.matchMedia ??= ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener() {},
		removeListener() {},
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
	const realSetInterval = globalThis.setInterval;
	g.setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
		realSetInterval(fn, ms !== undefined && ms >= 500 ? Math.max(20, Math.round(ms / timerSpeedup)) : ms, ...(rest as []))) as typeof setInterval;
	restores.push(() => {
		g.ResizeObserver = originals.ResizeObserver;
		g.IntersectionObserver = originals.IntersectionObserver;
		window.matchMedia = originals.matchMedia;
		g.setInterval = originals.setInterval;
	});
	return () => {
		for (const restore of restores) restore();
		vi.restoreAllMocks();
	};
}

function visibleCells(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>('.og-row:not(.og-layer-exiting) .og-cell[data-row-id]')).filter(
		(cell) => cell.style.visibility !== 'hidden' && (cell.closest('.og-row') as HTMLElement).style.visibility !== 'hidden'
	);
}

/** Invariants that must hold after every step. Kept to properties with no legitimate exception. */
function checkInvariants(root: HTMLElement): string[] {
	const violations: string[] = [];
	for (const grid of Array.from(root.querySelectorAll<HTMLElement>('.og-grid-container'))) {
		const editors = grid.querySelectorAll('.og-cell-editor').length;
		if (editors > 1) {
			const describe = Array.from(grid.querySelectorAll<HTMLElement>('.og-cell-editor')).map((el) => {
				const cell = el.closest<HTMLElement>('.og-cell');
				const row = el.closest<HTMLElement>('.og-row');
				return `[cell ${cell?.dataset.rowId}/${cell?.dataset.colField} key=${cell?.dataset.cellKey} mode=${cell?.dataset.contentMode} parent=${el.parentElement?.className} rowVis=${row?.style.visibility || '-'} hiddenAncestor=${(() => {
					for (let n: HTMLElement | null = el; n && n !== grid; n = n.parentElement) {
						if (n.style.display === 'none' || n.style.visibility === 'hidden') return n.className || n.tagName;
					}
					return 'none';
				})()} html=${el.outerHTML.slice(0, 90)}]`;
			});
			const owners = ((globalThis as any).__portalStores ?? [])
				.flatMap((st: any) => st.__debugEntries())
				.filter((e: any) => Array.from(grid.querySelectorAll('.og-cell-editor')).some((ed) => e.container.contains(ed)))
				.map(
					(e: any) => `${e.cellKey} editing=${e.isEditing} phase=${e.phase} scrolling=${e.isScrolling} inDom=${grid.contains(e.container)}`
				);
			violations.push(`${editors} cell editors open at once ${describe.join(' ')} OWNERS ${owners.join(' | ')}`);
		}
		// One visual row index must never be painted by two row slots in the same lane container.
		for (const container of Array.from(grid.querySelectorAll<HTMLElement>('.og-rows-container'))) {
			const seen = new Set<string>();
			for (const row of Array.from(container.querySelectorAll<HTMLElement>(':scope > .og-row:not(.og-layer-exiting)'))) {
				if (row.style.visibility === 'hidden' || row.style.display === 'none') continue;
				const index = row.dataset.rowIndex;
				if (index === undefined || index === '') continue;
				if (seen.has(index)) violations.push(`row index ${index} painted by two slots`);
				seen.add(index);
			}
		}
	}
	return violations;
}

export async function runGauntlet(Showcase: ComponentType<Record<string, unknown>>, options: GauntletOptions): Promise<GauntletResult> {
	const rng = createRng(options.seed);
	const pick = <T,>(items: readonly T[]): T | undefined => (items.length === 0 ? undefined : items[Math.floor(rng() * items.length)]);
	const faults: string[] = [];
	const violations: string[] = [];
	const actions: string[] = [];
	// Every live PortalMountManager, so its cell-portal registry can self-check after each step.
	const portalManagers = new Set<PortalMountManager<unknown>>();
	const mountCell = PortalMountManager.prototype.mountCell;
	vi.spyOn(PortalMountManager.prototype, 'mountCell').mockImplementation(function (this: PortalMountManager<unknown>, ...args) {
		portalManagers.add(this);
		return mountCell.apply(this, args);
	});
	const report = RuntimeFaultReporter.prototype.report;
	vi.spyOn(RuntimeFaultReporter.prototype, 'report').mockImplementation(function (this: RuntimeFaultReporter, ...args) {
		faults.push(`${args[0].source}:${args[0].operation} - ${args[0].error instanceof Error ? args[0].error.message : String(args[0].error)}`);
		return report.apply(this, args);
	});
	const restoreEnvironment = installEnvironment(options.timerSpeedup ?? 10);
	const uncaught = (event: ErrorEvent) => faults.push(`uncaught: ${event.message}`);
	window.addEventListener('error', uncaught);
	const quietConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
	const quietWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

	const host = document.createElement('div');
	document.body.appendChild(host);
	let root: Root | null = null;
	const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

	try {
		await act(async () => {
			root = createRoot(host);
			root.render(<Showcase compact />);
		});
		await sleep(400);

		for (let step = 0; step < options.steps; step++) {
			const viewports = Array.from(host.querySelectorAll<HTMLDivElement>('.og-scroll-viewport'));
			const viewport = pick(viewports);
			const roll = rng();
			let action = 'idle';
			if (viewport && roll < 0.4) {
				const burst = 2 + Math.floor(rng() * 6);
				const horizontal = rng() < 0.25;
				action = `scroll-burst x${burst}${horizontal ? ' (h)' : ''}`;
				for (let i = 0; i < burst; i++) {
					const delta = Math.round((rng() - 0.35) * 1600);
					if (horizontal) viewport.scrollLeft = Math.max(0, viewport.scrollLeft + delta);
					else viewport.scrollTop = Math.max(0, viewport.scrollTop + delta);
					viewport.dispatchEvent(new Event('scroll'));
					await sleep(5 + Math.floor(rng() * 25));
				}
				if (rng() < 0.5) viewport.dispatchEvent(new Event('scrollend'));
			} else if (roll < 0.55) {
				const cell = pick(visibleCells(host));
				if (cell) {
					action = `click ${cell.dataset.rowId}/${cell.dataset.colField}`;
					await act(async () => {
						for (const type of ['mousedown', 'mouseup', 'click'])
							cell.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, detail: 1 }));
					});
				}
			} else if (roll < 0.72) {
				const cell = pick(visibleCells(host));
				if (cell) {
					action = `edit ${cell.dataset.rowId}/${cell.dataset.colField}`;
					await act(async () => {
						for (const detail of [1, 2]) {
							for (const type of ['mousedown', 'mouseup', 'click'])
								cell.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, detail }));
						}
						cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0, detail: 2 }));
					});
					if (rng() < 0.5) {
						const input = host.querySelector<HTMLInputElement>('.og-cell-editor input, .og-cell-editor textarea');
						const key = pick(['Enter', 'Escape', 'Tab'])!;
						action += ` then ${key}`;
						await sleep(20 + Math.floor(rng() * 200));
						await act(async () => {
							(input ?? document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
						});
					}
				}
			} else if (roll < 0.82) {
				const key = pick(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'])!;
				action = `key ${key}`;
				await act(async () => {
					(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
					window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
				});
			} else if (roll < 0.9) {
				const header = pick(Array.from(host.querySelectorAll<HTMLElement>('.og-header-cell')));
				if (header) {
					action = `header-click ${header.textContent?.trim().slice(0, 24) ?? ''}`;
					await act(async () => {
						header.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
					});
				}
			}
			// Let live data, frames and idle work interleave before checking.
			await sleep(Math.floor(rng() * (rng() < 0.2 ? 700 : 120)));
			actions.push(`#${step} ${action}`);
			for (const violation of checkInvariants(host)) violations.push(`#${step} ${violation}`);
			for (const manager of portalManagers)
				for (const violation of manager.checkCellPortalInvariants()) violations.push(`#${step} portal registry: ${violation}`);
			if (faults.length > 0 || violations.length > 0) break;
		}
	} finally {
		await act(async () => {
			root?.unmount();
		});
		host.remove();
		window.removeEventListener('error', uncaught);
		quietConsole.mockRestore();
		quietWarn.mockRestore();
		restoreEnvironment();
	}
	return { faults, violations, actions };
}
