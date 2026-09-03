/**
 * The `zotero://` ref grammar as regex sources, shared by the host parser
 * (`refs.ts`) and the client's text scanners (the Sources panel extracts refs
 * embedded in call-block args and results). One source so the two halves
 * cannot drift — a client-side copy that lags the host grammar silently drops
 * refs (the group-library forms) the tools legitimately emit. The captures
 * are named, so consumers read them by meaning instead of a positional index
 * that shifts with the grammar.
 * @module dsh-zotero/ref-grammar
 */

/** The object-key source: 8 uppercase alphanumerics. */
export const REF_KEY_SOURCE = '[A-Z0-9]{8}'

/**
 * The `links.attachment.href` key extractor: `/items/<KEY>` with a path
 * boundary, unanchored so query strings and fragments pass through.
 */
export const ATTACHMENT_HREF_PATTERN = new RegExp(`/items/(${REF_KEY_SOURCE})(?:[/?#]|$)`)

/**
 * One canonical Zotero relation path (`/users/<id>/items/<KEY>` or
 * `/groups/<id>/items/<KEY>`), trailing content allowed for the relation
 * forms Zotero serves.
 */
export const ZOTERO_USER_ITEM_PATH_PATTERN = new RegExp(
  `^/users/(\\d+)/items/(${REF_KEY_SOURCE})(?:[/?#].*)?$`,
)

/** The group-library form of {@link ZOTERO_USER_ITEM_PATH_PATTERN}. */
export const ZOTERO_GROUP_ITEM_PATH_PATTERN = new RegExp(
  `^/groups/(\\d+)/items/(${REF_KEY_SOURCE})(?:[/?#].*)?$`,
)

const LIBRARY = '(?<libraryType>user|group)/(?<libraryId>\\d+)'
const KINDS = '(?<kind>item|attachment|annotation|collection|search)'
const SERVER_QUALIFIER = '\\?server=(?<serverId>[A-Za-z0-9_-]{1,64})'

/** Full ref grammar, anchored: the whole string must be exactly one ref. */
export const REF_PATTERN = new RegExp(
  `^zotero://${LIBRARY}/${KINDS}/(?<key>${REF_KEY_SOURCE})(?:${SERVER_QUALIFIER})?$`,
)

/**
 * One ref embedded in longer text (tool args, results, prose): the
 * key-bearing prefix, unanchored. Provenance qualifiers are not matched —
 * key extraction only needs the object identity.
 */
export const REF_IN_TEXT_PATTERN = new RegExp(
  `zotero://${LIBRARY}/${KINDS}/(?<key>${REF_KEY_SOURCE})`,
)
