import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
	GridApi,
	ColumnDef,
	FilterModel,
	ColumnFilter,
	FilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
} from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';
import type { ThemeTokens, CustomFilterRendererParams, GridDistinctValueSummary } from '@eregister/wit-grid-core';
import { resolveColumnFilterDef } from '@eregister/wit-grid-core';
import { ColumnFilterRenderer } from '../../filters/ColumnFilterRenderer.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const ClearIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<path d='M1.5 1.5l8 8M9.5 1.5l-8 8' />
	</svg>
);

// ── Operator option lists ─────────────────────────────────────────────────────

const TEXT_OPS: { value: TextFilterOperator; label: string }[] = [
	{ value: 'contains', label: '≈ Contains' },
	{ value: 'notContains', label: '¬ Not Contains' },
	{ value: 'equals', label: '= Equals' },
	{ value: 'notEquals', label: '≠ Not Equals' },
	{ value: 'startsWith', label: '↦ Starts With' },
	{ value: 'endsWith', label: '↤ Ends With' },
	{ value: 'blank', label: '∅ Blank' },
	{ value: 'notBlank', label: '◉ Not Blank' },
];

const NUMBER_OPS: { value: NumberFilterOperator; label: string }[] = [
	{ value: 'equals', label: '= Equals' },
	{ value: 'notEquals', label: '≠ Not Equals' },
	{ value: 'gt', label: '> Greater Than' },
	{ value: 'gte', label: '≥ Greater or Equal' },
	{ value: 'lt', label: '< Less Than' },
	{ value: 'lte', label: '≤ Less or Equal' },
	{ value: 'inRange', label: '↔ In Range' },
	{ value: 'blank', label: '∅ Blank' },
	{ value: 'notBlank', label: '◉ Not Blank' },
];

