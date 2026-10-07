/**
 * The session source reducer's per-call output rules: the export artifacts a
 * successful export produces (refs, style and locale, per-document items,
 * text), the attachment a source resolves and the hint precedence its
 * best-attachment link follows, and the operation counters no call may ever
 * turn into a fact. The item-assembly half of the same reducer lives in
 * `reducer.spec.ts`; the retrieval-evidence half lives in
 * `reducer-evidence.spec.ts`.
 * @module tests/client/sources/reducer-outputs
 */

import { describe, expect, it } from 'vitest'
import { settled, running } from '../helpers/blocks.ts'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import { REF, block } from './reducer-fixtures.ts'

describe('buildSourceWorkspace', () => {
  describe('export artifacts and attribution', () => {
    it('skips an export with neither projection refs nor usable arguments', () => {
      const workspace = buildSourceWorkspace([
        settled({
          callId: 'e1',
          seq: 1,
          call: { name: 'zotero_export', argsRaw: '' },
        }),
      ])
      expect(workspace.sources).toEqual([])
      expect(workspace.exports).toEqual([])
    })

    it('creates an export artifact only from a successful call', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1'), REF('A2')], format: 'bibtex' },
          {
            meta: { format: 'bibtex', requested: 2, refs: [REF('A1'), REF('A2')], refsOmitted: 0 },
            content: [{ type: 'text', text: '@article{a1}' }],
          },
        ),
      ])
      expect(workspace.exports).toHaveLength(1)
      expect(workspace.exports[0]).toMatchObject({
        callId: 'e1',
        format: 'bibtex',
        refs: [REF('A1'), REF('A2')],
        refsOmitted: 0,
        text: '@article{a1}',
      })
      expect(workspace.sources).toHaveLength(2)
      for (const source of workspace.sources) {
        expect(source.exports.length).toBe(1)
        expect(source.exports).toEqual([workspace.exports[0]])
      }
    })

    it('carries the per-document items of a translator export onto the artifact', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1')], format: 'bibtex' },
          {
            meta: {
              format: 'bibtex',
              requested: 1,
              refs: [REF('A1')],
              refsOmitted: 0,
              items: [{ ref: REF('A1'), key: 'a1', title: 'Alpha' }],
            },
            content: [{ type: 'text', text: '@article{a1}' }],
          },
        ),
      ])
      expect(workspace.exports[0]!.items).toEqual([{ ref: REF('A1'), key: 'a1', title: 'Alpha' }])
    })

    it('drops malformed item rows while decoding the rest', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1'), REF('A2')], format: 'bibtex' },
          {
            meta: {
              format: 'bibtex',
              requested: 2,
              refs: [REF('A1'), REF('A2')],
              refsOmitted: 0,
              items: [
                { ref: REF('A1'), key: 'a1' },
                { key: 'no-ref' },
                'junk',
                { ref: REF('A2'), key: 7 },
              ],
            },
            content: [{ type: 'text', text: '@article{a1}\n@article{a2}' }],
          },
        ),
      ])
      expect(workspace.exports[0]!.items).toEqual([
        { ref: REF('A1'), key: 'a1' },
        { ref: REF('A2') },
      ])
    })

    it('keeps artifacts item-less when the projection carries no items', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1')], format: 'bibtex' },
          {
            meta: { format: 'bibtex', requested: 1, refs: [REF('A1')], refsOmitted: 0 },
            content: [{ type: 'text', text: '@article{a1}' }],
          },
        ),
      ])
      expect(workspace.exports[0]!).not.toHaveProperty('items')
    })

    it('counts a duplicated ref once per artifact', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1'), REF('A1')] },
          {
            meta: { format: 'citation', refs: [REF('A1'), REF('A1')], refsOmitted: 0 },
            content: [{ type: 'text', text: 'x' }],
          },
        ),
      ])
      expect(workspace.sources).toHaveLength(1)
      expect(workspace.sources[0]!.exports.length).toBe(1)
    })

    it('attributes an export through its meta refs even with unparseable arguments', () => {
      const workspace = buildSourceWorkspace([
        settled({
          callId: 'e1',
          seq: 1,
          call: { name: 'zotero_export', argsRaw: '' },
          meta: { format: 'ris', requested: 1, refs: [REF('A1')] },
          content: [{ type: 'text', text: 'TY - JOUR' }],
        }),
      ])
      expect(workspace.exports[0]!.refs).toEqual([REF('A1')])
      expect(workspace.exports[0]!.refsOmitted).toBe(0)
      expect(workspace.sources).toHaveLength(1)
    })

    it('falls back to the argument refs when the meta carries none', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1')] },
          { meta: { format: 'bibtex' }, content: [{ type: 'text', text: 'x' }] },
        ),
      ])
      expect(workspace.exports[0]!.refs).toEqual([REF('A1')])
      expect(workspace.exports[0]!.refsOmitted).toBe(0)
    })

    it('keeps the style and locale facts on an artifact', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1')] },
          {
            meta: {
              format: 'bibliography',
              style: 'apa',
              locale: 'en-US',
              refs: [REF('A1')],
              refsOmitted: 0,
            },
            content: [{ type: 'text', text: 'bib' }],
          },
        ),
      ])
      expect(workspace.exports[0]).toMatchObject({ style: 'apa', locale: 'en-US' })
    })

    it('still records the artifact text when the meta is absent', () => {
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs: [REF('A1')] },
          { content: [{ type: 'text', text: 'raw' }] },
        ),
      ])
      expect(workspace.exports[0]).toMatchObject({ format: '', refsOmitted: 0, text: 'raw' })
    })

    it('attributes every ref of a 50-ref export from the arguments, with no phantom omitted count', () => {
      const refs = Array.from({ length: 50 }, (_, index) =>
        REF(`B${String(index).padStart(2, '0')}`),
      )
      const workspace = buildSourceWorkspace([
        block(
          'e1',
          1,
          'zotero_export',
          { refs, format: 'bibtex' },
          {
            meta: {
              format: 'bibtex',
              requested: 50,
              refs: refs.slice(0, 20),
              refsOmitted: 30,
            },
            content: [{ type: 'text', text: 'bib' }],
          },
        ),
      ])
      expect(workspace.exports[0]!.refs).toHaveLength(50)
      expect(workspace.exports[0]!.refsOmitted).toBe(0)
      expect(workspace.sources).toHaveLength(50)
      for (const source of workspace.sources) {
        expect(source.exports.length).toBe(1)
      }
    })

    it('keeps the projection refsOmitted only for the meta-preview fallback', () => {
      const refs = Array.from({ length: 25 }, (_, index) =>
        REF(`C${String(index).padStart(2, '0')}`),
      )
      const workspace = buildSourceWorkspace([
        settled({
          callId: 'e1',
          seq: 1,
          call: { name: 'zotero_export', argsRaw: '' },
          meta: { format: 'ris', requested: 25, refs: refs.slice(0, 20), refsOmitted: 5 },
          content: [{ type: 'text', text: 'TY - JOUR' }],
        }),
      ])
      expect(workspace.exports[0]!.refs).toHaveLength(20)
      expect(workspace.exports[0]!.refsOmitted).toBe(5)
    })
  })

  describe('attachment resolution and hint precedence', () => {
    it('resolves an attachment location only from a successful call', () => {
      const workspace = buildSourceWorkspace([
        block(
          'a1',
          1,
          'zotero_attachment',
          { ref: REF('A1') },
          {
            meta: {
              kind: 'file',
              title: 'a.pdf',
              contentType: 'application/pdf',
              ref: 'zotero://user/0/attachment/WXYZ6789',
              path: '/tmp/a.pdf',
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.attachment !== undefined).toBe(true)
      expect(workspace.sources[0]!.attachment).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        kind: 'file',
        contentType: 'application/pdf',
        title: 'a.pdf',
        location: '/tmp/a.pdf',
      })
    })

    it('adopts the attachment selection a get reports', () => {
      const workspace = buildSourceWorkspace([
        block(
          'g1',
          1,
          'zotero_get',
          { ref: REF('A1') },
          {
            meta: {
              title: 'T',
              bestAttachment: {
                ref: 'zotero://user/0/attachment/WXYZ6789',
                contentType: 'application/pdf',
              },
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.bestAttachment).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
      })
    })

    it('ignores an attachment without meta or without a usable arm', () => {
      const workspace = buildSourceWorkspace([
        block('a1', 1, 'zotero_attachment', { ref: REF('A1') }, {}),
        block('a2', 2, 'zotero_attachment', { ref: REF('A2') }, { meta: { kind: 'other' } }),
      ])
      expect(workspace.sources).toHaveLength(2)
      expect(workspace.sources.every((item) => item.attachment === undefined)).toBe(true)
    })

    it('resolves a degraded attachment without a title, location, or ref', () => {
      const workspace = buildSourceWorkspace([
        block(
          'a1',
          1,
          'zotero_attachment',
          { ref: REF('A1') },
          { meta: { kind: 'url', contentType: 'text/html' } },
        ),
      ])
      expect(workspace.sources[0]!.attachment !== undefined).toBe(true)
      expect(workspace.sources[0]!.attachment).toEqual({
        kind: 'url',
        contentType: 'text/html',
        title: '',
        location: '',
      })
    })

    it('keeps the first attachment hint a search surfaced', () => {
      const searchRowMeta = (attachmentRef: string) => ({
        returned: 1,
        total: 1,
        nextOffset: null,
        displayed: 1,
        omitted: 0,
        noteMatches: null,
        items: [
          {
            ref: REF('A1'),
            title: 'T',
            creatorSummary: 'C',
            year: 2020,
            itemType: 'journalArticle',
            bestAttachmentRef: attachmentRef,
          },
        ],
      })
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          { meta: searchRowMeta('zotero://user/0/attachment/WXYZ6789') },
        ),
        block(
          's2',
          2,
          'zotero_search',
          { query: 'attention', offset: 1 },
          { meta: searchRowMeta('zotero://user/0/attachment/OTHER99') },
        ),
      ])
      expect(workspace.sources[0]!.bestAttachment).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
      })
    })

    it('keeps the content type of the first attachment hint a search surfaced', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A1'),
                  title: 'T',
                  creatorSummary: 'C',
                  year: 2020,
                  itemType: 'journalArticle',
                  bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
                  bestAttachmentType: 'application/pdf',
                },
              ],
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.bestAttachment).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
      })
    })
  })

  describe('operation counters', () => {
    it('counts running calls as operations and never as facts', () => {
      const workspace = buildSourceWorkspace([
        running({ callId: 'g1', name: 'zotero_get', argsRaw: JSON.stringify({ ref: REF('A1') }) }),
      ])
      expect(workspace.sources).toHaveLength(1)
      expect(workspace.sources[0]!.facts).toEqual({
        reportedEvidenceCount: 0,
      })
      expect(workspace.sources[0]!.operations).toEqual({ running: 1, failed: 0, stopped: 0 })
    })

    it('counts failed and stopped calls in operations, never as achievements', () => {
      const workspace = buildSourceWorkspace([
        block(
          'g1',
          1,
          'zotero_get',
          { ref: REF('A1') },
          { isError: true, error: { name: 'ZoteroError', code: 'ZOTERO_NOT_FOUND' } },
        ),
        block(
          'r1',
          2,
          'zotero_retrieve',
          { ref: REF('A2') },
          { isError: true, error: { name: 'Interrupted', code: 'interrupted' } },
        ),
      ])
      const failed = workspace.sources.find((item) => item.key.includes('a1'))
      const stopped = workspace.sources.find((item) => item.key.includes('a2'))
      expect(failed?.operations).toEqual({ running: 0, failed: 1, stopped: 0 })
      expect(failed?.title).toBeUndefined()
      expect(stopped?.operations).toEqual({ running: 0, failed: 0, stopped: 1 })
    })

    it('creates no artifact from running, failed, stopped, or text-less exports', () => {
      const workspace = buildSourceWorkspace([
        running({
          callId: 'e1',
          name: 'zotero_export',
          argsRaw: JSON.stringify({ refs: [REF('A1')] }),
        }),
        block(
          'e2',
          2,
          'zotero_export',
          { refs: [REF('A2')] },
          { isError: true, error: { name: 'ZoteroError', code: 'ZOTERO_OUTPUT_TOO_LARGE' } },
        ),
        block('e3', 3, 'zotero_export', { refs: [REF('A3')] }, { content: [] }),
        block(
          'e4',
          4,
          'zotero_export',
          { refs: [REF('A4')] },
          { isError: true, error: { name: 'Interrupted', code: 'interrupted' } },
        ),
      ])
      expect(workspace.exports).toEqual([])
      expect(workspace.exportOperations).toEqual({ running: 1, failed: 1, stopped: 1 })
      const a1 = workspace.sources.find((item) => item.key.includes('a1'))
      const a2 = workspace.sources.find((item) => item.key.includes('a2'))
      expect(a1?.operations.running).toBe(1)
      expect(a1?.exports.length).toBe(0)
      expect(a2?.operations.failed).toBe(1)
      expect(a2?.exports.length).toBe(0)
    })

    it('creates no sources from a running export with unusable arguments', () => {
      const workspace = buildSourceWorkspace([
        running({ callId: 'e1', name: 'zotero_export', argsRaw: '{}' }),
      ])
      expect(workspace.sources).toEqual([])
      expect(workspace.exportOperations).toEqual({ running: 1, failed: 0, stopped: 0 })
    })
  })
})
