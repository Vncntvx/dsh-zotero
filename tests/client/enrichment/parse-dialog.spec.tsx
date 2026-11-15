// @vitest-environment jsdom
/** Real host Modal/Input/Button rendering with controlled transport and jobs ports. */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ParseDocumentDialog } from '../../../src/client/enrichment/ParseDocumentDialog.tsx'
import {
  parseEn,
  parseTranslate,
  type ParseTranslate,
} from '../../../src/client/enrichment/parse-locales.ts'
import {
  observable,
  PARSE_JOB,
  PARSE_SELECTION,
  PARSE_SESSION,
  parseCapabilities,
  parseJob,
  parseJobs,
  parseReceipt,
  parseRemote,
} from './support/parse-ports.ts'

const sources: ReturnType<typeof observable<ReturnType<typeof parseCapabilities>>>[] = []
afterEach(() => {
  cleanup()
  sources.splice(0)
})

function mount(
  options: {
    target?: typeof PARSE_SELECTION.target
    capabilities?: Parameters<typeof parseCapabilities>[0]
    remote?: Parameters<typeof parseRemote>[0]
    t?: ParseTranslate
    strict?: boolean
  } = {},
) {
  const remote = parseRemote(options.remote)
  const boundary = parseJobs()
  const capabilities = observable(parseCapabilities(options.capabilities))
  sources.push(capabilities)
  let open = true
  const selection = { ...PARSE_SELECTION, ...(options.target ? { target: options.target } : {}) }
  const props = {
    open,
    remote,
    jobs: boundary.jobs,
    capabilities,
    selection,
    locale: 'en' as const,
    ...(options.t === undefined ? {} : { t: options.t }),
    onClose: () => {
      open = false
      rerender()
    },
  }
  const element = () =>
    options.strict ? (
      <StrictMode>
        <ParseDocumentDialog {...props} open={open} />
      </StrictMode>
    ) : (
      <ParseDocumentDialog {...props} open={open} />
    )
  const view = render(element())
  const rerender = () => view.rerender(element())
  return {
    ...view,
    ...boundary,
    remote,
    capabilities,
    reopen: () => {
      open = true
      rerender()
    },
  }
}

async function settle() {
  // Flush the promises owned by the controlled RPC port and React effects.
  await act(async () => {})
}

describe('ParseDocumentDialog confirmation', () => {
  it('refreshes artifact status from the standard Modal footer without submitting', async () => {
    const world = mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseReconnect }))
    await settle()
    expect(world.remote.documentArtifact).toHaveBeenCalledTimes(2)
    expect(world.remote.startDocumentParse).not.toHaveBeenCalled()
  })

  it('shows the facts and limits with zero starts before confirmation', async () => {
    const world = mount()
    await settle()
    expect(screen.getByRole('dialog', { name: parseEn.parseTitle })).toBeDefined()
    expect(screen.getByText(PARSE_SELECTION.label!)).toBeDefined()
    expect(screen.getByText(parseEn.parseModeFree)).toBeDefined()
    // The provider's product name comes from the dictionary, so a copy review
    // sees it with the rest of the dialog.
    expect(screen.getByText(parseEn.parseProviderValue)).toBeDefined()
    expect(screen.getByText(/10 MB.*20 pages/)).toBeDefined()
    // The pre-submit form carries one limits line and one cancel hint, not a
    // stack of disclaimers and absence notices.
    expect(screen.getByText(parseEn.parseCloseHint)).toBeDefined()
    expect(screen.queryByText('No artifact yet.')).toBeNull()
    expect(world.remote.startDocumentParse).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    expect(world.remote.startDocumentParse).toHaveBeenCalledTimes(1)
  })

  it('keeps URL secrets outside the displayed target label and disables invalid drafts', async () => {
    const world = mount({
      target: {
        kind: 'url',
        url: 'https://papers.example.org/private-signature/paper.pdf?token=query-secret#fragment-secret',
      },
    })
    await settle()
    const label = document.querySelector('[data-parse-target-label]')!
    expect(label.textContent).toBe('https://papers.example.org/…')
    expect(label.textContent).not.toContain('query-secret')
    expect(label.textContent).not.toContain('private-signature')
    fireEvent.change(screen.getByRole('textbox', { name: parseEn.parseUrl }), {
      target: { value: 'file:///tmp/paper.pdf' },
    })
    await settle()
    expect(
      (screen.getByRole('button', { name: parseEn.parseConfirm }) as HTMLButtonElement).disabled,
    ).toBe(true)
    // An unusable URL has no label; the row keeps its placeholder rather than
    // collapsing to an empty value.
    expect(document.querySelector('[data-parse-target-label]')!.textContent).toBe('—')
    expect(world.remote.startDocumentParse).not.toHaveBeenCalled()
    expect(world.remote.documentArtifact).toHaveBeenCalledTimes(1)
  })

  it('keeps component absence distinct from session denial and reacts to live capabilities', async () => {
    const world = mount()
    await settle()
    expect(
      (screen.getByRole('button', { name: parseEn.parseConfirm }) as HTMLButtonElement).disabled,
    ).toBe(false)
    act(() => world.capabilities.publish(parseCapabilities({ mounted: false })))
    expect(screen.getByText(parseEn.parseUnavailable)).toBeDefined()
    expect(
      (screen.getByRole('button', { name: parseEn.parseConfirm }) as HTMLButtonElement).disabled,
    ).toBe(true)
    act(() => world.capabilities.publish(parseCapabilities({ startAllowed: false })))
    await settle()
    expect(screen.getByText(parseEn.parsePermission)).toBeDefined()
    expect(screen.queryByText(parseEn.parseUnavailable)).toBeNull()
  })
})

