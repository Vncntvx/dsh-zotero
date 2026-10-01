/**
 * The write projection decoder: presentation meta for the eight write tools,
 * decoded defensively. Split from `decoders.spec.ts` along its own seam, since
 * that file already sits at the size ratchet.
 * @module tests/client/sources/decoders-write
 */

import { describe, expect, it } from 'vitest'
import { writeMetaOf } from '../../../src/client/sources/decoders.ts'

describe('writeMetaOf', () => {
  it('reads the applied tag and membership counts a merge call reported', () => {
    expect(
      writeMetaOf({
        kind: 'applied',
        ref: 'zotero://user/0/item/AAAAAAA1',
        version: 4,
        addedCount: 2,
        removedCount: 1,
      }),
    ).toEqual({
      kind: 'applied',
      addedCount: 2,
      removedCount: 1,
      deletedCount: null,
    })
  })

  it('reads the deleted count a library-wide tag delete reported', () => {
    expect(writeMetaOf({ kind: 'deleted', deletedCount: 3 })).toEqual({
      kind: 'deleted',
      addedCount: null,
      removedCount: null,
      deletedCount: 3,
    })
  })

  it('keeps an unverified commit distinguishable from an applied one', () => {
    // The unverified arm reports no applied fact, so a card reading a count off
    // it sees nothing rather than a stale one. Which *reason* it was is left to
    // the tool's own sentence, which the receipt shows verbatim.
    expect(
      writeMetaOf({ kind: 'committed-unverified', reason: 'commit-unknown', key: 'NOTE1234' }),
    ).toEqual({
      kind: 'committed-unverified',
      addedCount: null,
      removedCount: null,
      deletedCount: null,
    })
  })

  it('reads a declined arm as carrying no applied fact', () => {
    expect(writeMetaOf({ kind: 'declined' })).toEqual({
      kind: 'declined',
      addedCount: null,
      removedCount: null,
      deletedCount: null,
    })
  })

  it('reads an absent or malformed kind as applied with nothing applied proven', () => {
    // An unrecognized kind must never read as a success claim: the applied
    // fields stay null, so the card falls back to the tool's own text.
    for (const meta of [{}, { kind: 7 }, { kind: 'surprise' }]) {
      expect(writeMetaOf(meta)).toEqual({
        kind: 'applied',
        addedCount: null,
        removedCount: null,
        deletedCount: null,
      })
    }
  })
})
