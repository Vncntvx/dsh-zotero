// @vitest-environment jsdom
/**
 * The parsed-document tab reads the whole artifact on open — page after page,
 * without a manual "read more" — renders it, and turns a text selection into
 * one instruction the composer carries.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  ParsedDocumentTab,
  type ParsedArtifactRead,
  type ParsedDocumentTabProps,
} from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../../../src/contract.ts'
import type { ZoteroDocumentArtifactResultView } from '../../../src/contract.ts'
import { parsedTabAddress } from '../../../src/client/parsed-tab.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { deferred } from '../../helpers/sync.ts'
import { observable, parseJobs, parseRemote } from '../enrichment/support/parse-ports.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

afterEach(cleanup)

// jsdom implements no Range geometry; the menu anchors on the selection rect.
Range.prototype.getBoundingClientRect = () =>
  ({ x: 12, y: 30, left: 12, top: 30, right: 12, bottom: 30, width: 0, height: 0 }) as DOMRect

const SESSION = 'session-1'
const REF = `${attachmentRef('PDF00001')}?server=S1`
const ADDRESS = parsedTabAddress({ sessionId: SESSION, ref: REF, title: 'Paper' })
// The first page ends on a blank line, so the tail is its own paragraph.
const HEAD = `# Title\n\n${'h'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS - 9)}\n\n`
const TAIL = 'tail paragraph'

const READY = {
  kind: 'ready' as const,
  sourceId: 'a'.repeat(64),
  targetLabel: 'Paper',
  mode: 'free' as const,
  artifactId: 'b'.repeat(64),
  fingerprint: 'c'.repeat(64),
  characterCount: HEAD.length + TAIL.length,
  pageCount: 18,
}

function pagedRead(
  pages: (offset: number) => RemoteResult<ZoteroDocumentArtifactResultView>,
): Mock<ParsedArtifactRead> {
  return vi.fn<ParsedArtifactRead>(async (request) => pages(request.read?.offset ?? -1))
}

function allPages(overrides: Partial<typeof READY> = {}) {
  return pagedRead((offset) => ({
    ok: true,
    value: {
      ...READY,
      ...overrides,
      page: {
        offset,
        text: offset === 0 ? HEAD : offset === HEAD.length ? TAIL : '',
        totalChars: HEAD.length + TAIL.length,
      },
    },
  }))
}

function inputActions() {
  return {
    insertQuote: vi.fn(() => true),
    captureInsertion: vi.fn(),
    insertText: vi.fn(),
    setDraft: vi.fn(),
    persistDraft: vi.fn(),
  } as unknown as InputActions & { insertQuote: Mock; persistDraft: Mock }
}

function mount(
  read: Mock<ParsedArtifactRead>,
  options: {
    address?: string
    actions?: InputActions
    parse?: boolean
    item?: (request: unknown, signal?: AbortSignal) => Promise<{ ok: true; value: unknown }>
  } = {},
) {
  const props = {
    t: mockT,
    sessionId: SESSION,
    read,
    inputActions: options.actions,
    useSession: (selector: (snapshot: { removed: boolean }) => unknown) =>
      selector({ removed: false }),
    useAccess: () => true,
    ...(options.item !== undefined ? { item: options.item } : {}),
    ...(options.parse === true
      ? {
          parse: {
            remote: parseRemote(),
            jobs: parseJobs().jobs,
            deployment: observable({
              mounted: true,
              connected: true,
              mode: 'free' as const,
              maxFileBytes: 10 * 1024 * 1024,
              maxPages: 20,
              error: undefined,
            }),
            recall: () => undefined,
            recentUrl: () => undefined,
            clearSession: () => {},
          },
        }
      : {}),
    useTabInfo: () => ({
      tab: {
        navigation: { address: options.address ?? ADDRESS },
        actions: { bindCommands: () => () => {} },
      },
    }),
  } as unknown as ParsedDocumentTabProps
  return render(<ParsedDocumentTab {...props} />)
}

/** Put one paragraph of the document under the user's selection. */
function select(text: string) {
  const paragraph = screen.getByText(text)
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
}

