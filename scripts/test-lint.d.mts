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

/** One helper whose size exceeds its limit or frozen baseline. */
export interface HelperSizeViolation {
  /** `grown` for a baselined file, `new` for an unbudgeted one, `stale` for a vanished baseline path. */
  readonly kind: 'grown' | 'new' | 'stale'
  /** Repo-root-relative helper path. */
  readonly path: string
  /** Actual line count (0 for a stale baseline entry). */
  readonly lines: number
  /** The applicable limit: the frozen baseline for `grown`, the new-helper limit otherwise. */
  readonly limit: number
}

/**
 * Compare helper sizes against the new-helper limit and the frozen baseline.
 * @param entries - `{ path, lines }` for every helper.
 * @param baseline - frozen path → line count; defaults to the repository baseline.
 * @param limit - the new-helper limit; defaults to 300.
 * @returns violations; empty when every helper is within its budget.
 */
export declare function helperSizeViolations(
  entries: readonly { readonly path: string; readonly lines: number }[],
  baseline?: Readonly<Record<string, number>>,
  limit?: number,
): HelperSizeViolation[]