describe('ParseDocumentDialog job controls', () => {
  it('closing disposes observations without killing, and reopening observes without another start', async () => {
    const world = mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseClose }))
    expect(world.stopObservation).toHaveBeenCalledTimes(1)
    expect(world.jobs.kill).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => world.reopen())
    await settle()
    expect(world.jobs.observe).toHaveBeenCalledTimes(2)
    expect(world.remote.startDocumentParse).toHaveBeenCalledTimes(1)
  })

  it('shows the roster phase as one status line, then a single cancelling line', async () => {
    const world = mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    act(() =>
      world.state.publish({
        rows: { [PARSE_SESSION]: [parseJob({ progress: 'MinerU 解析中' })] },
        observed: {},
      }),
    )
    // The real phase is the whole status line: no vague prefix stacked on it,
    // and no percentage the host never reported.
    expect(screen.getByRole('status').textContent).toBe('MinerU 解析中')
    expect(screen.queryByText(parseEn.parseRunning)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseCancel }))
    await settle()
    expect(world.jobs.kill).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
    expect(screen.getByRole('status').textContent).toBe(parseEn.parseCancelRequested)
    expect(screen.getByText(parseEn.parseCloseHint)).toBeDefined()
  })

  it('keeps a terminal job status instead of a stale roster phase', async () => {
    const world = mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    act(() =>
      world.state.publish({
        rows: {
          [PARSE_SESSION]: [parseJob({ status: 'completed', progress: 'MinerU 解析中' })],
        },
        observed: {},
      }),
    )
    const result = document.querySelector('[aria-live="polite"]')!
    expect(result.querySelector('[role="status"]')?.textContent).toBe(parseEn.parseCompleted)
    expect(screen.queryByText('MinerU 解析中')).toBeNull()
  })

  it('survives StrictMode effect replay and unmount cleanup without a kill', async () => {
    const world = mount({ strict: true })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    expect(world.jobs.observe).toHaveBeenCalledTimes(1)
    world.unmount()
    expect(world.capabilities.listenerCount()).toBe(0)
    expect(world.state.listenerCount()).toBe(0)
    expect(world.jobs.kill).not.toHaveBeenCalled()
  })
})

