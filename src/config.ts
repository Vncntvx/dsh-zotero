/**
 * Plugin configuration. Every deployment-varying choice is a validated
 * `Config` field; the schema fills defaults and `resolveConfig` enforces the
 * constraints Schemastery cannot express (loopback-only `baseUrl`, positive
 * finite limits) at load time, failing loud on misconfiguration.
 *
 * Fields are `volatile`: the settings page edits the live entry without
 * remounting. `Config` is what the loader hands the constructor (references);
 * `Options` is what humans write (plain values); `resolveConfig` accepts
 * either, unwraps, and validates.
 * @module dsh-zotero/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import Schema from '@deepseek-ai/schemastery'
import { LOCAL_PROVIDER_ID } from './constants.js'

export interface Config {
  /** Zotero Local API base URL. Must be plain loopback HTTP. */
  baseUrl?: Volatile<string>
  /** Provider id to select; the V1 provider registers as `local`. */
  provider?: Volatile<string>
  /** Per-request provider deadline in milliseconds. */
  timeoutMs?: Volatile<number>
  /** Upper bound for `zotero_search` `limit`. */
  maxSearchResults?: Volatile<number>
  /** Upper bound for note records `zotero_search` scans for body matches. */
  maxNoteScanRecords?: Volatile<number>
  /** Total character budget for retrieved evidence passages. */
  maxEvidenceChars?: Volatile<number>
  /** Upper bound for the number of evidence passages. */
  maxEvidencePassages?: Volatile<number>
  /** Character budget for the `zotero_get` abstract preview. */
  maxDetailChars?: Volatile<number>
  /** Character budget for a note item's own body returned by `zotero_get`. */
  maxNoteBodyChars?: Volatile<number>
  /** Per-note character budget for `zotero_get` note previews. */
  maxNoteChars?: Volatile<number>
  /** Upper bound for note records returned by `zotero_get`. */
  maxNoteRecords?: Volatile<number>
  /** Upper bound for annotation records returned by `zotero_get`. */
  maxAnnotationRecords?: Volatile<number>
  /** Word count of each full-text passage entering evidence ranking. */
  fulltextChunkWords?: Volatile<number>
  /** Character bound for full text accepted into `zotero_retrieve` ranking. */
  maxFulltextChars?: Volatile<number>
  /** Streaming byte bound for every API response body. */
  maxResponseBytes?: Volatile<number>
  /** Provider hard limit for export output; the model-facing inline budget is deployment spill policy. */
  maxExportChars?: Volatile<number>
  /** Upper bound for refs in one `zotero_export` call; citation batches up to this value, the other formats refuse to exceed the API's 50-key request cap. */
  maxExportRefs?: Volatile<number>
  /** Upper bound for items a browse call may return */
  maxBrowseResults?: Volatile<number>
  /** Display cap for `zotero_changes` listings; the diff itself always reads the whole range. */
  maxChangesResults?: Volatile<number>
  /** CSL style for citation/bibliography formats; must be bundled with Zotero (e.g. `apa`). */
  defaultStyle?: Volatile<string>
  /** CSL locale for citation/bibliography formats. */
  defaultLocale?: Volatile<string>
  /**
   * Whether the write tools register and the `local` provider serves writes
   * (research notes, tags, collection membership). Off by default: writing
   * is an explicit opt-in, and the capability stays absent until it is.
   */
  writeEnabled?: Volatile<boolean>
  /**
   * Whether an Always-Allow grant from Zotero's authorization dialog is
   * persisted into the host credentials store (bound to the Zotero instance
   * that issued it). One-time keys are never persisted regardless.
   */
  writePersistKey?: Volatile<boolean>
  /**
   * Whether the dedicated Zotero web view (tool cards in a conversation tab) is enabled.
   * Client-only: the host half never reads this (it shares the `zotero`
   * settings namespace so the card and the tab stay on one document); only
   * `src/client/` gates on it. Do not branch host behavior on it.
   */
  webEnabled?: Volatile<boolean>
}

/**
 * Every field is `volatile`: the settings page edits the live entry, and the
 * loader commits volatile edits into the running fiber without remounting
 * (non-volatile edits would remount instead, and the settings write path
 * refuses them). The service re-reads the references per request and reacts
 * to `loader/volatile-update` for structural flips (transport, write tools).
 */
