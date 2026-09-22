/**
 * CRUD + Validation Demo
 *
 * Demonstrates the full validation lifecycle:
 *   - Sidebar "Submission Log" panel showing errors or success payload as JSON
 */
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type {
	ColumnDef,
	GridApi,
	GridReadyEvent,
	GridIntegrityIssue,
	GridWriteBlockedEventPayload,
	SidebarPanelDef,
	GridCellIntegrityRule,
	GridRowIntegrityRule,
} from '@eregister/wit-grid-react';
import { ShieldCheck, Send, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Plus, FileJson, Scan, Navigation2 } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

type EmployeeStatus = 'Active' | 'On Leave' | 'Terminated';

interface Employee {
	id: string;
	name: string;
	email: string;
	department: string;
	salary: number;
	bonus: number | null;
	status: EmployeeStatus;
	startDate: string;
}

const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Sales', 'Finance', 'HR', 'Legal'];
const STATUSES: EmployeeStatus[] = ['Active', 'On Leave', 'Terminated'];

let _nextId = 100;
function nextId() {
	return String(++_nextId);
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
	const id = nextId();
	return {
		id,
		name: `New Employee`,
		email: '',
		department: 'Engineering',
		salary: 60000,
		bonus: null,
		status: 'Active',
		startDate: '2024-01-15',
		...overrides,
	};
}

const INITIAL_ROWS: Employee[] = [
	{
		id: '1',
		name: 'Alice Chen',
		email: 'alice@company.com',
		department: 'Engineering',
		salary: 95000,
		bonus: 12000,
		status: 'Active',
		startDate: '2021-03-01',
	},
	{ id: '2', name: 'Bob Smith', email: '', department: 'Design', salary: -5000, bonus: null, status: 'Terminated', startDate: '2023-07-15' },
	{
		id: '3',
		name: '',
		email: 'carol@company.com',
		department: 'Marketing',
		salary: 72000,
		bonus: null,
		status: 'On Leave',
		startDate: '2022-11-20',
	},
	{
		id: '4',
		name: 'David Park',
		email: 'david.park@company.com',
		department: 'Finance',
		salary: 88000,
		bonus: 9500,
		status: 'Active',
		startDate: '2020-05-10',
	},
	{
		id: '5',
		name: 'Eva Torres',
		email: 'not-an-email',
		department: 'HR',
		salary: 200000000,
		bonus: null,
		status: 'Active',
		startDate: '2024-02-28',
	},
];

// ─── Validators ───────────────────────────────────────────────────────────────

