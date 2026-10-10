/**
 * The canonical retrieval graph the four `zotero_retrieve` specs share: one
 * paper with an abstract, its note and PDF children, the annotations under the
 * PDF, and the full-text payload Zotero serves for it. Each spec keeps its own
 * provider and lifecycle; a spec that needs a different shape overrides a
 * field at its own call site, so the deviation stays visible next to the test
 * that needs it.
 * @module tests/provider/retrieve-graph
 */

import { ITEM_KEY } from '../helpers/server/keys.js'
import { annotationRow, attachment, item, noteRow, paperItem } from '../helpers/server/objects.js'
import { canonicalFulltext } from '../helpers/server/serve.js'

/** The parent's abstract; the ranking specs score it against their queries. */
const ABSTRACT =
  'FlashAttention speeds up transformer training by reordering attention computation.'

/**
 * The paper as the retrieval reads see it: an abstract, three children, and
 * Zotero's own best-attachment link pointing at the PDF.
 */
export const RETRIEVE_PARENT = paperItem({
  meta: { numChildren: 3 },
  data: { abstractNote: ABSTRACT },
})

/**
 * The same paper with Zotero's attachment link absent: the state the `best`
 * policy falls back to a PDF child for.
 */
export const RETRIEVE_PARENT_WITHOUT_ATTACHMENT = item({
  meta: { numChildren: 3 },
  data: { abstractNote: ABSTRACT },
})

/**
 * The PDF as a child row of the parent. `parentItem` is what the `specified`
 * policy's ownership proof reads, and the item read and the annotation walk
 * both agree on this key.
 */
export const RETRIEVE_ATTACHMENT = attachment({ data: { parentItem: ITEM_KEY } })

/** The parent's direct children: a note whose body carries `tiling`, and the PDF. */
export const RETRIEVE_CHILDREN = [
  noteRow({ data: { note: 'read this for the tiling strategy' } }),
  RETRIEVE_ATTACHMENT,
]

/** The annotations under the PDF: one highlight with a reader comment and a page label. */
export const RETRIEVE_ATTACHMENT_CHILDREN = [
  annotationRow({
    data: {
      annotationText: 'see the tiling figure for details',
      annotationComment: 'compare with figure 3',
      annotationPageLabel: '7',
    },
  }),
]

/** The canonical full-text body, the shared layer's `canonicalFulltext()`. */
export const FULLTEXT_PAYLOAD = canonicalFulltext()
