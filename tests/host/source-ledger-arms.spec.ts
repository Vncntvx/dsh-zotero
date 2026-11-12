/**
 * The literature workspace fold's remaining arms: the pending-tail comparison
 * that decides whether a read may reuse its cached view, the issue and filter
 * recounts a refreeze performs, the search occurrence fields the episode
 * carries, the batch and match-references degradations, and a persisted export
 * receipt without a stored projection. The main fold behaviour lives in
 * `source-ledger.spec.ts`, the incremental contract in
 * `source-projection-incremental.spec.ts`, and the event fold's defensive
 * arms in `source-event-ledger-arms.spec.ts`.
 * @module tests/host/source-ledger-arms
 */

import { describe, expect, it } from 'vitest'
import { RESULT_RECEIPT_PREFIX } from '../../src/constants.js'
import { buildSourceWorkspace } from '../../src/sources/ledger.js'
import {
  ATTACHMENT_REF,
  REF,
  runningBlock,
  searchIndex,
  searchMetaOf,
  settledBlock,
} from './support/source-ledger-arms.js'

describe('the pending-tail comparison', () => {
  it('rebuilds the view when the number of running exports changes', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    const settled = index.workspace([], { windowed: false })
    const exporting = index.workspace(
      [runningBlock('p1', 'zotero_export', { refs: [REF('AAAA1111')], format: 'ris' })],
      { windowed: false },
    )
    expect(exporting).not.toBe(settled)
    expect(settled.exportOperations.running).toBe(0)
    expect(exporting.exportOperations.running).toBe(1)
    expect(exporting.sources[0]?.operations.running).toBe(1)
  })

  it('rebuilds the view when the pending tail touches another source', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    const searching = index.workspace([runningBlock('p1', 'zotero_search', { query: 'pending' })], {
      windowed: false,
    })
    const touched = index.workspace(
      [
        runningBlock('p1', 'zotero_search', { query: 'pending' }),
        runningBlock('p2', 'zotero_get', { ref: REF('BBBB2222') }),
      ],
      { windowed: false },
    )
    expect(touched).not.toBe(searching)
    expect(searching.sources.map((item) => item.ref)).toEqual([REF('AAAA1111')])
    expect(touched.sources.map((item) => item.ref)).toEqual([REF('AAAA1111'), REF('BBBB2222')])
  })

  it('rebuilds the view when a pending call changes its running count', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    const once = index.workspace([runningBlock('p1', 'zotero_get', { ref: REF('BBBB2222') })], {
      windowed: false,
    })
    const twice = index.workspace(
      [
        runningBlock('p1', 'zotero_get', { ref: REF('BBBB2222') }),
        runningBlock('p2', 'zotero_get', { ref: REF('BBBB2222') }),
      ],
      { windowed: false },
    )
    expect(twice).not.toBe(once)
    expect(once.sources[1]?.operations.running).toBe(1)
    expect(twice.sources[1]?.operations.running).toBe(2)
  })

  it('rebuilds the view when the pending tail names a different source', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    const before = index.workspace([runningBlock('p1', 'zotero_get', { ref: REF('BBBB2222') })], {
      windowed: false,
    })
    const after = index.workspace([runningBlock('p2', 'zotero_get', { ref: REF('CCCC3333') })], {
      windowed: false,
    })
    expect(after).not.toBe(before)
    expect(before.sources[1]?.ref).toBe(REF('BBBB2222'))
    expect(after.sources[1]?.ref).toBe(REF('CCCC3333'))
  })

  it('rebuilds the view when only a pending touch position changes', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    const earlier = index.workspace(
      [
        runningBlock('p1', 'zotero_get', { ref: REF('BBBB2222') }),
        runningBlock('p2', 'zotero_get', { ref: REF('BBBB2222') }),
        runningBlock('p3', 'zotero_get', { ref: REF('CCCC3333') }),
      ],
      { windowed: false },
    )
    const later = index.workspace(
      [
        runningBlock('p1', 'zotero_get', { ref: REF('BBBB2222') }),
        runningBlock('p2', 'zotero_get', { ref: REF('CCCC3333') }),
        runningBlock('p3', 'zotero_get', { ref: REF('BBBB2222') }),
      ],
      { windowed: false },
    )
    expect(later).not.toBe(earlier)
    expect(earlier.sources[1]?.firstSeenAt).toBe(1)
    expect(earlier.sources[1]?.lastTouchedAt).toBe(2)
    expect(later.sources[1]?.firstSeenAt).toBe(1)
    expect(later.sources[1]?.lastTouchedAt).toBe(3)
  })
})

