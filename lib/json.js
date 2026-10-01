/**
 * JSON-tolerance guards shared by the normalizers: every external API value
 * enters the domain through these narrow reads, so a malformed field is
 * treated as absent instead of crashing or being mistyped.
 * @module dsh-zotero/json
 */
import { isJsonValue } from '@deepseek-ai/dsh-util-values';
import { REF_KEY_SOURCE } from './ref-grammar.js';
const OBJECT_KEY_PATTERN = new RegExp(`^${REF_KEY_SOURCE}$`);
/** Narrow any value to a plain JSON object, or undefined. */
export function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/** True for plain objects (the validated shape every meta read requires). */
export function isRecord(value) {
    return asRecord(value) !== undefined;
}
/** Narrow any value to a string, or undefined. */
export function asString(value) {
    return typeof value === 'string' ? value : undefined;
}
/** Read a string field off a validated record. */
export function stringField(record, key) {
    return asString(record[key]);
}
/** Read a number field off a validated record (finite numbers only). */
export function numberField(record, key) {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Read a boolean field off a validated record. */
export function boolField(record, key) {
    const value = record[key];
    return typeof value === 'boolean' ? value : undefined;
}
/** String entries of an array-shaped field; anything else yields nothing. */
export function stringArrayOf(value) {
    return asStringArray(value) ?? [];
}
/**
 * String entries of an array-shaped field, or undefined when the field is not
 * an array at all. The strict form matters wherever a field's *presence*
 * classifies a value rather than merely contributing to it — a browse row is
 * a collection because it carries `path`, and an empty `path` is still a
 * collection, so "no entries" and "not an array" cannot collapse.
 * @param value - candidate value to test.
 * @returns the string entries, or undefined when the value is not an array.
 */
export function asStringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : undefined;
}
/** True only for a finite, non-negative safe integer carried as a JSON number. */
export function isNonNegativeSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
/**
 * Parse a decimal HTTP-header counter. Empty, signed, fractional, non-finite,
 * and unsafe-integer spellings are all malformed rather than coerced to zero.
 */
export function parseNonNegativeSafeInteger(raw) {
    if (raw === null || raw === undefined)
        return undefined;
    const text = raw.trim();
    if (!/^\d+$/.test(text))
        return undefined;
    const value = Number(text);
    return isNonNegativeSafeInteger(value) ? value : undefined;
}
/** True when the string is a Zotero object key: 8 uppercase alphanumerics. */
export function isObjectKey(value) {
    return OBJECT_KEY_PATTERN.test(value);
}
/**
 * Narrow any value to a lossless-JSON value, or undefined. Single entry point
 * over the harness's `isJsonValue` (which reports boolean, not a predicate),
 * so callers never repeat the `as JsonValue` narrowing comment. `isJsonValue`
 * validates without detaching, so the returned reference aliases the input's
 * sub-objects by design: all callers pass freshly parsed, single-owner API
 * payloads (the tool pipeline snapshots again downstream), and avoiding a deep
 * copy here keeps the normalizers allocation-free on the hot path.
 * @param value - candidate value to test.
 * @returns the value as lossless JSON, or undefined when it cannot round-trip.
 */
export function asJsonValue(value) {
    return isJsonValue(value) ? value : undefined;
}
//# sourceMappingURL=json.js.map