function isValidEmail(s: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: ColumnDef<Employee>[] = [
	{
		field: 'name',
		header: 'Full Name',
		width: 160,
		minWidth: 100,
		maxWidth: 300,
		tooltip: ({ row }) => `ID: ${row.id}`,
	},
	{
		field: 'email',
		header: 'Email',
		width: 200,
		minWidth: 120,
	},
	{
		field: 'department',
		header: 'Department',
		width: 130,
	},
	{
		field: 'status',
		header: 'Status',
		width: 110,
		tooltip: ({ row }) => {
			if (row.status === 'Terminated') return 'Salary and bonus are locked for terminated employees';
			if (row.status === 'On Leave') return 'Bonus is locked while on leave';
			return null;
		},
	},
	{
		field: 'salary',
		header: 'Salary ($)',
		width: 120,
		minWidth: 80,
		maxWidth: 200,
		canEdit: ({ row }) => row?.status !== 'Terminated',
		tooltip: ({ row }) => (row.status === 'Terminated' ? 'Salary locked — employee is terminated' : null),
	},
	{
		field: 'bonus',
		header: 'Bonus ($)',
		width: 110,
		canEdit: ({ row }) => row?.status === 'Active',
		tooltip: ({ row }) => {
			if (row.status === 'Active') return null;
			return `Bonus not applicable — status is "${row.status}"`;
		},
	},
	{
		field: 'startDate',
		header: 'Start Date',
		width: 115,
	},
];

// ─── Validation rules (integrity pipeline) ───────────────────────────────────

const DEPT_MIN_SALARY: Record<string, number> = {
	Engineering: 70000,
	Finance: 65000,
	Legal: 80000,
	Design: 55000,
	Marketing: 50000,
	Sales: 45000,
	HR: 45000,
};

const EMPLOYEE_CELL_RULES: GridCellIntegrityRule<Employee>[] = [
	{
		id: 'name-required',
		field: 'name',
		validate: async ({ value }) => {
			const s = String(value ?? '').trim();
			if (!s) return { message: 'Name is required' };
			if (s.length < 2) return { message: 'Name must be at least 2 characters' };
			return null;
		},
	},
	{
		id: 'email-required',
		field: 'email',
		validate: async ({ value }) => {
			const s = String(value ?? '').trim();
			if (!s) return { message: 'Email is required' };
			if (!isValidEmail(s)) return { message: 'Invalid email format (user@domain.com)' };
			await new Promise((resolve) => setTimeout(resolve, 220));
			if (s.endsWith('@contractor.test')) {
				return { message: 'Async policy: contractor.test addresses require manual approval' };
			}
			return null;
		},
	},
	{
		id: 'department-valid',
		field: 'department',
		validate: ({ value }) => {
			return DEPARTMENTS.includes(String(value ?? '')) ? null : { message: `Must be one of: ${DEPARTMENTS.join(', ')}` };
		},
	},
	{
		id: 'status-valid',
		field: 'status',
		validate: ({ value }) => {
			return STATUSES.includes(value as EmployeeStatus) ? null : { message: `Must be one of: ${STATUSES.join(', ')}` };
		},
	},
	{
		id: 'salary-valid',
		field: 'salary',
		validate: ({ value }) => {
			const n = Number(String(value ?? '').replace(/[$,]/g, ''));
			if (isNaN(n)) return { message: 'Must be a number' };
			if (n < 0) return { message: 'Salary cannot be negative' };
			if (n > 10_000_000) return { message: 'Salary exceeds maximum ($10M)' };
			return null;
		},
	},
	{
		id: 'bonus-valid',
		field: 'bonus',
		validate: ({ value }) => {
			if (value === null || value === '' || value === undefined) return null;
			const n = Number(String(value).replace(/[$,]/g, ''));
			if (isNaN(n)) return { message: 'Must be a number' };
			if (n < 0) return { message: 'Bonus cannot be negative' };
			if (n > 1_000_000) return { message: 'Bonus exceeds maximum ($1M)' };
			return null;
		},
	},
	{
		id: 'start-date-valid',
		field: 'startDate',
		validate: ({ value }) => {
			const d = new Date(String(value ?? ''));
			return isNaN(d.getTime()) ? { message: 'Invalid date (YYYY-MM-DD)' } : null;
		},
	},
];

const EMPLOYEE_ROW_RULES: GridRowIntegrityRule<Employee>[] = [
	{
		id: 'dept-min-salary',
		validate: ({ row }) => {
			const salary = Number((row as Employee).salary);
			const dept = (row as Employee).department;
			const minSalary = DEPT_MIN_SALARY[dept];
			if ((row as Employee).status !== 'Terminated' && minSalary !== undefined && !isNaN(salary) && salary >= 0 && salary < minSalary) {
				return { message: `${dept} minimum salary is $${minSalary.toLocaleString()}`, fields: ['salary'] };
			}
			return null;
		},
	},
	{
		id: 'bonus-inactive',
		validate: ({ row }) => {
			const r = row as Employee;
			if (r.status !== 'Active' && r.bonus !== null && r.bonus !== undefined) {
				return { message: `Bonus not applicable for status "${r.status}"`, fields: ['bonus'] };
			}
			return null;
		},
	},
];

// ─── Submit state type ────────────────────────────────────────────────────────

type SubmitStatus = 'idle' | 'validating' | 'submitting' | 'success' | 'error';

type SubmissionLog =
	| { kind: 'error'; errors: GridIntegrityIssue[] }
	| { kind: 'success'; rows: Employee[] }
	| { kind: 'writeBlocked'; blocked: GridWriteBlockedEventPayload }
	| null;

// ─── JSON syntax highlight helper ────────────────────────────────────────────

function JsonBlock({ value }: { value: unknown }) {
	const text = JSON.stringify(value, null, 2);
	// Minimal token colouring via regex replace on plain text
	const html = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
			let cls = 'text-sky-300'; // number
			if (/^"/.test(match)) {
				cls = /:$/.test(match) ? 'text-violet-300' : 'text-emerald-300'; // key vs string
			} else if (/true|false/.test(match)) {
				cls = 'text-amber-300';
			} else if (/null/.test(match)) {
				cls = 'text-rose-400';
			}
			return `<span class="${cls}">${match}</span>`;
		});
	return <pre className='overflow-auto text-[10.5px] leading-[1.6] text-slate-300' dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Sidebar log panel content ────────────────────────────────────────────────