const DATE_OPS: { value: DateFilterOperator; label: string }[] = [
	{ value: 'equals', label: '= On Date' },
	{ value: 'before', label: '< Before' },
	{ value: 'after', label: '> After' },
	{ value: 'inRange', label: '↔ In Range' },
	{ value: 'blank', label: '∅ Blank' },
	{ value: 'notBlank', label: '◉ Not Blank' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

type FilterType = 'text' | 'number' | 'date' | 'set';

function effectiveFilterType(col: ColumnDef<any>): FilterType {
	return (col.filterType as FilterType | undefined) ?? 'text';
}

function getCondition1(f: ColumnFilter | undefined): FilterCondition | null {
	if (!f) return null;
	if (f.type === 'compound') return f.conditions[0];
	return f as FilterCondition;
}

function getCondition2(f: ColumnFilter | undefined): FilterCondition | null {
	if (!f || f.type !== 'compound') return null;
	return f.conditions[1];
}

function getCompoundOp(f: ColumnFilter | undefined): 'AND' | 'OR' {
	return f?.type === 'compound' ? f.operator : 'AND';
}

function defaultCondition(ft: FilterType): FilterCondition {
	if (ft === 'number') return { type: 'number', operator: 'equals', value: 0 };
	if (ft === 'date') return { type: 'date', operator: 'equals', dateFrom: '' };
	if (ft === 'set') return { type: 'set', values: [] };
	return { type: 'text', operator: 'contains', value: '' };
}

function conditionIsEmpty(c: FilterCondition | null): boolean {
	if (!c) return true;
	if (c.type === 'text') return c.operator === 'blank' || c.operator === 'notBlank' ? false : !c.value.trim();
	if (c.type === 'number') return c.operator === 'blank' || c.operator === 'notBlank' ? false : false; // always set
	if (c.type === 'date') return c.operator === 'blank' || c.operator === 'notBlank' ? false : !c.dateFrom.trim();
	if (c.type === 'set') return c.values.length === 0;
	return true;
}

function buildColumnFilter(c1: FilterCondition | null, c2: FilterCondition | null, op: 'AND' | 'OR'): ColumnFilter | null {
	const e1 = conditionIsEmpty(c1);
	const e2 = conditionIsEmpty(c2);
	if (e1 && e2) return null;
	if (!c1 || e1) return c2;
	if (!c2 || e2) return c1;
	return { type: 'compound', operator: op, conditions: [c1, c2] };
}

function isBlankOp(op: string): boolean {
	return op === 'blank' || op === 'notBlank';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OpSelect<T extends string>({
	value,
	options,
	onChange,
	theme,
	hasValue,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
	theme: ThemeTokens;
	hasValue: boolean;
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value as T)}
			style={{
				width: 120,
				flexShrink: 0,
				height: 28,
				fontSize: 10,
				fontWeight: 600,
				background: theme.headerBg,
				border: `1px solid ${hasValue ? theme.selectionBorder : theme.borderColor}`,
				borderRadius: 5,
				color: hasValue ? theme.textColor : theme.headerText,
				padding: '0 4px',
				outline: 'none',
				cursor: 'pointer',
			}}
		>
			{options.map((o) => (
				<option key={o.value} value={o.value} style={{ background: theme.headerBg, color: theme.textColor }}>
					{o.label}
				</option>
			))}
		</select>
	);
}

function TextInput({
	value,
	placeholder,
	onChange,
	theme,
	hasValue,
	type = 'text',
	style,
}: {
	value: string;
	placeholder?: string;
	onChange: (v: string) => void;
	theme: ThemeTokens;
	hasValue: boolean;
	type?: string;
	style?: React.CSSProperties;
}) {
	const [focused, setFocused] = useState(false);
	return (
		<input
			type={type}
			value={value}
			placeholder={placeholder ?? 'Filter…'}
			onChange={(e) => onChange(e.target.value)}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			style={{
				width: '100%',
				height: 28,
				fontSize: 11,
				background: theme.headerBg,
				border: `1px solid ${focused ? theme.focusRing : hasValue ? theme.selectionBorder : theme.borderColor}`,
				borderRadius: 5,
				color: theme.textColor,
				padding: '0 8px',
				outline: 'none',
				boxSizing: 'border-box',
				transition: 'border-color 0.12s',
				...style,
			}}
		/>
	);
}

// ── TextFilterEditor ──────────────────────────────────────────────────────────

function TextFilterEditor({
	condition,
	onChange,
	theme,
}: {
	condition: TextFilterCondition | null;
	onChange: (c: TextFilterCondition | null) => void;
	theme: ThemeTokens;
}) {
	const op = condition?.operator ?? 'contains';
	const val = condition?.value ?? '';
	const hasValue = !conditionIsEmpty(condition);

	const update = (operator: TextFilterOperator, value: string) => {
		if (isBlankOp(operator)) {
			onChange({ type: 'text', operator, value: '' });
		} else if (!value.trim()) {
			onChange(null);
		} else {
			onChange({ type: 'text', operator, value });
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<OpSelect value={op} options={TEXT_OPS} onChange={(o) => update(o, val)} theme={theme} hasValue={hasValue} />
			{!isBlankOp(op) && <TextInput value={val} onChange={(v) => update(op, v)} theme={theme} hasValue={hasValue} />}
		</div>
	);
}

// ── NumberFilterEditor ────────────────────────────────────────────────────────

function NumberFilterEditor({
	condition,
	onChange,
	theme,
}: {
	condition: NumberFilterCondition | null;
	onChange: (c: NumberFilterCondition | null) => void;
	theme: ThemeTokens;
}) {
	const op = condition?.operator ?? 'equals';
	const val = condition != null ? String(condition.value) : '';
	const valTo = condition?.valueTo != null ? String(condition.valueTo) : '';
	const hasValue = !conditionIsEmpty(condition);

	const update = (operator: NumberFilterOperator, rawVal: string, rawValTo?: string) => {
		if (isBlankOp(operator)) {
			onChange({ type: 'number', operator, value: 0 });
		} else {
			const n = rawVal !== '' ? Number(rawVal) : NaN;
			if (isNaN(n)) {
				onChange(null);
				return;
			}
			const c: NumberFilterCondition = { type: 'number', operator, value: n };
			if (operator === 'inRange' && rawValTo !== undefined) {
				const nTo = Number(rawValTo);
				if (!isNaN(nTo)) c.valueTo = nTo;
			}
			onChange(c);
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<OpSelect value={op} options={NUMBER_OPS} onChange={(o) => update(o, val, valTo)} theme={theme} hasValue={hasValue} />
			{!isBlankOp(op) && (
				<>
					<TextInput
						value={val}
						type='number'
						placeholder='Value…'
						onChange={(v) => update(op, v, valTo)}
						theme={theme}
						hasValue={hasValue}
					/>
					{op === 'inRange' && (
						<TextInput
							value={valTo}
							type='number'
							placeholder='To…'
							onChange={(v) => update(op, val, v)}
							theme={theme}
							hasValue={hasValue}
						/>
					)}
				</>
			)}
		</div>
	);
}

// ── DateFilterEditor ──────────────────────────────────────────────────────────

function DateFilterEditor({
	condition,
	onChange,
	theme,
}: {
	condition: DateFilterCondition | null;
	onChange: (c: DateFilterCondition | null) => void;
	theme: ThemeTokens;
}) {
	const op = condition?.operator ?? 'equals';
	const dateFrom = condition?.dateFrom ?? '';
	const dateTo = condition?.dateTo ?? '';
	const hasValue = !conditionIsEmpty(condition);

	const update = (operator: DateFilterOperator, from: string, to?: string) => {
		if (isBlankOp(operator)) {
			onChange({ type: 'date', operator, dateFrom: '' });
		} else if (!from.trim()) {
			onChange(null);
		} else {
			const c: DateFilterCondition = { type: 'date', operator, dateFrom: from };
			if (operator === 'inRange' && to) c.dateTo = to;
			onChange(c);
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<OpSelect value={op} options={DATE_OPS} onChange={(o) => update(o, dateFrom, dateTo)} theme={theme} hasValue={hasValue} />
			{!isBlankOp(op) && (
				<>
					<TextInput
						value={dateFrom}
						type='date'
						placeholder=''
						onChange={(v) => update(op, v, dateTo)}
						theme={theme}
						hasValue={hasValue}
						style={{ colorScheme: 'dark' }}
					/>
					{op === 'inRange' && (
						<TextInput
							value={dateTo}
							type='date'
							placeholder=''
							onChange={(v) => update(op, dateFrom, v)}
							theme={theme}
							hasValue={hasValue}
							style={{ colorScheme: 'dark' }}
						/>
					)}
				</>
			)}
		</div>
	);
}

// ── SetFilterEditor ───────────────────────────────────────────────────────────

function SetFilterEditor({
	condition,
	distinctValues,
	onChange,
	theme,
}: {
	condition: SetFilterCondition | null;
	distinctValues: GridDistinctValueSummary;
	onChange: (c: SetFilterCondition | null) => void;
	theme: ThemeTokens;
}) {
	const [search, setSearch] = useState('');
	const allValues = useMemo(() => [...distinctValues.values], [distinctValues.values]);
	const selected = useMemo(() => new Set(condition?.values.map((v) => String(v ?? '\0null')) ?? []), [condition]);

	const filtered = useMemo(
		() =>
			allValues.filter(
				(v) =>
					search === '' ||
					String(v ?? '')
						.toLowerCase()
						.includes(search.toLowerCase())
			),
		[allValues, search]
	);

	const toggle = (v: string | number | null) => {
		const key = String(v ?? '\0null');
		const next = new Set(selected);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		const values = allValues.filter((av) => next.has(String(av ?? '\0null')));
		onChange(values.length === 0 ? null : { type: 'set', values });
	};

	const selectAll = () => onChange({ type: 'set', values: [...allValues] });
	const clearAll = () => onChange(null);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			{/* Search */}
			<TextInput value={search} placeholder='Search values…' onChange={setSearch} theme={theme} hasValue={search.length > 0} />

			{/* Select All / Clear */}
			<div style={{ display: 'flex', gap: 6 }}>
				<button onClick={selectAll} style={smallBtnStyle(theme)}>
					Select All
				</button>
				<button onClick={clearAll} style={smallBtnStyle(theme)}>
					Clear
				</button>
			</div>

			{/* Checkbox list */}
			<div style={{ maxHeight: 140, overflowY: 'auto', border: `1px solid ${theme.borderColor}`, borderRadius: 5 }}>
				{filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 10, color: theme.headerText }}>No values</div>}
				{filtered.map((v, i) => {
					const key = String(v ?? '\0null');
					const label = v === null ? '(blank)' : String(v);
					const checked = selected.has(key);
					return (
						<label
							key={i}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 7,
								padding: '4px 8px',
								cursor: 'pointer',
								fontSize: 11,
								color: checked ? theme.textColor : theme.headerText,
								background: checked ? theme.selectionBg : 'transparent',
								borderBottom: i < filtered.length - 1 ? `1px solid ${theme.borderColor}` : 'none',
							}}
						>
							<input
								type='checkbox'
								checked={checked}
								onChange={() => toggle(v)}
								style={{ cursor: 'pointer', accentColor: theme.focusRing }}
							/>
							{label}
						</label>
					);
				})}
			</div>
			{distinctValues.truncated && (
				<div style={{ fontSize: 10, color: theme.headerText, lineHeight: 1.4 }}>
					Showing the first {distinctValues.limit} distinct values. Narrow the dataset or raise `runtimeLimits.maxFilterDistinctValues` to
					inspect more.
				</div>
			)}
		</div>
	);
}

