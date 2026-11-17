/** A real translator response and a separate canonical item-verification response. */
import type { MockZotero } from '../mock-zotero.ts'
import { item } from './objects.ts'

export function serveExportText(mock: Pick<MockZotero, 'route'>, text: string): void {
  mock.route('GET', '/api/users/0/items', (_request, _response, helpers, search) => {
    if (search.has('format')) helpers.text(text)
    else helpers.json((search.get('itemKey') ?? '').split(',').map((key) => item({ key })))
  })
}
