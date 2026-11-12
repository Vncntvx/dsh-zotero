/** Enrichment composition and the read-only lookup contract; active parsing has domain specs. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/service.ts'
import { parseDocument } from '../../src/enrichment/parse-document.ts'
import {
  ZOTERO_ENRICHMENT_OUTPUT_INVALID,
  ZOTERO_ENRICHMENT_TASK_FAILED,
} from '../../src/errors.ts'
import { deferred } from '../helpers/sync.ts'
import { LOCAL, MARKDOWN, URL_INPUT, parseDomain } from './support/enrichment-parse-domain.ts'

const owned: ReturnType<typeof parseDomain>[] = []
function domain(config?: Parameters<typeof parseDomain>[0]) {
  const value = config === undefined ? parseDomain() : parseDomain(config)
  owned.push(value)
  return value
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (value) => await value.dispose()))
})

function reader(world: ReturnType<typeof parseDomain>, config = world.deps.config) {
  const parse = vi.fn(async () => {
    throw new Error('A read must not parse')
  })
  const service = new EnrichmentService(world.ctx, config, {
    client: world.deps.client,
    store: async () => world.store,
    parse,
  })
  return { service, parse }
}

describe('EnrichmentService composition', () => {
  it('installs the read-only slot and ranker and withdraws them on disposal', async () => {
    const world = domain()
    const installed = deferred()
    const configured = deferred<{ presentation: { auto: boolean }; owner: unknown }>()
    const setFulltextEnhancer = vi.fn(() => installed.resolve())
    const setEvidenceRanker = vi.fn()
    world.ctx.provide('zotero', {
      setFulltextEnhancer,
      setEvidenceRanker,
      resolveAttachment: world.resolveAttachment,
    } as unknown as Context['zotero'])
    world.ctx.provide('settings', {
      configure: (presentation: { auto: boolean }, owner: unknown) => {
        configured.resolve({ presentation, owner })
      },
    } as unknown as Context['settings'])
    const { service } = reader(world)
    await installed.promise
    expect(await configured.promise).toEqual({
      presentation: { auto: false },
      owner: world.ctx.fiber,
    })
    expect(setFulltextEnhancer).toHaveBeenCalledWith(service.enhancer)
    expect(setEvidenceRanker).toHaveBeenCalledWith(service.liveEvidenceRanker)
    expect(Object.keys(service.enhancer)).toEqual(['lookup'])
    await world.ctx.fiber.dispose()
    expect(setFulltextEnhancer).toHaveBeenLastCalledWith(undefined)
    expect(setEvidenceRanker).toHaveBeenLastCalledWith(undefined)
  })

  it('configures its settings surface even without a core service', async () => {
    const world = domain()
    const configured = deferred<unknown>()
    world.ctx.provide('settings', {
      configure: (_presentation: unknown, owner: unknown) => configured.resolve(owner),
    } as unknown as Context['settings'])
    reader(world)
    expect(await configured.promise).toBe(world.ctx.fiber)
  })
})

describe('EnrichmentService artifact lookup', () => {
  it('serves parsed Markdown and exact artifact provenance without parsing again', async () => {
    const world = domain({ mode: 'pro' })
    const parsed = await parseDocument(URL_INPUT, world.deps)
    const { service, parse } = reader(world)
    world.fetch.mockClear()
    world.resolveToken.mockClear()
    await expect(service.enhancer.lookup(URL_INPUT)).resolves.toEqual({
      kind: 'hit',
      text: MARKDOWN,
      format: 'markdown',
      source: 'MinerU (pro)',
      pageCount: 3,
      provenance: parsed.provenance,
    })
    expect(world.fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['HEAD'])
    expect(world.resolveToken).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })

  it('returns an absent miss without probing an unindexed URL', async () => {
    const world = domain()
    const { service, parse } = reader(world)
    await expect(service.enhancer.lookup(URL_INPUT)).resolves.toEqual({
      kind: 'miss',
      reason: 'absent',
    })
    expect(world.fetch).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })

  it('declines non-PDF candidates without probing them', async () => {
    const world = domain()
    const { service } = reader(world)
    await expect(
      service.enhancer.lookup({ ...URL_INPUT, contentType: 'text/html' }),
    ).resolves.toEqual({ kind: 'miss', reason: 'absent' })
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('reports stale validators as an expired miss without downloading bytes', async () => {
    const world = domain()
    await parseDocument(URL_INPUT, world.deps)
    const { service, parse } = reader(world)
    world.fetch.mockImplementation(async () => new Response(null, { headers: { etag: '"v2"' } }))
    await expect(service.enhancer.lookup(URL_INPUT)).resolves.toEqual({
      kind: 'miss',
      reason: 'expired',
    })
    expect(world.fetch.mock.calls.at(-1)?.[1]?.method).toBe('HEAD')
    expect(parse).not.toHaveBeenCalled()
  })

  it('reports source-probe failures as faults and does not submit a replacement', async () => {
    const world = domain()
    await parseDocument(URL_INPUT, world.deps)
    const { service, parse } = reader(world)
    world.fetch.mockRejectedValue(new Error('HEAD offline'))
    await expect(service.enhancer.lookup(URL_INPUT)).resolves.toMatchObject({
      kind: 'fault',
      error: { code: ZOTERO_ENRICHMENT_TASK_FAILED },
    })
    expect(parse).not.toHaveBeenCalled()
  })

  it('reports a malformed config as a fault', async () => {
    const world = domain()
    // Deliberately invalid external config checks the read boundary.
    const { service } = reader(world, {
      ...world.deps.config,
      mode: 'turbo',
    } as unknown as typeof world.deps.config)
    await expect(service.enhancer.lookup(LOCAL)).resolves.toMatchObject({ kind: 'fault' })
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('reports an invalid output directory as a stable fault', async () => {
    const world = domain()
    const service = new EnrichmentService(
      world.ctx,
      { outputDir: '~/.ssh/dsh-zotero-parsed' },
      { client: world.deps.client },
    )
    await expect(service.enhancer.lookup(URL_INPUT)).resolves.toMatchObject({
      kind: 'fault',
      error: { code: ZOTERO_ENRICHMENT_OUTPUT_INVALID },
    })
    expect(world.fetch).not.toHaveBeenCalled()
  })
})
