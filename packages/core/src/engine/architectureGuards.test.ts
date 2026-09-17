/**
 * Architecture guardrail tests.
 *
 * These tests enforce structural constraints that keep the codebase from
 * drifting back into the cross-file protocol and god-object patterns called
 * out in Plans 011-014.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path, { resolve } from 'path';

const CORE_ROOT = resolve(__dirname, '../..');
const REACT_ROOT = resolve(__dirname, '../../../../packages/react');
const DEMO_ROOT = resolve(__dirname, '../../../../demo');

function countLines(relPath: string): number {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').split('\n').length;
}

function coreFileContains(relPath: string, substring: string): boolean {
	const abs = resolve(CORE_ROOT, 'src', relPath);
	return readFileSync(abs, 'utf-8').includes(substring);
}

function collectSourceFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];
	for (const entry of entries) {
		const abs = resolve(root, entry);
		const stat = statSync(abs);
		if (stat.isDirectory()) {
			files.push(...collectSourceFiles(abs));
			continue;
		}
		if (/\.(tsx?|jsx?)$/.test(entry)) {
			files.push(abs);
		}
	}
	return files;
}

function collectFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];
	for (const entry of entries) {
		const abs = resolve(root, entry);
		const stat = statSync(abs);
		if (stat.isDirectory()) {
			files.push(...collectFiles(abs));
			continue;
		}
		files.push(abs);
	}
	return files;
}

function parseAllowlistedFiles(fileContent: string): string[] {
	const matches = [...fileContent.matchAll(/file:\s*'([^']+)'/g)];
	return matches.map((match) => match[1]);
}

describe('Architecture guardrails', () => {
	it('store.ts is below 1500 lines (target 1000)', () => {
		const lines = countLines('store.ts');
		expect(lines, `store.ts has ${lines} lines; budget is 1500 and target is 1000`).toBeLessThan(1500);
	});

	it('renderEngine.ts is below 1500 lines (intermediate budget, target 1000)', () => {
		const lines = countLines('renderer/renderEngine.ts');
		expect(lines, `renderEngine.ts has ${lines} lines; intermediate budget is 1500 and target is 1000`).toBeLessThan(1150);
	});

	it('rowRenderer.ts is below 800 lines (intermediate budget, target 750)', () => {
		const lines = countLines('renderer/rowRenderer.ts');
		expect(lines, `rowRenderer.ts has ${lines} lines; intermediate budget is 800 and target is 750`).toBeLessThan(800);
	});

	it('renderEngine.ts does not inline renderer subscription wiring', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(content).not.toContain('stateManager.subscribeToKey');
		expect(content).not.toContain('eventBus.addEventListener');
	});

	it('workspace and published packages use explicit semver versions (Plan 106)', () => {
		const workspacePackage = JSON.parse(readFileSync(resolve(CORE_ROOT, '..', '..', 'package.json'), 'utf-8')) as { version: string };
		const corePackage = JSON.parse(readFileSync(resolve(CORE_ROOT, 'package.json'), 'utf-8')) as { version: string };
		const reactPackage = JSON.parse(readFileSync(resolve(REACT_ROOT, 'package.json'), 'utf-8')) as { version: string };
		expect(workspacePackage.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(corePackage.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(reactPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('core and react source trees do not contain generated js or d.ts artifacts', () => {
		const sourceRoots = [resolve(CORE_ROOT, 'src'), resolve(REACT_ROOT, 'src')];
		const generated = sourceRoots.flatMap((root) => collectFiles(root).filter((file) => file.endsWith('.js') || file.endsWith('.d.ts')));
		expect(generated, `generated artifacts found in source tree: ${generated.join(', ')}`).toEqual([]);
	});

	it('RenderInvalidationCoordinator owns renderer subscription wiring', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		expect(content).toContain('stateManager.subscribeToKey');
		expect(content).toContain('eventBus.addEventListener');
	});

	it('renderScrollCoordinator owns scroll-frame orchestration and cheap-path fan-out', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		expect(content).toContain('computeRenderWindowInto');
		expect(content).toContain('sameRenderedWindow');
		expect(content).toContain('public flushScrollFrame =');
		expect(content).toContain('public syncCheapScrollOnly');

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(engineContent).toContain('this.scrollCoordinator.flushScrollFrame()');
		// syncCheapScrollOnly is called internally by renderScrollCoordinator, not forwarded from renderEngine
		expect(engineContent).not.toContain('computeRenderWindowInto(');
		expect(engineContent).not.toContain('sameRenderedWindow(');
	});

	it('DefaultFrameCoordinator routes every paint callback through runPaintFrame (Plan 079)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// The private wrapper must exist.
		expect(content).toContain('private runPaintFrame()');
		// runtimeState is accepted as a dep and stored.
		expect(content).toContain('runtimeState?: RenderRuntimeState');
		expect(content).toContain('this.runtimeState = deps.runtimeState');
		// Both external call sites (RAF callback and flushNowForTests) must delegate to runPaintFrame.
		expect(content).toContain('this.runPaintFrame()');
		// runPaintFrame must enter and exit the paint-frame phase.
		expect(content).toContain("rs.transitionTo('paint-frame')");
		expect(content).toContain("rs.transitionTo('idle')");

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		// renderEngine must wire runtimeState into the coordinator.
		expect(engineContent).toContain('runtimeState: this.runtimeState');
	});

	it('DefaultFrameCoordinator owns a distinct post-scroll callback and scroll epoch (Plan 080)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// Distinct callback — not an alias of onPaintFrame.
		expect(content).toContain('onPostScrollWork: (changeIds: readonly number[]) => void');
		expect(content).toContain('this.onPostScrollWork(changeIds)');
		// Scroll epoch captured at schedule time for stale-work rejection.
		expect(content).toContain('this.runtimeState?.scrollEpoch');
		expect(content).toContain('rs.isScrollEpochCurrent(this.postScrollEpoch)');
		// Single RAF arbiter (Plan 093 replaced per-channel handles with a single rafId).
		expect(content).toContain('this.rafId');
		// renderScrollCoordinator must not import defaultGridScheduler directly.
		const scrollContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		expect(scrollContent).not.toContain('import { defaultGridScheduler }');
		expect(scrollContent).toContain('gridScheduler: GridScheduler');
		expect(scrollContent).toContain('this.deps.gridScheduler.');
	});

	it('renderPaintCoordinator owns paint lifecycle orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderPaintCoordinator.ts'), 'utf-8');
		expect(content).toContain('public flushPaint =');
		expect(content).toContain('public fullPaint =');
		expect(content).toContain('public refreshRendererEpochs');

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(engineContent).toContain('this.paintCoordinator.flushPaint()');
		expect(engineContent).toContain('this.paintCoordinator.fullPaint()');
		expect(engineContent).not.toContain('this.orchestrator.flush(frame)');
		expect(engineContent).not.toContain('refreshRendererEpochs()');
	});

	it('renderViewportCoordinator owns viewport layout and scroll-into-view orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderViewportCoordinator.ts'), 'utf-8');
		expect(content).toContain('computeGridLayoutPlan');
		expect(content).toContain('computeScrollTarget');
		expect(content).toContain('public syncLayoutPlan');
		expect(content).toContain('public recycleViewport');
		expect(content).toContain('public scrollCellIntoView');

		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(engineContent).toContain('this.viewportCoordinator.syncLayoutPlan()');
		expect(engineContent).toContain('this.viewportCoordinator.recycleViewport(false, undefined, layoutPlan.renderWindow)');
		expect(engineContent).toContain('this.viewportCoordinator.scrollCellIntoView(rowId, colField)');
		expect(engineContent).toContain('this.viewportCoordinator.scrollCellPointerIntoView(pointer)');
		expect(engineContent).not.toContain('computeGridLayoutPlan(');
		expect(engineContent).not.toContain('computeScrollTarget(');
	});

	it('rowRenderMaintenance owns scroll-idle repair and invalidation repaint orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderMaintenance.ts'), 'utf-8');
		expect(content).toContain('export function repaintInvalidatedRowsAndCells');
		expect(content).toContain('export function decorateDirtyCellsAfterScroll');
	});

	it('rowCellBindingLanes owns row lane binding orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBindingLanes.ts'), 'utf-8');
		expect(content).toContain('export function bindAllDataCells');
		expect(content).toContain('export function bindAllLoadingCells');
	});

	it('rowRenderer live row/data binding delegates lane orchestration', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderer.ts'), 'utf-8');
		expect(content).toContain('this.runtime.bindAllDataCells(');
		expect(content).toContain('this.runtime.bindAllLoadingCells(');
		expect(content).toContain('this.runtime.bindFullWidthRow(');
	});

	it('rowRendererRuntime owns runtime bridge assembly and coordination adapters', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRendererRuntime.ts'), 'utf-8');
		expect(content).toContain('export class RowRendererRuntimeBridge');
		expect(content).toContain('stateHost.programmaticScrollCell');
		expect(content).toContain('stateHost.currentScrollCellsVisited++');
		expect(content).toContain('public bindAllDataCells(');
		expect(content).toContain('public bindAllLoadingCells(');
		expect(content).toContain('public bindFullWidthRow(');
		expect(content).toContain('public repaintInvalidatedRowsAndCells(');
		expect(content).toContain('public decorateDirtyCellsAfterScroll(');
	});

	it('rowCellBinder owns extracted live cell-binding policy', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
		expect(content).toContain('export function bindCellFull');
		expect(content).toContain('export function bindCellDuringScroll');
		expect(content).toContain('const programmaticScrollCell = getProgrammaticScrollCellPointer(deps.programmaticScrollCell);');
	});

	it('rowCellBindingLanes routes live cell binding through rowCellBinder', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBindingLanes.ts'), 'utf-8');
		expect(content).toContain("from './rowCellBinder.js'");
		expect(content).toContain('bindCellFull(deps.cellBinderDeps');
		expect(content).toContain('bindCellDuringScroll(deps.cellBinderDeps');
	});

	it('row renderer style hook paths report faults through runtime diagnostics', () => {
		// rowRenderer.ts delegates row-class computation (incl. style-rule hook error handling) to
		// rowPresentationResolver.ts — see Phase 8 renderer hardening.
		const files = ['renderer/rowPresentationResolver.ts', 'renderer/selectionPaintManager.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not use console.error for renderer style hooks`).not.toContain('console.error');
			expect(content, `${file} should route renderer faults through reportRendererFault`).toContain('reportRendererFault');
		}
	});

	it('GridView.tsx does not call getStoreFromApi', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'GridView.tsx'), 'utf-8');
		expect(content).not.toContain('getStoreFromApi');
	});

	it('GridView.tsx routes semantic interaction through the core event router', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'GridView.tsx'), 'utf-8');
		expect(content).toContain('bindGridInteractionSurface');
		expect(content).not.toContain('navigationRef.current?.handleKeyDown');
		expect(content).not.toContain('nav.handleMouseDown(');
		expect(content).not.toContain('nav.handleMouseEnter(');
		expect(content).not.toContain('nav.handleClick(');
		expect(content).not.toContain('nav.setCellEditing(');
		expect(content).not.toContain('createGridInteractionEventRouter');
		expect(content).not.toContain('resolveGridInteractionController');
		expect(content).not.toContain('router.bind(container)');
		expect(content).not.toContain('useGridInteractionController');
		expect(content).not.toContain('dispatchEvent(GridEventName.cellClicked');
		expect(content).not.toContain("window.addEventListener('keydown'");
		expect(content).not.toContain("window.addEventListener('mouseup'");
		expect(content).not.toContain("document.addEventListener('mousedown'");
	});

	it('GridInteractionController does not keep a shadow range anchor outside authoritative selection state', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'GridInteractionController.ts'), 'utf-8');
		expect(content).not.toContain('private rangeStart');
		expect(content).toContain('private getSelectionAnchor()');
		expect(content).toContain("this.extendSelection(targetPointer, 'keyboard')");
	});

	it('store public interaction APIs route through the interaction controller instead of split engine feature seams', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).toContain('selectCell: (pointer, source) => this.engine.selectCell(pointer, source),');
		expect(content).not.toContain('selectCell: (pointer, source) => this.engine.selectRange(pointer, pointer, source),');
		expect(content).toContain("public selectCell = (pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {");
		expect(content).toContain('this.interactionController.selectCell(pointer, source);');
		expect(content).toContain('this.interactionController.selectRange(start, end, source);');
		expect(content).toContain('this.interactionController.extendSelection(end, source);');
		expect(content).toContain('return this.interactionController.applyRowSelectionGesture(gesture);');
		expect(content).toContain('public copySelectedRange = (): Promise<void> => this.interactionController.copySelectedRange();');
		expect(content).toContain('public pasteFromClipboard = (): Promise<void> => this.interactionController.pasteFromClipboard();');
		expect(content).toContain('this.interactionController.scrollToCell(rowId, colField, options);');
		expect(content).toContain('this.interactionController.scrollToRow(rowId, options);');
		expect(content).toContain('this.interactionController.startEdit(rowId, colFieldOrInstanceId, source);');
		expect(content).toContain('this.interactionController.updateEditDraft(rowId, colFieldOrInstanceId, value);');
		expect(content).toContain('this.interactionController.stopEdit(cancel);');
		expect(content).toContain('return this.interactionController.commitCellEdit(rowId, colFieldOrInstanceId, value);');
		expect(content).not.toContain('return this.engine.editingFeature.commitEdit(');
		expect(content).not.toContain('public copySelectedRange = (): Promise<void> => this.engine.copySelectedRange();');
		expect(content).not.toContain('public pasteFromClipboard = (): Promise<void> => this.engine.pasteFromClipboard();');
		expect(content).not.toContain('this.hostFacade.scrollCellIntoView(rowId, colField);');
		expect(content).not.toContain('this.hostFacade.scrollRowIntoView(rowId);');
	});

	it('React portal hosts do not own external-stop commit semantics once stopEditing routes through the kernel', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalHosts.tsx'), 'utf-8');
		expect(content).not.toContain('GridEventName.editStopped');
		expect(content).not.toContain('api.addEventListener(GridEventName.editStopped');
		expect(content).not.toContain('void api.commitEdit(rowId, editColumnKey, localValueRef.current);');
	});

	it('portal mount prioritization derives focus/edit priority from interaction state instead of raw state slices', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		expect(content).toContain("import { readInteractionState } from '../interaction/interactionState.js';");
		expect(content).toContain('const interaction = flushState ? readInteractionState(flushState) : null;');
		expect(content).toContain('const activeEdit = interaction?.activeEdit.active ?? null;');
		expect(content).toContain('const focusedCell = interaction?.focus.cell ?? null;');
		expect(content).not.toContain('const activeEdit = flushState?.activeEdit;');
		expect(content).not.toContain('const focusedCell = flushState?.selection.focus;');
	});

	it('interaction event router asks the interaction controller about edit state instead of peeking at public snapshot activeEdit', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'GridInteractionEventRouter.ts'), 'utf-8');
		expect(content).toContain("interaction.dispatchInput({ kind: 'key-down', event });");
		expect(content).toContain("deps.getInteraction()?.dispatchInput({ kind: 'mouse-up' });");
		expect(content).toContain("interaction.dispatchInput({ kind: 'mouse-down-cell', pointer: target.pointer, event });");
		expect(content).toContain("interaction.dispatchInput({ kind: 'cell-enter', pointer: target.pointer });");
		expect(content).toContain("interaction.dispatchInput({ kind: 'cell-click', pointer: target.pointer, event });");
		expect(content).toContain("kind: 'set-cell-editing'");
		expect(content).not.toContain('interaction.handleKeyDown(event);');
		expect(content).not.toContain('interaction.handleMouseDown(target.pointer, event);');
		expect(content).not.toContain('interaction.handleMouseEnter(target.pointer);');
		expect(content).not.toContain('interaction.handleClick(target.pointer, event);');
		expect(content).not.toContain("interaction.setCellEditing(target.pointer.rowId, target.pointer.columnInstanceId, true, 'mouse');");
		expect(content).toContain('if (interaction.isEditingCell(target.pointer)) return;');
		expect(content).not.toContain('getStateSnapshot().activeEdit');
		expect(content).not.toContain('state.activeEdit');
	});

	it('GridDataIntegrityManager derives edit dirtiness from interaction state instead of raw activeEdit state', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridDataIntegrityManager.ts'), 'utf-8');
		expect(content).toContain("import { readInteractionState } from '../../interaction/interactionState.js';");
		expect(content).toContain('const editState = readInteractionState(this.deps.ctx.getState()).activeEdit.active;');
		expect(content).toContain('doesCanonicalCellPointerMatchColumn(editState, rowId, column)');
		expect(content).not.toContain('doesCellPointerMatchColumn(editState, rowId, column)');
		expect(content).not.toContain('const editState = this.deps.ctx.getState().activeEdit;');
	});

	it('renderScrollCoordinator focus matching uses full column identity instead of a field-only stub', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		expect(content).toContain('return doesCanonicalCellPointerMatchColumn(focusedCell, rowId, column);');
		expect(content).toContain('const isFocused = isCellFocused(rowId, col, focusedCell);');
		expect(content).not.toContain('return doesCellPointerMatchColumn(focusedCell, rowId, { field: colField });');
	});

	it('rowRenderMaintenance dirty-cell prioritization matches canonical focus/edit identity by column instance', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderMaintenance.ts'), 'utf-8');
		expect(content).toContain("import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';");
		expect(content).toContain(
			"doesCanonicalCellPointerMatchColumn(activeEdit, cs.rowId ?? '', { field: cs.colField, instanceId: cs.columnInstanceId as any })"
		);
		expect(content).toContain(
			"doesCanonicalCellPointerMatchColumn(focusedCell, cs.rowId ?? '', { field: cs.colField, instanceId: cs.columnInstanceId as any })"
		);
		expect(content).not.toContain('doesCellPointerMatchColumn(activeEdit');
		expect(content).not.toContain('doesCellPointerMatchColumn(focusedCell');
	});

	it('active edit state is column-instance authoritative inside the kernel', () => {
		const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		const editingContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'EditingFeatureController.ts'), 'utf-8');
		const interactionContent = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'GridInteractionController.ts'), 'utf-8');
		const eventRouterContent = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'GridInteractionEventRouter.ts'), 'utf-8');
		expect(apiContent).toContain('export interface ActiveEditState extends GridCellPointer {');
		expect(apiContent).toContain('columnInstanceId: ColumnInstanceId;');
		expect(apiContent).toContain('colId: string;');
		expect(editingContent).not.toContain('activeEdit.columnInstanceId ?? colField');
		expect(editingContent).not.toContain('matchedActiveEdit.columnInstanceId ?? matchedActiveEdit.colField');
		expect(editingContent).not.toContain('activeEdit.colId === colFieldOrInstanceId');
		expect(editingContent).not.toContain('activeEdit.colField === colFieldOrInstanceId');
		expect(interactionContent).not.toContain('activeEdit.columnInstanceId ?? activeEdit.colField');
		expect(eventRouterContent).not.toContain('target.pointer.columnInstanceId ?? target.pointer.colField');
	});

	it('interaction focus state stores canonical cell identity instead of a broad public pointer', () => {
		const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		const interactionStateContent = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'interactionState.ts'), 'utf-8');
		expect(apiContent).toContain('export type CanonicalGridCellPointer = GridCellPointer & {');
		expect(interactionStateContent).toContain('cell: CanonicalGridCellPointer | null;');
		expect(interactionStateContent).toContain('rowIndex: number | null;');
		expect(interactionStateContent).toContain("kind: 'idle' | 'editing-cell';");
		expect(interactionStateContent).toContain('export interface CanonicalGridSelectionState {');
		expect(interactionStateContent).toContain('selection: CanonicalGridSelectionState;');
		expect(interactionStateContent).not.toContain('publicSelection: GridSelectionState;');
		expect(interactionStateContent).toContain('function asCanonicalCellPointer(');
	});

	it('cell accessibility paint derives from CellCtrl state instead of binder-local aria booleans', () => {
		const binderSharedContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'binders', 'binderShared.ts'), 'utf-8');
		const cellCtrlContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'controllers', 'CellCtrl.ts'), 'utf-8');
		const rowCellBinderContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
		expect(cellCtrlContent).toContain('export interface CellCtrlAccessibilityState {');
		expect(cellCtrlContent).toContain('export function deriveCellCtrlAccessibilityState(cellCtrl: CellCtrl): CellCtrlAccessibilityState {');
		expect(binderSharedContent).toContain('return cellSlot.syncAccessibilityState(deriveCellCtrlAccessibilityState(cellCtrl));');
		expect(rowCellBinderContent).toContain('cellCtrl.visualState.selected = isCellSelectedInBounds(ctx.selectionBounds, rowIndex, colIndex);');
	});

	it('projection pipeline rebuilds interaction focus metadata when the visual row order changes', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridProjectionPipeline.ts'), 'utf-8');
		expect(content).toContain("updatedSet.has('globalVersion')");
		expect(content).toContain('getRowIndexByRowId: (rowId) => rowModel?.getVisualIndexByRowId(rowId) ?? null');
	});

	it('renderEngine.ts does not own row-selection gesture semantics directly', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		expect(content).toContain('createGridViewportInteractionRouter');
		expect(content).not.toContain('handleRowCheckboxClick(');
		expect(content).not.toContain('handleDataRowClick(');
	});

	it('viewport interaction router dispatches typed kernel input commands instead of calling row gesture handlers directly', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'GridViewportInteractionRouter.ts'), 'utf-8');
		expect(content).toContain("deps.getInteraction()?.dispatchInput({ kind: 'viewport-mouse-down', event });");
		expect(content).toContain("interaction.dispatchInput({ kind: 'row-checkbox-click', rowId, checked: checkbox.checked, event });");
		expect(content).toContain("interaction.dispatchInput({ kind: 'data-row-click', pointer, event });");
		expect(content).not.toContain('interaction.handleRowCheckboxClick(rowId, checkbox.checked, event);');
		expect(content).not.toContain('interaction.handleDataRowClick(pointer, event);');
	});

	it('GridPortal.tsx does not cast to InternalGridApi', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'GridPortal.tsx'), 'utf-8');
		expect(content).not.toContain('InternalGridApi');
	});

	it('GridChartOverlay.tsx does not import @eregister/open-grid-core/internal', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'chart', 'GridChartOverlay.tsx'), 'utf-8');
		expect(content).not.toContain('@eregister/open-grid-core/internal');
	});

	it('internal adapter entrypoint does not use broad export barrels', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'internal.ts'), 'utf-8');
		expect(content).not.toContain('export * from');
	});

	it('internal adapter entrypoint does not export raw implementation classes', () => {
		const forbiddenExports = [
			'./store.js',
			'./engine/GridEngine.js',
			'./state/StateManager.js',
			'./commands/CommandHistory.js',
			'./events/EventBus.js',
			'./renderer/renderEngine.js',
			'./renderer/rowRenderer.js',
		];
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'internal.ts'), 'utf-8');
		for (const forbidden of forbiddenExports) {
			expect(content, `internal.ts must not export ${forbidden}`).not.toContain(forbidden);
		}
	});

	it('React adapter does not import raw core internals', () => {
		const files = ['GridView.tsx', 'GridPortal.tsx'];
		const forbidden = ['GridStore', 'GridEngine', 'RenderEngine', 'RowRenderer', 'getStoreFromApi', 'InternalGridApi', 'InternalColumnDef'];
		for (const file of files) {
			const content = readFileSync(resolve(REACT_ROOT, 'src', file), 'utf-8');
			for (const token of forbidden) {
				expect(content, `${file} must not import ${token} from @eregister/open-grid-core/internal`).not.toMatch(
					new RegExp(`import[\\s\\S]*\\b${token}\\b[\\s\\S]*from ['"]@eregister/open-grid-core/internal['"]`)
				);
			}
			expect(content, `${file} must not import raw renderer files`).not.toMatch(/from ['"]@eregister\/open-grid-core\/internal\/renderer\//);
		}
	});

	it('reactHostBridge.ts is the only React-side file that imports @eregister/open-grid-core/internal', () => {
		const bridge = readFileSync(resolve(REACT_ROOT, 'src', 'reactHostBridge.ts'), 'utf-8');
		expect(bridge).toContain("from '@eregister/open-grid-core/internal'");

		const files = ['Grid.tsx', 'GridView.tsx', 'GridPortal.tsx', 'hooks.ts', 'gridContext.tsx'];
		for (const file of files) {
			const content = readFileSync(resolve(REACT_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not import @eregister/open-grid-core/internal directly`).not.toContain(
				'@eregister/open-grid-core/internal'
			);
		}
	});

	it('demo app imports no internal package entry points (Plan 106)', () => {
		for (const file of collectSourceFiles(resolve(DEMO_ROOT, 'src'))) {
			const content = readFileSync(file, 'utf-8');
			expect(content, `${file} must not import @eregister/open-grid-core/internal`).not.toContain('@eregister/open-grid-core/internal');
			expect(content, `${file} must not import @eregister/open-grid-react internals by subpath`).not.toMatch(
				/from ['"]@eregister\/open-grid-react\/(?!experimental['"])/
			);
			expect(content, `${file} must not import @eregister/open-grid-core internals by subpath`).not.toMatch(
				/from ['"]@eregister\/open-grid-core\//
			);
		}
	});

	it('react package publishes an explicit experimental entry for incubating helpers (Plan 106)', () => {
		const reactPackage = JSON.parse(readFileSync(resolve(REACT_ROOT, 'package.json'), 'utf-8')) as {
			exports?: Record<string, { types?: string; import?: string }>;
		};
		expect(reactPackage.exports?.['./experimental']).toEqual({
			types: './dist/experimental.d.ts',
			import: './dist/experimental.js',
		});
	});

	it('core package publishes an explicit experimental entry for incubating helpers (Plan 106)', () => {
		const corePackage = JSON.parse(readFileSync(resolve(CORE_ROOT, 'package.json'), 'utf-8')) as {
			exports?: Record<string, { types?: string; import?: string }>;
		};
		expect(corePackage.exports?.['./experimental']).toEqual({
			types: './dist/experimental.d.ts',
			import: './dist/experimental.js',
		});
	});

	it('SpreadsheetFillEngine does not call engine.data.setCellValue directly', () => {
		const hasDirectCall = coreFileContains('spreadsheet/fillRange.ts', 'engine.data.setCellValue');
		expect(hasDirectCall, 'fillRange.ts must route all cell writes through dataMutation.applyCellValueChange').toBe(false);
	});

	it('DataModel.setCellValue is not called from fillRange.ts', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'spreadsheet', 'fillRange.ts'), 'utf-8');
		expect(content, 'fillRange.ts must not call data.setCellValue').not.toContain('data.setCellValue');
	});

	it('feature mutation helpers do not register history directly', () => {
		const files = ['features/DataMutationController.ts', 'spreadsheet/fillRange.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not call commandHistory.add directly`).not.toContain('commandHistory.add');
		}
	});

	it('RowDragController does not reorder rows by calling rowModel.setRowOrder directly', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'RowDragController.ts'), 'utf-8');
		expect(content).not.toContain('rowModel.setRowOrder(');
	});

	it('GridEngine.setRowOrder routes through a typed row-order domain mutation', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain("domainMutations: [{ kind: 'row-order', rowIds, emitEvent, reason }]");
		expect(content).toContain('public setRowOrder(rowIds: string[], emitEvent = true, reason:');
	});

	it('managed row drag policy is explicit and owned by GridEngine', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain('public getManagedRowDragPolicy(): ManagedRowDragPolicyResult');
		expect(content).toContain("reason: 'sort-active'");
		expect(content).toContain("reason: 'filter-active'");
		expect(content).toContain("reason: 'group-active'");
		expect(content).toContain("reason: 'tree-active'");
		expect(content).toContain("reason: 'pagination-active'");
	});

	it('RowDragController uses explicit managed-drag policy checks instead of clearing sort state', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'RowDragController.ts'), 'utf-8');
		expect(content).toContain('this.engine.getManagedRowDragPolicy()');
		expect(content).not.toContain('setSortModel(null');
	});

	it('GridEngine.applyTransaction routes through a typed row-transaction domain mutation', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain("domainMutations: [{ kind: 'row-transaction', transaction }]");
	});

	it('row-transaction executor owns lifecycle through the structural client capability', () => {
		const mutationContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridDomainMutation.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).toContain('export interface ClientStructuralRowModel<TRowData = unknown>');
		expect(rowModelContent).toContain('captureTransactionSnapshot(');
		expect(rowModelContent).toContain('restoreTransactionSnapshot(snapshot: RowModelTransactionSnapshot<TRowData>): void;');
		expect(rowModelContent).not.toContain('export interface TransactionalRowModel<TRowData = unknown>');
		expect(rowModelContent).not.toContain('export function asTransactionalRowModel<TRowData = unknown>(');
		expect(mutationContent).toContain('asClientStructuralRowModel(context.getRowModel())');
		expect(mutationContent).not.toContain('.applyTransaction(mutation.transaction)');
	});

	it('row-order executor narrows to an explicit row-order capability instead of optional row-model hooks', () => {
		const mutationContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridDomainMutation.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).toContain('export interface RowOrderCapableModel');
		expect(rowModelContent).toContain('export function asRowOrderCapableModel(');
		expect(mutationContent).toContain('return asRowOrderCapableModel(context.getRowModel());');
		expect(mutationContent).toContain('getRowOrderCapableModel(commitContext)!.setRowOrder(nextOrder);');
		expect(mutationContent).toContain('getRowOrderCapableModel(commitContext)!.setRowOrder(currentOrder);');
		expect(mutationContent).not.toContain('commitContext.getRowModel()?.setRowOrder?.(nextOrder)');
		expect(mutationContent).not.toContain('commitContext.getRowModel()?.setRowOrder?.(currentOrder)');
	});

	it('GridEngine cell mutations route through typed domain mutations', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain("domainMutations: [{ kind: 'cell-value', rowId, colField, value, undoable, source: 'api' }]");
		expect(content).toContain("domainMutations: [{ kind: 'batch-cell', updates, undoable: true, source }]");
	});

	it('cell mutation history helpers are owned by the executor layer, not DataMutationController', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'DataMutationController.ts'), 'utf-8');
		expect(content).not.toContain('registerCellValueHistory(');
		expect(content).not.toContain('registerBatchCellValueHistory(');
	});

	it('GridStore does not call rowModel.applyTransaction directly', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).not.toContain('rowModel.applyTransaction(');
	});

	it('GridStore narrows row-model capabilities instead of calling optional row-model hooks directly', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		// ClientMutableRowModel replaced by ClientStructuralRowModel (Plan 131).
		expect(rowModelContent).not.toContain('export interface ClientMutableRowModel<TRowData = unknown>');
		expect(rowModelContent).not.toContain('export function asClientMutableRowModel<TRowData = unknown>(');
		expect(rowModelContent).toContain('export interface ClientStructuralRowModel<TRowData = unknown>');
		expect(rowModelContent).toContain('export function asClientStructuralRowModel<TRowData = unknown>(');
		expect(rowModelContent).toContain('export function asRowExpansionStateReadableModel(');
		// ServerControllableRowModel is removed — InfiniteControllableRowModel is the canonical interface.
		expect(rowModelContent).not.toContain('export interface ServerControllableRowModel<TRowData = unknown>');
		expect(rowModelContent).not.toContain('export function asServerControllableRowModel<TRowData = unknown>(');
		expect(storeContent).toContain('private getClientStructuralRowModel(): ClientStructuralRowModel<TRowData> | null');
		// getServerControllableRowModel is removed — assertInfiniteRowModel / assertserverSideRowModel used instead.
		expect(storeContent).not.toContain('private getServerControllableRowModel():');
		expect(storeContent).toContain('return asClientStructuralRowModel(this.getRowModel());');
		expect(storeContent).toContain('return asRowExpansionStateReadableModel(this.getRowModel());');
		// Capability-checked — no silent optional chaining.
		expect(storeContent).not.toContain('.getInfiniteControllableRowModel()?.purgeCache()');
		expect(storeContent).not.toContain('.getInfiniteControllableRowModel()?.setDatasource(');
		expect(storeContent).not.toContain('.getserverSideControllableRowModel()?.goToPage(');
		expect(storeContent).not.toContain('this.getRowModel()?.setRows?.(');
		expect(storeContent).not.toContain('this.getRowModel()?.updateRows?.(');
		expect(storeContent).not.toContain('this.getRowModel()?.purgeCache?.(');
		expect(storeContent).not.toContain('this.getRowModel()?.setDatasource?.(');
		expect(storeContent).not.toContain('this.getRowModel()?.goToPage?.(');
	});

	it('Plan 131 — all row models expose writeCellValueStructurally; old high-level lifecycle methods removed from ClientRowModelController', () => {
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		// Old lifecycle-owning methods are gone from ClientRowModelController — replaced by structural equivalents.
		expect(rowModelContent).not.toContain('public setRows(');
		expect(rowModelContent).not.toContain('public setRows =');
		expect(rowModelContent).not.toContain('public updateRows(');
		expect(rowModelContent).not.toContain('public updateRows =');
		expect(rowModelContent).not.toContain('public setCellValue =');
		// Structural replacements are present.
		expect(rowModelContent).toContain('public replaceRowsStructurally(');
		expect(rowModelContent).toContain('public updateRowsStructurally(');
		expect(rowModelContent).toContain('public writeCellValueStructurally(');
		expect(rowModelContent).toContain('public reconcileAfterDataWrite(');
		// Unified cell write interface: all three row model types expose writeCellValueStructurally.
		const infiniteContent = readFileSync(resolve(CORE_ROOT, 'src', 'infiniteRowModel.ts'), 'utf-8');
		const serverContent = readFileSync(resolve(CORE_ROOT, 'src', 'serverSideRowModel.ts'), 'utf-8');
		expect(infiniteContent).toContain('public writeCellValueStructurally =');
		expect(serverContent).toContain('public writeCellValueStructurally =');
		// Neither falls back to the old direct-mutate setCellValue path.
		expect(infiniteContent).not.toContain('public setCellValue');
		expect(serverContent).not.toContain('public setCellValue');
	});

	it('GridEngine distinct-value lookup narrows to a data-node source instead of optional row-model hooks', () => {
		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).toContain('export interface AllDataNodesCapableRowModel<TRowData = unknown>');
		expect(rowModelContent).toContain('export function asAllDataNodesCapableRowModel<TRowData = unknown>(');
		expect(engineContent).toContain('private getDistinctValueSourceNodes(): RowNode<TRowData>[]');
		expect(engineContent).toContain('return asAllDataNodesCapableRowModel(this.rowModel)?.getAllDataNodes() ?? [];');
		expect(engineContent).not.toContain('this.rowModel?.getAllDataNodes?.()');
	});

	it('GroupingFeatureController narrows expansion hooks instead of calling optional row-model methods directly', () => {
		const featureContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GroupingFeatureController.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).toContain('export interface RowExpansionCapableModel<TRowData = unknown>');
		expect(rowModelContent).toContain('export function asRowExpansionCapableModel<TRowData = unknown>(');
		expect(featureContent).toContain('private getExpansionCapableRowModel(): RowExpansionCapableModel<TRowData> | null');
		expect(featureContent).toContain('return asRowExpansionCapableModel(this.getRowModel());');
		expect(featureContent).not.toContain('this.getRowModel()?.expandAllGroups?.()');
		expect(featureContent).not.toContain('this.getRowModel()?.collapseAllGroups?.()');
		expect(featureContent).not.toContain('this.getRowModel()?.toggleGroupExpanded?.(groupId)');
		expect(featureContent).not.toContain('this.getRowModel()?.toggleDetailExpanded?.(rowId)');
	});

	it('PaginationBarRenderer narrows paging hooks instead of optional row-model methods directly', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'paginationBarRenderer.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).toContain('export function asPageWindowCapableRowModel(');
		expect(rowModelContent).not.toContain('asServerPageControllableRowModel');
		expect(rowModelContent).toContain('export function asDataRowCountModel(');
		expect(content).toContain('return asPageWindowCapableRowModel(this.engine.getRowModel());');
		expect(content).not.toContain('asServerPageControllableRowModel');
		expect(content).not.toContain('rowModel?.getPageWindow?.()');
		expect(content).not.toContain('rowModel?.goToPage');
	});

	it('DataMutationController narrows cell-write ownership instead of optional row-model hooks', () => {
		const featureContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'DataMutationController.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		// Plan 131: unified structural cell write interface covers client, infinite, and server models.
		expect(rowModelContent).toContain('export interface AnyModelCellWritable<TRowData = unknown>');
		expect(rowModelContent).toContain('export function asAnyModelCellWritable<TRowData = unknown>(');
		expect(featureContent).toContain('asAnyModelCellWritable(this.deps.getRowModel())');
		expect(featureContent).not.toContain('if (!rowModel?.setCellValue)');
		expect(featureContent).not.toContain('private getCellValueWritableRowModel()');
	});

	it('RowRenderer drives viewport loading through the shared row-model contract', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderer.ts'), 'utf-8');
		expect(content).toContain("this.engine.getRowModel()?.ensureRange(nextWindow.rowStart, nextWindow.rowEnd, 'viewport-render');");
		expect(content).not.toContain('loadVisibleBlocks(');
		expect(content).not.toContain('id: `loading:${r}`');
	});

	it('row-model naming keeps server-side explicit and maps public server to SSRM', () => {
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		const gridStateContent = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridState.ts'), 'utf-8');
		expect(rowModelContent).toContain("export type InternalRowModelKind = 'client' | 'infinite' | 'server-side';");
		expect(gridStateContent).toContain("export type RowModelType = 'client' | 'infinite' | 'server';");
		expect(gridStateContent).toContain('server-side row model (SSRM)');
	});

	it('GridFeatureContext does not expose raw side-effect primitives', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridFeatureContext.ts'), 'utf-8');
		expect(content).not.toContain('stateManager:');
		expect(content).not.toContain('invalidation:');
		expect(content).not.toContain('eventBus:');
		expect(content).not.toContain('commandHistory:');
		expect(content).not.toContain('requestRender:');
	});

	it('feature controllers do not use raw ctx side-effect primitives', () => {
		const files = [
			'features/ColumnFeatureController.ts',
			'features/GroupingFeatureController.ts',
			'features/EditingFeatureController.ts',
			'features/RowSelectionFeatureController.ts',
		];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not call this.ctx.stateManager`).not.toContain('this.ctx.stateManager');
			expect(content, `${file} must not call this.ctx.invalidation`).not.toContain('this.ctx.invalidation');
			expect(content, `${file} must not call this.ctx.eventBus`).not.toContain('this.ctx.eventBus');
			expect(content, `${file} must not call this.ctx.commandHistory`).not.toContain('this.ctx.commandHistory');
			expect(content, `${file} must not call this.ctx.requestRender`).not.toContain('this.ctx.requestRender');
		}
	});

	it('GridChange.reason is not typed as string', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		expect(content).not.toContain('reason: string;');
	});

	it('core models do not depend on the concrete GridEngine type', () => {
		const files = ['models/DataModel.ts', 'models/ColumnModel.ts', 'models/CellAccess.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not reference GridEngine`).not.toContain('GridEngine<');
			expect(content, `${file} must not store a private engine field`).not.toContain('private engine!');
			expect(content, `${file} must not expose init(engine)`).not.toContain('init(engine');
		}
	});

	it('row models do not reach through store.engine', () => {
		const files = ['rowModel.ts', 'infiniteRowModel.ts', 'serverSideRowModel.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not use store.engine reach-through`).not.toContain('store.engine.');
		}
	});

	it('row models do not depend on the concrete GridStore type', () => {
		const files = ['rowModel.ts', 'infiniteRowModel.ts', 'serverSideRowModel.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not reference GridStore`).not.toContain('GridStore<');
			expect(content, `${file} must not keep a private store field`).not.toContain('private store:');
			expect(content, `${file} must not accept constructor(store: GridStore...)`).not.toContain('constructor(store: GridStore');
		}
	});

	it('core runtime fault paths do not use scattered console.error calls', () => {
		const files = [
			'contextMenu.ts',
			'events/EventBus.ts',
			'state/StateManager.ts',
			'commands/CommandHistory.ts',
			'plugins/GridPluginRegistry.ts',
			'engine/CellNotificationController.ts',
			'engine/createRowModelRuntimes.ts',
			'infiniteRowModel.ts',
			'serverSideRowModel.ts',
			'rows/stages/aggregateStage.ts',
			'renderer/fillDragController.ts',
			'renderer/headerMenuController.ts',
			'renderer/headerRenderer.ts',
		];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must report faults through RuntimeFaultReporter`).not.toContain('console.error');
		}
	});

	it('row-model runtimes are defined in runtimePorts and used from factory wiring', () => {
		const runtimePorts = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'runtimePorts.ts'), 'utf-8');
		expect(runtimePorts).toContain('export interface ClientRowModelRuntime');
		expect(runtimePorts).toContain('export interface InfiniteRowModelRuntime');
		expect(runtimePorts).toContain('export interface ServerSideRowModelRuntime');
		// Legacy ServerRowModelRuntime alias must be removed
		expect(runtimePorts).not.toContain('ServerRowModelRuntime');

		const createGrid = readFileSync(resolve(CORE_ROOT, 'src', 'createGrid.ts'), 'utf-8');
		expect(createGrid).toContain('runtime.getClientRowModelRuntime()');
		expect(createGrid).toContain('runtime.getInfiniteRowModelRuntime()');
		expect(createGrid).toContain('runtime.getServerSideRowModelRuntime()');
		// Legacy createServerGrid must be removed
		expect(createGrid).not.toContain('runtime.getServerRowModelRuntime()');
		expect(createGrid).not.toContain('createServerGrid');
		expect(createGrid).not.toContain('new ClientRowModelController<TRowData>(store,');
		expect(createGrid).not.toContain('new ServerRowModelController<TRowData>(store,');
	});

	it('Plan 158 async row models publish committed responses through the explicit async publication port', () => {
		const runtimePorts = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'runtimePorts.ts'), 'utf-8');
		const runtimeFactory = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'createRowModelRuntimes.ts'), 'utf-8');
		const infiniteContent = readFileSync(resolve(CORE_ROOT, 'src', 'infiniteRowModel.ts'), 'utf-8');
		const serverSideContent = readFileSync(resolve(CORE_ROOT, 'src', 'serverSideRowModel.ts'), 'utf-8');

		expect(runtimePorts).toContain('export interface AsyncRowModelPublication');
		expect(runtimePorts).toContain('publishAsyncRowModelUpdate: (publication: AsyncRowModelPublication) => void;');
		expect(runtimeFactory).toContain('function publishAsyncRowModelUpdate<TRowData>');
		expect(runtimeFactory).toContain('store.engine.applyRowModelRefreshInvalidation(publication.refreshResult');
		expect(infiniteContent).toContain('this.runtime.publishAsyncRowModelUpdate({');
		expect(serverSideContent).toContain('this.runtime.publishAsyncRowModelUpdate({');
		expect(infiniteContent).not.toContain('this.runtime.applyRefreshInvalidation(');
		expect(serverSideContent).not.toContain('this.runtime.applyRefreshInvalidation(');
	});

	it('navigation and contextMenu plugins do not depend on GridStore downcasts', () => {
		const files = ['interaction/GridInteractionController.ts', 'contextMenu.ts'];
		for (const file of files) {
			const content = readFileSync(resolve(CORE_ROOT, 'src', file), 'utf-8');
			expect(content, `${file} must not reference GridStore`).not.toContain('GridStore');
			expect(content, `${file} must not cast api as GridStore`).not.toContain('api as GridStore');
		}
	});

	it('GridPlugin no longer initializes against InternalGridApi', () => {
		const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		const surfacesContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApiSurfaces.ts'), 'utf-8');
		expect(apiContent).not.toContain('onInit?(api: InternalGridApi');
		expect(apiContent).toContain('GridPluginRuntime');
		expect(surfacesContent).toContain('export interface GridPluginRuntime');
	});

	it('react exposes Grid as the only public grid entrypoint', () => {
		const indexContent = readFileSync(resolve(REACT_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(indexContent).toContain("export { Grid } from './Grid.js';");

		// 'GridView' must appear only as a type suffix (e.g. GridViewDefinition), not as a standalone component export.
		const forbiddenExports = [
			/\bGridView\b(?!Definition)/,
			/\bGridProvider\b/,
			/\buseOwnedClientGrid\b/,
			/\buseOwnedServerGrid\b/,
			/\bClientGridOptions\b/,
			/\bServerGridOptions\b/,
		];
		for (const token of forbiddenExports) {
			expect(indexContent, `React public index must not export ${token}`).not.toMatch(token);
		}

		expect(existsSync(resolve(REACT_ROOT, 'src', 'ownedGrid.ts')), 'ownedGrid.ts must not exist').toBe(false);
	});

	it('Grid.tsx does not contain the pagedServerDatasource wrapper', () => {
		const gridContent = readFileSync(resolve(REACT_ROOT, 'src', 'Grid.tsx'), 'utf-8');
		expect(gridContent, 'pagedServerDatasource wrapper must not exist in Grid.tsx').not.toContain('pagedServerDatasource');
	});

	it('demo code depends on the React Grid entrypoint instead of core or owned-grid internals', () => {
		const files = [...collectSourceFiles(resolve(DEMO_ROOT, 'src')), resolve(DEMO_ROOT, 'package.json')];
		const forbiddenTokens = [
			'@eregister/open-grid-core',
			'useOwnedClientGrid',
			'useOwnedServerGrid',
			'useOwnedGrid',
			'useShowroomStores',
			'GridProvider',
			'ownedGrid',
		];

		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			for (const token of forbiddenTokens) {
				expect(content, `${file} must not contain ${token}`).not.toContain(token);
			}
		}
	});

	// ── Plan 071 — store.ts hub decomposition boundary rules ─────────────────

	it('renderer production files do not import from store.ts barrel', () => {
		// Renderer source files should import types from narrow modules, not the store hub.
		// Test files (*.test.ts) are exempt — they need GridStore for setup.
		const rendererDir = resolve(CORE_ROOT, 'src', 'renderer');
		const files = collectSourceFiles(rendererDir).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(file.replace(rendererDir, 'renderer'));
			}
		}
		expect(violators, `renderer files still importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('GridEventName is defined in api/GridEvents.ts, not store.ts', () => {
		const eventsContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridEvents.ts'), 'utf-8');
		expect(eventsContent).toContain('export enum GridEventName');
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(storeContent).not.toContain('export enum GridEventName');
	});

	it('legacy GridState compatibility alias is removed from the runtime state module', () => {
		const stateContent = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridState.ts'), 'utf-8');
		expect(stateContent).not.toContain('export type GridState<');
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(storeContent).not.toContain('export type GridState<');
		expect(storeContent).not.toContain('export interface GridState');
	});

	// ── Plan 072 — GridInstrumentation hot-path boundary ─────────────────────

	it('renderer production files do not import RecordingGridInstrumentation (noop path must be tree-shakeable)', () => {
		// Renderer code must only depend on the GridInstrumentation interface.
		// RecordingGridInstrumentation is for tests and demos — importing it in the
		// renderer hot path would prevent the noop branch from being tree-shaken.
		const rendererDir = resolve(CORE_ROOT, 'src', 'renderer');
		const files = collectSourceFiles(rendererDir).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes('RecordingGridInstrumentation')) {
				violators.push(file.replace(rendererDir, 'renderer'));
			}
		}
		expect(violators, `renderer files importing RecordingGridInstrumentation: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('GridInstrumentation interface is defined in diagnostics/GridInstrumentation.ts', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		expect(content).toContain('export interface GridInstrumentation');
		expect(content).toContain('export const enum GridMetric');
		expect(content).toContain('export class NoopGridInstrumentation');
		expect(content).toContain('export class RecordingGridInstrumentation');
	});

	it('CellMountIdentity includes lane/laneIndex and CellPayloadIdentity is defined (Plan 081)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		// Physical identity must include lane placement fields.
		expect(content).toContain("lane: 'left' | 'center' | 'right'");
		expect(content).toContain('laneIndex: number');
		// Logical payload identity must be kept separate from physical identity.
		expect(content).toContain('export interface CellPayloadIdentity');
		expect(content).toContain('rowId: string');
	});

	it('portal mount equality check compares full physical identity in React store (Plan 110/121)', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalStore.ts'), 'utf-8');
		expect(content).toContain('isSamePhysicalIdentity(existing.physicalIdentity, physicalIdentity)');
		expect(content).toContain('existing?.physicalIdentity');
		// All 5 fields must be compared — no 2-field weak check (Plan 121)
		expect(content).toContain('left.cellInstanceId === right.cellInstanceId');
		expect(content).toContain('left.rowBindingGeneration === right.rowBindingGeneration');
		expect(content).toContain('left.portalHostId === right.portalHostId');
	});

	it('deferred cell mounts validate generation before executing (Plan 081)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		// Stale-check logic is now centralised in isSamePhysicalIdentity() (Plan 120).
		expect(content).toContain('isSamePhysicalIdentity');
		expect(content).toContain('active.rowSlotId !== op.rowSlotId');
		expect(content).toContain('active.slotGeneration !== op.slotGeneration');
	});

	it('RowDependencyRegistry expands sort/filter/group source fields and tracks opaque getters (Plan 082)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rows', 'rowMutationClassifier.ts'), 'utf-8');
		// Source dependency expansion must use valueGetterDependencies.
		expect(content).toContain('col?.valueGetterDependencies');
		// Opaque getter detection must set the flag.
		expect(content).toContain('opaqueStructuralDependency = true');
		// Opaque fallback in classifyMutation must exist.
		expect(content).toContain('registry.opaqueStructuralDependency');
		// Tree-parent precision: source fields tracked separately.
		expect(content).toContain('treeParentSourceFields');
		expect(content).toContain('treeParentDependencies');
	});

	it('treeData options expose getParentIdDependencies (Plan 082)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rows', 'RowPipeline.ts'), 'utf-8');
		expect(content).toContain('getParentIdDependencies');
	});

	it('incremental index maintenance uses reindexFrom and preserves Map identity (Plan 083)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		// reindexFrom must exist and update maps in-place (no new Map() calls in incremental paths).
		expect(content).toContain('private reindexFrom(');
		expect(content).toContain('this.reindexFrom(');
		// Cost model must exist.
		expect(content).toContain('isIncrementalCheaper');
		// Stale entries for removed rows must be deleted before splice.
		expect(content).toContain('this.rowIdToVisualIndex.delete(node.id)');
	});

	it('GridDomainVersions includes filtering and sorting domains (Plan 084)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridDomainVersions.ts'), 'utf-8');
		expect(content).toContain('filtering: number');
		expect(content).toContain('sorting: number');
	});

	it('GridEngine exposes incrementDomain covering all 7 domains (Plan 084 → Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		// Plan 097: unified incrementDomain replaces per-domain increment callbacks
		expect(content).toContain('public incrementDomain(');
		expect(content).toContain("case 'columns'");
		expect(content).toContain("case 'rows'");
		expect(content).toContain("case 'geometry'");
		expect(content).toContain("case 'selection'");
		expect(content).toContain("case 'editing'");
		expect(content).toContain("case 'filtering'");
		expect(content).toContain("case 'sorting'");
	});

	it('subscribeDomain targeted API is present on GridEngine and GridApi (Plan 084)', () => {
		const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(engineContent).toContain('public subscribeDomain(');
		const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		const surfacesContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApiSurfaces.ts'), 'utf-8');
		expect(apiContent).toContain('GridRuntimeSubscriptionApi');
		expect(surfacesContent).toContain('subscribeDomain(');
	});

	it('StateManager.debugGetStateCount is removed — reads route through GridInstrumentation (Plan 085)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'StateManager.ts'), 'utf-8');
		expect(content).not.toContain('debugGetStateCount');
		expect(content).toContain('GridMetric.STATE_READS');
	});

	it('GridInstrumentation exposes get() for zero-allocation counter reads (Plan 085)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		expect(content).toContain('get(metric: GridMetric): number');
		expect(content).toContain('STATE_READS');
		expect(content).toContain('ROW_MUTATION_INCREMENTAL');
		expect(content).toContain('ROW_MUTATION_FULL_REBUILD');
		expect(content).toContain('SLOT_REBINDS');
	});

	it('GridInstrumentation does not duplicate RenderStats paint, scroll, or portal counters (Plan 111)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		expect(content).not.toContain('FULL_PAINTS');
		expect(content).not.toContain('ROW_PAINTS');
		expect(content).not.toContain('CELL_PAINTS');
		expect(content).not.toContain('HEADER_PAINTS');
		expect(content).not.toContain('OVERLAY_PAINTS');
		expect(content).not.toContain('VIEWPORT_PAINTS');
		expect(content).not.toContain('GEOMETRY_RECOMPUTES');
		expect(content).not.toContain('SCROLL_FRAMES');
		expect(content).not.toContain('VIEWPORT_RECYCLES');
		expect(content).not.toContain('SAME_WINDOW_BAILOUTS');
		expect(content).not.toContain('PORTAL_MOUNTS');
		expect(content).not.toContain('PORTAL_RELEASES');
		expect(content).not.toContain('PORTAL_FLUSHES');
		expect(content).not.toContain('PORTAL_DEFERRED');
	});

	it('NoopGridInstrumentation is described as minimal overhead, not zero overhead (Plan 111)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		expect(content).toContain('minimal overhead');
		expect(content).not.toContain('zero overhead');
	});

	it('GridEngine exposes instrumentation field and setInstrumentation (Plan 085)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain('public instrumentation: GridInstrumentation');
		expect(content).toContain('public setInstrumentation(');
	});

	it('RuntimePortBinding interface exists with generation field (Plan 086)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'rendererPorts.ts'), 'utf-8');
		expect(content).toContain('export interface RuntimePortBinding');
		expect(content).toContain('readonly generation: number');
		// Stable singleton headless ports must exist to avoid allocation on every unmount.
		expect(content).toContain('export const HEADLESS_PORTS');
	});

	it('gridHost.ts uses bindRuntimePorts/unbindRuntimePorts instead of setRendererPorts (Plan 086)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'gridHost.ts'), 'utf-8');
		expect(content).toContain('bindRuntimePorts(');
		expect(content).toContain('unbindRuntimePorts(');
		expect(content).not.toContain('setRendererPorts(');
		// ResizeObserver must guard against stale bindings.
		expect(content).toContain('isBindingCurrent(binding)');
	});

	it('deprecated setRendererPorts and createHeadlessPorts are deleted (Plan 090)', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const hostFacadeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreHostFacade.ts'), 'utf-8');
		expect(storeContent).not.toContain('setRendererPorts');
		expect(hostFacadeContent).not.toContain('setRendererPorts');
		const portsContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'rendererPorts.ts'), 'utf-8');
		expect(portsContent).not.toContain('createHeadlessPorts');
	});

	// ── Plan 087 — store.ts boundary enforcement ─────────────────────────────

	it('engine/ production files import GridEventName from api/GridEvents.ts, not store.ts (Plan 087)', () => {
		const engineDir = resolve(CORE_ROOT, 'src', 'engine');
		const files = collectSourceFiles(engineDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(path.relative(engineDir, file));
			}
		}
		expect(violators, `engine/ files still importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('state/ production files do not import from store.ts barrel (Plan 087)', () => {
		const stateDir = resolve(CORE_ROOT, 'src', 'state');
		const files = collectSourceFiles(stateDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(path.relative(stateDir, file));
			}
		}
		expect(violators, `state/ files still importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('production source files do not contain Plan NNN or Phase N: roadmap-chronology comments (Plan 088)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
		// Pattern: "(Plan NNN" or "Phase N:" or "Phase N —" or "(Phase N)"
		const roadmapPattern = /\(Plan \d+|\bPhase \d+[:\s—]|\(Phase \d+\)/;
		const violators: string[] = [];
		for (const file of allFiles) {
			const content = readFileSync(file, 'utf-8');
			if (roadmapPattern.test(content)) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `Production files with roadmap-chronology comments: ${violators.join(', ')}`).toHaveLength(0);
	});

	// ── Plan 089: core-target.md dependency enforcement ───────────────────────

	it('core-target.md architecture constitution exists at docs/architecture/core-target.md (Plan 089)', () => {
		const constitutionPath = resolve(CORE_ROOT, '../../docs/architecture/core-target.md');
		expect(existsSync(constitutionPath), 'docs/architecture/core-target.md must exist').toBe(true);
	});

	it('core package does not import from packages/react (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
		// Match only actual import/require statements, not comments mentioning the package name.
		// Covers: import ... from '@eregister/open-grid-react' and require('@eregister/open-grid-react')
		const reactImportPattern = /(?:from\s+|require\s*\(\s*)['"]@eregister\/open-grid-react['"]/;
		const violators: string[] = [];
		for (const file of allFiles) {
			const content = readFileSync(file, 'utf-8');
			if (reactImportPattern.test(content)) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `core files importing from react package: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('engine/, state/, models/, rows/ production files do not import React (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const protectedDirs = ['engine', 'state', 'models', 'rows'];
		const violators: string[] = [];
		for (const dir of protectedDirs) {
			const dirPath = resolve(srcDir, dir);
			if (!existsSync(dirPath)) continue;
			const files = collectSourceFiles(dirPath).filter((f) => !f.endsWith('.test.ts'));
			for (const file of files) {
				const content = readFileSync(file, 'utf-8');
				// Matches: from 'react', from "react", from 'react/', require('react')
				if (/from ['"]react['"/]|require\(['"]react['"]/.test(content)) {
					violators.push(path.relative(srcDir, file));
				}
			}
		}
		expect(violators, `domain layer files importing React: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('models/ production files do not import from renderer/ (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const modelsDir = resolve(srcDir, 'models');
		if (!existsSync(modelsDir)) return;
		const files = collectSourceFiles(modelsDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../renderer/") || content.includes('from "../renderer/')) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `models/ files importing from renderer/: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('renderer/ production files do not import from store.ts barrel (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const rendererDir = resolve(srcDir, 'renderer');
		const files = collectSourceFiles(rendererDir).filter((f) => !f.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const content = readFileSync(file, 'utf-8');
			if (content.includes("from '../store.js'") || content.includes('from "../store.js"')) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(violators, `renderer/ files importing from store.ts: ${violators.join(', ')}`).toHaveLength(0);
	});

	it('browser scheduling APIs (setTimeout/rAF/rIC) are restricted to frame-coordination files (Plan 089)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
		// Canonical sites: the only files that should schedule browser work.
		// Known exceptions document pre-existing usages that must be migrated in Plans 093–096.
		// Remove entries as each site is migrated; do not add new entries.
		const allowedFiles = new Set([
			// Canonical scheduling sites (Plan 089 target)
			resolve(srcDir, 'renderer', 'frameCoordinator.ts'),
			resolve(srcDir, 'renderer', 'gridScheduler.ts'),
			// Known exceptions — to be eliminated in Stage B plans
			resolve(srcDir, 'contextMenu.ts'), // focus + close delay
			resolve(srcDir, 'export', 'csvExport.ts'), // URL.revokeObjectURL cleanup
			resolve(srcDir, 'features', 'RowDragController.ts'), // scroll-animation rAF loop
			resolve(srcDir, 'persistence', 'statePersistence.ts'), // debounced auto-save
			resolve(srcDir, 'renderer', 'floatingFilterRenderer.ts'), // filter debounce + focus
			resolve(srcDir, 'renderer', 'headerMenuController.ts'), // filter debounce
			resolve(srcDir, 'renderer', 'scrollEngine.ts'), // scroll-end timer
			// Replay presentation pacing only: GridTraceReplay uses a replaceable scheduler
			// for cooperative DevTools replay turns, never renderer frame scheduling.
			resolve(srcDir, 'diagnostics', 'GridTraceReplay.ts'),
		]);
		const schedulingPattern = /\bsetTimeout\b|\brequestAnimationFrame\b|\brequestIdleCallback\b/;
		const violators: string[] = [];
		for (const file of allFiles) {
			if (allowedFiles.has(file)) continue;
			const content = readFileSync(file, 'utf-8');
			if (schedulingPattern.test(content)) {
				violators.push(path.relative(srcDir, file));
			}
		}
		expect(
			violators,
			`New files calling browser scheduling APIs outside the allowed set — add migration plan or route through frameCoordinator/gridScheduler: ${violators.join(', ')}`
		).toHaveLength(0);
	});

	it('GridTraceReplay keeps its timer exception behind injected replay scheduling', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridTraceReplay.ts'), 'utf-8');
		expect(content).toContain('export interface GridReplayScheduler');
		expect(content).toContain('options: { readonly scheduler?: GridReplayScheduler } = {}');
		expect(content).toContain('new GridTraceReplay(validation.trace, options.scheduler)');
	});

	it('contextMenu rAF is documented as interaction-only animation staging, not render scheduling (Plan 111)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'contextMenu.ts'), 'utf-8');
		expect(content).toContain('Interaction-only animation staging');
		expect(content).toContain("menu.classList.add('og-visible')");
	});

	it('RowDragController rAF usage is documented as interaction-only, not render scheduling (Plan 111)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'RowDragController.ts'), 'utf-8');
		expect(content).toContain('Interaction-only row-reorder animation staging');
		expect(content).toContain('Interaction-only drag auto-scroll loop');
		expect((content.match(/\brequestAnimationFrame\b/g) ?? []).length).toBe(4);
	});

	it('direct requestAnimationFrame usage is limited to gridScheduler and documented interaction exceptions (Plan 111)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allFiles = collectSourceFiles(srcDir).filter((file) => !file.endsWith('.test.ts'));
		const rafUsers = allFiles
			.filter((file) => readFileSync(file, 'utf-8').includes('requestAnimationFrame'))
			.map((file) => path.relative(srcDir, file).replaceAll('\\', '/'))
			.sort();
		expect(rafUsers).toEqual(['contextMenu.ts', 'features/RowDragController.ts', 'renderer/gridScheduler.ts']);
	});

	it('public index.ts does not re-export internal renderer or engine types (Plan 089)', () => {
		const indexPath = resolve(CORE_ROOT, 'src', 'index.ts');
		const content = readFileSync(indexPath, 'utf-8');
		// Renderer-internal types that must not appear in the public barrel
		const internalRendererTypes = [
			'RenderEngine',
			'ViewportRenderer',
			'RowRenderer',
			'CellRenderer',
			'PortalMountManager',
			'RowSlot',
			'CellSlot',
		];
		const violations: string[] = [];
		for (const t of internalRendererTypes) {
			// Match export { ... TypeName ... } or export type { ... TypeName ... }
			if (new RegExp(`\\b${t}\\b`).test(content)) {
				violations.push(t);
			}
		}
		expect(violations, `public index.ts re-exports renderer-internal types: ${violations.join(', ')}`).toHaveLength(0);
	});

	// ── Plan 090: feature surface triage ──────────────────────────────────────

	it('feature-registry.json exists and is valid JSON with required fields (Plan 090)', () => {
		const registryPath = resolve(CORE_ROOT, '../../docs/architecture/feature-registry.json');
		expect(existsSync(registryPath), 'docs/architecture/feature-registry.json must exist').toBe(true);
		const raw = readFileSync(registryPath, 'utf-8');
		let registry: { features?: unknown[]; alphaFeatureMatrix?: unknown[] };
		expect(() => {
			registry = JSON.parse(raw);
		}, 'feature-registry.json must be valid JSON').not.toThrow();
		registry = JSON.parse(raw);
		expect(Array.isArray(registry.features), 'feature-registry.json must have a features array').toBe(true);
		expect(Array.isArray(registry.alphaFeatureMatrix), 'feature-registry.json must have an alphaFeatureMatrix array').toBe(true);
		const validLevels = new Set(['foundation', 'reference', 'incubating', 'deferred']);
		const features = registry.features as Array<{ id?: unknown; level?: unknown }>;
		const badLevel = features.find((f) => !validLevels.has(f.level as string));
		expect(badLevel, `feature entry has invalid level: ${JSON.stringify(badLevel)}`).toBeUndefined();
		const missingId = features.find((f) => typeof f.id !== 'string' || !f.id);
		expect(missingId, `feature entry is missing id: ${JSON.stringify(missingId)}`).toBeUndefined();
	});

	it('deferred features are not directly imported by engine/ production files (Plan 090)', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const registryPath = resolve(CORE_ROOT, '../../docs/architecture/feature-registry.json');
		const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as {
			features: Array<{ id: string; level: string; modules?: string[]; knownCoupling?: string }>;
		};
		// Collect modules for deferred features
		const deferredModules = registry.features
			.filter((f) => f.level === 'deferred')
			.flatMap((f) => f.modules ?? [])
			.map((m) => path.basename(m)); // match by filename
		if (deferredModules.length === 0) return;
		// Known couplings are documented in the registry; only new couplings are violations
		const knownCouplings = new Set(
			registry.features
				.filter((f) => f.level === 'deferred' && f.knownCoupling)
				.map((f) => path.basename(f.knownCoupling!.split(' imports ')[0]))
		);
		const engineDir = resolve(srcDir, 'engine');
		const engineFiles = collectSourceFiles(engineDir).filter((f) => !f.endsWith('.test.ts') && !knownCouplings.has(path.basename(f)));
		const violators: string[] = [];
		for (const file of engineFiles) {
			const content = readFileSync(file, 'utf-8');
			for (const mod of deferredModules) {
				if (content.includes(mod.replace('.ts', ''))) {
					violators.push(`${path.relative(srcDir, file)} → ${mod}`);
				}
			}
		}
		expect(
			violators,
			`engine/ files with new deferred-feature imports (add knownCoupling to registry if intentional): ${violators.join(', ')}`
		).toHaveLength(0);
	});

	it('alpha feature matrix in feature-registry.json covers all foundation features (Plan 090)', () => {
		const registryPath = resolve(CORE_ROOT, '../../docs/architecture/feature-registry.json');
		const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as {
			features: Array<{ id: string; level: string }>;
			alphaFeatureMatrix: string[];
		};
		const foundationIds = registry.features.filter((f) => f.level === 'foundation').map((f) => f.id);
		const matrixSet = new Set(registry.alphaFeatureMatrix);
		const missing = foundationIds.filter((id) => !matrixSet.has(id));
		expect(missing, `foundation features missing from alphaFeatureMatrix: ${missing.join(', ')}`).toHaveLength(0);
	});

	// ── Plan 091: performance baseline laboratory ─────────────────────────────

	it('benchmark-scenarios.json exists and is valid JSON with scenarioVersion and scenarios array (Plan 091)', () => {
		const scenariosPath = resolve(CORE_ROOT, '../../docs/architecture/benchmark-scenarios.json');
		expect(existsSync(scenariosPath), 'docs/architecture/benchmark-scenarios.json must exist').toBe(true);
		const raw = readFileSync(scenariosPath, 'utf-8');
		let manifest: { scenarioVersion?: unknown; scenarios?: unknown[] };
		expect(() => {
			manifest = JSON.parse(raw);
		}, 'benchmark-scenarios.json must be valid JSON').not.toThrow();
		manifest = JSON.parse(raw);
		expect(typeof manifest.scenarioVersion, 'benchmark-scenarios.json must have a scenarioVersion field').toBe('string');
		expect(Array.isArray(manifest.scenarios), 'benchmark-scenarios.json must have a scenarios array').toBe(true);
		const scenarios = manifest.scenarios as Array<{ id?: unknown; level?: unknown }>;
		const missingId = scenarios.find((s) => typeof s.id !== 'string' || !s.id);
		expect(missingId, `scenario entry is missing id: ${JSON.stringify(missingId)}`).toBeUndefined();
	});

	it('baseline.json exists as pre-convergence metric snapshot (Plan 091)', () => {
		const baselinePath = resolve(CORE_ROOT, '../../docs/architecture/baseline.json');
		expect(existsSync(baselinePath), 'docs/architecture/baseline.json must exist').toBe(true);
		const raw = readFileSync(baselinePath, 'utf-8');
		let baseline: { capturedAt?: unknown; scenarios?: unknown[] };
		expect(() => {
			baseline = JSON.parse(raw);
		}, 'baseline.json must be valid JSON').not.toThrow();
		baseline = JSON.parse(raw);
		expect(typeof baseline.capturedAt, 'baseline.json must have a capturedAt field').toBe('string');
		expect(Array.isArray(baseline.scenarios), 'baseline.json must have a scenarios array').toBe(true);
	});

	it('Plan 112 foundation report exists with milestone artifact sections', () => {
		const reportPath = resolve(CORE_ROOT, '../../docs/architecture/plan-112-foundation-report.md');
		expect(existsSync(reportPath), 'docs/architecture/plan-112-foundation-report.md must exist').toBe(true);
		const report = readFileSync(reportPath, 'utf-8');
		for (const heading of [
			'# Plan 112: Alpha Foundation Report',
			'## Final Architecture',
			'## Alpha Feature Matrix',
			'## Benchmark and Correctness Evidence',
			'## Package and Real-App Integration Report',
			'## Clean-Checkout Command Transcript',
			'## Deleted-Path Inventory',
			'## Known Limitations',
		]) {
			expect(report).toContain(heading);
		}
	});

	it('plans README index includes the restored 050 and 103-112 entries', () => {
		const readmePath = resolve(CORE_ROOT, '../../plans/README.md');
		const readme = readFileSync(readmePath, 'utf-8');
		for (const needle of [
			'| 050 | [Rendering & Layout Pipeline Hardening]',
			'| 103 | [Canonical Mutation Authority and Direct-Write Demolition]',
			'| 104 | [Fault-Isolated Grid Change Commit Protocol]',
			'| 105 | [Declared Invalidation Authority and Reaction Demolition]',
			'| 106 | [Alpha Feature and Public API Surface Cut]',
			'| 107 | [Reproducible Workspace, Build, and Evidence Gate]',
			'| 108 | [Behavioral Contract Tests and Fuzz Expansion]',
			'| 109 | [Store Compatibility Hub and Boundary Demolition]',
			'| 110 | [Mandatory Physical Portal Identity and Adapter Lifecycle]',
			'| 111 | [Measured Scheduler and Hot-Path Simplification]',
			'| 112 | [Alpha Foundation Cut and Codebase Demolition]',
		]) {
			expect(readme).toContain(needle);
		}
	});

	it('ROW_MUTATION_INCREMENTAL and ROW_MUTATION_FULL_REBUILD are incremented in rowModel.ts (Plan 091)', () => {
		const rowModelPath = resolve(CORE_ROOT, 'src', 'rowModel.ts');
		const content = readFileSync(rowModelPath, 'utf-8');
		expect(content).toContain('GridMetric.ROW_MUTATION_FULL_REBUILD');
		expect(content).toContain('GridMetric.ROW_MUTATION_INCREMENTAL');
		expect(content).toContain('const inst = this.runtime.getInstrumentation();');
	});

	// ── Plan 092: aggregation input mutation correctness ─────────────────────

	it('aggregation-input is in RowMutationImpact and checked in classifyMutation (Plan 092)', () => {
		const classifierPath = resolve(CORE_ROOT, 'src', 'rows', 'rowMutationClassifier.ts');
		const content = readFileSync(classifierPath, 'utf-8');
		expect(content).toContain("'aggregation-input'");
		expect(content).toContain('aggregationFields');
		expect(content).toContain("return 'aggregation-input'");
	});

	it('structural transaction commit classifies update impact and triggers refresh for aggregation-input (Plan 092)', () => {
		const rowModelPath = resolve(CORE_ROOT, 'src', 'rowModel.ts');
		const mutationPath = resolve(CORE_ROOT, 'src', 'engine', 'GridDomainMutation.ts');
		const content = readFileSync(rowModelPath, 'utf-8');
		const mutationContent = readFileSync(mutationPath, 'utf-8');
		expect(content).toContain("impact === 'aggregation-input'");
		expect(mutationContent).toContain('structuralRowModel.classifyFieldMutation(allFields)');
	});

	// ── Plan 093: single RAF frame arbitration ────────────────────────────────

	it('DefaultFrameCoordinator uses a single rafId (not per-channel RAF handles) (Plan 093)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		// Single arbiter field
		expect(content).toContain('private rafId:');
		// Per-channel handles must not exist
		expect(content).not.toContain('scrollRafId');
		expect(content).not.toContain('paintRafId');
		expect(content).not.toContain('postScrollRafId');
	});

	it('DefaultFrameCoordinator uses pending bits (not per-channel scheduled flags) (Plan 093)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		expect(content).toContain('pendingScroll');
		expect(content).toContain('pendingPaint');
		expect(content).toContain('pendingPostScroll');
		// Legacy per-channel scheduled booleans must not exist
		expect(content).not.toContain('scrollScheduled');
		expect(content).not.toContain('paintScheduled');
		expect(content).not.toContain('postScrollScheduled');
	});

	it('DefaultFrameCoordinator has scheduleFrame and flushFrame private methods (Plan 093)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		expect(content).toContain('scheduleFrame()');
		expect(content).toContain('flushFrame()');
	});

	it('DefaultFrameCoordinator paint scheduling uses microtask coalescence to prevent duplicate frames (Plan 111 evidence)', () => {
		// Plan 111 completion gate: "Paint microtask is removed unless evidence proves it beneficial."
		// Evidence: without microtask coalescence, multiple synchronous invalidation events
		// (e.g., from selection change listeners) result in duplicate frames with same cells.
		// The microtask is required to prevent 2x render work on common operations.
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		expect(content).toContain('requestPaintFrame(changeIds: readonly number[] = []): void {');
		expect(content).toContain('this.pendingPaint = true;');
		expect(content).toContain('this.gs.microtask(() => {');
		expect(content).toContain('this.scheduleFrame();');
	});

	// ── Plan 094: exclusive runtime port binding ──────────────────────────────

	it('RuntimePortBindResult type exists in rendererPorts.ts (Plan 094)', () => {
		const portPath = resolve(CORE_ROOT, 'src', 'engine', 'rendererPorts.ts');
		const content = readFileSync(portPath, 'utf-8');
		expect(content).toContain('RuntimePortBindResult');
		expect(content).toContain("'already-bound'");
		expect(content).toContain("'destroyed'");
	});

	it('bindRuntimePorts returns RuntimePortBindResult and rejects concurrent binds (Plan 094)', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const hostFacadeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreHostFacade.ts'), 'utf-8');
		expect(storeContent).toContain('createGridStoreHostFacade');
		expect(hostFacadeContent).toContain('RuntimePortBindResult');
		// Must return early on already-bound without touching ports
		expect(hostFacadeContent).toContain("reason: 'already-bound'");
		expect(hostFacadeContent).toContain("reason: 'destroyed'");
		// storeDestroyed flag
		expect(storeContent).toContain('storeDestroyed');
	});

	it('unbindRuntimePorts reports a fault on stale tokens instead of silently ignoring (Plan 094)', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const hostFacadeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreHostFacade.ts'), 'utf-8');
		expect(storeContent).toContain('this.hostFacade.unbindRuntimePorts(binding)');
		expect(hostFacadeContent).toContain("operation: 'unbindRuntimePorts'");
	});

	it('gridHost.ts checks bindResult.ok before mounting (Plan 094)', () => {
		const hostPath = resolve(CORE_ROOT, 'src', 'gridHost.ts');
		const content = readFileSync(hostPath, 'utf-8');
		expect(content).toContain('bindResult');
		expect(content).toContain('bindResult.ok');
		expect(content).toContain('bindResult.binding');
	});

	// ── Plan 095: portal flush phase contract ─────────────────────────────────

	it('canFlushPortals() does not allow paint-frame (Plan 095)', () => {
		const rrPath = resolve(CORE_ROOT, 'src', 'renderer', 'renderRuntimeState.ts');
		const content = readFileSync(rrPath, 'utf-8');
		// Must NOT use paint-frame as an allowed phase for portal flushing
		// (it was removed in Plan 095)
		const canFlushMatch = content.match(/canFlushPortals\(\)[^}]+\}/s);
		expect(canFlushMatch, 'canFlushPortals method must exist').toBeTruthy();
		expect(canFlushMatch![0]).not.toContain("'paint-frame'");
	});

	it('withPortalFlushPermission exists and uses _portalFlushActive (Plan 095)', () => {
		const rrPath = resolve(CORE_ROOT, 'src', 'renderer', 'renderRuntimeState.ts');
		const content = readFileSync(rrPath, 'utf-8');
		expect(content).toContain('withPortalFlushPermission');
		expect(content).toContain('_portalFlushActive');
		expect(content).toContain('nested portal flush');
	});

	// ── Plan 096: frame epoch and post-scroll durability ─────────────────────

	it('FrameCoordinator owns scroll-frame/post-scroll transitions — not renderScrollCoordinator (Plan 096→098)', () => {
		const rscContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		const fcContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// Phase transitions must live in FrameCoordinator, not in the scroll coordinator callback.
		expect(rscContent).not.toContain("transitionTo('scroll-frame')");
		expect(rscContent).not.toContain("transitionTo('post-scroll')");
		// FrameCoordinator wraps the onScrollFrame callback with the transitions.
		expect(fcContent).toContain("transitionTo('scroll-frame')");
		expect(fcContent).toContain("transitionTo('post-scroll')");
	});

	it('flushFrame retains pendingPostScroll when epoch is valid but scrolling is active (Plan 096)', () => {
		const fcPath = resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts');
		const content = readFileSync(fcPath, 'utf-8');
		// Must check isScrolling and isFrameActive before running post-scroll work.
		expect(content).toContain('isScrolling()');
		expect(content).toContain('isFrameActive()');
		// Must NOT clear pendingPostScroll unconditionally — the retain comment must exist.
		expect(content).toContain('Retain pendingPostScroll');
	});

	// ── Plan 097: canonical domain command and mutation boundary ─────────────

	it('GridCommit.domains field is declared on the commit kernel module (Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		expect(content).toContain('domains?: ReadonlyArray<keyof GridDomainVersions>');
		expect(content).toContain('publishDomains?:');
	});

	it('GridCommitKernel.commit increments declared domains before events (Plan 097)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		// Domain increments must precede event dispatch — enforced by comment order in apply()
		expect(content).toContain('Increment declared domain versions');
		expect(content).toContain('Dispatch events');
		const incrementPos = content.indexOf('Increment declared domain versions');
		const dispatchPos = content.indexOf('Dispatch events');
		expect(incrementPos).toBeLessThan(dispatchPos);
	});

	it('legacy GridStateReactionController file is gone and projection is wired through the commit kernel', () => {
		expect(existsSync(resolve(CORE_ROOT, 'src', 'engine', 'GridStateReactionController.ts'))).toBe(false);
		const applierContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		expect(applierContent).toContain('projectStateChange?: (phase: StateCommitPhase<TRowData>) => void;');
		expect(applierContent).toContain('stateManager.commitState(mergedState');
	});

	it('feature controllers declare domains on their GridChange objects (Plan 097)', () => {
		const columnCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'ColumnFeatureController.ts'), 'utf-8');
		expect(columnCtrl).toContain("domains: ['columns', 'geometry']");
		const groupCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GroupingFeatureController.ts'), 'utf-8');
		expect(groupCtrl).toContain("domains: ['rows']");
		const editCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'EditingFeatureController.ts'), 'utf-8');
		expect(editCtrl).toContain("domains: ['editing']");
		const selCtrl = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'RowSelectionFeatureController.ts'), 'utf-8');
		expect(selCtrl).toContain("domains: ['selection']");
	});

	// ── Plan 098: render runtime convergence and demolition ──────────────────

	it('FrameCoordinator absorbs scroll-end detection — no second RAF loop in renderScrollCoordinator (Plan 098)', () => {
		const rscContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderScrollCoordinator.ts'), 'utf-8');
		// These fields and methods were removed in Plan 098 — FrameCoordinator owns scroll-end detection.
		expect(rscContent).not.toContain('scrollEndRafId');
		expect(rscContent).not.toContain('scrollEndTickerActive');
		expect(rscContent).not.toContain('scrollEndTick');
		expect(rscContent).not.toContain('scheduleScrollEnd');
		expect(rscContent).not.toContain('clearScrollEndTimer');
	});

	it('FrameCoordinator scroll-end detection uses quiet-frame counter (Plan 098)', () => {
		const fcContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// Single RAF loop with scroll-end detection via quiet frame counting.
		expect(fcContent).toContain('scrollEndQuietCount');
		expect(fcContent).toContain('scrollEndQuietThreshold');
		expect(fcContent).toContain('onScrollEnd');
		// Scroll-end fires after transitioning to idle — safe ordering.
		expect(fcContent).toContain("transitionTo('idle')");
	});

	it('FrameCoordinator keeps RAF alive while isScrolling (Plan 098)', () => {
		const fcContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'frameCoordinator.ts'), 'utf-8');
		// keepAlive logic: re-schedules if scrolling continues.
		expect(fcContent).toContain('isScrolling()');
		expect(fcContent).toContain('keepAlive');
	});

	it('renderEngine wires onScrollEnd to scrollCoordinator.finishScrolling (Plan 098)', () => {
		const reContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderEngine.ts'), 'utf-8');
		// onScrollEnd callback must delegate to finishScrolling.
		expect(reContent).toContain('onScrollEnd');
		expect(reContent).toContain('finishScrolling');
		// Deleted forwarding methods must be gone.
		expect(reContent).not.toContain('scheduleScrollEnd');
		expect(reContent).not.toContain('clearScrollEndTimer');
	});

	// ── Plan 099: Row model and derived data authority ───────────────────────

	it('VisualRowModel interface is defined in rowModel.ts (Plan 099)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('export interface VisualRowModel<');
		// Core renderer-facing methods must be present.
		expect(content).toContain('getVisualRow(');
		expect(content).toContain('getVisualRowCount():');
		expect(content).toContain('getVisualIndexById(');
		expect(content).toContain('getVisualIndexByRowId(');
	});

	it('RowModel extends the viewport/load contract (Plan 099 / Plan 156)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('export interface RowModelViewportAccess<TRowData = unknown> extends VisualRowModel<TRowData>');
		expect(content).toContain('RowModel<TRowData = unknown> extends RowModelViewportAccess<TRowData>');
	});

	it('RowModel is the slim shared contract; optional mutation/paging hooks live in named capabilities', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		const rowModelSection = content.slice(content.indexOf('export interface RowModel<TRowData = unknown>'));
		expect(content).toContain('export interface RowExpansionCapableModel<TRowData = unknown>');
		expect(content).toContain('export interface SelectableDataRowModel');
		expect(content).toContain('export interface PageWindowCapableRowModel');
		expect(content).toContain('export interface AllDataNodesCapableRowModel<TRowData = unknown>');
		expect(content).toContain('export interface VisibleBlockLoadCapableRowModel');
		expect(rowModelSection).not.toContain('getSelectableDataRowIds?');
		expect(rowModelSection).not.toContain('getPageWindow?');
		expect(rowModelSection).not.toContain('getAllDataNodes?');
		expect(rowModelSection).not.toContain('setRows?');
		expect(rowModelSection).not.toContain('updateRows?');
		expect(rowModelSection).not.toContain('getRowOrder?');
		expect(rowModelSection).not.toContain('setRowOrder?');
		expect(rowModelSection).not.toContain('setDatasource?');
		expect(rowModelSection).not.toContain('goToPage?');
		expect(rowModelSection).not.toContain('setCellValue?');
		expect(rowModelSection).not.toContain('loadVisibleBlocks?');
	});

	it('GridEngine exposes getVisualRowModel() for renderer-agnostic row access (Plan 099)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain('getVisualRowModel()');
		expect(content).toContain('VisualRowModel<TRowData>');
	});

	it('renderer core paths use getVisualRowModel(), not getRowModel() (Plan 099)', () => {
		// These are the pure visual rendering paths that must not touch mutation APIs.
		const renderWindowContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderWindow.ts'), 'utf-8');
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(renderWindowContent).toContain('getVisualRowModel()');
		expect(renderWindowContent).not.toContain('engine.getRowModel()');
		expect(rowModelContent).toContain('export interface StickyGroupMetaCapableVisualRowModel');
		expect(rowModelContent).toContain('export function asStickyGroupMetaCapableVisualRowModel(');
		expect(renderWindowContent).toContain('function getStickyGroupMeta(');
		expect(renderWindowContent).not.toContain('rowModel?.getStickyGroupMeta?.()');

		const geometryContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'geometryController.ts'), 'utf-8');
		expect(geometryContent).toContain('getVisualRowModel()');
		expect(geometryContent).not.toContain('engine.getRowModel()');

		const maintenanceContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRenderMaintenance.ts'), 'utf-8');
		expect(maintenanceContent).toContain('getVisualRowModel()');
		expect(maintenanceContent).not.toContain('engine.getRowModel()');
	});

	// ── Plan 100: physical renderer and adapter contract ─────────────────────

	it('GridCellContentMount.slotGeneration is required (not optional) (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		expect(content).toContain('slotGeneration: number;');
		expect(content).not.toContain('slotGeneration?: number');
	});

	it('GridCellContentMount.rowSlotId is required (not optional) (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		expect(content).toContain('rowSlotId: string;');
		expect(content).not.toContain('rowSlotId?: string');
	});

	it('React portal store requires physical identity for pooled cell mounts (Plan 110)', () => {
		const content = readFileSync(resolve(REACT_ROOT, 'src', 'gridPortalTypes.ts'), 'utf-8');
		expect(content).toContain('export interface CellPortalPhysicalIdentity');
		// All 5 required fields (Plan 121)
		expect(content).toContain('cellInstanceId: string;');
		expect(content).toContain('rowSlotId: string;');
		expect(content).toContain('slotGeneration: number;');
		expect(content).toContain('rowBindingGeneration: number;');
		expect(content).toContain('portalHostId: string;');
		expect(content).toContain('physicalIdentity: CellPortalPhysicalIdentity;');
	});

	it('GridCellContentUnmount.slotGeneration is required (not optional) (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'IGridRenderer.ts'), 'utf-8');
		// GridCellContentUnmount section: must have required slotGeneration
		const unmountSection = content.slice(content.indexOf('GridCellContentUnmount'));
		expect(unmountSection).toContain('slotGeneration: number;');
	});

	it('PortalMountManager exposes active physical identity accessors for deferred release capture (Plan 110)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		expect(content).toContain('getActiveGeneration(');
		expect(content).toContain('getActiveIdentity(');
		expect(content).toContain('activeIdentityByKey.get(');
	});

	it('stale-detection guards in portalMountManager no longer have redundant !== undefined checks (Plan 100)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		expect(content).not.toContain('slotGeneration !== undefined');
	});

	it('releaseCellPortal captures physical identity at scheduling time via getActiveIdentity (Plan 110)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRendererRuntime.ts'), 'utf-8');
		expect(content).toContain('getActiveIdentity(cellKey)');
		expect(content).toContain('rowSlotId,');
		expect(content).toContain('slotGeneration,');
	});

	it('pooled portal identity fallbacks are deleted from renderer release paths', () => {
		const portalManager = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'portalMountManager.ts'), 'utf-8');
		const rowRuntime = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowRendererRuntime.ts'), 'utf-8');
		expect(portalManager).not.toContain('slotGeneration ?? 0');
		expect(portalManager).not.toContain('__unknown_slot__');
		expect(rowRuntime).not.toContain('slotGeneration ?? 0');
		expect(rowRuntime).not.toContain('__unknown_slot__');
	});

	// ── Plan 101: public API and package boundary reset ───────────────────────

	it('core/index.ts does not import from rows/stages/ internal path (Plan 101)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(content).not.toContain('rows/stages/');
	});

	it('core/index.ts does not import from features/ internal path (Plan 101)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(content).not.toContain("from './features/");
	});

	it('core/index.ts exports VisualRowModel (read-only renderer contract) not RowModel (Plan 101)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(content).toContain('VisualRowModel');
		expect(content).not.toContain('{ RowModel }');
	});

	it('AggregationDef is re-exported through rowModel.ts (stable path) not directly from rows/stages/ (Plan 101)', () => {
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).toContain('AggregationDef');
		const indexContent = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(indexContent).toContain('AggregationDef');
		expect(indexContent).not.toContain('rows/stages/');
	});

	it('BatchCellValueUpdate is defined in api/GridApi.ts (public API location) not features/ (Plan 101)', () => {
		const gridApiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		expect(gridApiContent).toContain('BatchCellValueUpdate');
	});

	// ── Plan 102: adversarial correctness, fuzzing, and lifecycle hardening ──

	it('applyClientSortAndFilter is exported from rowModel.ts for use as a reference model in differential tests (Plan 102)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('export function applyClientSortAndFilter');
	});

	it('ClientRowModelController exposes dispose() that clears its unsubscribers list (Plan 102)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('public dispose()');
		// Must clear the array so a second call is safe and subscription count can be verified.
		expect(content).toContain('this.unsubscribers = []');
	});

	it('ClientRowModelController exposes getAllDataNodes() for reference-model construction (Plan 102)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(content).toContain('getAllDataNodes');
	});

	it('adversarial test files exist and are not empty (Plan 102)', () => {
		const adversarialPath = resolve(CORE_ROOT, 'src', 'rowModel.adversarial.test.ts');
		const lifecyclePath = resolve(CORE_ROOT, 'src', 'lifecycle.adversarial.test.ts');
		expect(existsSync(adversarialPath), 'rowModel.adversarial.test.ts must exist').toBe(true);
		expect(existsSync(lifecyclePath), 'lifecycle.adversarial.test.ts must exist').toBe(true);
		const adversarialContent = readFileSync(adversarialPath, 'utf-8');
		const lifecycleContent = readFileSync(lifecyclePath, 'utf-8');
		// Must contain property-based differential tests, not source-string assertions.
		expect(adversarialContent).toContain('applyClientSortAndFilter');
		expect(adversarialContent).toContain('makeLcg');
		// Must cover the destroy-terminal invariant.
		expect(lifecycleContent).toContain('dispose()');
		expect(lifecycleContent).toContain('destroy()');
	});

	it('adversarial test files do not call Math.random() — PRNG must be seeded (Plan 102)', () => {
		const adversarialPath = resolve(CORE_ROOT, 'src', 'rowModel.adversarial.test.ts');
		const lifecyclePath = resolve(CORE_ROOT, 'src', 'lifecycle.adversarial.test.ts');
		const adversarialContent = readFileSync(adversarialPath, 'utf-8');
		const lifecycleContent = readFileSync(lifecyclePath, 'utf-8');
		expect(adversarialContent, 'adversarial tests must use a seeded PRNG, not Math.random()').not.toContain('Math.random()');
		expect(lifecycleContent, 'lifecycle tests must not use Math.random()').not.toContain('Math.random()');
	});

	// ── Plan 103: alpha foundation cut and codebase demolition ────────────────

	it('deprecated getVisualRowIndexById is removed from RowModel and VisualRowModel (Plan 103)', () => {
		const rowModelContent = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
		expect(rowModelContent).not.toContain('getVisualRowIndexById');
	});

	it('deprecated getVisualRowIndexById is removed from GridStore and GridApi interfaces (Plan 103)', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(storeContent).not.toContain('getVisualRowIndexById');
		const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		expect(apiContent).not.toContain('getVisualRowIndexById');
	});

	it('contextMenu uses getVisualIndexByRowId (data row ID) not the deleted alias (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'contextMenu.ts'), 'utf-8');
		expect(content).not.toContain('getVisualRowIndexById');
		expect(content).toContain('getVisualIndexByRowId');
	});

	it('deprecated batch() callback is removed from GridCompositionRuntime interface (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		// The @deprecated batch(callback) escape hatch must no longer be on the interface.
		expect(content).not.toContain('batch(callback: () => void): void;');
	});

	it('GridStore does not expose a public batch() method (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).not.toContain('public batch =');
	});

	it('Plan 103 direct-write allowlist is checked in with explicit justifications', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'gridDirectWriteAllowlist.ts'), 'utf-8');
		expect(content).toContain('GRID_DIRECT_WRITE_ALLOWLIST');
		expect(content).toContain('justification');
	});

	it('raw stateManager.setState writes stay inside the Plan 103 allowlist', () => {
		const srcDir = resolve(CORE_ROOT, 'src');
		const allowlistContent = readFileSync(resolve(srcDir, 'engine', 'gridDirectWriteAllowlist.ts'), 'utf-8');
		const allowlistedFiles = new Set(parseAllowlistedFiles(allowlistContent));
		const directWritePattern = /\bstateManager\.setState\(/;
		const files = collectSourceFiles(srcDir).filter((file) => !file.endsWith('.test.ts'));
		const violators: string[] = [];
		for (const file of files) {
			const rel = path.relative(srcDir, file).replace(/\\/g, '/');
			const content = readFileSync(file, 'utf-8');
			if (!directWritePattern.test(content)) continue;
			if (!allowlistedFiles.has(rel)) {
				violators.push(rel);
			}
		}
		expect(
			violators,
			`New raw stateManager.setState sites must be added to the explicit Plan 103 allowlist with justification: ${violators.join(', ')}`
		).toHaveLength(0);
	});

	it('floating filter renderer expresses filter intent through engine.setFilterModel (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'floatingFilterRenderer.ts'), 'utf-8');
		expect(content).toContain('this.engine.setFilterModel(');
		expect(content).not.toContain('this.engine.stateManager.setState({ filterModel');
	});

	it('pagination bar renderer expresses page changes through engine.setPaginationPage (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'paginationBarRenderer.ts'), 'utf-8');
		expect(content).toContain('this.engine.setPaginationPage(');
		expect(content).not.toContain('this.engine.stateManager.setState({ pagination');
	});

	it('store floating-filter toggle no longer mutates state directly (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).toContain('this.engine.setShowFloatingFilters(enabled);');
		expect(content).not.toContain('this.engine.stateManager.setState({ showFloatingFilters: enabled })');
	});

	it('store hidden-column filter cleanup routes through engine.setFilterModel (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).toContain('this.engine.setFilterModel(Object.keys(newModel).length > 0 ? newModel : null, false);');
		expect(content).not.toContain('this.engine.stateManager.setState({ filterModel: Object.keys(newModel).length > 0 ? newModel : null })');
	});

	it('store bulk row-height APIs route through GridEngine stateFeature wrappers (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).toContain('this.engine.setRowHeights(next);');
		expect(content).toContain('this.engine.setDefaultRowHeight(defaultRowHeight);');
		expect(content).not.toContain('this.engine.setState({ rowHeights: next })');
		expect(content).not.toContain('this.engine.setState({ defaultRowHeight })');
	});

	it('row-model runtime factory no longer writes state directly (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'createRowModelRuntimes.ts'), 'utf-8');
		expect(content).not.toContain('store.setState(');
		expect(content).toContain('store.engine.initializeRowModelState(model)');
		expect(content).toContain('store.engine.bumpRowModelGlobalVersion()');
		expect(content).toContain('store.engine.setRowModelLoadingState(loading)');
		expect(content).toContain('store.engine.setServerPaginationState(payload)');
	});

	it('store UI compatibility helpers route through GridEngine intent methods (Plan 103)', () => {
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const hostFacadeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreHostFacade.ts'), 'utf-8');
		expect(storeContent).toContain('this.engine.setRowOverscanPx(px);');
		expect(storeContent).toContain('this.engine.setSidebarOpenPanel(panelId);');
		expect(storeContent).toContain('this.engine.setSidebarOpenPanel(null);');
		expect(storeContent).toContain('this.engine.setChartOpen(true);');
		expect(storeContent).toContain('this.engine.setChartOpen(false);');
		expect(storeContent).toContain('setThemeName: (themeName) => this.engine.setThemeName(themeName)');
		expect(hostFacadeContent).toContain('deps.setThemeName(themeName);');
		expect(storeContent).not.toContain('this.setState({ rowOverscanPx: px })');
		expect(storeContent).not.toContain('this.setState({ sidebarOpenPanel:');
		expect(storeContent).not.toContain('this.setState({ chartOpen:');
		expect(storeContent).not.toContain('this.setState({ themeName');
	});

	it('store raw mutation surface no longer exposes compatibility setState forwarding (Plan 112 pre-gate)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).not.toContain('public setState =');
		expect(content).not.toContain('private set state(');
	});

	it('stable package entrypoints do not re-export mutable runtime state aliases (Plan 112 pre-gate)', () => {
		const coreIndex = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
		const coreStore = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const gridApi = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
		const reactIndex = readFileSync(resolve(REACT_ROOT, 'src', 'index.ts'), 'utf-8');
		const reactTypes = readFileSync(resolve(REACT_ROOT, 'src', 'types.ts'), 'utf-8');

		expect(coreIndex).not.toContain('GridInitialState, GridState, Listener');
		expect(coreIndex).not.toContain('GridInitialState, Listener');
		expect(coreIndex).not.toContain('export type { InternalGridState');
		expect(coreStore).not.toContain("export * from './state/GridState.js';");
		expect(coreStore).not.toContain('export type { GridInitialState, GridState');
		expect(coreStore).not.toContain('export type { GridInitialState, Listener');
		expect(coreStore).not.toContain('export type { InternalGridState');
		expect(gridApi).not.toContain('export type { GridState,');
		expect(gridApi).not.toContain('export type { InternalGridState');
		expect(reactIndex).not.toContain('GridApi,\n\tGridCellClickParams,\n\tGridState,');
		expect(reactTypes).not.toContain('GridInitialState,\n\tGridState,');
		expect(reactTypes).not.toContain('InternalGridState');
	});

	it('internal entry stays adapter-only and does not expose runtime bridge helpers (Plan 112)', () => {
		const internalEntry = readFileSync(resolve(CORE_ROOT, 'src', 'internal.ts'), 'utf-8');
		expect(internalEntry).not.toContain('resolveGridRuntimeComposition');
		expect(internalEntry).not.toContain('resolveGridHostComposition');
		expect(internalEntry).not.toContain('registerGridRuntimeComposition');
		expect(internalEntry).not.toContain('resolveGridPluginController');
		expect(internalEntry).not.toContain('GridStore');
	});

	it('internal runtime bridge stores a composed private runtime handle instead of GridStore (Plans 112/117)', () => {
		const bridge = readFileSync(resolve(CORE_ROOT, 'src', 'internal', 'apiInternalBridge.ts'), 'utf-8');
		expect(bridge).toContain('export interface GridHostComposition');
		expect(bridge).toContain('export interface GridRuntimeComposition');
		expect(bridge).toContain('host: GridHostComposition<TRowData>;');
		expect(bridge).toContain('api: InternalGridApi<TRowData>;');
		expect(bridge).toContain('pluginController: GridPluginController<TRowData>;');
		expect(bridge).toContain('setContainerElement(container: HTMLElement): void;');
		expect(bridge).toContain('registerGridRuntimeComposition');
		expect(bridge).toContain('resolveGridRuntimeComposition');
		expect(bridge).toContain('resolveGridHostComposition');
		expect(bridge).not.toContain("from '../store.js'");
		expect(bridge).not.toContain('WeakMap<GridApi<unknown>, GridStore<unknown>>');
	});

	it('gridHost mounts against the host composition handle instead of a concrete GridStore (Plans 112/117)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'gridHost.ts'), 'utf-8');
		expect(content).toContain('resolveGridRuntimeComposition(api)');
		expect(content).toContain('const host = runtime.host;');
		expect(content).toContain('const internalApi = host.api;');
		expect(content).toContain('host.setContainerElement(container);');
		expect(content).not.toContain('resolveGridInternalStore(api)');
		expect(content).not.toContain('const store =');
	});

	it('public core entry does not export createApiFacade (Plan 117)', () => {
		const coreIndex = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
		expect(coreIndex).not.toContain('createApiFacade');
	});

	it('private runtime composition root is created from an internal module (Plan 117)', () => {
		const createGrid = readFileSync(resolve(CORE_ROOT, 'src', 'createGrid.ts'), 'utf-8');
		const composition = readFileSync(resolve(CORE_ROOT, 'src', 'internal', 'createGridRuntimeComposition.ts'), 'utf-8');
		expect(createGrid).toContain("from './internal/createGridRuntimeComposition.js'");
		expect(createGrid).toContain('createGridRuntimeComposition({');
		expect(composition).toContain('export function createGridRuntimeComposition');
		expect(composition).toContain('registerGridRuntimeComposition');
	});

	it('gridHost adapter types do not depend on store.ts type exports (Plan 112)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'gridHost.ts'), 'utf-8');
		expect(content).toContain("import type { CellState, GridApi, GridCellAccess, GridCellPointer } from './api/GridApi.js';");
		expect(content).not.toContain("import('./store.js').GridCellPointer");
		expect(content).not.toContain("import('./store.js').GridCellAccess");
		expect(content).not.toContain("import('./store.js').CellState");
	});

	it('GridStateFeatureController no longer contains raw write fallbacks (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridStateFeatureController.ts'), 'utf-8');
		expect(content).toContain('applyChange: (change: GridCommit<TRowData>) => GridCommitResult;');
		expect(content).not.toContain('applyChange?:');
		expect(content).not.toContain('stateManager.setState(');
		expect(content).not.toContain('invalidateGeometry(');
		expect(content).not.toContain('invalidateViewport(');
		expect(content).not.toContain('dispatchEvent(');
	});

	it('store pinned column sync routes through engine.setPinnedColumnsState (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		expect(content).toContain(
			'this.engine.setPinnedColumnsState(this.viewportController.pinLeftColumns, this.viewportController.pinRightColumns);'
		);
		expect(content).not.toContain('this.engine.setState(');
	});

	it('GridEngine setData and range selection route through GridCommitKernel (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain("reason: 'columns:set-data'");
		expect(content).toContain("reason: 'selection:set-range'");
	});

	it('GridEngine row-model registration routes state effects through GridCommitKernel (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain("reason: 'rows:register-model'");
		expect(content).not.toContain("this.invalidation.invalidateFull('row model registered')");
		expect(content).not.toContain("this.requestRender('row model registered')");
	});

	it('GridEngine row-model helper commits route through GridCommitKernel (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain("reason: 'rows:initialize-model'");
		expect(content).toContain("reason: 'rows:bump-global-version'");
		expect(content).toContain("reason: 'rows:update-expansion'");
		expect(content).toContain("reason: 'rows:set-loading-state'");
		expect(content).toContain("reason: 'rows:set-server-pagination'");
		expect(content).not.toContain('if (Object.keys(nextState).length > 0) this.stateManager.setState(nextState);');
		expect(content).not.toContain('this.stateManager.setState((state) => ({ globalVersion: state.globalVersion + 1 }));');
		expect(content).not.toContain('this.stateManager.setState((state) => ({ expansion: updater(state.expansion) }));');
		expect(content).not.toContain('this.stateManager.setState((state) => ({ loading, globalVersion: state.globalVersion + 1 }));');
		expect(content).not.toContain('this.stateManager.setState({ serverPagination: payload });');
	});

	it('viewportController routes visible range commits through GridEngine intent methods (Plan 103)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'viewportController.ts'), 'utf-8');
		expect(content).toContain('this.engine.setVisibleRanges(rowRange, colRange);');
		expect(content).not.toContain('this.engine.stateManager.setState({');
	});

	it('GridCommitKernel exposes explicit commit results and non-recursive history records (Plan 104)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
		expect(content).toContain('export class GridCommitKernel<TRowData = unknown>');
		expect(content).toContain('commit(change: GridCommit<TRowData>): GridCommitResult');
		expect(content).toContain('apply(change: GridChange<TRowData>): GridCommitResult');
		expect(content).toContain("status: 'committed'");
		expect(content).toContain("status: 'noop'");
		expect(content).toContain("status: 'rejected'");
		expect(content).toContain("status: 'failed-before-commit'");
		expect(content).toContain('faults: readonly RuntimeFault[]');
		expect(content).toContain('history?: GridHistoryEntry<TRowData>;');
		expect(content).toContain('events?: GridCommitEvent<TRowData>[];');
		expect(content).not.toContain('undo?: GridChange<TRowData>;');
		expect(content).not.toContain('redo?: GridChange<TRowData>;');
	});

	it('feature mutation contexts surface GridCommitResult explicitly (Plan 104)', () => {
		const featureCtx = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridFeatureContext.ts'), 'utf-8');
		const stateFeature = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridStateFeatureController.ts'), 'utf-8');
		expect(featureCtx).toContain('applyChange: (change: GridCommit<TRowData>) => GridCommitResult;');
		expect(stateFeature).toContain('applyChange: (change: GridCommit<TRowData>) => GridCommitResult;');
	});

	it('CommandHistory reports rejected and failed-before-commit outcomes instead of dropping them (Plan 104)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'commands', 'CommandHistory.ts'), 'utf-8');
		expect(content).toContain('import type { GridCommitResult }');
		expect(content).toContain('isGridCommitResult');
		expect(content).toContain("result.status === 'failed-before-commit'");
		expect(content).toContain("result.status === 'committed'");
		expect(content).toContain("this.reportCommitOutcome('undo', result);");
		expect(content).toContain("this.reportCommitOutcome('redo', result);");
	});

	it('projection pipeline owns derived selection synchronization instead of a reaction controller', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridProjectionPipeline.ts'), 'utf-8');
		expect(content).toContain('export class GridProjectionPipeline');
		expect(content).toContain('phase.setDerivedState({ selection })');
		expect(content).not.toContain('eventBus.addEventListener');
	});

	it('GridEngine applySelectionRange owns selection and focus event publication (Plan 112)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
		expect(content).toContain('const events: GridCommitEvent<TRowData>[] = [];');
		expect(content).toContain('GridEventName.selectionChanged');
		expect(content).toContain('GridEventName.focusChanged');
		expect(content).toContain("reason: 'selection:set-range'");
		expect(content).toContain("reason: 'selection' as const");
		expect(content).not.toContain('const selection = this.selection.setSelection(');
	});

	it('RenderInvalidationCoordinator no longer infers edit/validation paints from state keys (Plan 105)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		expect(content).not.toContain("subscribeToKey('activeEdit'");
		expect(content).not.toContain("subscribeToKey('validationErrors'");
	});

	it('RenderInvalidationCoordinator no longer requests selection flushes from rowSelectionChanged directly (Plan 105)', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		expect(content).not.toContain('GridEventName.rowSelectionChanged');
		expect(content).not.toContain("invalidateOverlay('selection')");
		expect(content).not.toContain("invalidateHeaders('selection')");
		expect(content).not.toContain("requestFlushGated('selection')");
	});

	it('RenderInvalidationCoordinator derives focus-follow scrolling from interaction state instead of selectionChanged payloads', () => {
		const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		expect(content).toContain("import { readInteractionState } from '../interaction/interactionState.js';");
		expect(content).toContain('const interaction = readInteractionState(this.deps.engine.stateManager.getState());');
		expect(content).toContain('const selection = interaction.cellSelection.selection;');
		expect(content).not.toContain('const { selection } = event.payload;');
	});

	it('layout-panel commands own showGroupPanel/showFloatingFilters/showFilterChipBar invalidation instead of RenderInvalidationCoordinator (Plan 105)', () => {
		const groupingContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GroupingFeatureController.ts'), 'utf-8');
		const stateContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridStateFeatureController.ts'), 'utf-8');
		const ricContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		expect(groupingContent).toContain("reason: 'grouping:set-panel'");
		expect(groupingContent).toContain("{ kind: 'geometry', reason: 'showGroupPanel' }");
		expect(groupingContent).toContain("{ kind: 'viewport', reason: 'showGroupPanel' }");
		expect(stateContent).toContain("{ kind: 'geometry', reason: 'showFloatingFilters' }");
		expect(stateContent).toContain("{ kind: 'viewport', reason: 'showFloatingFilters' }");
		expect(stateContent).toContain("reason: 'ui:set-filter-chip-bar'");
		expect(stateContent).toContain("{ kind: 'geometry', reason: 'showFilterChipBar' }");
		expect(stateContent).toContain("{ kind: 'viewport', reason: 'showFilterChipBar' }");
		expect(ricContent).not.toContain("subscribeToKey('showGroupPanel'");
		expect(ricContent).not.toContain("subscribeToKey('showFloatingFilters'");
		expect(ricContent).not.toContain("subscribeToKey('showFilterChipBar'");
	});

	it('RenderInvalidationCoordinator no longer records legacy inferred invalidation fallbacks (Plan 105)', () => {
		const diagnosticsContent = readFileSync(resolve(CORE_ROOT, 'src', 'diagnostics', 'GridInstrumentation.ts'), 'utf-8');
		const ricContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		const columnContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'ColumnFeatureController.ts'), 'utf-8');
		expect(columnContent).toContain("reason: 'columns:reorder-toggle'");
		expect(columnContent).toContain("{ kind: 'headers' }");
		expect(diagnosticsContent).not.toContain('LEGACY_INFERRED_INVALIDATIONS');
		expect(ricContent).not.toContain('recordLegacyInferredInvalidation(');
		expect(ricContent).not.toContain('legacy-inferred-invalidation:');
		expect(ricContent).not.toContain("subscribeToKey('enableColumnReorder'");
	});

	it('RenderInvalidationCoordinator only keeps targeted state subscriptions for non-command animation hooks', () => {
		const ricContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
		const subscriptions = [...ricContent.matchAll(/subscribeToKey\('([^']+)'/g)].map((match) => match[1]);
		expect(subscriptions).toEqual(['expansion']);
	});

	it('public snapshot creation is centralized in createGridStateSnapshot (Plan 115)', () => {
		const snapshotBuilder = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'createGridStateSnapshot.ts'), 'utf-8');
		const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
		const runtimeCompositionContent = readFileSync(resolve(CORE_ROOT, 'src', 'internal', 'createGridRuntimeComposition.ts'), 'utf-8');
		expect(snapshotBuilder).toContain('export function createGridStateSnapshot');
		expect(storeContent).toContain('const snapshot = createGridStateSnapshot(currentState);');
		expect(storeContent).toContain('this.cachedStateSnapshotState === currentState');
		expect(runtimeCompositionContent).not.toContain('function createGridStateSnapshot');
		expect(runtimeCompositionContent).toContain('getStateSnapshot: () => runtime.getStateSnapshot()');
	});

	it('production feature changes no longer rely on as never event payload casts (Plan 104)', () => {
		const files = [
			resolve(CORE_ROOT, 'src', 'features', 'ColumnFeatureController.ts'),
			resolve(CORE_ROOT, 'src', 'features', 'EditingFeatureController.ts'),
			resolve(CORE_ROOT, 'src', 'features', 'GridStateFeatureController.ts'),
			resolve(CORE_ROOT, 'src', 'features', 'GroupingFeatureController.ts'),
			resolve(CORE_ROOT, 'src', 'features', 'RowSelectionFeatureController.ts'),
		];
		for (const file of files) {
			expect(readFileSync(file, 'utf-8'), `${path.basename(file)} should rely on typed GridChange events`).not.toContain('as never');
		}
	});

	// ── Plan 131: Pillar 1 — Slot-based rendering lockdown ────────────────────

	describe('Plan 131 Pillar 1 — rowCellBinder decoration pipeline lockdown', () => {
		it('rowCellBinder must not read state.validationErrors', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
			expect(content).not.toContain('validationErrors');
		});

		it('rowCellBinder must not import from ValidationManager', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
			expect(content).not.toContain('ValidationManager');
		});

		it('rowCellBinder must not produce og-cell-invalid class', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
			expect(content).not.toContain('og-cell-invalid');
		});

		it('rowCellBinder must not create og-cell-error-badge DOM elements', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowCellBinder.ts'), 'utf-8');
			expect(content).not.toContain('og-cell-error-badge');
		});
	});

	// ── Plan 134: Pillar 4 — Honest row model scopes ─────────────────────────

	describe('Plan 134 Pillar 4 — GridIntegrityRowProvider honest scopes', () => {
		it('ClientGridIntegrityRowProvider must not fall back to getVisualRowCount for allRows/loadedRows/filteredRows', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridIntegrityRowProvider.ts'), 'utf-8');
			// The only place getVisualRowCount should appear is in _scanVisibleRows (for scope 'visibleRows')
			// Specifically must NOT appear in _scanAllDataNodes fallback
			expect(content).not.toContain('allRows fell back to visual rows');
		});

		it('ClientRowModelController must implement getFilteredDataNodes', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
			expect(content).toContain('getFilteredDataNodes');
		});
	});

	// ── Plan 135: Pillar 5 — Targeted cell invalidation ──────────────────────

	describe('Plan 135 Pillar 5 — targeted integrity invalidation', () => {
		it('DiffIntegrityModule.acceptChange uses targeted requestRepaint for the accepted cell', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			// Single-cell accept must call requestRepaint with cell coords (batch ops like clearDiff may still call it without args)
			expect(content).toContain('requestRepaint([{ rowId, colField }])');
		});

		it('ConflictIntegrityModule._clearConflict uses targeted requestRepaint, not full repaint', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'), 'utf-8');
			// _clearConflict must call requestRepaint with a cell array
			expect(content).toContain('requestRepaint([{ rowId: conflict.rowId, colField: conflict.colField }])');
		});

		it('ValidationIntegrityModule.validateCell uses targeted requestRepaint after applying issues', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ValidationIntegrityModule.ts'), 'utf-8');
			// Single-cell validate must pass cell coords to requestRepaint
			expect(content).toContain('requestRepaint([{ rowId, colField }])');
		});

		it('integrity modules do not call invalidateFull directly', () => {
			const modulesDir = resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules');
			const files = collectSourceFiles(modulesDir).filter((f) => !f.endsWith('.test.ts'));
			const violators: string[] = [];
			for (const file of files) {
				const content = readFileSync(file, 'utf-8');
				if (content.includes('invalidateFull(')) {
					violators.push(path.relative(modulesDir, file));
				}
			}
			expect(violators, `integrity modules calling invalidateFull directly: ${violators.join(', ')}`).toHaveLength(0);
		});
	});

	// ── Plan 136: guards for Plans 132 and 133 ───────────────────────────────

	describe('Plan 136 — guardrails for Plans 132 (result-aware commits) and 133 (dead code removal)', () => {
		it('DiffIntegrityModule must not call setCellValue directly (Plan 132)', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			expect(content, 'DiffIntegrityModule must use commitCellValue, not setCellValue').not.toContain('setCellValue');
		});

		it('ConflictIntegrityModule must not call setCellValue directly (Plan 132)', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'), 'utf-8');
			expect(content, 'ConflictIntegrityModule must use commitCellValue, not setCellValue').not.toContain('setCellValue');
		});

		it('features/dataQuality/ folder must not exist (Plan 133)', () => {
			const dataQualityDir = resolve(CORE_ROOT, 'src', 'features', 'dataQuality');
			expect(existsSync(dataQualityDir), 'features/dataQuality/ was deleted in Plan 133 and must not be re-added').toBe(false);
		});

		it('no source file imports from features/dataQuality/ (Plan 133)', () => {
			const srcDir = resolve(CORE_ROOT, 'src');
			const allFiles = collectSourceFiles(srcDir).filter((f) => !f.endsWith('.test.ts'));
			const violators: string[] = [];
			for (const file of allFiles) {
				const content = readFileSync(file, 'utf-8');
				if (/from ['"].*features\/dataQuality/.test(content)) {
					violators.push(path.relative(srcDir, file));
				}
			}
			expect(violators, `files still importing from deleted features/dataQuality/: ${violators.join(', ')}`).toHaveLength(0);
		});

		it('store subscriptions must route through selector-grade projections, not coarse key listeners', () => {
			const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
			const subscriptionsContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreSubscriptions.ts'), 'utf-8');
			expect(storeContent).toContain('createGridStoreSubscriptions<TRowData>');
			expect(storeContent).toContain(
				'subscribeToSelector: (keys, selector, listener, isEqual) => this.engine.subscribeToSelector(keys, selector, listener, isEqual)'
			);
			expect(subscriptionsContent).toContain('subscribeToSnapshotSelector:');
			expect(subscriptionsContent).toContain('subscribeToIntegrity:');
			expect(subscriptionsContent).toContain('subscribeSnapshotProjection(');
			expect(subscriptionsContent).not.toContain("subscribeToKey('globalVersion', notify)");
			expect(subscriptionsContent).not.toContain("subscribeToKey('columns', notify)");
			expect(subscriptionsContent).not.toContain("subscribeToKey('columnWidths', notify)");
			expect(subscriptionsContent).not.toContain("subscribeToKey('rowHeights', notify)");
			expect(subscriptionsContent).not.toContain("subscribeToKey('sortModel', notify)");
		});
	});

	// ── Hardening: remove valueValidator from ColumnDef and editing path ──────

	describe('Hardening — No ColumnDef.valueValidator', () => {
		it('ColumnDef.valueValidator field is removed from columnDef.ts', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'columnDef.ts'), 'utf-8');
			expect(content).not.toContain('valueValidator?');
			expect(content).not.toContain('ValueValidatorParams');
		});

		it('EditingFeatureController does not read col.valueValidator', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'EditingFeatureController.ts'), 'utf-8');
			expect(content).not.toContain('valueValidator');
		});

		it('core index.ts does not export ValueValidatorParams', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
			expect(content).not.toContain('ValueValidatorParams');
		});
	});

	// ── Hardening: discriminated GridCommitResult ─────────────────────────────

	describe('Hardening — GridCommitResult is a discriminated union', () => {
		it('GridCommitResult uses status discriminant, not success boolean', () => {
			const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
			const integrityContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'integrityTypes.ts'), 'utf-8');
			expect(apiContent).toContain("status: 'applied'");
			expect(apiContent).toContain("status: 'noop'");
			expect(apiContent).toContain("status: 'rejected'");
			expect(apiContent).toContain("status: 'capabilityDenied'");
			expect(apiContent).toContain("status: 'validationFailed'");
			expect(apiContent).toContain("status: 'failed'");
			expect(apiContent).not.toContain('readonly success: boolean');
			expect(integrityContent).toContain('export type GridCommitResult = GridWriteResult;');
			expect(integrityContent).toContain("from '../../api/GridApi.js'");
		});

		it('DiffIntegrityModule checks commitResult.status, not commitResult.success', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			expect(content).toContain("commitResult.status !== 'applied'");
			expect(content).not.toContain('commitResult.success');
		});

		it('ConflictIntegrityModule checks commitResult.status, not commitResult.success', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'), 'utf-8');
			expect(content).toContain("commitResult.status !== 'applied'");
			expect(content).not.toContain('commitResult.success');
		});

		it('GridDataIntegrityManager routes commitCellValue through the public api.setCellValue result protocol', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridDataIntegrityManager.ts'), 'utf-8');
			expect(content).toContain('deps.getApi().setCellValue(rowId, colField, value)');
			expect(content).not.toContain("reason: 'data:set-cell-value'");
		});

		it('live stream row patches use GridWriteResult-aware applyRowPatch handling', () => {
			const managerContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridDataIntegrityManager.ts'), 'utf-8');
			const liveStreamContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'LiveStreamIntegrityModule.ts'),
				'utf-8'
			);
			const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			expect(managerContent).toContain('applyRowPatch: (rowId: string, patch: Partial<TRowData>) => GridWriteResult;');
			expect(liveStreamContent).toContain("if (result.status !== 'applied' && result.status !== 'noop')");
			expect(engineContent).not.toContain('this.applyTransaction({ update: [updated] });');
			expect(engineContent).toContain("reason: 'rows:apply-transaction'");
		});
	});

	// ── Hardening: validateCellProposal (validates proposed, not current) ─────

	describe('Hardening — validateCellProposal validates proposed value', () => {
		it('GridIntegrityApi includes validateCellProposal', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'integrityTypes.ts'), 'utf-8');
			expect(content).toContain('validateCellProposal(params: GridValidateCellProposalParams)');
			expect(content).toContain('GridValidateCellProposalParams');
		});

		it('ValidationIntegrityModule implements validateCellProposal', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ValidationIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('validateCellProposal(params: GridValidateCellProposalParams)');
		});

		it('DiffIntegrityModule uses validateCellProposal (not validateCell) for the proposed value', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('validateCellProposal');
			expect(content).not.toContain('validateCell:');
			expect(content).not.toContain('validateCell?:');
		});

		it('ConflictIntegrityModule uses validateCellProposal (not validateCell) for the proposed value', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('validateCellProposal');
			expect(content).not.toContain('validateCell:');
			expect(content).not.toContain('validateCell?:');
		});
	});

	// ── Hardening: stable issue IDs ───────────────────────────────────────────

	describe('Hardening — stable issue IDs', () => {
		it('DiffIntegrityModule uses stable prefix-based IDs, not counter IDs', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('diff:changed:');
			expect(content).toContain('diff:added:');
			expect(content).toContain('diff:removed:');
			expect(content).not.toContain('nextIssueId()');
		});

		it('ConflictIntegrityModule uses stable conflict-derived IDs in getIssues()', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('conflict:${conflict.id}');
			expect(content).not.toContain('nextIssueId()');
		});

		it('ValidationIntegrityModule uses stable rule-derived IDs', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ValidationIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('_stableCellIssueId(');
			expect(content).toContain('_stableRowIssueId(');
			expect(content).not.toContain('id: nextIssueId()');
		});
	});

	// ── Hardening: clearIssues routes to all modules ──────────────────────────

	describe('Hardening — clearIssues routes to all modules', () => {
		it('GridDataIntegrityManager.clearIssues clears validationModule, diffModule, conflictModule', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridDataIntegrityManager.ts'), 'utf-8');
			expect(content).toContain('this.validationModule?.clearIssues()');
			expect(content).toContain('this.diffModule?.clearIssues()');
			expect(content).toContain('this.conflictModule?.clearIssues()');
			expect(content).toContain('this.qualityModule?.clearIssues()');
		});
	});

	// ── Hardening: unified requestIntegrityRepaint API ────────────────────────

	describe('Hardening — unified requestIntegrityRepaint', () => {
		it('GridDataIntegrityManagerDeps uses requestIntegrityRepaint, not dual repaint API', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridDataIntegrityManager.ts'), 'utf-8');
			expect(content).toContain('requestIntegrityRepaint');
			expect(content).not.toContain('requestInsightRepaint:');
			expect(content).not.toContain('requestTargetedRepaint:');
		});

		it('GridEngine wires requestIntegrityRepaint to the unified handler', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			expect(content).toContain('requestIntegrityRepaint:');
			expect(content).not.toContain('requestTargetedRepaint:');
		});
	});

	// ── Hardening: core styles include all integrity decoration classes ────────

	describe('Hardening — core styles.ts includes all data integrity decoration CSS', () => {
		it('styles.ts has CSS for og-cell-diff-changed, og-cell-diff-added, og-cell-diff-removed', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'styles.ts'), 'utf-8');
			expect(content).toContain('.og-cell-diff-changed');
			expect(content).toContain('.og-cell-diff-added');
			expect(content).toContain('.og-cell-diff-removed');
		});

		it('styles.ts has CSS for og-cell-conflict', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'styles.ts'), 'utf-8');
			expect(content).toContain('.og-cell-conflict');
		});

		it('styles.ts has CSS for og-cell-insight-error, og-cell-insight-warning, og-cell-insight-info', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'styles.ts'), 'utf-8');
			expect(content).toContain('.og-cell-insight-error');
			expect(content).toContain('.og-cell-insight-warning');
			expect(content).toContain('.og-cell-insight-info');
		});

		it('styles.ts has CSS for og-row-diff-added, og-row-diff-changed', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'styles.ts'), 'utf-8');
			expect(content).toContain('.og-row-diff-added');
			expect(content).toContain('.og-row-diff-changed');
		});

		it('styles.ts has CSS for og-cell-quality-error, og-cell-quality-warning', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'styles.ts'), 'utf-8');
			expect(content).toContain('.og-cell-quality-error');
			expect(content).toContain('.og-cell-quality-warning');
		});
	});

	describe('Plan 132 - integrity authority lives in GridState and commit-kernel mutations', () => {
		it('InternalGridState includes an integrity slice', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridState.ts'), 'utf-8');
			expect(content).toContain('export interface GridIntegrityState');
			expect(content).toContain('integrity: GridIntegrityState<TRowData>;');
			expect(content).not.toContain("from '../features/dataIntegrity/");
		});

		it('GridDomainMutation defines typed integrity mutation kinds', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridDomainMutation.ts'), 'utf-8');
			expect(content).toContain("kind: 'integrity-set-validation-issues'");
			expect(content).toContain("kind: 'integrity-set-diff-state'");
			expect(content).toContain("kind: 'integrity-upsert-conflict'");
			expect(content).toContain("kind: 'integrity-set-live-stream-session'");
			expect(content).toContain("kind: 'integrity-set-server-report'");
		});

		it('GridDataIntegrityManager no longer owns published issues, server report, or summary fields directly', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridDataIntegrityManager.ts'), 'utf-8');
			expect(content).not.toContain('private readonly publishedIssues');
			expect(content).not.toContain('private serverReport');
			expect(content).not.toContain('private _summary');
		});

		it('integrity modules no longer keep durable field-owned registries', () => {
			const validationContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ValidationIntegrityModule.ts'),
				'utf-8'
			);
			const diffContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			const conflictContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'),
				'utf-8'
			);
			const liveStreamContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'LiveStreamIntegrityModule.ts'),
				'utf-8'
			);
			expect(validationContent).not.toContain('private readonly cellErrorIndex');
			expect(diffContent).not.toContain('private readonly cellDiffMap');
			expect(diffContent).not.toContain('private issues:');
			expect(conflictContent).not.toContain('private readonly conflicts = new Map');
			expect(conflictContent).not.toContain('private readonly cellIndex = new Map');
			expect(liveStreamContent).not.toContain('private streamIssues');
		});

		it('integrity modules route authoritative writes through integrity domain mutations', () => {
			const validationContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ValidationIntegrityModule.ts'),
				'utf-8'
			);
			const diffContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'DiffIntegrityModule.ts'), 'utf-8');
			const conflictContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'ConflictIntegrityModule.ts'),
				'utf-8'
			);
			const liveStreamContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'LiveStreamIntegrityModule.ts'),
				'utf-8'
			);
			expect(validationContent).toContain("kind: 'integrity-set-validation-issues'");
			expect(diffContent).toContain("kind: 'integrity-set-diff-state'");
			expect(conflictContent).toContain("kind: 'integrity-upsert-conflict'");
			expect(liveStreamContent).toContain("kind: 'integrity-set-live-stream-session'");
		});
	});

	describe('Plan 133 - public write api result protocol', () => {
		it('GridApi advanced write methods return GridWriteResult instead of void', () => {
			const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
			const surfacesContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApiSurfaces.ts'), 'utf-8');
			expect(apiContent).toContain('GridDataApi');
			expect(surfacesContent).toContain('setRows(rows: TRowData[]): GridWriteResult;');
			expect(surfacesContent).toContain('updateRows(updater: (rows: TRowData[]) => TRowData[]): GridWriteResult;');
			expect(surfacesContent).toContain('setCellValue(rowId: string, colField: string, value: unknown): GridWriteResult;');
			expect(surfacesContent).toContain(
				"batchCellValues(updates: BatchCellValueUpdate[], source?: 'paste' | 'api' | 'fill'): GridWriteResult;"
			);
			expect(surfacesContent).not.toContain('setRows(rows: TRowData[]): void;');
			expect(surfacesContent).not.toContain('updateRows(updater: (rows: TRowData[]) => TRowData[]): void;');
			expect(surfacesContent).not.toContain('setCellValue(rowId: string, colField: string, value: unknown): void;');
			expect(surfacesContent).not.toContain("batchCellValues(updates: BatchCellValueUpdate[], source?: 'paste' | 'api' | 'fill'): void;");
		});

		it('GridEngine advanced write methods map kernel commits to GridWriteResult', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			expect(content).toContain('public replaceRows(rows: readonly TRowData[]): GridWriteResult');
			expect(content).toContain('public updateRows(updater: (rows: TRowData[]) => TRowData[]): GridWriteResult');
			expect(content).toContain('public setCellValue(rowId: string, colField: string, value: unknown, undoable = true): GridWriteResult');
			expect(content).toContain('public batchCellValues(');
			expect(content).toContain('return this.toGridWriteResult(');
			expect(content).toContain("status: 'applied'");
		});

		it('feature callers handle write result statuses explicitly instead of assuming success', () => {
			const clipboardContent = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'ClipboardController.ts'), 'utf-8');
			const liveStreamContent = readFileSync(
				resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'LiveStreamIntegrityModule.ts'),
				'utf-8'
			);
			expect(clipboardContent).toContain("if (result.status === 'applied' || result.status === 'noop')");
			expect(liveStreamContent).toContain("if (result.status !== 'applied' && result.status !== 'noop')");
		});
	});

	describe('Plan 134 - commit-owned projection pipeline', () => {
		it('GridChangeApplier exposes an explicit projection phase before domain publication', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
			expect(content).toContain('projectStateChange?: (phase: StateCommitPhase<TRowData>) => void;');
			expect(content).toContain('stateManager.commitState(mergedState');
			const projectPos = content.indexOf('projectStateChange?.(phase)');
			const publishPos = content.indexOf('publish-domains');
			expect(projectPos).toBeGreaterThan(-1);
			expect(projectPos).toBeLessThan(publishPos);
		});

		it('GridProjectionPipeline owns derived runtime recomputation instead of key-reaction mutation', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridProjectionPipeline.ts'), 'utf-8');
			expect(content).toContain('export class GridProjectionPipeline');
			expect(content).toContain('phase.setDerivedState({ selection })');
			expect(content).toContain('visibleRowRange: nextRowRange');
			expect(content).not.toContain('triggerKeyChange(');
		});

		it('selection invalidation is declared at commit time, not rebuilt in the renderer coordinator', () => {
			const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			const ricContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'RenderInvalidationCoordinator.ts'), 'utf-8');
			expect(engineContent).toContain("reason: 'selection:set-range'");
			expect(engineContent).toContain("kind: 'headers' as const, reason: 'selection' as const");
			expect(ricContent).not.toContain("invalidateHeaders('selection')");
			expect(ricContent).not.toContain("invalidateOverlay('selection')");
		});

		it('direct-write allowlist no longer mentions GridStateReactionController and reclassifies renderer invalidation as local', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'gridDirectWriteAllowlist.ts'), 'utf-8');
			expect(content).not.toContain('GridStateReactionController.ts');
			expect(content).toContain("kind: 'renderer-local-consumer'");
		});
	});

	describe('Plan 135 - canonical live stream ownership', () => {
		it('standalone features/liveStream owner and insights/liveStream barrel are deleted', () => {
			expect(existsSync(resolve(CORE_ROOT, 'src', 'features', 'liveStream'))).toBe(false);
			expect(existsSync(resolve(CORE_ROOT, 'src', 'insights', 'liveStream.ts'))).toBe(false);
		});

		it('LiveStreamIntegrityModule is the only production stream owner', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'modules', 'LiveStreamIntegrityModule.ts'), 'utf-8');
			expect(content).toContain('Canonical production stream owner');
			expect(content).toContain("kind: 'integrity-set-live-stream-session'");
			expect(content).toContain("kind: 'integrity-set-live-stream-issues'");
		});

		it('package barrels only expose integrity-backed stream types', () => {
			const indexContent = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
			const integrityContent = readFileSync(resolve(CORE_ROOT, 'src', 'integrity.ts'), 'utf-8');
			expect(indexContent).not.toContain('insights/liveStream');
			expect(indexContent).not.toContain('features/liveStream');
			expect(integrityContent).toContain('GridTransactionStreamHandle');
			expect(integrityContent).toContain('GridTransactionStreamState');
		});
	});

	describe('Plan 137 - control-surface decomposition guardrails', () => {
		it('store delegates subscriptions and host binding to dedicated owners', () => {
			const storeContent = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
			const subscriptionsContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreSubscriptions.ts'), 'utf-8');
			const hostContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreHostFacade.ts'), 'utf-8');
			const rowContent = readFileSync(resolve(CORE_ROOT, 'src', 'store', 'GridStoreRowFacade.ts'), 'utf-8');
			expect(storeContent).toContain('createGridStoreSubscriptions');
			expect(storeContent).toContain('createGridStoreHostFacade');
			expect(storeContent).toContain('createGridStoreRowFacade');
			expect(storeContent).not.toContain("subscribeToKey('globalVersion', notify)");
			expect(subscriptionsContent).toContain('export function createGridStoreSubscriptions');
			expect(subscriptionsContent).not.toContain('GridStore<');
			expect(hostContent).toContain('export function createGridStoreHostFacade');
			expect(hostContent).not.toContain('GridStore<');
			expect(rowContent).toContain('export function createGridStoreRowFacade');
			expect(rowContent).not.toContain('GridStore<');
			expect(rowContent).not.toContain("from '../store.js'");
		});

		it('GridEngine keeps domain subscriptions and cell notifications with their semantic owners', () => {
			const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			const domainContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridDomainSubscriptionHub.ts'), 'utf-8');
			const notificationContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'CellNotificationController.ts'), 'utf-8');
			expect(engineContent).toContain('new GridDomainSubscriptionHub');
			expect(engineContent).not.toContain('GridEngineRenderBridge');
			expect(engineContent).not.toContain('cellSubscriptions = new Map');
			expect(engineContent).not.toContain('cellUpdateBatch = new Map');
			expect(engineContent).toContain('this.beginRenderTransaction();');
			expect(engineContent).toContain('this.stateManager.startTransaction();');
			expect(engineContent).toContain('this.stateManager.endTransaction();');
			expect(engineContent).toContain('this.cellNotifications.flushCellUpdatesSync();');
			expect(engineContent).toContain('this.endRenderTransaction();');
			expect(domainContent).toContain('export class GridDomainSubscriptionHub');
			expect(domainContent).not.toContain('GridEngine<');
			expect(notificationContent).toContain('export class CellNotificationController');
			expect(notificationContent).toContain('private readonly cellSubscriptions = new Map');
			expect(notificationContent).toContain('private readonly cellUpdateBatch = new Map');
		});

		it('GridApi exports conceptual surface contracts', () => {
			const apiContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApi.ts'), 'utf-8');
			const surfacesContent = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'GridApiSurfaces.ts'), 'utf-8');
			expect(apiContent).toContain("from './GridApiSurfaces.js'");
			expect(apiContent).not.toContain('export interface GridApi<');
			expect(apiContent).not.toContain('export interface InternalGridApi<');
			expect(surfacesContent).toContain('export interface GridDataApi');
			expect(surfacesContent).toContain('export interface GridSelectionEditingApi');
			expect(surfacesContent).toContain('export interface GridStructureApi');
			expect(surfacesContent).toContain('export interface GridRuntimeSubscriptionApi');
			expect(surfacesContent).toContain('export interface GridApi<');
			expect(surfacesContent).toContain('export interface InternalGridApi<');
			expect(surfacesContent).not.toContain('GridStore<');
		});
	});

	describe('Plan 140 - capability-driven integrity row model contract', () => {
		it('integrity types expose an explicit capability matrix and unsupported run result', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'integrityTypes.ts'), 'utf-8');
			expect(content).toContain("export type GridIntegrityCapabilityLevel = 'authoritative' | 'partial' | 'unsupported'");
			expect(content).toContain('export type GridIntegrityCapabilityMatrix = Record<GridIntegrityScope, GridIntegrityScopeCapability>;');
			expect(content).toContain("readonly status: 'unsupported';");
			expect(content).toContain('getCapabilities(): GridIntegrityCapabilityMatrix;');
			expect(content).toContain('getScopeCapability(scope: GridIntegrityScope): GridIntegrityScopeCapability;');
		});

		it('GridIntegrityRowProvider is unified behind a capability-driven factory instead of per-row-model classes', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridIntegrityRowProvider.ts'), 'utf-8');
			expect(content).toContain('export function createGridIntegrityRowProvider');
			expect(content).toContain('export class CapabilityDrivenGridIntegrityRowProvider');
			expect(content).not.toContain('ClientGridIntegrityRowProvider');
			expect(content).not.toContain('InfiniteGridIntegrityRowProvider');
			expect(content).not.toContain('serverSideGridIntegrityRowProvider');
		});

		it('non-client filteredRows and full-dataset scopes are explicitly unsupported instead of silently degraded', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'dataIntegrity', 'GridIntegrityRowProvider.ts'), 'utf-8');
			expect(content).toContain('Infinite row model cannot authoritatively scan allRows without a serverProvided report.');
			expect(content).toContain('Infinite row model cannot authoritatively expose filteredRows beyond currently loaded blocks.');
			expect(content).toContain('server-side row model cannot authoritatively scan allRows without a serverProvided report.');
			expect(content).toContain('server-side row model cannot authoritatively expose filteredRows outside the loaded server-side stores.');
		});

		it('GridEngine wires integrity through the unified provider factory and rejects row patches for unavailable rows', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			expect(content).toContain('createGridIntegrityRowProvider');
			expect(content).toContain('rowModelKind: modelType');
			expect(content).toContain("reason: 'row unavailable in current row-model scope'");
			expect(content).not.toContain('new ClientGridIntegrityRowProvider');
			expect(content).not.toContain('new InfiniteGridIntegrityRowProvider');
			expect(content).not.toContain('new serverSideGridIntegrityRowProvider');
		});
	});

	describe('Architecture document stays aligned with integrity ownership', () => {
		it('core-target architecture doc references GridDataIntegrityManager instead of the removed ValidationManager owner', () => {
			const content = readFileSync(resolve(CORE_ROOT, '..', '..', 'docs', 'architecture', 'core-target.md'), 'utf-8');
			expect(content).toContain('GridDataIntegrityManager');
			expect(content).not.toContain('ValidationManager');
		});
	});

	describe('Plan 141 - targeted invalidation convergence', () => {
		it('canonical row-write executors derive invalidations from row-model refresh results instead of defaulting to full repaint', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridDomainMutation.ts'), 'utf-8');
			expect(content).toContain('createInvalidationsFromRefreshResult');
			expect(content).not.toContain("if (reconcileResult.changed) invalidations = [{ kind: 'full', reason: 'data' }];");
			expect(content).not.toContain("if (reconcileResult.changed) batchInvalidations = [{ kind: 'full', reason: 'data' }];");
			expect(content).not.toContain("invalidations: changed ? [{ kind: 'full' as const, reason: 'data' }] : []");
		});

		it('RenderOrchestrator treats row-range and group invalidations as structural viewport work', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderOrchestrator.ts'), 'utf-8');
			expect(content).toContain('const hasStructuralViewportWork = frame.rowRanges.length > 0 || frame.groups.size > 0;');
			expect(content).toContain('if (frame.viewport || hasStructuralViewportWork)');
		});

		it('sort and filter model changes no longer hard-code full repaint invalidations when a row model can publish refresh scope', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'features', 'GridStateFeatureController.ts'), 'utf-8');
			expect(content).toContain('const hasRowModel = this.deps.getRowModel?.() != null;');
			expect(content).toContain(
				"const forwardInvalidations = hasRowModel ? [] : [{ kind: 'headers', reason: 'sort' } as const, { kind: 'full', reason: 'sort' } as const];"
			);
			expect(content).toContain("const forwardInvalidations = hasRowModel ? [] : [{ kind: 'full' } as const];");
			expect(content).toContain('requestRender: !hasRowModel');
		});

		it('ClientRowModelController publishes refresh-result invalidations for sort/filter events through the runtime bridge', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'rowModel.ts'), 'utf-8');
			expect(content).toContain("this.runtime.applyRefreshInvalidation(this.refresh('sort'), {");
			expect(content).toContain("requestRenderReason: 'rows:set-sort-model'");
			expect(content).toContain("this.runtime.applyRefreshInvalidation(this.refresh('filter'), {");
			expect(content).toContain("requestRenderReason: 'rows:set-filter-model'");
		});
	});

	describe('Plan 142 - cross-feature composition gauntlets', () => {
		it('keeps a dedicated composition gauntlet suite for feature-stack regressions', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'featureComposition.gauntlet.test.ts'), 'utf-8');
			expect(content).toContain('Plan 142 - cross-feature composition gauntlets');
			expect(content).toContain('sort + filter + grouping composition');
			expect(content).toContain('paste/fill writes, and undo/redo boundaries coherent');
			expect(content).toContain('hot scroll path and custom renderer hydration stable under targeted writes');
		});
	});

	describe('Plan 143 - projection and invalidation determinism', () => {
		it('GridChangeApplier supports event payload resolution from committed state', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridChangeApplier.ts'), 'utf-8');
			expect(content).toContain('export type GridCommitEventPayloadResolver');
			expect(content).toContain("typeof event.payload === 'function'");
			expect(content).toContain('this.deps.stateManager.getState()');
		});

		it('selection commits keep bounds projection-owned and resolve event payloads after projection', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			expect(content).toContain('const previewSelection = {');
			expect(content).toContain('const committedSelection = this.selection.createSelectionRange(validStart, validEnd, source);');
			expect(content).toContain('bounds: this.selection.calculateRangeBounds(');
			expect(content).toContain('if (!pointer.columnInstanceId) return -1;');
			expect(content).toContain(
				'findColumnByCanonicalCellPointer(this.columns.getDisplayedColumns(), { columnInstanceId: pointer.columnInstanceId })'
			);
			expect(content).not.toContain('this.columns.getColumnIndex(pointer.colField)');
			expect(content).toContain('payload: (state) => ({ focus: state.selection.focus, selection: state.selection })');
			expect(content).toContain('selection: state.selection,');
			expect(content).not.toContain('const selection = this.selection.setSelection(');
			expect(content).toContain('state: { selection: committedSelection }');
		});

		it('GridProjectionPipeline recomputes selection bounds from canonical column identity instead of field fallback', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridProjectionPipeline.ts'), 'utf-8');
			expect(content).toContain('if (!pointer.columnInstanceId) return -1;');
			expect(content).toContain('const column = findColumnByCanonicalCellPointer(this.deps.columns.getDisplayedColumns(), {');
			expect(content).toContain('columnInstanceId: pointer.columnInstanceId,');
			expect(content).toContain('const enrichPointer = (pointer: GridCellPointer | null): CanonicalGridCellPointer | null => {');
			expect(content).toContain('areCanonicalCellPointersEqual(focus, selection.focus as CanonicalGridCellPointer | null)');
			expect(content).not.toContain('this.deps.columns.getColumnIndex(pointer.colField)');
			expect(content).not.toContain('pointer.colField === column.field');
			expect(content).not.toContain('pointer.colId === (column.colId ?? column.field)');
			expect(content).not.toContain('activeEdit.colField === column.field');
			expect(content).not.toContain('activeEdit.colId === (column.colId ?? column.field)');
		});

		it('store cell state editing flags derive from canonical interaction edit identity', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'store.ts'), 'utf-8');
			expect(content).toContain("import { doesCanonicalCellPointerMatchColumn } from './interaction/cellPointer.js';");
			expect(content).toContain(
				'const isEditing = column ? doesCanonicalCellPointerMatchColumn(interaction.activeEdit.active, rowId, column) : false;'
			);
			expect(content).not.toContain('doesCellPointerMatchColumn(interaction.activeEdit.active, rowId, column)');
		});

		it('SelectionModel creates new selection state from canonical pointers instead of broad field-only pointers', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'models', 'SelectionModel.ts'), 'utf-8');
			expect(content).toContain(
				"public createCellSelection(pointer: CanonicalGridCellPointer | null, source: GridSelectionSource = 'program'): CanonicalGridSelectionState {"
			);
			expect(content).toContain('start: CanonicalGridCellPointer | null,');
			expect(content).toContain('end: CanonicalGridCellPointer | null,');
			expect(content).toContain('anchor: CanonicalGridCellPointer | null,');
			expect(content).toContain('end: CanonicalGridCellPointer,');
		});

		it('renderer interaction consumers do not fall back to public selection focus once core focus is canonical', () => {
			const rowPresentationContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'rowPresentationResolver.ts'), 'utf-8');
			const selectionPaintContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'selectionPaintManager.ts'), 'utf-8');
			expect(rowPresentationContent).not.toContain('interaction.cellSelection.publicSelection.focus');
			expect(selectionPaintContent).not.toContain('cellSelection.publicSelection.focus');
		});

		it('broad pointer compatibility is funneled through the shared canonical resolver instead of ad hoc reconstruction', () => {
			const cellPointerContent = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'cellPointer.ts'), 'utf-8');
			const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			const interactionContent = readFileSync(resolve(CORE_ROOT, 'src', 'interaction', 'GridInteractionController.ts'), 'utf-8');
			const contextMenuContent = readFileSync(resolve(CORE_ROOT, 'src', 'contextMenu.ts'), 'utf-8');
			const viewportContent = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'renderViewportCoordinator.ts'), 'utf-8');

			expect(cellPointerContent).toContain('export function resolveCanonicalCellPointer');
			expect(engineContent).toContain('return resolveCanonicalCellPointer(columns, pointer);');
			expect(interactionContent).toContain('return resolveCanonicalCellPointer(this.runtime.getDisplayedColumns(), pointer ?? null);');
			expect(contextMenuContent).toContain('return resolveCanonicalCellPointer(columns, pointer);');
			expect(viewportContent).toContain('return resolveCanonicalCellPointer(this.deps.engine.columns.getDisplayedColumns(), pointer);');
		});

		it('public state snapshots derive selection and active-edit from interaction state', () => {
			const content = readFileSync(resolve(CORE_ROOT, 'src', 'api', 'createGridStateSnapshot.ts'), 'utf-8');
			expect(content).toContain('const interaction = readInteractionState(state);');
			expect(content).toContain('selection: cloneSelection(interaction.cellSelection.selection),');
			expect(content).toContain('activeEdit: cloneActiveEdit(interaction.activeEdit.active),');
			expect(content).not.toContain('selection: cloneSelection(state.selection),');
			expect(content).not.toContain('activeEdit: cloneActiveEdit(state.activeEdit),');
		});

		it('GridEngine canonicalizes initial selection before seeding internal state', () => {
			const engineContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'GridEngine.ts'), 'utf-8');
			const helperContent = readFileSync(resolve(CORE_ROOT, 'src', 'engine', 'normalizeInitialInteractionState.ts'), 'utf-8');
			expect(engineContent).toContain('const initialSelection = normalizeInitialSelection(');
			expect(engineContent).toContain('const initialActiveEdit = normalizeInitialActiveEdit(');
			expect(helperContent).toContain('export function normalizeInitialSelection');
			expect(helperContent).toContain('const focus = resolveCanonicalCellPointer(selection.focus, columns);');
			expect(helperContent).toContain('export function normalizeInitialActiveEdit');
			expect(engineContent).not.toContain("const initialSelection = config.selection ?? this.selection.createCellSelection(null, 'program');");
		});

		it('internal grid state stores canonical selection identity rather than broad public selection pointers', () => {
			const stateContent = readFileSync(resolve(CORE_ROOT, 'src', 'state', 'GridState.ts'), 'utf-8');
			expect(stateContent).toContain(
				"import type { CanonicalGridSelectionState, GridInteractionState } from '../interaction/interactionState.js';"
			);
			expect(stateContent).toContain('selection: CanonicalGridSelectionState;');
			expect(stateContent).not.toContain('selection: GridSelectionState;');
		});

		it('broad pointer fallback helpers are only used at explicit public-boundary compatibility seams', () => {
			const srcDir = resolve(CORE_ROOT, 'src');
			const files = collectSourceFiles(srcDir);
			const users = files
				.filter((file) => !file.endsWith('architectureGuards.test.ts'))
				.filter((file) => {
					const content = readFileSync(file, 'utf-8');
					return (
						content.includes('findColumnByCellPointer(') ||
						content.includes('findColumnIndexByCellPointer(') ||
						content.includes('doesCellPointerMatchColumn(')
					);
				})
				.map((file) => path.relative(srcDir, file).replaceAll('\\', '/'))
				.sort();
			expect(users).toEqual([
				'engine/GridEngine.ts',
				'engine/GridProjectionPipeline.ts',
				'interaction/GridInteractionController.ts',
				'interaction/cellPointer.ts',
			]);
		});
	});
});
