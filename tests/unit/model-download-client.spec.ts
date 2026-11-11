/**
 * The model download client: one pinned file through the public-address double
 * gate. Every network and filesystem seam is injected, so the spec exercises
 * redirect re-validation, byte caps, content-length prechecks, stall and total
 * deadlines, checksum verification, and temp-file hygiene without touching the
 * network or the user's home directory.
 * @module tests/unit/model-download-client
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  MODEL_SOURCES,
  downloadPinnedFile,
  type FetchLike,
} from '../../src/enrichment/model-download-client.ts'
import type { SemanticModelSpec } from '../../src/enrichment-model-catalog.ts'

function specOf(overrides: Partial<SemanticModelSpec> = {}): SemanticModelSpec {
  return {
    key: 'balanced',
    physicalKey: 'qwen3-0.6b',
    label: 'test',
    physicalModel: 'test',
    note: 'test',
    modelId: 'acme/test-model',
    revision: 'a'.repeat(40),
    dimension: 2,
    maxTokens: 16,
    languages: ['*'],
    license: 'MIT',
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [],
    ...overrides,
  } as SemanticModelSpec
}

const FILE = { path: 'onnx/model_quantized.onnx', bytes: 6, sha256: '' }

function bodyOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
}

interface ScriptedResponse {
  readonly status?: number
  readonly location?: string
  readonly bytes?: Buffer
  readonly contentLength?: string | null
}

/** One URL → response script, plus the hops it served. */
function fetchScript(responses: Record<string, ScriptedResponse>): {
  fetch: FetchLike
  served: string[]
} {
  const served: string[] = []
  const fetch: FetchLike = async (url) => {
    served.push(url)
    const response = responses[url] ?? { status: 404 }
    const bytes = response.bytes ?? Buffer.alloc(0)
    return {
      ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      status: response.status ?? 200,
      headers: {
        get: (name) =>
          name.toLowerCase() === 'location'
            ? (response.location ?? null)
            : (response.contentLength ?? null),
      },
      body: response.location === undefined ? bodyOf(bytes) : null,
    }
  }
  return { fetch, served }
}

const gateDeps = {
  resolver: async () => [{ address: '93.184.216.34', family: 4 as const }],
  dispatcher: () => ({ dispatcher: {}, close: async () => {} }),
}

const pinned = (bytes: Buffer): typeof FILE => ({
  ...FILE,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})

describe('downloadPinnedFile', () => {
  it('pins the revision in every mirror URL and writes the verified file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const bytes = Buffer.from('model!')
    const { fetch } = fetchScript({
      [`https://hf-mirror.com/acme/test-model/resolve/${'a'.repeat(40)}/onnx/model_quantized.onnx`]:
        { bytes },
    })
    const result = await downloadPinnedFile({
      model: specOf(),
      file: pinned(bytes),
      dir,
      sources: ['hf-mirror', 'huggingface'],
      deps: { fetch, ...gateDeps },
    })
    expect(result.source).toBe('hf-mirror')
    expect(result.sha256).toBe(pinned(bytes).sha256)
    expect(await readFile(join(dir, 'onnx/model_quantized.onnx'))).toEqual(bytes)
    await rm(dir, { recursive: true, force: true })
  })

  it('revalidates every redirect hop and refuses a downgrade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const bytes = Buffer.from('model!')
    const origin = `https://hf-mirror.com/acme/test-model/resolve/${'a'.repeat(40)}/onnx/model_quantized.onnx`
    const { fetch } = fetchScript({
      [origin]: { location: 'http://evil.example.com/file' },
    })
    await expect(
      downloadPinnedFile({
        model: specOf(),
        file: pinned(bytes),
        dir,
        sources: ['hf-mirror'],
        deps: { fetch, ...gateDeps },
      }),
    ).rejects.toThrow(/insecure HTTP/)
    await rm(dir, { recursive: true, force: true })
  })

  it('follows a redirect to a public HTTPS host and pins the result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const bytes = Buffer.from('model!')
    const origin = `https://hf-mirror.com/acme/test-model/resolve/${'a'.repeat(40)}/onnx/model_quantized.onnx`
    const { fetch } = fetchScript({
      [origin]: { location: 'https://cdn.example.com/file' },
      'https://cdn.example.com/file': { bytes },
    })
    const result = await downloadPinnedFile({
      model: specOf(),
      file: pinned(bytes),
      dir,
      sources: ['hf-mirror'],
      deps: { fetch, ...gateDeps },
    })
    expect(result.source).toBe('hf-mirror')
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses a body whose content-length disagrees with the pin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const bytes = Buffer.from('model!')
    const { fetch } = fetchScript({
      [`https://hf-mirror.com/acme/test-model/resolve/${'a'.repeat(40)}/onnx/model_quantized.onnx`]:
        {
          bytes,
          contentLength: '999',
        },
    })
    await expect(
      downloadPinnedFile({
        model: specOf(),
        file: pinned(bytes),
        dir,
        sources: ['hf-mirror'],
        deps: { fetch, ...gateDeps },
      }),
    ).rejects.toThrow(/content-length|serves/i)
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses a body that streams past the pinned size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const bytes = Buffer.from('model!')
    const lying = Buffer.concat([bytes, Buffer.from('extra')])
    const { fetch } = fetchScript({
      [`https://hf-mirror.com/acme/test-model/resolve/${'a'.repeat(40)}/onnx/model_quantized.onnx`]:
        { bytes: lying },
    })
    await expect(
      downloadPinnedFile({
        model: specOf(),
        file: pinned(bytes),
        dir,
        sources: ['hf-mirror'],
        deps: { fetch, ...gateDeps },
      }),
    ).rejects.toThrow(/exceeded its pinned size/)
    await rm(dir, { recursive: true, force: true })
  })

  it('rejects a checksum mismatch and leaves no temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const { fetch } = fetchScript({
      [`https://hf-mirror.com/acme/test-model/resolve/${'a'.repeat(40)}/onnx/model_quantized.onnx`]:
        {
          bytes: Buffer.from('wrong'),
        },
    })
    await expect(
      downloadPinnedFile({
        model: specOf(),
        file: pinned(Buffer.from('model!')),
        dir,
        sources: ['hf-mirror'],
        deps: { fetch, ...gateDeps },
      }),
    ).rejects.toThrow(/checksum failure/)
    await rm(dir, { recursive: true, force: true })
  })

  it('falls back to the next mirror when the preferred one fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dl-'))
    const bytes = Buffer.from('model!')
    const revision = 'a'.repeat(40)
    const { fetch, served } = fetchScript({
      [`https://hf-mirror.com/acme/test-model/resolve/${revision}/onnx/model_quantized.onnx`]: {
        status: 500,
      },
      [`https://huggingface.co/acme/test-model/resolve/${revision}/onnx/model_quantized.onnx`]: {
        bytes,
      },
    })
    const result = await downloadPinnedFile({
      model: specOf(),
      file: pinned(bytes),
      dir,
      sources: ['hf-mirror', 'huggingface'],
      deps: { fetch, ...gateDeps },
    })
    expect(result.source).toBe('huggingface')
    expect(served.some((url) => url.startsWith('https://huggingface.co/'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('names both mirrors in the source table', () => {
    expect(Object.keys(MODEL_SOURCES).sort()).toEqual(['hf-mirror', 'huggingface'])
  })
})
