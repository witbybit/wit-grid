/** Notes and descriptions: a clamped preview in the cell, a roomy textarea popover to edit. */
import type { DomCellEditor, DomCellRenderer } from '../columnDef.js';
import { editSession, editorShell } from './editors.js';
import { openCellPopover } from './popover.js';
import { valueRenderer } from './renderers.js';

export interface LongTextCellOptions {
	/** Lines the cell shows before an ellipsis (1–3). Default 1; more lines need a taller row. */
	lines?: 1 | 2 | 3;
	/** Characters allowed; the editor counts down to it. */
	maxLength?: number;
	placeholder?: string;
	/** Textarea height range, in lines. Default 4–14. */
	minRows?: number;
	maxRows?: number;
}

function text(value: unknown): string {
	return value == null ? '' : String(value);
}

export function createLongTextRenderer(options: LongTextCellOptions = {}): DomCellRenderer<any> {
	const lines = options.lines ?? 1;
	return valueRenderer((root) => {
		const span = document.createElement('span');
		span.className = 'og-ct-longtext';
		span.style.setProperty('--og-ct-lines', String(lines));
		if (lines > 1) span.setAttribute('data-multiline', '');
		root.appendChild(span);
		return (value) => {
			const full = text(value);
			// One line shows paragraphs run together; the tooltip keeps their breaks.
			span.textContent = lines === 1 ? full.replace(/\s*\n\s*/g, ' · ') : full;
			if (full.length > 40 || full.includes('\n')) span.title = full;
			else span.removeAttribute('title');
		};
	});
}

/**
 * Edits in a textarea popover anchored to the cell: Enter adds a line, Ctrl / ⌘ + Enter (or a click
 * away) saves, Escape abandons. Grows with its content between `minRows` and `maxRows`.
 */
export function createLongTextEditor(options: LongTextCellOptions = {}): DomCellEditor<any> {
	const minRows = options.minRows ?? 4;
	const maxRows = options.maxRows ?? 14;
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			const preview = document.createElement('span');
			preview.className = 'og-ct-longtext og-ct-placeholder';
			preview.textContent = text(params.value).replace(/\s*\n\s*/g, ' · ');
			root.appendChild(preview);

			const panel = document.createElement('div');
			panel.className = 'og-ct-longtext-panel';
			const area = document.createElement('textarea');
			area.className = 'og-ct-textarea';
			area.value = text(params.value);
			area.rows = minRows;
			area.spellcheck = true;
			if (options.placeholder) area.placeholder = options.placeholder;
			if (options.maxLength) area.maxLength = options.maxLength;
			const foot = document.createElement('div');
			foot.className = 'og-ct-longtext-foot';
			const hint = document.createElement('span');
			hint.className = 'og-ct-kbd-hint';
			const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
			hint.innerHTML = `<kbd>${mod}</kbd><kbd>Enter</kbd> to save · <kbd>Esc</kbd> to cancel`;
			const count = document.createElement('span');
			count.className = 'og-ct-count';
			const save = document.createElement('button');
			save.type = 'button';
			save.className = 'og-ct-btn';
			save.setAttribute('data-primary', '');
			save.textContent = 'Save';
			save.addEventListener('mousedown', (event) => event.preventDefault());
			save.addEventListener('click', () => end.commit(area.value));
			foot.append(hint, count, save);
			panel.append(area, foot);

			const lineHeight = 20;
			const fit = () => {
				area.style.height = 'auto';
				const rows = Math.min(maxRows, Math.max(minRows, Math.ceil(area.scrollHeight / lineHeight)));
				area.style.height = `${rows * lineHeight + 16}px`;
				area.style.overflowY = area.scrollHeight > rows * lineHeight + 16 ? 'auto' : 'hidden';
				const length = area.value.length;
				count.textContent = options.maxLength ? `${length} / ${options.maxLength}` : `${length} chars`;
				count.toggleAttribute('data-near', !!options.maxLength && length >= options.maxLength * 0.9);
			};
			area.addEventListener('input', () => {
				fit();
				params.onChange(area.value);
			});
			area.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					end.commit(area.value);
				} else if (event.key === 'Tab') {
					event.preventDefault();
					end.commit(area.value);
				}
				// Plain Enter adds a line; the popover keeps every key from the grid.
			});

			const popover = openCellPopover({
				anchor: root,
				content: panel,
				className: 'og-ct-popover-wide',
				matchAnchorWidth: true,
				label: params.col.header,
				onDismiss: (reason) => (reason === 'escape' ? end.cancel() : end.commit(area.value, true)),
			});
			fit();
			end.hold(() => {
				area.focus({ preventScroll: true });
				area.setSelectionRange(area.value.length, area.value.length);
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
