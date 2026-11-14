/**
 * Remove one installed model bundle.
 *
 * Removal uses the installer's cross-process writer lock and its catalog-only
 * ownership rule: the commit marker and pinned files are removed, while files
 * outside the catalog stay in place. Every parent directory of a pinned path
 * must be a real directory, so a planted symlink cannot redirect an unlink
 * outside the bundle. Empty catalog directories are pruned after their files.
 * @module dsh-zotero/enrichment/model-removal
 */

import { lstat, realpath, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { SemanticModelManifest } from '../enrichment-model-catalog.js'
import { assertModelLockPath, safeModelRelativePath } from './model-installation.js'
import { MANIFEST_PATH, SAFE_SEGMENT } from './model-manifest.js'

const LOCK_WAIT_MS = 60_000

/**
 * The machine code every removal failure carries. A removal reaches a caller
 * as the `cause` of a `ZoteroError`, so this code never enters the Zotero
 * vocabulary; it is a `HarnessError` code so a direct caller can still route on
 * `name`/`code` instead of parsing the message.
 */
export const MODEL_REMOVAL_FAILED = 'MODEL_REMOVAL_FAILED'

export class ModelRemovalError extends HarnessError {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, MODEL_REMOVAL_FAILED, options)
  }
}

export interface RemoveModelBundleOptions {
  /** Canonical `<root>/<physicalKey>` directory. */
  readonly dir: string
  readonly expected: SemanticModelManifest
  readonly signal?: AbortSignal
}

export interface RemoveModelBundleResult {
  readonly removed: boolean
  readonly removedFiles: number
  readonly removedBytes: number
}

function unsafe(reason: string): never {
  throw new ModelRemovalError(`The model removal path is unsafe: ${reason}`)
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isMissingOrNotEmpty(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST'
}

/** Every parent of a pinned path must be a real directory, never a symlink. */
async function parentsAreDirectories(
  dir: string,
  relativePath: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const segments = relativePath.split('/')
  for (let depth = 1; depth < segments.length; depth += 1) {
    signal?.throwIfAborted()
    const path = join(dir, ...segments.slice(0, depth))
    const info = await lstatOrUndefined(path)
    if (info === undefined) return false
    if (info.isSymbolicLink() || !info.isDirectory()) unsafe(`${path} is not a real directory`)
  }
  return true
}

async function removeEntry(
  path: string,
  signal: AbortSignal | undefined,
): Promise<{ removed: boolean; bytes: number }> {
  signal?.throwIfAborted()
  const info = await lstatOrUndefined(path)
  if (info === undefined) return { removed: false, bytes: 0 }
  if (info.isSymbolicLink()) {
    await unlink(path)
    return { removed: true, bytes: 0 }
  }
  if (!info.isFile()) unsafe(`${path} is not a regular file`)
  await unlink(path)
  return { removed: true, bytes: info.size }
}

async function pruneEmptyDirectories(
  dir: string,
  relativeDirectories: readonly string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const relativePath of relativeDirectories) {
    signal?.throwIfAborted()
    const path = join(dir, relativePath)
    const info = await lstatOrUndefined(path)
    if (info === undefined) continue
    if (info.isSymbolicLink() || !info.isDirectory()) unsafe(`${path} is not a real directory`)
    try {
      await rmdir(path)
    } catch (error) {
      if (!isMissingOrNotEmpty(error)) throw error
    }
  }
  try {
    await rmdir(dir)
  } catch (error) {
    if (!isMissingOrNotEmpty(error)) throw error
  }
}

/**
 * Delete the marker and every pinned file, preserving unknown files.
 * @param options - the bundle directory, its catalog record, and an abort signal.
 * @returns what was removed; a missing root or bundle is a successful no-op.
 */
export async function removeModelBundle(
  options: RemoveModelBundleOptions,
): Promise<RemoveModelBundleResult> {
  const signal = options.signal
  signal?.throwIfAborted()
  const absoluteDir = resolve(options.dir)
  const physicalKey = basename(absoluteDir)
  const root = dirname(absoluteDir)
  if (!isAbsolute(options.dir) || physicalKey !== options.expected.physicalKey)
    unsafe('the requested directory is not this model’s physical directory')
  if (!SAFE_SEGMENT.test(physicalKey))
    unsafe('the physical model key is not a single safe directory name')

  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { removed: false, removedFiles: 0, removedBytes: 0 }
    throw error
  }
  signal?.throwIfAborted()
  const rootInfo = await lstatOrUndefined(canonicalRoot)
  if (rootInfo === undefined) return { removed: false, removedFiles: 0, removedBytes: 0 }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    unsafe(`${canonicalRoot} is not a real directory`)

  const canonicalDir = join(canonicalRoot, physicalKey)
  const bundleInfo = await lstatOrUndefined(canonicalDir)
  if (bundleInfo === undefined) return { removed: false, removedFiles: 0, removedBytes: 0 }
  if (bundleInfo.isSymbolicLink() || !bundleInfo.isDirectory())
    unsafe(`${canonicalDir} is not a real directory`)

  const lockFilename = join(canonicalRoot, `${physicalKey}.install`)
  await assertModelLockPath(lockFilename, signal)
  return await withFileLock(
    lockFilename,
    async () => {
      const current = await lstatOrUndefined(canonicalDir)
      if (current === undefined) return { removed: false, removedFiles: 0, removedBytes: 0 }
      if (current.isSymbolicLink() || !current.isDirectory())
        unsafe(`${canonicalDir} is not a real directory`)

      let removedFiles = 0
      let removedBytes = 0
      // The marker goes first so an interrupted removal cannot look ready.
      const marker = await removeEntry(join(canonicalDir, MANIFEST_PATH), signal)
      if (marker.removed) {
        removedFiles += 1
        removedBytes += marker.bytes
      }

      const pinned = Object.keys(options.expected.files).map(safeModelRelativePath)
      for (const relativePath of pinned) {
        signal?.throwIfAborted()
        if (!(await parentsAreDirectories(canonicalDir, relativePath, signal))) continue
        const removed = await removeEntry(join(canonicalDir, relativePath), signal)
        if (removed.removed) {
          removedFiles += 1
          removedBytes += removed.bytes
        }
      }

      const directories = new Set<string>()
      for (const relativePath of pinned) {
        const segments = relativePath.split('/')
        for (let depth = 1; depth < segments.length; depth += 1)
          directories.add(segments.slice(0, depth).join('/'))
      }
      await pruneEmptyDirectories(
        canonicalDir,
        [...directories].sort((left, right) => right.split('/').length - left.split('/').length),
        signal,
      )
      return { removed: removedFiles > 0, removedFiles, removedBytes }
    },
    { waitMs: LOCK_WAIT_MS, ...(signal !== undefined ? { signal } : {}) },
  )
}
