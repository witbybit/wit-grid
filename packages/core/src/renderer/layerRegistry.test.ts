import { describe, expect, it } from 'vitest';
import { LAYER_REGISTRY } from './layerRegistry.js';

const ROOTS = new Set(['scroll-viewport', 'container']);

describe('layer registry (Plan 039)', () => {
	it('has unique layer ids', () => {
		const ids = LAYER_REGISTRY.map((d) => d.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every parent ref resolves to a root or another registered layer', () => {
		const ids = new Set(LAYER_REGISTRY.map((d) => d.id));
		for (const d of LAYER_REGISTRY) {
			expect(ROOTS.has(d.parent) || ids.has(d.parent), `layer "${d.id}" parent "${d.parent}" is unknown`).toBe(true);
		}
	});

	it('has no cyclic parent chains (every layer reaches a root)', () => {
		const byId = new Map(LAYER_REGISTRY.map((d) => [d.id, d] as const));
		for (const d of LAYER_REGISTRY) {
			let cur: string = d.parent;
			let hops = 0;
			while (!ROOTS.has(cur)) {
				const next = byId.get(cur);
				expect(next, `layer "${d.id}" chain hit dead end at "${cur}"`).toBeDefined();
				cur = next!.parent;
				expect(++hops, `layer "${d.id}" has a cyclic parent chain`).toBeLessThan(LAYER_REGISTRY.length + 1);
			}
		}
	});

	it('classNames follow the og-layer / og-* convention and are unique', () => {
		const classes = LAYER_REGISTRY.map((d) => d.className);
		expect(new Set(classes).size).toBe(classes.length);
		for (const c of classes) {
			expect(c.startsWith('og-')).toBe(true);
		}
	});

	it('plan-positioned layers expose an apply(); CSS-only layers may omit it', () => {
		// Most layers (group-panel/header/rows/chrome) derive geometry from the plan and
		// MUST carry an apply. Two categories legitimately have none:
		//   - "exiting" / "presence": pure CSS overlays in content coordinates (fade-out ghosts,
		//     peers' cursors), positioned per child
		//   - "minimap": positioned and drawn by MinimapLayer, which also needs the scroll position
		//   - "view": positioned and filled by GridViewHost while a gallery or calendar is shown
		//   - "header" / "floating-filter": center flex lanes sized by CSS flex:1; no JS
		//     width needed since the pin-lane apply functions set left/right widths.
		const CSS_ONLY = new Set(['exiting', 'presence', 'minimap', 'view', 'header', 'floating-filter']);
		for (const d of LAYER_REGISTRY) {
			if (CSS_ONLY.has(d.id)) {
				expect(d.apply, `CSS-only layer "${d.id}" should not have apply`).toBeUndefined();
			} else {
				expect(typeof d.apply, `layer "${d.id}" must position from the plan via apply`).toBe('function');
			}
		}
	});
});