function SubmissionLogPanel({ log }: { log: SubmissionLog }) {
	if (!log) {
		return (
			<div className='flex h-full flex-col items-center justify-center gap-3 px-5 text-center'>
				<FileJson className='h-8 w-8 text-slate-600' />
				<p className='text-[11px] text-slate-500'>
					Run <span className='font-semibold text-slate-400'>Validate All</span> or{' '}
					<span className='font-semibold text-slate-400'>Submit Changes</span> to see the JSON payload here.
				</p>
			</div>
		);
	}

	if (log.kind === 'error') {
		return (
			<div className='flex h-full flex-col gap-3 overflow-hidden p-3'>
				<div className='flex items-center gap-2'>
					<AlertTriangle className='h-3.5 w-3.5 shrink-0 text-rose-400' />
					<span className='text-[10px] font-extrabold uppercase tracking-wider text-rose-400'>
						{log.errors.length} validation error{log.errors.length !== 1 ? 's' : ''}
					</span>
				</div>
				<div className='min-h-0 flex-1 overflow-auto rounded-lg bg-slate-950/60 p-3'>
					<JsonBlock value={log.errors} />
				</div>
			</div>
		);
	}

	if (log.kind === 'writeBlocked') {
		return (
			<div className='flex h-full flex-col gap-3 overflow-hidden p-3'>
				<div className='flex items-center gap-2'>
					<AlertTriangle className='h-3.5 w-3.5 shrink-0 text-amber-400' />
					<span className='text-[10px] font-extrabold uppercase tracking-wider text-amber-400'>
						{log.blocked.source} blocked · {log.blocked.status}
					</span>
				</div>
				<div className='rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200'>{log.blocked.reason}</div>
				<div className='min-h-0 flex-1 overflow-auto rounded-lg bg-slate-950/60 p-3'>
					<JsonBlock value={log.blocked} />
				</div>
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col gap-3 overflow-hidden p-3'>
			<div className='flex items-center gap-2'>
				<CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-emerald-400' />
				<span className='text-[10px] font-extrabold uppercase tracking-wider text-emerald-400'>
					{log.rows.length} row{log.rows.length !== 1 ? 's' : ''} submitted
				</span>
			</div>
			<div className='min-h-0 flex-1 overflow-auto rounded-lg bg-slate-950/60 p-3'>
				<JsonBlock value={log.rows} />
			</div>
		</div>
	);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
	onGridReady?: (event: GridReadyEvent<Employee>) => void;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CrudValidationDemo({ onGridReady, editTrigger, arrowKeyNavigationEdit, pinLeftColumns, pinRightColumns }: Props) {
	const apiRef = useRef<GridApi<Employee> | null>(null);
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
	const [submitMessage, setSubmitMessage] = useState('');
	const [validationSummary, setValidationSummary] = useState<GridIntegrityIssue[]>([]);
	const [submissionLog, setSubmissionLog] = useState<SubmissionLog>(null);
	const [errorSnapshot, setErrorSnapshot] = useState<GridIntegrityIssue[] | null>(null);
	const [lastWriteBlocked, setLastWriteBlocked] = useState<GridWriteBlockedEventPayload | null>(null);
	const [rows] = useState<Employee[]>(INITIAL_ROWS);
	const [jumpRowId, setJumpRowId] = useState('');
	const [jumpColField, setJumpColField] = useState('');
	const [jumpEdit, setJumpEdit] = useState(false);
	const [lastJumped, setLastJumped] = useState<{ rowId: string; colField: string } | null>(null);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<Employee>) => {
			apiRef.current = event.api;
			onGridReady?.(event as GridReadyEvent<Employee>);
		},
		[onGridReady]
	);

	const handleValidateAll = useCallback(async () => {
		const api = apiRef.current;
		if (!api) return;
		setSubmitStatus('validating');
		setSubmitMessage('');
		const result = await api.integrity.validateGrid();
		const errors = result.issues as GridIntegrityIssue[];
		setValidationSummary(errors);
		if (errors.length === 0) {
			setSubmitStatus('idle');
			setSubmitMessage('All cells passed validation!');
			setSubmissionLog(null);
		} else {
			setSubmitStatus('error');
			setSubmitMessage(`${errors.length} validation error${errors.length > 1 ? 's' : ''} found. Fix highlighted cells and retry.`);
			setSubmissionLog({ kind: 'error', errors });
			api.openPanel('submission-log');
		}
	}, []);

	const handleSubmit = useCallback(async () => {
		const api = apiRef.current;
		if (!api) return;

		// Step 1: client-side validation sweep
		setSubmitStatus('validating');
		setSubmitMessage('Validating…');
		setValidationSummary([]);
		const result = await api.integrity.validateGrid();
		const errors = result.issues as GridIntegrityIssue[];
		setValidationSummary(errors);

		if (errors.length > 0) {
			setSubmitStatus('error');
			setSubmitMessage(`${errors.length} error${errors.length > 1 ? 's' : ''} — fix highlighted cells before saving.`);
			setSubmissionLog({ kind: 'error', errors });
			api.openPanel('submission-log');
			return;
		}

		// Step 2: mock server roundtrip
		setSubmitStatus('submitting');
		setSubmitMessage('Sending to server…');
		await new Promise((r) => setTimeout(r, 900));

		// Simulate a 50% chance the server rejects row 4 for a domain policy reason.
		// api.integrity.publishIssues() pushes server errors into the integrity pipeline
		const serverRejected = Math.random() > 0.5;
		if (serverRejected) {
			const serverIssue: GridIntegrityIssue = {
				id: 'server-email-4',
				source: 'serverValidation',
				type: 'serverRejected',
				severity: 'error',
				blocking: true,
				rowId: '4',
				colField: 'email',
				message: 'Server: @company.com domain reserved for existing staff',
				createdAt: Date.now(),
			};
			api.integrity.publishIssues('serverValidation', [serverIssue]);
			const serverErrors: GridIntegrityIssue[] = [serverIssue];
			setValidationSummary(serverErrors);
			setSubmitStatus('error');
			setSubmitMessage('Server rejected the request. Fix highlighted cells and retry.');
			setSubmissionLog({ kind: 'error', errors: serverErrors });
			api.openPanel('submission-log');
			return;
		}

		// Step 3: success — collect all rows from the grid and log them
		const allRows = api.rows().getAll();
		api.integrity.clearIssues();
		setValidationSummary([]);
		setSubmitStatus('success');
		setSubmitMessage('All changes saved successfully!');
		setSubmissionLog({ kind: 'success', rows: allRows });
		api.openPanel('submission-log');
	}, []);

	const handleAddRow = useCallback(() => {
		const api = apiRef.current;
		if (!api) return;
		const newRow = makeEmployee();
		api.applyTransaction({ add: [newRow] });
	}, []);

	const handleWriteBlocked = useCallback((blocked: GridWriteBlockedEventPayload) => {
		setLastWriteBlocked(blocked);
		setSubmitStatus('error');
		setSubmitMessage(
			`${blocked.source} blocked: ${blocked.reason}${
				blocked.rowCount > 1 || blocked.colCount > 1
					? ` (${blocked.rowCount} row${blocked.rowCount !== 1 ? 's' : ''}, ${blocked.colCount} column${blocked.colCount !== 1 ? 's' : ''})`
					: ''
			}`
		);
		if (blocked.issues && blocked.issues.length > 0) {
			setValidationSummary([...blocked.issues]);
		}
		setSubmissionLog({ kind: 'writeBlocked', blocked });
		apiRef.current?.openPanel('submission-log');
	}, []);

	const handleClearErrors = useCallback(() => {
		apiRef.current?.integrity.clearIssues();
		setValidationSummary([]);
		setSubmitStatus('idle');
		setSubmitMessage('');
		setSubmissionLog(null);
		setErrorSnapshot(null);
		setLastWriteBlocked(null);
	}, []);

	const handleJump = useCallback(() => {
		const api = apiRef.current;
		if (!api || !jumpRowId.trim()) return;
		const col = jumpColField.trim();
		if (col) {
			api.scrollToCell(jumpRowId.trim(), col, { select: true, edit: jumpEdit });
			setLastJumped({ rowId: jumpRowId.trim(), colField: col });
		} else {
			api.scrollToRow(jumpRowId.trim(), { select: true });
			setLastJumped({ rowId: jumpRowId.trim(), colField: '' });
		}
	}, [jumpRowId, jumpColField, jumpEdit]);

	const handleScrollToError = useCallback((rowId: string, colField: string) => {
		apiRef.current?.scrollToCell(rowId, colField, { select: true });
		setLastJumped({ rowId, colField });
	}, []);

	useEffect(() => {
		if (!lastJumped) return;
		const t = setTimeout(() => setLastJumped(null), 1500);
		return () => clearTimeout(t);
	}, [lastJumped]);

	// Synchronous read — no validators run, just reads current error state
	const handleSnapshotErrors = useCallback(() => {
		const api = apiRef.current;
		if (!api) return;
		setErrorSnapshot(api.integrity.getIssues() as GridIntegrityIssue[]);
	}, []);

	// Sidebar panel — recreated when submissionLog changes so the render closure captures the latest value
	const sidebarPanels = useMemo(
		(): SidebarPanelDef<Employee>[] => [
			{
				id: 'submission-log',
				label: 'Log',
				icon: <FileJson size={14} />,
				render: () => <SubmissionLogPanel log={submissionLog} />,
			},
		],
		[submissionLog]
	);

	return (
		<div className='flex h-full min-h-0 flex-col gap-3'>
			{/* Toolbar */}
			<div className='flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-900 bg-slate-900/30 px-4 py-3'>
				<span className='mr-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>Actions</span>

				<button
					onClick={handleValidateAll}
					disabled={submitStatus === 'validating' || submitStatus === 'submitting'}
					className='flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-40'
				>
					{submitStatus === 'validating' ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <ShieldCheck className='h-3.5 w-3.5' />}
					Validate All
				</button>

				<button
					onClick={handleSubmit}
					disabled={submitStatus === 'validating' || submitStatus === 'submitting'}
					className='flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-[11px] font-bold text-purple-300 transition-all hover:bg-purple-500/20 disabled:opacity-40'
				>
					{submitStatus === 'submitting' ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Send className='h-3.5 w-3.5' />}
					{submitStatus === 'submitting' ? 'Saving…' : 'Submit Changes'}
				</button>

				<button
					onClick={handleClearErrors}
					className='flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-all hover:bg-slate-800'
				>
					<RefreshCw className='h-3.5 w-3.5' />
					Clear Errors
				</button>

				<button
					onClick={handleSnapshotErrors}
					title='Calls api.getAllValidationErrors() — synchronous, no validators re-run'
					className='flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-bold text-sky-300 transition-all hover:bg-sky-500/20'
				>
					<Scan className='h-3.5 w-3.5' />
					Snapshot Errors
				</button>

				<div className='ml-auto flex items-center gap-2'>
					{/* Jump to Row / Cell ──────────────────────────────────────────── */}
					<div className='flex items-center gap-1.5 rounded-lg border border-indigo-500/25 bg-indigo-500/8 px-2.5 py-1'>
						<Navigation2 className='h-3 w-3 shrink-0 text-indigo-400' />
						<span className='text-[10px] font-bold uppercase tracking-wider text-indigo-400'>Jump</span>
						<input
							value={jumpRowId}
							onChange={(e) => setJumpRowId(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleJump()}
							placeholder='row id'
							className='w-14 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none ring-1 ring-slate-700 focus:ring-indigo-500/50'
						/>
						<input
							value={jumpColField}
							onChange={(e) => setJumpColField(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleJump()}
							placeholder='field (opt)'
							className='w-20 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none ring-1 ring-slate-700 focus:ring-indigo-500/50'
						/>
						<label className='flex cursor-pointer items-center gap-1 select-none'>
							<input
								type='checkbox'
								checked={jumpEdit}
								onChange={(e) => setJumpEdit(e.target.checked)}
								className='h-3 w-3 accent-indigo-500'
							/>
							<span className='text-[10px] text-indigo-300/70'>edit</span>
						</label>
						<button
							onClick={handleJump}
							disabled={!jumpRowId.trim()}
							className='rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-40'
						>
							Go
						</button>
					</div>

					<button
						onClick={handleAddRow}
						className='flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300 transition-all hover:bg-emerald-500/20'
					>
						<Plus className='h-3.5 w-3.5' />
						Add Row
					</button>
				</div>
			</div>

			{/* Status banner */}
			{submitMessage && (
				<div
					className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-[11px] font-semibold ${
						submitStatus === 'success'
							? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
							: submitStatus === 'error'
								? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
								: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
					}`}
				>
					{submitStatus === 'success' ? (
						<CheckCircle2 className='h-4 w-4 shrink-0' />
					) : submitStatus === 'error' ? (
						<AlertTriangle className='h-4 w-4 shrink-0' />
					) : (
						<Loader2 className='h-4 w-4 shrink-0 animate-spin' />
					)}
					{submitMessage}
				</div>
			)}

			{/* Validation error list */}
			{validationSummary.length > 0 && (
				<div className='shrink-0 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3'>
					<div className='mb-2 flex items-center justify-between'>
						<p className='text-[10px] font-extrabold uppercase tracking-wider text-rose-400'>
							{validationSummary.length} validation error{validationSummary.length > 1 ? 's' : ''}
						</p>
						<span className='text-[9px] text-rose-600 italic'>click a row to scroll to it</span>
					</div>
					<ul className='flex flex-col gap-1 h-[70px] overflow-auto'>
						{validationSummary.map((e, i) => {
							const isJumped = !!e.rowId && !!e.colField && lastJumped?.rowId === e.rowId && lastJumped?.colField === e.colField;
							return (
								<li
									key={i}
									onClick={() => e.rowId && e.colField && handleScrollToError(e.rowId, e.colField)}
									className={`-mx-1 flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-[11px] text-rose-300/80 transition-colors ${
										isJumped ? 'bg-rose-500/20 text-rose-200' : 'hover:bg-rose-500/10 hover:text-rose-200'
									}`}
								>
									<Navigation2
										className={`mt-0.5 h-3 w-3 shrink-0 transition-colors ${isJumped ? 'text-rose-300' : 'text-rose-600'}`}
									/>
									<span>
										<span className='font-semibold text-rose-300'>
											Row {e.rowId} / {e.colField}:
										</span>{' '}
										{e.message}
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{lastWriteBlocked && (
				<div className='shrink-0 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3'>
					<div className='mb-2 flex items-center gap-2'>
						<AlertTriangle className='h-3.5 w-3.5 text-amber-400' />
						<p className='text-[10px] font-extrabold uppercase tracking-wider text-amber-400'>
							Last blocked write · {lastWriteBlocked.source} · {lastWriteBlocked.status}
						</p>
					</div>
					<p className='text-[11px] text-amber-200'>{lastWriteBlocked.reason}</p>
					<p className='mt-1 text-[10px] text-amber-300/80'>
						Affected cells: {lastWriteBlocked.cells.map((cell) => `${cell.rowId}/${cell.colField}`).join(', ') || 'none'}
					</p>
				</div>
			)}

			{/* getAllValidationErrors snapshot panel */}
			{errorSnapshot !== null && (
				<div className='shrink-0 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3'>
					<div className='mb-2 flex items-center justify-between gap-2'>
						<div className='flex items-center gap-2'>
							<Scan className='h-3.5 w-3.5 text-sky-400' />
							<p className='text-[10px] font-extrabold uppercase tracking-wider text-sky-400'>
								getAllValidationErrors() snapshot — {errorSnapshot.length} error{errorSnapshot.length !== 1 ? 's' : ''}{' '}
								<span className='ml-1 font-normal normal-case text-sky-600'>(sync read, no validators re-run)</span>
							</p>
						</div>
						<button
							onClick={() => setErrorSnapshot(null)}
							className='text-[10px] text-sky-600 hover:text-sky-400'
							aria-label='Dismiss snapshot'
						>
							✕
						</button>
					</div>
					{errorSnapshot.length === 0 ? (
						<p className='text-[11px] text-sky-600 italic'>No errors in current state — run Validate All first to populate errors.</p>
					) : (
						<ul className='flex flex-col gap-1 h-[70px] overflow-auto'>
							{errorSnapshot.map((e, i) => {
								const isJumped = !!e.rowId && !!e.colField && lastJumped?.rowId === e.rowId && lastJumped?.colField === e.colField;
								return (
									<li
										key={i}
										onClick={() => e.rowId && e.colField && handleScrollToError(e.rowId, e.colField)}
										className={`-mx-1 flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-[11px] text-sky-300/80 transition-colors ${
											isJumped ? 'bg-sky-500/20 text-sky-200' : 'hover:bg-sky-500/10 hover:text-sky-200'
										}`}
									>
										<Navigation2
											className={`mt-0.5 h-3 w-3 shrink-0 transition-colors ${isJumped ? 'text-sky-300' : 'text-sky-600'}`}
										/>
										<span>
											<span className='font-semibold text-sky-300'>
												Row {e.rowId} / {e.colField}:
											</span>{' '}
											{e.message}
										</span>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			)}

			{/* Grid */}
			<div className='min-h-0 flex-1'>
				<Grid<Employee>
					rowModelType='client'
					columns={COLUMNS}
					rows={rows}
					getRowId={(r) => r.id}
					dataIntegrity={{
						validation: {
							cellRules: EMPLOYEE_CELL_RULES,
							rowRules: EMPLOYEE_ROW_RULES,
						},
					}}
					navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					onGridReady={handleGridReady}
					onWriteBlocked={handleWriteBlocked}
					showFilterChipBar
					initialState={{ defaultColWidth: 130 }}
					sidebar={{
						panels: [...sidebarPanels, 'themes', 'dataIntegrity'],
						position: 'right',
						width: 320,
					}}
				/>
			</div>

			{/* Legend */}
			<div className='flex shrink-0 flex-wrap items-center gap-3 px-1 pb-1 text-[10px] text-slate-500'>
				<span className='font-semibold uppercase tracking-wider'>How to use:</span>
				<span>Double-click any cell to edit</span>
				<span>·</span>
				<span>
					<strong className='text-slate-400'>Salary</strong> is locked for <em>Terminated</em> employees —{' '}
					<strong className='text-slate-400'>Bonus</strong> is locked unless <em>Active</em>
				</span>
				<span>·</span>
				<span>Hover muted cells to see the reason they're read-only</span>
				<span>·</span>
				<span>Use the header filter menu to filter — active filters appear as chips above the headers</span>
				<span>·</span>
				<span>Cross-field rules enforce per-department salary minimums and bonus eligibility</span>
				<span>·</span>
				<span>
					<strong className='text-slate-400'>Submit Changes</strong> may surface a server error pushed via{' '}
					<code className='text-slate-400'>api.integrity.publishIssues()</code>
				</span>
				<span>Â·</span>
				<span>
					Try editing or pasting an email ending with <code className='text-slate-400'>@contractor.test</code> to see async pre-commit
					validation block the write
				</span>
				<span>·</span>
				<span>
					<strong className='text-slate-400'>Click any error row</strong> to scroll to that cell via{' '}
					<code className='text-slate-400'>api.scrollToCell()</code> — or use the <strong className='text-slate-400'>Jump</strong> input to
					call <code className='text-slate-400'>scrollToRow()</code> / <code className='text-slate-400'>scrollToCell()</code> directly
				</span>
			</div>
		</div>
	);
}
