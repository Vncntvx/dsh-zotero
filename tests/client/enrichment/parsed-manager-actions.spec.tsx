// @vitest-environment jsdom
/** Manager tab actions: abortable discards, missing feedback, denial and dialog-driven refresh. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ParsedManagerTab,
  ParsedManagerTitle,
  type ParsedManagerTabProps,
} from '../../../src/client/enrichment/ParsedManagerTab.tsx'
import { parsedManagerTabAddress } from '../../../src/client/parsed-manager-tab.ts'
import { en } from '../../../src/client/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

const ID = 'a'.repeat(64)
const row = {
  artifactId: ID,
  state: 'indexed',
  sourceKind: 'attachment',
  targetLabel: 'zotero://user/0/item/ABC/attachment/DEF',
  mode: 'free',
  generation: '11111111-1111-4111-8111-111111111111',
  fingerprint: 'f'.repeat(64),
  characterCount: 1200,
  pageCount: 7,
  images: [{ name: 'images/f.png', mediaType: 'image/png', bytes: 10 }],
  markdownBytes: 1200,
  committedAt: 1_700_000_000_000,
  aliases: [ID],
  actionable: true,
}

type ListResult =
  { ok: true; value: { rows: (typeof row)[]; total: number } } | { ok: false; error: Error }

function world(
  options: {
    list?: ListResult | (() => Promise<ListResult>)
    discard?:
      | { ok: true; value: { kind: string; removedAliases: number; removedReceipts: number } }
      | { ok: false; error: Error }
    access?: (action: string) => boolean
  } = {},
) {
  const management = {
    listParsedDocuments: vi.fn(async () =>
      typeof options.list === 'function'
        ? await options.list()
        : (options.list ?? { ok: true, value: { rows: [row], total: 1 } }),
    ),
    discardParsedDocument: vi.fn(
      async (_request, signal?: AbortSignal) =>
        options.discard ?? {
          ok: true,
          value: { kind: 'discarded', removedAliases: 1, removedReceipts: 0 },
        },
    ),
  }
  const DEPLOYMENT = { mounted: true }
  const props = {
    t: makeTranslate(en),
    useAccess: options.access ?? (() => true),
    useSession: () => false,
    useTabInfo: () => ({
      tab: { navigation: { address: parsedManagerTabAddress({ sessionId: 's1' }), params: {} } },
    }),
    management,
    parse: {
      deployment: { subscribe: () => () => {}, getSnapshot: () => DEPLOYMENT },
      remote: {},
      jobs: {},
      recall: () => undefined,
      recentUrl: () => undefined,
      clearSession: () => {},
    },
    openParsed: vi.fn(),
    discarded: vi.fn(),
  } as unknown as ParsedManagerTabProps
  render(<ParsedManagerTab {...props} />)
  return { management, props }
}

const confirmDiscard = () => {
  fireEvent.click(screen.getByRole('button', { name: en.parsedManagerDelete }))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: en.parsedManagerDeleteConfirm }),
  )
}

const MOUNTED = { mounted: true }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('parsed document manager actions', () => {
  it('aborts an in-flight discard when the tab unmounts', async () => {
    const release = deferred<void>()
    const signals: AbortSignal[] = []
    const management = {
      listParsedDocuments: vi.fn(async () => ({ ok: true, value: { rows: [row], total: 1 } })),
      discardParsedDocument: vi.fn(async (_request, signal?: AbortSignal) => {
        signals.push(signal!)
        await release.promise
        return { ok: true, value: { kind: 'discarded', removedAliases: 1, removedReceipts: 0 } }
      }),
    }
    const props = {
      t: makeTranslate(en),
      useAccess: () => true,
      useSession: () => false,
      useTabInfo: () => ({
        tab: { navigation: { address: parsedManagerTabAddress({ sessionId: 's1' }), params: {} } },
      }),
      management,
      parse: {
        deployment: { subscribe: () => () => {}, getSnapshot: () => MOUNTED },
        remote: {},
        jobs: {},
        recall: () => undefined,
        recentUrl: () => undefined,
        clearSession: () => {},
      },
      openParsed: vi.fn(),
      discarded: vi.fn(),
    } as unknown as ParsedManagerTabProps
    const rendered = render(<ParsedManagerTab {...props} />)
    await screen.findByText(ID.slice(0, 8))
    confirmDiscard()
    rendered.unmount()
    release.resolve()
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true))
    // The aborted discard neither refreshes the list nor reports a failure.
    expect(management.listParsedDocuments).toHaveBeenCalledTimes(1)
  })

  it('reports an already-missing artifact instead of staying silent', async () => {
    const { props } = world({
      discard: { ok: true, value: { kind: 'missing', removedAliases: 0, removedReceipts: 0 } },
    })
    await screen.findByText(ID.slice(0, 8))
    confirmDiscard()
    expect(await screen.findByText(en.parsedManagerMissing)).toBeDefined()
    expect(props.discarded as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('renders a denial instead of an empty list when listing is not authorized', async () => {
    world({ access: (action) => action !== 'zotero/listParsedDocuments' })
    expect(await screen.findByText(en.parsedManagerDenied)).toBeDefined()
    expect(screen.queryByRole('button', { name: en.parsedManagerOpen })).toBeNull()
  })

  it('refetches the list when the reparse dialog closes', async () => {
    const { management } = world()
    await screen.findByText(ID.slice(0, 8))
    fireEvent.click(screen.getByRole('button', { name: en.libraryParsedReparse }))
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.parseClose }))
    await vi.waitFor(() => expect(management.listParsedDocuments).toHaveBeenCalledTimes(2))
  })
})

describe('parsed document manager edge inputs', () => {
  const propsOf = (address: string) => {
    const management = {
      listParsedDocuments: vi.fn(async () => ({ ok: true, value: { rows: [], total: 0 } })),
      discardParsedDocument: vi.fn(async () => ({ ok: true, value: { kind: 'missing' } })),
    }
    const DEPLOYMENT = { mounted: true }
    return {
      props: {
        t: makeTranslate(en),
        useAccess: () => true,
        useSession: () => false,
        useTabInfo: () => ({ tab: { navigation: { address, params: {} } } }),
        management,
        parse: {
          deployment: { subscribe: () => () => {}, getSnapshot: () => DEPLOYMENT },
          remote: {},
          jobs: {},
          recall: () => undefined,
          recentUrl: () => undefined,
          clearSession: () => {},
        },
        openParsed: vi.fn(),
        discarded: vi.fn(),
      } as unknown as ParsedManagerTabProps,
      management,
    }
  }

  it('falls back to the chip title for an address the manager does not own', () => {
    render(
      <ParsedManagerTitle
        {...({
          t: makeTranslate(en),
          useTabInfo: () => ({ tab: { navigation: { address: 'dsh-resource://plan/s1' } } }),
        } as unknown as ComponentProps<typeof ParsedManagerTitle>)}
      />,
    )
    expect(screen.getByText(en.tabParsedManagerFallback)).toBeDefined()
  })

  it('stays unavailable for an unowned tab address', () => {
    const { props } = propsOf('dsh-resource://plan/s1')
    render(<ParsedManagerTab {...props} />)
    expect(screen.getByText(en.parsedManagerUnavailable)).toBeDefined()
  })

  it('labels an untitled row by its artifact id on both actions', async () => {
    // `row` carries no captured Markdown title, so the short id is the row name
    // and the full id stays on the row's own tooltip.
    const shortId = ID.slice(0, 8)
    const management = {
      listParsedDocuments: vi.fn(async () => ({
        ok: true,
        value: {
          rows: [
            {
              ...row,
              targetLabel: '',
            },
          ],
          total: 1,
        },
      })),
      discardParsedDocument: vi.fn(async () => ({
        ok: true,
        value: { kind: 'discarded', removedAliases: 1, removedReceipts: 0 },
      })),
    }
    const DEPLOYMENT = { mounted: true }
    const openParsed = vi.fn()
    render(
      <ParsedManagerTab
        {...({
          t: makeTranslate(en),
          useAccess: () => true,
          useSession: () => false,
          useTabInfo: () => ({
            tab: { navigation: { address: parsedManagerTabAddress({ sessionId: 's1' }) } },
          }),
          management,
          parse: {
            deployment: { subscribe: () => () => {}, getSnapshot: () => DEPLOYMENT },
            remote: {},
            jobs: {},
            recall: () => undefined,
            recentUrl: () => undefined,
            clearSession: () => {},
          },
          openParsed,
          discarded: vi.fn(),
        } as unknown as ParsedManagerTabProps)}
      />,
    )
    await screen.findByText(shortId)
    fireEvent.click(screen.getByRole('button', { name: en.parsedManagerOpen }))
    expect(openParsed).toHaveBeenCalledWith('s1', ID, shortId)
    fireEvent.click(screen.getByRole('button', { name: en.libraryParsedReparse }))
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('reports a non-error list refusal', async () => {
    const management = {
      listParsedDocuments: vi.fn(async () => Promise.reject('gateway blip')),
      discardParsedDocument: vi.fn(async () => ({ ok: true, value: { kind: 'missing' } })),
    }
    const DEPLOYMENT = { mounted: true }
    render(
      <ParsedManagerTab
        {...({
          t: makeTranslate(en),
          useAccess: () => true,
          useSession: () => false,
          useTabInfo: () => ({
            tab: { navigation: { address: parsedManagerTabAddress({ sessionId: 's1' }) } },
          }),
          management,
          parse: {
            deployment: { subscribe: () => () => {}, getSnapshot: () => DEPLOYMENT },
            remote: {},
            jobs: {},
            recall: () => undefined,
            recentUrl: () => undefined,
            clearSession: () => {},
          },
          openParsed: vi.fn(),
          discarded: vi.fn(),
        } as unknown as ParsedManagerTabProps)}
      />,
    )
    expect(
      await screen.findByText(en.parsedManagerError.replace('{message}', 'gateway blip')),
    ).toBeDefined()
  })
})
