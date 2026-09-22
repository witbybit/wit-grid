# Plan 077: Advanced Cell Editors

> **Summary**: Ship three production-quality built-in cell editors — `DateEditor` (calendar picker), `AutocompleteEditor` (async server lookup with debounce), and `SelectEditor` (multi-select dropdown) — all rendered as DOM portals via the existing `PortalMountManager` to avoid overflow clipping, using the existing edit lifecycle, and styled via theme tokens.

## Status

- **Priority**: P1 — feature, high user value
- **Effort**: L
- **Risk**: MEDIUM — new DOM portal usage pattern in React package, no core engine changes
- **Depends on**: Plans 065–074 (edit lifecycle, portal mount manager)
- **Category**: feature, cell-editors, react-ui, portals
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

The grid supports custom cell editors via `ColumnDef.cellEditor` but ships no built-in editors beyond the default inline-text behavior triggered by navigation. Every consumer must implement date pickers, dropdowns, and autocomplete from scratch — duplicating positioning, portal management, keyboard handling, and theme integration.

The existing infrastructure is ready:

- `CellEditorProps` provides `rowId`, `colField`, `value`, `onChange`, `onCommit`, `onCancel`, `api`.
- `PortalMountManager` (from plan 067) renders DOM portals at body-level, avoiding `overflow: hidden` clipping.
- `api.getTheme()` returns live `ThemeTokens` for consistent styling.
- `EditingFeatureController` handles the full edit lifecycle.

## Goals

1. `DateEditor` — native `<input type="date">` wrapped in a styled popover portal. Supports `min`, `max`, `format` options.
2. `AutocompleteEditor` — text input with async `fetchOptions(query)` callback, debounced loading, keyboard-navigable result list, multi-select mode.
3. `SelectEditor` — static options list as a keyboard-navigable dropdown portal, single or multi-select.
4. All editors: ESC → `onCancel`, Enter/Tab → `onCommit`, click-outside → `onCommit` with current value.
5. Portal positioning: anchored to the cell DOM rect (`getBoundingClientRect()`), flipping to stay within viewport.
6. Fully theme-aware via `api.getTheme()`.
7. Exported from `@eregister/wit-grid-react` as named exports.

## Editor API

Each editor is a factory that takes editor-specific options and returns a `ColumnDef.cellEditor` compatible function:

```ts
// DateEditor
export function createDateEditor(options?: DateEditorOptions): CellEditorFactory;

export interface DateEditorOptions {
	min?: string; // ISO date string, e.g. "2020-01-01"
	max?: string; // ISO date string
	format?: 'iso' | 'locale'; // How to display and commit the value (default: 'iso')
	placeholder?: string;
}

// AutocompleteEditor
export function createAutocompleteEditor<T = string>(options: AutocompleteEditorOptions<T>): CellEditorFactory;

export interface AutocompleteEditorOptions<T = string> {
	fetchOptions: (query: string, signal: AbortSignal) => Promise<AutocompleteOption<T>[]>;
	debounceMs?: number; // Default: 200
	minQueryLength?: number; // Default: 0 (shows all on empty)
	maxResults?: number; // Default: 8
	getOptionLabel: (option: T) => string;
	getOptionValue: (option: T) => string;
	multiSelect?: boolean; // Default: false
	placeholder?: string;
}

export interface AutocompleteOption<T = string> {
	label: string;
	value: T;
	disabled?: boolean;
}

// SelectEditor
export function createSelectEditor<T = string>(options: SelectEditorOptions<T>): CellEditorFactory;

export interface SelectEditorOptions<T = string> {
	options: SelectOption<T>[] | ((api: GridApi) => SelectOption<T>[]);
	getOptionLabel?: (option: T) => string; // Default: String(option)
	getOptionValue?: (option: T) => string; // Default: String(option)
	multiSelect?: boolean; // Default: false
	searchable?: boolean; // Default: false (adds a filter input at top of list)
	placeholder?: string;
	maxHeight?: number; // Dropdown max height px (default: 240)
}

export interface SelectOption<T = string> {
	label: string;
	value: T;
	disabled?: boolean;
	group?: string; // Optional group header
}

// CellEditorFactory type alias (for documentation)
type CellEditorFactory = (props: CellEditorProps) => React.ReactElement;
```

## Portal positioning

All three editors share a common `useAnchoredPortal` hook:

```ts
// packages/react/src/editors/hooks/useAnchoredPortal.ts
function useAnchoredPortal(
	cellRect: DOMRect,
	popoverSize: { width: number; height: number }
): {
	top: number;
	left: number;
	transformOrigin: string;
};
```

Logic:

1. Default position: top of popover aligns to bottom of cell, left aligns to left of cell.
2. Flip vertical if popover would overflow bottom of viewport.
3. Flip horizontal if popover would overflow right of viewport.
4. Returns `top`, `left`, `transformOrigin` for a `position: fixed` element.

The `cellRect` is obtained from `api.getContainer()` + cell DOM element lookup, or passed directly via a ref in `CellEditorProps` (add `cellElement?: HTMLElement` to `CellEditorProps`).

## Theme integration

Each editor reads `api.getTheme()` at render time:

