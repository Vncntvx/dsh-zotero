import type { ZoteroAttachmentLocationView, ZoteroParseTargetView } from '../contract.js';
import type { ParseSourceInput } from './types.js';
export type ParseAttachmentResolver = (ref: string, signal?: AbortSignal) => Promise<ZoteroAttachmentLocationView>;
export interface ParseTarget {
    readonly target: ZoteroParseTargetView;
    /** Full identity participates in hashing; it is never returned as a URL. */
    readonly input: ParseSourceInput;
    readonly sourceId: string;
    readonly targetLabel: string;
}
export declare function parseDigest(value: string): string;
/** Receipt and progress text never retain URLs, absolute paths, or credential assignments. */
export declare function safeParseText(value: string, limit: number): string;
/** Pure validation, safe before registry admission. No source probe occurs here. */
export declare function parseTargetOf(value: ZoteroParseTargetView): ParseTarget;
/**
 * Resolve exactly the selected attachment, including top-level attachments.
 * The trusted core checks the live server; this boundary also checks that its
 * response still names the selected key, library, instance, and PDF type.
 */
export declare function resolveParseTarget(target: ParseTarget, resolveAttachment: ParseAttachmentResolver, signal: AbortSignal): Promise<ParseTarget>;
//# sourceMappingURL=parse-target.d.ts.map