import type { GridApi, GridPluginController, InternalGridApi } from '../api/GridApi.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridInteractionController } from '../interaction/GridInteractionController.js';

export interface GridHostComposition<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	api: InternalGridApi<TRowData>;
	setContainerElement(container: HTMLElement): void;
}

export interface GridRuntimeComposition<TRowData = unknown> {
	host: GridHostComposition<TRowData>;
	pluginController: GridPluginController<TRowData>;
	interactionController: GridInteractionController<TRowData>;
}

const apiRuntimeMap = new WeakMap<GridApi<unknown>, GridRuntimeComposition<unknown>>();

export function registerGridRuntimeComposition<TRowData>(api: GridApi<TRowData>, runtime: GridRuntimeComposition<TRowData>): void {
	apiRuntimeMap.set(api as GridApi<unknown>, runtime as GridRuntimeComposition<unknown>);
}

export function resolveGridRuntimeComposition<TRowData>(api: GridApi<TRowData>): GridRuntimeComposition<TRowData> {
	const runtime = apiRuntimeMap.get(api as GridApi<unknown>);
	if (!runtime) {
		throw new Error('Invalid GridApi. This API was not created by Wit Grid.');
	}
	return runtime as GridRuntimeComposition<TRowData>;
}

export function resolveGridHostComposition<TRowData>(api: GridApi<TRowData>): GridHostComposition<TRowData> {
	return resolveGridRuntimeComposition(api).host;
}

export function resolveGridPluginController<TRowData>(api: GridApi<TRowData>): GridPluginController<TRowData> {
	return resolveGridRuntimeComposition(api).pluginController;
}

export function resolveGridInteractionController<TRowData>(api: GridApi<TRowData>): GridInteractionController<TRowData> {
	return resolveGridRuntimeComposition(api).interactionController;
}
