import type { ColumnDef } from '@eregister/wit-grid-core';
import { BUILTIN_COLUMN_TYPES, type ColumnTypeDefinition } from './renderers/CellTypes.js';

export function resolveColumnTypes<TRowData>(
	columns: ColumnDef<TRowData>[],
	userTypes?: Record<string, ColumnTypeDefinition<TRowData>>
): ColumnDef<TRowData>[] {
	const registry: Record<string, ColumnTypeDefinition<TRowData>> = userTypes ? { ...BUILTIN_COLUMN_TYPES, ...userTypes } : BUILTIN_COLUMN_TYPES;

	return columns.map((col) => {
		if (!col.type) return col;
		const typeDef = registry[col.type];
		if (!typeDef) return col;

		// Column-level explicit values win; type provides defaults.
		return {
			renderer: typeDef.renderer,
			cellEditor: typeDef.cellEditor,
			...col,
		};
	});
}
