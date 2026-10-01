// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import { GridEventName } from '../api/GridEvents.js';
import type { VisualRow } from '../visualRow.js';
import type { DomRowRenderer } from '../rows/hierarchyConfig.js';

type Selection = 'all' | 'some' | 'none';

function group(id: string, key: string, aggregates: Record<string, unknown>, leafCount = 3): VisualRow<any> {
	return {
		kind: 'group',
		id,
		groupId: id,
		field: 'region',
		key,
		keyString: key,
		path: [],
		hierarchy: { level: 0, hasChildren: true, expanded: true, leafCount },
		aggregates,
	} as unknown as VisualRow<any>;
}

function setup(rowRenderer?: DomRowRenderer<any>) {
	const selection: Record<string, Selection> = {};
	const aggregation = [{ colId: 'sales' }, { colId: 'cost' }];
	const listeners: Array<() => void> = [];
	const api: any = {
		getAggregation: vi.fn(() => aggregation),
		getColumnDef: (id: string) => ({ field: id, header: id.toUpperCase() }),
		getTreeData: () => undefined,
		getHierarchyColumn: () => ({ show: { checkbox: true } }),
		getGrouping: () => ({ by: ['region'] }),
		getCellValue: () => undefined,
		isRowNodeSelected: () => false,
		getDescendantSelection: (id: string) => ({ state: selection[id] ?? 'none' }),
		addEventListener: (name: string, fn: () => void) => {
			if (name === GridEventName.rowSelectionChanged) listeners.push(fn);
			return () => listeners.splice(listeners.indexOf(fn), 1);
		},
	};
	const engine: any = {
		stateManager: { getState: () => ({ grouping: rowRenderer ? { rowRenderer: { kind: 'dom', renderer: rowRenderer } } : {} }) },
		getApiRef: () => api,
		getRowModel: () => undefined,
		api,
	};
	const renderer = new FullWidthRowRenderer<any>({ adapterRendersRow: () => false } as any, new WeakMap(), engine);
	const element = document.createElement('div');
	const slot: any = { element, lastPortalRowKey: undefined };
	const bind = (row: VisualRow<any>) =>
		renderer.bind(
			slot,
			row,
			() => {},
			(s) => renderer.release(s)
		);
	return {
		api,
		slot,
		bind,
		selection,
		listeners,
		text: () => element.textContent,
		chips: () => Array.from(element.querySelectorAll('.og-full-width-aggregate')),
	};
}

describe('default group row renderer patching', () => {
	it('keeps chip elements for the same group and writes only changed text', () => {
		const t = setup();
		t.bind(group('g1', 'EU', { sales: 10, cost: 5 }));
		const before = t.chips();
		const strong0 = before[0].querySelector('strong')!;
		const costText = before[1].querySelector('strong')!.firstChild;
		t.bind(group('g1', 'EU', { sales: 11, cost: 5 }));
		const after = t.chips();
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe(before[1]);
		expect(strong0.textContent).toBe('11');
		// Unchanged text node is not rewritten.
		expect(after[1].querySelector('strong')!.firstChild).toBe(costText);
	});

	it('adds and removes chips only when the aggregate set changes', () => {
		const t = setup();
		t.bind(group('g1', 'EU', { sales: 10, cost: 5 }));
		const [sales] = t.chips();
		t.bind(group('g1', 'EU', { sales: 10, cost: null }));
		expect(t.chips()).toHaveLength(1);
		expect(t.chips()[0]).toBe(sales);
	});

	it('a recycled slot shows the new group with nothing from the old one, in place', () => {
		const t = setup();
		t.bind(group('g1', 'EU', { sales: 10, cost: 5 }, 3));
		const root = t.slot.element.querySelector('.og-full-width-row');
		t.bind(group('g2', 'APAC', { sales: 99, cost: null }, 7));
		expect(t.slot.element.querySelector('.og-full-width-row')).toBe(root);
		expect(t.text()).toContain('APAC');
		expect(t.text()).toContain('99');
		expect(t.text()).not.toContain('EU');
		expect(t.text()).not.toContain('COST');
		expect(t.text()).toContain('7');
		expect(t.slot.element.querySelectorAll('.og-full-width-row')).toHaveLength(1);
		expect(t.slot.element.dataset.rowKey).toBe('g2');
	});

	it('a selection change elsewhere does not re-render this row; its own change updates the checkbox', () => {
		const t = setup();
		t.bind(group('g1', 'EU', { sales: 10, cost: 5 }));
		const calls = t.api.getAggregation.mock.calls.length;
		t.selection['other'] = 'all';
		t.listeners.forEach((fn) => fn());
		expect(t.api.getAggregation.mock.calls.length).toBe(calls);
		t.selection['g1'] = 'some';
		t.listeners.forEach((fn) => fn());
		expect(t.api.getAggregation.mock.calls.length).toBe(calls);
		const box = t.slot.element.querySelector('input') as HTMLInputElement;
		expect(box.indeterminate).toBe(true);
	});

	it('remounts a user DOM renderer that has no update', () => {
		const destroy = vi.fn();
		const mount = vi.fn((container: HTMLElement, p: any) => {
			const el = document.createElement('i');
			el.textContent = p.row.id;
			container.appendChild(el);
			return { destroy } as any;
		});
		const t = setup({ mount });
		t.bind(group('g1', 'EU', {}));
		t.bind(group('g2', 'US', {}));
		expect(mount).toHaveBeenCalledTimes(2);
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(t.text()).toBe('g2');
	});

	it('updates a user DOM renderer that has update in place when the slot is recycled', () => {
		const update = vi.fn();
		const destroy = vi.fn();
		const mount = vi.fn(() => ({ update, destroy }));
		const t = setup({ mount });
		t.bind(group('g1', 'EU', {}));
		t.bind(group('g2', 'US', {}));
		expect(mount).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledTimes(1);
		expect(update.mock.calls[0][0].row.id).toBe('g2');
		expect(destroy).not.toHaveBeenCalled();
	});
});
