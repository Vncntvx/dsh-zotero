/**
 * On-disk verification and loading of one local model bundle.
 *
 * A bundle is trusted only after three checks against the catalog: its
 * `manifest.json` matches the catalog record exactly, every pinned file is
 * present at the pinned size, and every file hashes to the pinned SHA-256.
 * The checks run before the ONNX session opens, so a corrupted or tampered
 * bundle can never produce embeddings — it fails with
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` instead.
 * @module dsh-zotero/enrichment/semantic/bundle
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { manifestOf, type SemanticModelEntry } from '../../enrichment-model-catalog.js'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'
import type { Embedder } from './session.js'
import { openEmbedder } from './session.js'

/** Filesystem seams, injectable so tests never need real model bytes. */
export interface BundleFsDeps {
  readonly readFile: (path: string) => Promise<Uint8Array>
  readonly stat: (path: string) => Promise<{ readonly size: number }>
  readonly hashFile: (path: string) => Promise<string>
}

function refuse(reason: string): never {
  throw new ZoteroError(
    `The local semantic model is unusable: ${reason}`,
    ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
  )
}

const hostDeps: BundleFsDeps = {
  readFile: (path) => readFile(path),
  stat: async (path) => {
    const info = await stat(path)
    return { size: info.size }
  },
  hashFile: (path) =>
    new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk as Buffer))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    }),
}

/** Read and parse one JSON file from the bundle. */
export async function readJsonFile(path: string): Promise<unknown> {
  const bytes = await readFile(path)
  return JSON.parse(new TextDecoder('utf-8').decode(bytes)) as unknown
}

/**
 * Verify one bundle directory against the catalog: manifest agreement, pinned
 * sizes, pinned digests.
 * @param dir - the bundle directory.
 * @param spec - the catalog entry the bundle claims to be.
 * @param deps - filesystem seams; defaults to the host.
 */
export async function verifySemanticBundle(
  dir: string,
  spec: SemanticModelEntry,
  deps: BundleFsDeps = hostDeps,
): Promise<void> {
  let manifest: unknown
  try {
    manifest = JSON.parse(
      new TextDecoder('utf-8').decode(await deps.readFile(join(dir, 'manifest.json'))),
    )
  } catch (error) {
    refuse(`manifest.json is missing or unreadable (${(error as Error).message})`)
  }
  const expected = manifestOf(spec)
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    (manifest as { schema?: unknown }).schema !== expected.schema ||
    (manifest as { key?: unknown }).key !== expected.key ||
    (manifest as { physicalKey?: unknown }).physicalKey !== expected.physicalKey ||
    (manifest as { modelId?: unknown }).modelId !== expected.modelId ||
    (manifest as { revision?: unknown }).revision !== expected.revision ||
    (manifest as { dimension?: unknown }).dimension !== expected.dimension ||
    (manifest as { maxTokens?: unknown }).maxTokens !== expected.maxTokens ||
    (manifest as { pooling?: unknown }).pooling !== expected.pooling ||
    (manifest as { normalize?: unknown }).normalize !== expected.normalize ||
    (manifest as { queryPrefix?: unknown }).queryPrefix !== expected.queryPrefix ||
    (manifest as { documentPrefix?: unknown }).documentPrefix !== expected.documentPrefix
  ) {
    refuse('manifest.json disagrees with the catalog about this model')
  }
  const files = (manifest as { files?: unknown }).files
  if (typeof files !== 'object' || files === null) refuse('manifest.json has no file record')
  for (const file of spec.files) {
    const entry = (files as Record<string, { bytes?: unknown; sha256?: unknown }>)[file.path]
    if (entry === undefined || entry.bytes !== file.bytes || entry.sha256 !== file.sha256) {
      refuse(`manifest.json disagrees about ${file.path}`)
    }
    const onDisk = await deps.stat(join(dir, file.path)).catch((error: Error) => {
      refuse(`${file.path} is missing (${error.message})`)
    })
    if (onDisk.size !== file.bytes) {
      refuse(`${file.path} is ${onDisk.size} bytes, expected ${file.bytes}`)
    }
    const digest = await deps.hashFile(join(dir, file.path)).catch((error: Error) => {
      refuse(`${file.path} could not be hashed (${error.message})`)
    })
    if (digest !== file.sha256) {
      refuse(`${file.path} failed its SHA-256 check`)
    }
  }
}

/**
 * Verify a bundle and open its embedder. This is the one entry the ranker's
 * loader uses; every failure mode above surfaces as
 * `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`.
 * @param spec - the catalog entry to load.
 * @param dir - the bundle directory.
 */
export async function openSemanticEmbedder(
  spec: SemanticModelEntry,
  dir: string,
  deps: BundleFsDeps = hostDeps,
): Promise<Embedder> {
  await verifySemanticBundle(dir, spec, deps)
  return await openEmbedder(spec, dir)
}
