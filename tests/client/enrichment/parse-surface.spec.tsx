// @vitest-environment jsdom
/**
 * The parse surface's own contracts: accepted-config degradation, the bounded
 * operation memory, and the row-to-target mapping. The panel-level integration
 * specs drive the same surface through the library pane; these cases pin the
 * behaviour a unit can see directly, including the arms that only a
 * misconfigured deployment reaches.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENRICHMENT_DEFAULTS,
  ENRICHMENT_DOCUMENT_LIMITS,
} from '../../../src/enrichment-preferences.ts'
import {
  createDocumentParseSurface,
  useDocumentParseSurface,
  type DocumentParseSessionAccess,
} from '../../../src/client/enrichment/parse-surface.tsx'
import { attachmentRef, itemRef, collectionRef } from '../../helpers/server/keys.ts'
import { fakeScope, type FakeScope } from '../helpers/fake-scope.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { observable, PARSE_SESSION, parseJobs, parseRemote } from './support/parse-ports.ts'

const worlds: Array<{ dispose(): void }> = []
afterEach(() => {
  cleanup()
  for (const world of worlds.splice(0)) world.dispose()
})

function surfaceWorld(
  options: { form?: FakeScope; remote?: Parameters<typeof parseRemote>[0] } = {},
) {
  const remote = parseRemote(options.remote)
  const form = options.form ?? fakeScope({ value: { ...ENRICHMENT_DEFAULTS } })
  const connection = observable<ConnectionState>('connected')
  const port = createDocumentParseSurface(
    {
      remote: { zotero: remote },
      jobs: parseJobs().jobs,
      connection: { state: connection },
      configForms: {
        whileServed: (_namespaces, register) => register(new Set(['enrichment'])),
      },
    },
    form,
  )
  worlds.push(port)
  return { port, remote, form, connection }
}

const ACCESS: DocumentParseSessionAccess = {
  sessionId: PARSE_SESSION,
  sessionAllowed: true,
  readAllowed: true,
  startAllowed: true,
  cancelAllowed: true,
}

describe('parse deployment from the accepted config form', () => {
  it('withholds the limits until a value layer is accepted', () => {
    const { port } = surfaceWorld({ form: fakeScope({ status: 'loading' }) })
    expect(port.deployment.getSnapshot()).toMatchObject({
      mounted: true,
      mode: 'free',
      maxFileBytes: 0,
      maxPages: 0,
    })
    expect(port.deployment.getSnapshot().error).toBeUndefined()
  })

  it('falls back to the documented defaults when an accepted form carries no value', () => {
    const { port } = surfaceWorld({ form: fakeScope({ value: undefined }) })
    const snapshot = port.deployment.getSnapshot()
    expect(snapshot.maxFileBytes).toBe(ENRICHMENT_DOCUMENT_LIMITS.free.maxBytes)
    expect(snapshot.maxPages).toBe(ENRICHMENT_DOCUMENT_LIMITS.free.maxPages)
    expect(snapshot.error).toBeUndefined()
  })

  it('reports an invalid accepted value as a deployment error and withholds the limits', () => {
    const { port } = surfaceWorld({ form: fakeScope({ value: { mode: 'bogus' } }) })
    const snapshot = port.deployment.getSnapshot()
    // The message is the accepted-value failure, not a generic label: a
    // deployment operator reads it in the dialog's config-error notice.
    expect(snapshot.error).toEqual(expect.stringContaining('mode'))
    expect(snapshot.maxFileBytes).toBe(0)
    expect(snapshot.maxPages).toBe(0)
  })

  it('bounds remembered operations and forgets a removed session', async () => {
    const { port, remote } = surfaceWorld()
    const url = (index: number) => ({
      kind: 'url' as const,
      url: `https://papers.example.org/${index}.pdf`,
    })
    let lastOperationId = ''
    for (let index = 0; index < 66; index += 1) {
      lastOperationId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      await port.remote.startDocumentParse({
        sessionId: `s${index}`,
        target: url(index),
        operationId: lastOperationId,
        action: 'parse',
      })
    }
    expect(remote.startDocumentParse).toHaveBeenCalledTimes(66)
    // The oldest admissions fell out of the 64-entry bound; the newest is
    // still recallable through the same revision it was admitted under, and an
    // intermediate entry proves the bound is 64 rather than any smaller size.
    expect(port.recall({ sessionId: 's0', target: url(0) })).toBeUndefined()
    expect(port.recall({ sessionId: 's2', target: url(2) })).toBeDefined()
    expect(port.recall({ sessionId: 's65', target: url(65) })).toMatchObject({
      operationId: lastOperationId,
    })
    port.clearSession('s65')
    expect(port.recall({ sessionId: 's65', target: url(65) })).toBeUndefined()
  })

  it('offers no entry points without a surface port', () => {
    const { result } = renderHook(() => useDocumentParseSurface(undefined, ACCESS, mockT))
    expect(result.current.openAttachment).toBeUndefined()
    expect(result.current.openUrl).toBeUndefined()
    expect(result.current.dialog).toBeUndefined()
  })
})

describe('parse surface row mapping', () => {
  it('maps an item row to its attachment ref and submits that ref', async () => {
    const { port, remote } = surfaceWorld()
    const { result } = renderHook(() => useDocumentParseSurface(port, ACCESS, mockT))
    act(() =>
      result.current.openAttachment!({
        ref: itemRef(),
        title: 'Standalone PDF',
        contentType: 'application/pdf',
      }),
    )
    render(<div>{result.current.dialog}</div>)
    fireEvent.click(screen.getByRole('button', { name: mockT('parseConfirm') }))
    await act(async () => {})
    expect(remote.startDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'attachment', ref: attachmentRef('ABCD1234') },
      }),
    )
  })

  it('keeps an attachment row’s own ref and refuses any other kind', async () => {
    const { port, remote } = surfaceWorld()
    const attachment = renderHook(() => useDocumentParseSurface(port, ACCESS, mockT))
    act(() =>
      attachment.result.current.openAttachment!({
        ref: attachmentRef(),
        title: 'PDF',
        contentType: 'application/pdf',
      }),
    )
    render(<div>{attachment.result.current.dialog}</div>)
    fireEvent.click(screen.getByRole('button', { name: mockT('parseConfirm') }))
    await act(async () => {})
    expect(remote.startDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'attachment', ref: attachmentRef() } }),
    )
    attachment.unmount()
    const refused = renderHook(() => useDocumentParseSurface(port, ACCESS, mockT))
    // A collection row is not a document; no dialog may open for it.
    act(() =>
      refused.result.current.openAttachment!({
        ref: collectionRef(),
        title: 'Collection',
        contentType: 'application/pdf',
      }),
    )
    expect(refused.result.current.dialog).toBeUndefined()
  })

  it('opens nothing when the session is not allowed to parse', () => {
    const { port } = surfaceWorld()
    const denied = { ...ACCESS, sessionAllowed: false }
    const { result } = renderHook(() => useDocumentParseSurface(port, denied, mockT))
    act(() =>
      result.current.openAttachment!({
        ref: attachmentRef(),
        title: 'PDF',
        contentType: 'application/pdf',
      }),
    )
    act(() => result.current.openUrl!())
    expect(result.current.dialog).toBeUndefined()
  })

  it('clears the session memory when access is withdrawn', () => {
    const { port } = surfaceWorld()
    const clear = vi.spyOn(port, 'clearSession')
    const { rerender } = renderHook(
      (allowed: boolean) =>
        useDocumentParseSurface(port, { ...ACCESS, sessionAllowed: allowed }, mockT),
      { initialProps: true },
    )
    expect(clear).not.toHaveBeenCalled()
    rerender(false)
    expect(clear).toHaveBeenCalledWith(PARSE_SESSION)
  })

  it('shows the accepted-value error beside the dialog', () => {
    const { port } = surfaceWorld({ form: fakeScope({ value: { mode: 'bogus' } }) })
    const { result } = renderHook(() => useDocumentParseSurface(port, ACCESS, mockT))
    act(() => result.current.openUrl!())
    render(<div>{result.current.dialog}</div>)
    expect(screen.getByRole('alert').textContent).toContain('mode')
  })
})
