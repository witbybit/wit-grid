import React, { createContext, useContext } from 'react';
import type { GridApi, GridReadyEvent } from '@eregister/wit-grid-react';
import type { GridPageType } from './components/GridShared';

type DemoGridContextValue = {
	activeApi: GridApi<any> | null;
	registerGridApi: (page: GridPageType, event: GridReadyEvent<any>) => void;
};

const DemoGridContext = createContext<DemoGridContextValue | null>(null);

export function DemoGridApiScope({ value, children }: { value: DemoGridContextValue; children: React.ReactNode }) {
	return <DemoGridContext.Provider value={value}>{children}</DemoGridContext.Provider>;
}

export function useDemoGridContext() {
	const value = useContext(DemoGridContext);
	if (!value) {
		throw new Error('useDemoGridContext must be used inside DemoGridApiScope');
	}
	return value;
}
