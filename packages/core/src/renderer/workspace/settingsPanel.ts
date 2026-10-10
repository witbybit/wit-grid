import { icon } from './icons.js';
import { button, h, hue } from './ui.js';
import type { SettingOption, ViewSetting, ViewSettingsSection } from './viewTypes.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dot(option: SettingOption): HTMLElement | null {
	if (!option.color) return null;
	const el = h('span', 'og-ws-dot');
	el.style.background = hue(option.color, option.value);
	return el;
}

/**
 * The Customize panel: a view's settings drawn from their descriptions. Every change applies at once
 * (the view re-projects in place) and the panel redraws from the view's fresh settings, so dependent
 * options (a WIP limit per column after the columns field changed) stay true.
 */
export function renderSettings(container: HTMLElement, read: () => ViewSettingsSection[], title: string): void {
	const draw = () => {
		const scroll = container.scrollTop;
		const focusedId = (document.activeElement as HTMLElement | null)?.dataset.settingFocus;
		container.replaceChildren(h('div', 'og-ws-panel-head', null, h('strong', null, null, title)));
		for (const section of read()) {
			const block = h('section', 'og-ws-settings-section', null, h('div', 'og-ws-section-label', null, section.title));
			for (const setting of section.settings) block.append(control(setting, draw));
			container.append(block);
		}
		container.scrollTop = scroll;
		if (focusedId) container.querySelector<HTMLElement>(`[data-setting-focus="${CSS.escape(focusedId)}"]`)?.focus();
	};
	draw();
}

function row(label: string, hint: string | undefined, ...content: (Node | null)[]): HTMLElement {
	const el = h('div', 'og-ws-setting', null, h('span', 'og-ws-setting-label', null, label), ...content);
	if (hint) el.append(h('span', 'og-ws-setting-hint', null, hint));
	return el;
}

