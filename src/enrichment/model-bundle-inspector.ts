/**
 * Dependency-free inspection of one installed model bundle.
 *
 * The host status/verify endpoints, the installer, and the CLI all judge a
 * bundle with this one rule: the commit marker must equal the catalog record
 * exactly, every pinned path must be a regular file (never a symlink) at its
 * pinned size, and a successful SHA-256 check must belong to the same file
 * identity snapshot now on disk. A same-size mutation therefore invalidates
 * readiness without a second hash on every poll.
 *
 * This module imports only Node built-ins and types, so Node's native
 * TypeScript stripping can load it from `scripts/fetch-semantic-model.mjs`
 * without pulling the ONNX runtime or tokenizer into the CLI process.
 * @module dsh-zotero/enrichment/model-bundle-inspector
 */

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open as openFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { SemanticModelManifest } from '../enrichment-model-catalog.js'
import {
  catalogFilePinsOf,
  catalogFingerprintOf,
  MANIFEST_MAX_BYTES,
  MANIFEST_PATH,
  READ_CHUNK_BYTES,
} from './model-manifest.js'
import type {
  BundleInspection,
  BundlePathSnapshot,
  BundleSnapshot,
  ModelBundleInspectorPort,
  ModelBundleTarget,
} from './model-installation.js'
import { identityOf } from './model-fs.js'
import { readRegularFile } from '../regular-file.js'

interface VerifiedSnapshot {
  readonly catalogFingerprint: string
  readonly identityFingerprint: string
}

/** One per-process coalescing entry. Polling reuses a successful hash only
 * while the on-disk identity and the catalog record are unchanged. The entry
 * set is capped at {@link VERIFIED_SNAPSHOT_LIMIT} and cleared by the owning
 * component's teardown, so no address seen once keeps memory for the life of
 * the process. */
const verifiedSnapshots = new Map<string, VerifiedSnapshot>()

/**
 * The entry ceiling. One installed tier per catalog entry and a handful of
 * configured dirs are the real cardinality; the cap exists so a stream of
 * distinct targets cannot grow the map without bound.
 */
const VERIFIED_SNAPSHOT_LIMIT = 16

/** Remember one verified snapshot, evicting the oldest entry at the cap. */
function rememberVerified(cacheKey: string, value: VerifiedSnapshot): void {
  verifiedSnapshots.delete(cacheKey)
  if (verifiedSnapshots.size >= VERIFIED_SNAPSHOT_LIMIT) {
    const oldest = verifiedSnapshots.keys().next().value
    if (oldest !== undefined) verifiedSnapshots.delete(oldest)
  }
  verifiedSnapshots.set(cacheKey, value)
}

/**
 * Drop every verified snapshot. Called from the owning component's teardown,
 * so the module-level memo does not outlive the registration that filled it.
 */
export function clearVerifiedSnapshots(): void {
  verifiedSnapshots.clear()
}

