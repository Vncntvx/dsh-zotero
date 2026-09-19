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
    if (search.get('itemType') === 'annotation') {
      helpers.json(options.annotations ?? [], options.headers)
      return
    }
    if (options.direct === undefined) {
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
      return
    }
    helpers.json(options.direct, options.headers)
  })
}
