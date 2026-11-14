/**
 * Pure row derivations for the parsed-document manager: the id a row falls
 * back to, its compact source descriptor, its byte total and the last page a
 * listing can show. They live outside the component so each is testable
 * without rendering.
 * @module dsh-zotero/client/enrichment/parsed-manager-model
 */

import type { ZoteroParsedDocumentRowView } from '../../contract.ts'

/** The artifact id prefix a row shows when no paper title was captured. */
export function shortArtifactId(artifactId: string): string {
  return artifactId.slice(0, 8)
}

/**
 * Where one row came from, compact enough for a sidebar line: an attachment's
 * key (the ref's last segment with its query dropped) or the origin-only URL
 * the host already sends. A broken row has neither and yields an empty string.
 */
export function sourceDescriptorOf(row: ZoteroParsedDocumentRowView): string {
  if (row.sourceKind === 'url') return row.targetLabel
  const path = row.targetLabel.split('?')[0] ?? ''
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The artifact's own size: the Markdown plus every retained figure. */
export function totalBytesOf(row: ZoteroParsedDocumentRowView): number {
  return row.images.reduce((sum, image) => sum + image.bytes, row.markdownBytes)
}

/** The last page index a listing can show; an empty listing has one page. */
export function maxPageOf(total: number, pageSize: number): number {
  return Math.max(0, Math.ceil(Math.max(0, total) / pageSize) - 1)
}
