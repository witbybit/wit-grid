import type { ColumnDef } from '../columnDef.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';

export const GRID_TRACE_REPLAY_VERSION = 1;
export const GRID_TRACE_REPLAY_LIMITS = Object.freeze({
	maxBytes: 1_000_000,
	maxEvents: 10_000,
	maxRows: 10_000,
	maxColumns: 256,
	maxStringLength: 32_768,
	maxDepth: 16,
});

export type GridTraceReplayStatus = 'ready' | 'running' | 'paused' | 'completed' | 'diverged' | 'invalid' | 'unsupported' | 'cancelled';

export interface GridReplayColumn {
	readonly field: string;
	readonly header?: string;
	readonly width?: number;
}

export interface GridReplayInitialFixture {
	readonly rowIdField: string;
	readonly columns: readonly GridReplayColumn[];
	readonly rows: readonly Record<string, unknown>[];
}

export type GridReplayCommand =
	| { readonly kind: 'set-cell'; readonly rowId: string; readonly colField: string; readonly value: JsonValue }
	| {
			readonly kind: 'batch-cells';
			readonly updates: readonly { readonly rowId: string; readonly colField: string; readonly value: JsonValue }[];
	  }
	| { readonly kind: 'select-cell'; readonly rowId: string; readonly colField: string }
	| { readonly kind: 'clear-selection' };

export interface GridReplayExpectedFacts {
	readonly outcome?: string;
	readonly reason?: string;
	readonly cells?: readonly { readonly rowId: string; readonly colField: string; readonly value: JsonValue }[];
	readonly domains?: Partial<GridDomainVersions>;
	readonly invalidationKinds?: readonly string[];
	readonly formulaResults?: readonly { readonly rowId: string; readonly colField: string; readonly value: JsonValue }[];
	readonly faults?: readonly string[];
	readonly fallbacks?: readonly string[];
	readonly hash?: string;
}

export interface GridReplayCheckpointExpectation {
	/** Zero-based command index. */
	readonly at: number;
	readonly facts: GridReplayExpectedFacts;
	readonly causalEvidence?: readonly string[];
}

export interface GridReplayTrace {
	readonly v: typeof GRID_TRACE_REPLAY_VERSION;
	readonly initial: GridReplayInitialFixture;
	readonly commands: readonly GridReplayCommand[];
	readonly checkpoints?: readonly GridReplayCheckpointExpectation[];
	/** Observational evidence is visible to a replay consumer but never executed. */
	readonly observations?: readonly GridReplayObservation[];
	readonly unsupportedObservations?: readonly GridReplayObservation[];
}

export type GridReplayObservationKind =
	| 'formula-dependency'
	| 'conflict-resolution'
	| 'rejected-validation'
	| 'fault'
	| 'fallback'
	| 'deleted-row'
	| 'partial-server-evidence';

export interface GridReplayObservation {
	readonly at: number;
	readonly kind: string;
	readonly evidence: JsonValue;
}

export interface GridReplaySemanticFacts {
	readonly outcome: string;
	readonly reason?: string;
	readonly cells: readonly { readonly rowId: string; readonly colField: string; readonly value: JsonValue }[];
	readonly domains: Readonly<GridDomainVersions>;
	readonly invalidationKinds: readonly string[];
	readonly formulaResults: readonly { readonly rowId: string; readonly colField: string; readonly value: JsonValue }[];
	readonly faults: readonly string[];
	readonly fallbacks: readonly string[];
	readonly hash: string;
}

export interface GridReplayCheckpoint {
	readonly index: number;
	readonly facts: GridReplaySemanticFacts;
}

export interface GridReplayDivergence {
	readonly index: number;
	readonly expected: GridReplayExpectedFacts;
	readonly actual: GridReplaySemanticFacts;
	readonly lastMatch: number;
	readonly causalEvidence: readonly string[];
}

