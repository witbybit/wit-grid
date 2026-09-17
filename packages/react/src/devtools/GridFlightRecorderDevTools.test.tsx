// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridEventName, type GridApi } from '@eregister/open-grid-core';
import type { GridCausalTraceSnapshot } from '@eregister/open-grid-core/experimental';

let currentSnapshot: GridCausalTraceSnapshot;
const { start, clear, stop, getSnapshot } = vi.hoisted(() => ({ start: vi.fn(), clear: vi.fn(), stop: vi.fn(), getSnapshot: vi.fn() }));
vi.mock('@eregister/open-grid-core/experimental', async () => {
	const actual = await vi.importActual<typeof import('@eregister/open-grid-core/experimental')>('@eregister/open-grid-core/experimental');
	return {
		...actual,
		startFlightRecorder: start,
		stopFlightRecorder: stop,
		clearFlightRecorder: clear,
		getFlightRecorderSnapshot: getSnapshot,
		explainFlightRecorderCell: () => ({
			cell: { rowId: 'r1', colField: 'price' },
			lastChange: { status: 'unknown', reason: 'No retained cell change.' },
			commit: { status: 'unknown', reason: 'No correlated retained commit outcome.' },
			invalidation: { status: 'unknown', reason: 'No correlated retained invalidation.' },
			frame: { status: 'not-applicable', reason: 'No completed frame was retained.' },
		}),
	};
});

import { GridFlightRecorderDevTools } from './GridFlightRecorderDevTools.js';

function trace(size: number, active = true): GridCausalTraceSnapshot {
	return {
		v: 1,
		sessionId: 'session',
		active,
		dropped: 0,
		events: Array.from({ length: size }, (_, index) => ({
			v: 1 as const,
			sessionId: 'session',
			sequence: index + 1,
			timestamp: index,
			event: {
				type: 'frame' as const,
				changeIds: [index + 1],
				correlation: 'render-request' as const,
				kind: 'full',
				durationMs: index + 0.5,
				rowsVisited: 1,
				cellsWritten: index % 20,
			},
		})),
	};
}

function api() {
	const listeners = new Map<string, Set<() => void>>();
	const themeListeners = new Set<(theme: ReturnType<typeof theme>) => void>();
	let currentTheme = theme();
	return {
		addEventListener: vi.fn((name: GridEventName, listener: () => void) => {
			const set = listeners.get(name) ?? new Set();
			set.add(listener);
			listeners.set(name, set);
			return () => set.delete(listener);
		}),
		getStateSnapshot: () => ({ selection: { focus: { rowId: 'r1', colField: 'price' } } }),
		getTheme: () => currentTheme,
		onThemeChange: (listener: (next: ReturnType<typeof theme>) => void) => {
			themeListeners.add(listener);
			return () => themeListeners.delete(listener);
		},
		destroy: vi.fn(),
		_listeners: listeners,
		_setTheme: (next: ReturnType<typeof theme>) => {
			currentTheme = next;
			themeListeners.forEach((listener) => listener(next));
		},
	} as unknown as GridApi<unknown> & { _listeners: Map<string, Set<() => void>>; _setTheme: (next: ReturnType<typeof theme>) => void };
}

function theme(bgColor = '#07101d') {
	return {
		bgColor,
		textColor: bgColor === '#ffffff' ? '#111827' : '#e7f2ff',
		borderColor: '#334155',
		borderColorAccent: '#64748b',
		headerText: '#94a3b8',
		focusRing: '#22d3ee',
		selectionBg: '#164e63',
		popoverBg: bgColor === '#ffffff' ? '#f8fafc' : '#0b1728',
		popoverItemHoverBg: '#1e293b',
		popoverInputBg: bgColor === '#ffffff' ? '#ffffff' : '#071422',
		error: '#ef4444',
		fontFamily: 'system-ui',
	};
}