describe('the parsed-document tab', () => {
  it('reads every page on open and renders the complete document', async () => {
    const read = allPages()
    mount(read)
    await act(async () => {})
    expect(read.mock.calls.map((call) => call[0].read)).toEqual([
      { offset: 0 },
      { offset: HEAD.length },
    ])
    expect(screen.getByText(/tail paragraph/)).toBeDefined()
    const total = HEAD.length + TAIL.length
    expect(screen.getByText(`${total} / ${total} 字符 · 18 页`)).toBeDefined()
    // Complete text: both document actions are available without another click.
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedCopy') }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedDownload') }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('raises a menu at the selection and explains the passage from it', async () => {
    const read = allPages()
    const actions = inputActions()
    mount(read, { actions })
    await act(async () => {})
    expect(screen.queryByRole('menu')).toBeNull()

    select(TAIL)
    const menu = screen.getByRole('menu')
    // The menu sits just under the selection, not in a fixed corner.
    expect(menu.getAttribute('style')).toContain('left: 12px')
    expect(menu.getAttribute('style')).toContain('top: 36px')
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(actions.insertQuote).toHaveBeenCalledWith(
      // The instruction, the passage, then what the page knows of the paper.
      `${mockT('parsedExplainPrompt')}\n\n${TAIL}\n\nPaper`,
    )
    expect(actions.persistDraft).toHaveBeenCalledTimes(1)
    // The instruction is spent, so the menu retires with the selection.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('cites the paper and its item ref so the model can judge in context', async () => {
    const actions = inputActions()
    const item = vi.fn(async () => ({ ok: true as const, value: ITEM_DETAIL }))
    mount(allPages(), {
      actions,
      item,
      address: parsedTabAddress({
        sessionId: SESSION,
        ref: REF,
        title: ITEM_DETAIL.title,
        item: ITEM_DETAIL.ref,
      }),
    })
    await act(async () => {})
    select(TAIL)
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(item).toHaveBeenCalledWith(
      { ref: ITEM_DETAIL.ref, include: [] },
      expect.any(AbortSignal),
    )
    const inserted = actions.insertQuote.mock.calls[0]![0] as string
    expect(inserted).toContain(mockT('parsedExplainPrompt'))
    expect(inserted).toContain(TAIL)
    // Title, creators, venue/year, and the DOI give the model the paper.
    expect(inserted).toContain(ITEM_DETAIL.title)
    expect(inserted).toContain('NeurIPS')
    expect(inserted).toContain('DOI: 10.0/example')
    // The item ref lets it read the rest through the read tools.
    expect(inserted).toContain(ITEM_DETAIL.ref)
  })

  it('copies the selection from the same menu', async () => {
    mount(allPages())
    await act(async () => {})
    select(TAIL)
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedCopySelection') }))
    await act(async () => {})
    expect(clipboardWrites).toHaveBeenCalledWith(TAIL)
  })

  it('keeps an insertion failure in place and leaves the selection usable', async () => {
    const actions = inputActions()
    ;(actions.insertQuote as ReturnType<typeof vi.fn>).mockReturnValue(false)
    mount(allPages(), { actions })
    await act(async () => {})
    select(TAIL)
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    expect(screen.getByRole('alert').textContent).toBe(mockT('libraryInsertFailed'))
    expect(actions.persistDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeDefined()
  })

  it('ignores a selection made outside the document', async () => {
    mount(allPages())
    await act(async () => {})
    const range = document.createRange()
    range.selectNodeContents(screen.getByRole('heading', { name: 'Paper' }))
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape and leaves it on any other key', async () => {
    mount(allPages())
    await act(async () => {})
    select(TAIL)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the menu inert without a composer to instruct', async () => {
    mount(allPages())
    await act(async () => {})
    select(TAIL)
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    // No session input face: the selection stays and nothing is reported.
    expect(screen.getByRole('menu')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops a figure read the tab no longer needs', async () => {
    const pending = deferred<Awaited<ReturnType<ParsedArtifactRead>>>()
    let calls = 0
    const read = vi.fn<ParsedArtifactRead>(async (request) => {
      if (request.image !== undefined) return pending.promise
      calls += 1
      const text = '![kept](images/kept.png)'
      return {
        ok: true,
        value: {
          ...READY,
          characterCount: text.length,
          page: { offset: 0, text, totalChars: text.length },
        },
      }
    })
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late')
    try {
      const view = mount(read)
      await act(async () => {})
      expect(calls).toBe(1)
      view.unmount()
      pending.resolve({ ok: true, value: { kind: 'image-missing' } })
      await act(async () => {})
      // Nothing was drawn after the tab closed; the guard ended the walk.
      expect(created).not.toHaveBeenCalled()
    } finally {
      created.mockRestore()
    }
  })

  it('retires the menu when the pane scrolls', async () => {
    mount(allPages())
    await act(async () => {})
    select(TAIL)
    expect(screen.getByRole('menu')).toBeDefined()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('copies the complete text from the toolbar and says so', async () => {
    mount(allPages())
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedCopy') }))
    await act(async () => {})
    const copied = clipboardWrites.mock.calls[0]?.[0] as string
    expect(copied.length).toBe(HEAD.length + TAIL.length)
    expect(copied.endsWith(TAIL)).toBe(true)
    expect(screen.getByRole('button', { name: mockT('libraryParsedCopied') })).toBeDefined()
  })

  it('downloads the complete text', async () => {
    mount(allPages())
    await act(async () => {})
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:markdown')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedDownload') }))
      expect(created).toHaveBeenCalledTimes(1)
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
  })

  it('keeps the caption when a figure read fails', async () => {
    const read = vi.fn<ParsedArtifactRead>(async (request) => {
      if (request.image !== undefined) throw new Error('Figure unavailable')
      const text = '![kept](images/kept.png)'
      return {
        ok: true,
        value: {
          ...READY,
          characterCount: text.length,
          page: { offset: 0, text, totalChars: text.length },
        },
      }
    })
    mount(read)
    await act(async () => {})
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('loads without a refresh command when the tab exposes none', async () => {
    const read = allPages()
    const props = {
      t: mockT,
      sessionId: SESSION,
      read,
      useSession: (selector: (snapshot: { removed: boolean }) => unknown) =>
        selector({ removed: false }),
      useAccess: () => true,
      useTabInfo: () => ({ tab: { navigation: { address: ADDRESS } } }),
    } as unknown as ParsedDocumentTabProps
    render(<ParsedDocumentTab {...props} />)
    await act(async () => {})
    expect(screen.getByText(/tail paragraph/)).toBeDefined()
  })

  it('offers another read when a page returns nothing', async () => {
    let calls = 0
    const read = pagedRead((offset) => {
      calls += 1
      return {
        ok: true,
        value: {
          ...READY,
          characterCount: HEAD.length + 100,
          page: { offset, text: calls === 1 ? HEAD : '', totalChars: HEAD.length + 100 },
        },
      }
    })
    mount(read)
    await act(async () => {})
    // An empty page ends the pass, so the text is incomplete and paging stays available.
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedCopy') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReadMore') }))
    await act(async () => {})
    expect(read.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ read: { offset: HEAD.length } }),
    )
  })

  it('re-reads from the first page on demand and on the tab refresh command', async () => {
    const bindCommands = vi.fn<(commands: { refresh: () => void }) => () => void>(() => () => {})
    const read = allPages()
    const props = {
      t: mockT,
      sessionId: SESSION,
      read,
      useSession: (selector: (snapshot: { removed: boolean }) => unknown) =>
        selector({ removed: false }),
      useAccess: () => true,
      useTabInfo: () => ({
        tab: {
          navigation: { address: ADDRESS },
          actions: { bindCommands },
        },
      }),
    } as unknown as ParsedDocumentTabProps
    render(<ParsedDocumentTab {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(4)
    act(() => bindCommands.mock.calls[0]![0].refresh())
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(6)
  })

  it('leaves an empty artifact body blank instead of spinning forever', async () => {
    const read = pagedRead((offset) => ({
      ok: true,
      value: { ...READY, characterCount: 0, page: { offset, text: '', totalChars: 0 } },
    }))
    mount(read)
    await act(async () => {})
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedCopy') }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('draws a figure the artifact carries and keeps the caption when it does not', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const read = vi.fn<ParsedArtifactRead>(async (request) => {
      if (request.image !== undefined) {
        return request.image.name === 'images/kept.png'
          ? {
              ok: true,
              value: {
                kind: 'image',
                name: request.image.name,
                mediaType: 'image/png',
                // jsdom has no Node Buffer; the browser encoder is the one under test anyway.
                base64: btoa(String.fromCharCode(...png)),
              },
            }
          : { ok: true, value: { kind: 'image-missing' } }
      }
      const text = '# Figures\n\n![kept](images/kept.png)\n\n![lost](images/lost.png)'
      return {
        ok: true,
        value: {
          ...READY,
          characterCount: text.length,
          page: { offset: 0, text, totalChars: text.length },
        },
      }
    })
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      const view = mount(read)
      await act(async () => {})
      expect(
        read.mock.calls.flatMap((call) =>
          call[0].image === undefined ? [] : [call[0].image.name],
        ),
      ).toEqual(['images/kept.png', 'images/lost.png'])
      const image = screen.getByRole('img')
      expect(image.getAttribute('src')).toBe('blob:kept')
      // The figure the artifact lacks never becomes a broken frame.
      expect(screen.queryByAltText('lost')).toBeNull()
      view.unmount()
      expect(revoked).toHaveBeenCalledWith('blob:kept')
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
  })

  it('reports a read failure in place', async () => {
    const read = pagedRead(() => ({
      ok: false,
      error: new RemoteError('zotero/enrichment', 'Task store unreadable', {
        code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
      }),
    }))
    mount(read)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('Task store unreadable')
  })

  it('reports a page that does not continue the loaded text', async () => {
    const read = pagedRead((offset) => ({
      ok: true,
      value: {
        ...READY,
        page: { offset: offset + 5, text: TAIL, totalChars: 99 },
      },
    }))
    mount(read)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain(mockT('libraryParsedNoPage'))
  })

  it('says the artifact is gone instead of rendering nothing', async () => {
    const read = pagedRead(() => ({ ok: true, value: { kind: 'expired' } }))
    mount(read)
    await act(async () => {})
    expect(screen.getByText(mockT('parsedUnavailable'))).toBeDefined()
  })

  it('renders the unavailable state when the tab carries no address at all', async () => {
    const read = allPages()
    const props = {
      t: mockT,
      sessionId: SESSION,
      read,
      useSession: (selector: (snapshot: { removed: boolean }) => unknown) =>
        selector({ removed: false }),
      useAccess: () => true,
      useTabInfo: () => undefined,
    } as unknown as ParsedDocumentTabProps
    render(<ParsedDocumentTab {...props} />)
    await act(async () => {})
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByText(mockT('parsedUnavailable'))).toBeDefined()
    // No document means no actions at all, not disabled ones.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps a fresh-parse entry off a page with no resolvable PDF', async () => {
    mount(allPages(), { parse: true, address: 'dsh-resource://plan/session-1/call-1' })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: mockT('libraryParsedReparse') })).toBeNull()
  })

  it('stringifies a non-Error read failure', async () => {
    const read = vi.fn<ParsedArtifactRead>(async () => {
      throw 'plain failure'
    })
    mount(read)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('plain failure')
  })

  it('retires a read the reload superseded', async () => {
    const first = deferred<RemoteResult<ZoteroDocumentArtifactResultView>>()
    let call = 0
    const read = vi.fn<ParsedArtifactRead>(async (request) => {
      call += 1
      if (call === 1) return first.promise
      return {
        ok: true,
        value: {
          ...READY,
          page: { offset: request.read?.offset ?? 0, text: 'fresh text', totalChars: 10 },
        },
      }
    })
    mount(read)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
    await act(async () => {})
    first.resolve({
      ok: true,
      value: { ...READY, page: { offset: 0, text: 'stale text', totalChars: 10 } },
    })
    await act(async () => {})
    expect(screen.getByText('fresh text')).toBeDefined()
    expect(screen.queryByText('stale text')).toBeNull()
  })

  it('names a document with no title from the fallback copy', async () => {
    const address = parsedTabAddress({ sessionId: SESSION, ref: REF, title: '' })
    mount(allPages({ targetLabel: '' }), { parse: true, address })
    await act(async () => {})
    expect(screen.getByRole('heading', { name: mockT('tabParsedFallback') })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReparse') }))
    await act(async () => {})
    expect(document.querySelector('[data-parse-target-label]')?.textContent).toBe(
      mockT('tabParsedFallback'),
    )
  })

  it('reports a read that throws', async () => {
    const read = vi.fn<ParsedArtifactRead>(async () => {
      throw new Error('Transport closed')
    })
    mount(read)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('Transport closed')
  })

  it('omits the page count when the artifact does not report one', async () => {
    const text = 'no page count'
    const read = pagedRead((offset) => ({
      ok: true,
      value: {
        ...READY,
        pageCount: undefined,
        characterCount: text.length,
        page: { offset, text, totalChars: text.length },
      },
    }))
    mount(read)
    await act(async () => {})
    expect(screen.getByText(`${text.length} / ${text.length} 字符`)).toBeDefined()
    expect(screen.queryByText(new RegExp(mockT('libraryParsedPages', { count: 18 })))).toBeNull()
  })

  it('renders the unavailable state for an address it does not own', async () => {
    const read = allPages()
    mount(read, { address: 'dsh-resource://plan/session-1/call-1' })
    await act(async () => {})
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByText(mockT('parsedUnavailable'))).toBeDefined()
  })

  it('offers a fresh parse of the same PDF through the panel dialog', async () => {
    mount(allPages(), { parse: true })
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReparse') }))
    await act(async () => {})
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(document.querySelector('[data-parse-target-label]')?.textContent).toBe('Paper')
  })

  it('renders MinerU inline HTML instead of showing its tags', async () => {
    const read = pagedRead((offset) => ({
      ok: true,
      value: {
        ...READY,
        characterCount: 16,
        page: { offset, text: 'Suo <sup>a</sup>', totalChars: 16 },
      },
    }))
    mount(read)
    await act(async () => {})
    expect(screen.getByText(/Suo/)).toBeDefined()
    expect(screen.queryByText(/<sup>/)).toBeNull()
  })
})