function smallBtnStyle(theme: ThemeTokens): React.CSSProperties {
	return {
		fontSize: 10,
		fontWeight: 600,
		color: theme.focusRing,
		background: theme.selectionBg,
		border: `1px solid ${theme.selectionBorder}`,
		borderRadius: 4,
		padding: '2px 7px',
		cursor: 'pointer',
	};
}

// ── ConditionEditor — dispatches to the right sub-editor ─────────────────────

function ConditionEditor({
	ft,
	condition,
	allSetValues,
	distinctValueSummary,
	onChange,
	theme,
}: {
	ft: FilterType;
	condition: FilterCondition | null;
	allSetValues: (string | number | null)[];
	distinctValueSummary: GridDistinctValueSummary;
	onChange: (c: FilterCondition | null) => void;
	theme: ThemeTokens;
}) {
	if (ft === 'number') {
		return <NumberFilterEditor condition={condition?.type === 'number' ? condition : null} onChange={onChange} theme={theme} />;
	}
	if (ft === 'date') {
		return <DateFilterEditor condition={condition?.type === 'date' ? condition : null} onChange={onChange} theme={theme} />;
	}
	if (ft === 'set') {
		return (
			<SetFilterEditor
				condition={condition?.type === 'set' ? condition : null}
				distinctValues={distinctValueSummary}
				onChange={onChange}
				theme={theme}
			/>
		);
	}
	return <TextFilterEditor condition={condition?.type === 'text' ? condition : null} onChange={onChange} theme={theme} />;
}

