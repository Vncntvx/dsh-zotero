/**
 * @module dsh-zotero/client/sources/export-decoder
 */
import type { ExportDocumentItem } from './model.js';
/** The export projection view; a record without refs itemizes none. */
export interface ExportMetaView {
    readonly format: string | null;
    readonly style: string | null;
    readonly locale: string | null;
    readonly refs: readonly string[];
    readonly refsOmitted: number;
    /** The bounded per-document items; empty when the projection carried none. */
    readonly items: readonly ExportDocumentItem[];
    /** True when the meta budget dropped the detail rows behind these facts. */
    readonly detailOmitted: boolean;
}
export declare function exportMetaOf(meta: Record<string, unknown>): ExportMetaView;
//# sourceMappingURL=export-decoder.d.ts.map