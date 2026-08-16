/**
 * The session corpus: the session's Zotero tool calls aggregated into one
 * record per library item, so the web views can organize by the user's
 * literature instead of by the agent's actions. The listed items are the
 * session's targets — worked-on items (read, cited, attachment resolved;
 * notes excluded) when any exist, otherwise the final logical search's hit
 * set. A specific-paper session lists the one paper; a topic session lists
 * the found set; an agent's incidental note inspection never shrinks the
 * list. Item identity is the normalized ref (query stripped, lowercased).
 * Attribution is best-effort and total: a call whose arguments cannot be
 * parsed counts as unattributed and never crashes the build; the per-call
 * activity lens keeps rendering every block regardless. Pure over the
 * frozen blocks — the same slice builds the same corpus.
 * @module dsh-zotero/client/corpus
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SEARCH_DEFAULT_DIRECTION,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_DEFAULT_MODE,
  SEARCH_DEFAULT_SORT,
} from '../constants.ts'
import {
  argsOf,
  callNameOf,
  evidenceItemsOf,
  isRecord,
  metaOf,
  numberField,
  orderKeyOf,
  previewsOf,
  resultTextOf,
  searchCountsOf,
  searchRowsOf,
  stringField,
  type ChildPreviewView,
  type EvidenceItemView,
} from './presenters.ts'

/** The item identity: the ref without its query, lowercased. */
export function normalizeRefKey(ref: string): string {
  return ref.split('?', 1)[0]!.toLowerCase()
}

/** The lens ids the tab switches between. */
export type ZoteroLensId = 'items' | 'citations' | 'activity'

/** Which tool families touched one item. */
export interface CorpusUsage {
  readonly searched: boolean
  readonly read: boolean
  /** Used as a citation source: evidence gathered (retrieve) or cited (export). */
  readonly cited: boolean
}

/** One resolved attachment location (from the attachment projection). */
export interface CorpusAttachment {
  readonly kind: 'file' | 'url'
  readonly contentType: string
  readonly title: string
  /** The copyable path (file) or URL (url). */
  readonly location: string
}

/** One export artifact: the joined output text of an export call. */
export interface CorpusExport {
  readonly callId: string
  readonly format: string
  readonly style?: string
  readonly text: string
}

/** One library item with everything the session knows about it. */
export interface CorpusItem {
  /** Normalized identity (the map key). */
  readonly key: string
  /** First-seen full ref, the display and copy form. */
  readonly ref: string
  readonly title?: string
  readonly creators?: string
  readonly year?: number
  readonly venue?: string
  readonly itemType?: string
  readonly usage: CorpusUsage
  /** Ordering: transcript position of the first touch. */
  readonly firstSeq: number
  /** Every call that touched this item, in transcript order. */
  readonly calls: readonly ToolCallBlock[]
  /** Evidence passages gathered from retrieve calls on this item. */
  readonly evidence: readonly EvidenceItemView[]
  readonly notesPreview: readonly ChildPreviewView[]
  readonly annotationsPreview: readonly ChildPreviewView[]
  readonly attachment?: CorpusAttachment
  /** Export artifacts whose ref list included this item. */
  readonly exports: readonly CorpusExport[]
}

/** Activity counts across the session's stages (the funnel strip). */
export interface CorpusFunnel {
  readonly searched: number
  readonly read: number
  readonly cited: number
}

/** The aggregated session. */
export interface Corpus {
  /**
   * The session's targets — worked-on items when any exist, otherwise the
   * final logical search's hit set. Note items never count as targets.
   */
  readonly items: readonly CorpusItem[]
  /**
   * The session's literature: the found set plus worked-on items outside it.
   * The stable base for the citations quick access — citing one item never
   * shrinks the rest of the session's papers.
   */
  readonly literature: readonly CorpusItem[]
  /** Every export artifact, attributed or not. */
  readonly exports: readonly CorpusExport[]
  /** Stage counts over the listed items; null while the list is empty. */
  readonly funnel: CorpusFunnel | null
  /** Distinct rows of the final logical search (the found set). */
  readonly searched: number
  /** Rows of the final logical search the bounded projection did not itemize. */
  readonly searchOmitted: number
  /** Calls whose arguments carried no usable item ref. */
  readonly unattributed: number
}

/** The mutable accumulator; structurally the frozen CorpusItem view. */
interface Draft {
  key: string
  ref: string
  title?: string
  creators?: string
  year?: number
  venue?: string
  itemType?: string
  usage: { searched: boolean; read: boolean; cited: boolean }
  firstSeq: number
  calls: ToolCallBlock[]
  evidence: EvidenceItemView[]
  notesPreview: ChildPreviewView[]
  annotationsPreview: ChildPreviewView[]
  attachment?: CorpusAttachment
  exports: CorpusExport[]
}

/**
 * Whether the session actually worked on the item (read, cited,
 * or resolved its attachment). Note items never count — an agent's
 * incidental note inspection during a topic search must not shrink the
 * list to notes. Worked-on items become the list when any exist; otherwise
 * the final search's hit set stands in as the found set.
 */
