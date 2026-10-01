// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import {
	canFreezeExistingPortalForIdentity,
	canReuseWarmTextForIdentity,
	resolveScrollCellPresentation,
	type ScrollCellPresentationDeps,
	type ScrollCellPresentationInput,
} from './scrollCellPresentation.js';

it('BOUNDARY: scrollCellPresentation.ts must not import RowCellBinderDeps or any broad binder dependency bag', () => {
	const source = readFileSync(resolve(__dirname, 'scrollCellPresentation.ts'), 'utf-8');
	// Check the actual import statements, not prose — this file's own doc comment on
	// ScrollCellPresentationDeps legitimately names RowCellBinderDeps as the thing it is NOT.
	const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line));
	for (const line of importLines) {
		expect(line).not.toContain("from './rowCellBinder.js'");
		expect(line).not.toContain('RowCellBinderDeps');
	}
});

/**
 * The resolver must never perform a DOM write, portal mount/release, or semantic read — deliberately
 * constructed from ONLY `ScrollCellPresentationDeps` (not the full binder dependency bag) to prove the
 * resolver is testable in isolation. If the resolver ever reached for a semantic read/mount hook, there
 * would be no such method here to call and the test would throw.
 */
function makeDeps(overrides: Partial<ScrollCellPresentationDeps> = {}): ScrollCellPresentationDeps {
	return {
		getCellPortalHost: vi.fn(() => null),
		getRowHeight: vi.fn(() => 40),
		getColWidth: vi.fn(() => 100),
		getCheapDisplayValue: vi.fn(() => ''),
		getFrozenHtmlSnapshot: vi.fn(() => undefined),
		...overrides,
	};
}

