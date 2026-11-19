/**
 * JSON-tolerance guards shared by the normalizers: every external API value
 * enters the domain through these narrow reads, so a malformed field is
 * treated as absent instead of crashing or being mistyped.
 * @module dsh-zotero/json
 */
import { type JsonValue } from '@deepseek-ai/dsh-util-values';
/** Narrow any value to a plain JSON object, or undefined. */
export declare function asRecord(value: unknown): Record<string, unknown> | undefined;
/** True for plain objects (the validated shape every meta read requires). */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Narrow any value to a string, or undefined. */
export declare function asString(value: unknown): string | undefined;
/** Read a string field off a validated record. */
export declare function stringField(record: Record<string, unknown>, key: string): string | undefined;
/** Read a number field off a validated record (finite numbers only). */
export declare function numberField(record: Record<string, unknown>, key: string): number | undefined;
/** Read a boolean field off a validated record. */
export declare function boolField(record: Record<string, unknown>, key: string): boolean | undefined;
/** String entries of an array-shaped field; anything else yields nothing. */
export declare function stringArrayOf(value: unknown): string[];
/**
 * String entries of an array-shaped field, or undefined when the field is not
 * an array at all. The strict form matters wherever a field's *presence*
 * classifies a value rather than merely contributing to it: a browse row is a
 * collection because it carries `path`, and an empty `path` is still a
 * collection, so "no entries" and "not an array" cannot collapse.
 * @param value - candidate value to test.
 * @returns the string entries, or undefined when the value is not an array.
 */
export declare function asStringArray(value: unknown): string[] | undefined;
/** True only for a finite, non-negative safe integer carried as a JSON number. */
export declare function isNonNegativeSafeInteger(value: unknown): value is number;
/**
 * Parse a decimal HTTP-header counter. Empty, signed, fractional, non-finite,
 * and unsafe-integer spellings are all malformed rather than coerced to zero.
 */
export declare function parseNonNegativeSafeInteger(raw: string | null | undefined): number | undefined;
/** True when the string is a Zotero object key: 8 uppercase alphanumerics. */
export declare function isObjectKey(value: string): boolean;
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
export declare function asJsonValue(value: unknown): JsonValue | undefined;
//# sourceMappingURL=json.d.ts.map