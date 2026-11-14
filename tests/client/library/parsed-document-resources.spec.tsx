// @vitest-environment jsdom
/** Resource revocation, bounded preparation and explicit failure recovery. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { documentRead, parsedRuntime, type ArtifactAnswer } from './support/parsed-document.tsx'
import { deferred } from '../../helpers/sync.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'
import { parsedArtifactTabAddress, parsedTabAddress } from '../../../src/client/parsed-tab.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
const tick = async () => {
  await act(async () => {})
}
function mount(read = documentRead('# Resource')) {
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.mount()
  return runtime
}

it('revokes displayed bytes, cancels preparation and prepares afresh after access returns', async () => {
  const read = documentRead('# Resource')
  const runtime = mount(read)
  await tick()
  act(() => runtime.access.publish(false))
  await tick()
  expect(screen.queryByRole('heading', { name: 'Resource' })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('not authorized')
  act(() => runtime.access.publish(true))
  await tick()
  expect(screen.getByRole('heading', { name: 'Resource' })).toBeDefined()
  expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(2)
})

it('refuses an over-budget candidate and preserves the previous complete version', async () => {
  const read = documentRead('# Resource')
  mount(read)
  await tick()
  const base = documentRead('# Replacement')
  read.mockImplementation(async (request, signal) => {
    const result = await base(request, signal)
    return result.ok && result.value.kind === 'opened'
      ? {
          ok: true,
          value: {
            ...result.value,
            policy: { ...result.value.policy, preparedMaxBytes: 1 },
          },
        }
      : result
  })
  fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
  await tick()
  expect(screen.getByRole('heading', { name: 'Resource' })).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Replacement' })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('memory is full')
})

it('invalidates a late opening when a newer refresh is requested', async () => {
  const pending = deferred<ArtifactAnswer>()
  const base = documentRead('# Stale')
  const read = documentRead('# Fresh')
  read.mockImplementationOnce(async () => await pending.promise)
  const runtime = mount(read)
  await tick()
  act(() =>
    runtime.documents.refresh(
      'dsh-resource://zotero-parsed/parsed-session/zotero%3A%2F%2Fuser%2F0%2Fattachment%2FPDF00001',
    ),
  )
  pending.resolve(
    await base({
      sessionId: 'parsed-session',
      op: 'open',
      requestId: crypto.randomUUID(),
      target: { kind: 'attachment', ref: 'r' },
    }),
  )
  await tick()
  expect(screen.getByRole('heading', { name: 'Fresh' })).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Stale' })).toBeNull()
  expect(read.mock.calls.filter(([request]) => request.op === 'release')).toHaveLength(2)
})

it('keeps successful content available and reports a lease cleanup refusal', async () => {
  const base = documentRead('# Resource')
  const read = documentRead('# Resource')
  read.mockImplementation(async (request, signal) => {
    if (request.op === 'release') throw new Error('cleanup refused')
    return await base(request, signal)
  })
  const runtime = mount(read)
  await tick()
  expect(screen.getByRole('heading', { name: 'Resource' })).toBeDefined()
  expect(runtime.failures).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'cleanup refused' }),
  )
})

it('starts a new preparation when a committed generation is reported without polling', async () => {
  const read = documentRead('# Resource')
  const runtime = mount(read)
  await tick()
  read.mockImplementation(documentRead('# Committed'))
  act(() => runtime.documents.committed('parsed-session', 'zotero://user/0/attachment/PDF00001'))
  await tick()
  expect(screen.getByRole('heading', { name: 'Committed' })).toBeDefined()
  expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(2)
})

it('matches a committed attachment structurally even when its tab address carries a title', async () => {
  const read = documentRead('# Resource')
  const titled = parsedTabAddress({
    sessionId: 'parsed-session',
    ref: 'zotero://user/0/attachment/PDF00001',
    title: 'Real Title',
  })
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.mount({ address: titled, title: 'Real Title' })
  await tick()
  read.mockImplementation(documentRead('# Committed'))
  act(() => runtime.documents.committed('parsed-session', 'zotero://user/0/attachment/PDF00001'))
  await tick()
  expect(screen.getByRole('heading', { name: 'Committed' })).toBeDefined()
})

it('reports a browser decode failure in the active locale and retains the complete document', async () => {
  const read = documentRead('# Complete')
  const runtime = parsedRuntime(read, {
    translate: (key) => zh[key],
    decode: async () => {
      throw new Error('corrupt PNG')
    },
  })
  owned.push(runtime)
  runtime.mount()
  await tick()
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken')
  read.mockImplementation(
    documentRead('# Broken\n\n![figure](images/figure.png)', {
      images: [
        { name: 'images/figure.png', mediaType: 'image/png', bytes: 4, base64: btoa('png!') },
      ],
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
  await tick()
  expect(screen.getByRole('alert').textContent).toBe(zh.parsedErrorFigureDecode)
  expect(screen.getByRole('heading', { name: 'Complete' })).toBeDefined()
  expect(screen.queryByRole('img')).toBeNull()
  expect(revoke).toHaveBeenCalledWith('blob:broken')
})

it('coalesces simultaneous refresh commands into one replacement', async () => {
  const read = documentRead('# Resource')
  const runtime = mount(read)
  await tick()
  act(() => {
    runtime.documents.committed('parsed-session', 'zotero://user/0/attachment/PDF00001')
    runtime.documents.committed('parsed-session', 'zotero://user/0/attachment/PDF00001')
  })
  await tick()
  expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(2)
  expect(screen.getByRole('heading', { name: 'Resource' })).toBeDefined()
})

it('ignores unchanged grants and committed notices while access is denied', async () => {
  const read = documentRead('# Resource')
  const runtime = mount(read)
  await tick()
  act(() => runtime.access.publish(true))
  await tick()
  expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(1)
  act(() => runtime.access.publish(false))
  act(() => runtime.documents.committed('parsed-session', 'zotero://user/0/attachment/PDF00001'))
  await tick()
  expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(1)
  expect(screen.queryByRole('heading', { name: 'Resource' })).toBeNull()
})

it('reclaims a prepared candidate closed while the Host release is pending', async () => {
  const release = deferred<ArtifactAnswer>()
  const entered = deferred<void>()
  const base = documentRead('# Candidate\n\n![figure](images/figure.png)', {
    images: [{ name: 'images/figure.png', mediaType: 'image/png', bytes: 4, base64: btoa('png!') }],
  })
  const read = documentRead('')
  read.mockImplementation(async (request, signal) => {
    if (request.op === 'release') {
      entered.resolve()
      return await release.promise
    }
    return await base(request, signal)
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:candidate')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const runtime = mount(read)
  await entered.promise
  cleanup()
  const disposed = runtime.dispose()
  release.resolve({ ok: true, value: { kind: 'released' } })
  await disposed
  expect(revoke).toHaveBeenCalledWith('blob:candidate')
  expect(runtime.source.getSnapshot().value?.document).toBeUndefined()
})

it('discards an open artifact by id and refreshes only its tab', async () => {
  const read = documentRead('# Resource')
  const runtime = mount(read)
  await tick()
  const before = read.mock.calls.filter(([request]) => request.op === 'open').length
  act(() => runtime.documents.discarded('parsed-session', 'b'.repeat(64)))
  await tick()
  expect(read.mock.calls.filter(([request]) => request.op === 'open').length).toBe(before + 1)
})

it('opens an artifact-addressed resource with an opaque target', async () => {
  const read = documentRead('# Resource')
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  const abort = new AbortController()
  const iterator = runtime.documents
    .open(parsedArtifactTabAddress({ sessionId: 'parsed-session', artifactId: 'a'.repeat(64) }), {
      signal: abort.signal,
    })
    [Symbol.asyncIterator]()
  await iterator.next()
  await tick()
  expect(
    read.mock.calls.some(
      ([request]) => request.op === 'open' && request.target.kind === 'artifact',
    ),
  ).toBe(true)
  abort.abort()
  await runtime.dispose()
})

it('reparses an artifact-addressed document through its own opaque target', async () => {
  const read = documentRead('# Resource')
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.mount({
    address: parsedArtifactTabAddress({ sessionId: 'parsed-session', artifactId: 'a'.repeat(64) }),
    parse: true,
  })
  await tick()
  fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReparse') }))
  expect(screen.getByRole('dialog')).toBeDefined()
})

it('reports a thrown non-error as the failure text', async () => {
  const read = documentRead('')
  read.mockImplementation(async () => {
    throw 'gateway blip'
  })
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.mount()
  await tick()
  expect(runtime.source.getSnapshot().failure).toBeDefined()
})
