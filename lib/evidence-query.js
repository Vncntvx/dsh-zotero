/** Admission limit shared by tool entry points and direct ranking callers. */
import { ZOTERO_MAX_QUERY_CHARS } from './constants.js';
import { invalidArgs } from './errors.js';
export function requireEvidenceQueryWithinLimit(query) {
    if (query.length > ZOTERO_MAX_QUERY_CHARS)
        invalidArgs(`Each evidence query must contain at most ${ZOTERO_MAX_QUERY_CHARS} characters.`);
}
//# sourceMappingURL=evidence-query.js.map