/**
 * Shared argument validation for the model-facing tools. Domain constraints
 * the JSON schemas cannot express fail here with a typed argument error;
 * every message is model-facing and names the offending value.
 * @module dsh-zotero/tools/validate
 */
import { WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT, writeListTooLongMessage, writeNonBlankMessage, ZoteroError, } from '../errors.js';
import { parseRef, requireSupportedLocalRef, requireWritableRef } from '../refs.js';
/** The item-ref format for read tools that serve personal and group libraries. */
export const REF_ARG_HINT = 'zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY>';
/** Write tools are deliberately narrower: personal-library item refs only. */
export const WRITE_REF_ARG_HINT = 'zotero://user/0/item/<KEY>';
/** Write collection refs share the same personal-library boundary. */
export const WRITE_COLLECTION_REF_ARG_HINT = 'zotero://user/0/collection/<KEY>';
/** Throw an argument error; the message is model-facing. */
export function invalid(message) {
    throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT);
}
/** The model-facing message for an integer argument outside `[min, max]`. */
export function intRangeArgumentMessage(name, value, min, max) {
    return `${name} must be an integer between ${min} and ${max}; got ${value}`;
}
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
export function assertNonBlank(name, value) {
    const trimmed = value.trim();
    if (trimmed === '')
        invalid(writeNonBlankMessage(name));
    return trimmed;
}
/**
 * Assert an integer within `[min, max]`, naming the argument and its value.
 * @param name - the argument name shown in the message.
 * @param value - the candidate value.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 */
export function assertIntInRange(name, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        invalid(intRangeArgumentMessage(name, value, min, max));
    }
}
/**
 * Assert a list argument is non-empty, failing with the caller's
 * model-facing message. The four explicit-empty rejections (children and
 * changes `include`, export `refs`, retrieve `sources`) share this check;
 * each keeps its own message because the messages name their domain.
 * @param values - the raw argument list.
 * @param message - the model-facing error when the list is empty.
 */
export function assertNonEmptyList(values, message) {
    if (values.length === 0)
        invalid(message);
}
/**
 * Parse a model-provided ref string and gate it on the supported local
 * libraries plus the allowed object kinds — the shared entry every tool
 * uses to turn a `zotero://` argument into a domain ref.
 * @param value - the raw ref string argument.
 * @param kinds - allowed kinds; omit to accept any parsed kind.
 * @throws {ZoteroError} `ZOTERO_INVALID_REF` outside the grammar or contract.
 */
export function parseSupportedRef(value, kinds) {
    return requireSupportedLocalRef(parseRef(value), kinds);
}
/**
 * Parse a ref for a write tool and reject a group target before the plan card.
 * The write domain repeats the personal-library check for direct callers.
 */
export function parseWritableRef(value, kinds) {
    return requireWritableRef(parseRef(value), kinds);
}
/**
 * Assert an update tool's add/remove selection: both lists fit their bound
 * and carry no blank entries, the combined selection actually changes
 * something, and the combined length stays within the bound one call may
 * carry. The write domain enforces the same rules on its normalized lists.
 */
export function assertAddRemoveSelection(args, maxItems) {
    const add = args.add === undefined ? [] : assertWriteList('add', args.add, maxItems);
    const remove = args.remove === undefined ? [] : assertWriteList('remove', args.remove, maxItems);
    if (add.length + remove.length === 0)
        invalid(WRITE_LIST_SELECTION_MESSAGE);
    if (add.length + remove.length > maxItems) {
        invalid(writeListTooLongMessage('add and remove', maxItems));
    }
    return { add, remove };
}
/**
 * Assert a write list argument fits its bound and carries no blank entries,
 * returning the trimmed entries. Deduplication stays in the domain
 * (`normalizeWriteList`), so the plan card shows what the model asked for.
 */
export function assertWriteList(name, values, maxItems) {
    if (values.length > maxItems) {
        invalid(writeListTooLongMessage(name, maxItems));
    }
    return values.map((value) => assertNonBlank(name, value));
}
/** The model-facing messages for the `library` argument's own rules. */
export const LIBRARY_TYPE_MESSAGE = 'library.type must be user or group';
export const LIBRARY_ID_MESSAGE = 'library.id must be integer';
export const PERSONAL_LIBRARY_MESSAGE = 'Only user/0 is supported for personal library';
export const GROUP_ID_MESSAGE = 'group id must be positive integer';
export const LIBRARY_REQUIRED_MESSAGE = 'library is required here, as {type: "user"|"group", id}';
/**
 * Parse the optional `library` tool argument. Absent stays absent; a
 * malformed shape fails closed instead of silently defaulting.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT` on a non-local library shape.
 */
export function parseLibrary(value) {
    if (value === undefined || value === null)
        return undefined;
    const rec = value;
    const type = rec.type;
    const id = rec.id;
    if (type !== 'user' && type !== 'group')
        invalid(LIBRARY_TYPE_MESSAGE);
    if (!Number.isSafeInteger(id))
        invalid(LIBRARY_ID_MESSAGE);
    if (type === 'user' && id !== 0)
        invalid(PERSONAL_LIBRARY_MESSAGE);
    if (type === 'group' && id <= 0)
        invalid(GROUP_ID_MESSAGE);
    return { type: type, id: id };
}
/**
 * Parse a `library` argument that has no meaningful absent case — a cursor's
 * library, for one: a value without one cannot say which counter its version
 * belongs to, so absence fails loud instead of defaulting.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT` when absent or malformed.
 */
export function requireLibrary(value) {
    const library = parseLibrary(value);
    if (library === undefined) {
        invalid(LIBRARY_REQUIRED_MESSAGE);
    }
    return library;
}
//# sourceMappingURL=validate.js.map