// @vitest-environment jsdom
import { act } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { artifactIdOf, type ZoteroParseTargetView } from '../../../src/contract.ts'
import { ParsedDocumentTab } from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import {
  PARSED_TAB_KIND,
  parsedArtifactTabAddress,
  parsedTabAddress,
} from '../../../src/client/parsed-tab.ts'
import type { DocumentParseSurfacePort } from '../../../src/client/enrichment/parse-surface.tsx'
import { ParsedDocuments } from '../../../src/client/parsed-documents.ts'
import { deferred } from '../../helpers/sync.ts'
import { observable, parseReceipt, parseRemote } from '../enrichment/support/parse-ports.ts'
import { fakeWorld, applyEntry } from '../helpers/apply-world.ts'
import { METADATA, REF, SESSION } from './support/parsed-document.tsx'

const previous = artifactIdOf('d'.repeat(64))!
const newest = artifactIdOf('e'.repeat(64))!
const historical = artifactIdOf('f'.repeat(64))!
const addressOf = (artifactId: string, sessionId = SESSION) =>
  parsedArtifactTabAddress({ sessionId, artifactId })
const tabOf = (artifactId: string, tabId: string, sessionId = SESSION) => ({
  sessionId,
  tabId,
  contentId: addressOf(artifactId, sessionId),
  kind: PARSED_TAB_KIND,
})
const attached = { kind: 'attachment', ref: REF } as const
const linked = { kind: 'url', url: 'https://example.org/paper.pdf' } as const
const stored = { kind: 'artifact', artifactId: previous } as const

const owned: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of owned.splice(0)) await dispose()
})

async function setup(
  tabs = [tabOf(previous, 'original'), tabOf(previous, 'other', 'other-session')],
) {
  const world = fakeWorld()
  const ctx = world.ctx as Context
  const remote = parseRemote()
  const inventory = observable(tabs)
  const grant = observable(true)
  const sidebar = { openResourceIn: vi.fn(), closeIn: vi.fn() }
  const warn = vi.fn()
  const documentsRegistered = vi.fn()
  Object.assign(ctx.sidebarRight, { openTabs: inventory, ...sidebar })
  Object.assign(ctx.remote.zotero, remote)
  Object.assign(ctx.remoteAccess, { source: () => grant })
  Object.assign(ctx, { logger: { warn } })
  Object.assign(ctx.resources, { register: documentsRegistered.mockReturnValue(() => {}) })
  let current = newest
  remote.documentArtifact.mockImplementation(async (request) => ({
    ok: true,
    value: {
      kind: 'meta',
      ...METADATA,
      artifactId:
        request.op === 'meta' && request.target.kind === 'artifact'
          ? request.target.artifactId
          : current,
      currentArtifactId: current,
    },
  }))
  const dispose = await applyEntry(world)
  owned.push(dispose)
  for (const entry of world.injected.filter(({ name }) => name === 'sidebar.right.pane.tab'))
    entry.register()
  const registered = world.registered.find(({ component }) => component === ParsedDocumentTab)!
  const { parse } = (registered.options.inject as () => { parse: DocumentParseSurfacePort })()
  async function complete(
    target: ZoteroParseTargetView,
    artifactId: string = newest,
    sessionId = SESSION,
  ) {
    const receipt = parseReceipt({
      artifactId,
      sourceId: METADATA.sourceId,
      operationId: `op-${artifactId}`,
    })
    remote.startDocumentParse.mockResolvedValueOnce({
      ok: true,
      value: {
        operationId: receipt.operationId,
        generation: receipt.generation,
        jobId: 'completed-parse',
        status: 'completed',
        receipt,
      },
    })
    await act(async () => {
      await parse.remote.startDocumentParse({
        sessionId,
        operationId: receipt.operationId,
        target,
        action: 'reparse',
      })
    })
    return receipt
  }
  return {
    ...sidebar,
    remote,
    grant,
    inventory,
    parse,
    complete,
    dispose,
    warn,
    world,
    documents: documentsRegistered.mock.calls[0]![0] as ParsedDocuments,
    moveIndex: () => (current = historical),
  }
}

