// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientGrid } from './createGrid.js';
import { mountGridHost } from './gridHost.js';
import { resolveGridHostComposition } from './internal/apiInternalBridge.js';
import { GridStore } from './store.js';
import { HEADLESS_PORTS } from './engine/rendererPorts.js';

class TestResizeObserver {
	public observe = vi.fn();
	public disconnect = vi.fn();
}

describe('RuntimePortBinding – exclusive lifecycle (Plan 094)', () => {
	it('bindRuntimePorts returns ok:true for the first bind', () => {
		const store = new GridStore();
		const result = store.bindRuntimePorts(HEADLESS_PORTS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			store.unbindRuntimePorts(result.binding);
		}
		store.destroy();
	});

	it('second concurrent bind is rejected with ok:false and reason already-bound', () => {
		const store = new GridStore();

		const result1 = store.bindRuntimePorts(HEADLESS_PORTS);
		expect(result1.ok).toBe(true);

		const result2 = store.bindRuntimePorts(HEADLESS_PORTS);
		expect(result2.ok).toBe(false);
		if (!result2.ok) expect(result2.reason).toBe('already-bound');

		// Fault was recorded
		const faults = store.engine.runtimeFaults.snapshot();
		expect(faults.some((f) => f.operation === 'bindRuntimePorts')).toBe(true);

		// First binding is still the active one
		if (result1.ok) {
			expect(store.isBindingCurrent(result1.binding)).toBe(true);
			store.unbindRuntimePorts(result1.binding);
		}
		store.destroy();
	});

	it('stale unbind reports a fault and leaves store in clean state', () => {
		const store = new GridStore();

		const result = store.bindRuntimePorts(HEADLESS_PORTS);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		store.unbindRuntimePorts(result.binding); // OK — clears binding
		store.unbindRuntimePorts(result.binding); // stale — should fault

		const faults = store.engine.runtimeFaults.snapshot();
		expect(faults.some((f) => f.operation === 'unbindRuntimePorts')).toBe(true);
		store.destroy();
	});

	it('destroyed store rejects bind with ok:false and reason destroyed', () => {
		const store = new GridStore();
		store.destroy();
		const result = store.bindRuntimePorts(HEADLESS_PORTS);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('destroyed');
	});
});

describe('mountGridHost', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('exposes internal render stats and reset hooks through the host', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			getRowId: (row) => row.id,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const host = mountGridHost(api, container);
		host.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(host.getRenderStats().scrollFrames).toBe(1);
		host.resetRenderStats();
		expect(host.getRenderStats().scrollFrames).toBe(0);

		host.destroy();
		api.destroy();
	});

	it('second mountGridHost on the same api throws and leaves first host active', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			rows: [],
			getRowId: (row) => (row as { id: string }).id,
		});
		const container1 = document.createElement('div');
		const container2 = document.createElement('div');
		vi.spyOn(container1, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		vi.spyOn(container2, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container1);
		document.body.appendChild(container2);

		const host1 = mountGridHost(api, container1);

		// Second mount on the same api must throw (binding already active).
		expect(() => mountGridHost(api, container2)).toThrow(/already-bound/);

		// First host still works — binding is still active.
		expect(() => host1.getRenderStats()).not.toThrow();

		host1.destroy();
		api.destroy();
	});

	it('double destroy reports a stale unbind fault', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			rows: [],
			getRowId: (row) => (row as { id: string }).id,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const runtime = resolveGridHostComposition(api);

		const host = mountGridHost(api, container);
		host.destroy(); // first destroy — OK
		host.destroy(); // second destroy — stale token fault

		const faults = runtime.engine.runtimeFaults.snapshot();
		expect(faults.some((f) => f.operation === 'unbindRuntimePorts')).toBe(true);
		api.destroy();
	});

	it('applies initialState.themeName and themeOverrides atomically on mount, with no separate imperative call', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			rows: [],
			getRowId: (row) => (row as { id: string }).id,
			initialState: {
				themeName: 'light',
				themeOverrides: { focusRing: '#1e2148' },
			},
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const host = mountGridHost(api, container);

		// Resolved base ('light') + override merged before this line ever runs — nothing else
		// was called in between mount and this assertion.
		expect(host.getThemeName()).toBe('light');
		expect(host.getTheme().focusRing).toBe('#1e2148');

		host.destroy();
		api.destroy();
	});

	it('setTheme applies a fully custom theme and getTheme reflects it immediately', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			rows: [],
			getRowId: (row) => (row as { id: string }).id,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const host = mountGridHost(api, container);
		const customTheme = { ...host.getTheme(), bgColor: '#010203', focusRing: '#fedcba' };
		api.setTheme(customTheme);

		expect(api.getTheme().bgColor).toBe('#010203');
		expect(api.getTheme().focusRing).toBe('#fedcba');
		expect(host.getTheme().bgColor).toBe('#010203');

		host.destroy();
		api.destroy();
	});

	it('shares one stylesheet per document across grids, removed with the last one', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		const make = () => {
			const api = createClientGrid<{ id: string }>({ rows: [{ id: 'a' }], columns: [{ field: 'id', header: 'Id' }], getRowId: (r) => r.id });
			const container = document.createElement('div');
			document.body.appendChild(container);
			return { api, host: mountGridHost(api, container) };
		};
		const sheets = () => document.head.querySelectorAll('style[data-og-grid-styles]').length;
		const before = sheets();
		const a = make();
		const b = make();
		expect(sheets()).toBe(before + 1);
		a.host.destroy();
		a.api.destroy();
		expect(sheets()).toBe(before + 1);
		b.host.destroy();
		b.api.destroy();
		expect(sheets()).toBe(before);
	});
});
