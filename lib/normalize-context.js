/**
 * Shared identity and text rules used by Zotero record normalizers.
 * @module dsh-zotero/normalize-context
 */
import { asString, isObjectKey } from './json.js';
const PERSONAL_CONTEXT = { library: { type: 'user', id: 0 } };
export function resolveNormalizeContext(context) {
    return context ?? PERSONAL_CONTEXT;
}
export const ITEM_WITHOUT_KEY_MESSAGE = 'Zotero returned an item without a valid object key.';
export function parentKeyOf(data) {
    const parentKey = asString(data?.parentItem);
    return parentKey !== undefined && isObjectKey(parentKey) ? parentKey : undefined;
}
const HTML_ENTITIES = {
    '&nbsp;': ' ',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&amp;': '&',
};
const HTML_ENTITY_PATTERN = /&(?:nbsp|lt|gt|quot|#39|apos|amp);/gi;
export function plainNoteText(value) {
    const raw = asString(value) ?? '';
    if (raw === '')
        return '';
    return raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|li|div|h[1-6])\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(HTML_ENTITY_PATTERN, (match) => HTML_ENTITIES[match.toLowerCase()] ?? match)
        .trim();
}
export function truncateText(text, max) {
    return text.length > max
        ? { text: text.slice(0, max), truncated: true }
        : { text, truncated: false };
}
//# sourceMappingURL=normalize-context.js.map