/**
 * Zotero object reference grammar.
 *
 * Model-facing refs are plain JSON strings of the form
 * `zotero://<libraryType>/<id>/<kind>/<key>` (e.g.
 * `zotero://user/0/item/ABCD1234`) with an optional provenance qualifier
 * `?server=<Zotero-Server-ID>` recorded by Zotero 10+. Zotero object keys are
 * 8 uppercase alphanumeric characters. The library segment makes identity
 * explicit: an object key is never treated as a global identity. Group
 * libraries parse here and are served by the local provider; foreign user
 * ids still fail closed (`requireSupportedLocalRef`).
 * @module dsh-zotero/refs
 */
import { PUBLICATIONS_GROUP_UNSUPPORTED_MESSAGE, writeLibraryUnsupportedMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_INVALID_REF, ZOTERO_UNEXPECTED, ZoteroError, } from './errors.js';
import { isObjectKey } from './json.js';
import { REF_PATTERN, ZOTERO_GROUP_ITEM_PATH_PATTERN, ZOTERO_USER_ITEM_PATH_PATTERN, } from './ref-grammar.js';
/** True when the given string matches the ref grammar without fully parsing it. */
export function isRefString(value) {
    return REF_PATTERN.test(value);
}
/** The model-facing message when a string is outside the ref grammar. */
export function invalidRefMessage(value) {
    return `Invalid Zotero reference "${value}". Expected zotero://user/0/<item|attachment|annotation|collection|search>/<KEY> with an 8-character key, optionally followed by ?server=<id>.`;
}
/** The model-facing message when a key is not 8 uppercase alphanumerics. */
function invalidRefKeyMessage(key) {
    return `Invalid Zotero key "${key}".`;
}
/**
 * The model-facing message for a library outside the local contract. Zotero's
 * local API serves the logged-in user and their groups, so a foreign user id
 * has no endpoint and is refused by name rather than rewritten.
 */
export function unsupportedLibraryMessage(library) {
    return `Unsupported library zotero://${library.type}/${library.id}: only user/0 and groups are supported.`;
}
/** The model-facing message for a non-zero user id: the canonical ref to use instead. */
export function foreignUserRefMessage(ref) {
    return `Use zotero://user/0/${ref.kind}/${ref.key}: the local API serves only the logged-in user's library (group libraries use zotero://group/<id>/...).`;
}
/** The model-facing message for a ref kind outside the caller's allowed set. */
export function expectedKindRefMessage(kinds, got) {
    return `Expected a ${kinds.join(' or ')} reference, got ${got}.`;
}
/**
 * Parse a model-provided ref string into a {@link ZoteroObjectRef}.
 * @param value - the exact string a tool argument or result carried.
 * @returns the parsed ref.
 * @throws {ZoteroError} `ZOTERO_INVALID_REF` for anything outside the grammar.
 */
