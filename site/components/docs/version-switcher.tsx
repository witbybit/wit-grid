'use client';

import { usePathname, useRouter } from 'next/navigation';
import { docsVersions } from '@/lib/versions';

export function VersionSwitcher() {
	const pathname = usePathname();
	const router = useRouter();
	const current = docsVersions.find((version) => pathname === version.url || pathname.startsWith(`${version.url}/`)) ?? docsVersions[0];

	return (
		<label className='wg-version-switcher'>
			<span>Version</span>
			<select
				value={current.slug}
				onChange={(event) => {
					const next = docsVersions.find((version) => version.slug === event.target.value);
					if (next) router.push(next.url);
				}}
				aria-label='Documentation version'
			>
				{docsVersions.map((version) => (
					<option key={version.slug} value={version.slug}>
						{version.label}
						{version.status === 'current' ? ' (current)' : ''}
					</option>
				))}
			</select>
		</label>
	);
}
