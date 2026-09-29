import type { CellScrollPresentation, ColumnInstanceId } from '../../columnDef.js';
import type { CellDisplaySnapshot } from '../cellDisplaySnapshot.js';
import type { CellContentMode } from '../cellSlot.js';
import type { VisualFreshness } from '../visualFreshness.js';

export type CellControllerKey = string & { readonly __brand: 'CellControllerKey' };

export function createCellControllerKey(rowId: string, columnInstanceId: ColumnInstanceId): CellControllerKey {
	return `${rowId}::${columnInstanceId}` as CellControllerKey;
}

export interface ControllerWorkToken {
	epoch: number;
	cellControllerKey: CellControllerKey;
	rowId: string;
	columnInstanceId: ColumnInstanceId;
	freshness: VisualFreshness;
}

export interface CellCtrlPresentationState {
	kind:
		| 'buffered'
		| 'primitive'
		| 'loading'
		| 'checkbox-selector'
		| 'live-renderer'
		| 'dom-update'
		| 'frozen-portal'
		| 'shell'
		| 'text-impostor'
		| 'html-snapshot'
		| 'html-pending';
	className: string;
	title?: string | null;
	validationError?: string;
	contentMode?: CellContentMode;
	formattedValue?: string;
	portalKey?: string;
	html?: string;
	requiresFidelity: boolean;
	markDirty?: boolean;
	isEditing?: boolean;
	isFocused?: boolean;
	forceLiveInteractive?: boolean;
	keepVersionFresh?: boolean;
	captureFrozenHtml?: boolean;
	textImpostorSource?: 'explicit' | 'fallback';
	recordVersions?: VisualFreshness | CellDisplaySnapshot;
	freshness: VisualFreshness;
}

export interface CellCtrlAccessibilityState {
	focused: boolean;
	selected: boolean;
	readOnly: boolean;
	invalid: boolean;
}

export function isControllerWorkStillValid(input: {
	token: ControllerWorkToken;
	cellCtrl: CellCtrl | undefined;
	attachedSlotInstanceId?: string;
}): boolean {
	const { token, cellCtrl, attachedSlotInstanceId } = input;
	if (!cellCtrl || cellCtrl.lifecycle.destroyed || cellCtrl.lifecycle.stale) return false;
	if (cellCtrl.key !== token.cellControllerKey) return false;
	if (cellCtrl.rowId !== token.rowId || cellCtrl.columnInstanceId !== token.columnInstanceId) return false;
	if (attachedSlotInstanceId !== undefined && cellCtrl.lifecycle.attachedSlotInstanceId !== attachedSlotInstanceId) return false;
	return true;
}

export interface CellCtrl {
	readonly key: CellControllerKey;
	readonly rowId: string;
	rowIndex: number;
	rowCtrlKey: string;
	readonly columnInstanceId: ColumnInstanceId;
	readonly colId: string;
	readonly field: string;
	readonly colField: string;
	colIndex: number;
	scrollPresentation: CellScrollPresentation;
	freshness: VisualFreshness | undefined;

	valueState: {
		value: unknown;
		formattedValue: string;
		displayText: string;
		loading: boolean;
		empty: boolean;
	};

	visualState: {
		className: string;
		title?: string | null;
		validationError?: string;
		selected: boolean;
		focused: boolean;
		editing: boolean;
		readOnly: boolean;
		diff?: unknown;
		conflict?: unknown;
		quality?: unknown;
	};

	rendererState: {
		mode: 'none' | 'primitive' | 'live' | 'frozen' | 'text-impostor' | 'html-snapshot' | 'html-pending' | 'shell' | 'loading';
		portalKey?: string;
		htmlSnapshotKey?: string;
		mountedSlotInstanceId?: string;
		mountedHost?: HTMLElement;
		mountedFreshness?: VisualFreshness;
		pendingWorkToken?: ControllerWorkToken;
		lastCommitEpoch?: number;
		lastBindEpoch?: number;
	};

	lifecycle: {
		retainedBecause?: string;
		attachedSlotInstanceId?: string;
		destroyed: boolean;
		stale: boolean;
	};

	presentationState: CellCtrlPresentationState;
}

export function deriveCellCtrlAccessibilityState(cellCtrl: CellCtrl): CellCtrlAccessibilityState {
	return {
		focused: cellCtrl.visualState.focused,
		selected: cellCtrl.visualState.selected,
		readOnly: cellCtrl.visualState.readOnly,
		invalid: !!cellCtrl.visualState.validationError,
	};
}

export interface CreateCellCtrlInput {
	rowId: string;
	rowIndex?: number;
	rowCtrlKey?: string;
	columnInstanceId: ColumnInstanceId;
	colId?: string;
	colField: string;
	colIndex?: number;
	scrollPresentation?: CellScrollPresentation;
	freshness?: VisualFreshness;
}

function createDefaultFreshness(): VisualFreshness {
	return {
		rowVersion: -1,
		globalVersion: -1,
		insightVersion: -1,
		styleVersion: -1,
		loadingVersion: -1,
		selectionVersion: -1,
	};
}

export function createCellCtrl(input: CreateCellCtrlInput): CellCtrl;
export function createCellCtrl(rowId: string, columnInstanceId: ColumnInstanceId, field: string): CellCtrl;
export function createCellCtrl(inputOrRowId: CreateCellCtrlInput | string, columnInstanceIdArg?: ColumnInstanceId, fieldArg?: string): CellCtrl {
	const input =
		typeof inputOrRowId === 'string'
			? {
					rowId: inputOrRowId,
					columnInstanceId: columnInstanceIdArg!,
					colField: fieldArg!,
				}
			: inputOrRowId;
	const freshness = input.freshness ?? createDefaultFreshness();
	return {
		key: createCellControllerKey(input.rowId, input.columnInstanceId),
		rowId: input.rowId,
		rowIndex: input.rowIndex ?? -1,
		rowCtrlKey: input.rowCtrlKey ?? input.rowId,
		columnInstanceId: input.columnInstanceId,
		colId: input.colId ?? input.colField,
		field: input.colField,
		colField: input.colField,
		colIndex: input.colIndex ?? -1,
		scrollPresentation: input.scrollPresentation ?? 'primitive',
		freshness: input.freshness,
		valueState: {
			value: undefined,
			formattedValue: '',
			displayText: '',
			loading: false,
			empty: true,
		},
		visualState: {
			className: '',
			title: null,
			selected: false,
			focused: false,
			editing: false,
			readOnly: false,
		},
		rendererState: {
			mode: 'none',
		},
		lifecycle: {
			destroyed: false,
			stale: false,
		},
		presentationState: {
			kind: 'primitive',
			className: '',
			title: null,
			requiresFidelity: false,
			freshness,
			formattedValue: '',
			contentMode: 'empty',
		},
	};
}
