/**
 * The library panel's composed face delegates every call to the wire stub the
 * fake host provides; this keeps the compositional root's face methods covered
 * against the real delegation targets rather than a rendered-panel mock.
 * @module tests/client/panel-face
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { applyEntry, fakeWorld } from './helpers/apply-world.ts'
import { parsedTabAddress } from '../../src/client/parsed-tab.ts'

type Wire = { ok: boolean; value: unknown }
interface PanelFaceSlice {
  viewStore: unknown
  preferenceSource: unknown
  readUrlPdf: (request: { ref: string }, signal?: AbortSignal) => Promise<Wire>
  releaseUrlPdf: (lease: string) => Promise<void>
  bindRefresh: (
    sessionId: string,
    tabId: string,
    refresh: () => void,
    clear: () => void,
  ) => () => void
  status: () => Promise<Wire>
  collectionPath: (request: Record<string, never>) => Promise<Wire>
  browse: (request: { kind: string }) => Promise<Wire>
  search: (request: Record<string, never>) => Promise<Wire>
  item: (request: { ref: string }) => Promise<Wire>
  childPage: (request: { kind: string }) => Promise<Wire>
  export: (request: Record<string, never>) => Promise<Wire>
  write: (request: Record<string, never>) => Promise<Wire>
  resolveAttachment: (ref: string) => Promise<Wire>
  openResource: (url: string) => void
  openParsed: (attachment: { ref: string; title: string }, title: string, itemRef: string) => void
  invalidate: () => void
  setInstance: (instance: string) => void
}

interface ParsedFaceSlice {
  refresh: (address: string) => void
  item: (request: { ref: string }) => Promise<Wire>
}

interface ManagerFaceSlice {
  management: {
    listParsedDocuments: (request: {
      sessionId: string
      offset: number
      limit: number
    }) => Promise<Wire>
    discardParsedDocument: (request: { sessionId: string; artifactId: string }) => Promise<Wire>
  }
  discarded: (sessionId: string, artifactId: string) => void
}

let world: ReturnType<typeof fakeWorld>
let panel: PanelFaceSlice
let parsed: ParsedFaceSlice
let manager: ManagerFaceSlice

beforeEach(async () => {
  world = fakeWorld()
  await applyEntry(world)
  for (const entry of world.injected.filter((item) => item.name === 'sidebar.right.pane.tab'))
    entry.register()
  const byKey = (key: string) =>
    world.registered.find((entry) => entry.options.key === key)!.options.inject as () => unknown
  panel = byKey('dsh-zotero#library')() as PanelFaceSlice
  parsed = byKey('dsh-zotero#parsed')() as ParsedFaceSlice
  manager = byKey('dsh-zotero#parsed-manager')() as ManagerFaceSlice
})

describe('the library panel face', () => {
  it('carries the panel view cache and preference source', () => {
    expect(panel.viewStore).toBeDefined()
    expect(panel.preferenceSource).toBeDefined()
    expect(typeof panel.invalidate).toBe('function')
    panel.invalidate()
    panel.setInstance('next')
  })

  it('reads and releases a URL PDF through its wire targets', async () => {
    expect((await panel.readUrlPdf({ ref: 'zotero://user/0/attachment/P1' })).ok).toBe(true)
    await expect(panel.releaseUrlPdf('lease-1')).resolves.toBeUndefined()
    ;(world as unknown as { releaseUrlPdfOutcome?: () => unknown }).releaseUrlPdfOutcome = () => ({
      ok: false as const,
      error: { message: 'gone' },
    })
    await expect(panel.releaseUrlPdf('lease-2')).rejects.toMatchObject({ message: 'gone' })
    delete (world as unknown as { releaseUrlPdfOutcome?: () => unknown }).releaseUrlPdfOutcome
  })

  it('binds and unbinds a tab refresh binding', () => {
    const unbind = panel.bindRefresh(
      's1',
      't1',
      () => {},
      () => {},
    )
    expect(typeof unbind).toBe('function')
    unbind()
  })

  it('forwards every read lane to its wire target', async () => {
    expect((await panel.status()).ok).toBe(true)
    expect((await panel.collectionPath({})).ok).toBe(true)
    expect((await panel.browse({ kind: 'libraries' })).ok).toBe(true)
    expect((await panel.search({})).ok).toBe(true)
    expect((await panel.item({ ref: 'zotero://user/0/item/I1' })).ok).toBe(true)
    expect((await panel.childPage({ kind: 'notes' })).ok).toBe(true)
    expect((await panel.export({})).ok).toBe(true)
    expect((await panel.resolveAttachment('zotero://user/0/attachment/P1')).ok).toBe(true)
  })

  it('sends the write lane through the approval seam', async () => {
    expect((await panel.write({})).ok).toBe(true)
  })

  it('opens a URL through the shell', () => {
    panel.openResource('https://example.org')
    expect(world.openResourceCalls).toContain('https://example.org')
  })

  it('opens a parsed document by composing the address and its presentation params', () => {
    const attachment = { ref: 'zotero://user/0/attachment/P1', title: 'Paper' }
    panel.openParsed(attachment, '', '')
    panel.openParsed(attachment, 'Paper', 'zotero://user/0/item/I1')
    expect(world.openResourceInCalls).toHaveLength(2)
    const [untitled, titled] = world.openResourceInCalls
    // The session is whatever the registration captured; both opens share it.
    expect(titled.sessionId).toBe(untitled.sessionId)
    expect(untitled.address).toBe(
      parsedTabAddress({
        sessionId: untitled.sessionId as never,
        ref: attachment.ref,
        title: 'Paper',
      }),
    )
    expect(untitled.params).toEqual({ title: 'Paper' })
    expect(titled.address).toBe(
      parsedTabAddress({
        sessionId: titled.sessionId as never,
        ref: attachment.ref,
        title: 'Paper',
        item: 'zotero://user/0/item/I1',
      }),
    )
    expect(titled.params).toEqual({ title: 'Paper', item: 'zotero://user/0/item/I1' })
  })
})

describe('the parsed-document face', () => {
  it('forwards item reads and no-ops refresh on an unopened address', async () => {
    expect((await parsed.item({ ref: 'zotero://user/0/item/I1' })).ok).toBe(true)
    parsed.refresh('dsh-resource://zotero-parsed/nowhere')
  })
})

describe('the manager face', () => {
  it('lists and discards through the management endpoints', async () => {
    const listed = await manager.management.listParsedDocuments({
      sessionId: 's1',
      offset: 0,
      limit: 50,
    })
    expect(listed.ok).toBe(true)
    const discarded = await manager.management.discardParsedDocument({
      sessionId: 's1',
      artifactId: 'a'.repeat(64),
    })
    expect((discarded.value as { kind: string }).kind).toBe('discarded')
    manager.discarded('s1', 'a'.repeat(64))
  })
})
