/**
 * Shared domain types and limits for the MinerU document-parsing component.
 * Pure data only — no host imports, so unit tests and the store can share it.
 * @module dsh-zotero/parsing/types
 */

import type { ParsingMode } from '../parsing-preferences.js'

/**
 * The one input limit this component enforces locally. The page ceilings
 * (free 20, precise 600) are enforced by MinerU itself: a page count cannot be
 * known before the document is uploaded, and an artifact returned for an
 * over-limit request is already the service's answer.
 */
export interface ParsingLimits {
  readonly maxBytes: number
}

/** Free Agent lightweight API: 10 MiB input; MinerU caps it at 20 pages. */
export const FREE_LIMITS: ParsingLimits = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
})

/** Precise API: 200 MB input; MinerU caps it at 600 pages. */
export const PRO_LIMITS: ParsingLimits = Object.freeze({
  maxBytes: 200 * 1024 * 1024,
})

export function limitsFor(mode: ParsingMode): ParsingLimits {
  return mode === 'pro' ? PRO_LIMITS : FREE_LIMITS
}

/** Provenance stored alongside one parsed artifact in `meta.json`. */
export interface ParsedArtifactMeta {
  /** Provenance identity: a local ref, or a URL with query and fragment removed. */
  readonly identity: string
  readonly mode: ParsingMode
  /** SHA-256 of the exact bytes that were sent, so edits invalidate the cache. */
  readonly contentFingerprint: string
  readonly taskId: string
  /** Files written into the artifact directory. */
  readonly files: readonly string[]
  /** Present only when the precise API reported the total page count. */
  readonly pageCount?: number
}

/** One parsed document, ready to be returned as full text. */
export interface ParsedArtifact {
  /** `full.md` content — the high-quality Markdown the model reads. */
  readonly markdown: string
  /** `*_content_list.json` content, present for the precise API. */
  readonly contentList?: string
  readonly meta: ParsedArtifactMeta
}