export type GridReplayValidation =
	| { readonly ok: true; readonly trace: GridReplayTrace }
	| { readonly ok: false; readonly status: 'invalid' | 'unsupported'; readonly errors: readonly string[] };

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const OBSERVATION_KINDS = new Set<GridReplayObservationKind>([
	'formula-dependency',
	'conflict-resolution',
	'rejected-validation',
	'fault',
	'fallback',
	'deleted-row',
	'partial-server-evidence',
]);

export interface GridReplayScheduler {
	/** Schedules one cooperative replay turn. The delay is presentation pacing only. */
	schedule(turn: () => void, delayMs: number): () => void;
}

const DEFAULT_SCHEDULER: GridReplayScheduler = {
	schedule(turn, delayMs) {
		const handle = setTimeout(turn, delayMs);
		return () => clearTimeout(handle);
	},
};

/**
 * Parses untrusted trace data into a fresh plain-data object. It intentionally accepts no
 * executable values, class instances, inherited keys, or future schema versions.
 */
export function validateGridReplayTrace(input: unknown): GridReplayValidation {
	const text = decodeTraceInput(input);
	if (text === null) return { ok: false, status: 'invalid', errors: ['Trace input must be a UTF-8 string or Uint8Array.'] };
	if (utf8ByteLength(text) > GRID_TRACE_REPLAY_LIMITS.maxBytes) return { ok: false, status: 'invalid', errors: ['Trace exceeds the byte limit.'] };
	let json: JsonValue;
	try {
		json = JSON.parse(text) as JsonValue;
	} catch {
		return { ok: false, status: 'invalid', errors: ['Trace is not valid JSON.'] };
	}
	const errors: string[] = [];
	if (!json || !isPlainRecord(json)) return invalid(errors, 'Trace must be a plain object.');
	if (!validateJsonShape(json, '$', 0, errors)) return { ok: false, status: 'invalid', errors };
	if (json.v !== GRID_TRACE_REPLAY_VERSION) return invalid(errors, 'Trace version is unsupported.');
	const initial = parseInitial(json.initial, errors);
	const parsedCommands = parseCommands(json.commands, errors);
	const commands = parsedCommands.commands;
	const checkpoints = parseCheckpoints(json.checkpoints, commands.length, errors);
	const observations = parseObservations(json.observations, commands.length, errors);
	if (parsedCommands.unsupported) return { ok: false, status: 'unsupported', errors };
	if (!initial || errors.length > 0) return { ok: false, status: 'invalid', errors };
	return freezeReplayTrace({
		v: GRID_TRACE_REPLAY_VERSION,
		initial,
		commands,
		...(checkpoints.length ? { checkpoints } : {}),
		...(observations.known.length ? { observations: observations.known } : {}),
		...(observations.unsupported.length ? { unsupportedObservations: observations.unsupported } : {}),
	});
}

function invalid(errors: string[], message: string): GridReplayValidation {
	errors.push(message);
	return { ok: false, status: 'invalid', errors };
}

