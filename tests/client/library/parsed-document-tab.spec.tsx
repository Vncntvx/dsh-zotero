// @vitest-environment jsdom
/** Complete document delivery, refresh and resource ownership. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  documentRead,
  parsedRuntime,
  LEASE,
  type ArtifactAnswer,
} from './support/parsed-document.tsx'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../../../src/contract.ts'
import { deferred } from '../../helpers/sync.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
const mount = (read: Parameters<typeof parsedRuntime>[0]) => {
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.mount()
  return runtime
}
async function ready() {
  await act(async () => {})
}

describe('complete parsed-document delivery', () => {
  it('prepares every block and publishes only after the tail arrives', async () => {
    const text = '# Title\n\n' + 'x'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS) + '\n\ntail paragraph'
    const base = documentRead(text)
    const tail = deferred<ArtifactAnswer>()
    const read = vi.fn<import('../../../src/client/parsed-documents.ts').ParsedArtifactRead>(
      async (request, signal) =>
        request.op === 'page' ? await tail.promise : await base(request, signal),
    )
    mount(read)
    await ready()
    expect(screen.queryByText('Title')).toBeNull()
    expect(screen.getByRole('status')).toBeDefined()
    const request = read.mock.calls.find(([request]) => request.op === 'page')![0]
    tail.resolve(await base(request))
    await ready()
    expect(screen.getByRole('heading', { name: 'Title' })).toBeDefined()
    expect(screen.getByText(/tail paragraph/)).toBeDefined()
    expect(read.mock.calls.filter(([request]) => request.op === 'release')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedCopy') }))
    await ready()
    expect(clipboardWrites).toHaveBeenCalledWith(text)
  })

  it('retains the last complete version if a refresh fails', async () => {
    const read = documentRead('# First')
    const runtime = mount(read)
    await ready()
    read.mockImplementation(async (request) =>
      request.op === 'release'
        ? { ok: true, value: { kind: 'released' } }
        : { ok: false, error: new RemoteError('gateway/internal', 'Store unreadable', {}) },
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
    await ready()
    expect(screen.getByRole('heading', { name: 'First' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('Store unreadable')
    expect(runtime.source.getSnapshot().status).toBe('failed')
  })

  it('refreshes from a new source generation and rejects a mismatching page', async () => {
    const first = documentRead('# First')
    mount(first)
    await ready()
    const second = documentRead('# Second' + 'x'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS))
    first.mockImplementation(async (request, signal) => {
      const result = await second(request, signal)
      return request.op === 'page' && result.ok && result.value.kind === 'page'
        ? { ok: true, value: { ...result.value, artifactId: 'e'.repeat(64) } }
        : result
    })
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
    await ready()
    expect(screen.getByRole('heading', { name: 'First' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('changed')
  })

  it('binds the host refresh command and downloads the complete original', async () => {
    const read = documentRead('Suo <sup>a</sup>')
    const runtime = mount(read)
    await ready()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedDownload') }))
    expect(create).toHaveBeenCalledOnce()
    const commands = runtime.bindCommands.mock.calls[0]![0] as { refresh(): void }
    act(() => commands.refresh())
    await ready()
    expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(2)
    expect(screen.queryByText(/<sup>/)).toBeNull()
  })

  it('does not change hook order when each permission changes', async () => {
    const runtime = mount(documentRead('# Access'))
    await ready()
    for (const action of [
      'zotero/documentArtifact',
      'zotero/documentParseReceipt',
      'job/list',
      'job/follow',
      'job/kill',
      'zotero/startDocumentParse',
    ]) {
      act(() => runtime.grant(action).publish(false))
      await ready()
      act(() => runtime.grant(action).publish(true))
      await ready()
    }
    expect(screen.getByRole('heading', { name: 'Access' })).toBeDefined()
  })

  it('reports an unavailable artifact and releases its request id', async () => {
    const read = documentRead('')
    read.mockImplementation(async (request) => ({
      ok: true,
      value: request.op === 'release' ? { kind: 'released' } : { kind: 'missing' },
    }))
    mount(read)
    await ready()
    expect(screen.getByRole('alert').textContent).toContain('missing or expired')
    expect(read.mock.calls.at(-1)![0]).toMatchObject({ op: 'release' })
  })

  it('cleans up a preparation stopped while opening', async () => {
    const pending = deferred<ArtifactAnswer>()
    const read = documentRead('Late')
    read.mockImplementation(async (request) =>
      request.op === 'open' ? await pending.promise : { ok: true, value: { kind: 'released' } },
    )
    const runtime = mount(read)
    await ready()
    cleanup()
    const disposing = runtime.dispose()
    pending.resolve({
      ok: true,
      value: {
        kind: 'page',
        lease: LEASE,
        artifactId: 'b'.repeat(64),
        page: { offset: 0, text: 'Late', totalChars: 4 },
      },
    })
    await disposing
    expect(read.mock.calls.at(-1)![0]).toMatchObject({ op: 'release' })
  })
})
