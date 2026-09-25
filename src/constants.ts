/**
 * Runtime constants of the Zotero domain. Kept out of `types.ts` so that
 * module stays types-only. `ZOTERO_SORT_FIELDS` is typed against the
 * `ZoteroSortField` union in `types.ts`, so the two cannot drift — the
 * typecheck rejects a field absent from the union and a union member absent
 * from the array; `tests/refs.spec.ts` additionally pins the exact array
 * because the search tool's `sort` enum derives from it.
 * @module dsh-zotero/constants
 */

import type { ZoteroSortField } from './types.js'

/** The id the built-in local provider registers under; also the provider config default. */
export const LOCAL_PROVIDER_ID = 'local'

/**
 * The Local API version this plugin speaks, sent as `Zotero-API-Version` on
 * every request. Zotero 10 implements version 3 and answers another value
 * with 501; the plugin names this version in its errors rather than
 * repeating the literal.
 */
export const ZOTERO_LOCAL_API_VERSION = '3'

/** The response header naming the Local API version the answering build speaks. */
export const ZOTERO_API_VERSION_HEADER = 'zotero-api-version'

/** The Local API response/request header carrying the serving instance identity. */
export const ZOTERO_SERVER_ID_HEADER = 'zotero-server-id'

/**
 * The header naming the answering Zotero build (`10.0.2-beta.9+c77df79af`).
 * Sent on every response, errors included, and the only one of the three
 * version headers that distinguishes releases: `Zotero-API-Version` is 3 on
 * every build that speaks API v3, and `Zotero-Schema-Version` moves with
 * Zotero's data schema rather than with the release.
 */
export const ZOTERO_VERSION_HEADER = 'x-zotero-version'

/** The sort fields `zotero_search` accepts, in Zotero's own vocabulary. */
export const ZOTERO_SORT_FIELDS: readonly ZoteroSortField[] = [
  'dateModified',
  'dateAdded',
  'date',
  'title',
  'creator',
] as const

/** `zotero_search` argument defaults; the tool and the corpus's pagination-fold identity share them. */
export const SEARCH_DEFAULT_MODE = 'metadata'
export const SEARCH_DEFAULT_SCOPE = { kind: 'library' } as const
export const SEARCH_DEFAULT_SORT = 'dateModified'
export const SEARCH_DEFAULT_DIRECTION = 'desc'
export const SEARCH_DEFAULT_OFFSET = 0
export const SEARCH_DEFAULT_LIMIT = 10

/**
 * The Local API's hard per-request cap for the `itemKey=` query parameter.
 * `zotero_export` batches citation requests to this size; the batch-breaking
 * formats (bibliography and the translators) refuse to exceed it, because
 * their global ordering belongs to Zotero, not to the caller.
 */
export const ZOTERO_ITEMKEY_BATCH = 50

/**
 * The bounded concurrency of the per-document export requests a translator
 * export issues against the Local API. A pool — not a bare `Promise.all` —
 * keeps the in-flight single-item requests small, so a full 50-ref export
 * cannot storm the local server.
 */
export const ZOTERO_EXPORT_CONCURRENCY = 4

/**
 * The bounded concurrency of the parent-item attribution queries the search
 * domain issues in `ZOTERO_ITEMKEY_BATCH`-sized chunks. A pool — not a bare
 * `Promise.all` — keeps the in-flight membership requests small. Kept apart
 * from `ZOTERO_EXPORT_CONCURRENCY` (same value, different blast radius) so
 * tuning export throughput never silently retunes search attribution.
 */
export const ZOTERO_SEARCH_CONCURRENCY = 4

/**
 * The bounded concurrency of multi-attachment full-text reads in retrieve
 * (`allIndexed` / `specified` policies). A pool — not a bare `Promise.all` —
 * keeps the in-flight attachment requests small. Annotation children use the
 * single `?itemType=annotation` listing instead of a per-attachment fan-out.
 */
export const ZOTERO_GRAPH_CONCURRENCY = 4

/** How long a scope listing (collections/searches) is trusted before a re-fetch. */
export const ZOTERO_SCOPE_LISTING_TTL_MS = 30_000

/**
 * How many Zotero data requests one plugin instance keeps in flight. Each
 * domain pool bounds its own fan-out at 4, but pools multiply with every
 * concurrent tool call, so the HTTP client holds this process-wide slot
 * count as the real bound on what Zotero is asked to serve at once. Twice a
 * pool: two calls run at full width, and a burst of calls queues instead of
 * stacking its requests on the local server.
 */
export const ZOTERO_MAX_INFLIGHT_REQUESTS = 8

/**
 * The write transport keeps exactly one request in flight. Zotero stamps the
 * library version per committed object, and the plugin's tag/collection
 * updates are read-modify-write cycles — an overlapping write could interleave
 * with another call's read and make both sides lose their version
 * preconditions. Serialization is the point, not a tuning knob.
 */
export const ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS = 1

/**
 * The Local API's hard cap on objects per write batch (`MAX_WRITE_OBJECTS`,
 * `server_localAPI.js:95` at Zotero 10.0.2). The write domain refuses a
 * longer batch before the network, and the tool schemas cap `maxItems` at the
 * same number, so a 413 from Zotero can only mean protocol drift.
 */
export const ZOTERO_WRITE_OBJECT_BATCH = 50

/**
 * The write-response header carrying the library version a write advanced
 * to (`Last-Modified-Version`). Zotero stamps written objects with that same
 * library version, so it doubles as the written object's version.
 */
export const ZOTERO_LIBRARY_VERSION_HEADER = 'last-modified-version'

/**
 * The three personal-library write tools. One list for the capability
 * surface, the model-facing policy, and the shell-write detector's audit
 * copy — a rename or a fourth write tool must not leave any of those three
 * telling the user a different set.
 */
export const WRITE_TOOL_NAMES = [
  'zotero_create_note',
  'zotero_add_tags',
  'zotero_add_to_collection',
] as const

/**
 * The Local API path that exists only to issue write keys. The write
 * transport joins it onto `/api/`; the shell-write detector matches the same
 * spelling in command text so both sides recognize one endpoint.
 */
export const ZOTERO_AUTHORIZE_PATH = 'local/authorize'

/**
 * Markdown character budget for one `zotero_create_note` call. The converted
 * HTML rides back inside the batch's successful bucket (bounded by
 * maxResponseBytes); this bound keeps one pathological note from dominating
 * a batch before conversion ever runs.
 */
export const ZOTERO_WRITE_NOTE_MAX_CHARS = 65_536

/**
 * Per-list bound for the write tools' array arguments (tags, collections,
 * source refs) — the same scale as the write batch cap, so one call can
 * never fan out into many protocol batches.
 */
export const ZOTERO_WRITE_LIST_MAX_ITEMS = 50

/**
 * The deadline for one `/api/local/authorize` request. Zotero shows its
 * authorization dialog for that request and the user answers it in person,
 * so the budget covers a human reading the dialog — deliberately far above
 * the per-request data deadline, which must not apply here.
 */
export const ZOTERO_WRITE_AUTHORIZE_DEADLINE_MS = 120_000

/**
 * How many attachments one `zotero_retrieve` call may rank full text from.
 * Each member costs a metadata read and a full-text read, and all of their
 * text enters one ranking — a bound on the call's own work, not on what a
 * work may have. `specified` rejects a longer list (the caller splits the
 * call); `allIndexed` reads the first entries in its selection order and
 * reports the rest as unread.
 */
export const ZOTERO_RETRIEVE_ATTACHMENT_CAP = 16
