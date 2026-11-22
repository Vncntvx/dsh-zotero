/** The real tool pipeline maps opaque handles, preserves bounds and explains an input cut. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupHostLane, commitLive, type HostLane } from '../helpers/lanes/host-lane.ts'
import { serveItemGraph } from '../helpers/server/serve.ts'
import { fulltextHit, RETRIEVE_ATTACHMENT, RETRIEVE_PARENT } from '../helpers/retrieve-fixtures.ts'
import { attachmentRef } from '../helpers/server/keys.ts'
import { FULLTEXT_INPUT_TRUNCATED_REMEDY } from '../../src/tools/retrieve.ts'
import { asRecord } from '../../src/json.ts'
let lane: HostLane
beforeEach(async () => {
  lane = await setupHostLane({ fulltextWindowChars: 12 })
  serveItemGraph(lane.mock, {
    parent: RETRIEVE_PARENT,
    attachmentItem: RETRIEVE_ATTACHMENT,
    serverId: null,
  })
})
afterEach(async () => {
  await lane.teardown()
})

it('maps an artifactId and forwards a valid nonzero character window through the registered tool', async () => {
  const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lookupArtifact = vi.fn(async () => ({
    ...fulltextHit(text),
    attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
  }))
  const lookup = vi.fn(async () => ({ kind: 'miss' as const, reason: 'absent' as const }))
  lane.ctx.zotero.setFulltextEnhancer({ lookup, lookupArtifact })
  const first = await lane.runTool('zotero_retrieve', {
    mode: 'fulltext',
    source: { kind: 'artifactId', artifactId: 'a'.repeat(64) },
    start: 0,
    maxChars: 6,
  })
  expect(first.isError).toBe(false)
  const continuation = (first.value as { fulltext: { continuation: string } }).fulltext.continuation
  const result = await lane.runTool('zotero_retrieve', {
    mode: 'fulltext',
    source: { kind: 'artifactId', artifactId: 'a'.repeat(64) },
    start: 12,
    maxChars: 6,
    continuation,
  })
  expect(result.isError).toBe(false)
  expect(asRecord(result.value)?.fulltext).toMatchObject({
    text: 'MNOPQR',
    start: 12,
    end: 18,
    nextStart: 18,
    item: { ref: `zotero://user/0/item/${RETRIEVE_PARENT.key}` },
  })
  expect(lookupArtifact).toHaveBeenCalledWith('a'.repeat(64), expect.any(AbortSignal))
  expect(lookup).not.toHaveBeenCalled()
})

it('renders the input-truncation remedy for a document cut before windowing', async () => {
  await commitLive(lane, { maxFulltextChars: 16 })
  lane.ctx.zotero.setFulltextEnhancer({
    lookup: async () => fulltextHit('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  })
  const result = await lane.runTool('zotero_retrieve', {
    mode: 'fulltext',
    source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
    start: 0,
    maxChars: 6,
  })
  expect(result.isError).toBe(false)
  expect(asRecord(result.value)?.fulltext).toMatchObject({
    totalChars: 16,
    inputTruncated: true,
  })
  expect(
    result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
  ).toContain(FULLTEXT_INPUT_TRUNCATED_REMEDY)
})
