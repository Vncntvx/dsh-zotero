// @vitest-environment jsdom
/** Copy and download are enabled only after a complete verified stream. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileResultView } from '../../../src/client/toolviews/FileResultView.tsx'
import { createToolViewProps } from '../helpers/mock-disclosure.ts'
import { settled } from '../helpers/blocks.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { zh } from '../../../src/client/locales.ts'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function show() {
  const useSession: Parameters<typeof FileResultView>[0]['useSession'] = (select) =>
    select({ sessionId: 'session' } as never)
  render(
    <FileResultView
      {...createToolViewProps({
        toolName: 'zotero_export',
        phase: 'result',
        block: settled({ meta: { delivery: 'file', summary: 'Stored' } }),
        t: mockT,
      })}
      useSession={useSession}
    />,
  )
}
it('preserves BOM, whitespace, quoted commas and multiline Unicode CSV when copying', async () => {
  const text = '\ufeff"标题","a,b"\n"多行\n末尾",尾\n  '
  const fetch = vi.fn(async (_url: unknown) =>
    Response.json({ version: 1, data: { format: 'csv', text } }),
  )
  vi.stubGlobal('fetch', fetch)
  show()
  expect(screen.queryByRole('button', { name: zh.copy })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.readCompleteResult }))
  await screen.findByRole('button', { name: zh.copy })
  fireEvent.click(screen.getByRole('button', { name: zh.copy }))
  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(text))
  expect(fetch.mock.calls[0]?.[0]).toContain('seq=2&index=0')
})
it.each(['http', 'truncated', 'stream'])(
  'offers no body actions after a %s failure',
  async (failure) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (failure === 'http') return new Response('Unavailable', { status: 404 })
        if (failure === 'truncated') return new Response('{"version":1,"data":')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"version":1,"data":{}}'))
              controller.error(new Error('Integrity failure'))
            },
          }),
        )
      }),
    )
    show()
    fireEvent.click(screen.getByRole('button', { name: zh.readCompleteResult }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: zh.copy })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.downloadArtifact })).toBeNull()
  },
)
