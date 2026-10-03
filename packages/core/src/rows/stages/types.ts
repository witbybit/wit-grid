import type { RowNode } from '../../store.js';
import { type ColumnDef } from '../../store.js';
import type { GroupDef } from '../hierarchyConfig.js';
import type { GroupPathItem } from '../visualRowIds.js';
import type { VisualRow } from '../../visualRow.js';

export type RowTreeNode<TData = unknown> =
	| {
			kind: 'data';
			rowId: string;
			node: RowNode<TData>;
			depth: number;
			children?: RowTreeNode<TData>[];
			/** Tree parents, when aggregation is configured: the aggregate of their descendants. */
			aggregates?: Record<string, unknown>;
			/** The leaf's visual row from the last flatten (stale once its group collapses); the incremental index locates rows through it. */
			row?: VisualRow<TData>;
	  }
	| {
			kind: 'group';
			id: string;
			field: string;
			key: unknown;
			keyString: string;
			depth: number;
			path: GroupPathItem[];
			children: RowTreeNode<TData>[];
			/** Direct children. */
			childCount: number;
			/** Data rows beneath. */
			leafCount: number;
			aggregates: Record<string, unknown>;
	  };

export interface RowPipelineContext<TData = unknown> {
	columnsById: Map<string, ColumnDef<TData>>;
	getValue: (node: RowNode<TData>, colId: string) => unknown;
	getGroupKey: (node: RowNode<TData>, groupDef: GroupDef<TData>) => { key: unknown; keyString: string };
	reportFault?: (operation: string, error: unknown, context?: Record<string, unknown>) => void;
}
