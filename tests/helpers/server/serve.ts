/**
 * Route installers for the mocked Local API.
 *
 * The specs used to register the same canonical responses inline, over and
 * over: the retrieval parent alone was written out 35 times, the search hit 26
 * times, the export item 26 times. Each repetition was a chance for one of
 * them to drift, and a reader could not tell a deliberate variation from a
 * copy-paste edit.
 *
 * Three conventions run through this module:
 *
 * - An **absent** field takes the canonical default.
 * - A **`null`** field means "serve nothing here", so a test that depends on an
 *   endpoint answering 404 says so explicitly instead of relying on nobody
 *   having registered it.
 * - A body or header that must **change between requests** is not expressible
 *   here, because these installers capture what they are given. Those routes
 *   call `mock.route` directly: a profile that switches mid-test is the
 *   subject of its test and reads better as a handler than as an option.
 *
 * Payloads that are deliberately malformed stay inline for the same reason —
 * a keyless row or a non-array listing is not an object the builders model.
 * @module tests/helpers/server/serve
 */

import type { MockZotero } from '../mock-zotero.js'
import type { SupportedLocalLibrary } from '../../../src/types.js'
import { ATTACHMENT_KEY, SERVER_ID, apiPath, PERSONAL_LIBRARY } from './keys.js'
import {
  annotationRow,
  attachment,
  collectionRow,
  noteRow,
  paperItem,
  versionHeaders,
  type WireObject,
} from './objects.js'

/**
 * A 200 JSON answer, with optional headers. The path may be a pattern, which
 * is how a listing that answers both `/items` and `/items/top` is served.
 * @param mock - the server to register on.
 * @param path - the pathname or pattern to answer.
 * @param body - the JSON body.
 * @param headers - the response headers; absent means none.
 */
export function serveJson(
  mock: MockZotero,
  path: string | RegExp,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  mock.route('GET', path, (req, res, helpers) => helpers.json(body, headers))
}

/**
 * A 200 plain-text answer. The Local API serves a few resources as text
 * rather than JSON — the attachment file URL among them — and a test that
 * served those as JSON would exercise a different branch than the real one.
 * @param mock - the server to register on.
 * @param path - the pathname or pattern to answer.
 * @param body - the text body.
 * @param headers - the response headers; absent means none.
 */
export function serveText(
  mock: MockZotero,
  path: string | RegExp,
  body: string,
  headers: Record<string, string> = {},
): void {
  mock.route('GET', path, (req, res, helpers) => helpers.text(body, headers))
}

/** A non-200 answer with a plain-text body, for the failure paths. */
export function serveStatus(
  mock: MockZotero,
  path: string | RegExp,
  status: number,
  body = '',
): void {
  mock.route('GET', path, (req, res, helpers) =>
    helpers.raw(status, { 'Content-Type': 'text/plain' }, body),
  )
}

/**
 * Which parts of the item graph a test wants served. `null` leaves that route
 * unregistered. Handlers encode the real Local API partition: a bare
 * `/children` listing never carries annotation rows; annotations appear only
 * under `?itemType=annotation`.
 */
export interface ItemGraphSpec {
  /** The item itself; defaults to the canonical paper. */
  readonly parent?: WireObject
  /** The attachment read as an item in its own right, when the walk needs it; defaults to the canonical PDF. */
  readonly attachmentItem?: WireObject | null
  /** DIRECT children — notes and attachments only; defaults to one of each. Never annotations. */
  readonly children?: readonly WireObject[] | null
  /** Annotations served only under `?itemType=annotation`; defaults to one. */
  readonly annotations?: readonly WireObject[] | null
  /**
   * Annotations returned for the **parent** key under the filter. Defaults to
   * `annotations` — the Local API expands a bibliographic item's filtered
   * listing to annotations under its attachments.
   */
  readonly parentAnnotations?: readonly WireObject[] | null
  /** The collections listing that resolves `data.collections` names; defaults to the canonical collection. */
  readonly collections?: readonly WireObject[] | null
  /** The instance the answers claim; `null` omits the header, for the builds that report none. */
  readonly serverId?: string | null
  /** The library the routes are served under. */
  readonly library?: SupportedLocalLibrary
}

/**
 * The key of the attachment one parent points at. Zotero's item read carries
 * the attachment as a link, and filtered annotation listings hang off that
 * key, so the graph follows the link rather than assuming the canonical PDF.
 * @param parent - the parent whose attachment link to read.
 * @returns the attachment key.
 */
function pdfKeyOf(parent: WireObject): string {
  const link = parent.links?.attachment as { href?: string } | undefined
  const key = link?.href?.split('/').pop()
  return key === undefined || key === '' ? ATTACHMENT_KEY : key
}

/**
 * Serve one item and its child-object contracts the way Zotero partitions
 * them: the item; notes/attachments on a bare `/children` listing; and
 * annotations only under `?itemType=annotation` for the parent key and for
 * the attachment key. A bare listing of the attachment stays unregistered,
 * so a regression that requests it fails the spec instead of silently
 * receiving mock annotations.
 * @param mock - the server to register on.
 * @param spec - which parts to serve and under which instance.
 */
