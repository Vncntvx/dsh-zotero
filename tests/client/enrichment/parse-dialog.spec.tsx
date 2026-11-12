// @vitest-environment jsdom
/** Real host Modal/Input/Button rendering with controlled transport and jobs ports. */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ParseDocumentDialog } from '../../../src/client/enrichment/ParseDocumentDialog.tsx'
import { parseEn } from '../../../src/client/enrichment/parse-locales.ts'
import {
  observable,
  PARSE_JOB,
  PARSE_SELECTION,
  PARSE_SESSION,
  parseCapabilities,
  parseJob,
  parseJobs,
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
    strict?: boolean
  } = {},
) {
  const remote = parseRemote()
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
  it('shows target, mode, upload meaning and limits with zero starts before confirmation', async () => {
    const world = mount()
    await settle()
    expect(screen.getByRole('dialog', { name: parseEn.parseTitle })).toBeDefined()
    expect(screen.getByText(PARSE_SELECTION.label!)).toBeDefined()
    expect(screen.getByText(parseEn.parseModeFree)).toBeDefined()
    expect(screen.getByText(parseEn.parseUploadMeaning)).toBeDefined()
    // The provider's product name comes from the dictionary, so a copy review
    // sees it with the rest of the dialog.
    expect(screen.getByText(parseEn.parseProviderValue)).toBeDefined()
    expect(screen.getByText(/10485760 bytes.*20 pages/)).toBeDefined()
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

  it('explicit cancel calls host jobs and renders roster progress without invented percentages', async () => {
    const world = mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseConfirm }))
    await settle()
    act(() =>
      world.state.publish({
        rows: { [PARSE_SESSION]: [parseJob({ progress: 'Downloading result' })] },
        observed: {},
      }),
    )
    expect(screen.getByText('Downloading result')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: parseEn.parseCancel }))
    await settle()
    expect(world.jobs.kill).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
    expect(screen.getByText(parseEn.parseCancelRequested)).toBeDefined()
    expect(screen.queryByRole('progressbar')).toBeNull()
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
