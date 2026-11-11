// @vitest-environment jsdom
/** Closing, failed admission transport and late replies retain only the original owned operation. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ZoteroStartDocumentParseResultView } from '../../../src/contract.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { deferred } from '../../helpers/sync.ts'
import { parseIntegrationWorld, en, PARSE_SESSION } from './support/parse-integration.tsx'
import { PARSE_JOB } from './support/parse-ports.ts'
import { ENRICHMENT_DEFAULTS } from '../../../src/enrichment-preferences.ts'

const worlds: ReturnType<typeof parseIntegrationWorld>[] = []
beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  for (const world of worlds.splice(0)) world.dispose()
})
const URL_A = 'https://papers.example.org/a.pdf'
const URL_B = 'https://papers.example.org/b.pdf'
async function open(url?: string) {
  fireEvent.click(screen.getByRole('button', { name: en.libraryParseUrl }))
  if (url)
    fireEvent.change(screen.getByRole('textbox', { name: en.parseUrl }), { target: { value: url } })
  await act(async () => {})
}
async function submit() {
  fireEvent.click(screen.getByRole('button', { name: en.parseConfirm }))
  await act(async () => {})
}
const selection = (url = URL_A) => ({
  sessionId: PARSE_SESSION,
  target: { kind: 'url' as const, url },
})

describe('parsing operation integration', () => {
  it('recovers a lost admission reply by receipt after close and pane remount without replaying start', async () => {
    const runtime = parseIntegrationWorld({
      startDocumentParse: async () => {
        throw new Error('Connection lost after admission')
      },
    })
    worlds.push(runtime)
    let panel = runtime.mount()
    await open(URL_A)
    await submit()
    const operationId = runtime.remote.startDocumentParse.mock.calls[0]![0].operationId
    expect(runtime.port.recall(selection())?.operationId).toBe(operationId)
    fireEvent.click(screen.getByRole('button', { name: en.parseClose }))
    panel = runtime.remount(panel)
    await open()
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledTimes(1)
    expect(runtime.remote.documentParseReceipt).toHaveBeenCalledWith(
      { sessionId: PARSE_SESSION, operationId },
      expect.any(AbortSignal),
    )
    expect(runtime.jobs.observe).toHaveBeenCalledWith(PARSE_SESSION, PARSE_JOB)
    expect(screen.getByRole('textbox', { name: en.parseUrl })).toHaveProperty('value', URL_A)
    panel.view.unmount()
  })

  it('keeps target A admission separate when the user opens and submits target B before A returns', async () => {
    const late = deferred<RemoteResult<ZoteroStartDocumentParseResultView>>()
    const runtime = parseIntegrationWorld({
      startDocumentParse: async (request) =>
        request.target.kind === 'url' && request.target.url === URL_A
          ? late.promise
          : {
              ok: true,
              value: {
                operationId: request.operationId,
                generation: 'generation-b',
                jobId: 'job-b',
                status: 'started',
              },
            },
      documentParseReceipt: async () => ({
        ok: true,
        value: { kind: 'pending', jobId: 'job-b', generation: 'generation-b' },
      }),
    })
    worlds.push(runtime)
    runtime.mount()
    await open(URL_A)
    await submit()
    const first = runtime.remote.startDocumentParse.mock.calls[0]![0]
    fireEvent.click(screen.getByRole('button', { name: en.parseClose }))
    await open(URL_B)
    await submit()
    const second = runtime.remote.startDocumentParse.mock.calls[1]![0]
    await act(async () => {
      late.resolve({
        ok: true,
        value: {
          operationId: first.operationId,
          generation: 'generation-a',
          jobId: 'job-a',
          status: 'started',
        },
      })
      await late.promise
    })
    expect(runtime.port.recall(selection(URL_A))?.jobId).toBe('job-a')
    expect(runtime.port.recall(selection(URL_B))?.operationId).toBe(second.operationId)
    expect(runtime.jobs.observe).toHaveBeenLastCalledWith(PARSE_SESSION, 'job-b')
    expect(screen.getByRole('textbox', { name: en.parseUrl })).toHaveProperty('value', URL_B)
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer same-target generation when an older closed-pane admission settles last', async () => {
    const late = deferred<RemoteResult<ZoteroStartDocumentParseResultView>>()
    let issued = 0
    const runtime = parseIntegrationWorld({
      startDocumentParse: async (request) =>
        ++issued === 1
          ? late.promise
          : {
              ok: true,
              value: {
                operationId: request.operationId,
                generation: 'generation-new',
                jobId: 'job-new',
                status: 'started',
              },
            },
    })
    worlds.push(runtime)
    let panel = runtime.mount()
    await open(URL_A)
    await submit()
    const first = runtime.remote.startDocumentParse.mock.calls[0]![0]
    // A deployment revision makes the pending old intent ineligible for this new confirmation.
    act(() =>
      runtime.form.publish({
        revision: 2,
        value: { ...ENRICHMENT_DEFAULTS, allowDocumentUpload: true, mode: 'pro' },
      }),
    )
    panel = runtime.remount(panel)
    await open(URL_A)
    await submit()
    const second = runtime.remote.startDocumentParse.mock.calls[1]![0]
    await act(async () => {
      late.resolve({
        ok: true,
        value: {
          operationId: first.operationId,
          generation: 'generation-old',
          jobId: 'job-old',
          status: 'started',
        },
      })
      await late.promise
    })
    expect(runtime.port.recall(selection())?.operationId).toBe(second.operationId)
    expect(runtime.port.recall(selection())?.jobId).toBe('job-new')
    expect(runtime.remote.startDocumentParse).toHaveBeenCalledTimes(2)
    panel.view.unmount()
  })

  it('forgets the removed session and prevents its pending admission from recreating local observation memory', async () => {
    const late = deferred<RemoteResult<ZoteroStartDocumentParseResultView>>()
    const runtime = parseIntegrationWorld({ startDocumentParse: async () => late.promise })
    worlds.push(runtime)
    runtime.mount()
    await open(URL_A)
    await submit()
    const operationId = runtime.remote.startDocumentParse.mock.calls[0]![0].operationId
    act(() => runtime.removed.publish(true))
    await act(async () => {
      late.resolve({
        ok: true,
        value: { operationId, generation: 'old', jobId: 'old-job', status: 'started' },
      })
      await late.promise
    })
    expect(runtime.port.recall(selection())).toBeUndefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(runtime.jobs.kill).not.toHaveBeenCalled()
  })
})
