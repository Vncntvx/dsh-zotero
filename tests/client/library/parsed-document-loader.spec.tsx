// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ParsedDocumentLoader } from '../../../src/client/components/library/ParsedDocumentLoader.tsx'
import { loadParsedDocument } from '../../../src/client/components/library/load-parsed-document.ts'
import { deferred } from '../../helpers/sync.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { documentRead, parsedRuntime } from './support/parsed-document.tsx'

vi.mock('../../../src/client/components/library/load-parsed-document.ts', () => ({
  loadParsedDocument: vi.fn(),
}))
const load = vi.mocked(loadParsedDocument)

afterEach(() => {
  cleanup()
  load.mockReset()
})

it('loads the installed parsed document view only after its tab mounts', async () => {
  const chunk = deferred<Awaited<NonNullable<ReturnType<typeof loadParsedDocument>>>>()
  load.mockReturnValueOnce(chunk.promise)
  const runtime = await parsedRuntime(documentRead('# Loaded from cache'))
  try {
    expect(load).not.toHaveBeenCalled()
    render(<ParsedDocumentLoader {...runtime.props()} />)
    expect(screen.getByRole('status').textContent).toBe(mockT('libraryParsedLoading'))
    await act(async () =>
      chunk.resolve(await import('../../../src/client/components/library/ParsedDocumentTab.tsx')),
    )
    expect(load).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Loaded from cache', level: 1 })).toBeTruthy()
  } finally {
    cleanup()
    await runtime.dispose()
  }
})

it.each([undefined, new Error('Chunk request failed')])(
  'reports an unavailable parsed view after the chunk cannot load (%s)',
  async (result) => {
    if (result instanceof Error) load.mockRejectedValueOnce(result)
    else load.mockReturnValueOnce(result)
    const props = { t: mockT } as Parameters<typeof ParsedDocumentLoader>[0]
    render(<ParsedDocumentLoader {...props} />)
    expect(screen.getByRole('status').textContent).toBe(mockT('libraryParsedLoading'))
    await screen.findByText(mockT('parsedUnavailable'))
  },
)