function baseInput(
	overrides: Partial<ScrollCellPresentationInput<{ id: string; name: string }>> = {}
): ScrollCellPresentationInput<{ id: string; name: string }> {
	return {
		cellSlot: new CellSlot(document.createElement('div')),
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
			plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			rowVersions: new Map([['r1', 3]]),
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

describe('resolveScrollCellPresentation', () => {
	it('resolves a checkbox-selection column to checkbox-selector regardless of other state', () => {
		const presentation = resolveScrollCellPresentation(makeDeps(), baseInput({ col: { field: 'sel', checkboxSelection: true } as any }));
		expect(presentation.kind).toBe('checkbox-selector');
	});

	it('resolves an off-screen buffered cell with no snapshot to empty, releasing a stale portal', () => {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'stale-key');
		const presentation = resolveScrollCellPresentation(makeDeps(), baseInput({ cellSlot, isInVisibleContent: false }));
		expect(presentation.kind).toBe('buffered');
		if (presentation.kind !== 'buffered') throw new Error('unreachable');
		expect(presentation.contentMode).toBe('empty');
		// It keeps no portal, so the dispatcher releases the stale one the slot still holds.
		expect(presentation.portalKey).toBeUndefined();
	});

	it('resolves a visible primitive cell with no snapshot and no warm state to the "..." placeholder', () => {
		const presentation = resolveScrollCellPresentation(makeDeps(), baseInput());
		expect(presentation.kind).toBe('primitive');
		if (presentation.kind !== 'primitive') throw new Error('unreachable');
		expect(presentation.formattedValue).toBe('...');
		expect(presentation.markDirty).toBe(true);
	});

	it('resolves a fresh custom-live snapshot for a portal-capable column to an impostor variant, not a live mount', () => {
		const snapshot = {
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
			contentKind: 'impostor' as const,
			contentMode: 'fallback' as const,
			formattedValue: 'Fallback name',
			title: '',
		};
		const presentation = resolveScrollCellPresentation(
			makeDeps(),
			baseInput({
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] } } as any,
				snapshot,
			})
		);
		expect(presentation.kind).toBe('text-impostor');
		if (presentation.kind !== 'text-impostor') throw new Error('unreachable');
		expect(presentation.formattedValue).toBe('Fallback name');
		expect(presentation.source).toBe('fallback');
	});

	it('resolves to impostor-html when a matching frozen HTML snapshot is available for this identity', () => {
		const snapshot = {
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
			contentKind: 'impostor' as const,
			contentMode: 'fallback' as const,
			formattedValue: 'Fallback name',
			title: '',
		};
		const deps = makeDeps({
			getRowHeight: () => 40,
			getFrozenHtmlSnapshot: (rowId, colField, expected) =>
				rowId === 'r1' && colField === 'name' && expected.rowVersion === 3 ? { html: '<span>frozen</span>' } : undefined,
		});
		const presentation = resolveScrollCellPresentation(
			deps,
			baseInput({
				col: {
					field: 'name',
					cellRenderer: () => null,
					cellRendererCapabilities: { scrollPresentation: 'html-snapshot' },
				} as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
				snapshot,
			})
		);
		expect(presentation.kind).toBe('html-snapshot');
		if (presentation.kind !== 'html-snapshot') throw new Error('unreachable');
		expect(presentation.frozenHtml).toBe('<span>frozen</span>');
	});

	it('falls back to impostor-text when the frozen HTML snapshot is missing and allowTextFallbackWhenMissing is set', () => {
		const snapshot = {
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
			contentKind: 'impostor' as const,
			contentMode: 'fallback' as const,
			formattedValue: 'Fallback name',
			title: '',
		};
		const deps = makeDeps({
			getRowHeight: () => 60, // row has been resized since the HTML was captured at height 40
			// The row-height gate now lives inside the store (via the rowHeight arg) — this mock
			// stands in for a store that refuses a stale-height capture, exactly as the real
			// HtmlScrollSnapshotStore does.
			getFrozenHtmlSnapshot: (_rowId, _colField, _expected, rowHeight) => (rowHeight === 40 ? { html: '<span>frozen</span>' } : undefined),
		});
		const presentation = resolveScrollCellPresentation(
			deps,
			baseInput({
				col: {
					field: 'name',
					cellRenderer: () => null,
					cellRendererCapabilities: { scrollPresentation: 'html-snapshot', htmlSnapshot: { allowTextFallbackWhenMissing: true } },
				} as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
				snapshot,
			})
		);
		expect(presentation.kind).toBe('text-impostor');
		if (presentation.kind !== 'text-impostor') throw new Error('unreachable');
		expect(presentation.source).toBe('fallback');
	});

	it('shows a pending shell, not raw text, when the frozen HTML snapshot is missing by default', () => {
		const snapshot = {
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
			contentKind: 'impostor' as const,
			contentMode: 'fallback' as const,
			formattedValue: 'Fallback name',
			title: '',
		};
		const deps = makeDeps({ getFrozenHtmlSnapshot: () => undefined });
		const presentation = resolveScrollCellPresentation(
			deps,
			baseInput({
				col: {
					field: 'name',
					cellRenderer: () => null,
					cellRendererCapabilities: { scrollPresentation: 'html-snapshot' },
				} as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom' }] } } as any,
				snapshot,
			})
		);
		expect(presentation.kind).toBe('html-pending');
	});

	it('BLOCKER: never mounts a cold portal-capable cell during normal (non-editing, non-focused) active scroll', () => {
		// mode 'custom-dom' is deliberately NOT in the impostor-capable set (custom-live/custom-imperative/
		// custom) — this is exactly the real-world shape of a DOM-renderer column (ColumnModel.ts sets
		// mode:'custom-dom' for isDomCellRenderer columns), which previously fell all the way through to
		// a synchronous cold mount on first scroll-in. Normal scroll must never do this, regardless of
		// which renderer-capability bucket the column falls into.
		const presentation = resolveScrollCellPresentation(
			makeDeps(),
			baseInput({
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom-dom' }] } } as any,
			})
		);
		expect(presentation.kind).not.toBe('portal-mount');
		expect(presentation.kind).not.toBe('live-renderer');
		// Must degrade to a deterministic, non-mounting placeholder/impostor instead.
		expect(['shell', 'text-impostor', 'html-snapshot', 'primitive']).toContain(presentation.kind);
	});

	it('BLOCKER: an actively-focused portal-capable cell with no snapshot and no live content uses the explicit force-live exception, not the generic portal-mount case', () => {
		const presentation = resolveScrollCellPresentation(
			makeDeps(),
			baseInput({
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: {
					...baseInput().ctx,
					plan: { columnPlans: [{ isCustom: true, mode: 'custom-dom' }] },
					focusedCell: { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' },
				} as any,
			})
		);
		expect(presentation.kind).toBe('live-renderer');
		if (presentation.kind !== 'live-renderer') throw new Error('unreachable');
		expect(presentation.forceLiveInteractive).toBe(true);
	});

	it('BLOCKER: an actively-editing portal-capable cell with no snapshot and no live content uses the explicit force-live exception', () => {
		const presentation = resolveScrollCellPresentation(
			makeDeps(),
			baseInput({
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: {
					...baseInput().ctx,
					plan: { columnPlans: [{ isCustom: true, mode: 'custom-dom' }] },
					activeEdit: { rowId: 'r1', colField: 'name', colId: 'name', columnInstanceId: 'name' },
				} as any,
			})
		);
		expect(presentation.kind).toBe('live-renderer');
		if (presentation.kind !== 'live-renderer') throw new Error('unreachable');
		expect(presentation.forceLiveInteractive).toBe(true);
	});

	it('never calls a semantic read or portal-mount hook — deps deliberately omit them', () => {
		// If the resolver reached for getCellValue/valueGetter/formula/style/integrity/portal-mount,
		// makeDeps() doesn't define them and the call would throw synchronously.
		expect(() =>
			resolveScrollCellPresentation(
				makeDeps(),
				baseInput({
					col: { field: 'name', cellRenderer: () => null } as any,
					ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] } } as any,
				})
			)
		).not.toThrow();
	});
});