export function parseRef(value) {
    const match = REF_PATTERN.exec(value);
    if (match === null || match.groups === undefined) {
        throw new ZoteroError(invalidRefMessage(value), ZOTERO_INVALID_REF);
    }
    const { libraryType, libraryId, kind, key, serverId } = match.groups;
    return {
        library: { type: libraryType, id: Number(libraryId) },
        kind: kind,
        key,
        serverId,
    };
}
/** Format a parsed ref back to its canonical string form. */
export function formatRef(ref) {
    const base = `zotero://${ref.library.type}/${ref.library.id}/${ref.kind}/${ref.key}`;
    return ref.serverId === undefined ? base : `${base}?server=${ref.serverId}`;
}
/** True when a library is one the local contract may address: personal canonical 0 or any group. */
export function isSupportedLocalLibrary(library) {
    if (library.type === 'user')
        return library.id === 0;
    // isSafeInteger (not just isInteger): over-long digit runs lose precision
    // in Number() at parse time, so an unsafe integer never names its digits.
    if (library.type === 'group')
        return Number.isSafeInteger(library.id) && library.id > 0;
    return false;
}
/** Build a URL prefix for a supported local library: users/0 or groups/{id}. */
export function libraryPrefix(library) {
    // Callers gate on requireSupportedLocalRef/isSupportedLocalLibrary first,
    // so user/0-vs-group here is total; the user arm pins users/0 even for a
    // hypothetical non-zero user id rather than interpolating it.
    if (library.type === 'user')
        return 'users/0';
    return `groups/${library.id}`;
}
/** True when both values name the same library (type and id). */
export function sameLibrary(a, b) {
    return a.type === b.type && a.id === b.id;
}
/** The personal library canonical constant for discovery endpoints. */
export const PERSONAL_LIBRARY = { type: 'user', id: 0 };
/** Intentional personal-only discovery prefix (only GET /users/0/groups uses it). */
export const PERSONAL_GROUPS_DISCOVERY = 'users/0/groups';
/** Build a ref for any supported local library. */
export function refForLibrary(library, kind, key, serverId) {
    if (!isObjectKey(key)) {
        throw new ZoteroError(invalidRefKeyMessage(key), ZOTERO_INVALID_REF);
    }
    if (!isSupportedLocalLibrary(library)) {
        throw new ZoteroError(unsupportedLibraryMessage(library), ZOTERO_INVALID_REF);
    }
    return { library: { type: library.type, id: library.id }, kind, key, serverId };
}
/**
 * Assert that a ref names a supported local library: user/0 or any group.
 * This is the provider-level contract (non-zero user ids fail closed).
 */
function assertSupportedLocalRef(ref) {
    if (!isSupportedLocalLibrary(ref.library)) {
        if (ref.library.type === 'user' && ref.library.id !== 0) {
            throw new ZoteroError(foreignUserRefMessage(ref), ZOTERO_INVALID_REF);
        }
        throw new ZoteroError(unsupportedLibraryMessage(ref.library), ZOTERO_INVALID_REF);
    }
    return ref;
}
/** Assert the ref kind is one of the allowed kinds. @param kinds - allowed kinds. */
function assertKind(ref, kinds) {
    if (!kinds.includes(ref.kind)) {
        throw new ZoteroError(expectedKindRefMessage(kinds, ref.kind), ZOTERO_INVALID_REF);
    }
    return ref;
}
/** Shared guard for provider use: supported local library, plus an optional kind filter. */
export function requireSupportedLocalRef(ref, kinds) {
    assertSupportedLocalRef(ref);
    if (kinds !== undefined)
        assertKind(ref, kinds);
    return ref;
}
/**
 * Assert the ref can be used by the write path: the supported local grammar,
 * an allowed object kind, and the canonical personal library. Tool argument
 * validation calls this before showing a plan; the write domain calls it again
 * for non-tool callers.
 */
export function requireWritableRef(ref, kinds) {
    if (!isObjectKey(ref.key)) {
        throw new ZoteroError(invalidRefKeyMessage(ref.key), ZOTERO_INVALID_REF);
    }
    requireSupportedLocalRef(ref, kinds);
    if (ref.library.type !== 'user' || ref.library.id !== 0) {
        throw new ZoteroError(writeLibraryUnsupportedMessage(ref.library), ZOTERO_INVALID_ARGUMENT);
    }
    return ref;
}
/**
 * Parse a Zotero canonical relation URI (http://zotero.org/users|groups/.../items/KEY)
 * into a library+key pair. Returns null for non-Zotero, malformed, or non-item URIs.
 * This never canonicalizes foreign user ids to user/0; the caller decides whether
 * a mapping is provable.
 */
export function parseZoteroRelationUri(uri) {
    let url;
    try {
        url = new URL(uri);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'zotero.org' && host !== 'www.zotero.org' && host !== 'api.zotero.org')
        return null;
    const m = ZOTERO_USER_ITEM_PATH_PATTERN.exec(url.pathname);
    if (m)
        return { library: { type: 'user', id: Number(m[1]) }, key: m[2] };
    const mg = ZOTERO_GROUP_ITEM_PATH_PATTERN.exec(url.pathname);
    if (mg)
        return { library: { type: 'group', id: Number(mg[1]) }, key: mg[2] };
    return null;
}
/**
 * The canonical relation URI for a supported-local source ref. The user arm
 * pins `users/0` even for a hypothetical non-zero user id rather than
 * interpolating it, mirroring {@link libraryPrefix}: the local contract
 * addresses the logged-in user's library as `users/0`, and callers gate on
 * `requireSupportedLocalRef` first, so a non-zero user id never reaches here.
 */
