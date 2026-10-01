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
import type { SupportedLocalLibrary, ZoteroKind, ZoteroObjectRef } from './types.js';
/** True when the given string matches the ref grammar without fully parsing it. */
export declare function isRefString(value: string): boolean;
/** The model-facing message when a string is outside the ref grammar. */
export declare function invalidRefMessage(value: string): string;
/** The model-facing message when a key is not 8 uppercase alphanumerics. */
export declare function invalidRefKeyMessage(key: string): string;
/**
 * The model-facing message for a library outside the local contract. Zotero's
 * local API serves the logged-in user and their groups, so a foreign user id
 * has no endpoint and is refused by name rather than rewritten.
 */
export declare function unsupportedLibraryMessage(library: {
    type: string;
    id: number;
}): string;
/** The model-facing message for a non-zero user id: the canonical ref to use instead. */
export declare function foreignUserRefMessage(ref: ZoteroObjectRef): string;
/** The model-facing message for a ref kind outside the caller's allowed set. */
export declare function expectedKindRefMessage(kinds: readonly ZoteroKind[], got: string): string;
/**
 * Parse a model-provided ref string into a {@link ZoteroObjectRef}.
 * @param value - the exact string a tool argument or result carried.
 * @returns the parsed ref.
 * @throws {ZoteroError} `ZOTERO_INVALID_REF` for anything outside the grammar.
 */
export declare function parseRef(value: string): ZoteroObjectRef;
/** Format a parsed ref back to its canonical string form. */
export declare function formatRef(ref: ZoteroObjectRef): string;
/** True when a library is one the local contract may address: personal canonical 0 or any group. */
export declare function isSupportedLocalLibrary(library: {
    type: string;
    id: number;
}): boolean;
/** Build a URL prefix for a supported local library: users/0 or groups/{id}. */
export declare function libraryPrefix(library: {
    type: 'user' | 'group';
    id: number;
}): string;
/** True when both values name the same library (type and id). */
export declare function sameLibrary(a: {
    type: 'user' | 'group';
    id: number;
}, b: {
    type: 'user' | 'group';
    id: number;
}): boolean;
/** The personal library canonical constant for discovery endpoints. */
export declare const PERSONAL_LIBRARY: {
    readonly type: 'user';
    readonly id: 0;
};
/** Intentional personal-only discovery prefix (only GET /users/0/groups uses it). */
export declare const PERSONAL_GROUPS_DISCOVERY = "users/0/groups";
/** Build a ref for any supported local library. */
export declare function refForLibrary(library: {
    type: 'user' | 'group';
    id: number;
}, kind: ZoteroKind, key: string, serverId?: string): ZoteroObjectRef;
/** Shared guard for provider use: supported local library, plus an optional kind filter. */
export declare function requireSupportedLocalRef(ref: ZoteroObjectRef, kinds?: readonly ZoteroKind[]): ZoteroObjectRef;
/**
 * Assert the ref can be used by the write path: the supported local grammar,
 * an allowed object kind, and the canonical personal library. Tool argument
 * validation calls this before showing a plan; the write domain calls it again
 * for non-tool callers.
 */
export declare function requireWritableRef(ref: ZoteroObjectRef, kinds?: readonly ZoteroKind[]): ZoteroObjectRef;
/**
 * Parse a Zotero canonical relation URI (http://zotero.org/users|groups/.../items/KEY)
 * into a library+key pair. Returns null for non-Zotero, malformed, or non-item URIs.
 * This never canonicalizes foreign user ids to user/0 — caller decides if mapping is provable.
 */
export declare function parseZoteroRelationUri(uri: string): {
    library: {
        type: 'user' | 'group';
        id: number;
    };
    key: string;
} | null;
/**
 * The canonical relation URI for a supported-local source ref. The user arm
 * pins `users/0` even for a hypothetical non-zero user id rather than
 * interpolating it — mirroring {@link libraryPrefix}: the local contract
 * addresses the logged-in user's library as `users/0`, and callers gate on
 * `requireSupportedLocalRef` first, so a non-zero user id never reaches here.
 */
export declare function formatZoteroRelationUri(ref: Pick<ZoteroObjectRef, 'library' | 'key'>): string;
export interface RelationTargetOptions {
    /**
     * The library containing the object whose relations these are. Group item
     * URIs map only to this same group — a relation to another group stays a
     * bare URI, so a target ref never implies locality its read did not have.
     * Omitted with `personalContext` (the write echo) to allow group targets.
     */
    readonly library?: SupportedLocalLibrary;
    /**
     * The containing object is provably in the personal library (e.g. a note
     * the write domain just created under `users/0`) and this call only ever
     * sends `users/0` outbound, so any `users/<id>` echo is Zotero's
     * server-side canonicalization of that same `users/0` to the real numeric
     * sync id — the alias is provable by context, not by matching the digits.
     * Group targets are addressable cross-library refs and map as well.
     */
    readonly personalContext?: boolean;
    /**
     * The containing record's real library id (`record.library.id`), when the
     * read knows it: a `users/<id>` URI with this id is the personal library's
     * sync alias and maps to `user/0`.
     */
    readonly parentLibraryId?: number;
}
/**
 * The local ref string a relation URI provably names, or undefined when the
 * mapping cannot be proven — the caller keeps the bare URI. Group ids are
 * never aliased, but they still map only within the containing library
 * (or the write echo, where group targets are explicit cross-library refs).
 * User URIs map when the id is the canonical `0`, the proven sync alias
 * (`parentLibraryId`, `personalContext`): a foreign user id never maps,
 * because it would resolve the same key against the wrong library.
 * @param uri - the relation target URI from Zotero `data.relations`.
 * @param serverId - the serving instance recorded as ref provenance.
 */
export declare function relationTargetRef(uri: string, serverId: string | undefined, options?: RelationTargetOptions): string | undefined;
/**
 * Ensure the library is supported for My Publications (personal libraries only).
 * Policy lives here next to `isSupportedLocalLibrary`; the message stays in
 * `errors.ts` with the other model-facing strings.
 */
export declare function assertPublicationsSupported(library: SupportedLocalLibrary | undefined): void;
/**
 * The supported local library a ref string provably names, or undefined when
 * the string does not parse or names an unsupported library. Single authority
 * for the `library`/`publications` fast path plus the `parseRef` +
 * `isSupportedLocalLibrary` composition the resolved-scope readers share —
 * group ids pass through, personal aliases collapse to canonical `user/0`.
 */
export declare function supportedLibraryOfRef(value: string): SupportedLocalLibrary | undefined;
/**
 * Require the supported local library a resolved scope ref names. Unlike the
 * fail-open projection helper above, a scope produced by `resolveScope` must
 * always resolve — an unparseable or unsupported ref is a broken invariant,
 * and answering it from the personal library would attribute another
 * library's rows to this scope.
 */
export declare function requireSupportedLibraryOfRef(value: string): SupportedLocalLibrary;
//# sourceMappingURL=refs.d.ts.map