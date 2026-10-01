/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single BM25 passage corpus, with per-passage
 * attachment provenance under the multi-attachment policies. An annotation
 * ranks on its highlight and the reader's comment together, and reports which
 * of the two matched; notes, the abstract, and full-text chunks rank on their
 * own text.
 * @module dsh-zotero/local/retrieve
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroRetrieveRequest, ZoteroRetrieveResult } from '../types.js';
/**
 * Gather ranked evidence for one item: annotations, notes, the abstract,
 * and full-text chunks are scored as one passage corpus with BM25. Fetch
 * stays lazy — children only when annotation/note sources (or a PDF
 * fallback) need them, fulltext only when requested (started concurrently
 * with children when the parent carries the attachment link). Annotations
 * live under each attachment, so annotation sources walk the graph's
 * second level and rank every attachment's annotations as one corpus; each
 * passage keeps its own attachment provenance. The `attachmentPolicy`
 * picks the fulltext sources: `best` (default) keeps Zotero's single
 * choice, `allIndexed` ranks every PDF child, and `specified` ranks the
 * named attachments — multi-attachment results speak through per-passage
 * refs instead of a result-level attachment. A named attachment is only
 * read once its ref is proven to describe an attachment of *this* item on
 * *this* instance: the same key in another library or another Zotero
 * database names a different object, and its text is not this item's
 * evidence. A note item's own body is its
 * note source; child notes contribute every chunk of their full text, so
 * long notes rank beyond their first chunk. Sources the item cannot
 * provide are skipped and reported in `sourcesSkipped` — retrieval degrades
 * instead of failing. Passage count and character budgets are enforced
 * with the `truncated` flag, never by silently editing passage text.
 */
export declare function retrieve(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>;
//# sourceMappingURL=retrieve.d.ts.map