function control(setting: ViewSetting, redraw: () => void): HTMLElement {
	const after = (fn: () => void) => () => {
		fn();
		redraw();
	};
	switch (setting.kind) {
		case 'select': {
			const select = h('select', 'og-ws-input og-ws-setting-select', { 'aria-label': setting.label, 'data-setting-focus': setting.id });
			for (const option of setting.options) {
				const el = h('option', null, { value: option.value }, option.label);
				el.selected = option.value === setting.value;
				select.append(el);
			}
			select.addEventListener(
				'change',
				after(() => setting.onChange(select.value))
			);
			return row(setting.label, setting.hint, select);
		}
		case 'segmented': {
			const group = h('div', 'og-ws-segmented', { role: 'radiogroup', 'aria-label': setting.label });
			for (const option of setting.options) {
				const el = h(
					'button',
					'og-ws-segment',
					{
						type: 'button',
						role: 'radio',
						'aria-checked': String(option.value === setting.value),
						'data-setting-focus': `${setting.id}:${option.value}`,
					},
					option.label
				);
				el.addEventListener(
					'click',
					after(() => setting.onChange(option.value))
				);
				group.append(el);
			}
			return row(setting.label, undefined, group);
		}
		case 'toggle': {
			const el = h(
				'button',
				'og-ws-switch',
				{
					type: 'button',
					role: 'switch',
					'aria-checked': String(setting.value),
					'aria-label': setting.label,
					'data-setting-focus': setting.id,
				},
				h('span')
			);
			el.addEventListener(
				'click',
				after(() => setting.onChange(!setting.value))
			);
			const line = h('label', 'og-ws-setting og-ws-setting-inline', null, h('span', 'og-ws-setting-label', null, setting.label), el);
			if (setting.hint) line.append(h('span', 'og-ws-setting-hint', null, setting.hint));
			return line;
		}
		case 'weekdays': {
			const group = h('div', 'og-ws-weekdays', { role: 'group', 'aria-label': setting.label });
			WEEKDAYS.forEach((letter, day) => {
				const on = setting.value.includes(day);
				const el = h(
					'button',
					'og-ws-weekday',
					{ type: 'button', 'aria-pressed': String(on), title: WEEKDAY_NAMES[day], 'data-setting-focus': `${setting.id}:${day}` },
					letter
				);
				el.addEventListener(
					'click',
					after(() => setting.onChange(on ? setting.value.filter((d) => d !== day) : [...setting.value, day].sort()))
				);
				group.append(el);
			});
			return row(setting.label, undefined, group);
		}
		case 'fields': {
			// Chosen fields first, in order (up / down to reorder), then the rest to add.
			const list = h('div', 'og-ws-field-list', { role: 'list', 'aria-label': setting.label });
			const chosen = setting.value.filter((value) => setting.options.some((option) => option.value === value));
			const labelOf = (value: string) => setting.options.find((option) => option.value === value)?.label ?? value;
			chosen.forEach((value, i) => {
				const up = button(
					{ icon: 'chevronDown', title: `Move ${labelOf(value)} up`, className: 'og-ws-flip' },
					after(() => {
						const next = [...chosen];
						[next[i - 1], next[i]] = [next[i], next[i - 1]];
						setting.onChange(next);
					})
				);
				up.disabled = i === 0;
				const down = button(
					{ icon: 'chevronDown', title: `Move ${labelOf(value)} down` },
					after(() => {
						const next = [...chosen];
						[next[i + 1], next[i]] = [next[i], next[i + 1]];
						setting.onChange(next);
					})
				);
				down.disabled = i === chosen.length - 1;
				const remove = button(
					{ icon: 'close', title: `Remove ${labelOf(value)}` },
					after(() => setting.onChange(chosen.filter((other) => other !== value)))
				);
				list.append(
					h(
						'div',
						'og-ws-field-item',
						{ role: 'listitem' },
						icon('drag', 14),
						h('span', 'og-ws-list-label', null, labelOf(value)),
						up,
						down,
						remove
					)
				);
			});
			const rest = setting.options.filter((option) => !chosen.includes(option.value));
			if (rest.length) {
				const add = h('select', 'og-ws-input og-ws-setting-select', {
					'aria-label': `Add to ${setting.label}`,
					'data-setting-focus': `${setting.id}:add`,
				});
				add.append(h('option', null, { value: '' }, '+ Add a field…'));
				for (const option of rest) add.append(h('option', null, { value: option.value }, option.label));
				add.addEventListener(
					'change',
					after(() => add.value && setting.onChange([...chosen, add.value]))
				);
				list.append(add);
			}
			return row(setting.label, setting.hint, list);
		}
		case 'limits': {
			const list = h('div', 'og-ws-limit-list');
			for (const option of setting.rows) {
				const input = h('input', 'og-ws-input og-ws-limit-input', {
					type: 'number',
					min: 0,
					step: 1,
					placeholder: '∞',
					'aria-label': `${option.label} limit`,
					'data-setting-focus': `${setting.id}:${option.value}`,
				});
				input.value = option.limit == null ? '' : String(option.limit);
				input.addEventListener(
					'change',
					after(() => setting.onChange(option.value, input.value === '' ? null : Math.max(0, Math.round(Number(input.value)))))
				);
				const line = h(
					'div',
					`og-ws-limit${option.hidden ? ' og-ws-limit-hidden' : ''}`,
					null,
					dot(option),
					h('span', 'og-ws-list-label', null, option.label),
					input
				);
				if (setting.onToggle) {
					const toggle = button(
						{ icon: option.hidden ? 'expand' : 'check', title: option.hidden ? `Show ${option.label}` : `Hide ${option.label}` },
						after(() => setting.onToggle!(option.value, !!option.hidden))
					);
					toggle.setAttribute('aria-pressed', String(!option.hidden));
					line.prepend(toggle);
				}
				list.append(line);
			}
			return row(setting.label, setting.hint, list);
		}
	}
}
