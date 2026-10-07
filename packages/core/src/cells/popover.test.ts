// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCellPopover } from './popover.js';

afterEach(() => {
	document.body.textContent = '';
});

function press(target: Element) {
	target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

describe('cell popovers', () => {
	it('a popover opened from inside another is its child: presses in it keep the parent open', () => {
		const anchor = document.body.appendChild(document.createElement('button'));
		const onDismiss = vi.fn();
		const parentContent = document.createElement('div');
		const opener = parentContent.appendChild(document.createElement('button'));
		const parent = openCellPopover({ anchor, content: parentContent, onDismiss });
		const childContent = document.createElement('div');
		const option = childContent.appendChild(document.createElement('div'));
		const child = openCellPopover({ anchor: opener, content: childContent });
		// A grandchild (a calendar from an operator list) counts too.
		const grandContent = document.createElement('div');
		const day = grandContent.appendChild(document.createElement('button'));
		openCellPopover({ anchor: option, content: grandContent });

		press(day);
		press(option);
		expect(onDismiss).not.toHaveBeenCalled();
		expect(parent.element.isConnected).toBe(true);

		press(document.body.appendChild(document.createElement('div')));
		expect(onDismiss).toHaveBeenCalledWith('outside');
		// Closing the parent closes its children.
		expect(child.element.isConnected).toBe(false);
		expect(document.querySelectorAll('.og-ct-popover')).toHaveLength(0);
	});
});
