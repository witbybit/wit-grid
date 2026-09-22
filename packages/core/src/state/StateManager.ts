import type { InternalGridState, GridStateUpdater, Listener } from './GridState.js';
import type { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import { type GridInstrumentation, GridMetric, NOOP_INSTRUMENTATION } from '../diagnostics/GridInstrumentation.js';

export class StateManager<TRowData = unknown> {
	private static readonly MAX_SELECTOR_FANOUT = 8;
	private state: InternalGridState<TRowData>;
	private listeners = new Set<Listener<TRowData>>();
	private keyListeners = new Map<string, Set<Listener<TRowData>>>();

	private transactionDepth = 0;
	// Keys touched inside an open transaction — used to drive notifyChanges at commit.
	// Using a Set avoids the repeated object spread that batchedStateUpdates previously required.
	private batchedKeys = new Set<string>();
	private preTransactionState: InternalGridState<TRowData> | null = null;
	private onChangesCallback?: (prevState: InternalGridState<TRowData>, affectedKeys: string[]) => void;
	private readonly faultReporter?: RuntimeFaultReporter<TRowData>;
	public instrumentation: GridInstrumentation;

	constructor(
		initialState: InternalGridState<TRowData>,
		onChanges?: (prevState: InternalGridState<TRowData>, affectedKeys: string[]) => void,
		faultReporter?: RuntimeFaultReporter<TRowData>,
		instrumentation?: GridInstrumentation
	) {
		this.state = initialState;
		this.onChangesCallback = onChanges;
		this.faultReporter = faultReporter;
		this.instrumentation = instrumentation ?? NOOP_INSTRUMENTATION;
	}

	public getState(): InternalGridState<TRowData> {
		this.instrumentation.increment(GridMetric.STATE_READS);
		return this.state;
	}

	public setState = (updater: GridStateUpdater<TRowData>): void => {
		this.commitState(updater);
	};

	public commitState<TResult = void>(
		updater: GridStateUpdater<TRowData>,
		beforeNotify?: (phase: StateCommitPhase<TRowData>) => TResult
	): TResult | undefined {
		const nextState = typeof updater === 'function' ? updater(this.state) : updater;

		if (this.transactionDepth > 0) {
			for (const key of Object.keys(nextState)) this.batchedKeys.add(key);
			this.state = { ...this.state, ...nextState };
			return undefined;
		}

		const prevState = this.state;
		this.state = { ...prevState, ...nextState };
		const changedKeys = new Set<string>();
		for (const key of Object.keys(nextState)) {
			if (prevState[key as keyof InternalGridState<TRowData>] !== this.state[key as keyof InternalGridState<TRowData>]) {
				changedKeys.add(key);
			}
		}
		if (changedKeys.size === 0) return undefined;

		const phaseResult = beforeNotify?.({
			prevState,
			getState: () => this.state,
			getChangedKeys: () => Array.from(changedKeys),
			setDerivedState: (derivedUpdater) => {
				const affectedKeys = this.setDerivedState(derivedUpdater, prevState);
				for (const key of affectedKeys) changedKeys.add(key);
				return affectedKeys;
			},
		});

		this.notifyChanges(prevState, Array.from(changedKeys));
		return phaseResult;
	}

	public setDerivedState(updater: GridStateUpdater<TRowData>, prevStateForListeners: InternalGridState<TRowData>): string[] {
		const nextState = typeof updater === 'function' ? updater(this.state) : updater;
		const affectedKeys = Object.keys(nextState);
		if (affectedKeys.length === 0) return [];

		this.state = { ...this.state, ...nextState };
		return affectedKeys.filter(
			(key) => prevStateForListeners[key as keyof InternalGridState<TRowData>] !== this.state[key as keyof InternalGridState<TRowData>]
		);
	}

	public startTransaction = (): void => {
		if (this.transactionDepth === 0) {
			this.preTransactionState = this.state;
			this.batchedKeys.clear();
		}
		this.transactionDepth++;
	};

	public endTransaction = (): void => {
		if (this.transactionDepth === 0) return;
		this.transactionDepth--;
		if (this.transactionDepth > 0) return;
		const preState = this.preTransactionState;
		const keys = this.batchedKeys;
		this.preTransactionState = null;
		this.batchedKeys = new Set<string>();
		if (preState && keys.size > 0) {
			this.notifyChanges(preState, Array.from(keys));
		}
	};

	/**
	 * Runs `work` within a single state transaction. Nested calls are supported —
	 * notifications are deferred and fired once when the outermost transaction commits.
	 * The finally block guarantees `endTransaction` is called even if `work` throws,
	 * preventing the state manager from getting stuck in batching mode.
	 */
	public transaction = <T>(work: () => T): T => {
		this.startTransaction();
		try {
			return work();
		} finally {
			this.endTransaction();
		}
	};

	private notifyChanges(prevState: InternalGridState<TRowData>, affectedKeys: string[]): void {
		const updatedKeys = new Set<string>();
		for (const key of affectedKeys) {
			if (prevState[key as keyof InternalGridState<TRowData>] !== this.state[key as keyof InternalGridState<TRowData>]) {
				updatedKeys.add(key);
			}
		}

		if (updatedKeys.size === 0) return;

		const updatedKeysArray = Array.from(updatedKeys);

		// Invoke external changes callback for geometry / coordinate invalidations
		if (this.onChangesCallback) {
			try {
				this.onChangesCallback(prevState, updatedKeysArray);
			} catch (e) {
				this.faultReporter?.report({
					source: 'state-manager',
					operation: 'onChangesCallback',
					error: e,
					context: { affectedKeys: updatedKeysArray },
				});
			}
		}

		// Notify global listeners
		this.listeners.forEach((listener) => {
			try {
				listener(this.state);
			} catch (e) {
				this.faultReporter?.report({
					source: 'state-manager',
					operation: 'global-listener',
					error: e,
					context: { affectedKeys: updatedKeysArray },
				});
			}
		});

		// Notify targeted key listeners
		updatedKeys.forEach((key) => {
			const targeted = this.keyListeners.get(key);
			if (targeted) {
				targeted.forEach((listener) => {
					try {
						listener(this.state);
					} catch (e) {
						this.faultReporter?.report({ source: 'state-manager', operation: 'key-listener', error: e, context: { key } });
					}
				});
			}
		});
	}

	public subscribe = (listener: Listener<TRowData>): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	public subscribeToKey = (key: string, listener: Listener<TRowData>): (() => void) => {
		if (!this.keyListeners.has(key)) {
			this.keyListeners.set(key, new Set());
		}

		const set = this.keyListeners.get(key)!;
		set.add(listener);

		return () => {
			set.delete(listener);
			if (set.size === 0) {
				this.keyListeners.delete(key);
			}
		};
	};

	public subscribeToSelector<TValue>(
		keys: readonly string[],
		selector: (state: InternalGridState<TRowData>) => TValue,
		listener: (value: TValue) => void,
		isEqual: (left: TValue, right: TValue) => boolean = Object.is
	): () => void {
		const uniqueKeys = Array.from(new Set(keys));
		if (uniqueKeys.length === 0) {
			throw new Error('[wit-grid] subscribeToSelector requires at least one key');
		}
		if (uniqueKeys.length > StateManager.MAX_SELECTOR_FANOUT) {
			throw new Error(
				`[wit-grid] subscribeToSelector fan-out ${String(uniqueKeys.length)} exceeds limit ${String(StateManager.MAX_SELECTOR_FANOUT)}`
			);
		}

		let currentValue = selector(this.state);
		const notifyIfChanged = (state: InternalGridState<TRowData>) => {
			const nextValue = selector(state);
			if (isEqual(currentValue, nextValue)) return;
			currentValue = nextValue;
			listener(nextValue);
		};

		const unsubscribers = uniqueKeys.map((key) => this.subscribeToKey(key, notifyIfChanged));
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}

	public triggerKeyChange(key: string, prevState: InternalGridState<TRowData>): void {
		const targeted = this.keyListeners.get(key);
		if (targeted) {
			targeted.forEach((listener) => {
				try {
					listener(this.state);
				} catch (e) {
					this.faultReporter?.report({ source: 'state-manager', operation: 'triggered-key-listener', error: e, context: { key } });
				}
			});
		}
	}

	public destroy(): void {
		this.listeners.clear();
		this.keyListeners.clear();
		this.onChangesCallback = undefined;
	}
}

export interface StateCommitPhase<TRowData = unknown> {
	readonly prevState: InternalGridState<TRowData>;
	readonly getState: () => InternalGridState<TRowData>;
	readonly getChangedKeys: () => string[];
	readonly setDerivedState: (updater: GridStateUpdater<TRowData>) => string[];
}
