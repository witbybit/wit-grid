import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { VersionSwitcher } from '@/components/docs/version-switcher';
import { source } from '@/lib/source';
import { baseOptions } from '../layout.config';

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<DocsLayout tree={source.pageTree} {...baseOptions}>
			<div className='wg-docs-toolbar'>
				<VersionSwitcher />
			</div>
			{children}
		</DocsLayout>
	);
}