function parseInitial(value: JsonValue | undefined, errors: string[]): GridReplayInitialFixture | undefined {
	if (!isPlainRecord(value)) {
		errors.push('Trace initial fixture is required.');
		return undefined;
	}
	const rowIdField = readString(value.rowIdField, '$.initial.rowIdField', errors);
	const rawColumns = readArray(value.columns, '$.initial.columns', errors);
	const rawRows = readArray(value.rows, '$.initial.rows', errors);
	if (!rowIdField || !rawColumns || !rawRows) return undefined;
	if (rawColumns.length === 0 || rawColumns.length > GRID_TRACE_REPLAY_LIMITS.maxColumns) errors.push('Initial columns exceed limits.');
	if (rawRows.length > GRID_TRACE_REPLAY_LIMITS.maxRows) errors.push('Initial rows exceed limits.');
	const fields = new Set<string>();
	const columns: GridReplayColumn[] = [];
	for (let index = 0; index < rawColumns.length; index++) {
		const raw = rawColumns[index];
		if (!isPlainRecord(raw)) {
			errors.push(`Column ${index} must be a plain object.`);
			continue;
		}
		const field = readString(raw.field, `$.initial.columns[${index}].field`, errors);
		if (!field) continue;
		if (fields.has(field)) errors.push(`Column field '${field}' is duplicated.`);
		fields.add(field);
		const header = raw.header === undefined ? undefined : readString(raw.header, `$.initial.columns[${index}].header`, errors);
		const width = raw.width === undefined ? undefined : readFiniteNumber(raw.width, `$.initial.columns[${index}].width`, errors);
		columns.push({ field, ...(header === undefined ? {} : { header }), ...(width === undefined ? {} : { width }) });
	}
	if (!fields.has(rowIdField)) errors.push('Initial columns must include rowIdField.');
	const rows: Record<string, unknown>[] = [];
	const rowIds = new Set<string>();
	for (let index = 0; index < rawRows.length; index++) {
		const raw = rawRows[index];
		if (!isPlainRecord(raw)) {
			errors.push(`Row ${index} must be a plain object.`);
			continue;
		}
		const rowId = raw[rowIdField];
		if (typeof rowId !== 'string' || rowId.length === 0) errors.push(`Row ${index} has no string ${rowIdField}.`);
		else if (rowIds.has(rowId)) errors.push(`Row id '${rowId}' is duplicated.`);
		else rowIds.add(rowId);
		rows.push({ ...raw });
	}
	return { rowIdField, columns, rows };
}

function parseCommands(value: JsonValue | undefined, errors: string[]): { commands: GridReplayCommand[]; unsupported: boolean } {
	const raw = readArray(value, '$.commands', errors);
	if (!raw) return { commands: [], unsupported: false };
	if (raw.length > GRID_TRACE_REPLAY_LIMITS.maxEvents) errors.push('Trace command count exceeds limits.');
	const commands: GridReplayCommand[] = [];
	let unsupported = false;
	for (let index = 0; index < raw.length; index++) {
		const command = raw[index];
		if (!isPlainRecord(command)) {
			errors.push(`Command ${index} must be a plain object.`);
			continue;
		}
		const kind = readString(command.kind, `$.commands[${index}].kind`, errors);
		if (!kind) continue;
		if (kind === 'clear-selection') {
			commands.push({ kind });
			continue;
		}
		if (kind === 'set-cell') {
			const rowId = readString(command.rowId, `$.commands[${index}].rowId`, errors);
			const colField = readString(command.colField, `$.commands[${index}].colField`, errors);
			if (rowId && colField && command.value !== undefined) commands.push({ kind, rowId, colField, value: command.value });
			else errors.push(`Command ${index} requires a JSON value.`);
			continue;
		}
		if (kind === 'select-cell') {
			const rowId = readString(command.rowId, `$.commands[${index}].rowId`, errors);
			const colField = readString(command.colField, `$.commands[${index}].colField`, errors);
			if (rowId && colField) commands.push({ kind, rowId, colField });
			continue;
		}
		if (kind === 'batch-cells') {
			const updates = readArray(command.updates, `$.commands[${index}].updates`, errors);
			if (!updates || updates.length === 0 || updates.length > GRID_TRACE_REPLAY_LIMITS.maxEvents) {
				errors.push(`Command ${index} has invalid updates.`);
				continue;
			}
			const parsed: Array<{ rowId: string; colField: string; value: JsonValue }> = [];
			for (let updateIndex = 0; updateIndex < updates.length; updateIndex++) {
				const update = updates[updateIndex];
				if (!isPlainRecord(update)) {
					errors.push(`Command ${index} update ${updateIndex} must be a plain object.`);
					continue;
				}
				const rowId = readString(update.rowId, `$.commands[${index}].updates[${updateIndex}].rowId`, errors);
				const colField = readString(update.colField, `$.commands[${index}].updates[${updateIndex}].colField`, errors);
				if (rowId && colField && update.value !== undefined) parsed.push({ rowId, colField, value: update.value });
				else errors.push(`Command ${index} update ${updateIndex} requires a JSON value.`);
			}
			commands.push({ kind, updates: parsed });
			continue;
		}
		errors.push(`Command ${index} uses unsupported kind '${kind}'.`);
		unsupported = true;
	}
	return { commands, unsupported };
}

