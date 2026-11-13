// @vitest-environment jsdom
/** Partial or inconsistent deliveries never replace a complete document. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { documentRead, parsedRuntime } from './support/parsed-document.tsx'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../../../src/contract.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { ParsedDocuments } from '../../../src/client/parsed-documents.ts'
import { observable } from '../enrichment/support/parse-ports.ts'
import type { ParsedArtifactRead } from '../../../src/client/parsed-documents.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
const tick = async () => {
  await act(async () => {})
}

it.each(['offset', 'length', 'total'] as const)(
  'rejects an inconsistent %s from a continued page',
  async (field) => {
    const base = documentRead('# Incomplete' + 'x'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS))
    const read = vi.fn<ParsedArtifactRead>(async (request, signal) => {
      const result = await base(request, signal)
      if (result.ok && result.value.kind === 'page') {
        const page = result.value.page
        return {
          ok: true,
          value: {
            ...result.value,
            page: {
              ...page,
              ...(field === 'offset'
                ? { offset: page.offset + 1 }
                : field === 'length'
                  ? { text: '' }
                  : { totalChars: page.totalChars + 1 }),
            },
          },
        }
      }
      return result
    })
    const runtime = parsedRuntime(read)
    owned.push(runtime)
    runtime.mount()
    await tick()
    expect(screen.getByRole('alert').textContent).toContain('inconsistent page')
    expect(screen.queryByRole('heading', { name: /Incomplete/ })).toBeNull()
    expect(read.mock.calls.at(-1)![0]).toMatchObject({ op: 'release' })
  },
)

it.each(['identity', 'size', 'decode'] as const)(
  'rejects a figure %s failure before publication',
  async (kind) => {
    const base = documentRead('# Figure\n\n![figure](images/figure.png)', {
      images: [
        { name: 'images/figure.png', mediaType: 'image/png', bytes: 4, base64: btoa('png!') },
      ],
    })
    const read = vi.fn<ParsedArtifactRead>(async (request, signal) => {
      const result = await base(request, signal)
      if (result.ok && result.value.kind === 'image')
        return {
          ok: true,
          value: {
            ...result.value,
            ...(kind === 'identity'
              ? { artifactId: 'e'.repeat(64) }
              : kind === 'size'
                ? { base64: btoa('x') }
                : { base64: '??' }),
          },
        }
      return result
    })
    const runtime = parsedRuntime(read)
    owned.push(runtime)
    runtime.mount()
    await tick()
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  },
)

it('reports a wire cleanup refusal, and rejects an invalid resource address without calling the Host', async () => {
  const read = documentRead('# Ready')
  const base = documentRead('# Ready')
  read.mockImplementation(async (request, signal) =>
    request.op === 'release'
      ? { ok: false, error: new RemoteError('gateway/internal', 'release denied', {}) }
      : await base(request, signal),
  )
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.mount()
  await tick()
  expect(runtime.failures).toHaveBeenCalledOnce()
  const isolatedRead = documentRead('unused')
  const provider = new ParsedDocuments(isolatedRead, () => observable(true), vi.fn(), {
    decode: async () => {},
  })
  const iterator = provider
    .open('sidebar://other', { signal: new AbortController().signal })
    [Symbol.asyncIterator]()
  expect((await iterator.next()).value).toMatchObject({ ok: false })
  expect((await iterator.next()).done).toBe(true)
  provider.refresh('unknown')
  expect(isolatedRead).not.toHaveBeenCalled()
})

it('does no source I/O before access is granted and supports repeated refresh commands', async () => {
  const read = documentRead('# Granted')
  const runtime = parsedRuntime(read)
  owned.push(runtime)
  runtime.access.publish(false)
  runtime.mount()
  await tick()
  expect(read).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toBeDefined()
  act(() => runtime.access.publish(true))
  await tick()
  fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
  await tick()
  expect(screen.getByRole('heading', { name: 'Granted' })).toBeDefined()
})
