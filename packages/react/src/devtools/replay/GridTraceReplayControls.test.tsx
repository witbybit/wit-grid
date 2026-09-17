// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridReplayScheduler } from '@eregister/open-grid-core/experimental';
import { GridTraceReplayControls } from './GridTraceReplayControls.js';

const trace = {
	v: 1,
	initial: { rowIdField: 'id', columns: [{ field: 'id' }, { field: 'name' }], rows: [{ id: 'r1', name: 'Before' }] },
	commands: [{ kind: 'set-cell', rowId: 'r1', colField: 'name', value: 'After' }],
};

class QueuedScheduler implements GridReplayScheduler {
	public readonly delays: number[] = [];
	private turns: Array<{ active: boolean; turn: () => void }> = [];
	public schedule(turn: () => void, delayMs: number): () => void {
		const entry = { active: true, turn };
		this.turns.push(entry);
		this.delays.push(delayMs);
		return () => {
			entry.active = false;
		};
	}
	public get activeTurns(): number {
		return this.turns.filter((entry) => entry.active).length;
	}
	public runAll() {
		while (this.turns.length) {
			const entry = this.turns.shift()!;
			if (entry.active) entry.turn();
		}
	}
}

describe('GridTraceReplayControls', () => {
	afterEach(() => cleanup());
	it('does not autoplay imports and exposes accessible manual controls', () => {
		render(<GridTraceReplayControls trace={JSON.stringify(trace)} />);
		expect(screen.getByText('ready')).toBeTruthy();
		expect(screen.getByText('0 / 1 events')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Step forward' }));
		expect(screen.getByText('completed')).toBeTruthy();
		fireEvent.change(screen.getByLabelText('Replay speed'), { target: { value: '2' } });
		expect((screen.getByLabelText('Replay speed') as HTMLSelectElement).value).toBe('2');
	});

	it('shows validation errors and supports causal-cell linkage on divergence', () => {
		const why = vi.fn();
		render(
			<GridTraceReplayControls
				trace={JSON.stringify({ ...trace, checkpoints: [{ at: 0, facts: { cells: [{ rowId: 'r1', colField: 'name', value: 'Wrong' }] } }] })}
				onWhyCell={why}
			/>
		);
		fireEvent.click(screen.getByRole('button', { name: 'Step forward' }));
		fireEvent.click(screen.getByRole('button', { name: 'Why this cell?' }));
		expect(why).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'r1', colField: 'name' }));
	});

	it('repaints scheduled Play, Pause, and live speed changes without wall-clock timing', () => {
		const scheduler = new QueuedScheduler();
		const twoCommands = JSON.stringify({
			...trace,
			commands: [...trace.commands, { kind: 'set-cell', rowId: 'r1', colField: 'name', value: 'Again' }],
		});
		render(<GridTraceReplayControls trace={twoCommands} scheduler={scheduler} />);
		fireEvent.click(screen.getByRole('button', { name: 'Play' }));
		expect(screen.getByText('running')).toBeTruthy();
		fireEvent.change(screen.getByLabelText('Replay speed'), { target: { value: '2' } });
		expect(scheduler.delays).toEqual([100, 50]);
		fireEvent.click(screen.getAllByRole('button', { name: 'Pause' })[0]!);
		act(() => scheduler.runAll());
		expect(screen.getByText('paused')).toBeTruthy();
		expect(screen.getByText('0 / 2 events')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Play' }));
		act(() => scheduler.runAll());
		expect(screen.getByText('completed')).toBeTruthy();
		expect(screen.getByText('2 / 2 events')).toBeTruthy();
	});

	it('cancels queued replay work before it can advance the UI', () => {
		const scheduler = new QueuedScheduler();
		render(
			<GridTraceReplayControls trace={JSON.stringify({ ...trace, commands: [...trace.commands, ...trace.commands] })} scheduler={scheduler} />
		);
		fireEvent.click(screen.getByRole('button', { name: 'Play' }));
		expect(scheduler.activeTurns).toBe(1);
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByText('cancelled')).toBeTruthy();
		expect(scheduler.activeTurns).toBe(0);
		act(() => scheduler.runAll());
		expect(screen.getByText('0 / 2 events')).toBeTruthy();
	});

	it('unmount cleanup cancels queued replay work without stale updates', () => {
		const scheduler = new QueuedScheduler();
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const view = render(<GridTraceReplayControls trace={JSON.stringify(trace)} scheduler={scheduler} />);
		fireEvent.click(screen.getByRole('button', { name: 'Play' }));
		expect(scheduler.activeTurns).toBe(1);
		view.unmount();
		expect(scheduler.activeTurns).toBe(0);
		act(() => scheduler.runAll());
		expect(error).not.toHaveBeenCalled();
		error.mockRestore();
	});
});
