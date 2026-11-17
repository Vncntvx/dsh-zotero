/** Oversized authored fields stop before approval, plan assembly, or Local API access. */
import { afterEach, expect, it } from 'vitest'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import {
  assertWritePayload,
  stringifyWriteBody,
  WRITE_PAYLOAD_MAX_BYTES,
} from '../../../src/write-bounds.js'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.teardown()
})
const ref = 'zotero://user/0/item/ABCD1234'
const long = 'x'.repeat(16_385)
const requests: [string, Record<string, unknown>][] = [
  ['zotero_create_item', { itemType: 'book', title: 'title', abstractNote: long }],
  ['zotero_update_item', { ref, set: { title: long } }],
  ['zotero_batch_items', { update: [{ ref, addTags: [long] }] }],
  ['zotero_create_collection', { name: long }],
  ['zotero_update_collection', { collection: 'collection', name: long }],
  ['zotero_update_item_tags', { ref, add: [long] }],
  ['zotero_update_item_collections', { ref, add: [long] }],
  ['zotero_delete_library_tags', { tags: [long] }],
  ['zotero_delete_collection', { collection: long }],
  ['zotero_create_note', { markdown: 'body', tags: [long] }],
  ['zotero_update_note', { ref, markdown: 'x'.repeat(65_537) }],
]
it.each(requests)(
  'rejects an overlong field in %s before its approval gate',
  async (name, args) => {
    lane = await setupHostLane({ writeEnabled: true })
    const result = await lane.runTool(name, args)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('character bound')
    expect(lane.mock.requests).toHaveLength(0)
  },
)
it('keeps the separate note allowance without granting it to adjacent fields', () => {
  expect(() =>
    assertWritePayload({ markdown: 'x'.repeat(20_000), title: 'short' }, 16_384, 65_536),
  ).not.toThrow()
  expect(() => assertWritePayload({ markdown: 'body', title: long }, 16_384, 65_536)).toThrow(
    '16384-character',
  )
})
it('counts escaped and multibyte bytes before serializing the complete request', () => {
  expect(() =>
    stringifyWriteBody({ abstractNote: '\u0000'.repeat(WRITE_PAYLOAD_MAX_BYTES / 3) }),
  ).toThrow('byte payload limit')
  expect(() =>
    stringifyWriteBody({ abstractNote: '字'.repeat(WRITE_PAYLOAD_MAX_BYTES / 2) }),
  ).toThrow('byte payload limit')
  const value = { title: 'x'.repeat(4095) + '😀', tags: ['\n"', '字'] }
  expect(JSON.parse(stringifyWriteBody(value))).toEqual(value)
})
