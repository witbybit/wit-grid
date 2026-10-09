// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createClientGrid } from '@eregister/wit-grid-core';
import { GridProvider } from '../gridContext.js';
import { GridView } from '../GridView.js';

afterEach(cleanup);

// jsdom has no ResizeObserver; the grid view observes its container with one.
class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

interface Row {
	id: string;
	name: string;
	status: string;
}

function setup(panel: 'filters' | 'query', renderFilter?: () => React.ReactNode) {
	const api = createClientGrid<Row>({
		rows: [
			{ id: '1', name: 'Alice', status: 'Active' },
			{ id: '2', name: 'Bob', status: 'Paused' },
			{ id: '3', name: 'Cara', status: 'Active' },
		],
		columns: [
			{ field: 'name', header: 'Name', width: 120 },
			{
				field: 'status',
				header: 'Status',
				width: 120,
				filterDef: renderFilter ? { type: 'custom', renderFilter } : { type: 'select' },
			},
		],
	});
	render(
		<div style={{ width: 600, height: 320 }}>
			<GridProvider api={api}>
				<GridView api={api} enableNavigation={false} sidebar={{ panels: ['filters', 'query'], defaultOpen: panel }} />
			</GridProvider>
		</div>
	);
	return api;
}

describe('the sidebar hosts the core filter editors', () => {
	it('Filters panel: a column section shows its editor, with counts, and filters the grid', async () => {
		const api = setup('filters');
		await waitFor(() => expect(screen.getAllByText('Status').some((el) => el.closest('[aria-expanded]'))).toBe(true));
		fireEvent.click(screen.getAllByText('Status').find((el) => el.closest('[aria-expanded]'))!);
		const editor = await waitFor(() => {
			const host = document.querySelector('.og-sb-section-body') as HTMLElement;
			expect(host).toBeTruthy();
			return host;
		});
		// The sidebar wears the grid's theme scope, so it follows the grid's theme.
		expect((document.querySelector('.og-sb') as HTMLElement).dataset.ogThemeScope).toBe(api.getContainer()?.dataset.ogThemeScope);
		const active = [...editor.querySelectorAll('.og-ct-option')].find((el) => el.textContent?.includes('Active')) as HTMLElement;
		expect(active.querySelector('.og-ct-option-count')!.textContent).toBe('2');
		act(() => active.click());
		expect(api.getStateSnapshot().filterModel).toEqual({ status: { type: 'select', values: ['Active'], labels: ['Active'] } });
		await waitFor(() => expect(document.querySelector('.og-grid-container')!.textContent).not.toContain('Bob'));
		expect(document.querySelector('.og-grid-container')!.textContent).toContain('Cara');
		api.destroy();
	});

	it('Query panel: a condition edits its filter with the column’s editor and applies on Apply', async () => {
		const api = setup('query');
		fireEvent.click(await waitFor(() => screen.getByText('Add a condition')));
		fireEvent.click(screen.getByLabelText('Column'));
		const statusOption = [...document.querySelectorAll<HTMLElement>('.og-ct-popover .og-ct-option')].find((el) =>
			el.textContent?.includes('Status')
		)!;
		act(() => {
			statusOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			statusOption.click();
		});
		const paused = await waitFor(() => {
			const option = [...document.querySelectorAll<HTMLElement>('.og-sb-qcond .og-ct-option')].find((el) => el.textContent?.includes('Paused'));
			expect(option).toBeTruthy();
			return option!;
		});
		act(() => paused.click());
		fireEvent.click(screen.getByText('Apply'));
		const query = api.getStateSnapshot().queryModel!;
		expect(query.root.children[0]).toMatchObject({ kind: 'condition', columnId: 'status', filter: { type: 'select', values: ['Paused'] } });
		await waitFor(() => expect(document.querySelector('.og-grid-container')!.textContent).not.toContain('Alice'));
		expect(document.querySelector('.og-grid-container')!.textContent).toContain('Bob');
		api.destroy();
	});

	it('custom React filters render through the grid’s portal tree', async () => {
		const renderFilter = vi.fn(() => <span data-testid='custom-filter'>custom</span>);
		const api = setup('filters', renderFilter);
		await waitFor(() => expect(screen.getAllByText('Status').some((el) => el.closest('[aria-expanded]'))).toBe(true));
		fireEvent.click(screen.getAllByText('Status').find((el) => el.closest('[aria-expanded]'))!);
		await waitFor(() => expect(screen.getByTestId('custom-filter')).toBeTruthy());
		expect(renderFilter).toHaveBeenCalledWith(expect.objectContaining({ colField: 'status', surface: 'sidebar' }));
		api.destroy();
	});
});
