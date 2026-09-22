# Plan 126: Insight Layer Foundation

## Mission

Create a small, safe overlay foundation that allows Wit Grid to expose data-integrity tools without polluting the core row model, renderer, commit kernel, invalidation architecture, or history system.

This plan is the foundation for:

```text
Data Quality
Data Diff
Live Stream Flash
Conflict Indicators
Future Cell Lineage
Future “Why Did This Cell Change?”
Future Replay / Time Travel
Future Data Review workflows
```

The feature must sit on top of the existing engine.

It must not become:

```text
a new row model
a new renderer
a new mutation system
a new validation system
a new history system
a special-case invalidation path
```

The goal is:

```text
Insight layers add metadata, decorations, reports, and diagnostics.
Core grid remains the authority for state, mutation, rendering, invalidation, and history.
```

---

## Non-negotiable architectural rules

Hard rules:

```text
No direct row mutation.
No direct DOM mutation outside the existing renderer path.
No direct renderer refresh.
No custom invalidation path.
No custom history system.
No feature-specific row model branches.
No feature-specific renderer branches.
No feature-specific selection/focus model.
No direct requestAnimationFrame from insight layers.
No hidden side-channel state that competes with GridState.
```

All visual output must flow through:

```text
Insight layer
→ insight registry
→ existing cell/row decoration path
→ existing invalidation/render/frame path
```

All data changes must flow through:

```text
GridApi / domain mutation
→ GridCommitKernel
→ declared invalidation
→ FrameCoordinator
```

---

## New core insight types

Add shared types in core.

```ts
export type GridInsightLayerId = 'dataQuality' | 'diff' | 'liveStream' | 'conflict';

export type GridInsightSeverity = 'info' | 'warning' | 'error';

export interface GridCellDecoration {
	readonly layerId: GridInsightLayerId;
	readonly kind: string;
	readonly severity?: GridInsightSeverity;
	readonly className?: string;
	readonly title?: string;
	readonly data?: unknown;
}

export interface GridRowDecoration {
	readonly layerId: GridInsightLayerId;
	readonly kind: string;
	readonly severity?: GridInsightSeverity;
	readonly className?: string;
	readonly title?: string;
	readonly data?: unknown;
}

export interface GridInsightLayer {
	readonly id: GridInsightLayerId;

	getCellDecorations?(rowId: string, colField: string): readonly GridCellDecoration[];

	getRowDecorations?(rowId: string): readonly GridRowDecoration[];

	getDiagnostics?(): unknown;

	destroy?(): void;
}
```

Keep this contract intentionally small.

Do not add write APIs here.

Insight layers are for observation, reporting, diagnostics, and visual metadata. They do not mutate grid data.

---

## Insight registry

Add:

```ts
export class GridInsightRegistry {
	register(layer: GridInsightLayer): void;
	unregister(id: GridInsightLayerId): void;

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[];

	getRowDecorations(rowId: string): readonly GridRowDecoration[];

	getDiagnostics(): Record<string, unknown>;

	clear(): void;
}
```

Implementation rules:

- layer IDs are unique;
- registering the same ID replaces or rejects explicitly; choose one and test it;
- unregister calls `destroy()`;
- `clear()` calls `destroy()` on all layers;
- returned decoration arrays are snapshots;
- diagnostics are snapshots, not live mutable internals;
- registry does not know about specific features.

Suggested implementation behavior:

```ts
register(layer) {
  const existing = this.layers.get(layer.id);
  existing?.destroy?.();
  this.layers.set(layer.id, layer);
}
```

This makes repeated feature enablement safe.

---

## Runtime integration

Attach the registry to the internal runtime/store.

Example:

```ts
runtime.insights = new GridInsightRegistry();
```

Do not expose runtime directly.

Expose only safe API methods later.

Potential internal access:

```ts
getInsightRegistryFromApi(api);
```

only if your architecture already supports internal API lookups.

---

## Render integration

The existing renderer should ask for decorations when composing cell/row render state.

Conceptual flow:

```text
cell state
+ focus state
+ selection state
+ validation state
+ insight decorations
→ classes / tooltip / aria / data attrs
```

Initial implementation can be simple:

