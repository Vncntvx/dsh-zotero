/**
 * Bibliography-file predicates shared by the deliverable action, the document
 * preview actions, and the file context menu. The deliverable arm can use the
 * model's description to recognize a CSL JSON export; the path-only arm stays
 * on unambiguous extensions so an arbitrary `references.json` is not claimed.
 * @module dsh-zotero/client/bibliography
 */

/** The delivered-file facts the predicate reads. */
export interface DeliverableFileMeta {
  readonly path: string
  readonly description?: string
}

const STRICT_BIBLIOGRAPHY_EXTENSIONS = /\.(bib|ris|csljson|csl\.json|biblatex|bibtex)$/i
const BIBLIOGRAPHY_DESCRIPTION_PATTERN = /exported (?:csl\s*json|citation|references|bib(?:tex)?)/i
const BIBLIOGRAPHY_FILENAME_PATTERN = /(?:csl|zotero|citations?|references?|bibliography)/i

/**
 * Determine whether a delivered file represents a bibliography export.
 * Strict extensions pass unconditionally; generic .json files must carry a
 * bibliography description or naming token.
 * @param file - the delivered file metadata.
 * @returns true for a bibliography deliverable.
 */
export function isBibliographyDeliverable(file: DeliverableFileMeta | undefined): boolean {
  if (!file?.path) return false
  if (STRICT_BIBLIOGRAPHY_EXTENSIONS.test(file.path)) return true
  if (/\.json$/i.test(file.path)) {
    if (file.description && BIBLIOGRAPHY_DESCRIPTION_PATTERN.test(file.description)) return true
    if (BIBLIOGRAPHY_FILENAME_PATTERN.test(file.path)) return true
  }
  return false
}

/**
 * Whether a workspace path names a bibliography file by its extension alone.
 * Used where no model description exists (context menus and document preview);
 * generic .json files are deliberately not claimed.
 * @param path - the workspace path.
 * @returns true for a strict bibliography extension.
 */
export function isBibliographyPath(path: string | undefined): boolean {
  return path !== undefined && STRICT_BIBLIOGRAPHY_EXTENSIONS.test(path)
}