function parseCheckpoints(value: JsonValue | undefined, commandCount: number, errors: string[]): GridReplayCheckpointExpectation[] {
	if (value === undefined) return [];
	const raw = readArray(value, '$.checkpoints', errors);
	if (!raw) return [];
	const result: GridReplayCheckpointExpectation[] = [];
	for (let index = 0; index < raw.length; index++) {
		const checkpoint = raw[index];
		if (!isPlainRecord(checkpoint) || !isPlainRecord(checkpoint.facts)) {
			errors.push(`Checkpoint ${index} must contain facts.`);
			continue;
		}
		const at = readFiniteNumber(checkpoint.at, `$.checkpoints[${index}].at`, errors);
		if (at === undefined || !Number.isInteger(at) || at < 0 || at >= commandCount) {
			errors.push(`Checkpoint ${index} has an invalid command index.`);
			continue;
		}
		const facts = checkpoint.facts as Record<string, JsonValue>;
		const outcome = facts.outcome === undefined ? undefined : readString(facts.outcome, `$.checkpoints[${index}].facts.outcome`, errors);
		const reason = facts.reason === undefined ? undefined : readString(facts.reason, `$.checkpoints[${index}].facts.reason`, errors);
		const hash = facts.hash === undefined ? undefined : readString(facts.hash, `$.checkpoints[${index}].facts.hash`, errors);
		const cells = parseExpectedCells(facts.cells, index, errors);
		const formulaResults = parseExpectedCells(facts.formulaResults, index, errors, 'formulaResults');
		const domains = parseDomains(facts.domains, index, errors);
		const invalidationKinds = parseStringArray(facts.invalidationKinds, `$.checkpoints[${index}].facts.invalidationKinds`, errors);
		const faults = parseStringArray(facts.faults, `$.checkpoints[${index}].facts.faults`, errors);
		const fallbacks = parseStringArray(facts.fallbacks, `$.checkpoints[${index}].facts.fallbacks`, errors);
		const causalEvidence = parseStringArray(checkpoint.causalEvidence, `$.checkpoints[${index}].causalEvidence`, errors);
		result.push({
			at,
			facts: {
				...(outcome === undefined ? {} : { outcome }),
				...(reason === undefined ? {} : { reason }),
				...(hash === undefined ? {} : { hash }),
				...(cells ? { cells } : {}),
				...(formulaResults ? { formulaResults } : {}),
				...(domains ? { domains } : {}),
				...(invalidationKinds ? { invalidationKinds } : {}),
				...(faults ? { faults } : {}),
				...(fallbacks ? { fallbacks } : {}),
			},
			...(causalEvidence ? { causalEvidence } : {}),
		});
	}
	return result;
}

function parseObservations(
	value: JsonValue | undefined,
	commandCount: number,
	errors: string[]
): { known: GridReplayObservation[]; unsupported: GridReplayObservation[] } {
	if (value === undefined) return { known: [], unsupported: [] };
	const raw = readArray(value, '$.observations', errors);
	if (!raw) return { known: [], unsupported: [] };
	const known: GridReplayObservation[] = [];
	const unsupported: GridReplayObservation[] = [];
	for (let index = 0; index < raw.length; index++) {
		const observation = raw[index];
		if (!isPlainRecord(observation)) {
			errors.push(`Observation ${index} must be a plain object.`);
			continue;
		}
		const at = readFiniteNumber(observation.at, `$.observations[${index}].at`, errors);
		const kind = readString(observation.kind, `$.observations[${index}].kind`, errors);
		if (at === undefined || !Number.isInteger(at) || at < 0 || at >= commandCount || !kind || observation.evidence === undefined) {
			errors.push(`Observation ${index} is malformed.`);
			continue;
		}
		const parsed = { at, kind, evidence: observation.evidence };
		if (OBSERVATION_KINDS.has(kind as GridReplayObservationKind)) known.push(parsed);
		else unsupported.push(parsed);
	}
	return { known, unsupported };
}

