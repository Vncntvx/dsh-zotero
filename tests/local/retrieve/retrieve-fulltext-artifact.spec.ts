import { describe, expect, it } from 'vitest'

import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
} from '../../../src/errors.js'

import { attachmentRef } from '../../helpers/server/keys.js'
import { artifactIdOf } from '../../../src/contract.js'

import { RETRIEVE_ATTACHMENT } from '../../helpers/retrieve-fixtures.js'

import { WINDOW_CHARS, providerOf, boot, hit, enhancerOf, markdown } from './support/fulltext.js'

describe('mode:"fulltext" artifact sources', () => {
  it('reads a stored artifact by opaque id through lookupArtifact', async () => {
    const server = await boot()
    // The artifactId handle says nothing about the source; the lookup result
    // carries the concrete source facts the read must report.
    const enhancer = enhancerOf({
      ...hit(markdown),
      sourceKind: 'attachment',
      sourceLabel: attachmentRef(RETRIEVE_ATTACHMENT.key),
      attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
    })
    const result = await providerOf(server, enhancer).retrieve({
      mode: 'fulltext',
      source: { kind: 'artifactId', artifactId: artifactIdOf('e'.repeat(64))! },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext).toMatchObject({
      sourceKind: 'attachment',
      sourceLabel: attachmentRef(RETRIEVE_ATTACHMENT.key),
      attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
      textFormat: 'markdown',
      text: markdown.slice(0, WINDOW_CHARS),
    })
    expect(enhancer.lookupArtifact).toHaveBeenCalledWith('e'.repeat(64), undefined)
    expect(enhancer.lookup).not.toHaveBeenCalled()
  })

  it('reports a URL-sourced artifact as a url source', async () => {
    const server = await boot()
    const enhancer = enhancerOf({
      ...hit(markdown),
      sourceKind: 'url',
      sourceLabel: 'https://example.org/…',
    })
    const result = await providerOf(server, enhancer).retrieve({
      mode: 'fulltext',
      source: { kind: 'artifactId', artifactId: artifactIdOf('e'.repeat(64))! },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext).toMatchObject({
      sourceKind: 'url',
      sourceLabel: 'https://example.org/…',
    })
    expect(result.fulltext?.attachmentRef).toBeUndefined()
  })

  it('fails closed when an artifact id has no stored Markdown', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf({ kind: 'miss', reason: 'absent' })).retrieve({
        mode: 'fulltext',
        source: { kind: 'artifactId', artifactId: artifactIdOf('e'.repeat(64))! },
        start: 0,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toMatchObject({
      name: 'ZoteroError',
      code: ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
    })
  })

  it('fails closed when the enhancement slot is absent', async () => {
    const server = await boot()
    await expect(
      providerOf(server).retrieve({
        mode: 'fulltext',
        source: { kind: 'artifactId', artifactId: artifactIdOf('e'.repeat(64))! },
        start: 0,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toMatchObject({ name: 'ZoteroError', code: ZOTERO_CAPABILITY_UNAVAILABLE })
  })
})
