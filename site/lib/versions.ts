export type DocsVersion = {
	label: string;
	slug: string;
	url: string;
	status: 'current' | 'archived';
};

export const currentDocsVersion = 'next';

export const docsVersions: DocsVersion[] = [
	{
		label: 'Next',
		slug: 'next',
		url: '/docs/next',
		status: 'current',
	},
	{
		label: '1.4',
		slug: '1.4',
		url: '/docs/1.4',
		status: 'archived',
	},
];

export function getVersionFromSlug(slug?: string[]): DocsVersion {
	const version = docsVersions.find((item) => item.slug === slug?.[0]);
	return version ?? docsVersions[0];
}