describe('the refreeze recounts', () => {
  it('keeps the issue count exact when a mismatched source refreezes', () => {
    const index = searchIndex([{ ref: REF('AAAA1111', 'SERVER9') }])
    const first = index.workspace([], { windowed: false, currentServerId: 'SERVER1' })
    expect(first.filterCounts.issues).toBe(1)
    expect(first.sources[0]?.evidenceMatch).toBe('mismatch')

    index.apply(
      settledBlock(
        'g1',
        'zotero_get',
        { ref: REF('AAAA1111', 'SERVER9') },
        { title: 'Attention Is All You Need' },
        2,
      ),
    )
    const second = index.workspace([], { windowed: false, currentServerId: 'SERVER1' })
    expect(second.sources[0]?.title).toBe('Attention Is All You Need')
    expect(second.filterCounts.issues).toBe(1)
    expect(second.sources[0]?.evidenceMatch).toBe('mismatch')
  })

  it('keeps the issue count exact when a pending call touches a mismatched source', () => {
    const index = searchIndex([{ ref: REF('AAAA1111', 'SERVER9') }])
    const first = index.workspace([], { windowed: false, currentServerId: 'SERVER1' })
    expect(first.filterCounts.issues).toBe(1)

    const merged = index.workspace(
      [runningBlock('p1', 'zotero_get', { ref: REF('AAAA1111', 'SERVER9') })],
      { windowed: false, currentServerId: 'SERVER1' },
    )
    expect(merged.sources).toHaveLength(1)
    expect(merged.sources[0]?.operations.running).toBe(1)
    expect(merged.filterCounts.issues).toBe(1)
  })

  it('removes a source from the pdf count when a richer read replaces its attachment', () => {
    const index = searchIndex([
      {
        ref: REF('AAAA1111'),
        title: 'Attention',
        bestAttachmentRef: ATTACHMENT_REF,
        bestAttachmentType: 'application/pdf',
      },
    ])
    const withPdf = index.workspace([], { windowed: false })
    expect(withPdf.filterCounts.pdf).toBe(1)

    index.apply(
      settledBlock(
        'g1',
        'zotero_get',
        { ref: REF('AAAA1111') },
        { title: 'Attention', bestAttachment: { ref: ATTACHMENT_REF, contentType: 'text/html' } },
        2,
      ),
    )
    const withoutPdf = index.workspace([], { windowed: false })
    expect(withoutPdf.filterCounts.pdf).toBe(0)
    expect(withoutPdf.sources[0]?.bestAttachment).toEqual({
      ref: ATTACHMENT_REF,
      contentType: 'text/html',
    })
  })
})

describe('the search occurrence fields', () => {
  it('keeps an any-tag search as one episode with tagMatch any', () => {
    const workspace = buildSourceWorkspace([
      settledBlock(
        's1',
        'zotero_search',
        { query: 'attention', tags: ['b', 'a'], tagMatch: 'any' },
        searchMetaOf([{ ref: REF('AAAA1111'), title: 'Attention' }]),
        1,
      ),
    ])
    expect(workspace.sources[0]?.searches[0]).toMatchObject({
      tags: ['a', 'b'],
      tagMatch: 'any',
    })
  })

  it('records an explicit personal-library argument on the episode', () => {
    const workspace = buildSourceWorkspace([
      settledBlock(
        's1',
        'zotero_search',
        { query: 'attention', library: { type: 'user', id: 0 } },
        searchMetaOf([{ ref: REF('AAAA1111'), title: 'Attention' }]),
        1,
      ),
    ])
    expect(workspace.sources[0]?.searches[0]?.library).toEqual({ type: 'user', id: 0 })
  })
})

describe('the batch and reference-match degradations', () => {
  it('records no source for an attributed batch ref without an outcome', () => {
    const workspace = buildSourceWorkspace([
      settledBlock(
        'b1',
        'zotero_get_batch',
        { refs: [REF('AAAA1111')] },
        { items: [], statuses: [] },
        1,
      ),
    ])
    expect(workspace.sources).toEqual([])
    expect(workspace.sourceTotal).toBe(0)
  })

  it('keeps a batch attachment hint without a content type', () => {
    const workspace = buildSourceWorkspace([
      settledBlock(
        'b1',
        'zotero_get_batch',
        { refs: [REF('AAAA1111')] },
        {
          items: [
            {
              ref: REF('AAAA1111'),
              status: 'ok',
              title: 'Attention',
              bestAttachmentRef: ATTACHMENT_REF,
            },
          ],
        },
        1,
      ),
    ])
    expect(workspace.sources[0]?.bestAttachment).toEqual({ ref: ATTACHMENT_REF })
    expect(workspace.sources[0]?.bestAttachment).not.toHaveProperty('contentType')
  })

  it('matches nothing when a reference result carries no presentation projection', () => {
    const workspace = buildSourceWorkspace([
      settledBlock('m1', 'zotero_match_references', { references: ['Some title'] }, undefined, 1),
    ])
    expect(workspace.sources).toEqual([])
  })
})

describe('the persisted export receipt without a projection', () => {
  it('attributes the argument refs and keeps the file coordinate with no format', () => {
    const file = { attachmentId: 'attachment-1', name: 'export.json', bytes: 12 }
    // The harness brands AttachmentId; this fixture supplies the raw wire value.
    const fileBlock = { type: 'file' as const, attachment: file as never }
    const receipt = {
      delivery: 'file',
      version: 1,
      tool: 'zotero_export',
      sessionId: 'session',
      callId: 'e1',
      summary: 'zotero_export: full result persisted.',
      file,
    }
    const workspace = buildSourceWorkspace([
      settledBlock(
        'e1',
        'zotero_export',
        { refs: [REF('AAAA1111')], format: 'ris' },
        undefined,
        1,
        [{ type: 'text', text: `${RESULT_RECEIPT_PREFIX}${JSON.stringify(receipt)}` }, fileBlock],
      ),
    ])
    expect(workspace.exports).toHaveLength(1)
    expect(workspace.exports[0]).toMatchObject({
      callId: 'e1',
      format: '',
      refs: [REF('AAAA1111')],
      text: '',
      resultFile: { seq: 1, index: 0 },
    })
    expect(workspace.sources[0]?.exports).toHaveLength(1)
  })
})
