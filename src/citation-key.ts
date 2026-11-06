/** Structured citation-key facts shared by search, detail, and export views. */

export type CitationKeySource = 'native' | 'extra'

export interface CitationKeyConflict {
  readonly native: string
  readonly extra: string
}

export interface CitationKeyInfo {
  readonly citationKey?: string
  readonly citationKeySource?: CitationKeySource
  readonly citationKeyConflict?: CitationKeyConflict
}

/** Parse the citekey convention used by Better BibTeX and legacy exports. */
export function citekeyOf(extra?: string): string | undefined {
  if (typeof extra !== 'string' || extra === '') return undefined
  const value = /(?<![A-Za-z0-9_])(?:Citation Key|citekey):\s*([^\r\n\s,]+)/i.exec(extra)?.[1]
  return value !== undefined && value !== '' ? value : undefined
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Resolve Zotero's native field first, while retaining an explicit conflict. */
export function citationKeyInfoOf(data: Record<string, unknown> | undefined): CitationKeyInfo {
  const native = clean(data?.citationKey)
  const extra = citekeyOf(clean(data?.extra))
  if (native !== undefined) {
    return {
      citationKey: native,
      citationKeySource: 'native',
      ...(extra !== undefined && extra !== native
        ? { citationKeyConflict: { native, extra } }
        : {}),
    }
  }
  return extra === undefined ? {} : { citationKey: extra, citationKeySource: 'extra' }
}

/** Format a citation-key conflict as `native=<native>; extra=<extra>`. */
export function formatCitationKeyConflict(conflict: CitationKeyConflict): string {
  return `native=${conflict.native}; extra=${conflict.extra}`
}
