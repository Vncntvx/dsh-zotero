import { ZoteroError } from '../../errors.js';
import type { BundleSnapshot } from '../model-installation.js';
export declare class SemanticBundleFailure extends ZoteroError {
    readonly kind: 'missing' | 'corrupt';
    readonly snapshot: BundleSnapshot;
    constructor(message: string, kind: 'missing' | 'corrupt', snapshot: BundleSnapshot);
}
//# sourceMappingURL=bundle-failure.d.ts.map