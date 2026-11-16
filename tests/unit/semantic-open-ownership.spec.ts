/** Opening uses pinned bytes and transfers session ownership only after every setup step. */
import { createHash } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openEmbedder } from '../../src/enrichment/semantic/session.ts'
import type { SemanticModelEntry } from '../../src/enrichment-model-catalog.ts'
import { tinyModel } from '../helpers/semantic-model-bundle.ts'
import { withTempDir } from '../helpers/temp-dir.ts'

const seam = vi.hoisted(() => ({ create: vi.fn(), release: vi.fn(), tokenizer: vi.fn() }))
vi.mock('../../src/enrichment/semantic/runtime.js', () => ({
  loadSemanticRuntime: async () => ({ InferenceSession: { create: seam.create } }),
}))
vi.mock('../../src/enrichment/semantic/tokenizer.js', () => ({
  createEmbeddingTokenizer: seam.tokenizer,
}))

beforeEach(() => {
  seam.release.mockResolvedValue(undefined)
  seam.create.mockResolvedValue({
    inputNames: ['input_ids'],
    outputNames: ['sentence_embedding'],
    release: seam.release,
  })
  seam.tokenizer.mockResolvedValue({
    batch: () => {
      throw new Error('No inference in this fixture')
    },
  })
})
afterEach(() => vi.resetAllMocks())

async function files(
  run: (spec: SemanticModelEntry, dir: string) => Promise<void>,
  config = '{}',
): Promise<void> {
  await withTempDir(async (dir) => {
    const bytes = {
      'config.json': config,
      'tokenizer.json': '{}',
      'tokenizer_config.json': '{}',
      'onnx/model_quantized.onnx': 'synthetic model bytes',
    }
    const pins = []
    for (const [path, value] of Object.entries(bytes)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), value)
      pins.push({
        path,
        bytes: Buffer.byteLength(value),
        sha256: createHash('sha256').update(value).digest('hex'),
      })
    }
    await run({ ...tinyModel, files: pins }, dir)
  })
}

it('does not release a session when creation itself fails', async () => {
  await files(async (spec, dir) => {
    const failure = new Error('create failed')
    seam.create.mockRejectedValue(failure)
    await expect(openEmbedder(spec, dir)).rejects.toBe(failure)
    expect(seam.release).not.toHaveBeenCalled()
  })
})

it('releases exactly once if a pinned config disappears after session creation', async () => {
  await files(async (spec, dir) => {
    await unlink(join(dir, 'config.json'))
    await expect(openEmbedder(spec, dir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(seam.release).toHaveBeenCalledTimes(1)
  })
})

it('releases after an invalid decoder cache contract', async () => {
  await files(async (spec, dir) => {
    seam.create.mockResolvedValue({
      inputNames: ['past_key_values.0.key'],
      outputNames: ['sentence_embedding'],
      release: seam.release,
    })
    await expect(openEmbedder(spec, dir)).rejects.toThrow(/KV cache/)
    expect(seam.release).toHaveBeenCalledTimes(1)
  })
})

it('preserves the tokenizer failure when releasing the partial session also fails', async () => {
  await files(async (spec, dir) => {
    const failure = new Error('tokenizer failed')
    seam.tokenizer.mockRejectedValue(failure)
    seam.release.mockRejectedValue(new Error('release failed'))
    await expect(openEmbedder(spec, dir)).rejects.toBe(failure)
    expect(seam.release).toHaveBeenCalledTimes(1)
  })
})

it('releases if the opened session has no supported output', async () => {
  await files(async (spec, dir) => {
    seam.create.mockResolvedValue({ inputNames: [], outputNames: [], release: seam.release })
    await expect(openEmbedder(spec, dir)).rejects.toThrow(/unsupported encoder outputs/)
    expect(seam.release).toHaveBeenCalledTimes(1)
  })
})

it('transfers the successful session to its owner and releases it once', async () => {
  await files(async (spec, dir) => {
    const embedder = await openEmbedder(spec, dir)
    expect(seam.release).not.toHaveBeenCalled()
    await embedder.dispose()
    await embedder.dispose()
    expect(seam.release).toHaveBeenCalledTimes(1)
  })
})

it('passes the verified byte snapshot even when the ONNX path changes during creation', async () => {
  await files(async (spec, dir) => {
    seam.create.mockImplementationOnce(async (bytes: Uint8Array) => {
      await writeFile(join(dir, 'onnx/model_quantized.onnx'), 'replacement model bytes')
      expect(Buffer.from(bytes).toString()).toBe('synthetic model bytes')
      return { inputNames: [], outputNames: ['sentence_embedding'], release: seam.release }
    })
    const embedder = await openEmbedder(spec, dir)
    await embedder.dispose()
  })
})
