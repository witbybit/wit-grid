// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DomCellRendererManager, type AcquireDomRendererParams } from './domCellRendererManager.js';
import type { DomCellRenderer } from '../columnDef.js';

interface Row {
	id: string;
}

function makeEngineStub(runtimeLimits?: { maxWarmCustomRenderers?: number }): any {
	return {
		isScrolling: false,
		getApiRef: () => ({}),
		stateManager: { getState: () => ({ runtimeLimits }) },
	};
}

function makeRenderer(mountSpy: ReturnType<typeof vi.fn>): DomCellRenderer<Row> {
	return {
		mount: (container, params) => {
			mountSpy();
			return { update: vi.fn(), destroy: vi.fn() };
		},
	} as unknown as DomCellRenderer<Row>;
}

function acquireParams(
	rowIndex: number,
	colIndex: number,
	parentContainer: HTMLElement,
	renderer: DomCellRenderer<Row>
): AcquireDomRendererParams<Row> {
	const rendererKey = `r${rowIndex}c${colIndex}`;
	return {
		rendererKey,
		cellKey: rendererKey,
		parentContainer,
		renderer,
		value: `v${rowIndex}-${colIndex}`,
		node: { id: `row-${rowIndex}`, data: { id: `row-${rowIndex}` } } as any,
		col: { field: `c${colIndex}` } as any,
		isEditing: false,
		phase: 'scroll',
		isScrolling: false,
		getApiRef: () => ({}),
		isFocused: false,
		isSelected: false,
	};
}

function scrollForwardThenBack(manager: DomCellRendererManager<Row>, renderer: DomCellRenderer<Row>, rowDepth: number, colsPerRow: number): void {
	const parent = document.createElement('div');
	for (let r = 0; r < rowDepth; r++) {
		for (let c = 0; c < colsPerRow; c++) {
			manager.acquire(acquireParams(r, c, parent, renderer));
			manager.releaseByCellKey(`r${r}c${c}`, 'scrolled-out');
		}
	}
	for (let r = 0; r < rowDepth; r++) {
		for (let c = 0; c < colsPerRow; c++) {
			manager.acquire(acquireParams(r, c, parent, renderer));
		}
	}
}

describe('DomCellRendererManager warm cache sizing', () => {
	it('rebinds in place without a sibling scan, handing each update its own params, and retires the old cell key', () => {
		const parent = document.createElement('div');
		const updates: Array<{ params: object; value: unknown }> = [];
		let initialParams: { value: unknown } | undefined;
		const renderer: DomCellRenderer<Row> = {
			mount: (_container, params) => {
				initialParams = params;
				return { update: (next) => updates.push({ params: next, value: next.value }) };
			},
		};
		const manager = new DomCellRendererManager<Row>(makeEngineStub());
		const retired = vi.fn();
		manager.onCellKeyRetired = retired;
		const first = acquireParams(0, 0, parent, renderer);
		manager.acquire(first);
		const siblingScan = vi.spyOn(manager as any, 'removeSiblingContainers');
		manager.acquire({ ...first, value: 'second' });
		manager.acquire({ ...first, cellKey: 'r1c0', value: 'third' });
		expect(siblingScan).not.toHaveBeenCalled();
		expect(updates.map((update) => update.value)).toEqual(['second', 'third']);
		// Renderers may keep params past update(): each call gets its own object.
		expect(updates[0].params).not.toBe(updates[1].params);
		expect((updates[0].params as { value: unknown }).value).toBe('second');
		expect(initialParams?.value).toBe('v0-0');
		expect(retired).toHaveBeenCalledWith('r0c0');
		expect(manager.hasActiveDomRenderer('r0c0')).toBe(false);
		expect(manager.hasActiveDomRenderer('r1c0')).toBe(true);
		expect(parent.querySelectorAll('.og-dom-renderer-container')).toHaveLength(1);
	});
	it('thrashes (remounts) on scroll-back when the cache is undersized', () => {
		const mountSpy = vi.fn();
		const renderer = makeRenderer(mountSpy);
		const manager = new DomCellRendererManager<Row>(makeEngineStub());
		manager.setLimits(50);

		scrollForwardThenBack(manager, renderer, 12, 10);

		// 120 forward cold mounts + some remounts on the reverse pass for evicted entries.
		expect(mountSpy.mock.calls.length).toBeGreaterThan(120);
	});

	it('a cache sized for the scroll-back depth avoids remounts entirely on reverse scroll', () => {
		const mountSpy = vi.fn();
		const renderer = makeRenderer(mountSpy);
		const manager = new DomCellRendererManager<Row>(makeEngineStub());
		manager.setLimits(200);

		scrollForwardThenBack(manager, renderer, 12, 10);

		// Exactly 120 mounts total — the 120 forward-pass cold mounts, zero remounts on reverse.
		expect(mountSpy.mock.calls.length).toBe(120);
	});

	it('honors maxWarmCustomRenderers from live runtimeLimits with no explicit setLimits call', () => {
		const mountSpy = vi.fn();
		const renderer = makeRenderer(mountSpy);
		const manager = new DomCellRendererManager<Row>(makeEngineStub({ maxWarmCustomRenderers: 200 }));

		scrollForwardThenBack(manager, renderer, 12, 10);

		expect(mountSpy.mock.calls.length).toBe(120);
	});
});
