/** Directories the control-byte guard scans for text contract. */
export declare const TEXT_ROOTS: readonly string[]

/** File extensions the control-byte guard scans. */
export declare const TEXT_EXTENSIONS: readonly string[]

/** File extensions declared binary under the text roots, so never scanned. */
export declare const BINARY_EXTENSIONS: readonly string[]

/** One focused or disabled test construct found in a spec. */
export interface FocusViolation {
  /** 1-based line the construct occurs on. */
  readonly line: number
  /** The chain spelling as written, e.g. `it.concurrent.only`. */
  readonly construct: string
}

/**
 * Blank comments and string/template bodies while preserving every offset, so
 * matches in the result map to real line numbers.
 * @param source - the file content.
 * @returns same-length text with comments and string bodies blanked.
 */
export declare function stripCommentsAndStrings(source: string): string

/**
 * Find focused or disabled test constructs — including the chained
 * `it.only.each` / `it.concurrent.only` forms and the unconditional-disable
 * spellings `skipIf(true)` and `runIf(false)`.
 * @param source - the file content.
 * @returns violations ordered by line.
 */
export declare function focusViolationsOf(source: string): FocusViolation[]

/**
 * Extensions present in the given paths that are neither declared text nor
 * declared binary, and are therefore scanned by no guard.
 * @param paths - file paths to inventory.
 * @returns sorted extension names (with the leading dot).
 */
export declare function unscannedExtensionsOf(paths: readonly string[]): string[]
