import type { ComponentType } from 'react';

export type WitGridExampleLevel = 'basic' | 'intermediate' | 'advanced';

export type WitGridExampleCategory = 'Getting started' | 'Selection' | 'State' | 'Row models' | 'Filtering' | 'Editing' | 'Validation';

export type WitGridExampleMeta = {
	id: string;
	title: string;
	description: string;
	category: WitGridExampleCategory;
	level: WitGridExampleLevel;
	tags: string[];
	docs: string;
	showcase: boolean;
	sourcePath: string;
};

export type WitGridExampleModule = {
	meta: WitGridExampleMeta;
	Component: ComponentType;
};
