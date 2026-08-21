/**
 * The Zotero child-object graph: a bibliographic item's direct children
 * (notes, attachments) plus the annotations that live one level deeper,
 * under each attachment. Zotero models `itemAnnotations.parentItemID` as a
 * foreign key into `itemAttachments`, so annotation rows never appear among
 * a bibliographic item's own `/children` — they are children of the PDF (or
 * other file attachment) they annotate. Reading annotations therefore takes
 * a two-level walk: `/items/<parentKey>/children`, then
 * `/items/<attachmentKey>/children` per attachment, pooled with bounded
 * concurrency so a many-attachment item cannot storm the loopback server.
 * @module dsh-zotero/item-graph
 */

import { mapWithConcurrency } from './concurrency.js'
import { asRecord, asString } from './json.js'

/** One direct attachment child together with the annotation rows under it. */
export interface ZoteroAttachmentNode {
  /** The raw attachment row as the API served it. */
  readonly row: unknown
  /** The raw annotation rows of this attachment, in served order. */
  readonly annotations: readonly unknown[]
}

/** The loaded child-object graph of one parent item. */
export interface ZoteroItemGraph {
  /**
   * The parent's direct child rows exactly as the API served them — notes,
   * attachments, and (defensively) any legacy direct annotation rows.
   */
  readonly childRows: readonly unknown[]
  /** One node per direct attachment child; `annotations` is empty unless the walk requested them. */
  readonly attachments: readonly ZoteroAttachmentNode[]
  /**
   * Annotation rows gathered across every attachment, flat and unsorted.
   * Callers order them (Zotero's `annotationSortIndex`) after merging.
   */
  readonly attachmentAnnotations: readonly unknown[]
}

export interface LoadItemGraphOptions {
  /** The parent item key whose children the graph starts from. */
  readonly parentKey: string
  /** GET the child rows of one item key (the parent or an attachment). */
  readonly fetchChildren: (key: string) => Promise<readonly unknown[]>
  /** Max attachment-children requests in flight. */
  readonly concurrency: number
  /**
   * Walk the second level for annotations. False keeps the walk single-level
   * — callers that only want notes/attachments skip one request per
   * attachment entirely.
   */
  readonly withAnnotations: boolean
}

function itemTypeOf(row: unknown): string | undefined {
  return asString(asRecord(asRecord(row)?.data)?.itemType)
}

/**
 * Load one item's child-object graph. A direct annotation row (not expected
 * in current Zotero data but harmless to accept) stays in `childRows`; only
 * attachment-nested annotations require the second-level walk.
 */
export async function loadItemGraph(options: LoadItemGraphOptions): Promise<ZoteroItemGraph> {
  const childRows = await options.fetchChildren(options.parentKey)
  const attachmentRows = childRows.filter((row) => itemTypeOf(row) === 'attachment')
  if (!options.withAnnotations || attachmentRows.length === 0) {
    const nodes = attachmentRows.map((row) => ({ row, annotations: [] as readonly unknown[] }))
    return { childRows, attachments: nodes, attachmentAnnotations: [] }
  }
  const attachments = await mapWithConcurrency(
    attachmentRows,
    options.concurrency,
    async (row): Promise<ZoteroAttachmentNode> => {
      const key = asString(asRecord(row)?.key)
      // A keyless attachment row cannot be traversed; it contributes no
      // annotations instead of failing the whole graph.
      if (key === undefined) return { row, annotations: [] }
      return {
        row,
        annotations: (await options.fetchChildren(key)).filter(
          (candidate) => itemTypeOf(candidate) === 'annotation',
        ),
      }
    },
  )
  return {
    childRows,
    attachments,
    attachmentAnnotations: attachments.flatMap((node) => node.annotations),
  }
}
