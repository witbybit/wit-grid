import type { GroupRenderContext } from '@eregister/wit-grid-core';

/**
 * The built-in expand/collapse toggle for a custom group renderer (`grouping.rowRenderer`,
 * `hierarchyColumn.renderer`): the grid's own chevron element and classes, clicking calls `ctx.toggle()`.
 */
export function GroupToggle({ ctx }: { ctx: Pick<GroupRenderContext<never>, 'hasChildren' | 'expanded' | 'toggle'> }) {
	if (!ctx.hasChildren) return <span className='og-hierarchy-toggle og-hierarchy-toggle-none' />;
	return (
		<span
			className={`og-hierarchy-toggle og-hierarchy-toggle-${ctx.expanded ? 'open' : 'closed'}`}
			role='button'
			aria-expanded={ctx.expanded}
			aria-label={ctx.expanded ? 'Collapse' : 'Expand'}
			onClick={ctx.toggle}
		/>
	);
}

/** The built-in count badge (`ctx.count`); renders nothing when there is none. */
export function GroupCount({ ctx }: { ctx: Pick<GroupRenderContext<never>, 'count'> }) {
	return ctx.count === null ? null : <span className='og-hierarchy-count'>{ctx.count}</span>;
}
