/**
 * Data integrity: the grid's status (clean, warnings, blocked) with Run checks, then three tabs —
 * issues (by severity; click to go to the cell), the diff (old → new, accept a change), and
 * conflicts (keep yours or take theirs).
 */
import type { GridCellConflict, GridCellDiff, GridIntegrityIssue } from '../../state/integrityStateTypes.js';
import { disposables, el, emptyState, icon, textButton } from '../panelKit.js';
import type { SidebarIconName } from '../sidebarIcons.js';
import type { SidebarPanel } from '../sidebarTypes.js';

type Tab = 'issues' | 'diff' | 'conflicts';
type Severity = 'all' | 'error' | 'warning';

/** Lists stop here; the rest is counted. */
const LIST_LIMIT = 150;

function show(value: unknown): string {
	if (value === null || value === undefined || value === '') return '(empty)';
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

const STATUS: Record<string, { label: string; hint: string; icon: SidebarIconName }> = {
	clean: { label: 'All clear', hint: 'No issues found.', icon: 'check' },
	warning: { label: 'Needs a look', hint: 'Warnings, nothing blocking.', icon: 'alert' },
	blocked: { label: 'Blocked', hint: 'Fix the blocking issues to submit.', icon: 'alert' },
	checking: { label: 'Checking…', hint: 'Running the checks.', icon: 'refresh' },
};

export const integrityPanel: SidebarPanel<any> = {
	mount(container, { api, actions }) {
		const d = disposables();
		let tab: Tab = 'issues';
		let severity: Severity = 'all';
		let running = false;
		let runError: string | null = null;
		const integrity = api.integrity;

		const root = el('div', 'og-sb-stack og-sb-integrity');
		container.appendChild(root);
		const clear = textButton('Clear', () => integrity.clearIssues());
		actions.appendChild(clear);

		const labelOf = (field: string | undefined) => {
			if (!field) return '';
			const column = api.getColumns().find((c) => c.field === field);
			return column?.header || field;
		};
		const goTo = (rowId?: string, colField?: string) => {
			if (!rowId || !colField) return;
			api.scrollToCell(rowId, colField);
			api.selectCell({ rowId, colField });
		};

		const issueRow = (issue: GridIntegrityIssue) => {
			const item = el('button', 'og-sb-issue');
			item.type = 'button';
			item.dataset.severity = issue.severity;
			item.disabled = !issue.rowId || !issue.colField;
			const dot = el('span', 'og-sb-issue-dot');
			const text = el('span', 'og-sb-issue-text');
			text.appendChild(el('span', 'og-sb-issue-message', issue.message));
			const where = [issue.colField ? labelOf(issue.colField) : null, issue.rowId ? `row ${issue.rowId}` : null].filter(Boolean).join(' · ');
			const meta = el('span', 'og-sb-issue-meta', where);
			if (issue.blocking) meta.prepend(el('span', 'og-sb-tag', 'Blocking'));
			text.appendChild(meta);
			item.append(dot, text);
			item.addEventListener('click', () => goTo(issue.rowId, issue.colField));
			return item;
		};

		// Diff and conflict findings have their own tabs.
		const listedIssues = () => integrity.getIssues().filter((issue) => issue.source !== 'diff' && issue.source !== 'conflict');

		const renderIssues = (body: HTMLElement) => {
			const all = listedIssues();
			const errors = all.filter((i) => i.severity === 'error').length;
			const warnings = all.filter((i) => i.severity === 'warning').length;
			if (all.length === 0) {
				body.appendChild(emptyState('integrity', 'No issues', 'Validation and data-quality findings show here. Run the checks to look for duplicates, outliers and format problems.'));
				return;
			}
			const seg = el('div', 'og-sb-seg og-sb-seg-sm');
			seg.setAttribute('role', 'radiogroup');
			seg.setAttribute('aria-label', 'Severity');
			for (const [value, label] of [
				['all', `All ${all.length}`],
				['error', `Errors ${errors}`],
				['warning', `Warnings ${warnings}`],
			] as const) {
				const b = el('button', 'og-sb-seg-btn', label);
				b.type = 'button';
				b.setAttribute('role', 'radio');
				b.setAttribute('aria-checked', String(severity === value));
				b.addEventListener('click', () => {
					severity = value;
					render();
				});
				seg.appendChild(b);
			}
			body.appendChild(seg);
			const shown = severity === 'all' ? all : all.filter((i) => i.severity === severity);
			const list = el('div', 'og-sb-issues');
			for (const issue of shown.slice(0, LIST_LIMIT)) list.appendChild(issueRow(issue));
			body.appendChild(list);
			if (shown.length > LIST_LIMIT) body.appendChild(el('div', 'og-sb-hint', `And ${shown.length - LIST_LIMIT} more.`));
		};

		const renderDiff = (body: HTMLElement) => {
			const diff = integrity.getDiffResult();
			if (!diff) {
				body.appendChild(emptyState('columns', 'No comparison', 'Compare the grid with another dataset (integrity.setDiffModel) to see what changed, cell by cell.'));
				return;
			}
			const stats = el('div', 'og-sb-stats');
			for (const [label, count, kind] of [
				['Changed', diff.changedRows.length, 'changed'],
				['Added', diff.addedRows.length, 'added'],
				['Removed', diff.removedRows.length, 'removed'],
			] as const) {
				const stat = el('div', 'og-sb-stat');
				stat.dataset.kind = kind;
				stat.append(el('span', 'og-sb-stat-value', String(count)), el('span', 'og-sb-stat-label', `${label} rows`));
				stats.appendChild(stat);
			}
			body.appendChild(stats);
			const cells = diff.changedCells.filter((c) => c.status === 'changed');
			if (cells.length === 0) return;
			const list = el('div', 'og-sb-issues');
			for (const cell of cells.slice(0, LIST_LIMIT)) list.appendChild(diffRow(cell));
			body.appendChild(list);
			if (cells.length > LIST_LIMIT) body.appendChild(el('div', 'og-sb-hint', `And ${cells.length - LIST_LIMIT} more.`));
			body.appendChild(textButton('Stop comparing', () => integrity.clearDiff()));
		};

		const diffRow = (cell: GridCellDiff) => {
			const row = el('div', 'og-sb-diff');
			const go = el('button', 'og-sb-diff-main');
			go.type = 'button';
			go.title = 'Go to the cell';
			const values = el('span', 'og-sb-diff-values');
			values.append(el('del', undefined, show(cell.oldValue)), icon('arrowRight', 12), el('ins', undefined, show(cell.newValue)));
			go.append(el('span', 'og-sb-issue-meta', `${labelOf(cell.colField)} · row ${cell.rowId}`), values);
			go.addEventListener('click', () => goTo(cell.rowId, cell.colField));
			const accept = textButton('Accept', () => void integrity.acceptCellDiff(cell.rowId, cell.colField).catch(() => {}));
			row.append(go, accept);
			return row;
		};

		const renderConflicts = (body: HTMLElement) => {
			const conflicts = integrity.getConflicts();
			if (conflicts.length === 0) {
				body.appendChild(emptyState('check', 'No conflicts', 'When a live update or a refresh meets a cell you are editing, both values show here for you to choose.'));
				return;
			}
			for (const conflict of conflicts.slice(0, LIST_LIMIT)) body.appendChild(conflictCard(conflict));
			if (conflicts.length > 1)
				body.appendChild(
					textButton('Dismiss all', () => {
						for (const c of integrity.getConflicts()) integrity.clearConflict(c.id);
						render();
					})
				);
		};

		const conflictCard = (conflict: GridCellConflict) => {
			const card = el('div', 'og-sb-conflict');
			const head = el('button', 'og-sb-conflict-head');
			head.type = 'button';
			head.append(el('span', 'og-sb-conflict-where', `${labelOf(conflict.colField)} · row ${conflict.rowId}`), el('span', 'og-sb-tag', conflict.source));
			head.addEventListener('click', () => goTo(conflict.rowId, conflict.colField));
			const sides = el('div', 'og-sb-conflict-sides');
			const side = (label: string, value: unknown, strategy: 'local' | 'remote', action: string) => {
				const box = el('div', 'og-sb-conflict-side');
				box.append(el('span', 'og-sb-conflict-label', label), el('span', 'og-sb-conflict-value', show(value)));
				box.appendChild(
					textButton(action, () => void integrity.resolveConflict(conflict.id, { strategy }).then(render, () => render()), strategy === 'local' ? 'ghost' : 'primary')
				);
				return box;
			};
			sides.append(side('Yours', conflict.localValue, 'local', 'Keep mine'), side('Theirs', conflict.remoteValue, 'remote', 'Take theirs'));
			card.append(head, sides);
			if (conflict.message) card.appendChild(el('div', 'og-sb-hint', conflict.message));
			return card;
		};

		const render = () => {
			const summary = integrity.getSummary();
			const status = STATUS[running ? 'checking' : summary.status] ?? STATUS.clean;
			root.textContent = '';
			clear.hidden = summary.totalIssues === 0;

			const hero = el('div', 'og-sb-health');
			hero.dataset.status = running ? 'checking' : summary.status;
			const badge = el('span', 'og-sb-health-icon');
			badge.appendChild(icon(status.icon, 16));
			const text = el('div', 'og-sb-health-text');
			text.append(el('span', 'og-sb-health-label', status.label), el('span', 'og-sb-health-hint', runError ?? status.hint));
			const run = textButton(running ? 'Running…' : 'Run checks', () => {
				running = true;
				runError = null;
				render();
				integrity
					.run({ modules: ['quality'] })
					.catch((error: unknown) => (runError = error instanceof Error ? error.message : String(error)))
					.finally(() => {
						running = false;
						render();
					});
			}, 'subtle', 'refresh');
			run.disabled = running;
			const top = el('div', 'og-sb-health-top');
			top.append(badge, text);
			const counts = el('div', 'og-sb-health-counts');
			for (const [label, count, kind] of [
				['Errors', summary.errors, 'error'],
				['Warnings', summary.warnings, 'warning'],
				['Blocking', summary.blockingIssues, 'blocking'],
			] as const) {
				const c = el('div', 'og-sb-health-count');
				c.dataset.kind = kind;
				c.toggleAttribute('data-zero', count === 0);
				c.append(el('span', 'og-sb-stat-value', String(count)), el('span', 'og-sb-stat-label', label));
				counts.appendChild(c);
			}
			hero.append(top, counts, run);
			root.appendChild(hero);

			const conflicts = integrity.getConflicts().length;
			const diff = integrity.getDiffResult();
			const tabs = el('div', 'og-sb-tabs');
			tabs.setAttribute('role', 'tablist');
			for (const [value, label, count] of [
				['issues', 'Issues', listedIssues().length],
				['diff', 'Changes', diff ? diff.changedCells.length : 0],
				['conflicts', 'Conflicts', conflicts],
			] as const) {
				const b = el('button', 'og-sb-tabs-btn');
				b.type = 'button';
				b.setAttribute('role', 'tab');
				b.setAttribute('aria-selected', String(tab === value));
				b.appendChild(el('span', undefined, label));
				if (count > 0) b.appendChild(el('span', 'og-sb-count', count > 99 ? '99+' : String(count)));
				b.addEventListener('click', () => {
					tab = value;
					render();
				});
				tabs.appendChild(b);
			}
			root.appendChild(tabs);
			const body = el('div', 'og-sb-stack');
			body.setAttribute('role', 'tabpanel');
			if (tab === 'issues') renderIssues(body);
			else if (tab === 'diff') renderDiff(body);
			else renderConflicts(body);
			root.appendChild(body);
		};

		render();
		d.add(api.subscribeToIntegrity(() => render()));
		return { destroy: () => d.dispose() };
	},
};
