import type { InvalidationFrame } from './invalidationManager.js';
import { CellSlot } from './cellSlot.js';

export class CellRenderer {
	private readonly syncCells: (frame: InvalidationFrame) => void;

	constructor(syncCells: (frame: InvalidationFrame) => void) {
		this.syncCells = syncCells;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncCells(frame);
	}

	public initializeCell(cell: HTMLElement): void {
		CellSlot.fromElement(cell as HTMLDivElement);
	}

	public getOrCreatePortalHost(cell: HTMLElement): HTMLElement {
		return CellSlot.fromElement(cell as HTMLDivElement).getOrCreatePortalHost();
	}

	public getPortalHost(cell: HTMLElement): HTMLElement | null {
		return CellSlot.fromElement(cell as HTMLDivElement).portalHostElement;
	}

	public showPortalContent(cell: HTMLElement): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = 'portal';
		slot.lastContentMode = 'portal';
	}

	public ensureLoadingSkeleton(cell: HTMLElement): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = 'loading';
		slot.lastContentMode = 'loading';
		slot.clearText();
	}
}
