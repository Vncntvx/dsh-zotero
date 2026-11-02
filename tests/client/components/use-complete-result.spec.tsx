// @vitest-environment jsdom
/** The shared complete-result reader: one abortable read per owner coordinates. */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCompleteResult } from '../../../src/client/components/useCompleteResult.ts'
import { deferred } from '../../helpers/sync.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('does not surface a superseded read as a failure', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (++call === 1 ? await first.promise : await second.promise)),
  )
  const { result } = renderHook(() =>
    useCompleteResult({
      sessionId: 'session',
      coordinates: { seq: 2, index: 0 },
      requireExportText: true,
      failureMessage: 'read failed',
    }),
  )

  act(() => {
    void result.current.load()
  })
  act(() => {
    void result.current.load()
  })
  await act(async () => {
    second.resolve(Response.json({ version: 1, data: { format: 'ris', text: 'body' } }))
  })
  await waitFor(() => expect(result.current.state.body).toEqual({ text: 'body', format: 'ris' }))

  // The first read is aborted by the second; its rejection must not overwrite
  // the settled body with the failure message.
  await act(async () => {
    first.reject(new Error('superseded'))
  })
  expect(result.current.state.error).toBeUndefined()
  expect(result.current.state.body).toEqual({ text: 'body', format: 'ris' })
})
