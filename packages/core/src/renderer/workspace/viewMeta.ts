import type { GridViewConfig } from '../../views.js';
import type { WorkspaceIconName } from './icons.js';

/** The label and icon of each kind of view (the table included). */
export const VIEW_META: Record<GridViewConfig['kind'] | 'table', { label: string; icon: WorkspaceIconName }> = {
	table: { label: 'Table', icon: 'table' },
	gallery: { label: 'Gallery', icon: 'gallery' },
	calendar: { label: 'Calendar', icon: 'calendar' },
	kanban: { label: 'Kanban', icon: 'kanban' },
	gantt: { label: 'Gantt', icon: 'gantt' },
};
