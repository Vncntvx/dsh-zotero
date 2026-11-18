import { describe, expect, it } from 'vitest'

import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'
import { attachmentRef } from '../../helpers/server/keys.js'

import {
  FULLTEXT_CONTINUATION_CHANGED_MESSAGE,
  FULLTEXT_CONTINUATION_REQUIRED_MESSAGE,
} from '../../../src/local/retrieve-fulltext.js'
import { RETRIEVE_ATTACHMENT } from '../../helpers/retrieve-fixtures.js'

import { WINDOW_CHARS, providerOf, boot, hit, enhancerOf, markdown } from './support/fulltext.js'

describe('mode:"fulltext" continuation', () => {
  it('joins successive windows into the complete document without ranking or chunking', async () => {
    const server = await boot()
    const provider = providerOf(server, enhancerOf(hit(markdown)))
    let nextStart = 0
    let continuation: string | undefined
    let joined = ''
    let windows = 0
    while (true) {
      const result = await provider.retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: nextStart,
        maxChars: WINDOW_CHARS,
        ...(continuation === undefined ? {} : { continuation }),
      })
      const read = result.fulltext!
      joined += read.text
      windows += 1
      if (!read.isTruncated) break
      nextStart = read.nextStart!
      expect(read.continuation).toBeDefined()
      continuation = read.continuation
      expect(windows).toBeLessThan(10)
    }
    expect(joined).toBe(markdown)
    expect(windows).toBe(4)
  })

  it('requires the continuation token before a later window reads the source', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf(hit(markdown))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: FULLTEXT_CONTINUATION_REQUIRED_MESSAGE,
    })
    expect(server.requests).toHaveLength(0)
  })

  it('refuses a continuation when the document changed between windows', async () => {
    const server = await boot()
    const first = await providerOf(server, enhancerOf(hit(markdown))).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    const continuation = first.fulltext!.continuation!
    expect(continuation).toEqual(expect.any(String))
    await expect(
      providerOf(server, enhancerOf(hit(`${markdown}!`))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
        continuation,
      }),
    ).rejects.toMatchObject({
      code: 'ZOTERO_SOURCE_PAGE_STALE',
      message: FULLTEXT_CONTINUATION_CHANGED_MESSAGE,
    })
  })

  it('refuses a malformed continuation token', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf(hit(markdown))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
        continuation: 'not-a-token',
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
  })

  it('refuses an oversized continuation token before parsing it', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf(hit(markdown))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
        continuation: 'a'.repeat(5_000),
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
  })

  it('refuses a well-formed token that carries no fingerprint', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf(hit(markdown))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
        continuation: Buffer.from('{}', 'utf8').toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
  })

  it('refuses a continuation when only the artifact generation changed', async () => {
    const server = await boot()
    const base = hit(markdown)
    const first = await providerOf(server, enhancerOf(base)).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    const regenerated: typeof base = {
      ...base,
      provenance: { ...base.provenance, generation: 'e'.repeat(64) },
    }
    await expect(
      providerOf(server, enhancerOf(regenerated)).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
        continuation: first.fulltext!.continuation!,
      }),
    ).rejects.toMatchObject({
      code: 'ZOTERO_SOURCE_PAGE_STALE',
      message: FULLTEXT_CONTINUATION_CHANGED_MESSAGE,
    })
  })
})
