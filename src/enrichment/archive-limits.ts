/**
 * The figure ceilings a parsed artifact carries. They live apart from the
 * unpacker so the persistence contract and the wire can state the same bounds
 * without pulling `fflate` into their module graph.
 * @module dsh-zotero/enrichment/archive-limits
 */

/** Figures kept per artifact. */
export const ARCHIVE_MAX_IMAGES = 512

/** One figure's decompressed size. */
export const ARCHIVE_MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Every figure of one artifact, decompressed. */
export const ARCHIVE_MAX_IMAGE_TOTAL_BYTES = 128 * 1024 * 1024
