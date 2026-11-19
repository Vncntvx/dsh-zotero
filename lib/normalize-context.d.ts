/**
 * Shared identity and text rules used by Zotero record normalizers.
 * @module dsh-zotero/normalize-context
 */
import type { SupportedLocalLibrary } from './types.js';
export interface NormalizeContext {
    readonly library: SupportedLocalLibrary;
    readonly serverId?: string;
}
export declare function resolveNormalizeContext(context?: NormalizeContext): NormalizeContext;
export declare const ITEM_WITHOUT_KEY_MESSAGE = "Zotero returned an item without a valid object key.";
export declare function parentKeyOf(data: Record<string, unknown> | undefined): string | undefined;
export declare function plainNoteText(value: unknown): string;
export declare function truncateText(text: string, max: number): {
    text: string;
    truncated: boolean;
};
//# sourceMappingURL=normalize-context.d.ts.map