export const Config = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:23119/api').volatile(),
  provider: Schema.string().default(LOCAL_PROVIDER_ID).volatile(),
  timeoutMs: Schema.number().default(5000).volatile(),
  maxSearchResults: Schema.number().default(20).volatile(),
  maxNoteScanRecords: Schema.number().default(200).volatile(),
  maxEvidenceChars: Schema.number().default(6000).volatile(),
  maxEvidencePassages: Schema.number().default(4).volatile(),
  maxDetailChars: Schema.number().default(3000).volatile(),
  maxNoteBodyChars: Schema.number().default(30_000).volatile(),
  maxNoteChars: Schema.number().default(2000).volatile(),
  maxNoteRecords: Schema.number().default(50).volatile(),
  maxAnnotationRecords: Schema.number().default(100).volatile(),
  fulltextChunkWords: Schema.number().default(200).volatile(),
  maxFulltextChars: Schema.number().default(250_000).volatile(),
  maxResponseBytes: Schema.number()
    .default(16 * 1024 * 1024)
    .volatile(),
  maxExportChars: Schema.number().default(1_000_000).volatile(),
  maxExportRefs: Schema.number().default(50).volatile(),
  maxBrowseResults: Schema.number().default(50).volatile(),
  maxChangesResults: Schema.number().default(50).volatile(),
  defaultStyle: Schema.string().default('apa').volatile(),
  defaultLocale: Schema.string().default('en-US').volatile(),
  writeEnabled: Schema.boolean().default(false).volatile(),
  writePersistKey: Schema.boolean().default(true).volatile(),
  webEnabled: Schema.boolean().default(true).volatile(),
})

export interface ResolvedConfig {
  readonly baseUrl: string
  readonly provider: string
  readonly timeoutMs: number
  readonly maxSearchResults: number
  readonly maxNoteScanRecords: number
  readonly maxEvidenceChars: number
  readonly maxEvidencePassages: number
  readonly maxDetailChars: number
  readonly maxNoteBodyChars: number
  readonly maxNoteChars: number
  readonly maxNoteRecords: number
  readonly maxAnnotationRecords: number
  readonly fulltextChunkWords: number
  readonly maxFulltextChars: number
  readonly maxResponseBytes: number
  readonly maxExportChars: number
  readonly maxExportRefs: number
  readonly maxBrowseResults: number
  readonly maxChangesResults: number
  readonly defaultStyle: string
  readonly defaultLocale: string
  readonly writeEnabled: boolean
  readonly writePersistKey: boolean
  readonly webEnabled: boolean
}

/**
 * Hostnames that are loopback by definition. `localhost` is pinned to the
 * IPv4 literal before any request leaves the plugin; the set is the single
 * spelling authority for validation and for the shell-write detector's
 * host anchors, so the two can never drift.
 */
export const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
])

/**
 * Pin a loopback hostname to a loopback IP literal. `localhost` would
 * otherwise resolve through the system resolver, whose answer a hosts-file
 * change can redirect after validation; rewriting it here locks every
 * request to a verified loopback address. The pin is a plain string rewrite
 * — `localhost` to the IPv4 loopback literal, the address every mainstream
 * platform resolves it to — keeping validation synchronous and the resolver
 * out of every request.
 */
function pinLoopbackHostname(hostname: string): string {
  if (hostname !== 'localhost') return hostname
  return '127.0.0.1'
}

function assertPositiveInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`dsh-zotero: ${name} must be a positive integer; got ${value}`)
  }
}

