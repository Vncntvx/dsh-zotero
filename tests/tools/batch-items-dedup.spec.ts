/**
 * Repeated batch targets are refused before the plan card: approval must
 * never be spent on a request the write domain would reject afterwards.
 * @module tests/tools/batch-items-dedup
 */

import { expect, it } from 'vitest'
import { buildBatchItemsRequest } from '../../src/tools/batch-items.js'
import { resolveConfig } from '../../src/config.js'

const ITEM_REF_1 = 'zotero://user/0/item/ITEMABC1'

it('refuses repeated delete targets before approval', () => {
  expect(() =>
    buildBatchItemsRequest({ delete: [ITEM_REF_1, ITEM_REF_1] }, resolveConfig({})),
  ).toThrow('Batch delete repeats item ITEMABC1.')
})

it('refuses repeated update targets before approval', () => {
  expect(() =>
    buildBatchItemsRequest(
      {
        update: [
          { ref: ITEM_REF_1, addTags: ['a'] },
          { ref: ITEM_REF_1, addTags: ['b'] },
        ],
      },
      resolveConfig({}),
    ),
  ).toThrow('A batch cannot update one item more than once.')
})
