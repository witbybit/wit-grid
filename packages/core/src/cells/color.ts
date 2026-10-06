/** The colour cell: a swatch and hex code, edited with a palette, a hex field and the system picker. */
import type { DomCellEditor, DomCellRenderer } from '../columnDef.js';
import { editSession, editorShell } from './editors.js';
import { cellIconSvg } from './icons.js';
import { CELL_HUES } from './palette.js';
import { openCellPopover } from './popover.js';
import { valueRenderer } from './renderers.js';

/** `#rgb`, `#rrggbb` (with or without #) as lowercase `#rrggbb`; null for anything else. */
export function normalizeHexColor(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(text)) return `#${[...text].map((c) => c + c).join('')}`.toLowerCase();
	if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`.toLowerCase();
	return null;
}

function mix(hex: string, toward: number, amount: number): string {
	const n = parseInt(hex.slice(1), 16);
	const channel = (shift: number) => {
		const c = (n >> shift) & 255;
		return Math.round(c + (toward - c) * amount)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${channel(16)}${channel(8)}${channel(0)}`;
}

const NEUTRALS = ['#ffffff', '#f4f4f5', '#e4e4e7', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a', '#09090b'];

/** The default palette: neutrals, then each hue light, base and dark, nine to a row. */
export const DEFAULT_COLOR_SWATCHES: readonly string[] = (() => {
	const hues = Object.values(CELL_HUES).filter((hex) => hex !== CELL_HUES.gray);
	const rows = [NEUTRALS];
	for (const tone of [(h: string) => mix(h, 255, 0.55), (h: string) => h, (h: string) => mix(h, 0, 0.35)]) {
		const toned = hues.map(tone);
		for (let i = 0; i < toned.length; i += 9) rows.push(toned.slice(i, i + 9));
	}
	return rows.flat();
})();

export interface ColorCellOptions {
	/** Palette offered in the editor. Default: neutrals plus every hue in three tones. */
	swatches?: readonly string[];
	/** Show the hex code beside the swatch. Default true. */
	showHex?: boolean;
	/** Offer the system colour picker and a hex field for colours outside the palette. Default true. */
	allowCustom?: boolean;
}

function swatch(color: string | null): HTMLSpanElement {
	const el = document.createElement('span');
	el.className = 'og-ct-swatch';
	if (color) el.style.background = color;
	else el.setAttribute('data-empty', '');
	return el;
}

export function createColorRenderer(options: ColorCellOptions = {}): DomCellRenderer<any> {
	const showHex = options.showHex ?? true;
	return valueRenderer((root) => {
		const chip = swatch(null);
		const text = document.createElement('span');
		text.className = 'og-ct-hex';
		root.append(chip, text);
		return (value) => {
			const hex = normalizeHexColor(value);
			chip.style.background = hex ?? '';
			chip.style.visibility = hex ? '' : 'hidden';
			text.textContent = showHex && hex ? hex.toUpperCase() : '';
		};
	});
}

export function createColorEditor(options: ColorCellOptions = {}): DomCellEditor<any> {
	const swatches = options.swatches ?? DEFAULT_COLOR_SWATCHES;
	const allowCustom = options.allowCustom ?? true;
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			let current = normalizeHexColor(params.value);
			const preview = swatch(current);
			const input = document.createElement('input');
			input.type = 'text';
			input.spellcheck = false;
			input.maxLength = 7;
			input.placeholder = '#000000';
			input.value = current?.toUpperCase() ?? '';
			input.readOnly = !allowCustom;
			root.append(preview, input);

			const set = (hex: string | null) => {
				current = hex;
				preview.style.background = hex ?? '';
				preview.toggleAttribute('data-empty', !hex);
				for (const button of grid.children)
					(button as HTMLElement).setAttribute('aria-selected', String((button as HTMLElement).dataset.color === hex));
				if (native) native.value = hex ?? '#000000';
			};
			const commit = (hex: string | null) => end.commit(hex);

			const panel = document.createElement('div');
			panel.className = 'og-ct-color-panel';
			const grid = document.createElement('div');
			grid.className = 'og-ct-swatches';
			grid.setAttribute('role', 'listbox');
			grid.tabIndex = 0;
			for (const color of swatches) {
				const hex = normalizeHexColor(color) ?? color;
				const button = document.createElement('button');
				button.type = 'button';
				button.tabIndex = -1;
				button.className = 'og-ct-swatch-button';
				button.dataset.color = hex;
				button.style.background = hex;
				button.title = hex.toUpperCase();
				button.setAttribute('role', 'option');
				button.addEventListener('mousedown', (event) => event.preventDefault());
				button.addEventListener('click', () => commit(hex));
				grid.appendChild(button);
			}
			panel.appendChild(grid);

			let native: HTMLInputElement | null = null;
			if (allowCustom) {
				const row = document.createElement('div');
				row.className = 'og-ct-color-custom';
				native = document.createElement('input');
				native.type = 'color';
				native.className = 'og-ct-color-native';
				native.title = 'Custom colour';
				native.value = current ?? '#000000';
				native.addEventListener('input', () => {
					set(native!.value);
					input.value = native!.value.toUpperCase();
					params.onChange(native!.value);
				});
				native.addEventListener('change', () => commit(native!.value));
				const label = document.createElement('span');
				label.textContent = 'Custom colour';
				row.append(native, label);
				// The browser's screen colour picker, where there is one.
				const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
				if (EyeDropperCtor) {
					const dropper = document.createElement('button');
					dropper.type = 'button';
					dropper.className = 'og-ct-btn';
					dropper.setAttribute('data-ghost', '');
					dropper.title = 'Pick from screen';
					dropper.innerHTML = cellIconSvg('pipette', 14);
					dropper.addEventListener('click', () => {
						new EyeDropperCtor().open().then(
							(result) => commit(normalizeHexColor(result.sRGBHex)),
							() => undefined
						);
					});
					row.appendChild(dropper);
				}
				const clear = document.createElement('button');
				clear.type = 'button';
				clear.className = 'og-ct-btn';
				clear.setAttribute('data-ghost', '');
				clear.textContent = 'Clear';
				clear.addEventListener('mousedown', (event) => event.preventDefault());
				clear.addEventListener('click', () => commit(null));
				row.appendChild(clear);
				panel.appendChild(row);
			}

			// Arrow keys move through the palette, nine to a row; Enter picks.
			let active = Math.max(
				0,
				swatches.findIndex((color) => normalizeHexColor(color) === current)
			);
			const focusSwatch = (index: number) => {
				active = Math.max(0, Math.min(swatches.length - 1, index));
				for (const [i, button] of [...grid.children].entries()) button.toggleAttribute('data-active', i === active);
			};
			grid.addEventListener('keydown', (event) => {
				const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 };
				if (event.key in moves) {
					event.preventDefault();
					focusSwatch(active + moves[event.key]);
				} else if (event.key === 'Enter') {
					event.preventDefault();
					commit((grid.children[active] as HTMLElement).dataset.color ?? null);
				}
			});
			grid.addEventListener('focus', () => focusSwatch(active));

			input.addEventListener('input', () => {
				const hex = normalizeHexColor(input.value);
				input.toggleAttribute('data-invalid', !!input.value && !hex);
				if (hex) {
					set(hex);
					params.onChange(hex);
				}
			});
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === 'Tab') {
					event.preventDefault();
					event.stopPropagation();
					if (!input.value.trim()) commit(null);
					else {
						const hex = normalizeHexColor(input.value);
						if (hex) commit(hex);
					}
				} else if (event.key === 'ArrowDown') {
					event.preventDefault();
					event.stopPropagation();
					grid.focus();
				}
			});

			const popover = openCellPopover({
				anchor: root,
				content: panel,
				label: 'Choose a colour',
				onDismiss: (reason) => (reason === 'escape' ? end.cancel() : end.commit(current, true)),
			});
			set(current);
			end.hold(() => {
				input.focus({ preventScroll: true });
				input.select();
			});
			return {
				destroy() {
					end.release();
					popover.close();
				},
			};
		},
	};
}
