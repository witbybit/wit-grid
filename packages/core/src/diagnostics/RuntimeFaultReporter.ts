import { GridEventName, type GridEventPayloadMap } from '../api/GridEvents.js';

export type RuntimeFaultSource =
	| 'event-bus'
	| 'grid-change'
	| 'state-manager'
	| 'command-history'
	| 'plugin-registry'
	| 'plugin'
	| 'row-pipeline'
	| 'cell-notifications'
	| 'server-row-model'
	| 'infinite-row-model'
	| 'renderer'
	| 'persistence'
	| 'store';

export interface RuntimeFault {
	id: number;
	timestamp: number;
	source: RuntimeFaultSource;
	operation: string;
	message: string;
	error: unknown;
	context?: Record<string, unknown>;
}

export interface RuntimeFaultInput {
	source: RuntimeFaultSource;
	operation: string;
	error: unknown;
	context?: Record<string, unknown>;
}

export interface RuntimeFaultReporterOptions<TRowData = unknown> {
	capacity?: number;
	emit?: (payload: GridEventPayloadMap<TRowData>[GridEventName.runtimeFault]) => void;
	log?: (fault: RuntimeFault) => void;
	observe?: (fault: RuntimeFault) => void;
}

function defaultRuntimeFaultLogger(fault: RuntimeFault): void {
	console.error(`[WitGrid runtime fault] ${fault.source}:${fault.operation} - ${fault.message}`, fault.error);
}

function toFaultMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (typeof error === 'string' && error.length > 0) {
		return error;
	}
	return 'Unknown runtime fault';
}

export class RuntimeFaultReporter<TRowData = unknown> {
	private readonly capacity: number;
	private readonly emit?: (payload: GridEventPayloadMap<TRowData>[GridEventName.runtimeFault]) => void;
	private readonly log: (fault: RuntimeFault) => void;
	private readonly observe?: (fault: RuntimeFault) => void;
	private readonly faults: RuntimeFault[] = [];
	private nextId = 1;

	constructor(options: RuntimeFaultReporterOptions<TRowData> = {}) {
		this.capacity = Math.max(1, options.capacity ?? 50);
		this.emit = options.emit;
		this.log = options.log ?? defaultRuntimeFaultLogger;
		this.observe = options.observe;
	}

	public report(input: RuntimeFaultInput, options: { emitEvent?: boolean } = {}): RuntimeFault {
		const fault: RuntimeFault = {
			id: this.nextId++,
			timestamp: Date.now(),
			source: input.source,
			operation: input.operation,
			message: toFaultMessage(input.error),
			error: input.error,
			context: input.context,
		};

		this.faults.push(fault);
		if (this.faults.length > this.capacity) {
			this.faults.shift();
		}

		this.log(fault);
		this.observe?.(fault);
		if (options.emitEvent !== false) {
			this.emit?.(fault);
		}
		return fault;
	}

	public snapshot(): RuntimeFault[] {
		return this.faults.slice();
	}

	public clear(): void {
		this.faults.length = 0;
	}
}