export function formatZoteroRelationUri(ref) {
    if (ref.library.type === 'group') {
        return `http://zotero.org/groups/${ref.library.id}/items/${ref.key}`;
    }
    return `http://zotero.org/users/0/items/${ref.key}`;
}
/**
 * The local ref string a relation URI provably names, or undefined when the
 * mapping cannot be proven, in which case the caller keeps the bare URI. Group ids are
 * never aliased, but they still map only within the containing library
 * (or the write echo, where group targets are explicit cross-library refs).
 * User URIs map when the id is the canonical `0`, the proven sync alias
 * (`parentLibraryId`, `personalContext`): a foreign user id never maps,
 * because it would resolve the same key against the wrong library.
 * @param uri - the relation target URI from Zotero `data.relations`.
 * @param serverId - the serving instance recorded as ref provenance.
 */
export function relationTargetRef(uri, serverId, options = {}) {
    const parsed = parseZoteroRelationUri(uri);
    if (parsed === null)
        return undefined;
    if (!isObjectKey(parsed.key))
        return undefined;
    if (parsed.library.type === 'group') {
        if (!Number.isSafeInteger(parsed.library.id) || parsed.library.id <= 0)
            return undefined;
        if (options.personalContext === true) {
            return formatRef(refForLibrary({ type: 'group', id: parsed.library.id }, 'item', parsed.key, serverId));
        }
        const library = options.library;
        if (library !== undefined && library.type === 'group' && parsed.library.id === library.id) {
            return formatRef(refForLibrary(library, 'item', parsed.key, serverId));
        }
        return undefined;
    }
    if (parsed.library.id === 0) {
        return formatRef(refForLibrary(PERSONAL_LIBRARY, 'item', parsed.key, serverId));
    }
    if (options.personalContext === true) {
        return formatRef(refForLibrary(PERSONAL_LIBRARY, 'item', parsed.key, serverId));
    }
    if (options.parentLibraryId !== undefined && parsed.library.id === options.parentLibraryId) {
        return formatRef(refForLibrary(PERSONAL_LIBRARY, 'item', parsed.key, serverId));
    }
    return undefined;
}
/**
 * Ensure the library is supported for My Publications (personal libraries only).
 * Policy lives here next to `isSupportedLocalLibrary`; the message stays in
 * `errors.ts` with the other model-facing strings.
 */
export function assertPublicationsSupported(library) {
    if (library?.type === 'group') {
        throw new ZoteroError(PUBLICATIONS_GROUP_UNSUPPORTED_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
}
/**
 * The supported local library a ref string provably names, or undefined when
 * the string does not parse or names an unsupported library. Single authority
 * for the `library`/`publications` fast path plus the `parseRef` +
 * `isSupportedLocalLibrary` composition the resolved-scope readers share.
 * Group ids pass through, personal aliases collapse to canonical `user/0`.
 */
export function supportedLibraryOfRef(value) {
    let parsed;
    try {
        parsed = parseRef(value);
    }
    catch {
        return undefined;
    }
    if (!isSupportedLocalLibrary(parsed.library))
        return undefined;
    if (parsed.library.type === 'group')
        return { type: 'group', id: parsed.library.id };
    return { type: 'user', id: 0 };
}
/**
 * Require the supported local library a resolved scope ref names. Unlike the
 * fail-open projection helper above, a scope produced by `resolveScope` must
 * always resolve: an unparseable or unsupported ref is a broken invariant,
 * and answering it from the personal library would attribute another
 * library's rows to this scope.
 */
export function requireSupportedLibraryOfRef(value) {
    const library = supportedLibraryOfRef(value);
    if (library === undefined) {
        throw new ZoteroError(`Resolved scope carries a ref outside the local contract: ${value}.`, ZOTERO_UNEXPECTED);
    }
    return library;
}
//# sourceMappingURL=refs.js.map