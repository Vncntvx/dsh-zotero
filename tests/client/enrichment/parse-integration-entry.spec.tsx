// @vitest-environment jsdom
/** Actual library entry clicks reach the real dialog/controller through the host boundary. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHILD_PDFS,
  PARENT_DETAIL,
  TOP_PDF_DETAIL,
  en,
  PARSE_SESSION,
  parseIntegrationWorld,
} from './support/parse-integration.tsx'

const worlds: ReturnType<typeof parseIntegrationWorld>[] = []
beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  for (const world of worlds.splice(0)) world.dispose()
})
function world() {
  const result = parseIntegrationWorld()
  worlds.push(result)
  return result
}
async function settle() {
  await act(async () => {})
}
async function inspect(title: string) {
  if (!screen.queryByRole('heading', { name: title })) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }))
  }
  await settle()
}

describe('session library parsing entry', () => {
  it('selects exactly the clicked child PDF and starts only after explicit confirmation', async () => {
    const runtime = world()
    runtime.mount()
    await inspect(PARENT_DETAIL.title)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(runtime.remote.documentArtifact).not.toHaveBeenCalled()
    expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Parse PDF: Not a PDF' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Parse PDF: Selected PDF' }))
    await settle()
    expect(screen.getByRole('dialog', { name: en.parseTitle })).toBeDefined()
    expect(document.querySelector('[data-parse-target-label]')?.textContent).toBe('Selected PDF')
    expect(runtime.remote.documentArtifact).toHaveBeenCalledWith(
      {
        sessionId: PARSE_SESSION,
        target: { kind: 'attachment', ref: CHILD_PDFS[1]!.ref },
      },
      expect.any(AbortSignal),
    )
    expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.parseConfirm }))
    await settle()
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledTimes(1)
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledWith({
      sessionId: PARSE_SESSION,
      target: { kind: 'attachment', ref: CHILD_PDFS[1]!.ref },
      operationId: expect.any(String),
      action: 'parse',
    })
    expect(runtime.jobs.observe).toHaveBeenCalledWith(PARSE_SESSION, expect.any(String))
  })

  it('opens the standalone PDF detail against its own canonical attachment identity', async () => {
    const runtime = world()
    runtime.mount(TOP_PDF_DETAIL)
    await inspect(TOP_PDF_DETAIL.title)
    fireEvent.click(screen.getByRole('button', { name: en.libraryParsePdf }))
    await settle()
    expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.parseConfirm }))
    await settle()
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: PARSE_SESSION,
        target: { kind: 'attachment', ref: CHILD_PDFS[1]!.ref },
      }),
    )
  })

  it('opens a session URL draft without reading or starting until one public target is supplied', async () => {
    const runtime = world()
    runtime.mount()
    fireEvent.click(screen.getByRole('button', { name: en.libraryParseUrl }))
    await settle()
    expect(runtime.remote.documentArtifact).not.toHaveBeenCalled()
    expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    const url = 'https://papers.example.org/paper.pdf?signature=private-query'
    fireEvent.change(screen.getByRole('textbox', { name: en.parseUrl }), { target: { value: url } })
    await settle()
    expect(document.querySelector('[data-parse-target-label]')?.textContent).toBe(
      'https://papers.example.org/…',
    )
    expect(runtime.remote.startDocumentParse).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.parseConfirm }))
    await settle()
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: PARSE_SESSION,
        target: { kind: 'url', url },
      }),
    )
    expect(
      Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.getItem(localStorage.key(index)!),
      ).join(''),
    ).not.toContain('private-query')
  })

  it('reads and cancels an accepted job after closing and remounting the pane without another start', async () => {
    const runtime = world()
    let panel = runtime.mount()
    await inspect(PARENT_DETAIL.title)
    fireEvent.click(screen.getByRole('button', { name: 'Parse PDF: Selected PDF' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.parseConfirm }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.parseClose }))
    expect(runtime.stopObservation).toHaveBeenCalledTimes(1)
    expect(runtime.jobs.kill).not.toHaveBeenCalled()
    panel = runtime.remount(panel)
    await inspect(PARENT_DETAIL.title)
    fireEvent.click(screen.getByRole('button', { name: 'Parse PDF: Selected PDF' }))
    await settle()
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledTimes(1)
    expect(runtime.remote.documentParseReceipt).toHaveBeenCalledTimes(2)
    expect(runtime.jobs.observe).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: en.parseCancel }))
    await settle()
    expect(runtime.jobs.kill).toHaveBeenCalledWith(PARSE_SESSION, expect.any(String))
    expect(screen.getByText(en.parseCancelRequested)).toBeDefined()
    panel.view.unmount()
  })
})