// ── Helpers for new filter type detection ─────────────────────────────────────

const NEW_FILTER_TYPES = new Set(['multi-select', 'single-select', 'async-multi-select', 'async-single-select', 'infinite-multi-select', 'custom']);

function isNewFilterType(type: string): boolean {
	return NEW_FILTER_TYPES.has(type);
}

// ── ColumnFilterRow ───────────────────────────────────────────────────────────

function ColumnFilterRow({
	col,
	columnFilter,
	api,
	filterModel,
	theme,
}: {
	col: ColumnDef<any>;
	columnFilter: ColumnFilter | undefined;
	api: GridApi<any>;
	filterModel: FilterModel | null;
	theme: ThemeTokens;
}) {
	// Resolve filterDef — may be null for filterType='none'
	const resolvedDef = useMemo(
		() => resolveColumnFilterDef(col.filterDef as any, col.filterType as string | undefined, col.filterValues as any),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[col.filterDef, col.filterType, col.filterValues]
	);

	const useNewRenderer = resolvedDef != null && isNewFilterType(resolvedDef.type);
	const hasValue = !!columnFilter;

	const commitFilter = useCallback(
		(f: ColumnFilter | null) => {
			const next: FilterModel = { ...(filterModel ?? {}) };
			if (!f) delete next[col.field];
			else next[col.field] = f;
			api.setFilterModel(Object.keys(next).length > 0 ? next : null);
		},
		[filterModel, col.field, api]
	);

	// ── New select/async/custom path ──────────────────────────────────────────
	if (useNewRenderer) {
		const rendererParams: CustomFilterRendererParams = {
			value: columnFilter ?? null,
			onChange: commitFilter,
			onCommit: commitFilter,
			colField: col.field,
			surface: 'sidebar',
		};
		return (
			<div style={{ padding: '4px 12px 6px' }}>
				<ColumnFilterRowHeader col={col} hasValue={hasValue} theme={theme} onClear={() => commitFilter(null)} />
				<ColumnFilterRenderer params={rendererParams} filterDef={resolvedDef} theme={theme} />
			</div>
		);
	}

	// ── Legacy text/number/date/set path ──────────────────────────────────────
	return <LegacyColumnFilterRow col={col} columnFilter={columnFilter} api={api} filterModel={filterModel} theme={theme} />;
}