describe('GridFlightRecorderDevTools', () => {
	afterEach(() => cleanup());
	beforeEach(() => {
		currentSnapshot = trace(12);
		vi.clearAllMocks();
		getSnapshot.mockImplementation(() => currentSnapshot);
		stop.mockImplementation(() => ({ ...currentSnapshot, active: false }));
	});

	it('keeps a 10,000-event timeline under a hard DOM bound', () => {
		currentSnapshot = trace(10_000);
		render(<GridFlightRecorderDevTools api={api()} />);
		fireEvent.click(screen.getByRole('tab', { name: /Causal timeline/i }));
		expect(screen.getByTestId('virtual-timeline').querySelectorAll('.og-fr__event').length).toBeLessThanOrEqual(18);
		expect(screen.getByText('10000')).toBeTruthy();
	});

	it('uses the final immutable stop snapshot and lifecycle controls', () => {
		render(<GridFlightRecorderDevTools api={api()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect(stop).toHaveBeenCalledOnce();
		expect(screen.getByText('Stopped')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Record' }));
		expect(start).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ capacity: 512, captureValues: 'none' }));
	});

	it('supports arrow-key tabs and Escape focus restoration', async () => {
		render(<GridFlightRecorderDevTools api={api()} />);
		const why = screen.getByRole('tab', { name: /Why this cell/i });
		why.focus();
		fireEvent.keyDown(why, { key: 'ArrowRight' });
		expect(screen.getByRole('tab', { name: /Causal timeline/i }).getAttribute('aria-selected')).toBe('true');
		fireEvent.keyDown(document, { key: 'Escape' });
		const launcher = await screen.findByRole('button', { name: 'Open Flight Recorder' });
		await waitFor(() => expect(document.activeElement).toBe(launcher));
	});

	it('uses instance-unique tab IDs and closes only the focused grid on Escape', async () => {
		const first = api();
		const second = api();
		render(
			<>
				<GridFlightRecorderDevTools api={first} />
				<GridFlightRecorderDevTools api={second} />
			</>
		);
		const panels = screen.getAllByLabelText('Open Grid Flight Recorder');
		expect(panels[0].style.getPropertyValue('--fr-bg')).toBe('#07101d');
		second._setTheme(theme('#ffffff'));
		await waitFor(() => expect(panels[1].style.getPropertyValue('--fr-bg')).toBe('#ffffff'));
		expect(panels[0].style.getPropertyValue('--fr-bg')).toBe('#07101d');
		const whyTabs = screen.getAllByRole('tab', { name: /Why this cell/i });
		expect(whyTabs[0].id).not.toBe(whyTabs[1].id);
		expect(whyTabs[0].getAttribute('aria-controls')).not.toBe(whyTabs[1].getAttribute('aria-controls'));
		whyTabs[1].focus();
		fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open Flight Recorder' })).toHaveLength(1));
		expect(screen.getAllByRole('tab', { name: /Why this cell/i })).toHaveLength(1);
	});

	it('clamps invalid recorder capacity before starting', () => {
		render(<GridFlightRecorderDevTools api={api()} capacity={Number.POSITIVE_INFINITY} />);
		fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		const input = screen.getByRole('spinbutton', { name: 'Recorder capacity' });
		expect((input as HTMLInputElement).value).toBe('512');
		fireEvent.change(input, { target: { value: '' } });
		expect((input as HTMLInputElement).value).toBe('');
		fireEvent.click(screen.getByRole('button', { name: 'Record' }));
		expect(start).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ capacity: 512 }));
	});

	it('replaces trace and theme immediately when the grid API changes', async () => {
		const first = api();
		const second = api();
		second._setTheme(theme('#ffffff'));
		getSnapshot.mockImplementation((target) => (target === second ? trace(2) : trace(1)));
		const view = render(<GridFlightRecorderDevTools api={first} />);
		expect(screen.getByLabelText('Open Grid Flight Recorder').style.getPropertyValue('--fr-bg')).toBe('#07101d');
		view.rerender(<GridFlightRecorderDevTools api={second} />);
		await waitFor(() => expect(screen.getByLabelText('Open Grid Flight Recorder').style.getPropertyValue('--fr-bg')).toBe('#ffffff'));
		expect(screen.getByLabelText('Open Grid Flight Recorder').querySelector('.og-fr__summary strong')?.textContent).toBe('2');
	});

	it('clamps NaN and over-maximum recorder capacities', () => {
		const view = render(<GridFlightRecorderDevTools api={api()} capacity={Number.NaN} />);
		fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect((screen.getByRole('spinbutton', { name: 'Recorder capacity' }) as HTMLInputElement).value).toBe('512');
		view.unmount();
		currentSnapshot = trace(12);
		render(<GridFlightRecorderDevTools api={api()} capacity={20_000} />);
		fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		const input = screen.getByRole('spinbutton', { name: 'Recorder capacity' });
		expect((input as HTMLInputElement).value).toBe('10000');
		fireEvent.change(input, { target: { value: '999999' } });
		fireEvent.click(screen.getByRole('button', { name: 'Record' }));
		expect(start).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ capacity: 10_000 }));
	});

	it('renders measured duration summaries and duration bars', () => {
		render(<GridFlightRecorderDevTools api={api()} />);
		fireEvent.click(screen.getByRole('tab', { name: /Performance/i }));
		expect(screen.getAllByText('11.5 ms')).toHaveLength(2);
		expect(screen.getByText('P95 duration (nearest-rank)')).toBeTruthy();
		expect(screen.getByLabelText('Frame duration distribution').firstElementChild?.getAttribute('title')).toContain('ms');
	});

	it('downloads the current immutable snapshot and revokes the URL', () => {
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:trace');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		render(<GridFlightRecorderDevTools api={api()} />);
		fireEvent.click(screen.getByRole('tab', { name: /Faults & trace/i }));
		fireEvent.click(screen.getByRole('button', { name: 'Download' }));
		expect(create).toHaveBeenCalledOnce();
		expect(click).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledWith('blob:trace');
	});

	it('mounts isolated replay import controls only in Faults & trace without autoplay', () => {
		const grid = api();
		render(<GridFlightRecorderDevTools api={grid} />);
		expect(screen.queryByLabelText('Trace replay controls')).toBeNull();
		const listenerCount = [...grid._listeners.values()].reduce((sum, set) => sum + set.size, 0);
		fireEvent.click(screen.getByRole('tab', { name: /Faults & trace/i }));
		expect(screen.getByLabelText('Trace replay controls')).toBeTruthy();
		expect(screen.getByText(/Drop a redacted JSON trace here/i)).toBeTruthy();
		expect(screen.queryByText('running')).toBeNull();
		expect([...grid._listeners.values()].reduce((sum, set) => sum + set.size, 0)).toBe(listenerCount);
		fireEvent.click(screen.getByRole('tab', { name: /Why this cell/i }));
		expect(screen.queryByLabelText('Trace replay controls')).toBeNull();
	});

	it('removes every grid listener on unmount', () => {
		const grid = api();
		const view = render(<GridFlightRecorderDevTools api={grid} />);
		expect([...grid._listeners.values()].reduce((sum, set) => sum + set.size, 0)).toBeGreaterThan(0);
		view.unmount();
		expect([...grid._listeners.values()].reduce((sum, set) => sum + set.size, 0)).toBe(0);
	});

	it('refreshes when a pre-commit write is blocked', async () => {
		const grid = api();
		render(<GridFlightRecorderDevTools api={grid} />);
		currentSnapshot = trace(2);
		for (const listener of grid._listeners.get(GridEventName.writeBlocked) ?? []) listener();
		await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
	});
});
