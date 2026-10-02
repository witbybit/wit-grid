// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { resolveScrollCellPresentation, type ScrollCellPresentationDeps, type ScrollCellPresentationInput } from './scrollCellPresentation.js';

type Row = { id: string; name: string };
type Input = ScrollCellPresentationInput<Row>;

const REACT_RENDERER = () => null;
const DOM_RENDERER = { mount: () => ({ update() {} }) };
const POINTER = { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' };

function deps(overrides: Partial<ScrollCellPresentationDeps> = {}): ScrollCellPresentationDeps {
	return { getCellPortalHost: vi.fn(() => null), getCheapDisplayValue: vi.fn(() => 'Name 1'), ...overrides };
}

function input(overrides: Partial<Input> = {}, ctx: Record<string, unknown> = {}, mode = 'primitive', isCustom = false): Input {
	return {
		cellSlot: new CellSlot<Row>(document.createElement('div')),
		node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
		rowIndex: 0,
		colIndex: 0,
		col: { field: 'name' } as any,
		lane: 'center',
		ctx: {
			activeEdit: null,
			focusedCell: null,
			globalVersion: 7,
			insightVersion: 0,
			styleVersion: 0,
			selectionVersion: 0,
			hasDeferredCellStyleRules: false,
			hasInsightDecorations: false,
			isScrolling: true,
			loadingVersion: 0,
			plan: { columnPlans: [{ isCustom, mode }] },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			rowVersions: new Map([['r1', 3]]),
			...ctx,
		} as any,
		isRowRebind: false,
		isRowLoading: false,
		isInVisibleContent: true,
		snapshot: undefined,
		isWarmBindingVersionFresh: false,
		rowVersion: 3,
		cellKey: 'ci1:name',
		...overrides,
	};
}

/** A slot already showing this cell's mounted portal, with a host holding real content. */
function portalSlot(): { cellSlot: CellSlot<Row>; d: ScrollCellPresentationDeps } {
	const cellSlot = new CellSlot<Row>(document.createElement('div'));
	cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'ci1:name');
	cellSlot.lastMountedRowVersion = 3;
	cellSlot.lastMountedGlobalVersion = 7;
	const host = document.createElement('div');
	host.appendChild(document.createElement('span'));
	return { cellSlot, d: deps({ getCellPortalHost: () => host }) };
}

const reactText = { field: 'name', cellRenderer: REACT_RENDERER, cellRendererCapabilities: { scroll: 'text' } } as any;
const reactLive = { field: 'name', cellRenderer: REACT_RENDERER, cellRendererCapabilities: { scroll: 'live' } } as any;
const domLive = { field: 'name', cellRenderer: DOM_RENDERER, cellRendererCapabilities: { scroll: 'live' } } as any;
const domText = { field: 'name', cellRenderer: DOM_RENDERER, cellRendererCapabilities: { scroll: 'text' } } as any;

const fallbackSnapshot = {
	rowId: 'r1',
	colField: 'name',
	rowVersion: 3,
	globalVersion: 7,
	insightVersion: 0,
	styleVersion: 0,
	loadingVersion: 0,
	selectionVersion: 0,
	baseClassName: 'og-cell',
	stateClassName: '',
	decorationClassName: '',
	classTokens: ['og-cell'],
	className: 'og-cell',
	contentKind: 'stand-in' as const,
	contentMode: 'fallback' as const,
	formattedValue: 'Fallback name',
	title: '',
};

describe('scroll presentation decision table (scrollCellPresentation.ts doc comment)', () => {
	const rows: Array<[string, () => { d: ScrollCellPresentationDeps; i: Input }, string, Record<string, unknown>]> = [
		['1 checkbox', () => ({ d: deps(), i: input({ col: { field: 'sel', checkboxSelection: true } as any }) }), 'checkbox-selector', {}],
		['2 buffered: non-live outside the visible area', () => ({ d: deps(), i: input({ isInVisibleContent: false }) }), 'buffered', {}],
		['3 plain primitive column', () => ({ d: deps(), i: input() }), 'primitive', { markDirty: true }],
		[
			'4 React live',
			() => ({ d: deps(), i: input({ col: reactLive }, {}, 'custom-live', true) }),
			'live-renderer',
			{ forceLiveInteractive: false },
		],
		[
			'5a DOM live, unchanged',
			() => {
				const { cellSlot, d } = portalSlot();
				return { d, i: input({ cellSlot, col: domLive }, {}, 'custom-dom', true) };
			},
			'frozen-portal',
			{ markDirty: false },
		],
		[
			'5b DOM live, changed',
			() => {
				const { cellSlot, d } = portalSlot();
				return { d, i: input({ cellSlot, col: domLive }, { globalVersion: 8 }, 'custom-dom', true) };
			},
			'dom-update',
			{},
		],
		[
			'6 text holding its own mounted portal',
			() => {
				const { cellSlot, d } = portalSlot();
				return { d, i: input({ cellSlot, col: reactText }, {}, 'custom-live', true) };
			},
			'frozen-portal',
			{ markDirty: false },
		],
		[
			'7 React text with a stand-in prewarm snapshot',
			() => ({ d: deps(), i: input({ col: reactText, snapshot: fallbackSnapshot }, {}, 'custom-live', true) }),
			'primitive',
			{ formattedValue: 'Fallback name', markDirty: true },
		],
		[
			'8a editing text cell',
			() => ({ d: deps(), i: input({ col: reactText }, { activeEdit: POINTER }, 'custom-live', true) }),
			'live-renderer',
			{ forceLiveInteractive: true },
		],
		[
			'8b focused text cell',
			() => ({ d: deps(), i: input({ col: reactText }, { focusedCell: POINTER }, 'custom-live', true) }),
			'live-renderer',
			{ forceLiveInteractive: true },
		],
		[
			'9 text entering view',
			() => ({ d: deps(), i: input({ col: reactText }, {}, 'custom-live', true) }),
			'stand-in',
			{ formattedValue: 'Name 1', contentMode: 'fallback' },
		],
		[
			'9 DOM text entering view',
			() => ({ d: deps(), i: input({ col: domText }, {}, 'custom-dom', true) }),
			'stand-in',
			{ contentMode: 'fallback' },
		],
	];

	it.each(rows)('%s -> %s', (_name, build, kind, flags) => {
		const { d, i } = build();
		const result = resolveScrollCellPresentation(d, i);
		expect(result.kind).toBe(kind);
		expect(result).toMatchObject(flags);
	});

	it("a 'live' DOM cell outside the visible area is not buffered", () => {
		const result = resolveScrollCellPresentation(deps(), input({ col: domLive, isInVisibleContent: false }, {}, 'custom-dom', true));
		expect(result.kind).not.toBe('buffered');
		expect(result.kind).toBe('dom-update');
	});
});