export function isWorkedOn(item: Pick<CorpusItem, 'usage' | 'attachment' | 'itemType'>): boolean {
  if (item.itemType === 'note') return false
  return item.usage.read || item.usage.cited || item.attachment !== undefined
}

/**
 * The identity of one logical search: pagination continuations share every
 * field except `offset`, so consecutive calls with the same identity fold
 * into one group (the session's "final found set" is the last group's rows).
 * Arguments absent from a call fall back to the tool defaults (shared with
 * the search tool, so a changed default cannot silently split groups).
 */
function searchIdentityOf(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null
  const record = args as Record<string, unknown>
  const sorted = (value: unknown): string =>
    // JSON encoding keeps element boundaries explicit: the plain join below
    // would collapse `['a|b']` and `['a', 'b']` onto one identity.
    Array.isArray(value) ? JSON.stringify([...value].sort()) : ''
  return JSON.stringify({
    query: typeof record['query'] === 'string' ? record['query'] : '',
    mode: typeof record['mode'] === 'string' ? record['mode'] : SEARCH_DEFAULT_MODE,
    // Scope objects stringify by key order; canonicalize so two semantically
    // identical scopes fold into one group whatever order the model emitted.
    scope: record['scope'] === undefined ? 'library' : scopeKeyOf(record['scope']),
    itemTypes: sorted(record['itemTypes']),
    tags: sorted(record['tags']),
    sort: typeof record['sort'] === 'string' ? record['sort'] : SEARCH_DEFAULT_SORT,
    direction:
      typeof record['direction'] === 'string' ? record['direction'] : SEARCH_DEFAULT_DIRECTION,
    limit: typeof record['limit'] === 'number' ? record['limit'] : SEARCH_DEFAULT_LIMIT,
  })
}