function assertNonEmpty(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-zotero: ${name} must be a non-empty string`)
  }
}

/** Plain options as humans write them: every `Config` reference unwrapped. */
export type Options = {
  [K in keyof Config]?: NonNullable<Config[K]> extends Volatile<infer T> ? T : never
}

/**
 * Read the current value behind a volatile reference. Plain values pass
 * through untouched, so callers holding pre-resolution input need no
 * wrapping.
 * @param value - a field value, possibly a volatile reference.
 * @returns the current plain value.
 */
function current(value: unknown): unknown {
  return isVolatile(value) ? value.get() : value
}

/**
 * Unwrap every top-level field of an entry to its plain value.
 * @param config - a Loader-resolved `Config` or human-written `Options`.
 * @returns the plain field map, without schema defaults.
 */
function unwrapConfig(config: Config | Options): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config ?? {}).map(([key, value]) => [key, current(value)]),
  )
}

/** Schema defaults, computed once: `Config({})` then unwrapped. */
const SCHEMA_DEFAULTS: Record<string, unknown> = unwrapConfig(Config({}) as Config)

/**
 * Whether an entry already carries every `ResolvedConfig` field (after
 * unwrap). True for Loader/fiber-delivered config — that path applies the
 * same Schemastery schema before the constructor runs — and for a complete
 * `Options` object.
 */
export function isSchemaComplete(config: Config | Options): boolean {
  const raw = unwrapConfig(config)
  return Object.keys(SCHEMA_DEFAULTS).every((key) => Object.hasOwn(raw, key))
}

/**
 * Normalize an entry for the service's live read. Schema-complete input is
 * kept as-is (Loader hands stable volatile references; live commits write
 * those same refs). Partial `Options` cannot observe volatile commits, so the
 * resolved snapshot is stored instead of re-applying Schemastery per request.
 * @param config - the constructor's entry, already accepted by {@link resolveConfig}.
 * @returns the entry the live getter reads.
 */
export function toLiveEntry(config: Config | Options): Config | Options {
  return isSchemaComplete(config) ? config : resolveConfig(config)
}

/**
 * Constraint checks and the loopback hostname pin. Input must already carry
 * every `ResolvedConfig` field with a usable value (Schemastery applied, or
 * unwrapped from a complete entry).
 * @throws {Error} on loopback/URL/limit violations.
 */
export function assertResolvedConfig(plain: Record<string, unknown>): ResolvedConfig {
  if (typeof plain.baseUrl !== 'string') {
    throw new Error(
      `dsh-zotero: invalid baseUrl ${JSON.stringify(plain.baseUrl)}; expected an http:// loopback URL like http://127.0.0.1:23119/api`,
    )
  }
  let url: URL
  try {
    url = new URL(plain.baseUrl)
  } catch (error) {
    throw new Error(
      `dsh-zotero: invalid baseUrl ${JSON.stringify(plain.baseUrl)}; expected an http:// loopback URL like http://127.0.0.1:23119/api`,
      { cause: error },
    )
  }
  if (url.protocol !== 'http:') {
    throw new Error(
      `dsh-zotero: baseUrl must use the http: scheme (the Zotero Local API is plain loopback HTTP); got ${plain.baseUrl}`,
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(
      'dsh-zotero: baseUrl must not carry credentials (the Zotero Local API is unauthenticated)',
    )
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error(
      'dsh-zotero: baseUrl must not carry a query string or fragment (the Zotero Local API takes none)',
    )
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `dsh-zotero: baseUrl must point at loopback (127.0.0.1, localhost, or ::1) to reach the Zotero Local API; got ${plain.baseUrl}`,
    )
  }
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
    throw new Error(
      `dsh-zotero: baseUrl path must be the Local API root (/api); got ${plain.baseUrl}`,
    )
  }
  const hostname = pinLoopbackHostname(url.hostname)
  if (hostname !== url.hostname) {
    // The pin only rewrites `localhost` (to the IPv4 loopback literal), so
    // the assignment needs no bracket handling — IPv6 literals come back
    // unchanged and never enter this branch.
    url.hostname = hostname
  }
  assertNonEmpty('provider', plain.provider)
  assertNonEmpty('defaultStyle', plain.defaultStyle)
  assertNonEmpty('defaultLocale', plain.defaultLocale)
  if (
    typeof plain.timeoutMs !== 'number' ||
    !Number.isFinite(plain.timeoutMs) ||
    plain.timeoutMs <= 0
  ) {
    throw new Error(
      `dsh-zotero: timeoutMs must be a positive finite number; got ${plain.timeoutMs}`,
    )
  }
  assertPositiveInteger('maxSearchResults', plain.maxSearchResults)
  assertPositiveInteger('maxNoteScanRecords', plain.maxNoteScanRecords)
  assertPositiveInteger('maxEvidenceChars', plain.maxEvidenceChars)
  assertPositiveInteger('maxEvidencePassages', plain.maxEvidencePassages)
  assertPositiveInteger('maxDetailChars', plain.maxDetailChars)
  assertPositiveInteger('maxNoteBodyChars', plain.maxNoteBodyChars)
  assertPositiveInteger('maxNoteChars', plain.maxNoteChars)
  assertPositiveInteger('maxNoteRecords', plain.maxNoteRecords)
  assertPositiveInteger('maxAnnotationRecords', plain.maxAnnotationRecords)
  assertPositiveInteger('fulltextChunkWords', plain.fulltextChunkWords)
  assertPositiveInteger('maxFulltextChars', plain.maxFulltextChars)
  assertPositiveInteger('maxResponseBytes', plain.maxResponseBytes)
  assertPositiveInteger('maxExportChars', plain.maxExportChars)
  assertPositiveInteger('maxExportRefs', plain.maxExportRefs)
  assertPositiveInteger('maxBrowseResults', plain.maxBrowseResults)
  assertPositiveInteger('maxChangesResults', plain.maxChangesResults)
  // Every field above proved its type (schema application rejects mistyped
  // input; the asserts reject out-of-range values), so the spread is a
  // ResolvedConfig once the normalized URL is set.
  return { ...plain, baseUrl: url.toString() } as ResolvedConfig
}

/**
 * Live read of a schema-complete entry (the Loader/fiber contract: every
 * field is present as a stable volatile reference or a plain value that
 * already passed {@link resolveConfig}). Unwrap + constraint checks only —
 * Schemastery is not re-applied on this path.
 * @throws {Error} on loopback/URL/limit violations, or when a field is missing.
 */
export function readResolvedConfig(entry: Config | Options): ResolvedConfig {
  return assertResolvedConfig(unwrapConfig(entry))
}

/**
 * Validate a raw config and fill schema defaults.
 *
 * The single schema+constraint authority: runs at load (a violating entry
 * fails loud) and as the `internal/config` veto (a violating settings commit
 * is refused before it lands). The service's per-request live read goes
 * through {@link readResolvedConfig} on an entry that already passed this
 * function (or arrived Loader schema-complete), so it never observes a value
 * this function would reject.
 * @throws {Error} on loopback/URL/limit violations; misconfiguration fails the plugin load.
 */
export function resolveConfig(config: Config | Options): ResolvedConfig {
  // Unwrap both sides of the schema: the loader hands parsed config whose
  // volatile fields are already references, while commits and tests hand
  // plain values — and application wraps every volatile field in a fresh
  // reference either way. Validation below always reads plain values.
  const applied = unwrapConfig(Config(unwrapConfig(config)) as Config)
  return assertResolvedConfig(applied)
}
