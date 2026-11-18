import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'

import { type LocalApiProvider } from '../../../src/local/provider.js'
import type { ZoteroChangesCursor, ZoteroChangesInclude } from '../../../src/types.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../../helpers/provider-harness.js'
import { zoteroError } from '../../helpers/server/assert.js'
import { ITEM_KEY, SERVER_ID, apiPath } from '../../helpers/server/keys.js'
import { versionHeaders } from '../../helpers/server/objects.js'

import { deferred } from '../../helpers/sync.js'
import { at, routeItems, versionMap } from './support.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProvider
let harness: ProviderHarness

const diff = (
  since: ZoteroChangesCursor,
  include: Iterable<ZoteroChangesInclude> = since.include,
) => provider.changes({ since, include: new Set(include) })

beforeEach(async () => {
  harness = await setupProvider({ maxChangesResults: 3 })
  mock = harness.mock
  provider = harness.provider
})

afterEach(async () => {
  await teardownProvider(harness)
})

describe('changes request lifecycle', () => {
  it('waits for the item fan-out to settle after one partition fails fatally', async () => {
    routeItems(mock, { diff: { live: 'error' } })
    await expect(diff(at(42, SERVER_ID, ['items']))).rejects.toMatchObject({
      code: 'ZOTERO_UNEXPECTED',
    })
  })

  it('preserves the partition failure that aborts its siblings', async () => {
    const liveStarted = deferred<void>()
    const liveClosed = deferred<void>()
    const failTop = deferred<void>()
    mock.route('GET', `${apiPath()}/items`, async (_req, res) => {
      liveStarted.resolve()
      res.once('close', () => liveClosed.resolve())
      await liveClosed.promise
    })
    mock.route('GET', `${apiPath()}/items/top`, async (_req, res, helpers, search) => {
      if (search.get('limit') === '1') {
        helpers.json({}, versionHeaders(SERVER_ID, 50))
        return
      }
      await failTop.promise
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'partition failed')
    })
    routeItems(mock, { trash: versionMap([]) })

    const pending = provider.changes({
      since: at(42, SERVER_ID, ['items']),
      include: new Set(['items']),
    })
    await liveStarted.promise
    failTop.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
    await liveClosed.promise
  })

  it('forwards caller cancellation into the item fan-out', async () => {
    const controller = new AbortController()
    mock.route('GET', `${apiPath()}/items/top`, (_req, res, helpers, search) => {
      if (search.get('limit') === '1') controller.abort()
      helpers.json({}, versionHeaders(SERVER_ID, 50))
    })
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]) })
    await expect(
      provider.changes(
        { since: at(42, SERVER_ID, ['items']), include: new Set(['items']) },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
  })

  it('fails loud when a resource faults for a reason other than absence', async () => {
    // Only a 404 (and a 409 range refusal) degrades to `unobservable`; a server
    // fault must never be reported as "this resource did not change".
    routeItems(mock, { top: versionMap([[ITEM_KEY, 44]]), diff: { top: 'error' } })
    await zoteroError(
      provider.changes({ since: at(42, SERVER_ID, ['items']), include: new Set(['items']) }),
      'ZOTERO_UNEXPECTED',
      'HTTP 500',
    )
  })
})