// ── Extracted header shared by both paths ─────────────────────────────────────

function ColumnFilterRowHeader({
	col,
	hasValue,
	theme,
	onClear,
}: {
	col: ColumnDef<any>;
	hasValue: boolean;
	theme: ThemeTokens;
	onClear: () => void;
}) {
	return (
		<div
			style={{
				fontSize: 10,
				fontWeight: 700,
				letterSpacing: '0.06em',
				textTransform: 'uppercase',
				color: hasValue ? theme.focusRing : theme.headerText,
				marginBottom: 5,
				display: 'flex',
				alignItems: 'center',
				gap: 6,
			}}
		>
			{col.header || col.field}
			{hasValue && (
				<span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.focusRing, display: 'inline-block', flexShrink: 0 }} />
			)}
			{hasValue && (
				<button
					onClick={onClear}
					style={{
						marginLeft: 'auto',
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						color: theme.headerText,
						padding: 0,
						display: 'flex',
						alignItems: 'center',
					}}
				>
					<ClearIcon />
				</button>
			)}
		</div>
	);
}

// ── LegacyColumnFilterRow (text/number/date/set with compound support) ────────

function LegacyColumnFilterRow({
	col,
	columnFilter,
	api,
	filterModel,
	theme,
}: {
	col: ColumnDef<any>;
	columnFilter: ColumnFilter | undefined;
	api: GridApi<any>;
	filterModel: FilterModel | null;
	theme: ThemeTokens;
}) {
	const ft = effectiveFilterType(col);
	const [showSecond, setShowSecond] = useState(columnFilter?.type === 'compound');
	const [compoundOp, setCompoundOp] = useState<'AND' | 'OR'>(getCompoundOp(columnFilter));

	const distinctValueSummary = useMemo(
		() => (ft === 'set' ? api.getColumnDistinctValueSummary(col.field) : { values: [], truncated: false, limit: null }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ft, col.field]
	);
	const allSetValues = useMemo(() => [...distinctValueSummary.values], [distinctValueSummary.values]);

	useEffect(() => {
		setShowSecond(columnFilter?.type === 'compound');
	}, [columnFilter]);

	const c1 = getCondition1(columnFilter);
	const c2 = getCondition2(columnFilter);
	const hasAnyValue = !conditionIsEmpty(c1) || !conditionIsEmpty(c2);

	const commit = useCallback(
		(next1: FilterCondition | null, next2: FilterCondition | null, op: 'AND' | 'OR') => {
			const built = buildColumnFilter(next1, next2, op);
			const next: FilterModel = { ...(filterModel ?? {}) };
			if (!built) delete next[col.field];
			else next[col.field] = built;
			api.setFilterModel(Object.keys(next).length > 0 ? next : null);
		},
		[filterModel, col.field, api]
	);

	const handleC1Change = (c: FilterCondition | null) => commit(c, showSecond ? c2 : null, compoundOp);
	const handleC2Change = (c: FilterCondition | null) => commit(c1, c, compoundOp);
	const handleOpChange = (op: 'AND' | 'OR') => {
		setCompoundOp(op);
		commit(c1, c2, op);
	};

	return (
		<div style={{ padding: '4px 12px 10px' }}>
			<ColumnFilterRowHeader col={col} hasValue={hasAnyValue} theme={theme} onClear={() => commit(null, null, compoundOp)} />

			<ConditionEditor
				ft={ft}
				condition={c1}
				allSetValues={allSetValues}
				distinctValueSummary={distinctValueSummary}
				onChange={handleC1Change}
				theme={theme}
			/>

			{ft !== 'set' && (
				<>
					{!showSecond ? (
						<button
							onClick={() => setShowSecond(true)}
							style={{
								marginTop: 5,
								fontSize: 10,
								color: theme.focusRing,
								background: 'none',
								border: 'none',
								cursor: 'pointer',
								padding: 0,
							}}
						>
							+ Add condition
						</button>
					) : (
						<>
							<div style={{ display: 'flex', gap: 4, margin: '5px 0' }}>
								{(['AND', 'OR'] as const).map((o) => (
									<button
										key={o}
										onClick={() => handleOpChange(o)}
										style={{
											fontSize: 10,
											fontWeight: 700,
											padding: '2px 8px',
											borderRadius: 4,
											border: `1px solid ${compoundOp === o ? theme.selectionBorder : theme.borderColor}`,
											background: compoundOp === o ? theme.selectionBg : 'transparent',
											color: compoundOp === o ? theme.textColor : theme.headerText,
											cursor: 'pointer',
										}}
									>
										{o}
									</button>
								))}
								<button
									onClick={() => {
										setShowSecond(false);
										commit(c1, null, compoundOp);
									}}
									style={{
										marginLeft: 'auto',
										background: 'none',
										border: 'none',
										cursor: 'pointer',
										color: theme.headerText,
										padding: 0,
										display: 'flex',
										alignItems: 'center',
									}}
								>
									<ClearIcon />
								</button>
							</div>
							<ConditionEditor
								ft={ft}
								condition={c2}
								allSetValues={allSetValues}
								distinctValueSummary={distinctValueSummary}
								onChange={handleC2Change}
								theme={theme}
							/>
						</>
					)}
				</>
			)}
		</div>
	);
}

