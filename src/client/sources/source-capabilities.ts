/**
 * The PDF capability of one source: which attachment answers the open-PDF
 * action, and whether the openable target is Zotero's own reader or the web
 * location of a linked URL PDF.
 *
 * The implementation lives under `src/sources/` so the host's filter-count
 * aggregates judge a source with exactly the predicate the browser renders
 * by; this module is the stable client-side path for its consumers.
 * @module dsh-zotero/client/sources/source-capabilities
 */

export {
  clearRefIdentityCacheForTesting,
  hasPdf,
  parseRefIdentity,
  pdfCapabilityOf,
  type ParsedRefIdentity,
  type PdfCapability,
} from '../../sources/source-capabilities.js'
