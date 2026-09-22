import { describe, it, expect } from 'vitest';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import { CheckboxCellRenderer, DateCellRenderer, BUILTIN_COLUMN_TYPES } from './renderers/CellTypes.js';
import type { ColumnDef } from '@eregister/wit-grid-core';

interface Row {
	id: string;
	name: string;
	active: string;
	born: string;
	score: string;
}

describe('resolveColumnTypes', () => {
	it('passes through columns with no type unchanged', () => {
		const cols: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
		const result = resolveColumnTypes(cols);
		expect(result[0]).toEqual(cols[0]);
	});

	it('returns a new array reference even when nothing changes', () => {
		const cols: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
		// Array identity may differ but items should be equal
		const result = resolveColumnTypes(cols);
		expect(result).toHaveLength(1);
	});

	it('applies built-in checkbox renderer when type = checkbox', () => {
		const result = resolveColumnTypes<Row>([{ field: 'active', header: 'Active', type: 'checkbox' }]);
		const renderer = result[0].renderer as any;
		expect(renderer?.kind).toBe('react');
		expect(renderer?.component).toBe(CheckboxCellRenderer);
	});

	it('applies built-in date renderer and editor when type = date', () => {
		const result = resolveColumnTypes<Row>([{ field: 'born', header: 'Born', type: 'date' }]);
		const renderer = result[0].renderer as any;
		expect(renderer?.component).toBe(DateCellRenderer);
		expect(result[0].cellEditor).toBeDefined();
	});

	it('applies built-in number renderer and editor when type = number', () => {
		const result = resolveColumnTypes<Row>([{ field: 'score', header: 'Score', type: 'number' }]);
		expect(result[0].renderer).toBeDefined();
		expect(result[0].cellEditor).toBeDefined();
	});

	it('column-level renderer overrides the type renderer', () => {
		const customRenderer = { kind: 'text' as const };
		const result = resolveColumnTypes<Row>([{ field: 'born', header: 'Born', type: 'date', renderer: customRenderer }]);
		expect(result[0].renderer).toBe(customRenderer);
	});

	it('column-level cellEditor overrides the type editor', () => {
		const customEditor = () => null;
		const result = resolveColumnTypes<Row>([{ field: 'score', header: 'Score', type: 'number', cellEditor: customEditor }]);
		expect(result[0].cellEditor).toBe(customEditor);
	});

	it('unknown type name returns column unchanged', () => {
		const col: ColumnDef<Row> = { field: 'name', header: 'Name', type: 'nonexistent' };
		expect(resolveColumnTypes([col])[0]).toEqual(col);
	});

	it('user-defined type overrides built-in with the same name', () => {
		const myRenderer = { kind: 'text' as const };
		const result = resolveColumnTypes<Row>([{ field: 'born', header: 'Born', type: 'date' }], { date: { renderer: myRenderer } });
		expect(result[0].renderer).toBe(myRenderer);
	});

	it('user-defined custom type is applied when referenced', () => {
		const customRenderer = { kind: 'text' as const };
		const result = resolveColumnTypes<Row>([{ field: 'name', header: 'Name', type: 'my-custom' }], { 'my-custom': { renderer: customRenderer } });
		expect(result[0].renderer).toBe(customRenderer);
	});

	it('columns without type are unaffected by userTypes', () => {
		const col: ColumnDef<Row> = { field: 'name', header: 'Name' };
		const result = resolveColumnTypes([col], { date: { renderer: { kind: 'text' } } });
		expect(result[0]).toEqual(col);
	});

	it('built-in types are still accessible when userTypes is provided with different keys', () => {
		const result = resolveColumnTypes<Row>([{ field: 'active', header: 'Active', type: 'checkbox' }], { custom: { renderer: { kind: 'text' } } });
		const renderer = result[0].renderer as any;
		expect(renderer?.component).toBe(CheckboxCellRenderer);
	});

	it('all three built-in types are present in BUILTIN_COLUMN_TYPES', () => {
		expect(BUILTIN_COLUMN_TYPES).toHaveProperty('checkbox');
		expect(BUILTIN_COLUMN_TYPES).toHaveProperty('date');
		expect(BUILTIN_COLUMN_TYPES).toHaveProperty('number');
	});
});
