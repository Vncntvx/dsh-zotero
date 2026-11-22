/**
 * Common contracts, descriptors, and helpers shared across scholarly tools.
 * @module dsh-zotero/scholarly/tools/common
 */
import { spilledNoticeOf } from '../../spill.js';
/** One bounded, model-readable Scholarly receipt. Text remains the human rendering. */
export const SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            text: { type: 'string', required: true },
            papers: { type: 'array', items: { type: 'object', additionalProperties: true } },
            citations: { type: 'array', items: { type: 'object', additionalProperties: true } },
            checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            document: { type: 'object', additionalProperties: true },
            issues: { type: 'array', items: { type: 'string' } },
            spill: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    locator: { type: 'string', required: true },
                    bytes: { type: 'integer', required: true },
                    retrievalHint: { type: 'string', required: true },
                },
            },
        },
    },
    render: (_args, value) => {
        const text = value.text;
        // A result whose body does not already carry the handle gets the
        // persisted-spill notice: the complete content is at the locator, and the
        // byte count is stated in the harness spelling a spill-aware reader knows.
        const recovery = value.spill !== undefined && !text.includes(value.spill.locator)
            ? spilledNoticeOf(value.spill, value.spill.bytes)
            : '';
        return [{ type: 'text', text: `${text}${recovery}` }];
    },
};
/**
 * Recursively clean an object into pure JsonValue by removing undefined entries.
 */
function toCleanJsonValue(value) {
    if (value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.filter((v) => v !== undefined).map(toCleanJsonValue);
    }
    if (typeof value === 'object') {
        const res = {};
        for (const [k, v] of Object.entries(value)) {
            if (v !== undefined) {
                res[k] = toCleanJsonValue(v);
            }
        }
        return res;
    }
    return null;
}
export function toCleanJsonRecord(item) {
    return toCleanJsonValue(item);
}
export function toCleanJsonRecords(items) {
    return items.map(toCleanJsonRecord);
}
//# sourceMappingURL=common.js.map