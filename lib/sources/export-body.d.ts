/**
 * The inline body of a settled export result.
 *
 * The bounded presentation projector never carries the rendered body: an
 * inline delivery's text is the first content block the render emitted, and a
 * file delivery's content is only the receipt plus the attachment. Reading it
 * here keeps the ledger's artifacts and the export card on one rule.
 * @module dsh-zotero/sources/export-body
 */
import type { ToolBlockLike } from './block-types.js';
/**
 * The export body a block carries inline, or the empty string when the body
 * lives in a file (or the block is a background/promoted acknowledgement).
 * @param block - the settled export block.
 * @param meta - its presentation meta, when present.
 * @returns the inline body, never null.
 */
export declare function exportBodyOf(block: ToolBlockLike, meta: Record<string, unknown> | null): string;
//# sourceMappingURL=export-body.d.ts.map