// ── FiltersPanel (root) ───────────────────────────────────────────────────────

interface FiltersPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function FiltersPanel({ api, onClose }: FiltersPanelProps) {
	const columns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const filterModel = useGridKeySelector<FilterModel | null>('filterModel', (s) => s.filterModel);
	useGridKeySelector('themeName', (s) => s.themeName);
	const theme = api.getTheme();

	const displayedCols = api.getDisplayedColumns().filter((col) => {
		if (col.filterDef) return col.filterDef.type !== 'none';
		return col.filterType !== 'none';
	});

	const activeCount = filterModel ? Object.keys(filterModel).length : 0;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: theme.bgColor }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0 12px',
					height: 44,
					flexShrink: 0,
					background: theme.headerBg,
					borderBottom: `1px solid ${theme.borderColor}`,
					gap: 8,
				}}
			>
				<span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.textColor }}>
					Filters
				</span>
				{activeCount > 0 && (
					<button
						onClick={() => api.setFilterModel(null)}
						style={{
							fontSize: 10,
							fontWeight: 600,
							color: theme.focusRing,
							background: theme.selectionBg,
							border: `1px solid ${theme.selectionBorder}`,
							borderRadius: 4,
							padding: '2px 7px',
							cursor: 'pointer',
							letterSpacing: '0.03em',
						}}
					>
						Clear {activeCount}
					</button>
				)}
				<button onClick={onClose} style={makeIconBtnStyle(theme.headerText)}>
					<CloseIcon />
				</button>
			</div>

			{/* Filter rows */}
			<div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 12px' }}>
				{displayedCols.length === 0 && (
					<div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 11, color: theme.headerText }}>No columns to filter</div>
				)}
				{displayedCols.map((col) => (
					<ColumnFilterRow
						key={col.field}
						col={col}
						columnFilter={filterModel?.[col.field] as ColumnFilter | undefined}
						api={api}
						filterModel={filterModel}
						theme={theme}
					/>
				))}
			</div>
		</div>
	);
}

function makeIconBtnStyle(color: string): React.CSSProperties {
	return {
		width: 24,
		height: 24,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 5,
		border: 'none',
		background: 'transparent',
		cursor: 'pointer',
		color,
		padding: 0,
		flexShrink: 0,
	};
}
