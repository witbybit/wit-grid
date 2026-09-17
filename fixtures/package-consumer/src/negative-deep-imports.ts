// These implementation paths are present in a tarball only as transitive
// package files. They must remain blocked by the package export maps.
// @ts-expect-error @eregister/open-grid-core does not publish implementation subpaths
import type { GridStore } from '@eregister/open-grid-core/store';
// @ts-expect-error @eregister/open-grid-react does not publish its internal bridge
import type { GridHostWithAdapter } from '@eregister/open-grid-react/reactHostBridge';

void (undefined as unknown as GridStore | GridHostWithAdapter<unknown>);
