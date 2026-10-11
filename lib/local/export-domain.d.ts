/**
 * The `zotero_export` domain: citations batched to the API's itemKey cap,
 * the CSL-sorted bibliography, and the translator formats whose per-document
 * entries are located server-side against the merged batch body.
 * @module dsh-zotero/local/export-domain
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroExportRequest, ZoteroExportResult, ZoteroProgressEvent } from '../types.js';
/**
 * Export the requested items through the Local API's format pipeline:
 * `include=citation` pairs each item with its HTML citation (batched to the
 * API's itemKey cap when the request is larger), `format=bib` yields a
 * joined CSL-sorted bibliography, and the translator formats
 * (`bibtex`/`biblatex`/`ris`/`csljson`) export the whole set at once. The
 * batch-breaking formats refuse to exceed `ZOTERO_ITEMKEY_BATCH`, because
 * their global ordering belongs to Zotero and splitting them would silently
 * reorder the output. The translator formats itemize each document by
 * locating it directly within the batch body in memory, pairing each ref
 * with its citation key, span offsets, and display title where possible,
 * and falling back gracefully to a bare ref if an item is omitted by the
 * translator output. Output that exceeds `maxExportChars` fails with
 * OUTPUT_TOO_LARGE: export text is never mid-truncated.
 */
export declare function exportItems(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroExportRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroExportResult>;
//# sourceMappingURL=export-domain.d.ts.map