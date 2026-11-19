import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js';
export class SemanticBundleFailure extends ZoteroError {
    kind;
    snapshot;
    constructor(message, kind, snapshot) {
        super(message, ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE);
        this.kind = kind;
        this.snapshot = snapshot;
    }
}
//# sourceMappingURL=bundle-failure.js.map