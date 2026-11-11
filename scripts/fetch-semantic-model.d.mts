/**
 * Types for `scripts/fetch-semantic-model.mjs`, the build-time model fetcher.
 * Only the command-line contract is exposed; downloading is not unit-tested.
 * @module dsh-zotero/scripts/fetch-semantic-model
 */

/** One interchangeable download source. */
export interface SemanticFetchSource {
  readonly label: string
  readonly url: (model: { readonly modelId: string }, path: string) => string
}

export declare const SOURCES: Readonly<Record<string, SemanticFetchSource>>

/** The validated command line. */
export interface SemanticFetchOptions {
  readonly keys: readonly string[]
  readonly order: readonly string[]
  readonly dir: string
  readonly proxy: string | undefined
  readonly noProxy: boolean
  readonly timeoutMs: number
  readonly verifyOnly: boolean
  readonly dryRun: boolean
  readonly list: boolean
}

export declare function optionsOf(argv: readonly string[]): SemanticFetchOptions
