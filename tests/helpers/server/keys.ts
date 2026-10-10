/**
 * The canonical identities every server fixture is built from.
 *
 * The suite had grown seven different objects named `ABCD1234` (a
 * `conferencePaper` in one spec, a `journalArticle` with two children in
 * another, a key-only stub in a malformed-payload test), so a reader could not
 * tell whether a difference between two tests was the point of one of them or
 * an accident of when it was written. `numChildren: 2` next to `numChildren: 3`
 * for the same key is exactly the drift that costs a debugging session.
 *
 * One key per role, declared once, is what makes a deviation visible: a spec
 * that needs a different shape spells the difference out in an override, next
 * to the test that needs it, instead of hiding it in a local object literal.
 * @module tests/helpers/server/keys
 */

import type {
  GroupLibrary,
  PersonalLibrary,
  SupportedLocalLibrary,
  ZoteroLibraryRef,
} from '../../../src/types.js'

/** The instance id every fixture response reports unless a test says otherwise. */
export const SERVER_ID = 'S1'

/** The group library the group-scoped specs use. */
export const GROUP_ID = 42

/** The canonical paper: the item most specs read, search for, and cite. */
export const ITEM_KEY = 'ABCD1234'

/** A second top-level item, for the specs that need two refs in one call. */
export const SECOND_ITEM_KEY = 'BBBB1234'

/** The canonical attachment: the PDF under {@link ITEM_KEY}. */
export const ATTACHMENT_KEY = 'WXYZ6789'

/** The canonical child note, a direct child of {@link ITEM_KEY}. */
export const NOTE_KEY = 'NOTE1111'

/**
 * The canonical annotation. Zotero stores annotations as children of the
 * attachment, never of the bibliographic item, so this one hangs off
 * {@link ATTACHMENT_KEY}.
 */
export const ANNOTATION_KEY = 'ANNO1111'

/** A standalone note item: a note that is not a child of anything. */
export const NOTE_ITEM_KEY = 'NOTE9999'

/** The canonical collection, `LLM Papers`. */
export const COLLECTION_KEY = 'COLL1234'

/** The canonical saved search, `Unread Papers`. */
export const SAVED_SEARCH_KEY = 'SRCH1234'

/**
 * The personal library, the default every fixture response is served under.
 * Typed as the domain's own `PersonalLibrary` rather than as a loose
 * `{type, id}` pair, so the fixture values can be passed straight into a
 * provider request without a cast: a cast at the call site is exactly where a
 * wrong library id would hide.
 */
export const PERSONAL_LIBRARY: PersonalLibrary = { type: 'user', id: 0 }

/** The group library {@link GROUP_ID} names. */
export const GROUP_LIBRARY: GroupLibrary = { type: 'group', id: GROUP_ID }

/**
 * The API path prefix for one library: `/api/users/0` or `/api/groups/42`.
 * `MockZotero.route` matches pathnames exactly, so every route registration
 * and every request assertion goes through here.
 */
export function apiPath(library: SupportedLocalLibrary = PERSONAL_LIBRARY): string {
  return library.type === 'user' ? `/api/users/${library.id}` : `/api/groups/${library.id}`
}

/**
 * A `zotero://` ref for one object, built from the key rather than from
 * `src/refs.ts`. The fixtures state the wire format independently of the code
 * that parses it: a ref helper that called `formatRef` would agree with a bug
 * in `formatRef` and pin nothing.
 *
 * The library is the wide `ZoteroLibraryRef`, not the supported subset: refs
 * naming a library this plugin refuses are exactly what several specs feed in
 * to prove the refusal, and a signature that could not express them would
 * force a cast at the call site.
 * @param kind - the object kind in the ref grammar.
 * @param key - the object key.
 * @param library - the library the ref names.
 * @returns the ref string.
 */
export function refOf(
  kind: string,
  key: string,
  library: ZoteroLibraryRef = PERSONAL_LIBRARY,
): string {
  const scope = library.type === 'user' ? `user/${library.id}` : `group/${library.id}`
  return `zotero://${scope}/${kind}/${key}`
}

/** The canonical paper's ref, as the tools and the model exchange it. */
export function itemRef(key: string = ITEM_KEY): string {
  return refOf('item', key)
}

/** An attachment ref. */
export function attachmentRef(key: string = ATTACHMENT_KEY): string {
  return refOf('attachment', key)
}

/** A collection ref. */
export function collectionRef(key: string = COLLECTION_KEY): string {
  return refOf('collection', key)
}

/** A saved-search ref. */
export function savedSearchRef(key: string = SAVED_SEARCH_KEY): string {
  return refOf('search', key)
}
