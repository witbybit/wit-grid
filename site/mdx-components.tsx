import defaultMdxComponents from 'fumadocs-ui/mdx';

export function getMDXComponents(components?: Record<string, React.ComponentType>) {
	return {
		...defaultMdxComponents,
		...components,
	};
}
