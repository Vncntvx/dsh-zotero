/**
 * Model endpoint failures through the pinned Host Gateway's public unary
 * dispatcher and carrier-safe failure serializer. The production manifest
 * supplies strict wire codecs; only the manager's filesystem is controlled.
 * @module tests/host/enrichment-model-gateway-errors
 */

import { Context } from '@deepseek-ai/cordis'
import TypertGatewayService, {
  type InvokeRemoteRequest,
  type TypertGateway,
} from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/index.ts'
import { ModelDownloadManager } from '../../src/enrichment/model-downloader.ts'
import type { SafeDirectoryDeps } from '../../src/enrichment/safe-directory.ts'
import {
  ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
  ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  ZoteroError,
} from '../../src/errors.ts'
import { TYPERT_MANIFEST } from '../../src/typert.ts'

const MODEL_DIR = '/models/enrichment-gateway'
const MODEL_ENDPOINTS = [
  {
    method: 'semanticModelStatus',
    operation: 'status',
    failureCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  },
  {
    method: 'downloadSemanticModel',
    operation: 'start',
    failureCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  },
  {
    method: 'cancelSemanticModelDownload',
    operation: 'cancel',
    failureCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  },
  {
    method: 'deleteSemanticModel',
    operation: 'remove',
    failureCode: ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
  },
  {
    method: 'verifySemanticModel',
    operation: 'verify',
    failureCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  },
] as const

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

async function setupGateway() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  ctx.effect(() => ctx.typert.register(TYPERT_MANIFEST))
  await ctx.plugin(TypertGatewayService)

  const fs = {
    realpath: vi.fn(async (path: string) => path),
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    access: vi.fn(async () => {
      throw new Error('fixture model directory is not writable')
    }),
    mkdir: vi.fn(async () => {}),
    home: () => '/home/enrichment-gateway',
    temp: () => '/tmp',
  } satisfies SafeDirectoryDeps
  const downloads = new ModelDownloadManager({ fs })
  new EnrichmentService(ctx, {}, { downloads })
  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  return { gateway: ctx.typertGateway, peer, downloads, fs }
}

/** Use the Gateway's serializer, which the real RPC adapter also calls. */
async function failureOf(gateway: TypertGateway, request: InvokeRemoteRequest) {
  try {
    await gateway.invoke(request)
  } catch (error) {
    return { error, wire: gateway.wireStream.failure(error) }
  }
  throw new Error(`Expected zotero/${request.method} to fail`)
}

describe('enrichment model errors through the real Typert Gateway', () => {
  it.each(MODEL_ENDPOINTS)(
    '$method rejects an unknown wire model before reaching its manager',
    async ({ method, operation }) => {
      const { gateway, peer, downloads, fs } = await setupGateway()
      const called = vi.spyOn(downloads, operation)
      // Deliberately malformed JSON input: the production strict codec, not a
      // direct service call, owns this refusal.
      const failure = await failureOf(gateway, {
        namespace: 'zotero',
        method,
        args: { request: { model: 'unknown-model', modelDir: MODEL_DIR } },
        peer,
      })

      expect(failure.wire).toEqual({
        code: 'gateway/input-invalid',
        message: expect.any(String),
        details: { endpoint: `zotero/${method}`, field: 'request' },
      })
      expect(called).not.toHaveBeenCalled()
      expect(fs.access).not.toHaveBeenCalled()
      expect(fs.mkdir).not.toHaveBeenCalled()
    },
  )

  it.each(MODEL_ENDPOINTS)(
    '$method preserves a manager failure as its typed wire reason with its stable code',
    async ({ method, operation, failureCode }) => {
      const { gateway, peer, downloads, fs } = await setupGateway()
      const called = vi.spyOn(downloads, operation)
      const failure = await failureOf(gateway, {
        namespace: 'zotero',
        method,
        args: { request: { model: 'balanced', modelDir: MODEL_DIR } },
        peer,
      })

      expect(failure.wire).toEqual({
        code: 'zotero/enrichment',
        message: expect.any(String),
        details: { code: failureCode },
      })
      // Structural, not `instanceof`: a remote error crossing a module or
      // realm copy keeps its marker but not this realm's prototype.
      expect(remoteErrorOf(failure.error)).toMatchObject({
        code: 'zotero/enrichment',
        cause: expect.any(ZoteroError),
      })
      expect(called).toHaveBeenCalledOnce()
      expect(fs.access).toHaveBeenCalledOnce()
      expect(fs.mkdir).not.toHaveBeenCalled()
    },
  )

  it.each(MODEL_ENDPOINTS)(
    '$method classifies a pre-cancelled valid request as gateway/cancelled',
    async ({ method, operation }) => {
      const { gateway, peer, downloads, fs } = await setupGateway()
      const called = vi.spyOn(downloads, operation)
      const controller = new AbortController()
      controller.abort()
      const failure = await failureOf(gateway, {
        namespace: 'zotero',
        method,
        args: { request: { model: 'balanced', modelDir: MODEL_DIR } },
        peer,
        signal: controller.signal,
      })

      expect(failure.wire).toEqual({
        code: 'gateway/cancelled',
        message: expect.any(String),
        details: {},
      })
      expect(called).not.toHaveBeenCalled()
      expect(fs.access).not.toHaveBeenCalled()
      expect(fs.mkdir).not.toHaveBeenCalled()
    },
  )
})
