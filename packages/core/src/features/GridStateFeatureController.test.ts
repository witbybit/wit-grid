import { describe, expect, it, vi } from 'vitest';
import { GridStateFeatureController } from './GridStateFeatureController.js';

describe('GridStateFeatureController.setSortModel', () => {
	it('repaints the headers even when a row model handles the rows (infinite and server models reload asynchronously)', () => {
		const applyChange = vi.fn(() => ({ applied: true }) as never);
		const controller = new GridStateFeatureController({
			stateManager: { getState: () => ({ sortModel: null }) } as never,
			applyChange,
			getRowModel: () => ({ kind: 'infinite' }) as never,
		});
		controller.setSortModel([{ colId: 'id', sort: 'asc' }]);
		const change = applyChange.mock.calls[0][0] as { invalidations: Array<{ kind: string }> };
		expect(change.invalidations.map((i) => i.kind)).toContain('headers');
	});
});
