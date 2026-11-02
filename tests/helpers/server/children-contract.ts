/**
 * Route the Local API child-object contracts for tool-lane specs: a bare
 * `/children` listing never carries annotations; `?itemType=annotation` does.
 * @module tests/helpers/server/children-contract
 */

import type { MockZotero } from '../mock-zotero.js'

/** Serve one children path under the real Zotero partition. */
export function serveChildrenContract(
  mock: MockZotero,
  pathname: string,
  options: {
    /** Direct children for a bare listing. */
    readonly direct?: unknown
    /** Annotation rows for `?itemType=annotation`. */
    readonly annotations?: unknown
    readonly headers?: Record<string, string>
  },
): void {
  mock.route('GET', pathname, (req, res, helpers, search) => {
    const kind = search.get('itemType')
    let rows = kind === 'annotation' ? (options.annotations ?? []) : options.direct
    if (rows === undefined) {
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
      return
    }
    if (Array.isArray(rows) && kind !== null && kind !== 'annotation')
      rows = rows.filter((row) => row.data?.itemType === kind)
    const headers = {
      ...options.headers,
      'Last-Modified-Version': '1',
      ...(Array.isArray(rows) ? { 'Total-Results': String(rows.length) } : {}),
    }
    const offset = Number(search.get('start') ?? 0)
    const limit = Number(search.get('limit') ?? (Array.isArray(rows) ? rows.length : 100))
    helpers.json(Array.isArray(rows) ? rows.slice(offset, offset + limit) : rows, headers)
  })
}
