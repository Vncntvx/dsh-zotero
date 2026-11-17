// @vitest-environment jsdom
/**
 * The workspace view's pagination flows: appending sources in the sidebar,
 * appending evidence passages in the inspector, and appending session exports
 * in the exports lens.
 * @module tests/client/workspace/ZoteroWorkspaceView.pagination
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroWorkspaceView } from '../../../src/client/components/workspace/ZoteroWorkspaceView.tsx'
import type { ZoteroSourcePageResultView } from '../../../src/contract.ts'
import { artifactOf, passageOf, sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { CONNECTED } from '../helpers/workspace-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ZoteroWorkspaceView pagination', () => {
  it('pages session exports and merges them into the exports lens', async () => {
    const text1 = '@article{doc1, title={Document One}}'
    const text2 = '@article{doc2, title={Document Two}}'
    const export1 = artifactOf({
      callId: 'e-1',
      format: 'bibtex',
      text: text1,
      items: [
        {
          ref: 'zotero://user/0/item/A',
          exportKey: 'doc1',
          title: 'Document One',
          start: 0,
          end: text1.length,
        },
      ],
    })
    const export2 = artifactOf({
      callId: 'e-2',
      format: 'bibtex',
      text: text2,
      items: [
        {
          ref: 'zotero://user/0/item/B',
          exportKey: 'doc2',
          title: 'Document Two',
          start: 0,
          end: text2.length,
        },
      ],
    })
    const workspace = workspaceOf([sourceOf()], {
      exports: [export1],
      exportTotal: 2,
    })

    const pageResult: ZoteroSourcePageResultView = {
      sessionId: 'session-1',
      target: { kind: 'session', rows: 'exports' },
      revision: 1,
      offset: 1,
      limit: 50,
      total: 2,
      workspace: {
        sources: [],
        sourceTotal: 1,
        exports: [export2],
        exportTotal: 2,
        exportOperations: { running: 0, failed: 0, stopped: 0 },
        searchOperations: { running: 0, failed: 0, stopped: 0 },
        omittedRows: 0,
        filterCounts: { all: 1, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 },
        evidencePassageTotal: 0,
        exportedRefCount: 0,
      },
    }

    const sourcePage = vi.fn().mockResolvedValue({ ok: true, value: pageResult })

    render(
      <ZoteroWorkspaceView
        workspace={workspace}
        connection={CONNECTED}
        sessionId="session-1"
        sourcePage={sourcePage}
        onRefresh={vi.fn()}
        t={t}
      />,
    )

    // Switch to Exports lens
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(t('lensExports')) }))

    // Click "Show more"
    const moreBtn = screen.getByRole('button', { name: t('sourcePageMore') })
    await act(async () => {
      fireEvent.click(moreBtn)
    })

    expect(sourcePage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        target: { kind: 'session', rows: 'exports' },
        offset: 1,
      }),
      expect.anything(),
    )

    await waitFor(() => {
      expect(screen.getByText('Document One')).toBeDefined()
      expect(screen.getByText('Document Two')).toBeDefined()
    })
  })

  it('pages sources in the sidebar and appends them to the listed items', async () => {
    const source1 = sourceOf({ key: 's-1', ref: 'zotero://user/0/item/S1', title: 'First Paper' })
    const source2 = sourceOf({ key: 's-2', ref: 'zotero://user/0/item/S2', title: 'Second Paper' })
    const workspace = workspaceOf([source1], {
      sourceTotal: 2,
      filterCounts: { all: 2, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 },
    })

    const pageResult: ZoteroSourcePageResultView = {
      sessionId: 'session-1',
      target: { kind: 'sources', filter: 'all' },
      revision: 1,
      offset: 1,
      limit: 50,
      total: 2,
      workspace: {
        sources: [source2],
        sourceTotal: 2,
        exports: [],
        exportTotal: 0,
        exportOperations: { running: 0, failed: 0, stopped: 0 },
        searchOperations: { running: 0, failed: 0, stopped: 0 },
        omittedRows: 0,
        filterCounts: { all: 2, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 },
        evidencePassageTotal: 0,
        exportedRefCount: 0,
      },
    }

    const sourcePage = vi.fn().mockResolvedValue({ ok: true, value: pageResult })

    render(
      <ZoteroWorkspaceView
        workspace={workspace}
        connection={CONNECTED}
        sessionId="session-1"
        sourcePage={sourcePage}
        onRefresh={vi.fn()}
        t={t}
      />,
    )

    const moreBtn = screen.getByRole('button', { name: t('sourcePageMore') })
    await act(async () => {
      fireEvent.click(moreBtn)
    })

    expect(sourcePage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        target: { kind: 'sources', filter: 'all' },
        offset: 1,
      }),
      expect.anything(),
    )

    await waitFor(() => {
      expect(screen.getAllByText('First Paper').length).toBeGreaterThan(0)
      expect(screen.getByText('Second Paper')).toBeDefined()
    })
  })

  it('pages evidence passages for the selected source', async () => {
    const passage1 = passageOf({ text: 'First passage text' })
    const passage2 = passageOf({ text: 'Second passage text' })
    const source1 = sourceOf({
      key: 's-1',
      ref: 'zotero://user/0/item/S1',
      title: 'First Paper',
      evidence: [passage1],
      fulltextReads: [],
      evidenceTotal: 2,
      facts: { reportedEvidenceCount: 2 },
      retrievalFacts: { truncated: false, sourceAvailability: {} },
    })
    const workspace = workspaceOf([source1])

    const pageResult: ZoteroSourcePageResultView = {
      sessionId: 'session-1',
      target: { kind: 'source', key: 's-1', rows: 'evidence' },
      revision: 1,
      offset: 1,
      limit: 50,
      total: 2,
      workspace: {
        sources: [
          sourceOf({
            key: 's-1',
            ref: 'zotero://user/0/item/S1',
            evidence: [passage2],
            fulltextReads: [],
            evidenceTotal: 2,
          }),
        ],
        sourceTotal: 1,
        exports: [],
        exportTotal: 0,
        exportOperations: { running: 0, failed: 0, stopped: 0 },
        searchOperations: { running: 0, failed: 0, stopped: 0 },
        omittedRows: 0,
        filterCounts: { all: 1, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 },
        evidencePassageTotal: 0,
        exportedRefCount: 0,
      },
    }

    const sourcePage = vi.fn().mockResolvedValue({ ok: true, value: pageResult })

    render(
      <ZoteroWorkspaceView
        workspace={workspace}
        connection={CONNECTED}
        sessionId="session-1"
        sourcePage={sourcePage}
        onRefresh={vi.fn()}
        t={t}
      />,
    )

    // The evidence feed renders directly in the inspector
    const moreBtn = screen.getByRole('button', { name: t('sourcePageMore') })
    await act(async () => {
      fireEvent.click(moreBtn)
    })

    expect(sourcePage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        target: { kind: 'source', key: 's-1', rows: 'evidence' },
        offset: 1,
      }),
      expect.anything(),
    )

    await waitFor(() => {
      expect(screen.getByText('“First passage text”')).toBeDefined()
      expect(screen.getByText('“Second passage text”')).toBeDefined()
    })
  })
})

it('loads the selected deferred body and reloads it when the ledger revision changes', async () => {
  const summary = sourceOf({
    key: 'deferred',
    title: 'Deferred paper',
    evidence: [],
    evidenceTotal: 1,
    facts: { reportedEvidenceCount: 1 },
    retrievalFacts: { truncated: false, sourceAvailability: {} },
  })
  const sourcePage = vi.fn(
    async (request: import('../../../src/contract.ts').ZoteroSourcePageRequestView) => ({
      ok: true as const,
      value: {
        sessionId: request.sessionId,
        target: request.target,
        revision: sourcePage.mock.calls.length,
        offset: 0,
        limit: 50,
        total: 1,
        workspace: workspaceOf([
          {
            ...summary,
            evidence: [
              passageOf({ text: `Complete evidence revision ${sourcePage.mock.calls.length}` }),
            ],
          },
        ]),
      },
    }),
  )
  const props = { connection: CONNECTED, sessionId: 'session-1', sourcePage, onRefresh: vi.fn(), t }
  const view = render(
    <ZoteroWorkspaceView
      {...props}
      workspace={{ ...workspaceOf([summary]), detailsDeferred: true, detailsRevision: 1 }}
    />,
  )
  await screen.findByText('“Complete evidence revision 1”')
  expect(sourcePage.mock.calls[0]?.[0]).toMatchObject({
    target: { kind: 'source', key: 'deferred', rows: 'evidence' },
    offset: 0,
  })
  expect(sourcePage).toHaveBeenCalledTimes(1)
  view.rerender(
    <ZoteroWorkspaceView
      {...props}
      workspace={{ ...workspaceOf([summary]), detailsDeferred: true, detailsRevision: 2 }}
    />,
  )
  await screen.findByText('“Complete evidence revision 2”')
  expect(screen.queryByText('“Complete evidence revision 1”')).toBeNull()
  expect(sourcePage).toHaveBeenCalledTimes(2)
})