/** Canonical string form of a scope object: sorted keys, stable across key order. */
function scopeKeyOf(scope: unknown): string {
  if (!isRecord(scope)) return JSON.stringify(scope)
  const parts = Object.keys(scope)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(scope[key])}`)
  return `{${parts.join(',')}}`
}

/** The accumulator for the final logical search's hit set. */
interface SearchGroup {
  readonly identity: string | null
  readonly keys: Set<string>
  omitted: number
}

/**
 * Build the corpus from the session's zotero call blocks.
 * @param blocks - ordered zotero tool call blocks (settled and running).
 * @returns the aggregated corpus.
 */
export function buildCorpus(blocks: readonly ToolCallBlock[]): Corpus {
  const byKey = new Map<string, Draft>()
  const exports: CorpusExport[] = []
  let lastGroup: SearchGroup | null = null
  let unattributed = 0

  const itemOf = (ref: string, seq: number): Draft => {
    const key = normalizeRefKey(ref)
    let draft = byKey.get(key)
    if (draft === undefined) {
      const usage = { searched: false, read: false, cited: false }
      draft = {
        key,
        ref,
        usage,
        firstSeq: seq,
        calls: [],
        evidence: [],
        notesPreview: [],
        annotationsPreview: [],
        exports: [],
      }
      byKey.set(key, draft)
    } else {
      // The first touch is the earliest transcript position, whatever the
      // input order (the caller normally passes pre-sorted blocks).
      draft.firstSeq = Math.min(draft.firstSeq, seq)
    }
    return draft
  }

  /**
   * Attribute one ref-carrying call to its item. Calls whose arguments carry
   * no usable ref count as unattributed and never crash the build.
   * @returns the item's draft, or null when the call was unattributed.
   */
  const attributedOf = (
    block: ToolCallBlock,
    args: Record<string, unknown> | null,
    seq: number,
  ): Draft | null => {
    const ref = args === null ? undefined : stringField(args, 'ref')
    if (ref === undefined || ref === '') {
      unattributed += 1
      return null
    }
    const draft = itemOf(ref, seq)
    draft.calls.push(block)
    return draft
  }

  for (const block of blocks) {
    const seq = orderKeyOf(block)
    const args = argsOf(block)
    const meta = metaOf(block)
    switch (callNameOf(block)) {
      case 'zotero_search': {
        if (meta === null) break
        // Pagination continuations share one group; a different query, mode,
        // scope, or filter starts a fresh one. Only the last group's rows
        // survive as the found set when nothing was worked on.
        const identity = searchIdentityOf(args)
        if (lastGroup === null || identity === null || identity !== lastGroup.identity) {
          lastGroup = { identity, keys: new Set(), omitted: 0 }
        }
        const rows = searchRowsOf(meta)
        if (rows !== null) {
          for (const row of rows) {
            lastGroup.keys.add(normalizeRefKey(row.ref))
            const draft = itemOf(row.ref, seq)
            draft.usage.searched = true
            draft.calls.push(block)
            draft.title ??= row.title
            draft.creators ??= row.creatorSummary
            draft.year ??= row.year
            draft.itemType ??= row.itemType
          }
        }
        const counts = searchCountsOf(meta)
        if (counts !== null) lastGroup.omitted += counts.omitted
        break
      }
      case 'zotero_get': {
        const draft = attributedOf(block, args, seq)
        if (draft === null) break
        draft.usage.read = true
        if (meta === null) break
        // The get projection is richer than a search row: it wins outright.
        const title = stringField(meta, 'title')
        const creators = stringField(meta, 'creators')
        const venue = stringField(meta, 'venue')
        const year = numberField(meta, 'year')
        const itemType = stringField(meta, 'itemType')
        if (title !== undefined) draft.title = title
        if (creators !== undefined) draft.creators = creators
        if (venue !== undefined) draft.venue = venue
        if (year !== undefined) draft.year = year
        // The projection carries the item type, so a note reached directly
        // by get still honors the "notes excluded" target rule.
        if (itemType !== undefined) draft.itemType = itemType
        const notes = previewsOf(meta, 'notesPreview')
        if (notes !== null && notes.length > 0) draft.notesPreview = notes
        const annotations = previewsOf(meta, 'annotationsPreview')
        if (annotations !== null && annotations.length > 0) draft.annotationsPreview = annotations
        break
      }
      case 'zotero_retrieve': {
        const draft = attributedOf(block, args, seq)
        if (draft === null) break
        draft.usage.cited = true
        const items = meta === null ? null : evidenceItemsOf(meta)
        if (items !== null) draft.evidence.push(...items)
        break
      }
      case 'zotero_attachment': {
        const draft = attributedOf(block, args, seq)
        if (draft === null) break
        if (meta === null) break
        const kind = stringField(meta, 'kind') === 'url' ? 'url' : 'file'
        const contentType = stringField(meta, 'contentType')
        if (contentType === undefined) break
        const title = stringField(meta, 'title') ?? ''
        const location =
          kind === 'file' ? (stringField(meta, 'path') ?? '') : (stringField(meta, 'url') ?? '')
        draft.attachment = { kind, contentType, title, location }
        break
      }
      case 'zotero_export': {
        const refs = args?.['refs']
        // Zotero's raw export text can lead with stray whitespace; the
        // curated artifact starts clean (display and copy alike).
        const text = (resultTextOf(block) ?? '').trimStart()
        // An export without result text (still running) yields no artifact,
        // but its refs still mark the items as cited.
        let artifact: CorpusExport | undefined
        if (text !== '') {
          const format = stringField(meta ?? {}, 'format') ?? ''
          const style = meta === null ? undefined : stringField(meta, 'style')
          artifact = {
            callId: block.callId,
            format,
            ...(style === undefined ? {} : { style }),
            text,
          }
          exports.push(artifact)
        }
        if (!Array.isArray(refs)) break
        for (const ref of refs) {
          if (typeof ref !== 'string' || ref === '') continue
          const draft = itemOf(ref, seq)
          draft.usage.cited = true
          draft.calls.push(block)
          if (artifact !== undefined) draft.exports.push(artifact)
        }
        break
      }
      default:
        break
    }
  }

  const allItems = [...byKey.values()].sort((a, b) => a.firstSeq - b.firstSeq)
  // The list is the session's targets — worked-on items (notes excluded)
  // when any exist, otherwise the final logical search's hit set. Search
  // hits never appear alongside targets: a specific-paper session shows the
  // one paper, a topic session the final found set.
  const hasTargets = allItems.some(isWorkedOn)
  const items = hasTargets
    ? allItems.filter(isWorkedOn)
    : allItems.filter((item) => lastGroup?.keys.has(item.key) ?? false)
  // The session's literature is the stable union — the found set plus
  // worked-on items outside it — so citing one paper never hides the rest.
  const literature = allItems.filter(
    (item) => (lastGroup?.keys.has(item.key) ?? false) || isWorkedOn(item),
  )
  const searched = lastGroup?.keys.size ?? 0
  const searchOmitted = lastGroup?.omitted ?? 0
  // The funnel counts the listed items per stage, so every chip stays a
  // subset of the visible rows; the tab renders only the non-zero chips.
  const funnel = { searched: 0, read: 0, cited: 0 }
  for (const item of items) {
    if (item.usage.searched) funnel.searched += 1
    if (item.usage.read) funnel.read += 1
    if (item.usage.cited) funnel.cited += 1
  }
  return {
    items,
    literature,
    exports,
    funnel: items.length > 0 ? funnel : null,
    searched,
    searchOmitted,
    unattributed,
  }
}

/** Extract the citation keys of a BibTeX/BibLaTeX export body, first-seen order. */
export function bibTexKeysOf(text: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/@[A-Za-z]+\{([^,\s{}]+),/g)) {
    const key = match[1]!
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

/** The LaTeX cite command for extracted keys; empty for none. */
export function citeCommandOf(keys: readonly string[]): string {
  return keys.length === 0 ? '' : `\\cite{${keys.join(', ')}}`
}
