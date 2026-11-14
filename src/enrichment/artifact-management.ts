/**
 * Host-side inventory and cleanup for committed parsed artifacts.
 *
 * A parse publishes its artifact directory (`meta.json` is the commit marker)
 * and its source-index pointer in two separate writes. A crash between them
 * leaves either an orphan directory or a dangling index key, so the inventory
 * unions both views by artifact id instead of trusting either one alone. No
 * per-target `inspect` probe is used: those are session-bound, target-only and
 * may issue a network HEAD.
 * @module dsh-zotero/enrichment/artifact-management
 */

import {
  ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED,
  ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
  ZoteroError,
} from '../errors.js'
import {
  ZOTERO_ARTIFACT_ID_PATTERN,
  type ZoteroDiscardParsedDocumentResultView,
  type ZoteroListParsedDocumentsRequestView,
  type ZoteroListParsedDocumentsResultView,
  type ZoteroParsedDocumentRowView,
} from '../contract.js'
import type { ArtifactGroup, InventoryEntry, ParsedArtifactStore } from './artifact-store.js'
import type { ParseJobPersistence, EnrichmentParseJobs } from './parse-jobs.js'
import type { EnrichmentPreferences } from '../enrichment-preferences.js'
import { refFieldsOf } from '../ref-grammar.js'
import { safeParseText } from './parse-target.js'

/** The wire views are the single row contract; the zod schema is satisfies-checked. */
export type ParsedDocumentRow = ZoteroParsedDocumentRowView
export type ParsedDocumentList = ZoteroListParsedDocumentsResultView
export type DiscardResult = ZoteroDiscardParsedDocumentResultView

export interface ArtifactManagementDeps {
  readonly store: (config: EnrichmentPreferences, create: boolean) => Promise<ParsedArtifactStore>
  readonly config: () => EnrichmentPreferences
  readonly persistence: ParseJobPersistence
  readonly jobs: EnrichmentParseJobs
}

const ARTIFACT_ID = ZOTERO_ARTIFACT_ID_PATTERN
/** A broken-row detail is a sanitized fs message; the raw text never leaves the host. */
const BROKEN_DETAIL_LIMIT = 512

/** A list window without its session id: authorization belongs to the service seam. */
export type ParsedDocumentQuery = Pick<
  ZoteroListParsedDocumentsRequestView,
  'offset' | 'limit' | 'state' | 'query'
>

/**
 * List every artifact, newest first, narrowed by the requested state and text
 * and then windowed by the page. Filtering runs before the slice, so `total`
 * always counts the rows the filter admits and the pager stays honest.
 */
export async function listParsedDocuments(
  deps: ArtifactManagementDeps,
  request: ParsedDocumentQuery,
  signal?: AbortSignal,
): Promise<ParsedDocumentList> {
  const config = deps.config()
  const store = await deps.store(config, false)
  signal?.throwIfAborted()
  const [entries, groups] = [await store.inventory(signal), await store.groupByArtifact()]
  const needle = request.query?.trim().toLowerCase() || undefined
  const rows: ParsedDocumentRow[] = []
  for (const entry of entries) {
    signal?.throwIfAborted()
    const row = rowOf(entry, groups.get(entry.cacheKey))
    if (request.state !== undefined && row.state !== request.state) continue
    if (needle !== undefined && !matchesQuery(row, needle)) continue
    rows.push(row)
  }
  rows.sort((a, b) => b.committedAt - a.committedAt || a.artifactId.localeCompare(b.artifactId))
  return { rows: rows.slice(request.offset, request.offset + request.limit), total: rows.length }
}

/**
 * The row title, its safe source label and its artifact id are the only three
 * needles a reader types; aliases are cache keys and never match.
 */
function matchesQuery(row: ParsedDocumentRow, needle: string): boolean {
  return [row.title, row.targetLabel, row.artifactId].some(
    (value) => value !== undefined && value.toLowerCase().includes(needle),
  )
}

function rowOf(entry: InventoryEntry, group?: ArtifactGroup): ParsedDocumentRow {
  const record = group?.record
  const aliases = group?.aliases ?? []
  if (entry.stored === undefined) {
    return {
      artifactId: entry.cacheKey,
      state: 'broken',
      sourceKind: 'attachment',
      targetLabel: '',
      mode: 'free',
      generation: record?.generation ?? '',
      fingerprint: record?.fingerprint ?? '',
      characterCount: 0,
      images: [],
      markdownBytes: 0,
      committedAt: 0,
      aliases,
      broken:
        entry.failureMessage !== undefined
          ? {
              code: 'unreadable-meta',
              detail: safeParseText(entry.failureMessage, BROKEN_DETAIL_LIMIT),
            }
          : { code: 'missing-meta' },
      actionable: false,
    }
  }
  const { meta, committedAt } = entry.stored
  const sourceKind: ParsedDocumentRow['sourceKind'] = meta.identity.startsWith('zotero://')
    ? 'attachment'
    : 'url'
  // Mirror what the target expansion can actually resolve: an attachment
  // artifact with a corrupted identity is not rebuildable.
  const recoverable =
    sourceKind === 'attachment'
      ? refFieldsOf(meta.identity)?.kind === 'attachment'
      : meta.sourceUrl !== undefined || record?.stamp.kind === 'url'
  return {
    artifactId: entry.cacheKey,
    state: record === undefined ? 'orphan' : 'indexed',
    sourceKind,
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    targetLabel: meta.identity,
    mode: meta.mode,
    generation: meta.generation,
    fingerprint: meta.contentFingerprint,
    characterCount: meta.characterCount,
    ...(meta.pageCount !== undefined ? { pageCount: meta.pageCount } : {}),
    images: (meta.images ?? []).map((image) => ({ ...image })),
    markdownBytes: meta.markdownBytes,
    committedAt,
    aliases,
    actionable: recoverable,
  }
}

/**
 * Remove one artifact completely: readers, job receipts, directory, task and
 * every source-index alias. A broken row is still cleanable.
 */
export async function discardParsedDocument(
  deps: ArtifactManagementDeps,
  artifactId: string,
  signal?: AbortSignal,
): Promise<DiscardResult> {
  if (!ARTIFACT_ID.test(artifactId)) {
    throw new ZoteroError('Invalid parsed artifact id.', ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND)
  }
  const config = deps.config()
  const store = await deps.store(config, false)
  signal?.throwIfAborted()
  const aliases = (await store.groupByArtifact()).get(artifactId)?.aliases ?? []
  const stored = await store.metaFor(artifactId).catch(() => undefined)
  const present =
    stored !== undefined || aliases.length > 0 || (await store.hasArtifactDirectory(artifactId))
  if (!present) return { kind: 'missing' }
  const generation = stored?.meta.generation
  deps.jobs.retireArtifact(artifactId)
  if (generation !== undefined) deps.jobs.forgetGeneration(generation)
  let removedReceipts = 0
  try {
    removedReceipts =
      generation === undefined ? 0 : await deps.persistence.deleteByGeneration(config, generation)
    signal?.throwIfAborted()
    const removedAliases = await store.discardArtifact(artifactId, signal)
    return { kind: 'discarded', removedAliases, removedReceipts }
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    throw new ZoteroError(
      `Could not remove the parsed artifact: ${safeParseText(
        error instanceof Error ? error.message : String(error),
        BROKEN_DETAIL_LIMIT,
      )}`,
      ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED,
      { cause: error },
    )
  }
}
