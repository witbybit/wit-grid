import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClientGrid, type GroupRenderContext } from '@eregister/wit-grid-core';
import { GroupCount, GroupToggle } from './GroupParts.js';

interface Row {
	id: string;
	category: string;
}

afterEach(cleanup);

function makeGrid() {
	return createClientGrid<Row>({
		rows: [
			{ id: '1', category: 'A' },
			{ id: '2', category: 'A' },
			{ id: '3', category: 'B' },
		],
		columns: [{ field: 'category', header: 'Category' }],
		getRowId: (row) => row.id,
		// Collapsed: none of the group's rows are rendered.
		initialState: { grouping: { by: ['category'] }, rowSelection: { mode: 'multiple' } },
	});
}

describe('row renderer specs in the adapter', () => {
	it('renders the React spec a row was mounted with, over the detailRowRenderer prop', async () => {
		const { createPortalStore, PortalManager } = await import('./GridPortal.js');
		const api = makeGrid();
		const store = createPortalStore<Row>();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const Spec = ({ visualRow }: { visualRow: { id: string } }) => <span data-testid='spec'>spec for {visualRow.id}</span>;
		act(() => {
			store.mountRow('detail:1', container, { kind: 'detail', id: 'detail:1', parentId: '1', height: 40 } as never, {
				kind: 'react',
				component: Spec,
			});
		});
		render(<PortalManager store={store} api={api} detailRowRenderer={() => <span data-testid='prop'>prop</span>} />);
		expect(screen.getByTestId('spec').textContent).toBe('spec for detail:1');
		expect(screen.queryByTestId('prop')).toBeNull();
		container.remove();
		api.destroy();
	});

	it('renders a group row component with the GroupRenderContext as its props, and re-renders on a new context', async () => {
		const { createPortalStore, PortalManager } = await import('./GridPortal.js');
		const api = makeGrid();
		const store = createPortalStore<Row>();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const toggle = vi.fn();
		const makeContext = (expanded: boolean, isStuck: boolean) =>
			({
				id: 'group:category=A',
				kind: 'group',
				label: 'A',
				count: '2',
				level: 0,
				hasChildren: true,
				expanded,
				isStuck,
				toggle,
			}) as unknown as GroupRenderContext<Row>;
		const GroupRow = (ctx: GroupRenderContext<Row>) => (
			<span data-testid='group'>
				<GroupToggle ctx={ctx} />
				{ctx.label}
				<GroupCount ctx={ctx} />|{ctx.expanded ? 'open' : 'closed'}|{ctx.isStuck ? 'stuck' : 'rest'}
			</span>
		);
		const row = { kind: 'group', id: 'group:category=A' } as never;
		const spec = { kind: 'react', component: GroupRow } as const;
		act(() => {
			store.mountRow('group:category=A', container, row, spec, makeContext(true, false));
		});
		render(<PortalManager store={store} api={api} />);
		expect(screen.getByTestId('group').textContent).toBe('A2|open|rest');
		expect(container.querySelector('.og-hierarchy-toggle-open')).not.toBeNull();

		// The same row with a new context (it stuck): the component re-renders with the new props.
		await act(async () => {
			store.mountRow('group:category=A', container, row, spec, makeContext(true, true));
			await Promise.resolve();
		});
		expect(screen.getByTestId('group').textContent).toBe('A2|open|stuck');

		fireEvent.click(container.querySelector('.og-hierarchy-toggle')!);
		expect(toggle).toHaveBeenCalledTimes(1);
		container.remove();
		api.destroy();
	});

	it('renders the groupRowRenderer prop with the context, and a custom hierarchy cell component into a cell container', async () => {
		const { createPortalStore, PortalManager } = await import('./GridPortal.js');
		const api = makeGrid();
		const store = createPortalStore<Row>();
		const cell = document.createElement('div');
		const body = document.createElement('div');
		document.body.append(cell, body);
		const ctx = {
			id: 'group:category=B',
			kind: 'group',
			label: 'B',
			count: null,
			level: 1,
			indentPx: 16,
			hasChildren: false,
		} as unknown as GroupRenderContext<Row>;
		const row = { kind: 'group', id: 'group:category=B' } as never;
		const Cell = (props: GroupRenderContext<Row>) => (
			<b data-testid='cell' style={{ paddingLeft: props.indentPx }}>
				{props.label}
				<GroupCount ctx={props} />
			</b>
		);
		act(() => {
			store.mountRow('hierarchy-cell:ci1', cell, row, { kind: 'react', component: Cell }, ctx);
			store.mountRow('group:category=B', body, row, undefined, ctx);
		});
		render(
			<PortalManager
				store={store}
				api={api}
				groupRowRenderer={(c) => (
					<i data-testid='prop'>
						{c.label}:{c.level}
					</i>
				)}
			/>
		);
		expect(cell.querySelector('[data-testid=cell]')!.textContent).toBe('B');
		expect((cell.querySelector('[data-testid=cell]') as HTMLElement).style.paddingLeft).toBe('16px');
		expect(body.querySelector('[data-testid=prop]')!.textContent).toBe('B:1');
		cell.remove();
		body.remove();
		api.destroy();
	});
});
