// @vitest-environment jsdom
/** Entry wiring routes clear/recovery commands to their original session and accepted grants. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, expect, it, vi } from 'vitest'
import { fakeWorld, applyEntry } from '../helpers/apply-world.ts'
import { deferred } from '../../helpers/sync.ts'
import { libraryStorageKey } from '../../../src/client/components/library/library-storage.ts'
import {
  clearLibraryViewMemory,
  libraryViewMemory,
} from '../../../src/client/library-preferences.tsx'

const address = 'dsh-resource://file/absolute/tmp/dsh-zotero-pdf-1-old/document.pdf'
const ref = 'zotero://user/0/attachment/ATTAC001?server=S1'
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
async function routing() {
  localStorage.setItem(
    'dsh-zotero:url-pdf-readers:1',
    JSON.stringify([[address, { lease: 'old-lease', ref }]]),
  )
  const world = fakeWorld()
  world.libraryScope.publish({ value: { allowUrlPdfRead: true } })
  const originalStatus = world.status
  world.status = async () => {
    const status = (await originalStatus()) as { ok: true; value: Record<string, unknown> }
    return { ...status, value: { ...status.value, serverId: 'S1' } }
  }
  const ctx = world.ctx as Context
  const inventory = createSnapshotStore([
    { sessionId: 's1', tabId: 'reader', contentId: address, kind: 'file' },
  ])
  const openResourceIn = vi.fn()
  const readUrlPdf = vi.fn<typeof ctx.remote.zotero.readUrlPdf>(async () => ({
    ok: true,
    value: {
      ref,
      path: '/tmp/new.pdf',
      lease: 'new-lease',
      title: 'paper.pdf',
      contentType: 'application/pdf' as const,
    },
  }))
  const releaseUrlPdf = vi.fn<typeof ctx.remote.zotero.releaseUrlPdf>(async () => ({
    ok: true,
    value: { released: true },
  }))
  Object.assign(ctx.sidebarRight, { openTabs: inventory, openResourceIn })
  Object.assign(ctx.remote.zotero, { readUrlPdf, releaseUrlPdf })
  await applyEntry(world)
  for (const menu of world.injected.filter((entry) => entry.name === 'sidebar.right.tab.menu.item'))
    menu.register()
  const recovery = world.registered.find((entry) =>
    String(entry.options.id).endsWith('.pdf.recovery'),
  )!
  const recoveryFace = (
    recovery.options.inject as () => {
      reload(sessionId: string, tabId: string, address: string): Promise<void>
    }
  )()
  const menu = world.registered.find((entry) => String(entry.options.id).endsWith('.library.menu'))!
  const menuFace = (
    menu.options.inject as () => {
      onClear(sessionId: string, tabId: string): Promise<void>
      onRefresh(sessionId: string, tabId: string): void
    }
  )()
  const body = world.injected.find((entry) => entry.name === 'sidebar.right.pane.tab')!
  const panel = body.register()!
  const panelFace = (
    panel.options.inject as () => {
      releaseUrlPdf(lease: string): Promise<void>
      bindRefresh(
        sessionId: string,
        tabId: string,
        refresh: () => void,
        clear: () => void,
      ): () => void
    }
  )()
  return {
    world,
    ctx,
    inventory,
    openResourceIn,
    readUrlPdf,
    releaseUrlPdf,
    bindRefresh: panelFace.bindRefresh,
    releasePdf: panelFace.releaseUrlPdf,
    ...recoveryFace,
    ...menuFace,
  }
}
it('reloads the source into the original session and replaces only its reader occurrence', async () => {
  const { reload, readUrlPdf, openResourceIn } = await routing()
  await reload('s1', 'reader', address)
  expect(readUrlPdf).toHaveBeenCalledExactlyOnceWith({ ref }, expect.any(AbortSignal))
  expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(
    's1',
    expect.stringContaining('/tmp/new.pdf'),
    { replaceTab: 'reader' },
  )
})
it('does not download after accepted URL permission is revoked', async () => {
  const { world, reload, readUrlPdf } = await routing()
  world.libraryScope.publish({ value: { allowUrlPdfRead: false } })
  await expect(reload('s1', 'reader', address)).rejects.toThrow()
  expect(readUrlPdf).not.toHaveBeenCalled()
})
it('releases the new bytes if the replacement reader refuses to open', async () => {
  const { reload, openResourceIn, releaseUrlPdf } = await routing()
  openResourceIn.mockImplementation(() => {
    throw new Error('open refused')
  })
  await expect(reload('s1', 'reader', address)).rejects.toThrow('open refused')
  expect(releaseUrlPdf).toHaveBeenCalledWith({ lease: 'new-lease' })
})
it('cancels recovery when the source tab closes while downloading', async () => {
  const { reload, readUrlPdf, inventory, openResourceIn } = await routing()
  const started = deferred<void>()
  readUrlPdf.mockImplementation(async (_request, signal) => {
    started.resolve()
    return new Promise((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
    )
  })
  const rejected = expect(reload('s1', 'reader', address)).rejects.toThrow('closed')
  await started.promise
  inventory.set([])
  await rejected
  expect(openResourceIn).not.toHaveBeenCalled()
})
it('clears an inactive session position without changing another session', async () => {
  const { onClear } = await routing()
  localStorage.setItem(libraryStorageKey('S1', 's1'), 'old')
  localStorage.setItem(libraryStorageKey('S1', 's2'), 'keep')
  const signal = new AbortController()
  const memory = libraryViewMemory(signal.signal, 'S1', 's1')
  memory.scroll.list = 70
  await onClear('s1', 'library')
  expect(localStorage.getItem(libraryStorageKey('S1', 's1'))).toBeNull()
  expect(localStorage.getItem(libraryStorageKey('S1', 's2'))).toBe('keep')
  expect(memory.resetPending).toBe(true)
  clearLibraryViewMemory('none', 'none')
  signal.abort()
})
it('routes active commands to the current binding after an older body is disposed', async () => {
  const { bindRefresh, onClear, onRefresh } = await routing()
  const oldRefresh = vi.fn()
  const oldClear = vi.fn()
  const unbindOld = bindRefresh('s1', 'library', oldRefresh, oldClear)
  const refresh = vi.fn()
  const clear = vi.fn()
  const unbind = bindRefresh('s1', 'library', refresh, clear)
  unbindOld()
  onRefresh('s1', 'library')
  await onClear('s1', 'library')
  expect(refresh).toHaveBeenCalledOnce()
  expect(clear).toHaveBeenCalledOnce()
  expect(oldRefresh).not.toHaveBeenCalled()
  expect(oldClear).not.toHaveBeenCalled()
  unbind()
  onRefresh('s1', 'library')
  expect(refresh).toHaveBeenCalledOnce()
})
it('refuses recovery when its persisted attachment source is missing', async () => {
  const { reload, readUrlPdf } = await routing()
  await expect(reload('s1', 'reader', 'unknown')).rejects.toThrow('libraryPdfSourceMissing')
  expect(readUrlPdf).not.toHaveBeenCalled()
})
it('refuses recovery after the original reader has already closed', async () => {
  const { inventory, reload, readUrlPdf } = await routing()
  inventory.set([])
  await expect(reload('s1', 'reader', address)).rejects.toThrow()
  expect(readUrlPdf).not.toHaveBeenCalled()
})
it('shows host recovery refusals without opening a replacement', async () => {
  const { reload, readUrlPdf, openResourceIn } = await routing()
  readUrlPdf.mockResolvedValue({
    ok: false,
    error: new RemoteError('zotero/domain', 'Permission revoked', {
      code: 'ZOTERO_URL_PDF_DISABLED',
    }),
  })
  await expect(reload('s1', 'reader', address)).rejects.toThrow('Permission revoked')
  expect(openResourceIn).not.toHaveBeenCalled()
})
it('reports cleanup refusal when a replacement fails and leaves ownership with the host', async () => {
  const { reload, openResourceIn, releaseUrlPdf } = await routing()
  openResourceIn.mockImplementation(() => {
    throw new Error('open refused')
  })
  releaseUrlPdf.mockResolvedValue({
    ok: false,
    error: new RemoteError('zotero/domain', 'Cleanup refused', { code: 'ZOTERO_UNEXPECTED' }),
  })
  await expect(reload('s1', 'reader', address)).rejects.toThrow('Cleanup refused')
  expect(releaseUrlPdf).toHaveBeenCalledWith({ lease: 'new-lease' })
})
it('propagates a host cleanup refusal through the panel face instead of reporting successful release', async () => {
  const { releasePdf, releaseUrlPdf } = await routing()
  const error = new RemoteError('zotero/domain', 'Cleanup refused', { code: 'ZOTERO_UNEXPECTED' })
  releaseUrlPdf.mockResolvedValue({ ok: false, error })
  await expect(releasePdf('active-lease')).rejects.toBe(error)
  expect(releaseUrlPdf).toHaveBeenCalledExactlyOnceWith({ lease: 'active-lease' })
})
it.each(['offline', 'missing instance'] as const)(
  'preserves inactive browser positions when status is %s',
  async (condition) => {
    const { world, onClear } = await routing()
    world.status = async () =>
      condition === 'offline'
        ? {
            ok: false,
            error: new RemoteError('zotero/domain', 'Offline', { code: 'ZOTERO_NOT_RUNNING' }),
          }
        : { ok: true, value: { connected: false } }
    localStorage.setItem(libraryStorageKey('S1', 's1'), 'keep')
    await expect(onClear('s1', 'library')).rejects.toThrow()
    expect(localStorage.getItem(libraryStorageKey('S1', 's1'))).toBe('keep')
  },
)