function catalogFiles(
  expected: SemanticModelManifest,
): Map<string, { bytes: number; sha256: string }> {
  // The shared rule; this module keeps its plain-error mapping.
  return catalogFilePinsOf(expected, (reason) => {
    throw new Error(reason)
  })
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** A missing path still contributes its absolute expected path to the snapshot;
 * the installer uses that list as its publication whitelist. */
async function pathSnapshot(dir: string, relativePath: string): Promise<BundlePathSnapshot> {
  const path = join(dir, relativePath)
  const info = await lstatOrUndefined(path)
  if (info === undefined) return { relativePath, path }
  return { relativePath, path, identity: identityOf(info) }
}

function identityFingerprintOf(snapshot: Omit<BundleSnapshot, 'identityFingerprint'>): string {
  const hash = createHash('sha256')
  hash.update(snapshot.catalogFingerprint)
  const each = (entry: BundlePathSnapshot) => {
    hash.update(entry.relativePath)
    hash.update(entry.path)
    const id = entry.identity
    if (id === undefined) hash.update('missing')
    else hash.update(`${id.dev}:${id.ino}:${id.size}:${id.mtimeMs}:${id.ctimeMs}`)
  }
  each(snapshot.manifest)
  for (const entry of snapshot.files) each(entry)
  for (const entry of snapshot.directories) each(entry)
  return hash.digest('hex')
}

async function hashFile(path: string, signal: AbortSignal | undefined): Promise<string> {
  const handle = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(READ_CHUNK_BYTES)
    for (;;) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function readManifest(
  path: string,
): Promise<{ kind: 'valid' | 'missing' | 'corrupt'; reason?: string; parsed?: unknown }> {
  const info = await lstatOrUndefined(path)
  if (info === undefined) return { kind: 'missing' }
  if (info.isSymbolicLink() || !info.isFile())
    return { kind: 'corrupt', reason: 'the commit marker is not a regular file' }
  if (info.size > MANIFEST_MAX_BYTES)
    return { kind: 'corrupt', reason: 'the commit marker exceeds its bounded size' }
  try {
    const bytes = await readRegularFile(path, MANIFEST_MAX_BYTES)
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return { kind: 'corrupt', reason: 'the commit marker is not a JSON object' }
    return { kind: 'valid', parsed }
  } catch (error) {
    return { kind: 'corrupt', reason: (error as Error).message }
  }
}

export interface BundleInspectorOptions {
  /** Skip the coalescing cache and hash every pinned file. */
  readonly forceHash?: boolean
  readonly signal?: AbortSignal
}

export interface BundleInspector extends ModelBundleInspectorPort {
  readonly inspect: (
    target: ModelBundleTarget,
    options?: BundleInspectorOptions,
  ) => Promise<BundleInspection>
  readonly snapshot: (
    target: ModelBundleTarget,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<BundleSnapshot>
}

/** Inspectors share the bounded process cache across status reads and runtime loaders. */
export function createBundleInspector(): BundleInspector {
  const cacheKeyOf = (target: ModelBundleTarget) =>
    `${resolve(target.dir)}|${catalogFingerprintOf(target.expected)}`

  const snapshot = async (
    target: ModelBundleTarget,
    options?: { readonly signal?: AbortSignal },
  ): Promise<BundleSnapshot> => {
    options?.signal?.throwIfAborted()
    const dir = resolve(target.dir)
    const expected = target.expected
    const files = catalogFiles(expected)
    const relativePaths = [...files.keys()].sort()
    const directories = new Set<string>(['.'])
    for (const relativePath of relativePaths) {
      const segments = relativePath.split('/')
      for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'))
    }
    const directorySnapshots: BundlePathSnapshot[] = []
    for (const relativePath of [...directories].sort()) {
      options?.signal?.throwIfAborted()
      directorySnapshots.push(await pathSnapshot(dir, relativePath))
    }
    const fileSnapshots: BundlePathSnapshot[] = []
    for (const relativePath of relativePaths) {
      options?.signal?.throwIfAborted()
      fileSnapshots.push(await pathSnapshot(dir, relativePath))
    }
    const manifest = await pathSnapshot(dir, MANIFEST_PATH)
    const partial: Omit<BundleSnapshot, 'identityFingerprint'> = {
      dir,
      catalogFingerprint: catalogFingerprintOf(expected),
      directories: directorySnapshots,
      manifest,
      files: fileSnapshots,
    }
    return { ...partial, identityFingerprint: identityFingerprintOf(partial) }
  }

  const inspect = async (
    target: ModelBundleTarget,
    options?: BundleInspectorOptions,
  ): Promise<BundleInspection> => {
    const signal = options?.signal
    signal?.throwIfAborted()
    const dir = resolve(target.dir)
    const expected = target.expected
    const files = catalogFiles(expected)
    const current = await snapshot(target, { signal })
    const totalBytes = [...files.values()].reduce((sum, file) => sum + file.bytes, 0)
    let presentBytes = 0
    let verifiedBytes = 0
    let directoryReason: string | undefined
    for (const directory of current.directories) {
      const info = await lstatOrUndefined(directory.path)
      if (info !== undefined && (info.isSymbolicLink() || !info.isDirectory())) {
        directoryReason = `${directory.relativePath} is not a regular directory`
        break
      }
    }
    const { parsed, ...marker } =
      directoryReason === undefined
        ? await readManifest(join(dir, MANIFEST_PATH))
        : { kind: 'corrupt' as const, reason: directoryReason, parsed: undefined }
    const fileResults: {
      readonly relativePath: string
      readonly kind: 'valid' | 'missing' | 'corrupt'
      readonly bytes: number
      readonly sha256?: string
      readonly reason?: string
    }[] = []
    let corruptReason: string | undefined

    if (marker.kind !== 'valid') {
      corruptReason = marker.reason ?? 'the commit marker is missing'
    } else if (JSON.stringify(parsed) !== JSON.stringify(expected))
      corruptReason = 'the commit marker disagrees with the catalog'

    const cacheKey = cacheKeyOf(target)
    const cached = verifiedSnapshots.get(cacheKey)
    // A status poll reuses the last successful full hash only if the catalog
    // record, the marker, and every file identity are unchanged. `verify` and
    // the installer pass forceHash so a repair never trusts a stale entry.
    const reusable =
      options?.forceHash !== true &&
      cached !== undefined &&
      cached.catalogFingerprint === current.catalogFingerprint &&
      cached.identityFingerprint === current.identityFingerprint &&
      corruptReason === undefined

    let allValid = corruptReason === undefined
    for (const [relativePath, pin] of files) {
      signal?.throwIfAborted()
      if (directoryReason !== undefined) {
        fileResults.push({ relativePath, kind: 'corrupt', bytes: 0, reason: directoryReason })
        continue
      }
      const path = join(dir, relativePath)
      const info = await lstatOrUndefined(path)
      if (info === undefined || info.isSymbolicLink() || !info.isFile()) {
        allValid = false
        fileResults.push({
          relativePath,
          kind: 'missing',
          bytes: 0,
          reason: `${relativePath} is missing or not a regular file`,
        })
        continue
      }
      if (info.size === pin.bytes) presentBytes += pin.bytes
      if (info.size !== pin.bytes) {
        allValid = false
        fileResults.push({
          relativePath,
          kind: 'corrupt',
          bytes: info.size,
          reason: `${relativePath} is ${info.size} bytes, expected ${pin.bytes}`,
        })
        continue
      }
      if (reusable) {
        verifiedBytes += pin.bytes
        fileResults.push({ relativePath, kind: 'valid', bytes: info.size, sha256: pin.sha256 })
        continue
      }
      signal?.throwIfAborted()
      const digest = await hashFile(path, signal).catch((error: Error) => error)
      if (digest instanceof Error || digest !== pin.sha256) {
        allValid = false
        fileResults.push({
          relativePath,
          kind: 'corrupt',
          bytes: info.size,
          ...(typeof digest === 'string' ? { sha256: digest } : {}),
          reason: `${relativePath} failed its SHA-256 check`,
        })
        continue
      }
      verifiedBytes += pin.bytes
      fileResults.push({ relativePath, kind: 'valid', bytes: info.size, sha256: digest })
    }

    const kind: BundleInspection['kind'] = allValid
      ? 'ready'
      : presentBytes === 0 && marker.kind === 'missing'
        ? 'missing'
        : 'corrupt'
    const reason =
      kind === 'corrupt'
        ? (corruptReason ??
          fileResults.find((file) => file.kind !== 'valid')?.reason ??
          'the model bundle failed validation')
        : undefined
    if (allValid)
      rememberVerified(cacheKey, {
        catalogFingerprint: current.catalogFingerprint,
        identityFingerprint: current.identityFingerprint,
      })
    else verifiedSnapshots.delete(cacheKey)

    return {
      kind,
      snapshot: current,
      totalBytes,
      presentBytes,
      verifiedBytes,
      ...(reason !== undefined ? { reason } : {}),
      manifest: marker,
      files: fileResults,
    }
  }

  return { snapshot, inspect }
}

/** Read-only status: a missing root is a normal miss, never a write. */
export async function inspectInstalledBundle(
  dir: string,
  expected: SemanticModelManifest,
  options?: BundleInspectorOptions,
): Promise<BundleInspection> {
  return await createBundleInspector().inspect({ dir, expected }, options)
}