describe('ParseDocumentDialog receipts and artifacts', () => {
  it('renders a cached completed receipt with its facts and a reparse action', async () => {
    mount({
      remote: {
        documentParseReceipt: async () => ({
          ok: true,
          value: { kind: 'completed', receipt: parseReceipt({ cached: true }) },
        }),
      },
    })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    expect(screen.getByText(parseEn.parseCompleted)).toBeDefined()
    expect(screen.getByText(parseEn.parseCached)).toBeDefined()
    // The result stops at a compact summary; the parsed Markdown stays behind
    // the preview toggle instead of filling the dialog.
    expect(screen.getByText('9')).toBeDefined()
    expect(screen.getByText(parseEn.parsePagesUnknown)).toBeDefined()
    expect(screen.queryByText('# Preview')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parsePreview }))
    expect(screen.getByText('# Preview')).toBeDefined()
    expect(screen.getByRole('button', { name: parseEn.parseReparse })).toBeDefined()
  })

  it('renders a failed receipt with its code and offers retry', async () => {
    mount({
      remote: {
        documentParseReceipt: async () => ({
          ok: true,
          value: {
            kind: 'failed',
            code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
            message: 'MinerU refused the document',
          },
        }),
      },
    })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(parseEn.parseFailed)
    expect(alert.textContent).toContain('ZOTERO_ENRICHMENT_TASK_FAILED')
    expect(alert.textContent).toContain('MinerU refused the document')
    expect(screen.getByRole('button', { name: parseEn.parseRetry })).toBeDefined()
  })

  it('renders a cancelled receipt as one plain line and offers retry', async () => {
    mount({
      remote: {
        documentParseReceipt: async () => ({
          ok: true,
          value: {
            kind: 'cancelled',
            code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
            message: 'Document parsing was cancelled.',
          },
        }),
      },
    })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    expect(screen.getByText(parseEn.parseKilled)).toBeDefined()
    // Cancellation is an expected outcome: no error code, no English task
    // message and no second "cancellation requested" line beside it.
    expect(screen.queryByText('ZOTERO_ENRICHMENT_TASK_FAILED')).toBeNull()
    expect(screen.queryByText(/Document parsing was cancelled/)).toBeNull()
    expect(screen.queryByText(parseEn.parseCancelRequested)).toBeNull()
    // No background hint once the run has ended.
    expect(screen.queryByText(parseEn.parseCloseHint)).toBeNull()
    expect(screen.getByRole('button', { name: parseEn.parseRetry })).toBeDefined()
  })

  it('renders a ready artifact without a page count and offers reparse', async () => {
    mount({
      remote: {
        documentArtifact: async () => ({
          ok: true,
          value: {
            kind: 'ready',
            images: [],
            sourceId: 'source-1',
            targetLabel: 'Selected PDF',
            mode: 'free',
            artifactId: 'artifact-9',
            fingerprint: 'sha256-9',
            characterCount: 12,
          },
        }),
      },
    })
    await settle()
    expect(screen.getByText(parseEn.parseArtifactReady)).toBeDefined()
    expect(screen.getByText('12')).toBeDefined()
    expect(screen.getByText(parseEn.parsePagesUnknown)).toBeDefined()
    expect(screen.getByRole('button', { name: parseEn.parseReparse })).toBeDefined()
  })

  it('shows an expired artifact, and no absence notice when there is none', async () => {
    const expired = mount({
      remote: { documentArtifact: async () => ({ ok: true, value: { kind: 'expired' } }) },
    })
    await settle()
    expect(screen.getByText(parseEn.parseArtifactExpired)).toBeDefined()
    expired.unmount()
    mount()
    await settle()
    expect(screen.queryByText(parseEn.parseArtifactExpired)).toBeNull()
    expect(screen.queryByText('No artifact yet.')).toBeNull()
    expect(screen.queryByText(parseEn.parseArtifactReady)).toBeNull()
  })

  it('surfaces an observation failure as the reconnect hint', async () => {
    const world = mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    act(() =>
      world.state.publish({
        rows: { [PARSE_SESSION]: [parseJob()] },
        observed: {
          [PARSE_JOB]: {
            jobId: PARSE_JOB,
            text: '',
            gapBefore: false,
            streaming: false,
            error: 'observation lost',
          },
        },
      }),
    )
    expect(screen.getByText(parseEn.parseReconnectHint)).toBeDefined()
  })

  it('uses a host-provided translator instead of the locale default', async () => {
    mount({ t: parseTranslate('en') })
    await settle()
    expect(screen.getByRole('dialog', { name: parseEn.parseTitle })).toBeDefined()
  })
})
