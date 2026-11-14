/**
 * Shared domain types and limits for the MinerU document-enrichment component.
 * Pure data only — no host imports, so unit tests and the store can share it.
 * @module dsh-zotero/enrichment/types
 */
import { ENRICHMENT_DOCUMENT_LIMITS } from '../enrichment-preferences.js';
/** Local byte and remote page limits, shared with the submission confirmation. */
export function limitsFor(mode) {
    return ENRICHMENT_DOCUMENT_LIMITS[mode];
}
//# sourceMappingURL=types.js.map