export function serveItemGraph(mock: MockZotero, spec: ItemGraphSpec = {}): void {
  const library = spec.library ?? PERSONAL_LIBRARY
  const prefix = apiPath(library)
  const parent = spec.parent ?? paperItem()
  // One key drives both annotation routes: the item read and the filtered
  // listing must agree on which PDF the graph is about.
  const pdfKey = spec.attachmentItem?.key ?? pdfKeyOf(parent)
  const attachmentItem =
    spec.attachmentItem === undefined ? attachment({ key: pdfKey }) : spec.attachmentItem
  const children = spec.children === undefined ? [noteRow(), attachment()] : spec.children
  const annotations = spec.annotations === undefined ? [annotationRow()] : spec.annotations
  const parentAnnotations =
    spec.parentAnnotations === undefined ? annotations : spec.parentAnnotations
  const collections = spec.collections === undefined ? [collectionRow()] : spec.collections
  const headers = spec.serverId === null ? {} : versionHeaders(spec.serverId ?? SERVER_ID)

  serveJson(mock, `${prefix}/items/${parent.key}`, parent, headers)
  if (attachmentItem !== null) {
    serveJson(mock, `${prefix}/items/${pdfKey}`, attachmentItem, headers)
  }
  if (children !== null || parentAnnotations !== null) {
    // One handler per children path: the contract is the query, not the route.
    mock.route('GET', `${prefix}/items/${parent.key}/children`, (req, res, helpers, search) => {
      if (search.get('itemType') === 'annotation') {
        helpers.json(parentAnnotations ?? [], headers)
        return
      }
      helpers.json(children ?? [], headers)
    })
  }
  if (annotations !== null) {
    mock.route('GET', `${prefix}/items/${pdfKey}/children`, (req, res, helpers, search) => {
      if (search.get('itemType') === 'annotation') {
        helpers.json(annotations, headers)
        return
      }
      // Bare attachment children are not part of the contract; 404 so a
      // production regression cannot silently read mock annotations.
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
    })
  }
  if (collections !== null) {
    serveJson(mock, `${prefix}/collections`, collections, headers)
  }
}

/** One search page: the listing body plus the `Total-Results` header the paging contract requires. */
export interface SearchPageSpec {
  /** The rows the listing returns. */
  readonly items: readonly WireObject[]
  /**
   * The total the header reports; defaults to the row count, and `null` omits
   * the header entirely — the shape a build that does not report totals
   * answers, which the paging contract must refuse rather than guess at.
   */
  readonly total?: number | null
  readonly serverId?: string | null
  readonly library?: SupportedLocalLibrary
  /** Any further headers, merged over the ones above. */
  readonly headers?: Record<string, string>
  /** The listing endpoint; defaults to the whole-library pattern. */
  readonly path?: string | RegExp
}

/**
 * Serve one search listing. The default path matches both `/items` and
 * `/items/top`, which is what a whole-library search asks for.
 * @param mock - the server to register on.
 * @param spec - the page to serve.
 */
export function serveSearchPage(mock: MockZotero, spec: SearchPageSpec): void {
  const library = spec.library ?? PERSONAL_LIBRARY
  const path = spec.path ?? new RegExp(`${apiPath(library)}/items(/top)?$`)
  const total = spec.total === undefined ? spec.items.length : spec.total
  const headers: Record<string, string> = {
    ...(total === null ? {} : { 'Total-Results': String(total) }),
    ...(spec.serverId === null ? {} : versionHeaders(spec.serverId ?? SERVER_ID)),
    ...spec.headers,
  }
  mock.route('GET', path, (req, res, helpers) => helpers.json([...spec.items], headers))
}

/**
 * Serve an attachment's full text. The default payload indexes part of the
 * document, so a test that does not care about coverage still exercises the
 * incomplete arm honestly.
 * @param mock - the server to register on.
 * @param key - the attachment whose text is served.
 * @param payload - the fulltext body.
 * @param library - the library the attachment lives in.
 */
export function serveFulltext(
  mock: MockZotero,
  key: string,
  payload: unknown = canonicalFulltext(),
  library: SupportedLocalLibrary = PERSONAL_LIBRARY,
): void {
  serveJson(mock, `${apiPath(library)}/items/${key}/fulltext`, payload)
}

/**
 * The canonical fulltext body: three sentences, one of which is irrelevant, so
 * a ranking test has something to rank and a coverage test has a partial
 * index to report.
 * @returns the fulltext payload.
 */
export function canonicalFulltext(): Record<string, unknown> {
  return {
    content:
      'Flash attention speeds up transformer training. Attention is all you need. Farming crops in the spring.',
    indexedPages: 10,
    totalPages: 12,
    indexedChars: 1000,
    totalChars: 1200,
  }
}
