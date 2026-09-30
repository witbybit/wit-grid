import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Callout } from 'fumadocs-ui/components/callout';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { TypeTable } from 'fumadocs-ui/components/type-table';

export function getMDXComponents(components?: Record<string, React.ComponentType>) {
	return {
		...defaultMdxComponents,
		Callout,
		Tab,
		Tabs,
		Step,
		Steps,
		Card,
		Cards,
		Accordion,
		Accordions,
		TypeTable,
		...components,
	};
}
