import { meta as basicGrid } from './demos/basic-grid/meta';
import { meta as persistence } from './demos/persistence/meta';
import { meta as rowSelection } from './demos/row-selection/meta';

export const allExamples = [basicGrid, rowSelection, persistence] as const;

export const showcaseExamples = allExamples.filter((example) => example.showcase);
