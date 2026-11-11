/** Late RPC results cannot cross document, committed-mode or access generations. */
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroDocumentArtifactResultView,
  ZoteroDocumentParseReceiptResultView,
  ZoteroStartDocumentParseResultView,
} from '../../../src/contract.ts'
import { deferred } from '../../helpers/sync.ts'
import {
  documentParseLabel,
  validDocumentParseTarget,
} from '../../../src/client/enrichment/parse-controller.ts'
import {
  PARSE_JOB,
  PARSE_OPERATION,
  PARSE_SELECTION,
  parseCapabilities,
  parseHarness,
  parseRemote,
} from './support/parse-ports.ts'

const harnesses: ReturnType<typeof parseHarness>[] = []
function harness(options: Parameters<typeof parseHarness>[0] = {}) {
  const world = parseHarness(options)
  harnesses.push(world)
  return world
}
afterEach(() => {
  for (const world of harnesses.splice(0)) world.dispose()
})

describe('document parse draft validation', () => {
  it.each([
    '',
    'file:///private/paper.pdf',
    '/home/user/paper.pdf',
    'https://localhost/paper.pdf',
    'http://127.0.0.1/a.pdf',
    'http://0x7f000001/a.pdf',
    'https://10.1.2.3/a.pdf',
    'https://[::1]/a.pdf',
    'https://user:password@example.org/a.pdf',
    'https://example.org:8080/paper.pdf',
  ])('refuses invalid public URL without any RPC: %s', async (url) => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open({ ...PARSE_SELECTION, target: { kind: 'url', url } })
    await world.controller.refresh()
    await world.controller.submit()
    expect(world.controller.getSnapshot().valid).toBe(false)
    expect(remote.documentArtifact).not.toHaveBeenCalled()
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
  })

  it('accepts a public PDF URL and omits every signed path/query/fragment from its label', async () => {
    const target = {
      kind: 'url' as const,
      url: 'https://papers.example.org/secret-path/paper.pdf?token=query-secret#fragment-secret',
    }
    expect(validDocumentParseTarget(target)).toBe(true)
    expect(documentParseLabel(target)).toBe('https://papers.example.org/…')
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open({ ...PARSE_SELECTION, target })
    await world.settled()
    await world.controller.submit()
    expect(remote.startDocumentParse).toHaveBeenCalledWith(expect.objectContaining({ target }))
  })

  it('refuses parent-item targets instead of selecting their PDF children', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open({
      ...PARSE_SELECTION,
      target: {
        kind: 'attachment',
        ref:
          PARSE_SELECTION.target.kind === 'attachment'
            ? PARSE_SELECTION.target.ref.replace('/attachment/', '/item/')
            : '',
      },
    })
    await world.controller.submit()
    expect(remote.documentArtifact).not.toHaveBeenCalled()
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
  })
})

describe('document parse response generations', () => {
  it('drops the previous target artifact result after the URL draft changes', async () => {
    const old = deferred<RemoteResult<ZoteroDocumentArtifactResultView>>()
    const remote = parseRemote()
    remote.documentArtifact.mockImplementationOnce(() => old.promise)
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    world.controller.setTarget({ kind: 'url', url: 'https://papers.example.org/new.pdf' })
    await world.settled()
    old.resolve({ ok: true, value: { kind: 'expired' } })
    await old.promise
    expect(world.controller.getSnapshot().artifact).toEqual({ kind: 'missing' })
  })

  it('drops an old start admission after the committed mode changes', async () => {
    const old = deferred<RemoteResult<ZoteroStartDocumentParseResultView>>()
    const remote = parseRemote({ startDocumentParse: () => old.promise })
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    const submitting = world.controller.submit()
    world.capability.publish(
      parseCapabilities({
        mode: 'pro',
        revision: 'service-2',
        maxPages: 200,
        maxFileBytes: 200000000,
      }),
    )
    old.resolve({
      ok: true,
      value: {
        operationId: PARSE_OPERATION,
        generation: 'old',
        jobId: PARSE_JOB,
        status: 'started',
      },
    })
    await submitting
    await world.settled()
    expect(world.controller.getSnapshot().operation).toBeUndefined()
    expect(world.controller.getSnapshot().capabilities.mode).toBe('pro')
    expect(world.jobs.observe).not.toHaveBeenCalled()
    expect(world.jobs.kill).not.toHaveBeenCalled()
  })

  it('drops a late artifact rejection after the modal closes', async () => {
    const old = deferred<RemoteResult<ZoteroDocumentArtifactResultView>>()
    const remote = parseRemote({ documentArtifact: () => old.promise })
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    world.controller.close()
    old.reject(new Error('Late failure'))
    await old.promise.catch(() => undefined)
    expect(world.controller.getSnapshot().failure).toBeUndefined()
  })

  it('treats only exact service-unavailable as component absence', async () => {
    const error = new RemoteError('gateway/service-unavailable', 'component absent', {
      endpoint: 'zotero/documentArtifact',
    })
    const remote = parseRemote({ documentArtifact: async () => ({ ok: false, error }) })
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    expect(world.controller.getSnapshot().gate).toBe('not-available')
    expect(world.controller.getSnapshot().failure).toBe(error)
  })

  it('retains endpoint failures without rewriting them to component absence', async () => {
    const error = new Error('Connection lost')
    const world = harness({
      remote: parseRemote({
        documentArtifact: async () => {
          throw error
        },
      }),
    })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    expect(world.controller.getSnapshot().gate).toBe('ready')
    expect(world.controller.getSnapshot().failure?.message).toBe('Connection lost')
  })

  it('drops a stale receipt after switching documents', async () => {
    const old = deferred<RemoteResult<ZoteroDocumentParseReceiptResultView>>()
    const world = harness({ remote: parseRemote({ documentParseReceipt: () => old.promise }) })
    world.controller.open({
      ...PARSE_SELECTION,
      operation: { operationId: PARSE_OPERATION, jobId: PARSE_JOB },
    })
    world.controller.setTarget({ kind: 'url', url: 'https://papers.example.org/other.pdf' })
    await world.settled()
    old.resolve({
      ok: true,
      value: { kind: 'failed', code: 'OLD_FAILURE', message: 'Old parse failed' },
    })
    await old.promise
    expect(world.controller.getSnapshot().receipt).toBeUndefined()
    expect(world.controller.getSnapshot().operation).toBeUndefined()
  })

  it('retains permission failure code and details as a distinct access verdict', async () => {
    const error = new RemoteError('remote-access/denied', 'access denied', {
      action: 'zotero/documentArtifact',
      reason: 'no-allow',
    })
    const world = harness({
      remote: parseRemote({ documentArtifact: async () => ({ ok: false, error }) }),
    })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    expect(world.controller.getSnapshot().gate).toBe('permission')
    expect(world.controller.getSnapshot().failure).toBe(error)
    expect(world.controller.getSnapshot().failure?.details).toEqual({
      action: 'zotero/documentArtifact',
      reason: 'no-allow',
    })
  })

  it('reacts to live session permission revocation without issuing an RPC', async () => {
    const remote = parseRemote()
    const world = harness({ remote })
    world.controller.open(PARSE_SELECTION)
    await world.settled()
    world.capability.publish(parseCapabilities({ sessionAllowed: false }))
    await world.controller.submit()
    expect(world.controller.getSnapshot().gate).toBe('permission')
    expect(remote.documentArtifact).toHaveBeenCalledTimes(1)
    expect(remote.startDocumentParse).not.toHaveBeenCalled()
    expect(world.state.listenerCount()).toBe(0)
  })
})