describe('canFreezeExistingPortalForIdentity', () => {
	function warmPortalSlot(portalKey: string): CellSlot<{ id: string; name: string }> {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', portalKey);
		return cellSlot;
	}

	it('allows freezing when identity matches, not a row rebind, and the host has authoritative content', () => {
		const cellSlot = warmPortalSlot('ci1:name');
		const deps = makeDeps({
			getCellPortalHost: () => {
				const host = document.createElement('div');
				host.appendChild(document.createElement('span'));
				return host;
			},
		});
		expect(canFreezeExistingPortalForIdentity(deps, cellSlot, 'ci1:name', false)).toBe(true);
	});

	it('refuses to freeze across a row rebind even when the portal key matches', () => {
		const cellSlot = warmPortalSlot('ci1:name');
		const deps = makeDeps({
			getCellPortalHost: () => {
				const host = document.createElement('div');
				host.appendChild(document.createElement('span'));
				return host;
			},
		});
		expect(canFreezeExistingPortalForIdentity(deps, cellSlot, 'ci1:name', true)).toBe(false);
	});

	it('refuses to freeze when the mounted portal key does not match the expected cell', () => {
		const cellSlot = warmPortalSlot('ci1:name');
		const deps = makeDeps({
			getCellPortalHost: () => {
				const host = document.createElement('div');
				host.appendChild(document.createElement('span'));
				return host;
			},
		});
		expect(canFreezeExistingPortalForIdentity(deps, cellSlot, 'ci2:name', false)).toBe(false);
	});

	it('refuses to freeze when the portal host has no authoritative content', () => {
		const cellSlot = warmPortalSlot('ci1:name');
		const deps = makeDeps({ getCellPortalHost: () => null });
		expect(canFreezeExistingPortalForIdentity(deps, cellSlot, 'ci1:name', false)).toBe(false);
	});
});

describe('canReuseWarmTextForIdentity', () => {
	it('returns undefined when the warm binding version is not fresh', () => {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', undefined, 'hello');
		expect(canReuseWarmTextForIdentity(cellSlot, false)).toBeUndefined();
	});

	it('returns undefined when there is no cached formatted value', () => {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		expect(canReuseWarmTextForIdentity(cellSlot, true)).toBeUndefined();
	});

	it('returns the cached formatted value and content mode when fresh and present', () => {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', undefined, 'hello');
		expect(canReuseWarmTextForIdentity(cellSlot, true)).toEqual({ formattedValue: 'hello', contentMode: 'text' });
	});

	it('still returns a portal-mode value — callers, not this helper, decide whether portal content is acceptable', () => {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', undefined, 'hello');
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'ci1:name');
		const warm = canReuseWarmTextForIdentity(cellSlot, true);
		expect(warm?.contentMode).toBe('portal');
	});
});
