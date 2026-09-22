import { createContext } from 'react';
import type { GridApi } from '@eregister/wit-grid-core';
import type { GridAdapterHandle } from './reactHostBridge.js';
import type { ReactNode } from 'react';

export const GridApiContext = createContext<GridApi<unknown> | null>(null);
export const GridAdapterContext = createContext<GridAdapterHandle<unknown> | null>(null);

export interface GridProviderProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	children: ReactNode;
}

export function GridProvider<TRowData = unknown>({ api, children }: GridProviderProps<TRowData>) {
	return <GridApiContext.Provider value={api as unknown as GridApi<unknown>}>{children}</GridApiContext.Provider>;
}
