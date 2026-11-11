/**
 * The enrichment service's model endpoints and the ranking gate, through the
 * component service with a scripted download manager: request fields override
 * committed settings, unknown values are refused at the wire boundary, and the
 * ranker is lexical with the feature off but fail-closed with it on and the
 * model absent.
 * @module tests/host/enrichment-model-endpoints
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/index.ts'
import type { ModelDownloadManager } from '../../src/enrichment/model-downloader.ts'
import type { SemanticModelStatus } from '../../src/enrichment/model-downloader.ts'
import { bm25EvidenceRanker } from '../../src/local/evidence-ranker.ts'
import {
  ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
  ZOTERO_INVALID_ARGUMENT,
} from '../../src/errors.ts'

const services: EnrichmentService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) {
    // The fiber effect owns disposal; the tests construct on a bare Context.
    void service
  }
})

function statusOf(overrides: Partial<SemanticModelStatus> = {}): SemanticModelStatus {
  return {
    model: 'balanced',
    ready: false,
    downloading: false,
    path: '/models/qwen3-0.6b',
    downloadedBytes: 0,
    totalBytes: 100,
    percent: 0,
    ...overrides,
  }
}

function managerOf(overrides: Partial<Record<string, unknown>> = {}): ModelDownloadManager {
  return {
    status: vi.fn(async () => statusOf()),
    start: vi.fn(async () => ({
      success: true,
      model: 'balanced',
      status: 'started' as const,
      path: '/models/qwen3-0.6b',
    })),
    cancel: vi.fn(async () => false),
    verify: vi.fn(async () => statusOf({ ready: true, percent: 100 })),
    dispose: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ModelDownloadManager
}

function serviceOf(
  config: ConstructorParameters<typeof EnrichmentService>[1],
  manager: ModelDownloadManager = managerOf(),
): EnrichmentService {
  const service = new EnrichmentService(new Context(), config, {
    client: {} as never,
    downloads: manager,
  })
  services.push(service)
  return service
}

const LIVE = new AbortController().signal

describe('the enrichment model endpoints', () => {
  it('serves status with the request model overriding committed config', async () => {
    const manager = managerOf()
    const service = serviceOf({ semanticModel: 'balanced' }, manager)
    const status = await service.semanticModelStatus({ model: 'lightweight' }, LIVE)
    expect(status.model).toBe('balanced')
    expect(manager.status).toHaveBeenCalledWith('lightweight', '')
  })

  it('falls back to committed config when the request omits fields', async () => {
    const manager = managerOf()
    const service = serviceOf(
      { semanticModel: 'lightweight', semanticModelDir: '/custom/models' },
      manager,
    )
    await service.semanticModelStatus({}, LIVE)
    expect(manager.status).toHaveBeenCalledWith('lightweight', '/custom/models')
  })

  it('downloads with the staged source and force flag', async () => {
    const manager = managerOf()
    const service = serviceOf({ semanticModel: 'balanced' }, manager)
    const result = await service.downloadSemanticModel(
      { model: 'lightweight', source: 'huggingface', force: true },
      LIVE,
    )
    expect(result.status).toBe('started')
    expect(manager.start).toHaveBeenCalledWith({
      model: 'lightweight',
      source: 'huggingface',
      modelDir: '',
      force: true,
    })
  })

  it('cancels and verifies through the same manager', async () => {
    const manager = managerOf()
    const service = serviceOf({}, manager)
    expect(await service.cancelSemanticModelDownload({ model: 'balanced' }, LIVE)).toEqual({
      cancelled: false,
    })
    expect((await service.verifySemanticModel({}, LIVE)).ready).toBe(true)
    expect(manager.verify).toHaveBeenCalledWith('balanced', '')
  })

  it('refuses an unknown model at the wire boundary', async () => {
    const service = serviceOf({})
    await expect(
      service.semanticModelStatus({ model: 'nope' as never }, LIVE),
    ).rejects.toMatchObject({ code: 'zotero/domain', details: { code: ZOTERO_INVALID_ARGUMENT } })
    await expect(
      service.downloadSemanticModel({ source: 'gitee' as never }, LIVE),
    ).rejects.toMatchObject({ code: 'zotero/domain', details: { code: ZOTERO_INVALID_ARGUMENT } })
  })
})

describe('the enrichment ranking gate', () => {
  it('is the core lexical ranker while semantic search is off', async () => {
    const service = serviceOf({ enableSemanticSearch: false })
    const result = await service.liveEvidenceRanker.rank({
      query: 'bridges',
      chunks: [{ text: 'bridges and tunnels', index: 0 }],
    })
    expect(result.routes).toEqual(['lexical'])
    expect(result.matches[0]?.matchKind).toBe('lexical')
  })

  it('fails closed when semantic search is on and the model is absent', async () => {
    const service = serviceOf({ enableSemanticSearch: true, semanticModel: 'balanced' })
    await expect(
      service.liveEvidenceRanker.rank({
        query: 'bridges',
        chunks: [{ text: 'bridges and tunnels', index: 0 }],
      }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE })
  })

  it('never claims the lexical ranker when the slot is installed', () => {
    const service = serviceOf({})
    expect(service.liveEvidenceRanker).not.toBe(bm25EvidenceRanker)
  })
})