it.each([attached, linked, stored])(
  'replaces the old occurrence for a $kind commit in its own session',
  async (target) => {
    const { complete, remote, parse, openResourceIn, closeIn } = await setup()
    const receipt = await complete(target)
    remote.documentParseReceipt.mockResolvedValue({
      ok: true,
      value: { kind: 'completed', receipt },
    })
    await parse.remote.documentParseReceipt({
      sessionId: SESSION,
      operationId: receipt.operationId,
    })
    expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, addressOf(newest), {
      replaceTab: 'original',
    })
    expect(closeIn).not.toHaveBeenCalled()
    expect(
      remote.documentArtifact.mock.calls.every(([request]) => request.sessionId === SESSION),
    ).toBe(true)
  },
)

it('follows the current host index rather than a late receipt and closes an obsolete duplicate', async () => {
  const { complete, openResourceIn, closeIn } = await setup([
    tabOf(previous, 'original'),
    tabOf(newest, 'already-open'),
  ])
  await complete(linked, historical)
  expect(closeIn).toHaveBeenCalledExactlyOnceWith(SESSION, 'original')
  expect(openResourceIn).not.toHaveBeenCalled()
})

it('does not publish a replacement if the source index moves during the metadata match', async () => {
  const { complete, remote, openResourceIn, moveIndex } = await setup()
  const original = remote.documentArtifact.getMockImplementation()!
  remote.documentArtifact
    .mockImplementationOnce(original)
    .mockImplementationOnce(async (request, signal) => {
      const match = await original(request, signal)
      moveIndex()
      return match
    })
  await complete(attached)
  expect(remote.documentArtifact).toHaveBeenCalledTimes(3)
  expect(openResourceIn).not.toHaveBeenCalled()
})

it('aborts a pending generation lookup when artifact access is revoked', async () => {
  const { complete, remote, grant, openResourceIn } = await setup()
  const pending = deferred<Awaited<ReturnType<typeof remote.documentArtifact>>>()
  remote.documentArtifact.mockImplementationOnce(() => pending.promise)
  await complete(attached)
  const [, signal] = remote.documentArtifact.mock.calls[0]!
  grant.publish(false)
  expect(signal?.aborted).toBe(true)
  await act(async () => pending.resolve({ ok: true, value: { kind: 'missing' } }))
  expect(openResourceIn).not.toHaveBeenCalled()
  expect(grant.listenerCount()).toBe(0)
})

it.each(['clear', 'dispose', 'deployment'] as const)(
  'aborts a pending lookup on %s',
  async (stop) => {
    const { complete, remote, parse, dispose, world, grant, openResourceIn } = await setup()
    const pending = deferred<Awaited<ReturnType<typeof remote.documentArtifact>>>()
    remote.documentArtifact.mockImplementationOnce(() => pending.promise)
    await complete(linked)
    const [, signal] = remote.documentArtifact.mock.calls[0]!
    if (stop === 'clear') {
      parse.clearSession('other-session')
      expect(signal?.aborted).toBe(false)
      parse.clearSession(SESSION)
    } else if (stop === 'deployment') {
      const revision = parse.deployment.getSnapshot().revision
      world.enrichmentScope.publish({ revision: 17 })
      expect(parse.deployment.getSnapshot().revision).not.toBe(revision)
    } else {
      owned.splice(owned.indexOf(dispose), 1)
      await dispose()
    }
    expect(signal?.aborted).toBe(true)
    await act(async () => pending.resolve({ ok: true, value: { kind: 'missing' } }))
    expect(openResourceIn).not.toHaveBeenCalled()
    expect(grant.listenerCount()).toBe(0)
  },
)

it('supersedes a pending transition from a different entry for the same source', async () => {
  const { complete, remote, openResourceIn } = await setup()
  const pending = deferred<Awaited<ReturnType<typeof remote.documentArtifact>>>()
  remote.documentArtifact.mockImplementationOnce(() => pending.promise)
  await complete(linked, historical)
  const [, signal] = remote.documentArtifact.mock.calls[0]!
  await complete(attached)
  expect(signal?.aborted).toBe(true)
  await act(async () => pending.resolve({ ok: true, value: { kind: 'missing' } }))
  expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, addressOf(newest), {
    replaceTab: 'original',
  })
})

