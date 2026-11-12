/**
 * The catalog manifest rule that install, readiness, and load all share.
 *
 * Three modules used to carry their own copy of these constants and their own
 * validation loop, and they had already drifted: the installer refused a
 * catalog record with no pinned files, the inspector accepted it, and the
 * error types differed. A record that one path installs and another path calls
 * ready is a bundle nobody can reason about, so the rule lives here and each
 * caller only maps the message onto its own error class.
 *
 * This module imports types only, so Node's native TypeScript stripping can
 * load it from the CLI scripts without pulling in the ONNX runtime.
 * @module dsh-zotero/enrichment/model-manifest
 */

import { isAbsolute } from 'node:path'
import type { SemanticModelManifest } from '../enrichment-model-catalog.js'

export const MANIFEST_PATH = 'manifest.json'
export const MANIFEST_MAX_BYTES = 64 * 1024
export const READ_CHUNK_BYTES = 64 * 1024
export const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/
export const SHA256 = /^[0-9a-f]{64}$/

/** One pinned file of a bundle, as the catalog declares it. */
export interface CatalogFilePin {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

/**
 * One catalog-relative path: no absolute prefix, no empty, `.`, `..` or
 * colon-bearing segment.
 * @param value - the declared path.
 * @param refuse - the caller's error mapping.
 * @returns the path unchanged when it is safe.
 */
export function safeRelativePath(value: string, refuse: (reason: string) => never): string {
  if (value === '' || isAbsolute(value)) refuse(`invalid catalog path ${value}`)
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..' || segment.includes(':')) {
      refuse(`invalid catalog path ${value}`)
    }
  }
  return value
}

/**
 * Validate one catalog record's pinned files.
 *
 * Every check that install, inspect and load must agree on lives here: the
 * schema version, the physical key shape, path safety, the reserved marker
 * name, duplicate paths, the byte and digest shapes, and a record that pins at
 * least one file.
 * @param expected - the catalog record.
 * @param refuse - the caller's error mapping (each caller keeps its own class).
 * @returns the pins by their validated relative path.
 */
export function catalogFilePinsOf(
  expected: SemanticModelManifest,
  refuse: (reason: string) => never,
): Map<string, CatalogFilePin> {
  if (expected.schema !== 2) refuse('the catalog manifest is not version 2')
  if (typeof expected.physicalKey !== 'string' || !SAFE_SEGMENT.test(expected.physicalKey)) {
    refuse('the physical model key is not a single safe directory name')
  }
  const record: unknown = expected.files
  if (typeof record !== 'object' || record === null) {
    refuse('the catalog manifest has no file record')
  }
  const pins = new Map<string, CatalogFilePin>()
  for (const [path, pin] of Object.entries(record as Record<string, unknown>)) {
    const relativePath = safeRelativePath(path, refuse)
    if (relativePath === MANIFEST_PATH || pins.has(relativePath)) {
      refuse(`duplicate or reserved catalog path ${relativePath}`)
    }
    const candidate = pin as { bytes?: unknown; sha256?: unknown } | null
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !Number.isSafeInteger(candidate.bytes) ||
      (candidate.bytes as number) < 0 ||
      typeof candidate.sha256 !== 'string' ||
      !SHA256.test(candidate.sha256)
    ) {
      refuse(`invalid pin for ${relativePath}`)
    }
    pins.set(relativePath, {
      path: relativePath,
      bytes: candidate.bytes as number,
      sha256: candidate.sha256 as string,
    })
  }
  if (pins.size === 0) refuse('the catalog manifest has no pinned files')
  return pins
}
