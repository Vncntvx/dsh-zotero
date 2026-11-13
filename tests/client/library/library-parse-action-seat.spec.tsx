// @vitest-environment jsdom
/**
 * Inspector branches that the parse seat introduced or now depends on: an item
 * without a PDF keeps no parse action, a thrown non-Error attachment failure
 * still lands in the row's error state, and the insert-with-abstract
 * preference rides the same action row.
 */
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS, LIBRARY_SECTIONS } from '../../../src/library-preferences.ts'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import type { ZoteroAttachmentLocationView, ZoteroItemDetailView } from '../../../src/contract.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

function mount(
  detail: ZoteroItemDetailView,
  options: {
    parse?: Pick<Parameters<typeof LibraryInspector>[0], 'parsePdf' | 'parsedArtifact'>
    inputActions?: InputActions
    preferences?: Record<string, unknown>
    resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  } = {},
) {
  render(
    <LibraryPreferencesContext.Provider
      value={{
        preferences: {
          ...LIBRARY_DEFAULTS,
          detailExpandedSections: LIBRARY_SECTIONS,
          ...options.preferences,
        },
      }}
    >
      <LibraryInspector
        t={mockT}
        inspector={{ phase: 'ready', detail }}
        retry={vi.fn()}
        pageChild={vi.fn()}
        childStates={{}}
        retryChild={vi.fn()}
        inputActions={options.inputActions}
        openFile={undefined}
        resolveAttachment={options.resolveAttachment}
        {...options.parse}
      />
    </LibraryPreferencesContext.Provider>,
  )
}

const inputActions = () =>
  ({
    insertQuote: vi.fn(() => true),
    captureInsertion: vi.fn(),
    insertText: vi.fn(),
    setDraft: vi.fn(),
    persistDraft: vi.fn(),
  }) as unknown as InputActions & { insertQuote: ReturnType<typeof vi.fn> }

describe('the parse action seat', () => {
  it('renders no parse action for an item without a PDF', async () => {
    const parsePdf = vi.fn()
    const { attachments: _attachments, bestAttachment: _best, ...detail } = ITEM_DETAIL
    mount(detail, { parse: { parsePdf } })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: zh.libraryParsePdf })).toBeNull()
    expect(parsePdf).not.toHaveBeenCalled()
  })

  it('keeps a plain submit action when no artifact reader is available', async () => {
    const parsePdf = vi.fn()
    mount(ITEM_DETAIL, { parse: { parsePdf } })
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: zh.libraryParsePdfNamed.replace('{title}', 'paper.pdf'),
      }),
    )
    expect(parsePdf).toHaveBeenCalledTimes(1)
  })

  it('stringifies a thrown non-Error attachment failure into the row error', async () => {
    mount(ITEM_DETAIL, {
      resolveAttachment: async () => {
        throw 'plain failure'
      },
    })
    const row = screen.getByRole('button', { name: 'paper.pdf' })
    fireEvent.click(row)
    await vi.waitFor(() => {
      expect(row.getAttribute('title')).toBe('plain failure')
    })
  })

  it('inserts the abstract with the item facts when the preference asks for it', () => {
    const actions = inputActions()
    mount(ITEM_DETAIL, {
      inputActions: actions,
      preferences: { chatInsertContent: 'referenceAndAbstract' },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.libraryAskInChat }))
    expect(actions.insertQuote).toHaveBeenCalledWith(expect.stringContaining('Faster attention.'))
    expect(
      (actions as unknown as { persistDraft: ReturnType<typeof vi.fn> }).persistDraft,
    ).toHaveBeenCalled()
  })
})
