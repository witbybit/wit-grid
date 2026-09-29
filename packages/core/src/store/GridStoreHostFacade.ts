import type { GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import type { RuntimeFault, RuntimeFaultInput } from '../diagnostics/RuntimeFaultReporter.js';
import type { RenderStats } from '../renderer/renderTelemetry.js';
import type { BuiltInThemeName, ThemeTokens } from '../renderer/themes.js';
import type { RuntimePortBinding, RuntimePortBindResult, GridRuntimePorts } from '../engine/rendererPorts.js';

export interface GridStoreHostFacade {
	bindRuntimePorts(ports: GridRuntimePorts): RuntimePortBindResult;
	unbindRuntimePorts(binding: RuntimePortBinding): void;
	isBindingCurrent(binding: RuntimePortBinding): boolean;
	getInstrumentation(): GridInstrumentation;
	setInstrumentation(inst: GridInstrumentation): void;
	getRenderStats(): RenderStats;
	resetRenderStats(): void;
	getRuntimeFaults(): RuntimeFault[];
	clearRuntimeFaults(): void;
	reportRuntimeFault(fault: RuntimeFaultInput): RuntimeFault;
	getTheme(): ThemeTokens;
	getThemeName(): BuiltInThemeName | null;
	getAvailableThemes(): BuiltInThemeName[];
	switchTheme(themeName: string): void;
	mergeTheme(partial: Partial<ThemeTokens>): void;
	setTheme(theme: ThemeTokens): void;
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;
	setContainerElement(c: HTMLElement): void;
	getContainerElement(): HTMLElement | null;
	getContainer(): HTMLElement | null;
	scrollCellIntoView(rowId: string, colField: string): void;
	scrollRowIntoView(rowId: string): void;
	getInsightDiagnostics(): Record<string, unknown>;
}

export interface GridStoreHostFacadeDeps {
	isDestroyed(): boolean;
	getActiveBindingGeneration(): number | null;
	setActiveBindingGeneration(generation: number | null): void;
	nextBindingGeneration(): number;
	setRuntimePortsState(ports: GridRuntimePorts): void;
	getRuntimePortsState(): GridRuntimePorts;
	getFallbackRendererPorts(): GridRuntimePorts;
	setInstrumentationState(inst: GridInstrumentation): void;
	getInstrumentationState(): GridInstrumentation;
	setContainerElementState(container: HTMLElement | null): void;
	getStateThemeName(): BuiltInThemeName | string | undefined;
	isBuiltInThemeName(value: string | undefined): value is BuiltInThemeName;
	getBuiltInThemeOrder(): BuiltInThemeName[];
	setThemeName(themeName: BuiltInThemeName): void;
	getCompiledPlanVersion(): number;
	getRuntimeFaults(): RuntimeFault[];
	clearRuntimeFaults(): void;
	setEngineInstrumentation(inst: GridInstrumentation): void;
	getInsightDiagnostics(): Record<string, unknown>;
	reportRuntimeFault(fault: RuntimeFaultInput): RuntimeFault;
}

export function createGridStoreHostFacade(deps: GridStoreHostFacadeDeps): GridStoreHostFacade {
	return {
		bindRuntimePorts: (ports) => {
			if (deps.isDestroyed()) {
				return { ok: false, reason: 'destroyed' };
			}
			if (deps.getActiveBindingGeneration() !== null) {
				deps.reportRuntimeFault({
					source: 'store',
					operation: 'bindRuntimePorts',
					error: new Error('Attempted to bind runtime ports while a binding is already active. Unbind first.'),
				});
				return { ok: false, reason: 'already-bound' };
			}
			const generation = deps.nextBindingGeneration();
			deps.setActiveBindingGeneration(generation);
			deps.setRuntimePortsState(ports);
			return { ok: true, binding: { generation } };
		},
		unbindRuntimePorts: (binding) => {
			if (binding.generation !== deps.getActiveBindingGeneration()) {
				deps.reportRuntimeFault({
					source: 'store',
					operation: 'unbindRuntimePorts',
					error: new Error('Attempted to unbind with a stale or unrecognised binding token.'),
				});
				return;
			}
			deps.setActiveBindingGeneration(null);
			deps.setRuntimePortsState(deps.getFallbackRendererPorts());
		},
		isBindingCurrent: (binding) => binding.generation === deps.getActiveBindingGeneration(),
		getInstrumentation: () => deps.getInstrumentationState(),
		setInstrumentation: (inst) => {
			deps.setInstrumentationState(inst);
			deps.setEngineInstrumentation(inst);
		},
		getRenderStats: () => {
			const stats = deps.getRuntimePortsState().renderer.getStats();
			stats.compiledPlanVersion = deps.getCompiledPlanVersion();
			return stats;
		},
		resetRenderStats: () => deps.getRuntimePortsState().renderer.resetStats(),
		getRuntimeFaults: () => deps.getRuntimeFaults(),
		clearRuntimeFaults: () => deps.clearRuntimeFaults(),
		reportRuntimeFault: (fault) => deps.reportRuntimeFault(fault),
		getTheme: () => deps.getRuntimePortsState().theme.getTheme(),
		getThemeName: () => {
			const portName = deps.getRuntimePortsState().theme.getThemeName();
			if (portName !== null) return portName;
			const themeName = deps.getStateThemeName();
			return deps.isBuiltInThemeName(themeName) ? themeName : null;
		},
		getAvailableThemes: () => {
			const themes = deps.getRuntimePortsState().theme.getAvailableThemes();
			return themes.length > 0 ? themes : deps.getBuiltInThemeOrder().slice();
		},
		switchTheme: (themeName) => {
			if (!deps.isBuiltInThemeName(themeName) || deps.getStateThemeName() === themeName) return;
			deps.setThemeName(themeName);
			deps.getRuntimePortsState().theme.switchTheme(themeName);
		},
		mergeTheme: (partial) => deps.getRuntimePortsState().theme.mergeTheme(partial),
		setTheme: (theme) => deps.getRuntimePortsState().theme.setTheme(theme),
		onThemeChange: (listener) => deps.getRuntimePortsState().theme.onThemeChange(listener),
		setContainerElement: (container) => deps.setContainerElementState(container),
		getContainerElement: () => deps.getRuntimePortsState().renderer.getContainer(),
		getContainer: () => deps.getRuntimePortsState().renderer.getContainer(),
		scrollCellIntoView: (rowId, colField) => deps.getRuntimePortsState().renderer.scrollCellIntoView(rowId, colField),
		scrollRowIntoView: (rowId) => deps.getRuntimePortsState().renderer.scrollRowIntoView(rowId),
		getInsightDiagnostics: () => deps.getInsightDiagnostics(),
	};
}
