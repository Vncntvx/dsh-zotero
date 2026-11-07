/** Reconciliation must remain possible using the durable receipt alone. */
import { describe, expect, it } from 'vitest'
import {
  createWritePresentationMeta,
  renderCommittedUnverified,
} from '../../../src/tools/write-present.js'

describe('unverified creation receipts', () => {
  it.each(['commit-unknown', 'saved-state-unverified'] as const)(
    'retains every known identity for %s',
    (reason) => {
      for (const identity of [
        {},
        { key: 'KNOWN001' },
        { ref: 'zotero://user/0/item/KNOWN001?server=srv' },
        {
          key: 'KNOWN001',
          ref: 'zotero://user/0/item/KNOWN001?server=srv',
          version: 12,
          libraryVersion: 13,
        },
      ]) {
        const value = {
          kind: 'committed-unverified' as const,
          reason,
          ...identity,
          serverId: 'srv',
        }
        const content = renderCommittedUnverified(value, 'item', 'created')
        const text = content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
        expect(text).toContain('Do not retry')
        expect(text).toContain(
          reason === 'commit-unknown' ? 'may have created' : 'saved state could not be verified',
        )
        const meta = createWritePresentationMeta(value)
        expect(meta).toMatchObject({ ...value, committed: true, retryable: false })
        if ('key' in identity) expect(text).toContain(identity.key)
        if ('ref' in identity) expect(text).toContain(identity.ref)
        if ('version' in identity) expect(text).toContain(`version ${identity.version}`)
        if ('libraryVersion' in identity)
          expect(text).toContain(`library version ${identity.libraryVersion}`)
        expect(text).toContain('server srv')
        if (!('key' in identity) && !('ref' in identity)) {
          expect(text).toContain('checking Zotero')
          expect(text).not.toContain('by its key/ref')
        }
      }
    },
  )
})

describe('unverified graph-write receipts', () => {
  it('retains the parent ref and the acknowledged refs of a whole-graph write', () => {
    const value = {
      kind: 'committed-unverified' as const,
      reason: 'receipt-unknown' as const,
      key: 'ATTACH01',
      ref: 'zotero://user/0/item/ATTACH01?server=srv',
      parentRef: 'zotero://user/0/item/PARENT01?server=srv',
      completedRefs: ['zotero://user/0/item/NOTECHLD?server=srv'],
      serverId: 'srv',
    }
    const text = renderCommittedUnverified(value, 'item', 'created')
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
    expect(text).toContain('parent ref zotero://user/0/item/PARENT01?server=srv')
    expect(text).toContain(
      'Refs acknowledged before the outcome turned unknown: zotero://user/0/item/NOTECHLD?server=srv',
    )
    expect(createWritePresentationMeta(value)).toEqual({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'receipt-unknown',
      key: 'ATTACH01',
      ref: 'zotero://user/0/item/ATTACH01?server=srv',
      parentRef: 'zotero://user/0/item/PARENT01?server=srv',
      completedRefs: ['zotero://user/0/item/NOTECHLD?server=srv'],
      serverId: 'srv',
    })
  })
})
