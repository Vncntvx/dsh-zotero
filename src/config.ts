/**
 * Plugin configuration. Every deployment-varying choice is a validated
 * `Config` field; the schema fills defaults and `resolveConfig` enforces the
 * constraints Schemastery cannot express (loopback-only `baseUrl`, positive
 * finite limits) at load time, failing loud on misconfiguration.
 * @module dsh-zotero/config
 */

import Schema from '@deepseek-ai/schemastery'
import { LOCAL_PROVIDER_ID } from './constants.js'

export interface Config {
  /** Zotero Local API base URL. Must be plain loopback HTTP. */
  baseUrl?: string
  /** Provider id to select; the V1 provider registers as `local`. */
  provider?: string
  /** Per-request provider deadline in milliseconds. */
  timeoutMs?: number
  /** Upper bound for `zotero_search` `limit`. */
  maxSearchResults?: number
  /** Upper bound for note records `zotero_search` scans for body matches. */
  maxNoteScanRecords?: number
  /** Total character budget for retrieved evidence passages. */
  maxEvidenceChars?: number
  /** Upper bound for the number of evidence passages. */
  maxEvidencePassages?: number
  /** Character budget for the `zotero_get` abstract preview. */
  maxDetailChars?: number
  /** Character budget for a note item's own body returned by `zotero_get`. */
  maxNoteBodyChars?: number
  /** Per-note character budget for `zotero_get` note previews. */
  maxNoteChars?: number
  /** Upper bound for note records returned by `zotero_get`. */
  maxNoteRecords?: number
  /** Upper bound for annotation records returned by `zotero_get`. */
  maxAnnotationRecords?: number
  /** Word count of each full-text passage entering evidence ranking. */
  fulltextChunkWords?: number
  /** Character bound for full text accepted into `zotero_retrieve` ranking. */
  maxFulltextChars?: number
  /** Streaming byte bound for every API response body. */
  maxResponseBytes?: number
  /** Provider hard limit for export output; the model-facing inline budget is deployment spill policy. */
  maxExportChars?: number
  /** Upper bound for refs in one `zotero_export` call; citation batches up to this value, the other formats refuse to exceed the API's 50-key request cap. */
  maxExportRefs?: number
  /** CSL style for citation/bibliography formats; must be bundled with Zotero (e.g. `apa`). */
  defaultStyle?: string
  /** CSL locale for citation/bibliography formats. */
  defaultLocale?: string
  /** Whether the dedicated Zotero web view (tool cards in a conversation tab) is enabled. */
  webEnabled?: boolean
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:23119/api'),
  provider: Schema.string().default(LOCAL_PROVIDER_ID),
  timeoutMs: Schema.number().default(5000),
  maxSearchResults: Schema.number().default(20),
  maxNoteScanRecords: Schema.number().default(200),
  maxEvidenceChars: Schema.number().default(6000),
  maxEvidencePassages: Schema.number().default(4),
  maxDetailChars: Schema.number().default(3000),
  maxNoteBodyChars: Schema.number().default(30_000),
  maxNoteChars: Schema.number().default(2000),
  maxNoteRecords: Schema.number().default(50),
  maxAnnotationRecords: Schema.number().default(100),
  fulltextChunkWords: Schema.number().default(200),
  maxFulltextChars: Schema.number().default(250_000),
  maxResponseBytes: Schema.number().default(16 * 1024 * 1024),
  maxExportChars: Schema.number().default(1_000_000),
  maxExportRefs: Schema.number().default(50),
  defaultStyle: Schema.string().default('apa'),
  defaultLocale: Schema.string().default('en-US'),
  webEnabled: Schema.boolean().default(true),
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
  readonly defaultStyle: string
  readonly defaultLocale: string
  readonly webEnabled: boolean
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Pin a loopback hostname to a loopback IP literal. `localhost` would
 * otherwise resolve through the system resolver, whose answer a hosts-file
 * change can redirect after validation; rewriting it here locks every
 * request to a verified loopback address. Node removed the synchronous
 * resolver (`dns.lookupSync` removed in 20.13), so `localhost` pins
 * directly to the IPv4 loopback literal — the address every mainstream
 * platform resolves it to — keeping validation synchronous and the
 * resolver out of every request.
 */
function pinLoopbackHostname(hostname: string): string {
  if (hostname !== 'localhost') return hostname
  return '127.0.0.1'
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`dsh-zotero: ${name} must be a positive integer; got ${value}`)
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim() === '') {
    throw new Error(`dsh-zotero: ${name} must be a non-empty string`)
  }
}

/**
 * Validate a raw config and fill schema defaults.
 * @throws {Error} on loopback/URL/limit violations; misconfiguration fails the plugin load.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  // The schema fills every declared default before this point, so the
  // validated value carries all ResolvedConfig fields.
  const applied = Config(config) as Required<Config>
  let url: URL
  try {
    url = new URL(applied.baseUrl)
  } catch (error) {
    throw new Error(
      `dsh-zotero: invalid baseUrl ${JSON.stringify(applied.baseUrl)}; expected an http:// loopback URL like http://127.0.0.1:23119/api`,
      { cause: error },
    )
  }
  if (url.protocol !== 'http:') {
    throw new Error(
      `dsh-zotero: baseUrl must use the http: scheme (the Zotero Local API is plain loopback HTTP); got ${applied.baseUrl}`,
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
      `dsh-zotero: baseUrl must point at loopback (127.0.0.1, localhost, or ::1) to reach the Zotero Local API; got ${applied.baseUrl}`,
    )
  }
  const hostname = pinLoopbackHostname(url.hostname)
  if (hostname !== url.hostname) {
    // The pin only rewrites `localhost` (to the IPv4 loopback literal), so
    // the assignment needs no bracket handling — IPv6 literals come back
    // unchanged and never enter this branch.
    url.hostname = hostname
  }
  assertNonEmpty('provider', applied.provider)
  assertNonEmpty('defaultStyle', applied.defaultStyle)
  assertNonEmpty('defaultLocale', applied.defaultLocale)
  if (!Number.isFinite(applied.timeoutMs) || applied.timeoutMs <= 0) {
    throw new Error(
      `dsh-zotero: timeoutMs must be a positive finite number; got ${applied.timeoutMs}`,
    )
  }
  assertPositiveInteger('maxSearchResults', applied.maxSearchResults)
  assertPositiveInteger('maxNoteScanRecords', applied.maxNoteScanRecords)
  assertPositiveInteger('maxEvidenceChars', applied.maxEvidenceChars)
  assertPositiveInteger('maxEvidencePassages', applied.maxEvidencePassages)
  assertPositiveInteger('maxDetailChars', applied.maxDetailChars)
  assertPositiveInteger('maxNoteBodyChars', applied.maxNoteBodyChars)
  assertPositiveInteger('maxNoteChars', applied.maxNoteChars)
  assertPositiveInteger('maxNoteRecords', applied.maxNoteRecords)
  assertPositiveInteger('maxAnnotationRecords', applied.maxAnnotationRecords)
  assertPositiveInteger('fulltextChunkWords', applied.fulltextChunkWords)
  assertPositiveInteger('maxFulltextChars', applied.maxFulltextChars)
  assertPositiveInteger('maxResponseBytes', applied.maxResponseBytes)
  assertPositiveInteger('maxExportChars', applied.maxExportChars)
  assertPositiveInteger('maxExportRefs', applied.maxExportRefs)
  return { ...applied, baseUrl: url.toString() }
}
