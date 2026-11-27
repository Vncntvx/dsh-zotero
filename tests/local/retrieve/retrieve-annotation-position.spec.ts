import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  retrieveRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../../helpers/provider-harness.js'
import { expectRequestLines } from '../../helpers/server/assert.js'
import { ITEM_KEY } from '../../helpers/server/keys.js'
import { annotationRow, attachment } from '../../helpers/server/objects.js'
import { serveItemGraph } from '../../helpers/server/serve.js'
import { RETRIEVE_PARENT } from '../../helpers/retrieve-fixtures.js'

let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
})

afterEach(async () => {
  await teardownProvider(harness)
})

describe('retrieve annotation positions', () => {
  it('preserves the attachment ref and normalized geometry for Reader navigation', async () => {
    serveItemGraph(harness.mock, {
      parent: RETRIEVE_PARENT,
      children: [attachment({ data: { parentItem: ITEM_KEY } })],
      annotations: [
        annotationRow({
          data: {
            annotationText: 'parented',
            parentItem: 'WXYZ6789',
            annotationPosition: { pageIndex: 6, rects: [[10, 20, 30, 40]] },
          },
        }),
      ],
      serverId: 'S1',
    })
    const result = await harness.provider.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'parented', passages: 1 }),
    )
    expectRequestLines(harness.mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/ABCD1234/children?itemType=annotation',
    ])
    expect(result.evidence).toEqual([
      {
        source: 'annotation',
        sourceRef: 'zotero://user/0/annotation/ANNO1111?server=S1',
        text: 'parented',
        attachmentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
        position: { pageIndex: 6, rects: [{ x: 10, y: 20, width: 20, height: 20 }] },
        matchKind: 'lexical',
      },
    ])
  })
})