it('does not start a metadata read without access or a valid artifact ID', async () => {
  const { complete, grant, remote } = await setup()
  grant.publish(false)
  await complete(attached)
  grant.publish(true)
  await complete(linked, 'invalid-id')
  expect(remote.documentArtifact).not.toHaveBeenCalled()
})

it('does not treat a discarded committed artifact as a current generation', async () => {
  const { complete, remote, openResourceIn } = await setup()
  remote.documentArtifact.mockResolvedValueOnce({ ok: true, value: { kind: 'missing' } })
  await complete(attached)
  expect(remote.documentArtifact).toHaveBeenCalledOnce()
  expect(openResourceIn).not.toHaveBeenCalled()
})

it('reports a failed index lookup without replacing or closing the reader', async () => {
  const { complete, remote, warn, openResourceIn, closeIn } = await setup()
  const error = new RemoteError('gateway/internal', 'index unavailable', {})
  remote.documentArtifact.mockResolvedValueOnce({ ok: false, error })
  await complete(attached)
  expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('committed reading'), error)
  expect(openResourceIn).not.toHaveBeenCalled()
  expect(closeIn).not.toHaveBeenCalled()
})

it('matches an unopened historic alias by its current index without moving a different source', async () => {
  const { complete, remote, openResourceIn } = await setup([
    tabOf(previous, 'alias-reader'),
    tabOf(historical, 'other-source'),
  ])
  const original = remote.documentArtifact.getMockImplementation()!
  remote.documentArtifact.mockImplementation(async (request, signal) => {
    const reply = await original(request, signal)
    if (
      request.op !== 'meta' ||
      request.target.kind !== 'artifact' ||
      !reply.ok ||
      reply.value.kind !== 'meta' ||
      request.target.artifactId === newest
    )
      return reply
    return {
      ok: true,
      value: {
        ...reply.value,
        sourceId: '0'.repeat(64),
        currentArtifactId: request.target.artifactId === previous ? newest : historical,
      },
    }
  })
  await complete(linked)
  expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, addressOf(newest), {
    replaceTab: 'alias-reader',
  })
})

it('continues updating other occurrences when one old artifact metadata read fails', async () => {
  const { complete, remote, warn, openResourceIn } = await setup([
    tabOf(historical, 'unavailable'),
    tabOf(previous, 'original'),
  ])
  const original = remote.documentArtifact.getMockImplementation()!
  const error = new RemoteError('gateway/internal', 'metadata unavailable', {})
  remote.documentArtifact.mockImplementation((request, signal) =>
    request.op === 'meta' &&
    request.target.kind === 'artifact' &&
    request.target.artifactId === historical
      ? Promise.resolve({ ok: false, error })
      : original(request, signal),
  )
  await complete(linked)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('committed reading'), error)
  expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, addressOf(newest), {
    replaceTab: 'original',
  })
})

it('uses canonical attachment metadata to refresh the attachment entry even when committed by old ID', async () => {
  const { complete, remote, documents, openResourceIn } = await setup()
  const title = vi.fn()
  const address = parsedTabAddress({ sessionId: SESSION, ref: REF, title: 'Old title' })
  const unsubscribe = documents.subscribeTitle(address, title)
  const original = remote.documentArtifact.getMockImplementation()!
  remote.documentArtifact.mockImplementation(async (request, signal) => {
    const reply = await original(request, signal)
    if (!reply.ok || reply.value.kind !== 'meta') return reply
    return { ok: true, value: { ...reply.value, targetLabel: REF, title: 'New title' } }
  })
  try {
    await complete(stored)
    expect(title).toHaveBeenLastCalledWith({ state: 'ready', title: 'New title' })
    expect(openResourceIn).toHaveBeenCalledExactlyOnceWith(SESSION, addressOf(newest), {
      replaceTab: 'original',
    })
  } finally {
    unsubscribe()
  }
})

it('does not reopen a tab closed while matching its metadata', async () => {
  const { complete, remote, inventory, openResourceIn } = await setup()
  const original = remote.documentArtifact.getMockImplementation()!
  remote.documentArtifact
    .mockImplementationOnce(original)
    .mockImplementationOnce(async (request, signal) => {
      inventory.publish([])
      return original(request, signal)
    })
  await complete(attached)
  expect(openResourceIn).not.toHaveBeenCalled()
})
