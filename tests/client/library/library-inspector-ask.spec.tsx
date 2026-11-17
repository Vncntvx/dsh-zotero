// @vitest-environment jsdom
/** The inspector's ask action: PDF choice and the committed-artifact source. */
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS, LIBRARY_SECTIONS } from '../../../src/library-preferences.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import type { ZoteroItemDetailView } from '../../../src/contract.ts'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

function mountInspector(
  detail: ZoteroItemDetailView,
  inputActions: InputActions,
  parse?: Pick<Parameters<typeof LibraryInspector>[0], 'parsePdf' | 'parsedArtifact'>,
) {
  return render(
    <LibraryPreferencesContext.Provider
      value={{ preferences: { ...LIBRARY_DEFAULTS, detailExpandedSections: LIBRARY_SECTIONS } }}
    >
      <LibraryInspector
        t={mockT}
        locale={{ getSnapshot: () => ({ active: 'en' }) }}
        inspector={{ phase: 'ready' as const, detail }}
        retry={vi.fn()}
        pageChild={vi.fn()}
        childStates={{}}
        retryChild={vi.fn()}
        inputActions={inputActions}
        openFile={undefined}
        resolveAttachment={async (ref: string) => ({
          ok: true as const,
          value: {
            ref,
            kind: 'file' as const,
            title: 'paper.pdf',
            contentType: 'application/pdf',
            path: '/tmp/paper.pdf',
          },
        })}
        openProtocol={vi.fn(async () => true)}
        {...parse}
      />
    </LibraryPreferencesContext.Provider>,
  )
}

function inputActionsWith(insertQuote: (text: string) => boolean): InputActions {
  return {
    insertQuote,
    captureInsertion: vi.fn(),
    insertText: vi.fn(),
    setDraft: vi.fn(),
    persistDraft: vi.fn(),
  } as unknown as InputActions
}

describe('library inspector ask source', () => {
  it('asks the chosen PDF when the item carries several attachments', async () => {
    const insertQuote = vi.fn(() => true)
    mountInspector(
      {
        ...ITEM_DETAIL,
        attachments: {
          ...ITEM_DETAIL.attachments!,
          total: 2,
          returned: 2,
          items: [
            {
              ref: 'zotero://user/0/item/ATTAC001',
              title: 'first.pdf',
              contentType: 'application/pdf',
            },
            {
              ref: 'zotero://user/0/item/ATTAC002',
              title: 'second.pdf',
              contentType: 'application/pdf',
            },
          ],
        },
      },
      inputActionsWith(insertQuote),
    )
    fireEvent.click(screen.getByRole('button', { name: zh.libraryAskInChat }))
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: `second.pdf ${zh.libraryAskInChat}` }))
    await vi.waitFor(() => expect(insertQuote).toHaveBeenCalled())
    expect(insertQuote).toHaveBeenCalledWith(
      expect.stringContaining('"ref":"zotero://user/0/item/ATTAC002"'),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('addresses the ask with the committed artifactId when the PDF is parsed', async () => {
    const insertQuote = vi.fn(() => true)
    const artifactId = 'a'.repeat(64)
    const read = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: 'meta' as const,
        artifactId,
        fingerprint: 'f'.repeat(64),
        sourceId: 'source',
        targetLabel: 'paper.pdf',
        mode: 'free' as const,
        characterCount: 10,
        images: [],
      },
    }))
    mountInspector(ITEM_DETAIL, inputActionsWith(insertQuote), {
      parsePdf: vi.fn(),
      parsedArtifact: { sessionId: 's1', read, open: vi.fn() },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.libraryAskInChat }))
    await vi.waitFor(() => expect(insertQuote).toHaveBeenCalled())
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        op: 'meta',
        target: { kind: 'attachment', ref: 'zotero://user/0/item/ATTAC001' },
      }),
      expect.any(AbortSignal),
    )
    expect(insertQuote).toHaveBeenCalledWith(
      expect.stringContaining(`"kind":"artifactId","artifactId":"${artifactId}"`),
    )
  })

  it('falls back to the attachment ref when the artifact read reports a miss', async () => {
    const insertQuote = vi.fn(() => true)
    const read = vi.fn(async () => ({ ok: false as const, error: { message: 'offline' } }))
    mountInspector(ITEM_DETAIL, inputActionsWith(insertQuote), {
      parsePdf: vi.fn(),
      parsedArtifact: { sessionId: 's1', read: read as never, open: vi.fn() },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.libraryAskInChat }))
    await vi.waitFor(() => expect(insertQuote).toHaveBeenCalled())
    expect(insertQuote).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"ref","ref":"zotero://user/0/item/ATTAC001"'),
    )
  })

  it('falls back to the attachment ref when the artifact read throws', async () => {
    const insertQuote = vi.fn(() => true)
    const read = vi.fn(async () => {
      throw new Error('offline')
    })
    mountInspector(ITEM_DETAIL, inputActionsWith(insertQuote), {
      parsePdf: vi.fn(),
      parsedArtifact: { sessionId: 's1', read, open: vi.fn() },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.libraryAskInChat }))
    await vi.waitFor(() => expect(insertQuote).toHaveBeenCalled())
    expect(insertQuote).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"ref","ref":"zotero://user/0/item/ATTAC001"'),
    )
  })
})
