import { compilePathGetter, type ColumnDef } from '../columnDef.js';
import { createGridRowDataRef } from '../publicRowRef.js';
import type { RowNode } from '../rowNode.js';
import type { GroupDef } from './hierarchyConfig.js';
import type { RowPipelineContext } from './stages/types.js';

export function getCellValueForPipeline<TData>(node: RowNode<TData>, column: ColumnDef<TData> | undefined, colId: string): unknown {
	if (!column) {
		const getter = compilePathGetter(colId);
		return node.getCellValue(colId, getter);
	}
	if (column.valueGetter) {
		return column.valueGetter({ node: createGridRowDataRef(node.id, node.data), row: node.data, colField: column.field });
	}
	const getter = compilePathGetter(column.field);
	return node.getCellValue(column.field, getter);
}

export function createRowPipelineContext<TData>(
	columns: ColumnDef<TData>[],
	reportFault?: RowPipelineContext<TData>['reportFault']
): RowPipelineContext<TData> {
	const columnsById = new Map<string, ColumnDef<TData>>();
	for (const column of columns) {
		columnsById.set(column.field, column);
	}
	// One reader per column id, resolved once per run: a plain field is a direct property read (the
	// per-node value cache costs more than it saves for those); getters keep the cached path.
	const readers = new Map<string, (node: RowNode<TData>) => unknown>();
	const readerFor = (colId: string): ((node: RowNode<TData>) => unknown) => {
		let reader = readers.get(colId);
		if (!reader) {
			const column = columnsById.get(colId);
			if (column?.valueGetter) reader = (node) => getCellValueForPipeline(node, column, colId);
			else {
				const getter = compilePathGetter(column?.field ?? colId) as (data: TData) => unknown;
				reader = (node) => getter(node.data);
			}
			readers.set(colId, reader);
		}
		return reader;
	};

	return {
		columnsById,
		reportFault,
		getValue: (node, colId) => readerFor(colId)(node),
		readerFor,
		getGroupKey: (node, groupDef: GroupDef<TData>) => {
			const value = readerFor(groupDef.colId)(node);
			const keyString = groupDef.keyCreator ? groupDef.keyCreator({ value, row: node.data, rowId: node.id }) : String(value ?? 'None');
			return { key: value, keyString };
		},
	};
}