function parseExpectedCells(value: JsonValue | undefined, checkpoint: number, errors: string[], field = 'cells') {
	if (value === undefined) return undefined;
	const raw = readArray(value, `$.checkpoints[${checkpoint}].facts.${field}`, errors);
	if (!raw) return undefined;
	const cells: Array<{ rowId: string; colField: string; value: JsonValue }> = [];
	for (let index = 0; index < raw.length; index++) {
		const cell = raw[index];
		if (!isPlainRecord(cell)) {
			errors.push(`Checkpoint ${checkpoint} ${field} ${index} must be a plain object.`);
			continue;
		}
		const rowId = readString(cell.rowId, `$.checkpoints[${checkpoint}].facts.${field}[${index}].rowId`, errors);
		const colField = readString(cell.colField, `$.checkpoints[${checkpoint}].facts.${field}[${index}].colField`, errors);
		if (rowId && colField && cell.value !== undefined) cells.push({ rowId, colField, value: cell.value });
	}
	return cells;
}

function parseDomains(value: JsonValue | undefined, checkpoint: number, errors: string[]): Partial<GridDomainVersions> | undefined {
	if (value === undefined) return undefined;
	if (!isPlainRecord(value)) {
		errors.push(`Checkpoint ${checkpoint} domains must be a plain object.`);
		return undefined;
	}
	const result: Partial<GridDomainVersions> = {};
	for (const key of ['columns', 'rows', 'sorting', 'filtering', 'selection', 'editing', 'geometry'] as const) {
		if (value[key] === undefined) continue;
		const parsed = readFiniteNumber(value[key], `$.checkpoints[${checkpoint}].facts.domains.${key}`, errors);
		if (parsed !== undefined && Number.isInteger(parsed) && parsed >= 0) result[key] = parsed;
	}
	return result;
}

function parseStringArray(value: JsonValue | undefined, path: string, errors: string[]): string[] | undefined {
	if (value === undefined) return undefined;
	const raw = readArray(value, path, errors);
	if (!raw) return undefined;
	return raw.map((entry, index) => readString(entry, `${path}[${index}]`, errors)).filter((entry): entry is string => entry !== undefined);
}

function decodeTraceInput(input: unknown): string | null {
	if (typeof input === 'string') return input;
	if (ArrayBuffer.isView(input)) {
		if (input.byteLength > GRID_TRACE_REPLAY_LIMITS.maxBytes) return null;
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
		} catch {
			return null;
		}
	}
	return null;
}

function validateJsonShape(value: JsonValue, path: string, depth: number, errors: string[]): boolean {
	if (depth > GRID_TRACE_REPLAY_LIMITS.maxDepth) {
		errors.push(`${path} exceeds maximum depth.`);
		return false;
	}
	if (typeof value === 'string') return value.length <= GRID_TRACE_REPLAY_LIMITS.maxStringLength;
	if (value === null || typeof value !== 'object') return true;
	if (Array.isArray(value)) {
		if (value.length > GRID_TRACE_REPLAY_LIMITS.maxEvents) {
			errors.push(`${path} exceeds collection limits.`);
			return false;
		}
		return value.every((entry, index) => validateJsonShape(entry, `${path}[${index}]`, depth + 1, errors));
	}
	for (const [key, entry] of Object.entries(value)) {
		if (FORBIDDEN_KEYS.has(key)) {
			errors.push(`${path} contains forbidden key '${key}'.`);
			return false;
		}
		if (!validateJsonShape(entry, `${path}.${key}`, depth + 1, errors)) return false;
	}
	return true;
}

function isPlainRecord(value: unknown): value is Record<string, JsonValue> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function readString(value: JsonValue | undefined, path: string, errors: string[]): string | undefined {
	if (typeof value !== 'string' || value.length === 0 || value.length > GRID_TRACE_REPLAY_LIMITS.maxStringLength) {
		errors.push(`${path} must be a non-empty bounded string.`);
		return undefined;
	}
	return value;
}