```ts
const decorations = runtime.insights.getCellDecorations(rowId, colField);

for (const decoration of decorations) {
	if (decoration.className) {
		cellElement.classList.add(decoration.className);
	}

	if (decoration.title) {
		cellElement.title = mergeCellTitle(cellElement.title, decoration.title);
	}
}
```

Long-term target:

```text
cell view state
→ decoration collector
→ renderer applies a stable decoration snapshot
```

Do not let Data Quality, Diff, Live Stream, or Conflict managers touch DOM directly.

---

## Decoration invalidation

Add one narrow invalidation reason/category:

```text
insightDecorations
```

or use the existing cell decoration invalidation path if one already exists.

Insight layers must request invalidation through existing systems:

```ts
requestInvalidation('insight-decoration-changed');
```

Do not schedule RAF directly.

Do not call renderer refresh directly.

Do not publish broad full refresh unless the existing invalidation system normalizes it.

---

## Base CSS

Add base classes.

```css
.og-cell-insight-info {
}

.og-cell-insight-warning {
}

.og-cell-insight-error {
}

.og-row-insight-info {
}

.og-row-insight-warning {
}

.og-row-insight-error {
}
```

Feature-specific classes come in later plans.

---

## DevTools integration

Extend diagnostics snapshot from Plan 126 DevTools if already present:

```ts
interface GridDiagnosticsSnapshot {
	readonly insights?: Record<string, unknown>;
}
```

DevTools should show:

- registered insight layers;
- per-layer diagnostics;
- decoration counts if available;
- last invalidation reason if available.

This proves the tools are observable.

---

## API surface

Keep public API minimal.

Initial internal/dev-safe API:

```ts
api.getInsightDiagnostics(): Record<string, unknown>;
```

Do not expose `registerInsightLayer()` as a stable public API yet unless you want third-party insight plugins immediately.

For now, built-in systems register themselves internally.

---

## Source guards

Add architecture guard tests preventing insight layers from becoming a side channel.

Forbidden inside insight feature folders:

```text
direct row mutation
direct DOM mutation
direct requestAnimationFrame
direct setTimeout except approved stream scheduler later
direct GridStore state writes
direct renderer refresh
direct history manipulation
manual selection/focus mutation
```

Allowed:

```text
read row data through approved accessors
request invalidation through approved invalidation manager
commit changes through GridApi/domain mutation APIs
return decorations/reports/diagnostics
```

---

## Tests

Add tests:

1. Can register an insight layer.
2. Can unregister an insight layer.
3. `destroy()` is called on unregister.
4. `clear()` destroys all layers.
5. Cell decorations are aggregated from multiple layers.
6. Row decorations are aggregated from multiple layers.
7. Diagnostics include each registered layer.
8. Renderer can consume decoration classes without knowing feature-specific layer types.
9. Disabled/no layers add no classes.
10. Insight decorations do not mutate row data.
11. Source guard prevents direct DOM/row mutation in insight modules.
12. Destroying the grid clears registered insight layers.

---

## Demo requirement

Add a tiny demo-only insight layer:

```ts
const demoLayer: GridInsightLayer = {
	id: 'dataQuality',
	getCellDecorations(rowId, colField) {
		if (rowId === 'row-1' && colField === 'amount') {
			return [
				{
					layerId: 'dataQuality',
					kind: 'demo-warning',
					severity: 'warning',
					className: 'og-cell-insight-warning',
					title: 'Demo insight warning',
				},
			];
		}

		return [];
	},
};
```

Register it in a hidden/dev demo to prove the pipeline works.

This should be removed or kept under a test/demo feature flag.

---

## Completion gate

Plan 126 is complete when:

- `GridInsightRegistry` exists;
- insight decorations can be consumed by the existing render path;
- no feature-specific renderer branches are required;
- diagnostics expose registered layers;
- source guards prevent architecture pollution;
- no mutation, history, row model, or renderer authority is added.

Final report must say:

```text
Plan 126 complete. Wit Grid now has a safe Insight Layer foundation for data-integrity tools. Insight layers can expose read-only diagnostics and cell/row decorations without owning data, rendering, mutation, invalidation, history, or row models.
```