```ts
const theme = props.api.getTheme();
// theme.colors.panelBg      → popover background
// theme.colors.border        → border color
// theme.colors.primaryAccent → selected/focused item highlight
// theme.colors.cellText      → option text
// theme.colors.inputBg       → text input background
// theme.colors.buttonBg      → action buttons
// theme.radius.md            → border-radius
// theme.spacing.sm/md        → padding
```

Inline styles only — no Tailwind dependency in the core editor components. This ensures editors work outside the demo app.

## Keyboard behavior

### DateEditor

| Key                | Behavior                 |
| ------------------ | ------------------------ |
| `Escape`           | `onCancel()`             |
| `Enter`            | `onCommit(currentValue)` |
| `Tab`              | `onCommit(currentValue)` |
| Calendar day click | `onCommit(selectedDate)` |

### AutocompleteEditor

| Key                     | Behavior                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `ArrowDown`             | Focus next result                                                   |
| `ArrowUp`               | Focus prev result                                                   |
| `Enter` (list focused)  | Select focused option; in multi-select: toggle                      |
| `Enter` (no list focus) | `onCommit(currentValue)`                                            |
| `Escape`                | Clear query → close dropdown (first Esc); second Esc → `onCancel()` |
| `Tab`                   | `onCommit(currentValue)`                                            |
| Click result            | Select; single-select commits immediately                           |
| Click outside           | `onCommit(currentValue)`                                            |

### SelectEditor

| Key                         | Behavior                                             |
| --------------------------- | ---------------------------------------------------- |
| `ArrowDown / Up`            | Move highlighted option                              |
| `Enter / Space`             | Toggle selection (multi) or select + commit (single) |
| `Escape`                    | `onCancel()`                                         |
| `Tab`                       | `onCommit(currentValue)`                             |
| Type char (searchable=true) | Filter options                                       |
| Click outside               | `onCommit(currentValue)`                             |

## File structure

```
packages/react/src/
  editors/
    DateEditor.tsx
    AutocompleteEditor.tsx
    SelectEditor.tsx
    hooks/
      useAnchoredPortal.ts
      useClickOutside.ts
      useKeyboardList.ts      ← shared ArrowUp/Down/Enter handler
    index.ts                  ← exports createDateEditor, createAutocompleteEditor, createSelectEditor
```

Export from `packages/react/src/index.ts`:

```ts
export { createDateEditor, createAutocompleteEditor, createSelectEditor } from './editors/index.js';
export type { DateEditorOptions, AutocompleteEditorOptions, AutocompleteOption, SelectEditorOptions, SelectOption } from './editors/index.js';
```

## CellEditorProps extension

Add `cellElement?: HTMLElement` to `CellEditorProps` so editors can anchor the portal to the exact cell DOM node:

```ts
// packages/core/src/store.ts
export interface CellEditorProps<TRowData = unknown, TValue = unknown> {
	rowId: string;
	colField: string;
	value: TValue;
	onChange: (value: TValue) => void;
	onCommit: (finalValue?: TValue) => void;
	onCancel: () => void;
	api: GridApi<TRowData>;
	cellElement?: HTMLElement; // ← NEW: the DOM element of the cell being edited
}
```

The React cell renderer passes the cell's DOM node via a ref when invoking the editor render function.

## Phases

### Phase 1 — Shared hooks and portal infrastructure

1. Implement `useAnchoredPortal` hook.
2. Implement `useClickOutside` hook.
3. Implement `useKeyboardList` hook (shared arrow-key list navigation).
4. Add `cellElement` to `CellEditorProps` in core.
5. Wire cell element passing in the React cell renderer.
6. Unit tests for `useAnchoredPortal` with various viewport-overflow scenarios.

### Phase 2 — SelectEditor

1. Implement `SelectEditor.tsx` and `createSelectEditor` factory.
2. Support single-select and multi-select modes.
3. Support `searchable` filter input.
4. Support option groups.
5. Full keyboard support via `useKeyboardList`.
6. Theme integration.
7. Demo: add a `Sector` column to the AdvancedFeatures demo with a `SelectEditor` (10 sector options).

### Phase 3 — DateEditor

1. Implement `DateEditor.tsx` and `createDateEditor` factory.
2. Support `min`, `max`, `format` options.
3. Popover anchored below cell via `useAnchoredPortal`.
4. Click-outside commits.
5. Demo: add a `Date` column with `DateEditor`.

### Phase 4 — AutocompleteEditor

1. Implement `AutocompleteEditor.tsx` and `createAutocompleteEditor` factory.
2. Debounced `fetchOptions` with `AbortSignal` cancellation.
3. Loading spinner during async fetch (theme-colored).
4. Multi-select mode with tag display.
5. Empty state and error state.
6. Demo: add a `Ticker` column using `AutocompleteEditor` with a mock `fetchOptions` that filters a local list (simulating server search latency with `setTimeout`).

### Phase 5 — Architecture guard and exports

1. Add guard: `editor files must not import renderer files`.
2. Verify all types are re-exported from `@eregister/wit-grid-react` index.
3. Add Storybook-style demo panel in AdvancedFeatures page showing all three editors side by side.

## Out of scope

- Color picker editor
- Rich text / markdown editor
- File upload editor
- Editor animations (mount/unmount transitions)
- Server-side validation feedback within the editor (validation runs in `EditingFeatureController` post-commit)
