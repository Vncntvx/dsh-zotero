/**
 * Types for `scripts/style-tokens.mjs`, driven by `tests/unit/style-tokens`.
 * @module dsh-zotero/scripts/style-tokens
 */

/** The committed snapshot of the palette the client stylesheets consume. */
export interface StyleTokenSnapshot {
  /** The pinned harness version the palette was read from. */
  readonly harness: string
  /** `--dsw-*` names the theme sheets define. Generated. */
  readonly dsw: readonly string[]
  /** `--dsh-*` seams this plugin consumes. Hand-maintained. */
  readonly dsh: readonly string[]
}

/** What the snapshot is written from. */
export interface StyleTokenFacts {
  /** The pinned harness version. */
  readonly harness: string
  /** The freshly read palette. */
  readonly dsw: readonly string[]
}

/** Names the snapshot and upstream disagree on. */
export interface StyleTokenDiff {
  /** Published upstream but absent from the snapshot. */
  readonly missing: readonly string[]
  /** Carried by the snapshot but gone upstream. */
  readonly removed: readonly string[]
}

/**
 * The harness version the snapshot describes.
 * @param pkg - parsed `package.json`.
 * @returns the pinned version, or `''` when the line is absent.
 */
export declare function pinnedHarness(pkg: unknown): string

/**
 * Every `--dsw-*` custom property a stylesheet defines.
 * @param css - stylesheet source.
 * @returns the token names, `--` prefix included.
 */
export declare function collectThemeTokens(css: string): string[]

/**
 * The sorted, de-duplicated token list across a directory of stylesheets.
 * @param read - one sheet's source by file name.
 * @param files - sheet file names.
 * @returns every token the theme defines.
 */
export declare function mergeThemeTokens(
  read: (file: string) => string,
  files: readonly string[],
): string[]

/**
 * Compare the snapshot with upstream.
 * @param snapshotTokens - the committed list.
 * @param upstreamTokens - the list read from the theme sheets.
 * @returns missing and extra names, both empty when they agree.
 */
export declare function diffTokens(
  snapshotTokens: readonly string[],
  upstreamTokens: readonly string[],
): StyleTokenDiff

/**
 * The snapshot to write: the freshly read palette, the pin it was read under,
 * and the hand-maintained seam list carried over from the current file.
 * @param current - the committed snapshot, absent on first write.
 * @param facts - the pin and the freshly read palette.
 * @returns the snapshot object, keys in a stable order.
 */
export declare function snapshotOf(
  current: StyleTokenSnapshot | undefined,
  facts: StyleTokenFacts,
): StyleTokenSnapshot
