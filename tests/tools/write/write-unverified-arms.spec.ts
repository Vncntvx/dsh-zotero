/**
 * The committed-unverified arm on the tools that had folded it away.
 *
 * `zotero_delete_collection`, `zotero_delete_library_tags` and
 * `zotero_update_item` projected every non-success outcome as `declined`, so
 * the row said nothing was written while the model's own text said the write
 * may have committed and must not be retried.
 * @module tests/tools/write/write-unverified-arms
 */

import { describe, expect, it } from 'vitest'
import { approvalLane } from '../../helpers/approval-stub.js'

describe('committed-unverified projections', () => {
  it('keeps committed-unverified a distinct arm in all three projections', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const unverified = {
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      ref: 'zotero://user/0/item/ABCD1234',
      key: 'ABCD1234',
      serverId: 'S',
    } as const
    for (const [name, args] of [
      ['zotero_delete_collection', { collection: 'r' }],
      ['zotero_delete_library_tags', { tags: ['a'] }],
      ['zotero_update_item', { ref: 'r', tags: { add: ['a'] } }],
    ] as const) {
      const tool = lane.tool(name)!
      // The projection used to fold every non-success arm into `declined`, so
      // the row said "nothing written" while the model's own text said the
      // write may have committed and must not be retried.
      expect(tool.output.presentationMeta?.(args, unverified as never)).toMatchObject({
        kind: 'committed-unverified',
        committed: true,
        retryable: false,
        serverId: 'S',
      })
    }
    const collection = lane.tool('zotero_delete_collection')!
    expect(
      collection.presentResult?.({ collection: 'r' }, {
        isError: false,
        meta: unverified,
      } as never),
    ).toMatchObject({ card: 'generic', title: expect.stringContaining('do not retry') })
    expect(
      collection.presentResult?.({ collection: 'r' }, {
        isError: false,
        meta: unverified,
      } as never)?.title,
    ).not.toContain('declined')
    const update = lane.tool('zotero_update_item')!
    expect(
      update.presentResult?.({ ref: 'zotero://user/0/item/ABCD1234', set: { title: 'Updated' } }, {
        isError: false,
        meta: unverified,
      } as never)?.title,
    ).toMatch(/do not retry/)
    await lane.teardown()
  })
})