function readFiniteNumber(value: JsonValue | undefined, path: string, errors: string[]): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		errors.push(`${path} must be a finite number.`);
		return undefined;
	}
	return value;
}

function readArray(value: JsonValue | undefined, path: string, errors: string[]): readonly JsonValue[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array.`);
		return undefined;
	}
	return value;
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function freezeReplayTrace(trace: GridReplayTrace): GridReplayValidation {
	return { ok: true, trace: deepFreeze(trace) };
}

export class GridTraceReplay {
	private statusValue: GridTraceReplayStatus = 'ready';
	private indexValue = 0;
	private store: GridStore<Record<string, unknown>> | null = null;
	private controller: ClientRowModelController<Record<string, unknown>> | null = null;
	private readonly checkpointsValue: GridReplayCheckpoint[] = [];
	private divergenceValue: GridReplayDivergence | null = null;
	private cancelScheduledTurn: (() => void) | null = null;
	private speedValue = 1;
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly trace: GridReplayTrace,
		private readonly scheduler: GridReplayScheduler = DEFAULT_SCHEDULER
	) {
		this.restart();
	}

	public get status(): GridTraceReplayStatus {
		return this.statusValue;
	}
	public get index(): number {
		return this.indexValue;
	}
	public get checkpoints(): readonly GridReplayCheckpoint[] {
		return this.checkpointsValue;
	}
	public get divergence(): GridReplayDivergence | null {
		return this.divergenceValue;
	}
	public get total(): number {
		return this.trace.commands.length;
	}
	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	public play(speed = this.speedValue): GridTraceReplayStatus {
		if (
			this.statusValue === 'cancelled' ||
			this.statusValue === 'diverged' ||
			this.statusValue === 'invalid' ||
			this.statusValue === 'unsupported'
		)
			return this.statusValue;
		this.setSpeed(speed);
		this.statusValue = 'running';
		this.scheduleNextTurn();
		this.publish();
		return this.statusValue;
	}

	public setSpeed(speed: number): number {
		this.speedValue = Number.isFinite(speed) ? Math.min(8, Math.max(0.25, speed)) : 1;
		if (this.statusValue === 'running') this.scheduleNextTurn();
		this.publish();
		return this.speedValue;
	}

	public pause(): GridTraceReplayStatus {
		if (this.statusValue === 'running') {
			this.cancelPendingTurn();
			this.statusValue = 'paused';
			this.publish();
		}
		return this.statusValue;
	}

	public step(): GridTraceReplayStatus {
		if (this.statusValue === 'cancelled' || this.statusValue === 'diverged' || this.statusValue === 'completed') return this.statusValue;
		if (this.indexValue >= this.trace.commands.length) {
			this.statusValue = 'completed';
			this.publish();
			return this.statusValue;
		}
		this.statusValue = 'running';
		const command = this.trace.commands[this.indexValue]!;
		const facts = this.execute(command);
		const checkpoint: GridReplayCheckpoint = Object.freeze({ index: this.indexValue, facts });
		this.checkpointsValue.push(checkpoint);
		const expected = this.trace.checkpoints?.find((entry) => entry.at === this.indexValue);
		if (expected && !matchesExpected(expected.facts, facts)) {
			this.divergenceValue = Object.freeze({
				index: this.indexValue,
				expected: expected.facts,
				actual: facts,
				lastMatch: this.indexValue - 1,
				causalEvidence: expected.causalEvidence ?? [],
			});
			this.statusValue = 'diverged';
			this.publish();
			return this.statusValue;
		}
		this.indexValue++;
		if (this.indexValue >= this.trace.commands.length) this.statusValue = 'completed';
		else this.statusValue = 'paused';
		this.publish();
		return this.statusValue;
	}

	/** Seeking always reconstructs a fresh headless runtime; replay never uses undo/redo history. */
	public seek(targetIndex: number): GridTraceReplayStatus {
		if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > this.trace.commands.length) return this.statusValue;
		this.restart();
		while (this.indexValue < targetIndex && this.statusValue !== 'diverged') this.step();
		if (this.statusValue !== 'diverged') this.statusValue = this.indexValue === this.trace.commands.length ? 'completed' : 'paused';
		this.publish();
		return this.statusValue;
	}

	public cancel(): GridTraceReplayStatus {
		if (this.statusValue !== 'completed' && this.statusValue !== 'diverged') {
			this.cancelPendingTurn();
			this.statusValue = 'cancelled';
			this.publish();
		}
		return this.statusValue;
	}

	public destroy(): void {
		this.cancel();
		this.disposeRuntime();
	}

	private restart(): void {
		this.cancelPendingTurn();
		this.disposeRuntime();
		const initial = this.trace.initial;
		const columns = initial.columns.map((column) => ({ ...column })) as ColumnDef<Record<string, unknown>>[];
		const rows = initial.rows.map((row) => ({ ...row }));
		const store = new GridStore<Record<string, unknown>>({ columns, getRowId: (row) => String(row[initial.rowIdField] ?? '') });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { columns, rows });
		this.store = store;
		this.controller = controller;
		this.indexValue = 0;
		this.checkpointsValue.length = 0;
		this.divergenceValue = null;
		this.statusValue = 'ready';
	}

	private disposeRuntime(): void {
		this.controller?.dispose();
		this.controller = null;
		this.store?.destroy();
		this.store = null;
	}

	private scheduleNextTurn(): void {
		this.cancelPendingTurn();
		if (this.statusValue !== 'running') return;
		if (this.indexValue >= this.trace.commands.length) {
			this.statusValue = 'completed';
			this.publish();
			return;
		}
		this.cancelScheduledTurn = this.scheduler.schedule(
			() => {
				this.cancelScheduledTurn = null;
				if (this.statusValue !== 'running') return;
				const afterStep = this.step();
				if (afterStep === 'paused') {
					this.statusValue = 'running';
					this.scheduleNextTurn();
				}
			},
			Math.round(100 / this.speedValue)
		);
	}

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private cancelPendingTurn(): void {
		this.cancelScheduledTurn?.();
		this.cancelScheduledTurn = null;
	}

	private execute(command: GridReplayCommand): GridReplaySemanticFacts {
		const store = this.store;
		if (!store)
			return freezeFacts({
				outcome: 'failed',
				reason: 'Replay runtime is unavailable.',
				cells: [],
				domains: emptyDomains(),
				invalidationKinds: [],
				formulaResults: [],
				faults: [],
				fallbacks: [],
			});
		let result: { status: string; reason?: string } = { status: 'applied' };
		let cells: Array<{ rowId: string; colField: string; value: JsonValue }> = [];
		if (command.kind === 'set-cell') {
			result = store.setCellValue(command.rowId, command.colField, command.value);
			cells = [readCell(store, command.rowId, command.colField)];
		} else if (command.kind === 'batch-cells') {
			result = store.transaction({ cells: command.updates.map((update) => ({ ...update })) });
			cells = command.updates.map((update) => readCell(store, update.rowId, update.colField));
		} else if (command.kind === 'select-cell') {
			store.selectCell({ rowId: command.rowId, colField: command.colField });
			cells = [readCell(store, command.rowId, command.colField)];
		} else {
			store.selectCell(null);
		}
		const renderStats = store.getRenderStats();
		const invalidationKinds = renderStats.lastInvalidations.map((invalidation) => invalidation.kind).sort();
		const formulaResults = formulaFacts(store, cells);
		return freezeFacts({
			outcome: result.status,
			...(result.reason ? { reason: result.reason } : {}),
			cells,
			domains: store.engine.getDomainVersions(),
			invalidationKinds,
			formulaResults,
			faults: store
				.getRuntimeFaults()
				.map((fault) => `${fault.source}:${fault.operation}:${fault.message}`)
				.sort(),
			fallbacks: store
				.getInstrumentation()
				.snapshot()
				.fallbacks.map((fallback) => `${fallback.component}:${fallback.reason}`)
				.sort(),
		});
	}
}

export function createGridTraceReplay(
	input: unknown,
	options: { readonly scheduler?: GridReplayScheduler } = {}
): { readonly validation: GridReplayValidation; readonly replay: GridTraceReplay | null; readonly status: GridTraceReplayStatus } {
	const validation = validateGridReplayTrace(input);
	return validation.ok
		? { validation, replay: new GridTraceReplay(validation.trace, options.scheduler), status: 'ready' }
		: { validation, replay: null, status: validation.status };
}

function readCell(store: GridStore<Record<string, unknown>>, rowId: string, colField: string): { rowId: string; colField: string; value: JsonValue } {
	const value = store.getCellState(rowId, colField).value;
	return { rowId, colField, value: normalizeFactValue(value) };
}

function formulaFacts(store: GridStore<Record<string, unknown>>, cells: readonly { rowId: string; colField: string }[]) {
	const facts: Array<{ rowId: string; colField: string; value: JsonValue }> = [];
	for (const cell of cells) {
		const state = store.getCellState(cell.rowId, cell.colField);
		if (typeof state.value === 'string' && state.value.startsWith('='))
			facts.push({ rowId: cell.rowId, colField: cell.colField, value: normalizeFactValue(state.computedValue) });
	}
	return facts;
}

function normalizeFactValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return '[unserializable]';
	}
}

function emptyDomains(): GridDomainVersions {
	return { columns: 0, rows: 0, sorting: 0, filtering: 0, selection: 0, editing: 0, geometry: 0, styling: 0 };
}

function freezeFacts(input: Omit<GridReplaySemanticFacts, 'hash'>): GridReplaySemanticFacts {
	const normalized = {
		...input,
		cells: [...input.cells].sort(compareCells),
		formulaResults: [...input.formulaResults].sort(compareCells),
		invalidationKinds: [...input.invalidationKinds].sort(),
		faults: [...input.faults].sort(),
		fallbacks: [...input.fallbacks].sort(),
	};
	const canonical = JSON.stringify(normalized);
	return Object.freeze({
		...normalized,
		cells: Object.freeze(normalized.cells),
		formulaResults: Object.freeze(normalized.formulaResults),
		invalidationKinds: Object.freeze(normalized.invalidationKinds),
		faults: Object.freeze(normalized.faults),
		fallbacks: Object.freeze(normalized.fallbacks),
		hash: stableHash(canonical),
	});
}

function compareCells(a: { rowId: string; colField: string }, b: { rowId: string; colField: string }): number {
	return a.rowId.localeCompare(b.rowId) || a.colField.localeCompare(b.colField);
}

function stableHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function matchesExpected(expected: GridReplayExpectedFacts, actual: GridReplaySemanticFacts): boolean {
	if (expected.outcome !== undefined && expected.outcome !== actual.outcome) return false;
	if (expected.reason !== undefined && expected.reason !== actual.reason) return false;
	if (expected.hash !== undefined && expected.hash !== actual.hash) return false;
	if (expected.cells && JSON.stringify([...expected.cells].sort(compareCells)) !== JSON.stringify(actual.cells)) return false;
	if (expected.formulaResults && JSON.stringify([...expected.formulaResults].sort(compareCells)) !== JSON.stringify(actual.formulaResults))
		return false;
	if (expected.invalidationKinds && JSON.stringify([...expected.invalidationKinds].sort()) !== JSON.stringify(actual.invalidationKinds))
		return false;
	if (expected.faults && JSON.stringify([...expected.faults].sort()) !== JSON.stringify(actual.faults)) return false;
	if (expected.fallbacks && JSON.stringify([...expected.fallbacks].sort()) !== JSON.stringify(actual.fallbacks)) return false;
	if (expected.domains) {
		for (const [key, value] of Object.entries(expected.domains) as Array<[keyof GridDomainVersions, number]>) {
			if (actual.domains[key] !== value) return false;
		}
	}
	return true;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}
