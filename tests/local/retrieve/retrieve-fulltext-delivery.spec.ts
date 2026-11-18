import { describe, expect, it, vi } from 'vitest'

import { attachmentRef } from '../../helpers/server/keys.js'
import { artifactIdOf } from '../../../src/contract.js'

import { RETRIEVE_ATTACHMENT } from '../../helpers/retrieve-fixtures.js'

import { WINDOW_CHARS, providerOf, boot, hit, enhancerOf, markdown } from './support/fulltext.js'

describe('mode:"fulltext" spill', () => {
  const longText = 'x'.repeat(20_000)

  it('offers a one-handle spill of the whole bounded document on the first window', async () => {
    const server = await boot()
    const spill = vi.fn(async () => ({
      locator: 'spill://doc/full.md',
      bytes: longText.length,
      retrievalHint: 'Read it from spill storage.',
    }))
    const result = await providerOf(server, enhancerOf(hit(longText))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: WINDOW_CHARS,
      },
      undefined,
      spill,
    )
    expect(spill).toHaveBeenCalledOnce()
    expect(spill).toHaveBeenCalledWith(longText)
    expect(result.fulltext?.spillRef).toEqual({
      locator: 'spill://doc/full.md',
      bytes: longText.length,
      retrievalHint: 'Read it from spill storage.',
    })
  })

  it('spills only on the first window so a walk does not re-save the document', async () => {
    const server = await boot()
    const spill = vi.fn(async () => ({
      locator: 'spill://doc/full.md',
      bytes: longText.length,
      retrievalHint: 'Read it.',
    }))
    const provider = providerOf(server, enhancerOf(hit(longText)))
    const first = await provider.retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: WINDOW_CHARS,
      },
      undefined,
      spill,
    )
    expect(spill).toHaveBeenCalledOnce()
    const continuation = first.fulltext!.continuation!
    spill.mockClear()
    const result = await provider.retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
        continuation,
      },
      undefined,
      spill,
    )
    expect(spill).not.toHaveBeenCalled()
    expect(result.fulltext?.spillRef).toBeUndefined()
  })

  it('asks the sink even for a short document; the inline budget is the sink decision', async () => {
    const server = await boot()
    // The domain decides *when* a handle may be offered (first window, more
    // windows follow). Whether the document is large enough is priced against
    // the inline token budget by the sink, which is the tool layer's own
    // decision — so the domain calls it and takes an absent answer as no spill.
    const spill = vi.fn(async () => undefined)
    const result = await providerOf(server, enhancerOf(hit(markdown))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: WINDOW_CHARS,
      },
      undefined,
      spill,
    )
    expect(spill).toHaveBeenCalledOnce()
    expect(spill).toHaveBeenCalledWith(markdown)
    expect(result.fulltext?.spillRef).toBeUndefined()
  })
})

describe('mode:"fulltext" complete reads', () => {
  it('returns the whole bounded document in one call when the sink declines a handle', async () => {
    const server = await boot()
    const result = await providerOf(server, enhancerOf(hit(markdown))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        complete: true,
      },
      undefined,
      async () => undefined,
    )
    expect(result.fulltext).toMatchObject({
      start: 0,
      end: markdown.length,
      totalChars: markdown.length,
      inputTruncated: false,
      isTruncated: false,
      spillAvailable: false,
      text: markdown,
    })
    expect(result.fulltext?.nextStart).toBeUndefined()
    expect(result.fulltext?.continuation).toBeUndefined()
  })

  it('carries the whole document through one spill handle and omits the duplicate text', async () => {
    const server = await boot()
    const longText = 'x'.repeat(20_000)
    const spill = vi.fn(async () => ({
      locator: 'spill://doc/complete.md',
      bytes: longText.length,
      retrievalHint: 'Read it from spill storage.',
    }))
    const result = await providerOf(server, enhancerOf(hit(longText))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        complete: true,
      },
      undefined,
      spill,
    )
    expect(spill).toHaveBeenCalledOnce()
    expect(spill).toHaveBeenCalledWith(longText)
    expect(result.fulltext).toMatchObject({
      start: 0,
      end: longText.length,
      totalChars: longText.length,
      inputTruncated: false,
      isTruncated: false,
      spillAvailable: true,
      text: '',
      spillRef: {
        locator: 'spill://doc/complete.md',
        bytes: longText.length,
        retrievalHint: 'Read it from spill storage.',
      },
    })
  })

  it('reports the maxFulltextChars bound on a complete read', async () => {
    const server = await boot()
    const result = await providerOf(server, enhancerOf(hit('abcdefghij')), {
      maxFulltextChars: 4,
    }).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      complete: true,
    })
    expect(result.fulltext).toMatchObject({
      start: 0,
      end: 4,
      totalChars: 4,
      inputTruncated: true,
      isTruncated: false,
      spillAvailable: false,
      text: 'abcd',
    })
  })

  it('reads a stored artifact by opaque id through lookupArtifact', async () => {
    const server = await boot()
    const enhancer = enhancerOf({
      ...hit(markdown),
      sourceKind: 'attachment',
      sourceLabel: attachmentRef(RETRIEVE_ATTACHMENT.key),
      attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
    })
    const result = await providerOf(server, enhancer).retrieve({
      mode: 'fulltext',
      source: { kind: 'artifactId', artifactId: artifactIdOf('e'.repeat(64))! },
      complete: true,
    })
    expect(result.fulltext).toMatchObject({
      sourceKind: 'attachment',
      textFormat: 'markdown',
      start: 0,
      end: markdown.length,
      text: markdown,
    })
    expect(enhancer.lookupArtifact).toHaveBeenCalledWith('e'.repeat(64), undefined)
    expect(enhancer.lookup).not.toHaveBeenCalled()
  })
})
