/**
 * Shared argument validation for the model-facing tools. Domain constraints
 * the JSON schemas cannot express fail here with a typed argument error;
 * every message is model-facing and names the offending value.
 * @module dsh-zotero/tools/validate
 */
import type { ZoteroKind, ZoteroObjectRef, SupportedLocalLibrary } from '../types.js';
/** The item-ref format for read tools that serve personal and group libraries. */
export declare const REF_ARG_HINT = "zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY>";
/** Write tools are deliberately narrower: personal-library item refs only. */
export declare const WRITE_REF_ARG_HINT = "zotero://user/0/item/<KEY>";
/** Write collection refs share the same personal-library boundary. */
export declare const WRITE_COLLECTION_REF_ARG_HINT = "zotero://user/0/collection/<KEY>";
/** Throw an argument error; the message is model-facing. */
export declare function invalid(message: string): never;
/** The model-facing message for an integer argument outside `[min, max]`. */
export declare function intRangeArgumentMessage(name: string, value: number, min: number, max: number): string;
/**
 * Assert an optional free-text filter carries non-whitespace text, returning
 * its trimmed form. Browse facet filters route through here; search and
 * export keep their own messages (blank query is omitted, blank tags/style
 * name their domain), so this stays scoped to genuinely blank-is-invalid
 * filters rather than pretending to cover every tool.
 * @param name - the argument name shown in the message.
 * @param value - the raw argument value.
 * @returns the trimmed value.
 */
export declare function assertNonBlank(name: string, value: string): string;
/**
 * Assert an integer within `[min, max]`, naming the argument and its value.
 * @param name - the argument name shown in the message.
 * @param value - the candidate value.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 */
export declare function assertIntInRange(name: string, value: number, min: number, max: number): void;
/**
 * Assert a list argument is non-empty, failing with the caller's
 * model-facing message. The four explicit-empty rejections (children and
 * changes `include`, export `refs`, retrieve `sources`) share this check;
 * each keeps its own message because the messages name their domain.
 * @param values - the raw argument list.
 * @param message - the model-facing error when the list is empty.
 */
export declare function assertNonEmptyList(values: readonly unknown[], message: string): void;
/**
 * Parse a model-provided ref string and gate it on the supported local
 * libraries plus the allowed object kinds — the shared entry every tool
 * uses to turn a `zotero://` argument into a domain ref.
 * @param value - the raw ref string argument.
 * @param kinds - allowed kinds; omit to accept any parsed kind.
 * @throws {ZoteroError} `ZOTERO_INVALID_REF` outside the grammar or contract.
 */
export declare function parseSupportedRef(value: string, kinds?: readonly ZoteroKind[]): ZoteroObjectRef;
/**
 * Parse a ref for a write tool and reject a group target before the plan card.
 * The write domain repeats the personal-library check for direct callers.
 */
export declare function parseWritableRef(value: string, kinds: readonly ZoteroKind[]): ZoteroObjectRef;
/**
 * Assert an update tool's add/remove selection: both lists fit their bound
 * and carry no blank entries, the combined selection actually changes
 * something, and the combined length stays within the bound one call may
 * carry. The write domain enforces the same rules on its normalized lists.
 */
export declare function assertAddRemoveSelection(args: {
    add?: readonly string[];
    remove?: readonly string[];
}, maxItems: number): {
    add: string[];
    remove: string[];
};
/**
 * Assert a write list argument fits its bound and carries no blank entries,
 * returning the trimmed entries. Deduplication stays in the domain
 * (`normalizeWriteList`), so the plan card shows what the model asked for.
 */
export declare function assertWriteList(name: string, values: readonly string[], maxItems: number): string[];
/** The model-facing messages for the `library` argument's own rules. */
export declare const LIBRARY_TYPE_MESSAGE = "library.type must be user or group";
export declare const LIBRARY_ID_MESSAGE = "library.id must be integer";
export declare const PERSONAL_LIBRARY_MESSAGE = "Only user/0 is supported for personal library";
export declare const GROUP_ID_MESSAGE = "group id must be positive integer";
export declare const LIBRARY_REQUIRED_MESSAGE = "library is required here, as {type: \"user\"|\"group\", id}";
/**
 * Parse the optional `library` tool argument. Absent stays absent; a
 * malformed shape fails closed instead of silently defaulting.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT` on a non-local library shape.
 */
export declare function parseLibrary(value: unknown): SupportedLocalLibrary | undefined;
/**
 * Parse a `library` argument that has no meaningful absent case — a cursor's
 * library, for one: a value without one cannot say which counter its version
 * belongs to, so absence fails loud instead of defaulting.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT` when absent or malformed.
 */
export declare function requireLibrary(value: unknown): SupportedLocalLibrary;
//# sourceMappingURL=validate.d.ts.map