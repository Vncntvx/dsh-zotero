import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it, vi } from 'vitest'
import type { ParsedDocumentTabFace } from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { deferred } from '../../helpers/sync.ts'
import { applyEntry, fakeWorld, type FakeApplyWorld } from '../helpers/apply-world.ts'

const sessionId = SessionId('test-session')

function parsedFace(world: FakeApplyWorld) {
  for (const entry of world.injected.filter((item) => item.name === 'sidebar.right.pane.tab'))
    entry.register()
  const registration = world.registered.find((entry) => entry.options.key === 'dsh-zotero#parsed')
  return (registration?.options.inject as () => ParsedDocumentTabFace)()
}

it('forwards parsed excerpt translation through the mounted Zotero remote and propagates refusal', async () => {
  const world = fakeWorld()
  const mounted = world.ctx as Context
  const error = new Error('Session model is unavailable')
  const remote = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, value: 'Résultats' })
    .mockResolvedValueOnce({ ok: false, error })
  Object.defineProperty(mounted.remote.zotero, 'readerTranslate', { value: remote })
  const dispose = await applyEntry(world)
  try {
    const { translate } = parsedFace(world)
    const request = { sessionId, text: 'Results', target: 'fr' } as const
    const signal = new AbortController().signal
    await expect(translate!(request, signal)).resolves.toBe('Résultats')
    expect(remote).toHaveBeenCalledExactlyOnceWith(request, signal)
    await expect(translate!(request, signal)).rejects.toBe(error)
  } finally {
    await dispose()
  }
})

it('refuses a PDF jump when the same attachment could not be resolved or the parsed tab closed', async () => {
  const world = fakeWorld()
  const ref = attachmentRef()
  const captured = { path: 'papers/fixture.pdf', kind: 'file', contentType: 'application/pdf' }
  const pending = deferred<{ ok: true; value: typeof captured & { ref: string } }>()
  world.resolveAttachment = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: new Error('Zotero is offline') })
    .mockResolvedValueOnce({ ok: true, value: { ...captured, ref: attachmentRef('PDF00002') } })
    .mockReturnValueOnce(pending.promise)
  const dispose = await applyEntry(world)
  try {
    const { locatePdf } = parsedFace(world)
    const owner = new AbortController()
    const evidence = { quote: 'Results', sourceType: 'mineru' } as const
    await expect(locatePdf!(sessionId, ref, evidence, owner.signal)).resolves.toBe(false)
    await expect(locatePdf!(sessionId, ref, evidence, owner.signal)).resolves.toBe(false)
    const locating = locatePdf!(sessionId, ref, evidence, owner.signal)
    owner.abort(new Error('Parsed tab closed'))
    pending.resolve({ ok: true, value: { ...captured, ref } })
    await expect(locating).rejects.toThrow('Parsed tab closed')
    expect(world.openResourceInCalls).toEqual([])
  } finally {
    await dispose()
  }
})
