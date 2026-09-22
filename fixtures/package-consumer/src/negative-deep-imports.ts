// These implementation paths are present in a tarball only as transitive
// package files. They must remain blocked by the package export maps.
// @ts-expect-error @eregister/wit-grid-core does not publish implementation subpaths
import type { GridStore } from '@eregister/wit-grid-core/store';
// @ts-expect-error @eregister/wit-grid-react does not publish its internal bridge
import type { GridHostWithAdapter } from '@eregister/wit-grid-react/reactHostBridge';

void (undefined as unknown as GridStore | GridHostWithAdapter<unknown>);
